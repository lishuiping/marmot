/**
 * Markdown 解析与渲染：块级解析、分类、实时渲染、代码高亮与数学公式。
 *
 * @author lishuiping
 * @license Apache-2.0
 * @see https://github.com/lishuiping/marmot
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import katex from 'katex';

// ---------------------------------------------------------------------------
// Block model
// ---------------------------------------------------------------------------

export type BlockKind =
  | 'paragraph'
  | 'heading'
  | 'code'
  | 'quote'
  | 'list'
  | 'table'
  | 'math'
  | 'hr'
  | 'frontmatter'
  | 'html'
  | 'toc';

export interface Block {
  key: number;
  raw: string;
  /** Whitespace between this block and the next one, preserved verbatim. */
  gap: string;
  kind: BlockKind;
  level?: number;
  lang?: string;
}

export interface OutlineItem {
  blockIndex: number;
  level: number;
  text: string;
}

export interface SearchState {
  query: string;
  caseSensitive: boolean;
}

export interface EditorContext {
  activeIndex: number | null;
  selectionStart?: number;
  selectionEnd?: number;
  focusMode: boolean;
  search: SearchState | null;
  outline: OutlineItem[];
  resolveImage: (src: string) => string;
  onActivate: (index: number, caret: number, end?: number) => void;
  onDeactivate: () => void;
  onUpdate: (index: number, raw: string) => void;
  onSelection: (index: number, start: number, end: number) => void;
  onSplit: (index: number, before: string, after: string) => void;
  onMerge: (index: number, direction: -1 | 1) => void;
  onMove: (index: number, delta: -1 | 1) => void;
  onToggleTask: (index: number, line: number) => void;
  onOpenLink: (href: string) => void;
  onCopy: (text: string) => void;
  onToast: (text: string) => void;
}

let nextKey = 1;
export function makeBlock(raw = '', gap = '\n\n', kind: BlockKind = 'paragraph'): Block {
  return { key: nextKey++, raw, gap, kind };
}

const isBlank = (line: string) => line.trim() === '';
const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const HR = /^\s{0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/;
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const QUOTE = /^\s*>\s?/;
const HTML_START = /^\s*<([A-Za-z][A-Za-z0-9-]*)(\s|>|\/)/;
const TABLE_DELIM = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;

export function classifyBlock(raw: string): Pick<Block, 'kind' | 'level' | 'lang'> {
  const first = raw.split('\n', 1)[0] ?? '';
  const fence = FENCE.exec(first);
  if (fence) return { kind: 'code', lang: (fence[2] || '').trim().split(/\s+/)[0] };
  if (/^\s*\$\$/.test(first)) return { kind: 'math' };
  if (HEADING.test(first)) return { kind: 'heading', level: HEADING.exec(first)![1].length };
  if (HR.test(first)) return { kind: 'hr' };
  if (QUOTE.test(first)) return { kind: 'quote' };
  if (LIST.test(first)) return { kind: 'list' };
  if (first.includes('|')) {
    const second = raw.split('\n')[1] ?? '';
    if (TABLE_DELIM.test(second)) return { kind: 'table' };
  }
  if (first.trim() === '---') return { kind: 'frontmatter' };
  if (HTML_START.test(first)) return { kind: 'html' };
  if (first.trim().toLowerCase() === '[toc]') return { kind: 'toc' };
  return { kind: 'paragraph' };
}

function startsNewBlock(lines: string[], i: number): boolean {
  const line = lines[i] ?? '';
  if (FENCE.test(line) || HEADING.test(line) || HR.test(line) || QUOTE.test(line)) return true;
  if (LIST.test(line)) return true;
  if (/^\s*\$\$/.test(line)) return true;
  if (line.includes('|') && TABLE_DELIM.test(lines[i + 1] ?? '')) return true;
  if (HTML_START.test(line)) return true;
  return false;
}

export function parseDocument(input: string): Block[] {
  const content = input.replace(/\r\n?/g, '\n');
  if (!content.trim()) return [];
  const lines = content.split('\n');
  const offsets: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    offsets.push(cursor);
    cursor += line.length + 1;
  }

  interface RawBlock {
    startLine: number;
    endLine: number;
    raw: string;
    meta: Pick<Block, 'kind' | 'level' | 'lang'>;
  }
  const found: RawBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    if (isBlank(lines[i])) {
      i += 1;
      continue;
    }
    const start = i;
    const line = lines[i];
    const fence = FENCE.exec(line);
    let end = i + 1;
    let meta: Pick<Block, 'kind' | 'level' | 'lang'> = { kind: 'paragraph' };

    if (i === 0 && line.trim() === '---') {
      meta = { kind: 'frontmatter' };
      end = i + 1;
      while (end < lines.length && lines[end].trim() !== '---' && lines[end].trim() !== '...') {
        end += 1;
      }
      if (end < lines.length) end += 1;
    } else if (fence) {
      meta = { kind: 'code', lang: (fence[2] || '').trim().split(/\s+/)[0] };
      const marker = fence[1][0];
      const len = fence[1].length;
      end = i + 1;
      while (end < lines.length) {
        const close = new RegExp(`^\\s*${marker}{${len},}\\s*$`).test(lines[end]);
        end += 1;
        if (close) break;
      }
    } else if (/^\s*\$\$/.test(line)) {
      meta = { kind: 'math' };
      const rest = line.trim().slice(2);
      if (rest.endsWith('$$')) {
        end = i + 1;
      } else {
        end = i + 1;
        while (end < lines.length) {
          const closes = lines[end].includes('$$');
          end += 1;
          if (closes) break;
        }
      }
    } else if (HEADING.test(line)) {
      meta = { kind: 'heading', level: HEADING.exec(line)![1].length };
      end = i + 1;
    } else if (
      i + 1 < lines.length &&
      /^=+\s*$/.test(lines[i + 1]) &&
      line.trim().length > 0
    ) {
      meta = { kind: 'heading', level: 1 };
      end = i + 2;
    } else if (
      i + 1 < lines.length &&
      /^-{2,}\s*$/.test(lines[i + 1]) &&
      line.trim().length > 0
    ) {
      meta = { kind: 'heading', level: 2 };
      end = i + 2;
    } else if (HR.test(line)) {
      meta = { kind: 'hr' };
      end = i + 1;
    } else if (QUOTE.test(line)) {
      meta = { kind: 'quote' };
      end = i + 1;
      while (end < lines.length && (QUOTE.test(lines[end]) || isBlank(lines[end]))) {
        if (isBlank(lines[end]) && !QUOTE.test(lines[end + 1] ?? '')) break;
        end += 1;
      }
    } else if (line.includes('|') && TABLE_DELIM.test(lines[i + 1] ?? '')) {
      meta = { kind: 'table' };
      end = i + 1;
      while (end < lines.length && !isBlank(lines[end]) && lines[end].includes('|')) end += 1;
    } else if (LIST.test(line)) {
      meta = { kind: 'list' };
      end = i + 1;
      while (end < lines.length) {
        if (isBlank(lines[end])) {
          const next = lines[end + 1] ?? '';
          if (/^\s{2,}/.test(next) || LIST.test(next)) end += 1;
          else break;
        } else if (LIST.test(lines[end]) || /^\s{2,}/.test(lines[end])) {
          end += 1;
        } else {
          break;
        }
      }
    } else if (HTML_START.test(line)) {
      meta = { kind: 'html' };
      end = i + 1;
      while (end < lines.length && !isBlank(lines[end])) end += 1;
    } else if (line.trim().toLowerCase() === '[toc]') {
      meta = { kind: 'toc' };
      end = i + 1;
    } else {
      meta = { kind: 'paragraph' };
      end = i + 1;
      while (end < lines.length && !isBlank(lines[end]) && !startsNewBlock(lines, end)) {
        end += 1;
      }
    }

    const rawStart = offsets[start];
    const lastLine = lines[end - 1] ?? '';
    const rawEnd = offsets[end - 1] + lastLine.length;
    found.push({
      startLine: start,
      endLine: end,
      raw: content.slice(rawStart, rawEnd),
      meta,
    });
    i = end;
  }

  let key = 1;
  return found.map((item, index) => {
    const endOffset = offsets[item.endLine - 1] + (lines[item.endLine - 1] ?? '').length;
    const nextStart =
      index + 1 < found.length ? offsets[found[index + 1].startLine] : content.length;
    return {
      key: key++,
      raw: item.raw,
      gap: content.slice(endOffset, nextStart),
      ...item.meta,
    };
  });
}

