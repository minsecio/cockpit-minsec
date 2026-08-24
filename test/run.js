#!/usr/bin/env node
/*
 * Bundles the client modules against a stub `cockpit` global and exercises
 * the logic that is easy to get wrong: duration and network parsing, TOML
 * generation, and the spawn error paths.
 *
 * cockpit.spawn rejects with (error, stdout). The stub reproduces that
 * two-argument rejection faithfully, because `await` sees only the first
 * value and the real bug this guards against was invisible otherwise.
 */

import esbuild from 'esbuild';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-minsec-test-'));
const entry = path.join(tmp, 'entry.js');
const bundle = path.join(tmp, 'bundle.js');

fs.writeFileSync(entry, `
import * as minsec from '${path.resolve('src/minsec.js')}';
import * as util from '${path.resolve('src/util.js')}';
window.api = { minsec, util };
`);

await esbuild.build({
    entryPoints: [entry], bundle: true, outfile: bundle, format: 'iife',
    plugins: [{
        name: 'cockpit-resolve',
        setup(b) {
            b.onResolve({ filter: /^cockpit$/ }, a => ({ path: a.path, namespace: 'eg' }));
            b.onLoad({ filter: /.*/, namespace: 'eg' }, a => ({ contents: `module.exports = ${a.path}` }));
        },
    }],
});

/* A promise with cockpit's multi-value rejection semantics. */
function cockpitPromise(settle) {
    const handlers = [];
    let state = null;
    const p = {
        then(onOk, onErr) { handlers.push([onOk, onErr]); if (state) flush(); return p },
        catch(onErr) { return p.then(undefined, onErr) },
        input() { return p },
        stream() { return p },
    };
    function flush() {
        while (handlers.length) {
            const [onOk, onErr] = handlers.shift();
            if (state.ok) onOk?.(state.values[0]);
            else onErr?.apply(null, state.values);
        }
    }
    settle((...v) => { state = { ok: true, values: v }; setTimeout(flush, 0) },
           (...v) => { state = { ok: false, values: v }; setTimeout(flush, 0) });
    return p;
}

const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
const { window } = dom;

let scenario = 'ok';
const BAD_CHECK = JSON.stringify({
    schema_version: 1, ok: false,
    errors: [{ filter: 'myapp', error: 'pattern 0: missing <HOST>' }],
});

window.cockpit = {
    gettext: s => s,
    ngettext: (s, pl, n) => (n === 1 ? s : pl),
    format: (fmt, ...args) => String(fmt).replace(/\$(\d)/g, (_m, i) => args[i]),
    spawn(argv) {
        const a = argv.join(' ');
        if (scenario === 'nobinary')
            return cockpitPromise((_r, rj) => rj({ problem: 'not-found', message: 'minsec: No such file or directory' }, ''));
        if (scenario === 'stopped')
            return cockpitPromise((_r, rj) => rj({ exit_status: 1, message: 'minsec: cannot connect to /run/minsec/minsec.sock (No such file or directory); is minsec running?' }, ''));
        if (scenario === 'badconfig' && a.includes('check'))
            return cockpitPromise((_r, rj) => rj({ exit_status: 1, message: 'minsec: configuration check failed' }, BAD_CHECK));
        if (scenario === 'unknownfilter' && a.includes('test'))
            return cockpitPromise((_r, rj) => rj({ exit_status: 1, message: 'minsec: unknown filter' }, ''));
        if (a.includes('test'))
            return cockpitPromise(r => r(JSON.stringify({ ip: '203.0.113.5', user: 'root', pattern: 0, line: 'x' }) + '\n'));
        if (a.includes('status'))
            return cockpitPromise(r => r(JSON.stringify({ ok: true, status: { version: '0.1.4', filters: [] } })));
        if (a.includes('list'))
            return cockpitPromise(r => r(JSON.stringify({ ok: true, bans: [{ net: '10.0.0.0/8', expires_in: 60, filter: 'sshd' }] })));
        return cockpitPromise(r => r('{"ok":true,"checked_filters":[]}'));
    },
    file: () => ({ read: () => Promise.resolve(''), replace: () => Promise.resolve() }),
    location: { path: [], go() {} },
    addEventListener() {}, removeEventListener() {},
};

