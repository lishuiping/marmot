import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('marmot', {
  platform: process.platform,
  version: process.versions.electron,

  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  readFile: (path: string) => ipcRenderer.invoke('fs:readFile', path),
  readTree: (path: string) => ipcRenderer.invoke('fs:readTree', path),
  flattenMarkdown: (path: string) => ipcRenderer.invoke('fs:flattenMarkdown', path),
  writeFile: (path: string, content: string) =>
    ipcRenderer.invoke('fs:writeFile', path, content),
  saveFile: (request: unknown) => ipcRenderer.invoke('dialog:saveFile', request),
  exportHtml: (request: unknown) => ipcRenderer.invoke('dialog:exportHtml', request),
  pickImage: () => ipcRenderer.invoke('dialog:pickImage'),
  revealPath: (path: string) => ipcRenderer.invoke('shell:reveal', path),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  saveImageFromClipboard: (data: string, name: string, directory: string | null) =>
    ipcRenderer.invoke('image:saveClipboard', data, name, directory),
  setZoom: (factor: number) => ipcRenderer.invoke('app:setZoom', factor),
  windowControl: (action: 'minimize' | 'maximize' | 'close') =>
    ipcRenderer.send('win:control', action),

  onMenu: (callback: (command: string) => void) => {
    const listener = (_event: unknown, command: string) => callback(command);
    ipcRenderer.on('menu:command', listener);
    return () => ipcRenderer.removeListener('menu:command', listener);
  },

  onOpenPaths: (callback: (paths: string[]) => void) => {
    const listener = (_event: unknown, paths: string[]) => callback(paths);
    ipcRenderer.on('app:openPaths', listener);
    return () => ipcRenderer.removeListener('app:openPaths', listener);
  },

  pathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
});
