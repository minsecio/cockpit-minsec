import cockpit from 'cockpit';

const _ = cockpit.gettext;

/*
 * minsec duration syntax, per minsec(1): bare seconds, or one or more
 * integer/unit pairs using s, m, h, d, w. "30", "10m", "1h30m", "2d".
 */
const UNITS = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };

export function parseDuration(text) {
    const s = String(text ?? '').trim();
    if (!s)
        return null;
    if (/^\d+$/.test(s))
        return parseInt(s, 10);
    if (!/^(\d+[smhdw])+$/.test(s))
        return null;
    let total = 0;
    for (const [, n, u] of s.matchAll(/(\d+)([smhdw])/g))
        total += parseInt(n, 10) * UNITS[u];
    return total;
}

export function isValidDuration(text) {
    const v = parseDuration(text);
    return v !== null && v > 0;
}

/* Seconds to the compact form minsec itself accepts, so values round-trip. */
export function formatDuration(seconds) {
    let n = Math.max(0, Math.floor(seconds || 0));
    if (n === 0)
        return '0s';
    const out = [];
    for (const u of ['w', 'd', 'h', 'm', 's']) {
        const size = UNITS[u];
        if (n >= size) {
            out.push(`${Math.floor(n / size)}${u}`);
            n %= size;
        }
    }
    return out.join('');
}

/* Human phrasing for a countdown or an elapsed span. */
export function humanDuration(seconds) {
    const n = Math.max(0, Math.floor(seconds || 0));
    if (n < 60)
        return cockpit.format(cockpit.ngettext("$0 second", "$0 seconds", n), n);
    if (n < 3600) {
        const m = Math.floor(n / 60);
        return cockpit.format(cockpit.ngettext("$0 minute", "$0 minutes", m), m);
    }
    if (n < 86400) {
        const h = Math.floor(n / 3600);
        return cockpit.format(cockpit.ngettext("$0 hour", "$0 hours", h), h);
    }
    const d = Math.floor(n / 86400);
    return cockpit.format(cockpit.ngettext("$0 day", "$0 days", d), d);
}

export function formatTimestamp(unixSeconds) {
    if (!unixSeconds)
        return '';
    return new Date(unixSeconds * 1000).toLocaleString();
}

export function relativeTime(unixSeconds) {
    if (!unixSeconds)
        return '';
    const delta = Math.floor(Date.now() / 1000) - unixSeconds;
    if (delta < 5)
        return _("just now");
    return cockpit.format(_("$0 ago"), humanDuration(delta));
}

/*
 * Accept an address or CIDR. minsec normalizes hosts to /32 or /128 and
 * truncates CIDRs to the network address, so this only needs to reject input
 * the daemon would refuse outright.
 */
export function isValidNetwork(text) {
    const s = String(text ?? '').trim();
    if (!s)
        return false;
    const [addr, prefix] = s.split('/');
    if (prefix !== undefined) {
        if (!/^\d{1,3}$/.test(prefix))
            return false;
        const p = parseInt(prefix, 10);
        const max = addr.includes(':') ? 128 : 32;
        if (p > max)
            return false;
    }
    if (addr.includes(':'))
        return /^[0-9a-fA-F:]+$/.test(addr) && (addr.match(/::/g) || []).length <= 1;
    const octets = addr.split('.');
    return octets.length === 4 && octets.every(o => /^\d{1,3}$/.test(o) && parseInt(o, 10) <= 255);
}

/* TOML string escaping for the values this module writes. */
export function tomlString(value) {
    return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

export function tomlStringArray(values) {
    return '[' + values.map(tomlString).join(', ') + ']';
}
