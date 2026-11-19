export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  size?: number;
}

export interface OpenFolderResult {
  path: string;
  tree: FileNode;
}

export interface SaveRequest {
  defaultPath: string;
  content: string;
  filters?: { name: string; extensions: string[] }[];
}

export interface PaperAPI {
  platform: string;
  version: string;
  openFile(): Promise<{ path: string; content: string } | null>;
  openFolder(): Promise<OpenFolderResult | null>;
  readFile(path: string): Promise<string>;
  readTree(path: string): Promise<FileNode>;
  flattenMarkdown(path: string): Promise<FileNode[]>;
  writeFile(path: string, content: string): Promise<boolean>;
  saveFile(request: SaveRequest): Promise<string | null>;
  exportHtml(request: SaveRequest): Promise<string | null>;
  pickImage(): Promise<string | null>;
  revealPath(path: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  saveImageFromClipboard(data: string, suggestedName: string, directory: string | null): Promise<string | null>;
  setZoom(factor: number): Promise<void>;
  windowControl(action: 'minimize' | 'maximize' | 'close'): void;
  onMenu(callback: (command: string) => void): () => void;
  onOpenPaths(callback: (paths: string[]) => void): () => void;
  pathForFile(file: File): string;
}

declare global {
  interface Window {
    marmot: PaperAPI;
  }
}
