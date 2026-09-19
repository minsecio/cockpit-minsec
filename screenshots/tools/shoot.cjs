const { chromium } = require('playwright-core');
const fs = require('fs');
const os = require('os');

const BASE = 'http://127.0.0.1:9999/minsec';
const WIDTH = 1366;
const scheme = process.argv[2] || 'light';
const OUT = `shots/${scheme}`;
fs.mkdirSync(OUT, { recursive: true });

const SSHD_LINES = [
    'Sep 18 23:41:07 web1 sshd[21877]: Invalid user admin from 203.0.113.42 port 51234',
    'Sep 18 23:41:09 web1 sshd[21877]: Failed password for invalid user admin from 203.0.113.42 port 51234 ssh2',
    'Sep 18 23:41:15 web1 sshd[21880]: Failed password for root from 198.51.100.17 port 40022 ssh2',
    'Sep 18 23:41:18 web1 sshd[21880]: Failed password for root from 198.51.100.17 port 40022 ssh2',
    'Sep 18 23:41:31 web1 sshd[21884]: Accepted publickey for alice from 10.20.4.8 port 55010 ssh2: ED25519 SHA256:Qm3k…',
    'Sep 18 23:41:40 web1 sshd[21890]: pam_unix(sshd:auth): authentication failure; logname= uid=0 euid=0 tty=ssh ruser= rhost=192.0.2.77 user=postgres',
].join('\n');

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* The shell shows the real user and host; swap them for generic ones. */
async function mask(page) {
    await page.evaluate(() => {
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
            if (n.nodeValue.includes('rocky10.swelljoe.com'))
                n.nodeValue = n.nodeValue.replace('rocky10.swelljoe.com', 'web1.example.com');
            if (/^\s*joe@?\s*$/.test(n.nodeValue))
                n.nodeValue = n.nodeValue.replace('joe', 'admin');
        }
    });
}

async function contentHeight(frame) {
    return frame.evaluate(() => {
        const els = [document.documentElement, document.body,
                     ...document.querySelectorAll('.pf-v6-c-page__main, .pf-v6-c-page, .pf-v6-c-drawer__content, .pf-v6-c-drawer__panel')];
        return Math.max(...els.map(e => e.scrollHeight));
    });
}

async function shot(page, frame, name, { cap = 2400, min = 850 } = {}) {
    await page.setViewportSize({ width: WIDTH, height: min });
    await sleep(300);
    const box = await page.locator('iframe[name$="/minsec"]').boundingBox();
    for (let i = 0; i < 2; i++) {
        const h = Math.min(cap, Math.max(min, Math.ceil(box.y + await contentHeight(frame)) + 40));
        await page.setViewportSize({ width: WIDTH, height: h });
        await sleep(400);
    }
    await mask(page);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log('wrote', `${OUT}/${name}.png`);
}

async function go(page, key, ready) {
    await page.goto(`${BASE}#/${key}`);
    const frame = page.frames().find(f => f.url().includes('/minsec/'));
    await frame.waitForSelector(ready, { timeout: 20000 });
    await frame.waitForSelector('.pf-v6-c-spinner', { state: 'detached' });
    await sleep(300);
    return frame;
}

(async () => {
    const browser = await chromium.launch({
        executablePath: os.homedir() + '/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome',
    });
    const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 850 }, deviceScaleFactor: 2, colorScheme: scheme });
    const page = await ctx.newPage();
    await page.addInitScript(style => { try { localStorage.setItem('shell:style', style) } catch {} }, scheme);

    await page.goto(`${BASE}#/overview`);
    await page.waitForSelector('text=/Limited access|Administrative access/', { timeout: 20000 });
    const limited = page.getByRole('button', { name: /Limited access/ });
    if (await limited.count()) {
        await limited.click();
        await page.getByRole('contentinfo').getByRole('button', { name: 'Close' }).click();
        await sleep(500);
    }

    let frame = await go(page, 'overview', 'text=Active bans');
    await shot(page, frame, '01-overview');
    await frame.getByRole('button', { name: 'How this works' }).click();
    await frame.waitForSelector('.pf-v6-c-drawer__panel');
    await sleep(500);
    await shot(page, frame, '02-overview-help');
    await frame.getByRole('button', { name: 'Close drawer panel' }).click();

    frame = await go(page, 'bans', 'table[aria-label="Blocked networks"]');
    await shot(page, frame, '03-bans');
    await frame.getByRole('button', { name: 'Block an address' }).first().click();
    await frame.locator('#ban-net').fill('203.0.113.0/24');
    await frame.locator('#ban-ttl').fill('2d');
    await sleep(300);
    await shot(page, frame, '04-bans-block-dialog');
    await frame.getByRole('button', { name: 'Cancel' }).click();

    frame = await go(page, 'filters', 'table[aria-label="Filters"]');
    const sshdRow = frame.locator('table[aria-label="Filters"] tr', { hasText: 'OpenSSH' });
    await sshdRow.locator('button').first().click();
    await sleep(400);
    await shot(page, frame, '05-filters');
    await sshdRow.getByRole('button', { name: 'Test' }).click();
    await frame.locator('#test-text').fill(SSHD_LINES);
    await frame.getByRole('button', { name: 'Run test' }).click();
    await frame.waitForSelector('table[aria-label="Matches"]');
    await sleep(300);
    await shot(page, frame, '06-filters-test');
    await frame.getByRole('contentinfo').getByRole('button', { name: 'Close' }).click();

    frame = await go(page, 'settings', '#maxretry');
    await frame.getByRole('button', { name: 'Advanced' }).click();
    await sleep(300);
    await shot(page, frame, '07-settings');
    const mainRow = frame.locator('table[aria-label="Configuration files"] tbody tr').first();
    await mainRow.getByRole('button', { name: 'Kebab toggle' }).click();
    await frame.getByRole('menuitem', { name: 'Edit' }).click();
    await frame.waitForSelector('textarea[aria-label="File contents"]');
    await sleep(400);
    await shot(page, frame, '08-settings-editor');
    await frame.getByRole('button', { name: 'Cancel' }).click();

    frame = await go(page, 'multiplayer', 'text=Enrolled');
    await frame.getByRole('button', { name: 'Enrollment details' }).click();
    await sleep(300);
    await shot(page, frame, '09-multiplayer');
    await frame.evaluate(() => { window.MOCK.saved = window.MOCK.files['/etc/minsec/sync.toml']; delete window.MOCK.files['/etc/minsec/sync.toml'] });
    await go(page, 'events', 'table[aria-label="Events"]');
    frame = await go(page, 'multiplayer', 'text=Multiplayer is off');
    await shot(page, frame, '10-multiplayer-off');
    await frame.getByRole('button', { name: 'Turn on multiplayer' }).click();
    await frame.waitForSelector('#tier-basic');
    await sleep(300);
    await shot(page, frame, '11-multiplayer-optin');
    await frame.getByRole('button', { name: 'Cancel' }).click();
    await frame.evaluate(() => { window.MOCK.files['/etc/minsec/sync.toml'] = window.MOCK.saved });

    frame = await go(page, 'events', 'table[aria-label="Events"]');
    await shot(page, frame, '12-events', { cap: 1500 });

    await browser.close();
})().catch(e => { console.error(e); process.exit(1) });
