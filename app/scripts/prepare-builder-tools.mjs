// Prepares the external tools electron-builder downloads on demand.
//
// electron-builder pulls two helper toolsets from GitHub when it needs them:
// the "icons" toolset (converts .icns into .ico and Linux icon sets) and the
// "7zip" binary (produces the .zip and .AppImage archives). It unpacks them
// into its cache directory, and in restricted environments that unpack can be
// cut short. The half-written directory then breaks every build at the icon
// or archive step with a misleading "No such file or directory" error.
//
// This script downloads both toolsets itself, verifies their checksums, and
// unpacks them somewhere reliable. Point electron-builder at the result with:
//
//   ELECTRON_BUILDER_ICONS_TOOLSET_DIR=<dir>
//   ELECTRON_BUILDER_7ZIP_PATH=<path to 7za>
//
// Run with: node scripts/prepare-builder-tools.mjs
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(here);
const cacheDir = join(projectRoot, '.cache', 'builder-tools');

const TOOLSETS = [
  {
    id: 'icons',
    env: 'ELECTRON_BUILDER_ICONS_TOOLSET_DIR',
    release: 'icons@1.2.3',
    asset: 'icons-bundle.tar.gz',
    sha256: '4e5bb546c9d3ab0c2bbacc22857467bf415f742a34c2be9dd138779d2fc066f9',
    entry: 'icon-tool.js',
    dirName: 'icons',
  },
  {
    id: '7zip',
    env: 'ELECTRON_BUILDER_7ZIP_PATH',
    release: '7zip@1.0.0',
    asset: '7zip-darwin-arm64.tar.gz',
    sha256: '496a341abe210aae1a25bc202ee97f6de6c76a3dc80f91d96616be05502d72c1',
    entry: '7zip/bin/7za',
    dirName: '7zip',
  },
];

function download(url, target) {
  execFileSync('curl', ['-sL', '-o', target, url], { stdio: 'inherit' });
}

function verify(file, expected) {
  const digest = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (digest !== expected) {
    throw new Error(`checksum mismatch for ${file}: expected ${expected}, got ${digest}`);
  }
}

mkdirSync(cacheDir, { recursive: true });

for (const tool of TOOLSETS) {
  const target = join(cacheDir, tool.dirName);
  const entry = join(target, tool.entry);

  if (existsSync(entry)) {
    console.log(`[marmot] ${tool.id} toolset already prepared.`);
    continue;
  }

  const tarball = join(cacheDir, tool.asset);
  const url = `https://github.com/electron-userland/electron-builder-binaries/releases/download/${encodeURIComponent(tool.release)}/${tool.asset}`;

  console.log(`[marmot] downloading the ${tool.id} toolset…`);
  download(url, tarball);
  verify(tarball, tool.sha256);

  mkdirSync(target, { recursive: true });
  execFileSync('tar', ['-xzf', tarball, '-C', target], { stdio: 'inherit' });

  if (!existsSync(entry)) {
    throw new Error(`the ${tool.id} toolset is missing ${entry}`);
  }
  if (tool.id === '7zip') {
    execFileSync('chmod', ['+x', entry]);
  }

  console.log(`[marmot] ${tool.id} toolset ready at ${target}`);
}

// Print the variables so a caller can pick them up.
for (const tool of TOOLSETS) {
  const target = join(cacheDir, tool.dirName);
  const value = tool.id === '7zip' ? join(target, tool.entry) : target;
  console.log(`${tool.env}=${value}`);
}
