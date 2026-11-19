/**
 * 主界面：编辑器状态、文件树与大纲侧栏、查找替换、偏好设置、关于面板等全部交互。
 *
 * @author lishuiping
 * @license Apache-2.0
 * @see https://github.com/lishuiping/marmot
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FileNode } from '../shared/types';
import {
  ActiveEditor,
  BlockView,
  countWords,
  documentTitle,
  makeBlock,
  outlineFromBlocks,
  parseDocument,
  serializeDocument,
  classifyBlock,
} from './markdown';
import type { Block, EditorContext, OutlineItem } from './markdown';

// File.DEFAULT_OPTIONS in the original (main.js module "3b"):
// wordsPerMinute = 382, indentSize = 2, codeIndentSize = 4.
const WORDS_PER_MINUTE = 382;
const WORD_METRICS = ['字', '字符', '行', '分钟'] as const;

// ---------------------------------------------------------------------------
// Sample document and small helpers
// ---------------------------------------------------------------------------

const WELCOME = [
  '# 让写作回到文字本身',
  '',
  'Marmot 是一个**完全免费**、无需激活码的 Markdown 编辑器。打开就能写，写完仍然是一份干净的 Markdown 文件。',
  '',
  '> 好的写作工具，应该安静地退到文字背后。',
  '',
  '## 今天可以写点什么',
  '',
  '- 一个还没有结尾的故事',
  '- 给未来的自己的一封信',
  '- 一份只给自己看的清单',
  '',
  '## 实时渲染',
  '',
  '光标停在哪个段落，哪个段落就展开 Markdown 标记；移开之后，它又变回排版好的样子。',
  '',
  '### 代码、表格与公式',
  '',
  '```ts',
  'function greet(name: string) {',
  '  return `你好，${name}！`;',
  '}',
  '```',
  '',
  '| 功能 | 快捷键 | 说明 |',
  '| --- | --- | --- |',
  '| 加粗 | ⌘ B | 让一句话更有分量 |',
  '| 查找 | ⌘ F | 在长文里快速定位 |',
  '| 源码 | ⌘ / | 查看原始 Markdown |',
  '',
  '行内公式 $E = mc^2$，块级公式也一样：',
  '',
  '$$',
  '\\int_0^1 x^2\\,dx = \\frac{1}{3}',
  '$$',
  '',
  '- [x] 打开 Marmot',
  '- [ ] 写下第一句话',
  '- [ ] 把今天留在这里',
  '',
  '---',
  '',
  '*免费 · 无需账户 · 文字只保存在你的电脑上*',
].join('\n');

type Theme = 'light' | 'dark' | 'sepia';

interface Doc {
  id: string;
  path: string | null;
  name: string;
  blocks: Block[];
  savedText: string;
}

let docCounter = 1;
const uid = () => `doc-${Date.now().toString(36)}-${docCounter++}`;

function makeDoc(content: string, path: string | null, name: string): Doc {
  return {
    id: uid(),
    path,
    name,
    blocks: parseDocument(content),
    savedText: content,
  };
}

function makeWelcomeDoc(): Doc {
  return makeDoc(WELCOME, null, '欢迎使用.md');
}

function makeEmptyDoc(): Doc {
  return makeDoc('', null, '未命名.md');
}

function baseName(p: string): string {
  const clean = p.replace(/\\/g, '/').replace(/\/+$/, '');
  const at = clean.lastIndexOf('/');
  return at >= 0 ? clean.slice(at + 1) : clean;
}

function dirName(p: string): string {
  const clean = p.replace(/\\/g, '/');
  const at = clean.lastIndexOf('/');
  return at > 0 ? clean.slice(0, at) : at === 0 ? '/' : '';
}

function joinPath(dir: string, rel: string): string {
  if (!dir) return rel;
  if (/^([A-Za-z]:)?[\\/]/.test(rel)) return rel;
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  return dir.replace(/[\\/]+$/, '') + sep + rel.replace(/^[\\/]+/, '');
}

function relativePath(fromDir: string, target: string): string {
  const from = fromDir.replace(/\\/g, '/').split('/').filter(Boolean);
  const to = target.replace(/\\/g, '/').split('/').filter(Boolean);
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i += 1;
  const up = from.slice(i).map(() => '..');
  const down = to.slice(i);
  const joined = [...up, ...down].join('/');
  return joined || baseName(target);
}

function imageUrl(absPath: string): string {
  return `marmot://local?path=${encodeURIComponent(absPath)}`;
}

function isMarkdown(path: string): boolean {
  return /\.(md|markdown|mdown|mkd|mdx|txt)$/i.test(path);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function readLocalString(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function readLocalNumber(key: string, fallback: number): number {
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return fallback;
  }
  // A missing key gives Number(null) === 0, which is finite but wrong; fall
  // back to the default instead of silently reading 0.
  if (raw === null || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

// Same as readLocalNumber, but also rejects a stored value outside the range
// the control can represent. Earlier versions wrote 0 back for unset keys, so
// a stored 0 must not win over the default.
function readLocalNumberInRange(key: string, fallback: number, min: number, max: number): number {
  const value = readLocalNumber(key, fallback);
  if (value < min || value > max) return fallback;
  return value;
}

// Font stacks offered by the preferences panel.
const FONT_FAMILIES: Record<string, string> = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  serif: 'Georgia, "Songti SC", "SimSun", serif',
  mono: '"SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
};

function readLocalJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function collectFiles(node: FileNode | null): FileNode[] {
  if (!node) return [];
  const out: FileNode[] = [];
  const walk = (n: FileNode) => {
    if (n.type === 'file' && isMarkdown(n.name)) out.push(n);
    n.children?.forEach(walk);
  };
  walk(node);
  return out;
}

function findMatches(text: string, query: string, caseSensitive: boolean) {
  const out: { start: number; end: number }[] = [];
  if (!query) return out;
  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  let at = hay.indexOf(needle);
  while (at >= 0 && out.length < 5000) {
    out.push({ start: at, end: at + needle.length });
    at = hay.indexOf(needle, at + Math.max(1, needle.length));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

type IconName =
  | 'panel'
  | 'search'
  | 'plus'
  | 'folder'
  | 'chevron'
  | 'file'
  | 'close'
  | 'more'
  | 'sun'
  | 'moon'
  | 'book'
  | 'focus'
  | 'typewriter'
  | 'code'
  | 'link'
  | 'image'
  | 'table'
  | 'quote'
  | 'ul'
  | 'ol'
  | 'task'
  | 'download'
  | 'check'
  | 'external'
  | 'minimize'
  | 'maximize'
  | 'menu'
  | 'sparkle';

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (name) {
    case 'panel':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9.5 4v16" />
        </svg>
      );
    case 'search':
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4" />
        </svg>
      );
    case 'plus':
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case 'folder':
      return (
        <svg {...common}>
          <path d="M3.5 7.5h6l1.7 2h9.2v8.2a1.8 1.8 0 0 1-1.8 1.8H5.3a1.8 1.8 0 0 1-1.8-1.8Z" />
          <path d="M3.5 9.5V6.3c0-1 .8-1.8 1.8-1.8h3.4l1.7 2h6.3" />
        </svg>
      );
    case 'chevron':
      return (
        <svg {...common}>
          <path d="m9 6 6 6-6 6" />
        </svg>
      );
    case 'file':
      return (
        <svg {...common}>
          <path d="M6 3.5h7l5 5V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 20V5a1.5 1.5 0 0 1 1.5-1.5Z" />
          <path d="M13 3.5V9h5" />
        </svg>
      );
    case 'close':
      return (
        <svg {...common}>
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      );
    case 'more':
      return (
        <svg {...common}>
          <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'menu':
      return (
        <svg {...common}>
          <path d="M4 7h16M4 12h16M4 17h10" />
        </svg>
      );
    case 'sun':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      );
    case 'moon':
      return (
        <svg {...common}>
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
        </svg>
      );
    case 'book':
      return (
        <svg {...common}>
          <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5Z" />
          <path d="M4 18.5V5.5M8 7.5h8M8 11h6" />
        </svg>
      );
    case 'focus':
      return (
        <svg {...common}>
          <path d="M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case 'typewriter':
      return (
        <svg {...common}>
          <path d="M4 6h16M4 10h10M4 14h16M4 18h7" />
          <path d="M17 16v5" strokeWidth="2.4" />
        </svg>
      );
    case 'code':
      return (
        <svg {...common}>
          <path d="m8 7-4 5 4 5M16 7l4 5-4 5M13 5l-2 14" />
        </svg>
      );
    case 'link':
      return (
        <svg {...common}>
          <path d="m9.5 14.5 5-5" />
          <path d="M7 17a3.5 3.5 0 0 1 0-5l2-2a3.5 3.5 0 0 1 5 0" />
          <path d="M17 7a3.5 3.5 0 0 1 0 5l-2 2a3.5 3.5 0 0 1-5 0" />
        </svg>
      );
    case 'image':
      return (
        <svg {...common}>
          <rect x="3" y="4.5" width="18" height="15" rx="2" />
          <circle cx="8.5" cy="10" r="1.6" />
          <path d="m5 17 5-5 4 4 2-2 3 3" />
        </svg>
      );
    case 'table':
      return (
        <svg {...common}>
          <rect x="3" y="4.5" width="18" height="15" rx="1.8" />
          <path d="M3 9.5h18M3 14.5h18M9 4.5v15M15 4.5v15" />
        </svg>
      );
    case 'quote':
      return (
        <svg {...common} fill="currentColor" stroke="none">
          <path d="M9.5 6.5c-2.5 1.1-4 3.2-4 6.1 0 2.7 1.4 4.5 3.5 4.5 1.8 0 3.1-1.3 3.1-3.1 0-1.7-1.2-3-2.8-3-.3 0-.6 0-.8.1.3-1.3 1.1-2.3 2.4-3.1ZM19 6.5c-2.5 1.1-4 3.2-4 6.1 0 2.7 1.4 4.5 3.5 4.5 1.8 0 3.1-1.3 3.1-3.1 0-1.7-1.2-3-2.8-3-.3 0-.6 0-.8.1.3-1.3 1.1-2.3 2.4-3.1Z" />
        </svg>
      );
    case 'ul':
      return (
        <svg {...common}>
          <path d="M9 6h11M9 12h11M9 18h11" />
          <circle cx="4.2" cy="6" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="4.2" cy="12" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="4.2" cy="18" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'ol':
      return (
        <svg {...common}>
          <path d="M10 6h10M10 12h10M10 18h10" />
          <path d="M4 5h1v3M3.5 8.5h2M3.5 11.5h2l-2 3h2M3.5 17h2v1.5h-1M3.5 20.5h2" />
        </svg>
      );
    case 'task':
      return (
        <svg {...common}>
          <rect x="3.5" y="4.5" width="7" height="7" rx="1.2" />
          <path d="m5.4 8 1.4 1.4L9 6.7M14 8h7M3.5 16h5M14 16h7" />
        </svg>
      );
    case 'download':
      return (
        <svg {...common}>
          <path d="M12 3v11M7.5 10 12 14.5 16.5 10M4 18v2h16v-2" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common}>
          <path d="m5 12.5 4.5 4.5L19 6.5" />
        </svg>
      );
    case 'external':
      return (
        <svg {...common}>
          <path d="M14 4h6v6M20 4l-9 9" />
          <path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4" />
        </svg>
      );
    case 'minimize':
      return (
        <svg {...common}>
          <path d="M5 12h14" />
        </svg>
      );
    case 'maximize':
      return (
        <svg {...common}>
          <rect x="5" y="5" width="14" height="14" rx="1" />
        </svg>
      );
    case 'sparkle':
      return (
        <svg {...common}>
          <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
        </svg>
      );
    default:
      return null;
  }
}

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === 'light') return <Icon name="sun" />;
  if (theme === 'dark') return <Icon name="moon" />;
  return <Icon name="book" />;
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function FileTreeNode({
  node,
  depth,
  activePath,
  expanded,
  onToggle,
  onOpen,
}: {
  node: FileNode;
  depth: number;
  activePath: string | null;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
}) {
  if (node.type === 'directory') {
    const open = expanded.has(node.path);
    return (
      <div className="tree-dir">
        <button
          type="button"
          className="tree-row tree-dir-row"
          style={{ paddingLeft: 10 + depth * 14 }}
          onClick={() => onToggle(node.path)}
          title={node.path}
        >
          <span className={`tree-chevron ${open ? 'open' : ''}`}>
            <Icon name="chevron" size={13} />
          </span>
          <span className="tree-icon">
            <Icon name="folder" size={15} />
          </span>
          <span className="tree-label">{node.name}</span>
        </button>
        {open && (
          <div>
            {node.children?.map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                activePath={activePath}
                expanded={expanded}
                onToggle={onToggle}
                onOpen={onOpen}
              />
            ))}
          </div>
        )}
      </div>
    );
  }
  if (!isMarkdown(node.name)) return null;
  return (
    <button
      type="button"
      className={`tree-row tree-file-row ${activePath === node.path ? 'active' : ''}`}
      style={{ paddingLeft: 26 + depth * 14 }}
      title={node.path}
      onClick={() => onOpen(node.path)}
    >
      <span className="tree-icon">
        <Icon name="file" size={15} />
      </span>
      <span className="tree-label">{node.name}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main application
// ---------------------------------------------------------------------------

export default function App() {
  const [initial] = useState(() => makeWelcomeDoc());
  const [docs, setDocs] = useState<Doc[]>([initial]);
  const [activeId, setActiveId] = useState(initial.id);
  const activeDoc = docs.find((d) => d.id === activeId) ?? docs[0];

  const [active, setActive] = useState<{ index: number; start: number; end: number } | null>(
    null,
  );
  const [sidebarOpen, setSidebarOpen] = useState(() => readLocalString('pd.sidebar', '1') !== '0');
  const [sidebarWidth, setSidebarWidth] = useState(() => readLocalNumberInRange('pd.sidebarWidth', 270, 180, 520));
  const [sidebarTab, setSidebarTab] = useState<'files' | 'outline'>('files');
  const [folder, setFolder] = useState<{ path: string; tree: FileNode } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');

  const [theme, setTheme] = useState<Theme>(() => {
    const stored = readLocalString('pd.theme', 'light');
    return stored === 'dark' || stored === 'sepia' ? stored : 'light';
  });
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceText, setSourceText] = useState(serializeDocument(initial.blocks));
  const [sourceSel, setSourceSel] = useState({ start: 0, end: 0 });
  const [focusMode, setFocusMode] = useState(false);
  const [typewriter, setTypewriter] = useState(false);

  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [findCase, setFindCase] = useState(false);
  const [findIndex, setFindIndex] = useState(0);

  const [quickOpen, setQuickOpen] = useState(false);
  const [quickQuery, setQuickQuery] = useState('');
  const [quickIndex, setQuickIndex] = useState(0);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [lowMotion, setLowMotion] = useState(false);

  // Preferences, persisted the same way as the other settings.
  const [fontSize, setFontSize] = useState(() => readLocalNumberInRange('pd.fontSize', 16, 13, 22));
  const [fontFamily, setFontFamily] = useState(() => readLocalString('pd.fontFamily', 'sans'));
  const [contentWidth, setContentWidth] = useState(() => readLocalNumberInRange('pd.contentWidth', 860, 560, 1200));
  const [showLineNumbers, setShowLineNumbers] = useState(
    () => readLocalString('pd.lineNumbers', '0') === '1',
  );
  const [wordMetric, setWordMetric] = useState(() => readLocalNumberInRange('pd.wordMetric', 0, 0, 3));
  const [autoSave, setAutoSave] = useState(() => readLocalString('pd.autoSave', '0') === '1');
  const [spellcheck, setSpellcheck] = useState(() => readLocalString('pd.spellcheck', '1') === '1');

  const [recent, setRecent] = useState<string[]>(() => readLocalJson<string[]>('pd.recent', []));
  const [zoom, setZoom] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  // github/night themes widen the column to 1024px at 1400px and 1200px at 1800px.
  const effectiveContentWidth =
    contentWidth === 860 ? (viewportWidth >= 1800 ? 1200 : viewportWidth >= 1400 ? 1024 : 860) : contentWidth;

  const sourceRef = useRef<HTMLTextAreaElement | null>(null);
  const findRef = useRef<HTMLInputElement | null>(null);
  const quickRef = useRef<HTMLInputElement | null>(null);
  const editorScrollRef = useRef<HTMLDivElement | null>(null);
  const searchTimer = useRef<number | null>(null);

  const shotMode = useMemo(
    () => new URLSearchParams(window.location.search).get('shot') === '1',
    [],
  );

  const content = sourceMode ? sourceText : serializeDocument(activeDoc.blocks);
  const words = useMemo(() => countWords(content), [content]);
  const characters = useMemo(() => content.length, [content]);
  const lineCount = useMemo(() => (content.match(/\n/g)?.length ?? 0) + 1, [content]);
  // Typora reads at 382 words per minute and rounds; under one minute it shows "≤ 1".
  const readMinutes = useMemo(
    () => (content.trim() ? Math.round(words / WORDS_PER_MINUTE) : 0),
    [content, words],
  );
  const readTimeLabel = readMinutes > 1 ? `${readMinutes}` : '≤ 1';
  const metricValue =
    wordMetric === 0 ? `${words} 字` : wordMetric === 1 ? `${characters} 字符` : wordMetric === 2 ? `${lineCount} 行` : `${readTimeLabel} 分钟`;
  const outline = useMemo(() => outlineFromBlocks(activeDoc.blocks), [activeDoc.blocks]);
  const dirty = content !== activeDoc.savedText;
  const docName = activeDoc.path ? baseName(activeDoc.path) : activeDoc.name;
  const contentRef = useRef(content);
  contentRef.current = content;
  const docRef = useRef(activeDoc);
  docRef.current = activeDoc;
  const autoSaveMaxTimer = useRef<number | null>(null);

  const allFiles = useMemo(() => collectFiles(folder?.tree ?? null), [folder]);
  const filteredFiles = useMemo(() => {
    if (!filter.trim()) return [];
    const q = filter.toLowerCase();
    return allFiles.filter((f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q));
  }, [allFiles, filter]);

  const findMatchesList = useMemo(
    () => (findOpen ? findMatches(content, findQuery, findCase) : []),
    [content, findQuery, findCase, findOpen],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('pd.theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('pd.fontSize', String(fontSize));
    localStorage.setItem('pd.fontFamily', fontFamily);
    localStorage.setItem('pd.contentWidth', String(contentWidth));
    localStorage.setItem('pd.lineNumbers', showLineNumbers ? '1' : '0');
    localStorage.setItem('pd.wordMetric', String(wordMetric));
    localStorage.setItem('pd.autoSave', autoSave ? '1' : '0');
    localStorage.setItem('pd.spellcheck', spellcheck ? '1' : '0');
  }, [fontSize, fontFamily, contentWidth, showLineNumbers, wordMetric, autoSave, spellcheck]);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    localStorage.setItem('pd.sidebar', sidebarOpen ? '1' : '0');
    localStorage.setItem('pd.sidebarWidth', String(sidebarWidth));
  }, [sidebarOpen, sidebarWidth]);

  useEffect(() => {
    localStorage.setItem('pd.recent', JSON.stringify(recent.slice(0, 12)));
  }, [recent]);

  useEffect(() => {
    document.title = `${docName}${dirty ? ' •' : ''} — Marmot`;
  }, [docName, dirty]);

  useEffect(() => {
    setActive(null);
    setSourceText(serializeDocument(activeDoc.blocks));
    setFindIndex(0);
  }, [activeId]);

  useEffect(() => {
    if (shotMode) {
      setSidebarOpen(true);
      setFocusMode(false);
      setTypewriter(false);
      setFindOpen(false);
      setQuickOpen(false);
      setAboutOpen(false);
      setMoreOpen(false);
      setTheme('light');
      setLowMotion(true);
    }
  }, [shotMode]);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => setToast(null), 2200);
  }, []);

  const updateDoc = useCallback((id: string, updater: (doc: Doc) => Doc) => {
    setDocs((prev) => prev.map((d) => (d.id === id ? updater(d) : d)));
  }, []);

  const updateBlock = useCallback(
    (index: number, raw: string) => {
      updateDoc(activeDoc.id, (doc) => {
        if (!doc.blocks[index]) return doc;
        const blocks = doc.blocks.slice();
        blocks[index] = { ...blocks[index], raw, ...classifyBlock(raw) };
        return { ...doc, blocks };
      });
    },
    [activeDoc.id, updateDoc],
  );

  const activate = useCallback(
    (index: number, start: number, end: number = start) => {
      setActive({ index, start, end });
      if (typewriter) {
        requestAnimationFrame(() => {
          document
            .querySelector(`[data-block-index="${index}"]`)
            ?.scrollIntoView({ block: 'center', behavior: lowMotion ? 'auto' : 'smooth' });
        });
      }
    },
    [typewriter, lowMotion],
  );

  const deactivate = useCallback(() => {
    if (!active) return;
    const text = serializeDocument(activeDoc.blocks);
    updateDoc(activeDoc.id, (doc) => ({ ...doc, blocks: parseDocument(text) }));
    setActive(null);
  }, [active, activeDoc.blocks, activeDoc.id, updateDoc]);

  const focusBlock = useCallback((index: number, start: number, end: number = start) => {
    requestAnimationFrame(() => {
      const ta = document.querySelector(
        `.block[data-block-index="${index}"] textarea`,
      ) as HTMLTextAreaElement | null;
      if (!ta) return;
      ta.focus({ preventScroll: true });
      try {
        ta.setSelectionRange(start, end);
      } catch {
        /* ignore */
      }
    });
  }, []);

  const focusSource = useCallback((start: number, end: number = start) => {
    requestAnimationFrame(() => {
      const ta = sourceRef.current;
      if (!ta) return;
      ta.focus({ preventScroll: true });
      try {
        ta.setSelectionRange(start, end);
      } catch {
        /* ignore */
      }
    });
  }, []);

  const setSourceAndBlocks = useCallback(
    (text: string) => {
      setSourceText(text);
      updateDoc(activeDoc.id, (doc) => ({ ...doc, blocks: parseDocument(text) }));
    },
    [activeDoc.id, updateDoc],
  );

  const applyContent = useCallback(
    (text: string) => {
      updateDoc(activeDoc.id, (doc) => ({ ...doc, blocks: parseDocument(text) }));
      if (sourceMode) setSourceText(text);
      setActive(null);
    },
    [activeDoc.id, sourceMode, updateDoc],
  );

  const splitBlock = useCallback(
    (index: number, before: string, after: string) => {
      const block = activeDoc.blocks[index];
      if (!block) return;
      const nextKind = block.kind === 'heading' ? 'paragraph' : block.kind;
      const first: Block = { ...block, raw: before, gap: '\n\n' };
      const second = makeBlock(after, block.gap || '\n\n', nextKind);
      const blocks = activeDoc.blocks.slice();
      blocks.splice(index, 1, first, second);
      updateDoc(activeDoc.id, (doc) => ({ ...doc, blocks }));
      activate(index + 1, 0, 0);
      focusBlock(index + 1, 0, 0);
    },
    [activeDoc.blocks, activeDoc.id, activate, focusBlock, updateDoc],
  );

  const mergeBlock = useCallback(
    (index: number, direction: -1 | 1) => {
      const blocks = activeDoc.blocks.slice();
      const current = blocks[index];
      if (!current) return;
      if (direction === -1) {
        const prev = blocks[index - 1];
        if (!prev) return;
        const joinAt = prev.raw.length;
        blocks[index - 1] = { ...prev, raw: prev.raw + current.raw, gap: current.gap };
        blocks.splice(index, 1);
        updateDoc(activeDoc.id, (doc) => ({ ...doc, blocks }));
        activate(index - 1, joinAt, joinAt);
        focusBlock(index - 1, joinAt, joinAt);
      } else {
        const next = blocks[index + 1];
        if (!next) return;
        const joinAt = current.raw.length;
        blocks[index] = {
          ...current,
          raw: current.raw + next.raw,
          gap: next.gap,
          ...classifyBlock(current.raw + next.raw),
        };
        blocks.splice(index + 1, 1);
        updateDoc(activeDoc.id, (doc) => ({ ...doc, blocks }));
        activate(index, joinAt, joinAt);
        focusBlock(index, joinAt, joinAt);
      }
    },
    [activeDoc.blocks, activeDoc.id, activate, focusBlock, updateDoc],
  );

  const moveBlock = useCallback(
    (index: number, delta: -1 | 1) => {
      const target = index + delta;
      if (target < 0 || target >= activeDoc.blocks.length) return;
      const at = delta < 0 ? activeDoc.blocks[target].raw.length : 0;
      activate(target, at, at);
      focusBlock(target, at, at);
    },
    [activeDoc.blocks, activate, focusBlock],
  );

  const toggleTask = useCallback(
    (index: number, line: number) => {
      const block = activeDoc.blocks[index];
      if (!block) return;
      const lines = block.raw.split('\n');
      if (!lines[line]) return;
      lines[line] = /\[[xX]\]/.test(lines[line])
        ? lines[line].replace(/\[[xX]\]/, '[ ]')
        : lines[line].replace(/\[ \]/, '[x]');
      updateBlock(index, lines.join('\n'));
    },
    [activeDoc.blocks, updateBlock],
  );

  const editTarget = useCallback(() => {
    if (sourceMode) {
      return {
        source: true as const,
        text: sourceText,
        start: sourceSel.start,
        end: sourceSel.end,
        set: (next: string, s: number, e: number = s) => {
          setSourceAndBlocks(next);
          setSourceSel({ start: s, end: e });
          focusSource(s, e);
        },
      };
    }
    if (active) {
      const block = activeDoc.blocks[active.index];
      if (!block) return null;
      return {
        source: false as const,
        text: block.raw,
        start: active.start,
        end: active.end,
        set: (next: string, s: number, e: number = s) => {
          updateBlock(active.index, next);
          setActive({ index: active.index, start: s, end: e });
          focusBlock(active.index, s, e);
        },
      };
    }
    return null;
  }, [
    active,
    activeDoc.blocks,
    focusBlock,
    focusSource,
    setSourceAndBlocks,
    sourceMode,
    sourceSel,
    sourceText,
    updateBlock,
  ]);

  const wrapSelection = useCallback(
    (before: string, after: string, placeholder: string) => {
      const target = editTarget();
      if (!target) {
        notify('先点一下要编辑的段落');
        return;
      }
      const selected = target.text.slice(target.start, target.end) || placeholder;
      const next =
        target.text.slice(0, target.start) +
        before +
        selected +
        after +
        target.text.slice(target.end);
      const start = target.start + before.length;
      target.set(next, start, start + selected.length);
    },
    [editTarget, notify],
  );

  const insertAtCursor = useCallback(
    (insert: string) => {
      const target = editTarget();
      if (!target) {
        if (activeDoc.blocks.length === 0) {
          const block = makeBlock(insert, '\n', 'paragraph');
          updateDoc(activeDoc.id, (doc) => ({ ...doc, blocks: [block] }));
          activate(0, insert.length, insert.length);
          focusBlock(0, insert.length, insert.length);
        } else {
          notify('先点一下要编辑的段落');
        }
        return;
      }
      const next =
        target.text.slice(0, target.start) + insert + target.text.slice(target.end);
      const at = target.start + insert.length;
      target.set(next, at, at);
    },
    [activate, activeDoc.blocks.length, activeDoc.id, editTarget, focusBlock, notify, updateDoc],
  );

  const setHeading = useCallback(
    (level: number) => {
      const target = editTarget();
      if (!target) {
        notify('先点一下要编辑的段落');
        return;
      }
      if (target.source) {
        const before = target.text.slice(0, target.start);
        const lineStart = before.lastIndexOf('\n') + 1;
        const after = target.text.slice(target.start);
        const lineEnd = after.indexOf('\n');
        const end = lineEnd < 0 ? target.text.length : target.start + lineEnd;
        const line = target.text.slice(lineStart, end).replace(/^#{1,6}\s+/, '');
        const nextLine = level > 0 ? `${'#'.repeat(level)} ${line}` : line;
        const next = target.text.slice(0, lineStart) + nextLine + target.text.slice(end);
        target.set(next, lineStart + nextLine.length, lineStart + nextLine.length);
        return;
      }
      const cleaned = target.text.replace(/^#{1,6}\s+/, '');
      const next = level > 0 ? `${'#'.repeat(level)} ${cleaned}` : cleaned;
      target.set(next, next.length, next.length);
    },
    [editTarget, notify],
  );

  const togglePrefix = useCallback(
    (mode: 'ul' | 'ol' | 'task' | 'quote') => {
      const target = editTarget();
      if (!target) {
        notify('先点一下要编辑的段落');
        return;
      }
      let from = target.start;
      let to = target.end;
      if (target.source && from === to) {
        const before = target.text.slice(0, from);
        from = before.lastIndexOf('\n') + 1;
        const after = target.text.slice(to).indexOf('\n');
        to = after < 0 ? target.text.length : to + after;
      }
      if (!target.source) {
        from = 0;
        to = target.text.length;
      }
      const lines = target.text.slice(from, to).split('\n');
      const prefixes: Record<string, RegExp> = {
        ul: /^\s*[-*+]\s+/,
        ol: /^\s*\d+[.)]\s+/,
        task: /^\s*[-*+]\s+\[[ xX]\]\s+/,
        quote: /^\s*>\s?/,
      };
      const allHave = lines.filter((l) => l.trim()).every((l) => prefixes[mode].test(l));
      let n = 0;
      const transformed = lines.map((line) => {
        if (!line.trim()) return line;
        if (allHave) return line.replace(prefixes[mode], '');
        const stripped = line.replace(prefixes[mode], '');
        if (mode === 'ul') return `- ${stripped}`;
        if (mode === 'task') return `- [ ] ${stripped}`;
        if (mode === 'quote') return `> ${stripped}`;
        n += 1;
        return `${n}. ${stripped}`;
      });
      const replacement = transformed.join('\n');
      const next = target.text.slice(0, from) + replacement + target.text.slice(to);
      target.set(next, from, from + replacement.length);
    },
    [editTarget, notify],
  );

  const insertBlockAfter = useCallback(
    (text: string, kind: Block['kind'], level?: number) => {
      const emptyIndex = active?.index;
      const empty =
        emptyIndex !== undefined ? activeDoc.blocks[emptyIndex] : undefined;
      if (empty && !empty.raw.trim()) {
        updateBlock(emptyIndex!, text);
        setActive({ index: emptyIndex!, start: text.length, end: text.length });
        focusBlock(emptyIndex!, text.length, text.length);
        return;
      }
      const index = active ? active.index + 1 : activeDoc.blocks.length;
      const block: Block = { ...makeBlock(text, '\n\n', kind), level };
      const blocks = activeDoc.blocks.slice();
      if (index > 0) blocks[index - 1] = { ...blocks[index - 1], gap: '\n\n' };
      blocks.splice(index, 0, block);
      updateDoc(activeDoc.id, (doc) => ({ ...doc, blocks }));
      activate(index, text.length, text.length);
      focusBlock(index, text.length, text.length);
    },
    [activate, active, activeDoc.blocks, activeDoc.id, focusBlock, updateBlock, updateDoc],
  );

  const insertTable = useCallback(() => {
    insertBlockAfter(
      '| 列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |',
      'table',
    );
  }, [insertBlockAfter]);

  const insertCodeBlock = useCallback(() => {
    insertBlockAfter('```ts\n// 在这里写代码\n```', 'code', undefined);
  }, [insertBlockAfter]);

  const insertMath = useCallback(() => {
    insertBlockAfter('$$\nE = mc^2\n$$', 'math');
  }, [insertBlockAfter]);

  const insertImage = useCallback(async () => {
    const picked = await window.marmot.pickImage();
    if (!picked) return;
    let src = picked;
    if (activeDoc.path) src = relativePath(dirName(activeDoc.path), picked);
    const alt = baseName(picked).replace(/\.[^.]+$/, '');
    insertAtCursor(`![${alt}](${encodeURI(src)})`);
  }, [activeDoc.path, insertAtCursor]);

  const resolveImage = useCallback(
    (src: string) => {
      if (!src) return '';
      const trimmed = src.replace(/^<|>$/g, '');
      if (/^(https?:|data:|blob:|marmot:)/i.test(trimmed)) return trimmed;
      let local = trimmed;
      try {
        if (local.includes('%')) local = decodeURIComponent(local);
      } catch {
        /* keep encoded */
      }
      if (/^([A-Za-z]:)?[\\/]/.test(local)) return imageUrl(local);
      if (activeDoc.path) return imageUrl(joinPath(dirName(activeDoc.path), local));
      return '';
    },
    [activeDoc.path],
  );

  const copyText = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        } catch {
          /* ignore */
        }
      }
      notify('已复制');
    },
    [notify],
  );

  const openLink = useCallback((href: string) => {
    if (/^https?:\/\//i.test(href)) {
      void window.marmot.openExternal(href);
    } else if (href.startsWith('#')) {
      const target = outline.find(
        (item) => item.text.toLowerCase().replace(/\s+/g, '-') === href.slice(1).toLowerCase(),
      );
      if (target) {
        activate(target.blockIndex, 0, 0);
        document
          .querySelector(`[data-block-index="${target.blockIndex}"]`)
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }, [activate, outline]);

  const addRecent = useCallback((path: string) => {
    setRecent((prev) => [path, ...prev.filter((p) => p !== path)].slice(0, 12));
  }, []);

  const openPath = useCallback(
    async (path: string) => {
      const existing = docs.find((d) => d.path === path);
      if (existing) {
        setActiveId(existing.id);
        return;
      }
      try {
        const text = (await window.marmot.readFile(path)).replace(/\r\n?/g, '\n');
        const doc = makeDoc(text, path, baseName(path));
        setDocs((prev) => [...prev, doc]);
        setActiveId(doc.id);
        addRecent(path);
      } catch {
        notify('文件打不开，可能已被移动');
      }
    },
    [addRecent, docs, notify],
  );

  const openFile = useCallback(async () => {
    const result = await window.marmot.openFile();
    if (!result) return;
    const existing = docs.find((d) => d.path === result.path);
    if (existing) {
      setActiveId(existing.id);
      return;
    }
    const text = result.content.replace(/\r\n?/g, '\n');
    const doc = makeDoc(text, result.path, baseName(result.path));
    setDocs((prev) => [...prev, doc]);
    setActiveId(doc.id);
    addRecent(result.path);
  }, [addRecent, docs]);

  const openFolder = useCallback(async () => {
    const result = await window.marmot.openFolder();
    if (!result) return;
    setFolder(result);
    setExpanded(new Set([result.path]));
    setSidebarOpen(true);
    setSidebarTab('files');
    setFilter('');
  }, []);

  const refreshFolder = useCallback(async () => {
    if (!folder) return;
    try {
      const tree = await window.marmot.readTree(folder.path);
      setFolder({ path: folder.path, tree });
    } catch {
      /* ignore */
    }
  }, [folder]);

  const newFile = useCallback(() => {
    const doc = makeEmptyDoc();
    setDocs((prev) => [...prev, doc]);
    setActiveId(doc.id);
    setActive(null);
    setSourceMode(false);
    setSidebarTab('files');
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      const doc = docs.find((d) => d.id === id);
      if (!doc) return;
      const text = serializeDocument(doc.blocks);
      if (text !== doc.savedText && !window.confirm(`「${doc.path ? baseName(doc.path) : doc.name}」还没有保存，仍要关闭吗？`)) {
        return;
      }
      const index = docs.findIndex((d) => d.id === id);
      const remaining = docs.filter((d) => d.id !== id);
      if (!remaining.length) {
        const fresh = makeEmptyDoc();
        setDocs([fresh]);
        setActiveId(fresh.id);
        return;
      }
      setDocs(remaining);
      if (activeId === id) {
        const next = remaining[Math.max(0, index - 1)] ?? remaining[0];
        setActiveId(next.id);
      }
    },
    [activeId, docs],
  );

  const saveDoc = useCallback(
    async (saveAs = false) => {
      const text = sourceMode ? sourceText : serializeDocument(activeDoc.blocks);
      const name = activeDoc.path ? baseName(activeDoc.path) : activeDoc.name;
      const defaultPath = activeDoc.path ?? (folder ? joinPath(folder.path, name) : name);
      try {
        let target = activeDoc.path;
        if (!target || saveAs) {
          target = await window.marmot.saveFile({ defaultPath, content: text });
          if (!target) return;
        } else {
          await window.marmot.writeFile(target, text);
        }
        updateDoc(activeDoc.id, (doc) => ({
          ...doc,
          path: target,
          name: baseName(target!),
          savedText: text,
        }));
        addRecent(target);
        notify(saveAs ? '已另存为' : '已保存');
        if (folder && target.startsWith(folder.path)) void refreshFolder();
      } catch {
        notify('保存失败，请检查文件权限');
      }
    },
    [
      activeDoc.blocks,
      activeDoc.id,
      activeDoc.name,
      activeDoc.path,
      addRecent,
      folder,
      notify,
      refreshFolder,
      sourceMode,
      sourceText,
      updateDoc,
    ],
  );

  const saveSilently = useCallback(async () => {
    const doc = docRef.current;
    const text = contentRef.current;
    if (!doc.path || text === doc.savedText) return;
    try {
      const ok = await window.marmot.writeFile(doc.path, text);
      if (ok) updateDoc(doc.id, (d) => ({ ...d, savedText: text }));
    } catch {
      /* the next edit retries */
    }
  }, [updateDoc]);

  // The original's scheduleBackupWindow(): 1s idle, capped at 10s after the
  // first unsaved change; the backup service then checkpoints every 10min.
  useEffect(() => {
    if (!autoSave || !activeDoc.path || content === activeDoc.savedText) return;
    const idle = window.setTimeout(() => void saveSilently(), 1000);
    if (autoSaveMaxTimer.current === null) {
      autoSaveMaxTimer.current = window.setTimeout(() => {
        autoSaveMaxTimer.current = null;
        void saveSilently();
      }, 10000);
    }
    return () => window.clearTimeout(idle);
  }, [autoSave, activeDoc.path, activeDoc.savedText, content, saveSilently]);

  useEffect(() => {
    if (!autoSave) return;
    const periodic = window.setInterval(() => void saveSilently(), 600000);
    return () => window.clearInterval(periodic);
  }, [autoSave, saveSilently]);

  useEffect(
    () => () => {
      if (autoSaveMaxTimer.current !== null) window.clearTimeout(autoSaveMaxTimer.current);
    },
    [],
  );

  const exportHtml = useCallback(async () => {
    const name = (activeDoc.path ? baseName(activeDoc.path) : activeDoc.name).replace(
      /\.[^.]+$/,
      '',
    );
    const inner = sourceMode
      ? `<pre class="export-source">${escapeHtml(sourceText)}</pre>`
      : document.querySelector('.write')?.innerHTML ?? '';
    const bg = theme === 'dark' ? '#363b40' : theme === 'sepia' ? '#f3f2ee' : '#ffffff';
    const fg = theme === 'dark' ? '#b8bfc6' : theme === 'sepia' ? '#1f0909' : '#333333';
    const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<title>${escapeHtml(name || 'Marmot')}</title>
<style>
  html,body{margin:0;padding:0;background:${bg};color:${fg};}
  body{font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue","PingFang SC","Microsoft YaHei",sans-serif;line-height:1.6;}
  .write{max-width:860px;margin:0 auto;padding:48px 30px 100px;font-size:15px;}
  h1,h2,h3,h4,h5,h6{line-height:1.3;margin:1.2em 0 .6em;}
  h1{font-size:2.25em;border-bottom:1px solid rgba(127,127,127,.25);padding-bottom:.2em;}
  h2{font-size:1.75em;border-bottom:1px solid rgba(127,127,127,.2);padding-bottom:.15em;}
  p{margin:.8em 0;} blockquote{margin:1em 0;padding:0 15px;border-left:4px solid #dfe2e5;color:#777;}
  code{font-family:"SF Mono",Menlo,Consolas,monospace;background:rgba(127,127,127,.12);padding:2px 4px;border-radius:3px;font-size:.9em;}
  pre{background:rgba(127,127,127,.1);padding:16px;border-radius:6px;overflow:auto;}
  pre code{background:none;padding:0;}
  table{border-collapse:collapse;width:100%;margin:1em 0;} th,td{border:1px solid rgba(127,127,127,.28);padding:6px 13px;}
  th{background:rgba(127,127,127,.08);} hr{border:0;height:2px;background:rgba(127,127,127,.25);margin:18px 0;}
  img{max-width:100%;} a{color:#4183c4;} mark{background:#ffe58a;color:inherit;}
  .export-source{white-space:pre-wrap;}
  .md-codeblock-head,.md-codeblock-copy{display:none;}
</style></head>
<body><div class="write">${inner}</div></body></html>`;
    try {
      const target = await window.marmot.exportHtml({
        defaultPath: `${name || 'marmot'}.html`,
        content: html,
        filters: [{ name: 'HTML', extensions: ['html'] }],
      });
      if (target) notify('已导出 HTML');
    } catch {
      notify('导出失败');
    }
  }, [activeDoc.name, activeDoc.path, notify, sourceMode, sourceText, theme]);

  const cycleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : prev === 'dark' ? 'sepia' : 'light'));
  }, []);

  const setZoomLevel = useCallback((next: number) => {
    const clamped = Math.round(Math.min(2, Math.max(0.6, next)) * 10) / 10;
    setZoom(clamped);
    void window.marmot.setZoom(clamped);
  }, []);

  const toggleSource = useCallback(() => {
    if (sourceMode) {
      const text = sourceText;
      updateDoc(activeDoc.id, (doc) => ({ ...doc, blocks: parseDocument(text) }));
      setSourceMode(false);
      setActive(null);
    } else {
      setSourceText(serializeDocument(activeDoc.blocks));
      setSourceMode(true);
      setActive(null);
    }
  }, [activeDoc.blocks, activeDoc.id, sourceMode, sourceText, updateDoc]);

  const jumpToOffset = useCallback(
    (offset: number, length: number) => {
      if (sourceMode) {
        setSourceSel({ start: offset, end: offset + length });
        focusSource(offset, offset + length);
        return;
      }
      let cursor = 0;
      for (let i = 0; i < activeDoc.blocks.length; i += 1) {
        const block = activeDoc.blocks[i];
        const start = cursor;
        const end = start + block.raw.length;
        if (offset <= end || i === activeDoc.blocks.length - 1) {
          const local = Math.max(0, Math.min(block.raw.length, offset - start));
          activate(i, local, Math.min(block.raw.length, local + length));
          focusBlock(i, local, Math.min(block.raw.length, local + length));
          document
            .querySelector(`[data-block-index="${i}"]`)
            ?.scrollIntoView({ block: 'center', behavior: lowMotion ? 'auto' : 'smooth' });
          return;
        }
        cursor = end + block.gap.length;
      }
    },
    [activate, activeDoc.blocks, focusBlock, focusSource, lowMotion, sourceMode],
  );

  const findNext = useCallback(
    (dir: 1 | -1 = 1) => {
      if (!findMatchesList.length) return;
      const next = (findIndex + dir + findMatchesList.length) % findMatchesList.length;
      setFindIndex(next);
      const match = findMatchesList[next];
      jumpToOffset(match.start, match.end - match.start);
    },
    [findIndex, findMatchesList, jumpToOffset],
  );

  const replaceOne = useCallback(() => {
    if (!findMatchesList.length) return;
    const match = findMatchesList[Math.min(findIndex, findMatchesList.length - 1)];
    const next = content.slice(0, match.start) + replaceText + content.slice(match.end);
    applyContent(next);
    setFindIndex(0);
    notify('已替换');
  }, [applyContent, content, findIndex, findMatchesList, notify, replaceText]);

  const replaceAll = useCallback(() => {
    if (!findQuery) return;
    if (!findMatchesList.length) return;
    const flags = findCase ? 'g' : 'gi';
    const escaped = findQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const next = content.replace(new RegExp(escaped, flags), replaceText);
    applyContent(next);
    setFindIndex(0);
    notify(`已替换 ${findMatchesList.length} 处`);
  }, [applyContent, content, findCase, findMatchesList.length, findQuery, notify, replaceText]);

  const openFind = useCallback(() => {
    setFindOpen(true);
    setStatsOpen(false);
    setMoreOpen(false);
    requestAnimationFrame(() => {
      findRef.current?.focus();
      findRef.current?.select();
    });
  }, []);

  const duplicates = useMemo(
    () => ({
      docs: docs.map((d) => d.path).filter(Boolean) as string[],
    }),
    [docs],
  );

  interface QuickItem {
    label: string;
    detail: string;
    kind: string;
    run: () => void;
  }

  const quickItems = useMemo<QuickItem[]>(() => {
    const items: QuickItem[] = [];
    docs.forEach((d) => {
      items.push({
        label: d.path ? baseName(d.path) : d.name,
        detail: d.path ?? '未保存的文档',
        kind: '文档',
        run: () => setActiveId(d.id),
      });
    });
    recent
      .filter((p) => !duplicates.docs.includes(p))
      .forEach((p) => {
        items.push({
          label: baseName(p),
          detail: p,
          kind: '最近',
          run: () => void openPath(p),
        });
      });
    const commands: [string, string, () => void][] = [
      ['新建文件', '文件', newFile],
      ['打开文件…', '文件', () => void openFile()],
      ['打开文件夹…', '文件', () => void openFolder()],
      ['保存', '文件', () => void saveDoc(false)],
      ['另存为…', '文件', () => void saveDoc(true)],
      ['导出 HTML…', '文件', () => void exportHtml()],
      ['切换侧栏', '视图', () => setSidebarOpen((v) => !v)],
      ['源码模式', '视图', toggleSource],
      ['专注模式', '视图', () => setFocusMode((v) => !v)],
      ['打字机模式', '视图', () => setTypewriter((v) => !v)],
      ['切换主题', '视图', cycleTheme],
      ['查找与替换', '编辑', openFind],
      ['关于 Marmot', '帮助', () => setAboutOpen(true)],
    ];
    commands.forEach(([label, kind, run]) =>
      items.push({ label, detail: '命令', kind, run }),
    );
    return items;
  }, [
    cycleTheme,
    docs,
    duplicates.docs,
    exportHtml,
    newFile,
    openFile,
    openFind,
    openFolder,
    openPath,
    recent,
    saveDoc,
    toggleSource,
  ]);

  const filteredQuick = useMemo(() => {
    const q = quickQuery.trim().toLowerCase();
    if (!q) return quickItems;
    return quickItems.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.detail.toLowerCase().includes(q) ||
        item.kind.toLowerCase().includes(q),
    );
  }, [quickItems, quickQuery]);

  useEffect(() => {
    if (quickOpen) {
      setQuickQuery('');
      setQuickIndex(0);
      requestAnimationFrame(() => quickRef.current?.focus());
    }
  }, [quickOpen]);

  const runQuick = useCallback(
    (item: QuickItem | undefined) => {
      if (!item) return;
      setQuickOpen(false);
      item.run();
    },
    [],
  );

  const handleCommand = useCallback(
    (command: string) => {
      switch (command) {
        case 'file.new':
          newFile();
          break;
        case 'file.open':
          void openFile();
          break;
        case 'file.openFolder':
          void openFolder();
          break;
        case 'file.save':
          void saveDoc(false);
          break;
        case 'file.saveAs':
          void saveDoc(true);
          break;
        case 'file.exportHtml':
          void exportHtml();
          break;
        case 'file.closeTab':
          closeTab(activeDoc.id);
          break;
        case 'find.open':
          openFind();
          break;
        case 'quick.open':
          setQuickOpen(true);
          break;
        case 'format.bold':
          wrapSelection('**', '**', '加粗文字');
          break;
        case 'format.italic':
          wrapSelection('*', '*', '斜体文字');
          break;
        case 'format.strike':
          wrapSelection('~~', '~~', '删除文字');
          break;
        case 'format.highlight':
          wrapSelection('==', '==', '高亮文字');
          break;
        case 'format.code':
          wrapSelection('`', '`', '代码');
          break;
        case 'format.link':
          wrapSelection('[', '](https://)', '链接文字');
          break;
        case 'format.image':
          void insertImage();
          break;
        case 'format.table':
          insertTable();
          break;
        case 'format.codeblock':
          insertCodeBlock();
          break;
        case 'format.math':
          insertMath();
          break;
        case 'format.quote':
          togglePrefix('quote');
          break;
        case 'format.ul':
          togglePrefix('ul');
          break;
        case 'format.ol':
          togglePrefix('ol');
          break;
        case 'format.task':
          togglePrefix('task');
          break;
        case 'format.h1':
          setHeading(1);
          break;
        case 'format.h2':
          setHeading(2);
          break;
        case 'format.h3':
          setHeading(3);
          break;
        case 'format.p':
          setHeading(0);
          break;
        case 'view.sidebar':
          setSidebarOpen((v) => !v);
          break;
        case 'view.source':
          toggleSource();
          break;
        case 'view.focus':
          setFocusMode((v) => !v);
          break;
        case 'view.typewriter':
          setTypewriter((v) => !v);
          break;
        case 'view.theme.light':
          setTheme('light');
          break;
        case 'view.theme.dark':
          setTheme('dark');
          break;
        case 'view.theme.sepia':
          setTheme('sepia');
          break;
        case 'view.zoomIn':
          setZoomLevel(zoom + 0.1);
          break;
        case 'view.zoomOut':
          setZoomLevel(zoom - 0.1);
          break;
        case 'view.zoomReset':
          setZoomLevel(1);
          break;
        case 'help.about':
          setAboutOpen(true);
          break;
        case 'view.preferences':
          setPrefsOpen(true);
          break;
        case 'help.welcome':
          setAboutOpen(true);
          break;
        case 'help.free':
          setAboutOpen(true);
          break;
        default:
          break;
      }
    },
    [
      activeDoc.id,
      closeTab,
      exportHtml,
      insertCodeBlock,
      insertImage,
      insertMath,
      insertTable,
      newFile,
      openFile,
      openFind,
      openFolder,
      saveDoc,
      setHeading,
      setZoomLevel,
      togglePrefix,
      toggleSource,
      wrapSelection,
      zoom,
    ],
  );

  const commandRef = useRef(handleCommand);
  useEffect(() => {
    commandRef.current = handleCommand;
  }, [handleCommand]);
  useEffect(() => {
    return window.marmot.onMenu((command) => commandRef.current(command));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (quickOpen) setQuickOpen(false);
      else if (findOpen) setFindOpen(false);
      else if (prefsOpen) setPrefsOpen(false);
      else if (aboutOpen) setAboutOpen(false);
      else if (moreOpen) setMoreOpen(false);
      else if (active) deactivate();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [aboutOpen, active, deactivate, findOpen, moreOpen, prefsOpen, quickOpen]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.more-menu') && !target.closest('.more-btn')) setMoreOpen(false);
      if (!target.closest('.stats-popover') && !target.closest('.status-stat-btn')) {
        setStatsOpen(false);
      }
      if (!active) return;
      if (
        target.closest('.block.is-active') ||
        target.closest('.toolbar') ||
        target.closest('.findbar') ||
        target.closest('.status-bar') ||
        target.closest('.tabbar') ||
        target.closest('.sidebar') ||
        target.closest('.modal-backdrop')
      ) {
        return;
      }
      deactivate();
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [active, deactivate]);

  useEffect(() => {
    if (!typewriter) return;
    if (!active) return;
    const el = document.querySelector(`[data-block-index="${active.index}"]`);
    el?.scrollIntoView({ block: 'center', behavior: lowMotion ? 'auto' : 'smooth' });
  }, [active, lowMotion, typewriter]);

  // Typewriter mode: the caret line is held at the vertical centre. The
  // original computes e = (contentHeight - lineHeight) / 2, pads the top by
  // e - lineHeight and adds e + lineHeight of space after the text.
  useEffect(() => {
    const root = document.documentElement;
    if (!typewriter) {
      root.style.removeProperty('--tw-pad-top');
      root.style.removeProperty('--tw-pad-bottom');
      return;
    }
    const apply = () => {
      const height = editorScrollRef.current?.clientHeight ?? window.innerHeight;
      const lineHeight = fontSize * 1.6;
      const half = (height - lineHeight) / 2;
      root.style.setProperty('--tw-pad-top', `${Math.max(0, half - lineHeight)}px`);
      root.style.setProperty('--tw-pad-bottom', `${Math.max(lineHeight, half + lineHeight)}px`);
    };
    apply();
    const timer = window.setTimeout(apply, 100);
    window.addEventListener('resize', apply);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', apply);
    };
  }, [typewriter, fontSize]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const onSidebarResize = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = sidebarWidth;
      const move = (e: MouseEvent) => {
        setSidebarWidth(Math.max(200, Math.min(420, startWidth + e.clientX - startX)));
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    [sidebarWidth],
  );

  const onDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      const files = Array.from(event.dataTransfer.files);
      for (const file of files) {
        const path = window.marmot.pathForFile(file);
        if (!path) continue;
        if (isMarkdown(path)) {
          await openPath(path);
        } else {
          try {
            const tree = await window.marmot.readTree(path);
            if (tree.children?.length) {
              setFolder({ path, tree });
              setExpanded(new Set([path]));
              setSidebarOpen(true);
            }
          } catch {
            /* ignore */
          }
        }
      }
    },
    [openPath],
  );

  const editorCtx: EditorContext = {
    activeIndex: active?.index ?? null,
    selectionStart: active?.start,
    selectionEnd: active?.end,
    focusMode,
    search: findOpen && findQuery ? { query: findQuery, caseSensitive: findCase } : null,
    outline,
    resolveImage,
    onActivate: activate,
    onDeactivate: deactivate,
    onUpdate: updateBlock,
    onSelection: (index, start, end) => {
      setActive((prev) =>
        prev && prev.index === index && (prev.start !== start || prev.end !== end)
          ? { ...prev, start, end }
          : prev,
      );
    },
    onSplit: splitBlock,
    onMerge: mergeBlock,
    onMove: moveBlock,
    onToggleTask: toggleTask,
    onOpenLink: openLink,
    onCopy: (text) => void copyText(text),
    onToast: notify,
  };

  const platform = window.marmot?.platform ?? 'darwin';
  const findCount = findMatchesList.length;
  const displayIndex = findCount ? Math.min(findIndex, findCount - 1) + 1 : 0;

  return (
    <div
      className={[
        'app',
        `platform-${platform}`,
        focusMode ? 'focus-mode' : '',
        typewriter ? 'typewriter-mode' : '',
        sourceMode ? 'source-mode' : '',
        lowMotion ? 'low-motion' : '',
        shotMode ? 'shot-mode' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => void onDrop(e)}
      style={{
        ['--sidebar-width' as string]: `${sidebarWidth}px`,
        ['--pd-font-size' as string]: `${fontSize}px`,
        ['--pd-content-width' as string]: `${effectiveContentWidth}px`,
        ['--pd-font-family' as string]: FONT_FAMILIES[fontFamily] ?? FONT_FAMILIES.sans,
        ['--pd-line-numbers' as string]: showLineNumbers ? 'block' : 'none',
      }}
    >
      <header className="topbar">
        <div className="topbar-left">
          <button
            type="button"
            className="icon-btn sidebar-toggle"
            title="切换侧栏 (⌘⇧L)"
            onClick={() => setSidebarOpen((v) => !v)}
          >
            <Icon name="panel" />
          </button>
          <div className="brand-mark" aria-hidden="true">
            <img src="./assets/marmot-icon-128.png" alt="" />
          </div>
          <div className="title-block">
            <span className="doc-name">
              {docName}
              {dirty && <span className="dirty-dot" title="尚未保存" />}
            </span>
            <span className="doc-path">
              {activeDoc.path ?? '新文档 · 自动保存在本机'}
            </span>
          </div>
        </div>

        <div className="toolbar" role="toolbar" aria-label="格式">
          <button type="button" className="fmt-btn bold" title="加粗 (⌘B)" onMouseDown={(e) => e.preventDefault()} onClick={() => wrapSelection('**', '**', '加粗文字')}>B</button>
          <button type="button" className="fmt-btn italic" title="斜体 (⌘I)" onMouseDown={(e) => e.preventDefault()} onClick={() => wrapSelection('*', '*', '斜体文字')}>I</button>
          <button type="button" className="fmt-btn strike" title="删除线 (⌘⇧X)" onMouseDown={(e) => e.preventDefault()} onClick={() => wrapSelection('~~', '~~', '删除文字')}>S</button>
          <button type="button" className="fmt-btn code" title="行内代码 (⌘E)" onMouseDown={(e) => e.preventDefault()} onClick={() => wrapSelection('`', '`', '代码')}>
            <Icon name="code" size={15} />
          </button>
          <span className="toolbar-sep" />
          <button type="button" className="icon-btn" title="链接 (⌘K)" onMouseDown={(e) => e.preventDefault()} onClick={() => wrapSelection('[', '](https://)', '链接文字')}>
            <Icon name="link" />
          </button>
          <button type="button" className="icon-btn" title="图片" onMouseDown={(e) => e.preventDefault()} onClick={() => void insertImage()}>
            <Icon name="image" />
          </button>
          <button type="button" className="icon-btn" title="表格" onMouseDown={(e) => e.preventDefault()} onClick={insertTable}>
            <Icon name="table" />
          </button>
          <button type="button" className="icon-btn" title="引用" onMouseDown={(e) => e.preventDefault()} onClick={() => togglePrefix('quote')}>
            <Icon name="quote" />
          </button>
          <button type="button" className="icon-btn" title="无序列表" onMouseDown={(e) => e.preventDefault()} onClick={() => togglePrefix('ul')}>
            <Icon name="ul" />
          </button>
          <button type="button" className="icon-btn" title="有序列表" onMouseDown={(e) => e.preventDefault()} onClick={() => togglePrefix('ol')}>
            <Icon name="ol" />
          </button>
          <button type="button" className="icon-btn" title="任务列表" onMouseDown={(e) => e.preventDefault()} onClick={() => togglePrefix('task')}>
            <Icon name="task" />
          </button>
          <span className="toolbar-sep" />
          <button type="button" className="fmt-btn hbtn" title="一级标题" onMouseDown={(e) => e.preventDefault()} onClick={() => setHeading(1)}>H1</button>
          <button type="button" className="fmt-btn hbtn" title="二级标题" onMouseDown={(e) => e.preventDefault()} onClick={() => setHeading(2)}>H2</button>
        </div>

        <div className="topbar-right">
          <button
            type="button"
            className={`icon-btn ${sourceMode ? 'active' : ''}`}
            title="源码模式 (⌘/)"
            onClick={toggleSource}
          >
            <Icon name="code" />
          </button>
          <button type="button" className="icon-btn theme-btn" title="切换主题" onClick={cycleTheme}>
            <ThemeIcon theme={theme} />
          </button>
          <button type="button" className="icon-btn" title="快速打开 (⌘P)" onClick={() => setQuickOpen(true)}>
            <Icon name="search" />
          </button>
          <button
            type="button"
            className="icon-btn more-btn"
            title="更多"
            onClick={() => setMoreOpen((v) => !v)}
          >
            <Icon name="more" />
          </button>
          {moreOpen && (
            <div className="more-menu">
              <button type="button" onClick={() => { setMoreOpen(false); void saveDoc(false); }}>保存 <kbd>⌘S</kbd></button>
              <button type="button" onClick={() => { setMoreOpen(false); void saveDoc(true); }}>另存为…</button>
              <button type="button" onClick={() => { setMoreOpen(false); void exportHtml(); }}>导出 HTML…</button>
              <button type="button" onClick={() => { setMoreOpen(false); setSourceMode(!sourceMode); }}>源码模式</button>
              <div className="menu-divider" />
              <button type="button" onClick={() => { setMoreOpen(false); setPrefsOpen(true); }}>偏好设置… <kbd>⌘,</kbd></button>
              <button type="button" onClick={() => { setMoreOpen(false); setAboutOpen(true); }}>关于 Marmot</button>
            </div>
          )}
          {platform !== 'darwin' && (
            <div className="win-controls">
              <button type="button" onClick={() => window.marmot.windowControl('minimize')} title="最小化"><Icon name="minimize" size={14} /></button>
              <button type="button" onClick={() => window.marmot.windowControl('maximize')} title="最大化"><Icon name="maximize" size={14} /></button>
              <button type="button" className="win-close" onClick={() => window.marmot.windowControl('close')} title="关闭"><Icon name="close" size={14} /></button>
            </div>
          )}
        </div>
      </header>

      {findOpen && (
        <div className="findbar">
          <div className="find-row">
            <input
              ref={findRef}
              value={findQuery}
              placeholder="查找"
              onChange={(e) => {
                setFindQuery(e.target.value);
                setFindIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  findNext(e.shiftKey ? -1 : 1);
                }
                if (e.key === 'Escape') setFindOpen(false);
              }}
            />
            <span className="find-count">{displayIndex}/{findCount}</span>
            <button type="button" className={`icon-btn small ${findCase ? 'active' : ''}`} title="区分大小写" onClick={() => { setFindCase((v) => !v); setFindIndex(0); }}>Aa</button>
            <button type="button" className="icon-btn small" title="上一个 (⇧Enter)" onClick={() => findNext(-1)}>↑</button>
            <button type="button" className="icon-btn small" title="下一个 (Enter)" onClick={() => findNext(1)}>↓</button>
            <button type="button" className="icon-btn small" title="关闭 (Esc)" onClick={() => setFindOpen(false)}><Icon name="close" size={14} /></button>
          </div>
          <div className="find-row replace-row">
            <input
              value={replaceText}
              placeholder="替换为"
              onChange={(e) => setReplaceText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  replaceOne();
                }
                if (e.key === 'Escape') setFindOpen(false);
              }}
            />
            <button type="button" className="text-btn" onClick={replaceOne}>替换</button>
            <button type="button" className="text-btn" onClick={replaceAll}>全部替换</button>
          </div>
        </div>
      )}

      <div className="workspace">
        {sidebarOpen && (
          <aside className="sidebar" aria-label="侧栏">
            <div className="sidebar-head">
              <div className="sidebar-tabs">
                <button type="button" className={sidebarTab === 'files' ? 'active' : ''} onClick={() => setSidebarTab('files')}>
                  文件
                </button>
                <button type="button" className={sidebarTab === 'outline' ? 'active' : ''} onClick={() => setSidebarTab('outline')}>
                  大纲
                </button>
              </div>
              <button type="button" className="icon-btn small" title="打开文件夹" onClick={() => void openFolder()}>
                <Icon name="folder" />
              </button>
              <button type="button" className="icon-btn small" title="新建文件" onClick={newFile}>
                <Icon name="plus" />
              </button>
            </div>

            {sidebarTab === 'files' ? (
              <div className="sidebar-body">
                {folder ? (
                  <>
                    <div className="folder-title" title={folder.path}>
                      <Icon name="folder" size={14} />
                      <span>{baseName(folder.path)}</span>
                    </div>
                    <div className="sidebar-filter">
                      <Icon name="search" size={13} />
                      <input value={filter} placeholder="筛选文件" onChange={(e) => setFilter(e.target.value)} />
                      {filter && <button type="button" className="icon-btn tiny" onClick={() => setFilter('')}><Icon name="close" size={12} /></button>}
                    </div>
                    <div className="tree">
                      {filter.trim()
                        ? filteredFiles.map((f) => (
                            <button key={f.path} type="button" className={`tree-row tree-file-row ${activeDoc.path === f.path ? 'active' : ''}`} style={{ paddingLeft: 14 }} title={f.path} onClick={() => void openPath(f.path)}>
                              <span className="tree-icon"><Icon name="file" size={15} /></span>
                              <span className="tree-label">{f.name}</span>
                              <span className="tree-dir-label">{baseName(dirName(f.path))}</span>
                            </button>
                          ))
                        : folder.tree.children?.map((child) => (
                            <FileTreeNode
                              key={child.path}
                              node={child}
                              depth={0}
                              activePath={activeDoc.path}
                              expanded={expanded}
                              onToggle={(path) =>
                                setExpanded((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(path)) next.delete(path);
                                  else next.add(path);
                                  return next;
                                })
                              }
                              onOpen={(path) => void openPath(path)}
                            />
                          ))}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="recent-head">最近文件</div>
                    {recent.length === 0 && (
                      <div className="sidebar-empty">
                        还没有打开过文件。
                        <button type="button" onClick={() => void openFile()}>打开一个 Markdown 文件</button>
                      </div>
                    )}
                    {recent.map((p) => (
                      <button key={p} type="button" className={`recent-row ${activeDoc.path === p ? 'active' : ''}`} title={p} onClick={() => void openPath(p)}>
                        <Icon name="file" size={15} />
                        <span className="recent-name">{baseName(p)}</span>
                        <span className="recent-dir">{baseName(dirName(p))}</span>
                      </button>
                    ))}
                    <button type="button" className="sidebar-cta" onClick={() => void openFolder()}>
                      <Icon name="folder" />
                      打开文件夹
                    </button>
                  </>
                )}
                <div className="sidebar-foot">
                  <span>{allFiles.length ? `${allFiles.length} 个 Markdown 文件` : '本地写作空间'}</span>
                  <span className="local-badge"><span className="dot" />本地</span>
                </div>
              </div>
            ) : (
              <div className="sidebar-body outline-body">
                {outline.length === 0 ? (
                  <div className="sidebar-empty">给文章加上标题后，这里会自动生成大纲。</div>
                ) : (
                  outline.map((item, i) => (
                    <button
                      key={i}
                      type="button"
                      className={`outline-row level-${item.level} ${active?.index === item.blockIndex ? 'active' : ''}`}
                      onClick={() => {
                        activate(item.blockIndex, 0, 0);
                        document
                          .querySelector(`[data-block-index="${item.blockIndex}"]`)
                          ?.scrollIntoView({ block: 'center', behavior: lowMotion ? 'auto' : 'smooth' });
                      }}
                    >
                      {item.text}
                    </button>
                  ))
                )}
              </div>
            )}
            <div className="sidebar-resizer" onMouseDown={onSidebarResize} />
          </aside>
        )}

        <main className="editor-pane">
          {docs.length > 1 && (
            <div className="tabbar">
              {docs.map((doc) => (
                <div
                  key={doc.id}
                  className={`tab ${doc.id === activeId ? 'active' : ''}`}
                  onClick={() => setActiveId(doc.id)}
                  role="tab"
                  aria-selected={doc.id === activeId}
                >
                  <Icon name="file" size={13} />
                  <span className="tab-name">{doc.path ? baseName(doc.path) : doc.name}</span>
                  {serializeDocument(doc.blocks) !== doc.savedText && <span className="tab-dot" />}
                  <button
                    type="button"
                    className="tab-close"
                    title="关闭标签页"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(doc.id);
                    }}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </div>
              ))}
              <button type="button" className="icon-btn tiny tab-add" title="新建文件" onClick={newFile}>
                <Icon name="plus" size={14} />
              </button>
            </div>
          )}

          {sourceMode ? (
            <div className="source-pane">
              <div className="source-gutter" aria-hidden="true">
                {Array.from({ length: lineCount }, (_, i) => (
                  <div key={i}>{i + 1}</div>
                ))}
              </div>
              <textarea
                ref={sourceRef}
                className="source-textarea"
                value={sourceText}
                spellCheck={false}
                onChange={(e) => {
                  const next = e.target.value;
                  setSourceText(next);
                  updateDoc(activeDoc.id, (doc) => ({ ...doc, blocks: parseDocument(next) }));
                }}
                onSelect={(e) => {
                  const el = e.currentTarget;
                  setSourceSel({ start: el.selectionStart, end: el.selectionEnd });
                }}
                onKeyUp={(e) => {
                  const el = e.currentTarget;
                  setSourceSel({ start: el.selectionStart, end: el.selectionEnd });
                }}
                onClick={(e) => {
                  const el = e.currentTarget;
                  setSourceSel({ start: el.selectionStart, end: el.selectionEnd });
                }}
              />
            </div>
          ) : (
            <div className="editor-scroll" ref={editorScrollRef}>
              <div className="write" onClick={(e) => {
                if (e.target === e.currentTarget) {
                  if (activeDoc.blocks.length === 0) {
                    const block = makeBlock('', '\n', 'paragraph');
                    updateDoc(activeDoc.id, (doc) => ({ ...doc, blocks: [block] }));
                    activate(0, 0, 0);
                    focusBlock(0, 0, 0);
                  } else {
                    deactivate();
                  }
                }
              }}>
                {activeDoc.blocks.length === 0 && (
                  <div
                    className="empty-doc"
                    onClick={() => {
                      const block = makeBlock('', '\n', 'paragraph');
                      updateDoc(activeDoc.id, (doc) => ({ ...doc, blocks: [block] }));
                      activate(0, 0, 0);
                      focusBlock(0, 0, 0);
                    }}
                  >
                    <div className="empty-mark"><Icon name="sparkle" size={26} /></div>
                    <h2>从一个空白页开始</h2>
                    <p>直接写，或者输入 <code>#</code> 创建标题。<br />Markdown 会即时变成排版后的样子。</p>
                  </div>
                )}
                {activeDoc.blocks.map((block, index) => (
                  <BlockView key={block.key} block={block} index={index} ctx={editorCtx} />
                ))}
                {activeDoc.blocks.length > 0 && (
                  <div
                    className="click-tail"
                    title="点击继续写"
                    onClick={() => {
                      const block = makeBlock('', '\n', 'paragraph');
                      const blocks = [...activeDoc.blocks, block];
                      updateDoc(activeDoc.id, (doc) => ({ ...doc, blocks }));
                      activate(blocks.length - 1, 0, 0);
                      focusBlock(blocks.length - 1, 0, 0);
                    }}
                  />
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      <footer className="status-bar">
        <div className="status-left">
          <button type="button" className="status-stat-btn" onClick={() => setStatsOpen((v) => !v)} title="切换统计指标">
            <span>{metricValue}</span>
          </button>
          <span className="status-stat">{characters} 字符</span>
          <span className="status-stat">{lineCount} 行</span>
          {words > 0 && <span className="status-stat">约 {readTimeLabel} 分钟</span>}
          {statsOpen && (
            <div className="stats-popover">
              <div className="stats-title">文档统计</div>
              {WORD_METRICS.map((label, index) => (
                <button
                  key={label}
                  type="button"
                  className={`stats-row ${wordMetric === index ? 'active' : ''}`}
                  onClick={() => setWordMetric(index)}
                >
                  <span>{index === 0 ? '字数' : index === 1 ? '字符' : index === 2 ? '行数' : '阅读时间'}</span>
                  <b>
                    {index === 0
                      ? words
                      : index === 1
                        ? characters
                        : index === 2
                          ? lineCount
                          : `${readTimeLabel} 分钟`}
                  </b>
                </button>
              ))}
              <div><span>段落</span><b>{activeDoc.blocks.filter((b) => b.kind === 'paragraph').length}</b></div>
            </div>
          )}
        </div>
        <div className="status-right">
          <button type="button" className={`status-pill ${sourceMode ? 'active' : ''}`} title="源码模式 (⌘/)" onClick={toggleSource}>
            <Icon name="code" size={14} /><span>源码</span>
          </button>
          <button type="button" className={`status-pill ${focusMode ? 'active' : ''}`} title="专注模式 (⌘⇧F)" onClick={() => setFocusMode((v) => !v)}>
            <Icon name="focus" size={14} /><span>专注</span>
          </button>
          <button type="button" className={`status-pill ${typewriter ? 'active' : ''}`} title="打字机模式" onClick={() => setTypewriter((v) => !v)}>
            <Icon name="typewriter" size={14} /><span>打字机</span>
          </button>
          <span className="status-divider" />
          <span className="zoom-group">
            <button type="button" className="icon-btn tiny" title="缩小" onClick={() => setZoomLevel(zoom - 0.1)}>−</button>
            <button type="button" className="zoom-value" onClick={() => setZoomLevel(1)} title="恢复 100%">{Math.round(zoom * 100)}%</button>
            <button type="button" className="icon-btn tiny" title="放大" onClick={() => setZoomLevel(zoom + 0.1)}>+</button>
          </span>
          <span className="free-badge" title="完全免费，无需激活码"><Icon name="check" size={12} />免激活</span>
        </div>
      </footer>

      {quickOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setQuickOpen(false); }}>
          <div className="quick-panel">
            <div className="quick-input-wrap">
              <Icon name="search" />
              <input
                ref={quickRef}
                value={quickQuery}
                placeholder="搜索文件、最近打开或命令…"
                onChange={(e) => { setQuickQuery(e.target.value); setQuickIndex(0); }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setQuickIndex((i) => Math.min(filteredQuick.length - 1, i + 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setQuickIndex((i) => Math.max(0, i - 1));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    runQuick(filteredQuick[quickIndex]);
                  } else if (e.key === 'Escape') {
                    setQuickOpen(false);
                  }
                }}
              />
              <kbd>Esc</kbd>
            </div>
            <div className="quick-list">
              {filteredQuick.length === 0 && <div className="quick-empty">没有匹配的项目</div>}
              {filteredQuick.slice(0, 40).map((item, i) => (
                <button
                  type="button"
                  key={`${item.kind}-${item.label}-${i}`}
                  className={`quick-row ${i === quickIndex ? 'active' : ''}`}
                  onMouseEnter={() => setQuickIndex(i)}
                  onClick={() => runQuick(item)}
                >
                  <span className="quick-kind">{item.kind}</span>
                  <span className="quick-label">{item.label}</span>
                  <span className="quick-detail">{item.detail}</span>
                </button>
              ))}
            </div>
            <div className="quick-foot"><span>↑↓ 选择</span><span>Enter 打开</span><span>Esc 关闭</span></div>
          </div>
        </div>
      )}

      {prefsOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setPrefsOpen(false); }}>
          <div className="prefs-panel">
            <div className="prefs-head">
              <h2>偏好设置</h2>
              <button type="button" className="icon-btn" onClick={() => setPrefsOpen(false)} title="关闭">
                <Icon name="close" />
              </button>
            </div>

            <div className="prefs-body">
              <section className="prefs-group">
                <h3>外观</h3>
                <label className="prefs-row">
                  <span className="prefs-label">主题</span>
                  <span className="prefs-seg">
                    {(['light', 'dark', 'sepia'] as Theme[]).map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={`prefs-seg-btn ${theme === t ? 'active' : ''}`}
                        onClick={() => setTheme(t)}
                      >
                        {t === 'light' ? '明亮' : t === 'dark' ? '夜色' : '纸墨'}
                      </button>
                    ))}
                  </span>
                </label>

                <label className="prefs-row">
                  <span className="prefs-label">正文字体</span>
                  <select
                    className="prefs-select"
                    value={fontFamily}
                    onChange={(e) => setFontFamily(e.target.value)}
                  >
                    <option value="sans">系统无衬线</option>
                    <option value="serif">衬线</option>
                    <option value="mono">等宽</option>
                  </select>
                </label>

                <label className="prefs-row">
                  <span className="prefs-label">字号</span>
                  <span className="prefs-slider">
                    <input
                      type="range"
                      min={13}
                      max={22}
                      step={1}
                      value={fontSize}
                      onChange={(e) => setFontSize(Number(e.target.value))}
                    />
                    <span className="prefs-value">{fontSize} px</span>
                  </span>
                </label>

                <label className="prefs-row">
                  <span className="prefs-label">正文宽度</span>
                  <span className="prefs-slider">
                    <input
                      type="range"
                      min={560}
                      max={1200}
                      step={20}
                      value={contentWidth}
                      onChange={(e) => setContentWidth(Number(e.target.value))}
                    />
                    <span className="prefs-value">{contentWidth} px</span>
                  </span>
                </label>
              </section>

              <section className="prefs-group">
                <h3>编辑</h3>
                <label className="prefs-row">
                  <span className="prefs-label">显示行号</span>
                  <input
                    type="checkbox"
                    className="prefs-check"
                    checked={showLineNumbers}
                    onChange={(e) => setShowLineNumbers(e.target.checked)}
                  />
                </label>
                <label className="prefs-row">
                  <span className="prefs-label">拼写检查</span>
                  <input
                    type="checkbox"
                    className="prefs-check"
                    checked={spellcheck}
                    onChange={(e) => setSpellcheck(e.target.checked)}
                  />
                </label>
                <label className="prefs-row">
                  <span className="prefs-label">自动保存</span>
                  <input
                    type="checkbox"
                    className="prefs-check"
                    checked={autoSave}
                    onChange={(e) => setAutoSave(e.target.checked)}
                  />
                </label>
              </section>

              <section className="prefs-group">
                <h3>关于</h3>
                <div className="prefs-about">
                  <span>Marmot 1.0.0</span>
                  <span>完全免费 · 无需激活码 · 无需账户</span>
                  <span>文档只保存在本机</span>
                </div>
              </section>
            </div>

            <div className="prefs-foot">
              <button type="button" className="prefs-done" onClick={() => setPrefsOpen(false)}>完成</button>
            </div>
          </div>
        </div>
      )}

      {aboutOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setAboutOpen(false); }}>
          <div className="about-panel">
            <button type="button" className="icon-btn about-close" onClick={() => setAboutOpen(false)}>
              <Icon name="close" />
            </button>
            <div className="about-mark">
              <img src="./assets/marmot-icon-128.png" alt="" />
            </div>
            <h1>Marmot</h1>
            <p className="about-tagline">让写作回到文字本身</p>
            <div className="about-badges">
              <span><Icon name="check" size={13} />完全免费</span>
              <span><Icon name="check" size={13} />无需激活码</span>
              <span><Icon name="check" size={13} />无需账户</span>
            </div>
            <p className="about-copy">
              一个用 Electron、React 和 TypeScript 从头写成的 Markdown 编辑器。所有文档只保存在你的电脑上；没有登录、没有订阅、没有试用期。
            </p>
            <div className="about-meta">
              <span>版本 1.0.0</span>
              <span>本地优先</span>
              <span>开源实现</span>
            </div>
            <button type="button" className="about-ok" onClick={() => setAboutOpen(false)}>开始写吧</button>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