export function serializeDocument(blocks: Block[]): string {
  return blocks.map((b) => b.raw + b.gap).join('');
}

export function outlineFromBlocks(blocks: Block[]): OutlineItem[] {
  const items: OutlineItem[] = [];
  blocks.forEach((block, index) => {
    if (block.kind !== 'heading') return;
    const raw = block.raw;
    const first = raw.split('\n', 1)[0];
    const m = HEADING.exec(first);
    const text = (m ? m[2] : first).replace(/[#*_`~]/g, '').trim();
    if (text) items.push({ blockIndex: index, level: block.level ?? 1, text });
  });
  return items;
}

export function documentTitle(blocks: Block[], fallback = '未命名'): string {
  for (const block of blocks) {
    if (block.kind === 'heading') {
      const m = HEADING.exec(block.raw.split('\n', 1)[0]);
      const text = (m ? m[2] : block.raw).replace(/[#*_`~]/g, '').trim();
      if (text) return text;
    }
    if (block.kind === 'paragraph' && block.raw.trim()) {
      return block.raw.replace(/[#*_`~[\]]/g, '').trim().slice(0, 42) || fallback;
    }
  }
  return fallback;
}

// The original's counter (main.js module "40", getWordCount): every CJK,
// kana and hangul character is one word; the rest is split on whitespace and
// punctuation; a leading/trailing punctuation token is trimmed by the -2.
const TYPORA_CJK = /[\u3040-\uABFF\uD7A4-\uFAFF]/gi;
const TYPORA_SPLIT = /[(\u3000-\u303F)\s!-,\\:-@\[-`{-~]+/g;
const TYPORA_PUNCT_TOKEN = /(^|\s+)[(\u3000-\u303F)!-\/:-@\[-`{-~]+(\s+|$)/gm;

export function countWords(text: string): number {
  if (text.trim().length === 0) return 0;
  let cjk = 0;
  const parts = [
    'd',
    text
      .replace(TYPORA_CJK, () => {
        cjk += 1;
        return ' ';
      })
      .replace(/['’]\w+/g, 'b')
      .replace(TYPORA_PUNCT_TOKEN, ' '),
    'd',
  ]
    .join(' ')
    .split(TYPORA_SPLIT).length;
  return cjk + parts - 2;
}

// ---------------------------------------------------------------------------
// Inline rendering
// ---------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const EMOJI: Record<string, string> = {
  smile: '😄',
  joy: '😂',
  heart: '❤️',
  '+1': '👍',
  '-1': '👎',
  fire: '🔥',
  tada: '🎉',
  rocket: '🚀',
  sparkles: '✨',
  eyes: '👀',
  check: '✅',
  warning: '⚠️',
  bulb: '💡',
  coffee: '☕',
  wave: '👋',
};

function renderMarks(text: string, search: SearchState | null): ReactNode {
  if (!search || !search.query) return text;
  const hay = search.caseSensitive ? text : text.toLowerCase();
  const needle = search.caseSensitive ? search.query : search.query.toLowerCase();
  if (!needle) return text;
  const out: ReactNode[] = [];
  let pos = 0;
  let n = 0;
  while (pos < text.length) {
    const at = hay.indexOf(needle, pos);
    if (at < 0) break;
    if (at > pos) out.push(text.slice(pos, at));
    out.push(
      <mark className="search-hit" key={`m${n++}`}>
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    pos = at + needle.length;
  }
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}

function katexHtml(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      strict: 'ignore',
      trust: false,
      output: 'html',
    });
  } catch {
    return `<span class="math-error">${escapeHtml(tex)}</span>`;
  }
}

function findClose(text: string, from: number, marker: string): number {
  return text.indexOf(marker, from);
}

function renderInline(
  text: string,
  base: number,
  ctx: EditorContext,
  keyPrefix = 'i',
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let i = 0;
  let k = 0;

  const addText = (start: number, end: number) => {
    if (end <= start) return;
    const value = text.slice(start, end);
    nodes.push(
      <span
        key={`${keyPrefix}t${k++}`}
        data-start={base + start}
        data-end={base + end}
      >
        {renderMarks(value, ctx.search)}
      </span>,
    );
  };

  while (i < text.length) {
    const ch = text[i];

    if (ch === '\\' && i + 1 < text.length && /[\\`*_{}\[\]()#+\-.!~=>]/.test(text[i + 1])) {
      addText(i + 1, i + 2);
      i += 2;
      continue;
    }

    if (ch === '<') {
      const auto = /^<((?:https?:\/\/|mailto:)[^\s>]+)>/.exec(text.slice(i));
      if (auto) {
        const href = auto[1];
        nodes.push(
          <a
            key={`${keyPrefix}l${k++}`}
            href={href}
            data-start={base + i}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              ctx.onOpenLink(href);
            }}
          >
            {auto[1]}
          </a>,
        );
        i += auto[0].length;
        continue;
      }
      const tag = /^<\/?[A-Za-z][^>]*>/.exec(text.slice(i));
      if (tag) {
        nodes.push(
          <span key={`${keyPrefix}h${k++}`} className="md-inline-html">
            {tag[0]}
          </span>,
        );
        i += tag[0].length;
        continue;
      }
    }

    if (ch === '`') {
      const run = /^`+/.exec(text.slice(i))![0];
      const close = findClose(text, i + run.length, run);
      if (close > i + run.length) {
        const code = text.slice(i + run.length, close);
        nodes.push(
          <code key={`${keyPrefix}c${k++}`} className="md-code">
            {renderMarks(code, ctx.search)}
          </code>,
        );
        i = close + run.length;
        continue;
      }
    }

    if (ch === '!' && text[i + 1] === '[') {
      const m = /^!\[([^\]]*)\]\(\s*([^)\s>]+)(?:\s+["']([^"']*)["'])?\s*\)/.exec(
        text.slice(i),
      );
      if (m) {
        const src = ctx.resolveImage(m[2]);
        nodes.push(
          <span key={`${keyPrefix}im${k++}`} className="md-image" data-start={base + i}>
            {src ? <img src={src} alt={m[1]} title={m[3] || m[1]} loading="lazy" /> : <span className="md-image-missing">图片</span>}
          </span>,
        );
        i += m[0].length;
        continue;
      }
    }

    if (ch === '[') {
      const m = /^\[([^\]]*)\]\(\s*([^)\s>]+)(?:\s+["']([^"']*)["'])?\s*\)/.exec(
        text.slice(i),
      );
      if (m) {
        const inner = m[1];
        const innerBase = base + i + 1;
        nodes.push(
          <a
            key={`${keyPrefix}a${k++}`}
            href={m[2]}
            title={m[3] || undefined}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              ctx.onOpenLink(m[2]);
            }}
          >
            {renderInline(inner, innerBase, ctx, `${keyPrefix}a${k}`)}
          </a>,
        );
        i += m[0].length;
        continue;
      }
    }

    if (ch === '[' && text[i + 1] === '^') {
      const close = text.indexOf(']', i + 2);
      if (close > 0) {
        nodes.push(
          <sup key={`${keyPrefix}fn${k++}`} className="md-footnote">
            {text.slice(i + 2, close)}
          </sup>,
        );
        i = close + 1;
        continue;
      }
    }

    if (ch === '$' && text[i + 1] !== '$') {
      const close = findClose(text, i + 1, '$');
      if (close > i + 1 && !/\n/.test(text.slice(i + 1, close))) {
        const tex = text.slice(i + 1, close);
        nodes.push(
          <span
            key={`${keyPrefix}math${k++}`}
            className="md-inline-math"
            dangerouslySetInnerHTML={{ __html: katexHtml(tex, false) }}
          />,
        );
        i = close + 1;
        continue;
      }
    }

    if ((ch === '*' || ch === '_') && i + 1 < text.length) {
      const marker = text.slice(i, i + 2);
      if (marker === '**' || marker === '__') {
        const close = findClose(text, i + 2, marker);
        if (close > i + 2) {
          const inner = text.slice(i + 2, close);
          nodes.push(
            <strong key={`${keyPrefix}b${k++}`}>
              {renderInline(inner, base + i + 2, ctx, `${keyPrefix}b${k}`)}
            </strong>,
          );
          i = close + 2;
          continue;
        }
      }
      const single = ch;
      const prevOk = i === 0 || !/[A-Za-z0-9]/.test(text[i - 1]);
      if (prevOk) {
        const close = findClose(text, i + 1, single);
        if (close > i + 1) {
          const inner = text.slice(i + 1, close);
          nodes.push(
            <em key={`${keyPrefix}e${k++}`}>
              {renderInline(inner, base + i + 1, ctx, `${keyPrefix}e${k}`)}
            </em>,
          );
          i = close + 1;
          continue;
        }
      }
    }

    if (ch === '~' && text[i + 1] === '~') {
      const close = findClose(text, i + 2, '~~');
      if (close > i + 2) {
        const inner = text.slice(i + 2, close);
        nodes.push(
          <del key={`${keyPrefix}s${k++}`}>
            {renderInline(inner, base + i + 2, ctx, `${keyPrefix}s${k}`)}
          </del>,
        );
        i = close + 2;
        continue;
      }
    }

    if (ch === '=' && text[i + 1] === '=') {
      const close = findClose(text, i + 2, '==');
      if (close > i + 2) {
        const inner = text.slice(i + 2, close);
        nodes.push(
          <mark key={`${keyPrefix}k${k++}`} className="md-highlight">
            {renderInline(inner, base + i + 2, ctx, `${keyPrefix}k${k}`)}
          </mark>,
        );
        i = close + 2;
        continue;
      }
    }

    if (ch === ':' && /^[a-z0-9_+-]+:/.test(text.slice(i))) {
      const m = /^:([a-z0-9_+-]+):/.exec(text.slice(i));
      if (m && EMOJI[m[1]]) {
        nodes.push(
          <span key={`${keyPrefix}em${k++}`} className="md-emoji" title={m[1]}>
            {EMOJI[m[1]]}
          </span>,
        );
        i += m[0].length;
        continue;
      }
    }

    if (/[\\`*_~=$!\[\]<:]/.test(ch)) {
      addText(i, i + 1);
      i += 1;
      continue;
    }

    const nextSpecial = text.slice(i).search(/[\\`*_~=$!\[\]<>:]/);
    if (nextSpecial <= 0) {
      addText(i, i + 1);
      i += 1;
    } else {
      addText(i, i + nextSpecial);
      i += nextSpecial;
    }
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// Code highlighting
// ---------------------------------------------------------------------------

const KEYWORDS: Record<string, string> = {
  js: 'const,let,var,function,return,if,else,for,while,class,extends,new,import,from,export,default,async,await,try,catch,finally,throw,typeof,instanceof,in,of,this,super,yield,switch,case,break,continue,delete,void,do,static,get,set',
  javascript: 'const,let,var,function,return,if,else,for,while,class,extends,new,import,from,export,default,async,await,try,catch,finally,throw,typeof,instanceof,in,of,this,super,yield,switch,case,break,continue,delete,void,do,static,get,set',
  ts: 'const,let,var,function,return,if,else,for,while,class,extends,implements,interface,type,enum,namespace,new,import,from,export,default,async,await,try,catch,finally,throw,typeof,instanceof,in,of,this,super,yield,switch,case,break,continue,delete,void,do,static,readonly,public,private,protected,as,satisfies',
  typescript: 'const,let,var,function,return,if,else,for,while,class,extends,implements,interface,type,enum,namespace,new,import,from,export,default,async,await,try,catch,finally,throw,typeof,instanceof,in,of,this,super,yield,switch,case,break,continue,delete,void,do,static,readonly,public,private,protected,as,satisfies',
  python: 'def,class,return,if,elif,else,for,while,in,is,not,and,or,import,from,as,with,try,except,finally,raise,lambda,pass,break,continue,yield,async,await,global,nonlocal,assert,del,None,True,False',
  rust: 'fn,let,mut,const,static,struct,enum,impl,trait,use,mod,pub,crate,self,super,return,if,else,match,for,while,loop,in,as,where,async,await,move,ref,dyn,unsafe,type,enum,Some,None,Ok,Err,true,false',
  go: 'package,import,func,return,if,else,for,range,var,const,type,struct,interface,map,chan,go,defer,select,switch,case,break,continue,fallthrough,nil,true,false',
  java: 'class,interface,extends,implements,public,private,protected,static,final,void,int,long,double,float,boolean,char,String,new,return,if,else,for,while,switch,case,break,continue,throw,throws,try,catch,finally,import,package,this,super',
  css: 'color,background,background-color,display,position,top,right,bottom,left,width,height,margin,padding,border,border-radius,font,font-size,font-weight,line-height,flex,grid,opacity,transform,transition,animation',
  html: '',
  bash: 'if,then,else,fi,for,do,done,while,case,esac,function,echo,cd,export,local,return',
  sh: 'if,then,else,fi,for,do,done,while,case,esac,function,echo,cd,export,local,return',
  sql: 'select,from,where,insert,into,values,update,set,delete,create,table,drop,alter,join,left,right,inner,outer,on,group,by,order,having,limit,as,and,or,not,null,distinct,union,index',
};

function langKey(lang: string): string {
  return (lang || '').toLowerCase().replace(/^language-/, '');
}

function highlightHtml(code: string, lang: string): string {
  const key = langKey(lang);
  if (['text', 'plain', 'plaintext', 'log', ''].includes(key)) return escapeHtml(code);
  const words = (KEYWORDS[key] || KEYWORDS.js).split(',').filter(Boolean).join('|');
  const hashComments = ['python', 'bash', 'sh', 'yaml', 'yml', 'toml', 'ruby'].includes(key);
  const comment = hashComments ? '#[^\\n]*' : '\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/';
  const string = `"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\`(?:\\\\.|[^\`\\\\])*\``;
  const number = `\\b(?:0x[\\da-fA-F]+|\\d+(?:\\.\\d+)?)\\b`;
  const keyword = words ? `\\b(?:${words})\\b` : '^$';
  const tag = key === 'html' || key === 'xml' ? '<\\/?[A-Za-z][^>]*>' : '^$';
  const pattern = new RegExp(
    `(${comment})|(${string})|(${number})|(${keyword})|(${tag})`,
    'g',
  );
  let out = '';
  let last = 0;
  for (const match of code.matchAll(pattern)) {
    const at = match.index ?? 0;
    out += escapeHtml(code.slice(last, at));
    const cls = match[1]
      ? 'tok-comment'
      : match[2]
        ? 'tok-string'
        : match[3]
          ? 'tok-number'
          : match[4]
            ? 'tok-keyword'
            : 'tok-tag';
    out += `<span class="${cls}">${escapeHtml(match[0])}</span>`;
    last = at + match[0].length;
  }
  out += escapeHtml(code.slice(last));
  return out;
}

/**
 * HTML for the mirror layer behind the active textarea. It must contain the
 * exact same characters as the raw text; the spans only change colour.
 */
function activeMirrorHtml(block: Block): string {
  const escaped = escapeHtml(block.raw);
  if (block.kind === 'code') {
    const lines = block.raw.split('\n');
    const first = escapeHtml(lines[0] ?? '');
    const lastLine = lines.length > 1 ? escapeHtml(lines[lines.length - 1] ?? '') : '';
    const inner = lines.slice(1, Math.max(1, lines.length - 1)).join('\n');
    return (
      `<span class="md-mark">${first}</span>\n` +
      highlightHtml(inner, block.lang || '') +
      (lines.length > 1 ? `\n<span class="md-mark">${lastLine}</span>` : '')
    );
  }
  if (block.kind === 'table') {
    return escaped
      .replace(/(\|)/g, '<span class="md-mark">$1</span>')
      .replace(/(-{3,})/g, '<span class="md-mark">$1</span>');
  }
  if (block.kind === 'math') {
    return escaped.replace(/(\$\$?)/g, '<span class="md-mark">$1</span>');
  }
  if (block.kind === 'hr') {
    return `<span class="md-mark">${escaped}</span>`;
  }
  let html = escaped.replace(
    /(`)([^`\n]*)(`)/g,
    '<span class="md-mark">$1</span><span class="md-inlinecode">$2</span><span class="md-mark">$3</span>',
  );
  html = html
    .replace(/(\*\*|__|~~|==)/g, '<span class="md-mark">$1</span>')
    .replace(/(^|\n)(#{1,6}\s+)/g, '$1<span class="md-mark">$2</span>')
    .replace(/(^|\n)(>\s?)/g, '$1<span class="md-mark">$2</span>')
    .replace(/(^|\n)(\s*(?:[-*+]|\d+[.)])\s+)/g, '$1<span class="md-mark">$2</span>')
    .replace(/(^|\n)(\s*\[[ xX]\]\s+)/g, '$1<span class="md-mark">$2</span>')
    .replace(/(!?\[|\]\(|\))/g, '<span class="md-mark">$1</span>')
    .replace(/(\$)/g, '<span class="md-mark">$1</span>');
  return html;
}

// ---------------------------------------------------------------------------
// Block parsing helpers
// ---------------------------------------------------------------------------

interface ListNode {
  content: string;
  contentStart: number;
  checked: boolean | null;
  ordered: boolean;
  number: number;
  level: number;
  line: number;
  children: ListNode[];
}

function parseList(raw: string): ListNode[] {
  const lines = raw.split('\n');
  const roots: ListNode[] = [];
  const stack: ListNode[] = [];
  let offset = 0;
  lines.forEach((line, lineNo) => {
    const m = LIST.exec(line);
    if (m) {
      const indent = m[1].replace(/\t/g, '  ').length;
      const level = Math.max(0, Math.floor(indent / 2));
      const marker = m[2];
      const ordered = /\d/.test(marker);
      const number = ordered ? parseInt(marker, 10) : 0;
      let content = m[3];
      const contentStart = offset + line.indexOf(content);
      let checked: boolean | null = null;
      const task = /^\[([ xX])\]\s+/.exec(content);
      if (task) {
        checked = task[1].toLowerCase() === 'x';
        content = content.slice(task[0].length);
      }
      const node: ListNode = {
        content,
        contentStart: contentStart + (task ? task[0].length : 0),
        checked,
        ordered,
        number,
        level,
        line: lineNo,
        children: [],
      };
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      if (stack.length) stack[stack.length - 1].children.push(node);
      else roots.push(node);
      stack.push(node);
    }
    offset += line.length + 1;
  });
  return roots;
}

function renderListTree(nodes: ListNode[], ctx: EditorContext, keyPrefix: string, blockIndex: number): ReactNode {
  if (!nodes.length) return null;
  const groups: { ordered: boolean; items: ListNode[] }[] = [];
  for (const node of nodes) {
    const last = groups[groups.length - 1];
    if (last && last.ordered === node.ordered) last.items.push(node);
    else groups.push({ ordered: node.ordered, items: [node] });
  }
  return (
    <>
      {groups.map((group, gi) => {
        const Tag = group.ordered ? 'ol' : 'ul';
        return (
          <Tag key={`${keyPrefix}g${gi}`} start={group.ordered ? group.items[0].number : undefined}>
            {group.items.map((node, ni) => (
              <li
                key={`${keyPrefix}l${gi}-${ni}`}
                className={node.checked !== null ? 'task-list-item' : undefined}
              >
                {node.checked !== null && (
                  <input
                    type="checkbox"
                    checked={node.checked}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      e.stopPropagation();
                      ctx.onToggleTask(blockIndex, node.line);
                    }}
                  />
                )}
                {node.content ? (
                  renderInline(node.content, node.contentStart, ctx, `${keyPrefix}i${gi}-${ni}`)
                ) : (
                  <span className="md-empty">&nbsp;</span>
                )}
                {node.children.length > 0 &&
                  renderListTree(node.children, ctx, `${keyPrefix}c${gi}-${ni}`, blockIndex)}
              </li>
            ))}
          </Tag>
        );
      })}
    </>
  );
}

function parseTable(raw: string): { header: string[]; rows: string[][]; align: string[] } {
  const lines = raw.split('\n').filter((l) => l.trim());
  const split = (line: string) =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split(/(?<!\\)\|/)
      .map((cell) => cell.trim().replace(/\\\|/g, '|'));
  const header = split(lines[0] ?? '');
  const align = split(lines[1] ?? '').map((cell) => {
    if (/^:-+:$/.test(cell)) return 'center';
    if (/^-+:$/.test(cell)) return 'right';
    return 'left';
  });
  const rows = lines.slice(2).map(split);
  return { header, rows, align };
}

// ---------------------------------------------------------------------------
// Rendered block
// ---------------------------------------------------------------------------

export function BlockView(props: { block: Block; index: number; ctx: EditorContext }): JSX.Element {
  const { block, index, ctx } = props;
  const active = ctx.activeIndex === index;
  const blur = ctx.focusMode && ctx.activeIndex !== null && !active;

  const activate = (event: React.MouseEvent<HTMLDivElement>) => {
    if (active) return;
    const target = event.currentTarget as HTMLElement;
    let offset = 0;
    const doc = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    try {
      const range = doc.caretRangeFromPoint?.(event.clientX, event.clientY);
      if (range && target.contains(range.startContainer)) {
        const node = range.startContainer;
        const el =
          node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
        const startSpan = el?.closest('[data-start]') as HTMLElement | null;
        if (startSpan) {
          const start = Number(startSpan.dataset.start);
          if (Number.isFinite(start)) {
            const r = document.createRange();
            r.selectNodeContents(startSpan);
            try {
              r.setEnd(node, range.startOffset);
            } catch {
              /* keep whole span */
            }
            offset = start + r.toString().length;
          }
        }
      }
    } catch {
      offset = 0;
    }
    offset = Math.max(0, Math.min(block.raw.length, offset));
    ctx.onActivate(index, offset, offset);
  };

  if (active) {
    return (
      <div
        className={`block kind-${block.kind} level-${block.level ?? 0} is-active`}
        data-block-index={index}
        data-kind={block.kind}
      >
        <ActiveEditor block={block} index={index} ctx={ctx} />
      </div>
    );
  }

  const content = renderBlockContent(block, index, ctx);

  return (
    <div
      className={[
        'block',
        `kind-${block.kind}`,
        block.level ? `level-${block.level}` : '',
        blur ? 'is-blurred' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-block-index={index}
      data-kind={block.kind}
      onClick={activate}
    >
      {content}
    </div>
  );
}

function renderBlockContent(block: Block, index: number, ctx: EditorContext): ReactNode {
  const raw = block.raw;
  switch (block.kind) {
    case 'heading': {
      const first = raw.split('\n', 1)[0];
      const m = HEADING.exec(first);
      let level = block.level ?? 1;
      let content = m ? m[2] : first;
      let base = m ? first.indexOf(content) : 0;
      if (!m && raw.includes('\n')) {
        const lines = raw.split('\n');
        content = lines[0];
        base = 0;
        if (/^=+\s*$/.test(lines[1] ?? '')) level = 1;
        else if (/^-{2,}\s*$/.test(lines[1] ?? '')) level = 2;
      }
      const Tag = (`h${Math.min(6, Math.max(1, level))}`) as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      return (
        <Tag className="md-heading">
          {content ? renderInline(content, base, ctx, `h${index}`) : <span className="md-empty">标题</span>}
        </Tag>
      );
    }
    case 'paragraph':
      return (
        <p className="md-paragraph">
          {raw.trim()
            ? renderInline(raw, 0, ctx, `p${index}`)
            : <span className="md-empty">输入文字…</span>}
        </p>
      );
    case 'list': {
      const nodes = parseList(raw);
      return (
        <div className="md-list">
          {renderListTree(nodes, ctx, `l${index}`, index)}
        </div>
      );
    }
    case 'quote': {
      const lines = raw.split('\n').map((line) => line.replace(QUOTE, ''));
      const alert = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i.exec(lines[0] ?? '');
      let firstText = lines[0] ?? '';
      if (alert) firstText = firstText.replace(alert[0], '');
      const text = [firstText, ...lines.slice(1)].join('\n').replace(/\n{2,}/g, '\n\n');
      return (
        <blockquote className={`md-quote ${alert ? `alert alert-${alert[1].toLowerCase()}` : ''}`}>
          {alert && <div className="md-alert-title">{alert[1].toUpperCase()}</div>}
          {text.split(/\n{2,}/).map((part, i) => (
            <p key={i}>{renderInline(part, 0, ctx, `q${index}-${i}`)}</p>
          ))}
        </blockquote>
      );
    }
    case 'code': {
      const lines = raw.split('\n');
      const lang = block.lang || '';
      const inner = lines.slice(1, Math.max(1, lines.length - 1)).join('\n');
      return (
        <div className="md-codeblock">
          <div className="md-codeblock-head">
            <span className="md-codeblock-lang">{lang || 'text'}</span>
            <button
              type="button"
              className="md-codeblock-copy"
              onClick={(e) => {
                e.stopPropagation();
                ctx.onCopy(inner);
              }}
            >
              复制
            </button>
          </div>
          <pre>
            <code
              className={`language-${lang || 'text'}`}
              dangerouslySetInnerHTML={{ __html: highlightHtml(inner, lang) }}
            />
          </pre>
        </div>
      );
    }
    case 'math': {
      const tex = raw.replace(/^\s*\$\$/, '').replace(/\$\$\s*$/, '').trim();
      return (
        <div
          className="md-math-block"
          dangerouslySetInnerHTML={{ __html: katexHtml(tex, true) }}
        />
      );
    }
    case 'table': {
      const table = parseTable(raw);
      return (
        <div className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {table.header.map((cell, i) => (
                  <th key={i} style={{ textAlign: (table.align[i] || 'left') as CSSProperties['textAlign'] }}>
                    {renderInline(cell, 0, ctx, `th${index}-${i}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, ri) => (
                <tr key={ri}>
                  {table.header.map((_, ci) => (
                    <td key={ci} style={{ textAlign: (table.align[ci] || 'left') as CSSProperties['textAlign'] }}>
                      {renderInline(row[ci] ?? '', 0, ctx, `td${index}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case 'hr':
      return <hr className="md-hr" />;
    case 'frontmatter': {
      const body = raw.replace(/^---\s*\n?/, '').replace(/\n?(---|\.\.\.)\s*$/, '');
      const rows = body
        .split('\n')
        .map((line) => /^([^:]+):\s*(.*)$/.exec(line))
        .filter(Boolean) as RegExpExecArray[];
      if (!rows.length) {
        return <pre className="md-frontmatter">{raw}</pre>;
      }
      return (
        <div className="md-frontmatter-card">
          <div className="md-frontmatter-title">属性</div>
          {rows.map((row, i) => (
            <div className="md-frontmatter-row" key={i}>
              <span className="md-frontmatter-key">{row[1]}</span>
              <span className="md-frontmatter-value">{row[2]}</span>
            </div>
          ))}
        </div>
      );
    }
    case 'html':
      return <pre className="md-htmlblock">{raw}</pre>;
    case 'toc':
      return (
        <div className="md-toc">
          <div className="md-toc-title">目录</div>
          {ctx.outline.length === 0 && <div className="md-toc-empty">文档中还没有标题</div>}
          {ctx.outline.map((item, i) => (
            <button
              key={i}
              type="button"
              className={`md-toc-item level-${item.level}`}
              onClick={(e) => {
                e.stopPropagation();
                ctx.onActivate(item.blockIndex, 0, 0);
                document
                  .querySelector(`[data-block-index="${item.blockIndex}"]`)
                  ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
              }}
            >
              {item.text}
            </button>
          ))}
        </div>
      );
    default:
      return <p>{raw}</p>;
  }
}

// ---------------------------------------------------------------------------
// Active block editor
// ---------------------------------------------------------------------------

export function ActiveEditor(props: {
  block: Block;
  index: number;
  ctx: EditorContext;
}): JSX.Element {
  const { block, index, ctx } = props;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const mirror = useMemo(() => activeMirrorHtml(block), [block]);
  const mounted = useRef(false);

  const resize = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const height = ta.scrollHeight;
    ta.style.height = `${height}px`;
    if (mirrorRef.current) mirrorRef.current.style.minHeight = `${height}px`;
  };

  useLayoutEffect(() => {
    resize();
  }, [block.raw]);

  useEffect(() => {
    resize();
    const ta = textareaRef.current;
    if (!ta) return;
    const observer = new ResizeObserver(() => resize());
    observer.observe(ta);
    if (!mounted.current) {
      mounted.current = true;
      ta.focus({ preventScroll: true });
      const start = Math.min(block.raw.length, ctx.selectionStart ?? block.raw.length);
      const end = Math.min(block.raw.length, ctx.selectionEnd ?? start);
      try {
        ta.setSelectionRange(start, end);
      } catch {
        /* ignore */
      }
    }
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const replaceSelection = (insert: string, selectOffset?: number) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const next = block.raw.slice(0, start) + insert + block.raw.slice(end);
    ctx.onUpdate(index, next);
    const caret = selectOffset ?? start + insert.length;
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(caret, caret);
      ctx.onSelection(index, caret, caret);
    });
  };

  const wrap = (before: string, after: string, placeholder: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = block.raw.slice(start, end) || placeholder;
    const next =
      block.raw.slice(0, start) + before + selected + after + block.raw.slice(end);
    ctx.onUpdate(index, next);
    const selStart = start + before.length;
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(selStart, selStart + selected.length);
      ctx.onSelection(index, selStart, selStart + selected.length);
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = event.currentTarget;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const mod = event.metaKey || event.ctrlKey;

    if (event.key === 'Escape') {
      event.preventDefault();
      ctx.onDeactivate();
      return;
    }

    if (mod && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === 'b') {
        event.preventDefault();
        wrap('**', '**', '加粗文字');
        return;
      }
      if (key === 'i') {
        event.preventDefault();
        wrap('*', '*', '斜体文字');
        return;
      }
      if (key === 'e') {
        event.preventDefault();
        wrap('`', '`', '代码');
        return;
      }
      if (key === 'k') {
        event.preventDefault();
        wrap('[', '](https://)', '链接文字');
        return;
      }
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      const lineStart = block.raw.lastIndexOf('\n', start - 1) + 1;
      const lineEndRaw = block.raw.indexOf('\n', start);
      const lineEnd = lineEndRaw < 0 ? block.raw.length : lineEndRaw;
      if (start !== end || event.shiftKey) {
        const selected = block.raw.slice(lineStart, lineEnd);
        const changed = event.shiftKey
          ? selected.replace(/^ {1,2}/gm, '')
          : selected.replace(/^/gm, '  ');
        const next = block.raw.slice(0, lineStart) + changed + block.raw.slice(lineEnd);
        ctx.onUpdate(index, next);
        requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (!el) return;
          el.focus({ preventScroll: true });
          el.setSelectionRange(lineStart, lineStart + changed.length);
        });
        return;
      }
      replaceSelection('  ');
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
      if (block.kind === 'code' || block.kind === 'math' || block.kind === 'frontmatter' || block.kind === 'html') {
        return;
      }
      if (block.kind === 'list') {
        const lineStart = block.raw.lastIndexOf('\n', start - 1) + 1;
        const currentLine = block.raw.slice(lineStart, start);
        const m = LIST.exec(currentLine);
        if (m && currentLine.trim() === m[2]) {
          // Empty item: leave the list.
          event.preventDefault();
          const next =
            block.raw.slice(0, lineStart) + '\n' + block.raw.slice(start);
          ctx.onUpdate(index, next);
          requestAnimationFrame(() => {
            const el = textareaRef.current;
            if (!el) return;
            const caret = lineStart + 1;
            el.focus({ preventScroll: true });
            el.setSelectionRange(caret, caret);
          });
          return;
        }
        if (m) {
          event.preventDefault();
          const prefix = `${m[1]}${m[2] === '+' || m[2] === '-' || m[2] === '*' ? m[2] : `${parseInt(m[2], 10) + 1}.`} `;
          replaceSelection(`\n${prefix}`);
          return;
        }
      }
      if (block.kind === 'quote') {
        event.preventDefault();
        replaceSelection('\n> ');
        return;
      }
      if (block.kind === 'paragraph' || block.kind === 'heading') {
        event.preventDefault();
        const before = block.raw.slice(0, start);
        const after = block.raw.slice(end);
        ctx.onSplit(index, before, after);
        return;
      }
    }

    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault();
      replaceSelection('  \n');
      return;
    }

    if (event.key === 'ArrowUp' && start === end) {
      const before = block.raw.slice(0, start);
      if (!before.includes('\n')) {
        event.preventDefault();
        ctx.onMove(index, -1);
        return;
      }
    }
    if (event.key === 'ArrowDown' && start === end) {
      const after = block.raw.slice(start);
      if (!after.includes('\n')) {
        event.preventDefault();
        ctx.onMove(index, 1);
        return;
      }
    }

    if (event.key === 'Backspace' && start === 0 && end === 0) {
      event.preventDefault();
      ctx.onMerge(index, -1);
      return;
    }
    if (event.key === 'Delete' && start === block.raw.length && end === block.raw.length) {
      event.preventDefault();
      ctx.onMerge(index, 1);
      return;
    }
  };

  const kindClass = block.kind === 'heading' ? `heading h${block.level ?? 1}` : block.kind;

  return (
    <div className={`active-shell active-${kindClass}`}>
      <div
        ref={mirrorRef}
        className="active-mirror"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: mirror || '<span class="md-empty">输入文字…</span>' }}
      />
      <textarea
        ref={textareaRef}
        className="active-textarea"
        value={block.raw}
        spellCheck
        onChange={(e) => {
          ctx.onUpdate(index, e.target.value);
          ctx.onSelection(index, e.target.selectionStart, e.target.selectionEnd);
        }}
        onKeyDown={onKeyDown}
        onSelect={(e) => {
          const el = e.currentTarget;
          ctx.onSelection(index, el.selectionStart, el.selectionEnd);
        }}
        onKeyUp={(e) => {
          const el = e.currentTarget;
          ctx.onSelection(index, el.selectionStart, el.selectionEnd);
        }}
        onClick={(e) => {
          const el = e.currentTarget;
          ctx.onSelection(index, el.selectionStart, el.selectionEnd);
        }}
        aria-label="Markdown 编辑区"
      />
    </div>
  );
}

