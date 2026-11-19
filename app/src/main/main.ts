import { app, BrowserWindow, Menu, dialog, ipcMain, protocol, net, shell, clipboard } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { FileNode, SaveRequest } from '../shared/types';

const isMac = process.platform === 'darwin';
const APP_NAME = 'Marmot';

// ---------------------------------------------------------------------------
// Runtime guard
// ---------------------------------------------------------------------------
// Some launchers inherit ELECTRON_RUN_AS_NODE=1. The Electron binary then runs
// this file as a plain Node script: require('electron') returns the path to the
// binary (a string), so `app` is undefined and startup throws. Relaunch through
// the real Electron runtime once, with that variable removed.
// ---------------------------------------------------------------------------

function ensureElectronRuntime(): void {
  const electronExport: unknown = require('electron');
  if (typeof electronExport !== 'string') return;

  const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
  const appRoot = path.resolve(__dirname, '..');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  delete env.NODE_OPTIONS;

  process.stderr.write('[marmot] relaunching under Electron (ELECTRON_RUN_AS_NODE was set)\n');
  const result = spawnSync(electronExport, [appRoot, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
  });
  if (result.error) {
    process.stderr.write(`[marmot] could not relaunch Electron: ${String(result.error)}\n`);
    process.exit(1);
  }
  if (result.signal) process.kill(process.pid, result.signal);
  process.exit(result.status ?? 1);
}

ensureElectronRuntime();

// ---------------------------------------------------------------------------
// Command line: --screenshot <file.png>
// ---------------------------------------------------------------------------

function readScreenshotArg(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--screenshot') {
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) return path.resolve(process.cwd(), next);
      return path.resolve(process.cwd(), 'marmot-shot.png');
    }
    if (arg.startsWith('--screenshot=')) {
      const value = arg.slice('--screenshot='.length);
      if (value) return path.resolve(process.cwd(), value);
    }
  }
  return null;
}

const screenshotPath = readScreenshotArg(process.argv.slice(1));
const shotMode = screenshotPath !== null;

if (shotMode) {
  // Never let Chromium throttle a window that isn't focused; otherwise the
  // captured frame can be stale or empty. These must be set before app ready.
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  // Screenshot runs happen inside a check harness that can block Chromium's
  // own process sandbox ("sandbox initialization failed"). The check only has
  // to paint one frame of trusted local HTML, so skip Chromium's OS sandbox and
  // render with software here. A normal launch keeps both.
  process.env.ELECTRON_DISABLE_SANDBOX = '1';
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.disableHardwareAcceleration();
}

app.setName(APP_NAME);

// ---------------------------------------------------------------------------
// Local image protocol
// ---------------------------------------------------------------------------

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'marmot',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

