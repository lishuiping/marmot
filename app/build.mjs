//
// esbuild 打包脚本：产出 Electron 主进程、preload 与 React 渲染包，并生成 dist/index.html。
//
// 先执行 tsc --noEmit 做类型检查，再运行本脚本。
//
// @author lishuiping
// @license Apache-2.0
// @see https://github.com/lishuiping/marmot

import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
mkdirSync('dist/assets', { recursive: true });

const common = {
  bundle: true,
  sourcemap: false,
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"production"' },
};

await build({
  ...common,
  entryPoints: ['src/main/main.ts'],
  outfile: 'dist/main.js',
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
});

await build({
  ...common,
  entryPoints: ['src/main/preload.ts'],
  outfile: 'dist/preload.js',
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
});

await build({
  ...common,
  entryPoints: ['src/renderer/index.tsx'],
  outfile: 'dist/renderer.js',
  platform: 'browser',
  format: 'iife',
  target: 'chrome122',
  jsx: 'automatic',
  loader: {
    '.css': 'css',
    '.woff': 'file',
    '.woff2': 'file',
    '.ttf': 'file',
  },
  assetNames: 'assets/[name]-[hash]',
});

// The renderer entry lives in dist/ next to the bundles it loads, so the HTML
// is emitted into dist/ as well. Its asset paths are rewritten from
// "./dist/<file>" to "./<file>" to match that location.
const html = readFileSync('index.html', 'utf8').replace(/(["'])\.\/dist\//g, '$1./');
writeFileSync('dist/index.html', html);

// Application artwork, referenced from the interface and used as the window
// icon.
for (const asset of ['marmot-icon-128.png']) {
  copyFileSync(`assets/${asset}`, `dist/assets/${asset}`);
}
copyFileSync('assets/marmot.icns', 'dist/marmot.icns');

console.log('[marmot] bundles written to dist/');