window.eval(fs.readFileSync(bundle, 'utf8'));
const { minsec, util } = window.api;

let passed = 0;
const failures = [];
function check(name, cond, extra = '') {
    if (cond) { passed++; return }
    failures.push(`${name}${extra ? ' — ' + extra : ''}`);
}

/* --- durations --- */
check('parseDuration bare seconds', util.parseDuration('30') === 30);
check('parseDuration compound', util.parseDuration('1h30m') === 5400);
check('parseDuration week', util.parseDuration('1w') === 604800);
check('parseDuration rejects nonsense', util.parseDuration('later') === null);
check('parseDuration rejects bad unit', util.parseDuration('5y') === null);
check('formatDuration round-trips', util.formatDuration(5400) === '1h30m', util.formatDuration(5400));
check('formatDuration zero', util.formatDuration(0) === '0s');
check('duration survives a round trip', util.parseDuration(util.formatDuration(2592000)) === 2592000);
check('isValidDuration rejects zero', util.isValidDuration('0') === false);

/* --- networks --- */
check('accepts IPv4 host', util.isValidNetwork('198.51.100.7'));
check('accepts IPv4 CIDR', util.isValidNetwork('198.51.100.0/24'));
check('rejects octet over 255', !util.isValidNetwork('198.51.100.256'));
check('rejects IPv4 prefix over 32', !util.isValidNetwork('10.0.0.0/33'));
check('accepts IPv6', util.isValidNetwork('2001:db8::1'));
check('accepts IPv6 CIDR', util.isValidNetwork('2001:db8::/32'));
check('rejects IPv6 prefix over 128', !util.isValidNetwork('2001:db8::/129'));
check('rejects double ::', !util.isValidNetwork('2001::db8::1'));
check('rejects empty', !util.isValidNetwork(''));

/* --- TOML --- */
check('tomlString escapes quotes', util.tomlString('a"b') === '"a\\"b"', util.tomlString('a"b'));
check('tomlString escapes backslash', util.tomlString('a\\b') === '"a\\\\b"', util.tomlString('a\\b'));
check('tomlStringArray', util.tomlStringArray(['a', 'b']) === '["a", "b"]', util.tomlStringArray(['a', 'b']));
check('tomlStringArray empty', util.tomlStringArray([]) === '[]');

/* --- client error paths --- */
scenario = 'badconfig';
const report = await minsec.check(true);
check('check() recovers its JSON report from a failed command',
      report.ok === false && report.errors?.[0]?.filter === 'myapp', JSON.stringify(report));

scenario = 'nobinary';
try {
    await minsec.check(true);
    check('check() reports a missing package', false);
} catch (err) {
    check('check() reports a missing package', err.kind === 'missing', err.kind);
}

scenario = 'stopped';
try {
    await minsec.status();
    check('status() reports a stopped daemon', false);
} catch (err) {
    check('status() reports a stopped daemon', err.kind === 'stopped', err.kind);
}

scenario = 'unknownfilter';
try {
    await minsec.testFilter('nope', { text: 'x' });
    check('testFilter() fails on an unknown filter', false);
} catch {
    check('testFilter() fails on an unknown filter', true);
}

scenario = 'ok';
const tested = await minsec.testFilter('sshd', { text: 'line\n' });
check('testFilter() parses matches and tallies addresses',
      tested.matched === 1 && tested.addresses['203.0.113.5'] === 1, JSON.stringify(tested));

const bans = await minsec.listBans();
check('listBans() unwraps the response envelope', bans.length === 1 && bans[0].net === '10.0.0.0/8');

fs.rmSync(tmp, { recursive: true, force: true });

if (failures.length) {
    console.error(`${failures.length} of ${passed + failures.length} checks failed:`);
    for (const f of failures)
        console.error('  ' + f);
    process.exit(1);
}
console.log(`all ${passed} checks passed`);