function registerLocalFileProtocol(): void {
  protocol.handle('marmot', async (request) => {
    try {
      const url = new URL(request.url);
      const filePath = url.searchParams.get('path');
      if (!filePath) return new Response('Not found', { status: 404 });
      const resolved = path.resolve(filePath);
      return net.fetch(pathToFileURL(resolved).toString());
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

// ---------------------------------------------------------------------------
// File tree
// ---------------------------------------------------------------------------

const IGNORED = new Set([
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  '.DS_Store',
  'dist',
  'build',
  '.next',
  '.cache',
]);

const MARKDOWN_EXT = /\.(md|markdown|mdown|mkd|mdx|txt)$/i;

async function readTree(root: string, depth = 0): Promise<FileNode> {
  const base: FileNode = {
    name: path.basename(root) || root,
    path: root,
    type: 'directory',
    children: [],
  };
  if (depth > 8) return base;

  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return base;
  }

  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });

  for (const entry of entries.slice(0, 500)) {
    if (entry.name.startsWith('.') || IGNORED.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const child = await readTree(full, depth + 1);
      if (child.children && child.children.length) base.children!.push(child);
    } else if (entry.isFile()) {
      let size = 0;
      try {
        size = (await fs.stat(full)).size;
      } catch {
        /* ignore */
      }
      base.children!.push({
        name: entry.name,
        path: full,
        type: 'file',
        size,
      });
    }
  }
  return base;
}

function flattenMarkdown(root: FileNode): FileNode[] {
  const out: FileNode[] = [];
  const walk = (node: FileNode) => {
    if (node.type === 'file' && MARKDOWN_EXT.test(node.name)) out.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return out;
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

function send(command: string): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  win?.webContents.send('menu:command', command);
}

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [];

  if (isMac) {
    template.push({
      label: APP_NAME,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: '检查更新…', enabled: false },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  template.push({
    label: '文件',
    submenu: [
      { label: '新建文件', accelerator: 'CmdOrCtrl+N', click: () => send('file.new') },
      { label: '打开文件…', accelerator: 'CmdOrCtrl+O', click: () => send('file.open') },
      {
        label: '打开文件夹…',
        accelerator: 'CmdOrCtrl+Shift+O',
        click: () => send('file.openFolder'),
      },
      { type: 'separator' },
      { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => send('file.save') },
      {
        label: '另存为…',
        accelerator: 'CmdOrCtrl+Shift+S',
        click: () => send('file.saveAs'),
      },
      { label: '导出 HTML…', click: () => send('file.exportHtml') },
      { type: 'separator' },
      { label: '关闭标签页', accelerator: 'CmdOrCtrl+W', click: () => send('file.closeTab') },
      ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const }]),
    ],
  });

  template.push({
    label: '编辑',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
      { type: 'separator' },
      { label: '查找与替换…', accelerator: 'CmdOrCtrl+F', click: () => send('find.open') },
      { label: '快速打开…', accelerator: 'CmdOrCtrl+P', click: () => send('quick.open') },
    ],
  });

  template.push({
    label: '格式',
    submenu: [
      { label: '加粗', accelerator: 'CmdOrCtrl+B', click: () => send('format.bold') },
      { label: '斜体', accelerator: 'CmdOrCtrl+I', click: () => send('format.italic') },
      {
        label: '删除线',
        accelerator: 'CmdOrCtrl+Shift+X',
        click: () => send('format.strike'),
      },
      { label: '高亮', accelerator: 'CmdOrCtrl+Shift+H', click: () => send('format.highlight') },
      { label: '行内代码', accelerator: 'CmdOrCtrl+E', click: () => send('format.code') },
      { type: 'separator' },
      { label: '链接', accelerator: 'CmdOrCtrl+K', click: () => send('format.link') },
      { label: '图片…', click: () => send('format.image') },
      { label: '表格', click: () => send('format.table') },
      { label: '代码块', accelerator: 'CmdOrCtrl+Shift+C', click: () => send('format.codeblock') },
      { label: '数学块', accelerator: 'CmdOrCtrl+Shift+M', click: () => send('format.math') },
      { type: 'separator' },
      { label: '引用', click: () => send('format.quote') },
      { label: '无序列表', click: () => send('format.ul') },
      { label: '有序列表', click: () => send('format.ol') },
      { label: '任务列表', click: () => send('format.task') },
      { type: 'separator' },
      { label: '一级标题', click: () => send('format.h1') },
      { label: '二级标题', click: () => send('format.h2') },
      { label: '三级标题', click: () => send('format.h3') },
      { label: '正文', click: () => send('format.p') },
    ],
  });

  template.push({
    label: '视图',
    submenu: [
      {
        label: '偏好设置…',
        accelerator: 'CmdOrCtrl+,',
        click: () => send('view.preferences'),
      },
      { type: 'separator' },
      { label: '切换侧栏', accelerator: 'CmdOrCtrl+Shift+L', click: () => send('view.sidebar') },
      { label: '源码模式', accelerator: 'CmdOrCtrl+/', click: () => send('view.source') },
      {
        label: '专注模式',
        accelerator: 'CmdOrCtrl+Shift+F',
        click: () => send('view.focus'),
      },
      { label: '打字机模式', click: () => send('view.typewriter') },
      { type: 'separator' },
      { label: '主题：明亮', click: () => send('view.theme.light') },
      { label: '主题：夜色', click: () => send('view.theme.dark') },
      { label: '主题：纸墨', click: () => send('view.theme.sepia') },
      { type: 'separator' },
      { label: '放大', accelerator: 'CmdOrCtrl+Plus', click: () => send('view.zoomIn') },
      { label: '缩小', accelerator: 'CmdOrCtrl+-', click: () => send('view.zoomOut') },
      { label: '实际大小', accelerator: 'CmdOrCtrl+0', click: () => send('view.zoomReset') },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      ...(isMac ? [] : [{ role: 'toggleDevTools' as const }]),
    ],
  });

  template.push({
    label: '帮助',
    submenu: [
      { label: '欢迎与说明', click: () => send('help.welcome') },
      { label: '关于 Marmot', click: () => send('help.about') },
      {
        label: '为什么完全免费',
        click: () => send('help.free'),
      },
    ],
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 760,
    minHeight: 520,
    show: false,
    focusable: !shotMode,
    skipTaskbar: shotMode,
    backgroundColor: '#ffffff',
    title: APP_NAME,
    icon: isMac ? undefined : path.join(__dirname, 'marmot.icns'),
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 15, y: 15 } : undefined,
    autoHideMenuBar: !isMac,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
      backgroundThrottling: false,
    },
  });

  // The renderer entry is emitted next to the bundles in dist/.
  win.loadFile(path.join(__dirname, 'index.html'), {
    query: shotMode ? { shot: '1' } : undefined,
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (/^https?:/i.test(url)) void shell.openExternal(url);
    }
  });

  win.once('ready-to-show', () => {
    if (shotMode) {
      // Show without stealing focus; the page keeps painting because
      // backgroundThrottling is off and Chromium's backgrounding switches are
      // disabled above. On Windows keep the normal z-order (behind whatever is
      // already there) instead of raising the window.
      if (process.platform === 'win32') win.setAlwaysOnTop(false);
      win.showInactive();
      if (process.platform === 'win32') win.blur();
    } else {
      win.show();
      win.focus();
    }
  });

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  return win;
}

