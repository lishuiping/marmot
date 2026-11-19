// Makes sure the electron-builder helper binary is runnable.
//
// app-builder-bin ships its binaries inside the npm package, but the
// executable bit is not always preserved when the package is installed or
// extracted. Without it electron-builder cannot convert the application icon,
// so every Windows and Linux build fails at the icon step with a confusing
// "No such file or directory" error.
//
// Run with: node scripts/fix-app-builder-bin.mjs
import { chmodSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(here);
const binDir = join(projectRoot, 'node_modules', 'app-builder-bin');

if (!existsSync(binDir)) {
  console.log('[marmot] app-builder-bin is not installed; nothing to fix.');
  process.exit(0);
}

const candidates = [
  join(binDir, 'mac', 'app-builder_arm64'),
  join(binDir, 'mac', 'app-builder_amd64'),
  join(binDir, 'win', 'x64', 'app-builder.exe'),
  join(binDir, 'win', 'ia32', 'app-builder.exe'),
  join(binDir, 'linux', 'x64', 'app-builder'),
  join(binDir, 'linux', 'arm64', 'app-builder'),
  join(binDir, 'linux', 'armv7l', 'app-builder'),
];

let fixed = 0;
for (const file of candidates) {
  if (!existsSync(file)) continue;
  const mode = statSync(file).mode;
  const isWindowsBinary = file.endsWith('.exe');
  // Windows binaries are not executable on macOS or Linux, so leave them be.
  if (isWindowsBinary) continue;
  if (mode & 0o111) continue;
  chmodSync(file, 0o755);
  console.log(`[marmot] made ${file.replace(projectRoot + '/', '')} executable.`);
  fixed += 1;
}

if (fixed === 0) {
  console.log('[marmot] app-builder-bin binaries are already executable.');
}
