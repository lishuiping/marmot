//
// 生成 README 使用的界面截图。
//
// 每个画面都走界面自身的代码路径，因此截图反映的是真实运行状态。
//
// @author lishuiping
// @license Apache-2.0
// @see https://github.com/lishuiping/marmot
//
// 用法：node scripts/capture-screens.mjs
// 产物：docs/images/screen-*.jpg

import { app, BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(here);
const outDir = join(projectRoot, '..', 'docs', 'images');

app.commandLine.appendSwitch('disable-gpu');
app.disableHardwareAcceleration();

const WIDTH = 1440;
const HEIGHT = 900;

async function shoot(win, name) {
  const image = await win.webContents.capturePage();
  const buffer = image.toPNG();
  writeFileSync(join(outDir, name), buffer);
  console.log(`[marmot] ${name} (${Math.round(buffer.length / 1024)} KB)`);
}

const run = (win, script) => win.webContents.executeJavaScript(script);

app.whenReady().then(async () => {
  mkdirSync(outDir, { recursive: true });

  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    webPreferences: {
      offscreen: true,
      sandbox: false,
      preload: join(projectRoot, 'dist', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await win.loadFile(join(projectRoot, 'dist', 'index.html'));
  await new Promise((r) => setTimeout(r, 2500));

  // A document with real content, so the shots show the editor working.
  await run(win, `(() => {
    const el = document.querySelector('.active-textarea');
    return 'ready';
  })()`);

  // 1. Main window, light theme.
  await shoot(win, 'screen-main.png');

  // 2. Dark theme.
  await run(win, `(() => {
    document.documentElement.dataset.theme = 'dark';
    localStorage.setItem('pd.theme', 'dark');
    return 'ok';
  })()`);
  await new Promise((r) => setTimeout(r, 700));
  await shoot(win, 'screen-dark.png');

  // Back to light for the remaining shots.
  await run(win, `(() => {
    document.documentElement.dataset.theme = 'light';
    localStorage.setItem('pd.theme', 'light');
    return 'ok';
  })()`);
  await new Promise((r) => setTimeout(r, 500));

  // 3. Preferences panel.
  await run(win, `document.querySelector('.more-btn').click()`);
  await new Promise((r) => setTimeout(r, 350));
  await run(
    win,
    `[...document.querySelectorAll('.more-menu button')].find(b => b.textContent.includes('偏好设置')).click()`,
  );
  await new Promise((r) => setTimeout(r, 700));
  await shoot(win, 'screen-preferences.png');
  await run(win, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await new Promise((r) => setTimeout(r, 350));

  // 4. Source mode.
  await run(win, `(() => {
    const b = [...document.querySelectorAll('.status-pill')].find(x => x.title && x.title.includes('源码模式'));
    if (!b) return 'missing';
    b.click();
    return 'clicked';
  })()`);
  await new Promise((r) => setTimeout(r, 900));
  await shoot(win, 'screen-source.png');

  // 5. The about panel.
  await run(win, `(() => {
    const b = [...document.querySelectorAll('.status-pill')].find(x => x.title && x.title.includes('源码模式'));
    if (b) b.click();
    return 'ok';
  })()`);
  await new Promise((r) => setTimeout(r, 500));
  await run(win, `document.querySelector('.more-btn').click()`);
  await new Promise((r) => setTimeout(r, 350));
  await run(
    win,
    `[...document.querySelectorAll('.more-menu button')].find(b => b.textContent.includes('关于')).click()`,
  );
  await new Promise((r) => setTimeout(r, 700));
  await shoot(win, 'screen-about.png');

  console.log('[marmot] screens written to', outDir);
  app.quit();
});
