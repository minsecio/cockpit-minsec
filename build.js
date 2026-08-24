#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import zlib from 'node:zlib';

import { sassPlugin } from 'esbuild-sass-plugin';
import esbuild from 'esbuild';
import argparse from 'argparse';

const production = process.env.NODE_ENV === 'production';
const outdir = 'dist';

const parser = argparse.ArgumentParser();
parser.add_argument('-w', '--watch', { action: 'store_true', help: 'rebuild on change' });
const args = parser.parse_args();

// `import cockpit from 'cockpit'` resolves to the window.cockpit global that
// ../base1/cockpit.js installs; it is never bundled.
const cockpitResolvePlugin = {
    name: 'cockpit-resolve',
    setup(build) {
        build.onResolve({ filter: /^cockpit$/ }, a => ({ path: a.path, namespace: 'external-global' }));
        build.onLoad({ filter: /.*/, namespace: 'external-global' },
                     a => ({ contents: `module.exports = ${a.path}` }));
    },
};

const cleanPlugin = {
    name: 'clean',
    setup(build) {
        build.onStart(() => fs.rmSync(outdir, { recursive: true, force: true }));
    },
};

const copyAssetsPlugin = {
    name: 'copy-assets',
    setup(build) {
        build.onEnd(result => {
            if (result?.errors.length)
                return;
            for (const f of ['manifest.json', 'index.html'])
                fs.copyFileSync(path.join('src', f), path.join(outdir, f));
        });
    },
};

// cockpit-ws serves a pre-compressed .gz sibling when one exists. Only JS and
// CSS are compressed: cockpit-ws reads manifest.json itself to register the
// package, and index.html is served directly, so both must stay plain.
const compressPlugin = {
    name: 'compress',
    setup(build) {
        build.onEnd(result => {
            if (result?.errors.length)
                return;
            for (const f of fs.readdirSync(outdir)) {
                if (!/\.(js|css)$/.test(f))
                    continue;
                const p = path.join(outdir, f);
                fs.writeFileSync(p + '.gz', zlib.gzipSync(fs.readFileSync(p), { level: 9 }));
                fs.rmSync(p);
            }
        });
    },
};

const notifyEndPlugin = {
    name: 'notify-end',
    setup(build) {
        let start;
        build.onStart(() => { start = Date.now() });
        build.onEnd(r => {
            const status = r?.errors.length ? `FAILED (${r.errors.length} errors)` : 'ok';
            console.log(`${new Date().toTimeString().split(' ')[0]}: build ${status} in ${Date.now() - start} ms`);
        });
    },
};

const context = await esbuild.context({
    ...!production ? { sourcemap: 'linked' } : {},
    bundle: true,
    entryPoints: ['./src/index.jsx'],
    external: ['*.woff', '*.woff2', '*.jpg', '*.svg'],
    legalComments: 'external',
    loader: { '.js': 'jsx' },
    minify: production,
    outdir,
    target: ['es2020'],
    plugins: [
        cleanPlugin,
        cockpitResolvePlugin,
        sassPlugin({ loadPaths: ['node_modules'], filter: /\.scss/, quietDeps: true }),
        copyAssetsPlugin,
        ...production ? [compressPlugin] : [],
        notifyEndPlugin,
    ],
});

if (args.watch) {
    await context.watch();
    await new Promise(() => {});
} else {
    try {
        await context.rebuild();
    } catch {
        process.exit(1);
    }
    await context.dispose();
}
