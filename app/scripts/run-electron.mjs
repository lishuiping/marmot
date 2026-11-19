//
// 以干净环境启动本地安装的 Electron。
//
// 某些终端会导出 ELECTRON_RUN_AS_NODE=1，会让 Electron 退化成纯 Node，这里要清掉。
//
// @author lishuiping
// @license Apache-2.0
// @see https://github.com/lishuiping/marmot

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const electron = require('electron');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ATTACH_CONSOLE;
delete env.NODE_OPTIONS;

const child = spawn(electron, [projectRoot, ...process.argv.slice(2)], {
  cwd: projectRoot,
  env,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
child.on('error', (error) => {
  console.error('[marmot] could not start Electron:', error);
  process.exit(1);
});
