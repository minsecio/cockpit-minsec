/*
 * Client for the minsec CLI and minsec-sync state files.
 *
 * Every minsec subcommand accepts --json, so nothing here scrapes human
 * output. The control socket is mode 0660 minsec:minsec, so the online
 * commands (status, list, ban, unban) need superuser.
 *
 * minsec-sync has no --json, so its state is read from the files it
 * documents in minsec-sync.toml(5) instead of by parsing its output.
 */

import cockpit from 'cockpit';

const _ = cockpit.gettext;

const OPTS = { superuser: 'require', err: 'message' };

export const SYNC_CONFIG = '/etc/minsec/sync.toml';
export const SYNC_STATE = '/var/lib/minsec/sync/state.json';

/* An error carrying enough context for the UI to explain itself. */
export class MinsecError extends Error {
    constructor(message, { kind = 'error', detail = null } = {}) {
        super(message);
        this.kind = kind;
        this.detail = detail;
    }
}

function classify(err, argv) {
    const msg = (err.message || String(err)).trim();

    /*
     * Order matters. The daemon's own socket error reads "cannot connect to
     * /run/minsec/minsec.sock (No such file or directory)", so it has to be
     * recognised before any missing-file heuristic or a stopped daemon gets
     * reported as an uninstalled package.
     */
    if (/cannot connect to .*is minsec running/.test(msg))
        return new MinsecError(_("The minsec service is not running."), { kind: 'stopped', detail: msg });

    // A failed exec has no exit status; the daemon's socket error exits 1.
    if (err.problem === 'not-found' || (err.exit_status == null && /No such file or directory/.test(msg)))
        return new MinsecError(_("The minsec package is not installed."), { kind: 'missing', detail: msg });

    if (err.problem === 'access-denied' || err.problem === 'authentication-failed')
        return new MinsecError(_("Administrative access is required."), { kind: 'denied', detail: msg });

    return new MinsecError(msg || _("minsec failed"), { kind: 'error', detail: `minsec ${argv.join(' ')}` });
}

/*
 * cockpit.spawn rejects with (error, stdout-so-far). `await` only ever binds
 * the first value, so a two-argument handler is the only way to keep stdout
 * from a command that failed. `check` needs it: it exits 1 on a bad
 * configuration while still writing its JSON report to stdout.
 */
function spawnCapture(argv, input) {
    return new Promise(resolve => {
        const proc = cockpit.spawn(['minsec', '--json', ...argv], OPTS);
        proc.then(
            data => resolve({ ok: true, out: data ?? '' }),
            (err, data) => resolve({ ok: false, err, out: data ?? '' }));
        // Always close stdin, so a command that reads it cannot hang.
        proc.input(input);
    });
}

async function run(argv, { input = null } = {}) {
    const r = await spawnCapture(argv, input);
    if (!r.ok)
        throw classify(r.err, argv);
    return r.out;
}

function parse(text) {
    try {
        return JSON.parse(text);
    } catch {
        throw new MinsecError(_("minsec returned output that could not be parsed."), { detail: text?.slice(0, 400) });
    }
}

function parseLines(text) {
    return (text || '').split('\n')
            .filter(l => l.trim())
            .map(l => { try { return JSON.parse(l) } catch { return null } })
            .filter(Boolean);
}

/* Unwrap a control-socket Response envelope: {ok, error, status, bans, ...} */
function unwrap(text, field) {
    const r = parse(text);
    if (r.ok === false)
        throw new MinsecError(r.error || _("The minsec daemon reported an error."));
    return field ? r[field] : r;
}

/* --- online commands (need the daemon running) --- */

export async function status() {
    return unwrap(await run(['status']), 'status');
}

export async function listBans() {
    return unwrap(await run(['list']), 'bans') || [];
}

export async function ban(net, ttl) {
    return unwrap(await run(['ban', net, ...ttl ? ['--ttl', ttl] : []]));
}

export async function unban(net) {
    return unwrap(await run(['unban', net]));
}

/* --- offline commands --- */

/* `filters` prints a bare array, not a Response envelope. */
export async function filters() {
    const r = parse(await run(['filters']));
    return Array.isArray(r) ? r : [];
}

export async function inspect() {
    const r = parse(await run(['inspect']));
    if (r.ok === false)
        throw new MinsecError(r.error || _("The configuration could not be loaded."));
    return r;
}

export async function events(last = 200) {
    return parseLines(await run(['events', '-n', String(last)])).reverse();
}

export async function enableFilter(name) {
    return run(['enable', name]);
}

export async function disableFilter(name) {
    return run(['disable', name]);
}