async function captureAndQuit(win: BrowserWindow, target: string): Promise<void> {
  try {
    // Make sure the window is on screen but not focused. This also covers the
    // case where did-finish-load fired before ready-to-show.
    if (process.platform === 'win32') win.setAlwaysOnTop(false);
    if (!win.isVisible()) win.showInactive();

    await win.webContents.executeJavaScript(
      `(async () => {
         try {
           if (document.fonts && document.fonts.ready) await document.fonts.ready;
         } catch (error) {
           /* fonts are best effort */
         }
         const readyBy = Date.now() + 5000;
         while (!document.documentElement.dataset.ready && Date.now() < readyBy) {
           await new Promise((resolve) => setTimeout(resolve, 50));
         }
         await Promise.race([
           new Promise((resolve) => {
             let frames = 0;
             const tick = () => {
               frames += 1;
               if (frames >= 120) resolve(true);
               else requestAnimationFrame(tick);
             };
             requestAnimationFrame(tick);
           }),
           new Promise((resolve) => setTimeout(resolve, 8000)),
         ]);
         return true;
       })()`,
      true,
    );

    await new Promise((r) => setTimeout(r, 300));

    let image = await win.webContents.capturePage();
    for (let attempt = 0; attempt < 4 && image.isEmpty(); attempt += 1) {
      await new Promise((r) => setTimeout(r, 250));
      image = await win.webContents.capturePage();
    }
    if (image.isEmpty()) throw new Error('capturePage returned an empty image');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, image.toPNG());
    process.stdout.write(`SCREENSHOT_SAVED:${target}\n`);
    app.exit(0);
  } catch (error) {
    process.stderr.write(`SCREENSHOT_FAILED:${String(error)}\n`);
    app.exit(1);
  }
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function registerIpc(): void {
  ipcMain.handle('dialog:openFile', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const result = await dialog.showOpenDialog(win!, {
      title: '打开 Markdown 文件',
      properties: ['openFile'],
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mdx', 'txt'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    const content = await fs.readFile(filePath, 'utf8');
    return { path: filePath, content };
  });

  ipcMain.handle('dialog:openFolder', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const result = await dialog.showOpenDialog(win!, {
      title: '打开文件夹',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const root = result.filePaths[0];
    return { path: root, tree: await readTree(root) };
  });

  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    return fs.readFile(filePath, 'utf8');
  });

  ipcMain.handle('fs:readTree', async (_event, root: string) => {
    return readTree(root);
  });

  ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
    return true;
  });

  ipcMain.handle('dialog:saveFile', async (_event, request: SaveRequest) => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const result = await dialog.showSaveDialog(win!, {
      title: '保存 Markdown',
      defaultPath: request.defaultPath,
      filters: request.filters ?? [
        { name: 'Markdown', extensions: ['md'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePath) return null;
    await fs.mkdir(path.dirname(result.filePath), { recursive: true });
    await fs.writeFile(result.filePath, request.content, 'utf8');
    return result.filePath;
  });

  ipcMain.handle('dialog:exportHtml', async (_event, request: SaveRequest) => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const result = await dialog.showSaveDialog(win!, {
      title: '导出 HTML',
      defaultPath: request.defaultPath,
      filters: [{ name: 'HTML', extensions: ['html'] }],
    });
    if (result.canceled || !result.filePath) return null;
    await fs.mkdir(path.dirname(result.filePath), { recursive: true });
    await fs.writeFile(result.filePath, request.content, 'utf8');
    return result.filePath;
  });

  ipcMain.handle('dialog:pickImage', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const result = await dialog.showOpenDialog(win!, {
      title: '选择图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('shell:reveal', async (_event, filePath: string) => {
    if (existsSync(filePath)) shell.showItemInFolder(filePath);
  });

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    if (/^https?:\/\//i.test(url)) await shell.openExternal(url);
  });

  ipcMain.handle(
    'image:saveClipboard',
    async (_event, dataUrl: string, suggestedName: string, directory: string | null) => {
      const match = /^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/i.exec(dataUrl);
      if (!match) return null;
      const base = directory ?? app.getPath('pictures');
      const target = path.join(base, suggestedName);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, Buffer.from(match[2], 'base64'));
      return target;
    },
  );

  ipcMain.handle('app:setZoom', async (event, factor: number) => {
    const contents = event.sender;
    contents.setZoomFactor(Math.min(2, Math.max(0.6, factor)));
  });

  ipcMain.handle('clipboard:readText', async () => clipboard.readText());
}

ipcMain.on('win:control', (event, action: 'minimize' | 'maximize' | 'close') => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (action === 'minimize') win.minimize();
  else if (action === 'close') win.close();
  else {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  }
});

// Expose the file list helper for the renderer's sidebar search.
ipcMain.handle('fs:flattenMarkdown', async (_event, root: string) => {
  const tree = await readTree(root);
  return flattenMarkdown(tree);
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  registerLocalFileProtocol();
  registerIpc();
  buildMenu();

  mainWindow = createWindow();

  if (shotMode && screenshotPath) {
    // Give the window a hard deadline so a broken renderer cannot hang a check.
    const guard = setTimeout(() => {
      process.stderr.write('SCREENSHOT_FAILED:timeout\n');
      app.exit(1);
    }, 20000);
    mainWindow.webContents.once('did-finish-load', () => {
      void captureAndQuit(mainWindow!, screenshotPath).finally(() => clearTimeout(guard));
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (!isMac || shotMode) app.quit();
});
