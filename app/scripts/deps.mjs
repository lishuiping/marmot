// Installs the project's dependencies on the first build.
// Craft Anything runs `npm run build`; this prebuild step makes a fresh
// checkout self-contained without needing a separate install command.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
// The script lives in scripts/, but the project root and node_modules are one
// level up — resolve them from the script's own location.
const projectRoot = dirname(root);
const required = [
  'react',
  'react-dom',
  'katex',
  'esbuild',
  'typescript',
  'electron',
  '@types/react',
];

const missing = required.filter((p) => !existsSync(join(projectRoot, 'node_modules', p, 'package.json')));
if (missing.length === 0) process.exit(0);

console.log(`[marmot] installing ${missing.length} missing dependencies…`);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npm, ['install', '--no-audit', '--no-fund'], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: process.env,
});
process.exit(result.status ?? 1);
