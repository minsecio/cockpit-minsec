/*
 * Fake minsec backend for screenshots. Loaded after cockpit.js and before
 * index.js; replaces cockpit.spawn and cockpit.file so the real page renders
 * invented data. Nothing here touches the system.
 */
(function () {
    const NOW = Math.floor(Date.now() / 1000);
    const M = 60, H = 3600, D = 86400;

    /* --- deterministic pseudo-randomness so every run looks the same --- */
    let seed = 20260919;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff };
    const pick = a => a[Math.floor(rnd() * a.length)];
    const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));

    /* --- inspect document, based on the real one with fake local state --- */
    const inspect = window.MINSEC_INSPECT;
    const byName = n => inspect.filters.find(f => f.name === n);
    inspect.files.dropins = [
        '/etc/minsec/conf.d/apache-auth.toml', '/etc/minsec/conf.d/dovecot.toml',
        '/etc/minsec/conf.d/postfix-sasl.toml', '/etc/minsec/conf.d/postfix.toml',
        '/etc/minsec/conf.d/sshd.toml', '/etc/minsec/conf.d/webmin.toml',
        '/etc/minsec/conf.d/zz-cockpit.toml',
    ];
    inspect.files.custom_filters = ['/etc/minsec/filters/nextcloud.toml'];
    inspect.effective.defaults.allow = ['10.20.0.0/16', '2001:db8:1::/48'];
    {
        const sshd = byName('sshd');
        sshd.configured_override.maxretry = 3;
        sshd.effective_policy.maxretry = 3;
    }
    inspect.filters.push({
        name: 'nextcloud', builtin: false, enabled: true, source: '/etc/minsec/filters/nextcloud.toml',
        definition: {
            name: 'nextcloud', description: 'Nextcloud login failures (from nextcloud.log)',
            files: ['/var/www/nextcloud/data/nextcloud.log', '/var/log/nextcloud/nextcloud.log'],
            journal: { units: [], identifiers: [], comm: [] },
            prefilter: ['Login failed'],
            patterns: ['"remoteAddr":"<HOST>".*"message":"Login failed: \'?<F-USER>[^\'"]+</F-USER>\'? \\(Remote IP: \'?<HOST>\'?\\)'],
            ignore: [], ports: [80, 443],
        },
        configured_override: { enabled: true, bantime: null, findtime: null, maxretry: null, files: null, journal: null, ports: null },
        effective_policy: { bantime_seconds: 3600, findtime_seconds: 600, maxretry: 5, escalation: true,
                            files: ['/var/www/nextcloud/data/nextcloud.log', '/var/log/nextcloud/nextcloud.log'],
                            journal: { units: [], identifiers: [], comm: [] }, ports: [80, 443] },
    });
    inspect.filters.sort((a, b) => a.name.localeCompare(b.name));

    /* --- live state --- */
    const UPTIME = 9 * D + 4 * H + 17 * M;
    const COUNTS = {
        sshd: [6218, 287], 'postfix-sasl': [940, 61], dovecot: [1203, 44], postfix: [312, 9],
        webmin: [188, 12], 'apache-auth': [57, 8], nextcloud: [23, 3],
    };
    const MAXRETRY = { sshd: 3 };

    // [net, filter, ttl, expires_in, hits, escalation]
    let bans = [
        ['203.0.113.42/32', 'sshd', H, 2837, 3, 0],
        ['198.51.100.17/32', 'sshd', H, 3071, 3, 0],
        ['203.0.113.200/32', 'sshd', 4 * H, 4 * H + 612 - 3000, 3, 2],
        ['192.0.2.77/32', 'sshd', H, 1544, 4, 0],
        ['198.51.100.230/32', 'sshd', 32 * H, 31 * H + 900, 3, 5],
        ['203.0.113.9/32', 'sshd', H, 2210, 3, 0],
        ['192.0.2.150/32', 'sshd', H, 3402, 3, 0],
        ['198.51.100.66/32', 'sshd', 8 * H, 8 * H - 140, 3, 3],
        ['203.0.113.118/32', 'sshd', H, 412, 3, 0],
        ['2001:db8:4f2a:11::/64', 'sshd', 2 * H, 2 * H + 95 - 1000, 3, 1],
        ['192.0.2.33/32', 'dovecot', H, 3299, 5, 0],
        ['203.0.113.77/32', 'dovecot', H, 1705, 5, 0],
        ['198.51.100.8/32', 'dovecot', 2 * H, 2 * H + 1300 - 2000, 6, 1],
        ['203.0.113.155/32', 'postfix-sasl', H, 3556, 5, 0],
        ['192.0.2.201/32', 'postfix-sasl', H, 960, 5, 0],
        ['2001:db8:91c:7::/64', 'postfix-sasl', H, 2604, 5, 0],
        ['198.51.100.99/32', 'webmin', H, 3180, 5, 0],
        ['203.0.113.61/32', 'webmin', 16 * H, 16 * H + 45 - 4000, 5, 4],
        ['192.0.2.88/32', 'apache-auth', H, 2930, 5, 0],
        ['203.0.113.130/32', 'postfix', H, 1180, 5, 0],
        ['198.51.100.181/32', 'nextcloud', H, 3490, 5, 0],
        ['198.51.100.0/24', null, 7 * D, 6 * D + 5 * H, 0, 0],
        ['192.0.2.250/32', null, D, 20 * H + 300, 0, 0],
    ].map(([net, filter, ttl, expires_in, hits, escalation]) => ({ net, filter, ttl, expires_in, hits, escalation }));

    const listBans = () => bans
            .slice()
            .sort((a, b) => a.expires_in - b.expires_in)
            .map(b => ({ net: b.net, expires_in: b.expires_in, filter: b.filter }));

    /* --- event log, oldest first --- */
    const events = [];
    events.push({ kind: 'start', ts: NOW - UPTIME - 6 * D, version: '0.1.4' });
    events.push({ kind: 'stop', ts: NOW - UPTIME - 3 });
    events.push({ kind: 'start', ts: NOW - UPTIME, version: '0.2.0' });
    for (const b of bans) {
        const ts = NOW - (b.ttl - b.expires_in);
        if (b.filter)
            events.push({ kind: 'ban', ts, net: b.net, filter: b.filter, ttl: b.ttl, hits: b.hits, escalation: b.escalation, manual: false });
        else
            events.push({ kind: 'ban', ts, net: b.net, filter: 'manual', ttl: b.ttl, hits: 0, escalation: 0, manual: true });
    }
    const pools = ['203.0.113.', '198.51.100.', '192.0.2.'];
    const weighted = ['sshd', 'sshd', 'sshd', 'sshd', 'sshd', 'sshd', 'postfix-sasl', 'postfix-sasl', 'dovecot', 'dovecot', 'webmin', 'apache-auth', 'postfix', 'nextcloud'];
    for (let i = 0; i < 48; i++) {
        const filter = pick(weighted);
        const net = rnd() < 0.08
            ? `2001:db8:${between(0x100, 0xffff).toString(16)}:${between(1, 0xfff).toString(16)}::/64`
            : `${pick(pools)}${between(1, 254)}/32`;
        const escalation = rnd() < 0.2 ? between(1, 3) : 0;
        const ttl = H * 2 ** escalation;
        const ts = NOW - between(2 * H, UPTIME - H);
        const need = MAXRETRY[filter] || 5;
        events.push({ kind: 'ban', ts, net, filter, ttl, hits: need + (rnd() < 0.3 ? between(1, 4) : 0), escalation, manual: false });
        if (ts + ttl < NOW)
            events.push({ kind: 'unban', ts: ts + ttl, net, manual: false });
    }
    events.push({ kind: 'ban', ts: NOW - 2 * D - 3 * H, net: '203.0.113.250/32', filter: 'manual', ttl: 7 * D, hits: 0, escalation: 0, manual: true });
    events.push({ kind: 'unban', ts: NOW - D - 5 * H, net: '203.0.113.250/32', manual: true });
    events.sort((a, b) => a.ts - b.ts);

    /* --- files --- */
    const files = {
        '/etc/minsec/sync.toml':
            '# minsec multiplayer. The existence of this file is the opt-in switch.\n' +
            '# See minsec-sync.toml(5). Remove it to opt out completely.\n\n' +
            'tier = "basic"\nreport = true\npull = true\nipv4 = true\nipv6 = true\n',
        '/var/lib/minsec/sync/state.json': JSON.stringify({
            host_id: 'h3f9a1c2e7b04d68', next_seq: 1289, event_cursor: 186211,
            feed: { basic4: { etag: '"7c1e9b"', fetched: NOW - 4 * M }, basic6: { etag: '"0a44d2"', fetched: NOW - 4 * M } },
        }),
        '/etc/minsec/minsec.toml': window.MINSEC_MAIN_TOML,
        '/etc/minsec/conf.d/sshd.toml': '[filters.sshd]\nenabled = true\nmaxretry = 3\n',
        '/etc/minsec/conf.d/zz-cockpit.toml':
            '# Written by the Cockpit interface. Settings here override minsec.toml.\n\n' +
            '[defaults]\nbantime = "1h"\nfindtime = "10m"\nmaxretry = 5\nescalate_enabled = true\n' +
            'escalate = { factor = 2, max = "1w", memory = "30d" }\n' +
            'allow = ["10.20.0.0/16", "2001:db8:1::/48"]\nbackend = "nft"\nipv6_prefix = 64\n' +
            'max_tracked = 50000\njournal = true\n',
        '/etc/minsec/filters/nextcloud.toml':
            '# Nextcloud login failures. Requires log_type = "file" in config.php.\n\n' +
            'name = "nextcloud"\ndescription = "Nextcloud login failures (from nextcloud.log)"\n' +
            'files = ["/var/www/nextcloud/data/nextcloud.log", "/var/log/nextcloud/nextcloud.log"]\n' +
            'ports = [80, 443]\n\nprefilter = ["Login failed"]\n\npatterns = [\n' +
            '  \'"remoteAddr":"<HOST>".*"message":"Login failed: \\\'?<F-USER>[^\\\'"]+</F-USER>\\\'? \\\\(Remote IP: \\\'?<HOST>\\\'?\\\\)\',\n]\n\nignore = []\n',
    };
    for (const n of ['apache-auth', 'dovecot', 'postfix-sasl', 'postfix', 'webmin'])
        files[`/etc/minsec/conf.d/${n}.toml`] = `[filters.${n}]\nenabled = true\n`;

    /* --- command handlers --- */
    const unitProps = {
        'minsec.service': { LoadState: 'loaded', ActiveState: 'active', SubState: 'running', UnitFileState: 'enabled' },
        'minsec-sync.timer': { LoadState: 'loaded', ActiveState: 'active', SubState: 'waiting', UnitFileState: 'enabled' },
    };
    const units = JSON.parse(JSON.stringify(unitProps));

    function status() {
        const filters = inspect.filters.filter(f => f.enabled).map(f => ({
            name: f.name, files: f.definition.files, journal: inspect.effective.defaults.journal &&
                (f.definition.journal.units.length + f.definition.journal.identifiers.length + f.definition.journal.comm.length) > 0,
            maxretry: f.effective_policy.maxretry, findtime: f.effective_policy.findtime_seconds,
            bantime: f.effective_policy.bantime_seconds,
            matched: (COUNTS[f.name] || [0, 0])[0], banned: (COUNTS[f.name] || [0, 0])[1],
        }));
        const banned = filters.reduce((n, f) => n + f.banned, 0) + 2;
        return { ok: true, status: { version: '0.2.0', backend: 'nft', uptime: UPTIME, tracked: 37, lines: 2148377,
                                     bans_total: banned, active_bans: bans.length, filters } };
    }

    const SSHD_PATTERNS = [
        [/Failed password for (?:invalid user )?(\S+) from (\S+)/, 0],
        [/Invalid user (\S+) from (\S+)/, 1],
        [/authentication failure;.*rhost=(\S+)(?:\s+user=(\S+))?/, 2],
    ];
    function testFilter(name, text) {
        const out = [];
        let lines = 0;
        for (const line of (text || '').split('\n')) {
            if (!line.trim()) continue;
            lines++;
            for (const [re, pattern] of SSHD_PATTERNS) {
                const m = line.match(re);
                if (!m) continue;
                const [ip, user] = pattern === 2 ? [m[1], m[2] || null] : [m[2], m[1]];
                out.push(JSON.stringify({ ip, line, pattern, user }));
                break;
            }
        }
        const ips = new Set(out.map(l => JSON.parse(l).ip));
        return out.join('\n') + `\n${lines} lines, ${out.length} matched, ${ips.size} distinct addresses\n`;
    }

    function minsec(argv, input) {
        const [cmd, ...rest] = argv;
        switch (cmd) {
        case 'status': return JSON.stringify(status());
        case 'list': return JSON.stringify({ ok: true, bans: listBans() });
        case 'ban': {
            const net = rest[0].includes('/') ? rest[0] : rest[0] + (rest[0].includes(':') ? '/128' : '/32');
            const ttl = rest[1] === '--ttl' ? parseDuration(rest[2]) : H;
            bans = bans.filter(b => b.net !== net);
            bans.push({ net, filter: null, ttl, expires_in: ttl, hits: 0, escalation: 0 });
            events.push({ kind: 'ban', ts: NOW, net, filter: 'manual', ttl, hits: 0, escalation: 0, manual: true });
            return JSON.stringify({ ok: true });
        }
        case 'unban':
            bans = bans.filter(b => b.net !== rest[0]);
            events.push({ kind: 'unban', ts: NOW, net: rest[0], manual: true });
            return JSON.stringify({ ok: true });
        case 'filters':
            return JSON.stringify(inspect.filters.map(f => ({ description: f.definition.description, enabled: f.enabled, files: f.definition.files, name: f.name })));
        case 'inspect': return JSON.stringify(inspect);
        case 'events': {
            const n = rest[0] === '-n' ? parseInt(rest[1], 10) : 50;
            return events.slice(-n).map(e => JSON.stringify(e)).join('\n') + '\n';
        }
        case 'enable': case 'disable': {
            const f = byName(rest[0]);
            if (!f) throw { message: `minsec: unknown filter ${rest[0]}`, exit_status: 1 };
            f.enabled = cmd === 'enable';
            f.configured_override.enabled = f.enabled;
            return '';
        }
        case 'check':
            return JSON.stringify({ schema_version: 1, ok: true, checked_filters: inspect.filters.map(f => f.name) });
        case 'test':
            if (!byName(rest[0])) throw { message: `minsec: unknown filter ${rest[0]}`, exit_status: 1 };
            if (rest[1] !== '-') throw { message: `minsec: ${rest[1]}: No such file or directory`, exit_status: 1 };
            return testFilter(rest[0], input);
        default:
            throw { message: `minsec: unhandled command ${argv.join(' ')}`, exit_status: 2 };
        }
    }

    function parseDuration(s) {
        if (/^\d+$/.test(s)) return parseInt(s, 10);
        const U = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
        let t = 0;
        for (const [, n, u] of s.matchAll(/(\d+)([smhdw])/g)) t += parseInt(n, 10) * U[u];
        return t || H;
    }

    function handle(argv, input) {
        const [prog, ...rest] = argv;
        if (prog === 'minsec' && rest[0] === '--json')
            return minsec(rest.slice(1), input);
        if (prog === 'systemctl') {
            if (rest[0] === 'show') {
                const u = units[rest[1]];
                if (!u) return 'LoadState=not-found\nActiveState=inactive\nSubState=dead\nUnitFileState=\n';
                return Object.entries(u).map(([k, v]) => `${k}=${v}`).join('\n') + '\nActiveEnterTimestamp=Wed 2026-09-09 20:02:41 UTC\n';
            }
            const [action, unit] = rest;
            const u = units[unit];
            if (u) {
                if (action === 'start' || action === 'restart') { u.ActiveState = 'active'; u.SubState = unit.endsWith('.timer') ? 'waiting' : 'running' }
                if (action === 'stop') { u.ActiveState = 'inactive'; u.SubState = 'dead' }
                if (action === 'enable') u.UnitFileState = 'enabled';
                if (action === 'disable') u.UnitFileState = 'disabled';
            }
            return '';
        }
        if (prog === 'test') return '';
        if (prog === 'nft') {
            if (rest[1] === 'list') {
                const n = rest[5] === 'crowd4' ? 48213 : 3907;
                return JSON.stringify({ nftables: [{ metainfo: { version: '1.1.1', json_schema_version: 1 } },
                                                   { set: { family: 'inet', name: rest[5], table: 'minsec', type: rest[5] === 'crowd4' ? 'ipv4_addr' : 'ipv6_addr', flags: ['interval'], elem: new Array(n).fill(0) } }] });
            }
            return '';
        }
        if (prog === 'minsec-sync') {
            if (rest[0] === 'enroll') return 'generated signing key /var/lib/minsec/sync/key\nenrolled as h3f9a1c2e7b04d68\n';
            return 'reported 4 bans (seq 1289-1292)\nblocklist basic: 48213 IPv4 and 3907 IPv6 networks, unchanged\n';
        }
        throw { message: `mock: refusing to run ${argv.join(' ')}`, exit_status: 127 };
    }

    function spawn(argv) {
        let resolve, reject, settled = false;
        const p = new Promise((a, b) => { resolve = a; reject = b });
        const settle = input => {
            if (settled) return;
            settled = true;
            setTimeout(() => { try { resolve(handle(argv, input)) } catch (e) { reject(e) } }, 40);
        };
        p.input = text => { settle(text ?? ''); return p };
        p.stream = () => p;
        p.close = () => {};
        setTimeout(() => settle(null), 0);
        return p;
    }

    function file(path) {
        return {
            read: () => new Promise(r => setTimeout(() => r(path in files ? files[path] : null), 30)),
            replace: content => new Promise(r => setTimeout(() => {
                if (content === null) delete files[path]; else files[path] = content;
                r();
            }, 30)),
            close: () => {},
        };
    }

    cockpit.spawn = spawn;
    cockpit.file = file;
    window.MOCK = { files, inspect, units, get bans() { return bans }, set bans(v) { bans = v }, events };
})();