/*
 * `check` exits 1 on a bad configuration but still writes its JSON report to
 * stdout, so a failure here is a result, not an exception.
 */
export async function check(all = true) {
    const r = await spawnCapture(['check', ...all ? ['--all'] : []], null);
    // Report on stdout is authoritative whether or not the exit code was 0.
    if (r.out.trim()) {
        try {
            return JSON.parse(r.out);
        } catch { /* fall through to the error paths below */ }
    }
    if (r.ok)
        throw new MinsecError(_("minsec check produced no report."));
    const err = classify(r.err, ['check']);
    if (err.kind === 'missing' || err.kind === 'denied')
        throw err;
    return { ok: false, errors: [{ filter: null, error: err.message }] };
}

/*
 * Run a filter over log text or a file. Returns matches plus a summary.
 * `minsec test` reads stdin when the path is `-`.
 */
export async function testFilter(name, { file = null, text = null } = {}) {
    const argv = ['test', name, file || '-'];
    const r = await spawnCapture(argv, file ? null : (text ?? ''));
    // A missing filter or unreadable file is a real failure with no output.
    if (!r.ok && !r.out.trim())
        throw classify(r.err, argv);
    const matches = parseLines(r.out);
    const addresses = {};
    for (const m of matches)
        addresses[m.ip] = (addresses[m.ip] || 0) + 1;
    return { matches, addresses, matched: matches.length };
}

/* --- systemd units --- */

const UNIT_PROPS = ['LoadState', 'ActiveState', 'SubState', 'UnitFileState', 'ActiveEnterTimestamp'];

export async function unitState(unit) {
    try {
        const out = await cockpit.spawn(
            ['systemctl', 'show', unit, ...UNIT_PROPS.map(p => `--property=${p}`)],
            { superuser: 'try', err: 'message' });
        const props = {};
        for (const line of out.split('\n')) {
            const eq = line.indexOf('=');
            if (eq > 0)
                props[line.slice(0, eq)] = line.slice(eq + 1);
        }
        return {
            exists: props.LoadState === 'loaded',
            active: props.ActiveState === 'active',
            state: props.ActiveState || 'unknown',
            sub: props.SubState || '',
            enabled: props.UnitFileState === 'enabled',
            unitFileState: props.UnitFileState || '',
        };
    } catch {
        return { exists: false, active: false, state: 'unknown', sub: '', enabled: false, unitFileState: '' };
    }
}

export function unitAction(unit, action) {
    return cockpit.spawn(['systemctl', action, unit], OPTS);
}

/* --- minsec-sync --- */

export async function syncInstalled() {
    try {
        await cockpit.spawn(['test', '-x', '/usr/bin/minsec-sync'], { superuser: 'try', err: 'message' });
        return true;
    } catch {
        return false;
    }
}

/* Absent config is the documented "not opted in" state, not an error. */
export async function syncConfig() {
    const text = await cockpit.file(SYNC_CONFIG, { superuser: 'try' }).read();
    return text === null ? null : text;
}

export function writeSyncConfig(text) {
    return cockpit.file(SYNC_CONFIG, { superuser: 'require' }).replace(text);
}

export function removeSyncConfig() {
    return cockpit.file(SYNC_CONFIG, { superuser: 'require' }).replace(null);
}

export async function syncState() {
    try {
        const text = await cockpit.file(SYNC_STATE, { superuser: 'try' }).read();
        return text ? JSON.parse(text) : null;
    } catch {
        return null;
    }
}

/* minsec-sync writes progress to stdout; the caller shows it verbatim. */
export function syncRun(subcommand, extra = []) {
    return cockpit.spawn(['minsec-sync', subcommand, ...extra], OPTS);
}

/* Element counts for the crowd feed sets the sync helper maintains. */
export async function crowdSetSizes() {
    const counts = { crowd4: null, crowd6: null };
    for (const set of ['crowd4', 'crowd6']) {
        try {
            const out = await cockpit.spawn(['nft', '-j', 'list', 'set', 'inet', 'minsec', set], OPTS);
            const nft = JSON.parse(out);
            const entry = nft.nftables?.find(o => o.set)?.set;
            counts[set] = Array.isArray(entry?.elem) ? entry.elem.length : 0;
        } catch {
            counts[set] = null; // set absent until the first pull
        }
    }
    return counts;
}

/* --- config files --- */

export function readFile(path) {
    return cockpit.file(path, { superuser: 'try' }).read();
}

export function writeFile(path, content) {
    return cockpit.file(path, { superuser: 'require' }).replace(content);
}
