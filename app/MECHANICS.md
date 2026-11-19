# Marmot mechanics — values taken from the original

This file records what was measured in the original Typora installation and how
Marmot reproduces it. It is a clean-room document: the original's code was
read for facts (numbers, formulas, rules), and the implementation below was
written independently.

Original program: `/Applications/Typora.app/Contents/MacOS/Typora`
SHA-256 `907a0ff17b42c117cae09871b5d393b6c6e5daa7aa12d0b16fd549480b6fc01c`
(mach-o fat, arm64, 4,672 functions, 5,980 strings). Its editor logic is a
SystemJS/browserify bundle at
`/Applications/Typora.app/Contents/Resources/TypeMark/appsrc/main.js`.

## 1. Native shell — functions read with the decompiler

Every address below is a virtual address in the original executable. Names are
the Objective-C method symbols the decompiler recovered. The built-in lifter was
used: the bundled Ghidra has no macOS decompiler, so the listings are
register-level and are read for control flow and constants only. Calls such as
`sub_1000885f0` are `objc_msgSend` stubs; method names come from the symbol
table, not from the pseudo-C.

| Address | Method | What it establishes |
| --- | --- | --- |
| `0x100031abc` | `+[TyporaUtils initSettings]` | Boots the settings store (`abnerworks.typora.plist`), logs `[Setting] current version: %@` and `[Setting] forceUpdateTheme: %hhd`, and seeds defaults when a key is missing. |
| `0x100033114` | `+[TyporaUtils initThemes:doBackup:]` | Installs the built-in themes into the user's theme folder, optionally backing up the old folder first. |
| `0x100032fa0` | `+[TyporaUtils getThemeFolder]` | Resolves the active theme directory; the editor loads `<theme>.css` from it. |
| `0x10000ec44` | `-[TyWindowController(ViewMode) toggleSourceMode:]` | Flips the source-mode flag (`w0 ^ 1`), refreshes the changed view, and exits focus/typewriter mode when entering source mode. |
| `0x10000ed38` | `-[TyWindowController(ViewMode) toggleFocusMode:]` | Sends the focus-mode toggle to the web editor (`File.editor.updateFocusMode`). |
| `0x10000ed70` | `-[TyWindowController(ViewMode) toggleTypeWriterMode:]` | Sends the typewriter toggle to the web editor (`File.editor.setTypeWriterMode`). |
| `0x10000ef08` | `-[TyWindowController(ViewMode) toggleOutlinePanel:]` | Outline is a panel toggle, not a separate window. |
| `0x100015f50` | `-[TitlebarRightAccessoryViewController refreshWordCount]` | Pulls fresh counts from the page and repaints the titlebar counter. |
| `0x10001755c` | `-[TitlebarRightAccessoryViewController updateWordCount:all:delimiter:]` | Word-count label rule: show `sel / all` only while `0 < sel < all`; otherwise show `all`. |
| `0x1000166a8` | `-[TitlebarRightAccessoryViewController buildWordCountMenuItem:width:unit:useView:]` | Builds the Words / Characters / Lines / Minutes menu. Width math uses `max(0, a-b) + 1`, rounded, with a 12pt text measurement and 20pt padding for the view variant. |
| `0x100043a10` | `-[Document shouldBackupDocumentSnap]` | A snapshot is produced only when the document has an autosave snapshot path. |
| `0x100043ee8` | `-[Document backupDocumentSnapSync]` | Synchronous snapshot writer; retries up to 30 times (`0x1e`) while the snapshot is unavailable. |
| `0x10002e114` | `-[TTWindow showsAutosaveButton]` | Native autosave UI is delegated to AppKit's document model; the editor's own autosave is the web side described below. |

The native layer therefore owns windows, menus, theme installation and the
titlebar counter. Everything about text, counting, rendering and scheduling is
in the web bundle, which is where the concrete product values live.

## 2. Editor defaults (main.js, module `3b`, `File.DEFAULT_OPTIONS`)

These are the real defaults. Values in **bold** are now used by Marmot.

| Option | Value | Meaning |
| --- | --- | --- |
| `indentByTab` | `false` | Tab inserts spaces, not a tab character. |
| `indentSize` | **2** | Two spaces per indent level. |
| `codeIndentSize` | **4** | Four spaces inside fenced code. |
| `enableInlineMath` | **true** | `$...$` renders inline. |
| `enableDiagram` | `false` | Mermaid is opt-in. |
| `enableAlert` | **true** | GitHub-style `> [!NOTE]` alerts. |
| `copyMarkdownByDefault` | `false` | Copy copies the rendered selection, not Markdown source. |
| `showLineNumbersForFence` | `false` | No line numbers in code blocks by default. |
| `useRelativePathForImg` | `false` | Image paths are not rewritten to relative by default. |
| `enableAutoSave` | **false** | Autosave is opt-in. |
| `headingStyle` / `ulStyle` / `olStyle` | `0` / `0` / `0` | Default heading and list marker styles. |
| `strictMarkdown` | `false` | Typora-flavoured Markdown, not CommonMark-strict. |
| `preferCRLF` | `false` | LF by default. |
| `preferFinalNewline` | `false` | Saving does not force a trailing newline. |
| `noLineWrapping` | `false` | Soft wrap on. |
| `wordCountDelimiter` | **0** | Counter starts in Words mode (Words=0, Characters=1, Lines=2, Minutes=3). |
| `wordsPerMinute` | **382** | Reading-speed divisor. |
| `defaultExtension` | **`md`** | New files are `.md`. |
| `presetSpellCheck` | `"auto"` | Spellcheck follows the system language. |
| `sidebarWidth` | `null` | Sidebar width is remembered per window, not globally forced. |

## 3. Word counting — the exact formula

Source: module `40` in the web bundle, the local function used by
`WordCount.getWordCount()` (class starts at bundle line 9809). The counter runs
over the visible text of every block, so Markdown markers are not counted, while
fenced code contributes its contents (plus the fence language line).

```
count(text):
  if text.trim() is empty: return 0
  cjk = 0
  body = text
    .replace(/[\u3040-\uABFF\uD7A4-\uFAFF]/gi, ch => { cjk++; return " "; })
    .replace(/['’]\w+/g, "b")                                  // keep contractions as one token
    .replace(/(^|\s+)[(\u3000-\u303F)!-\/:-@\[-`{-~]+(\s+|$)/gm, " ")
  parts = ("d " + body + " d").split(/[(\u3000-\u303F)\s!-,\\:-@\[-`{-~]+/).length
  return cjk + parts - 2
```

Consequences (all verified against the regex):

- Every CJK / Hiragana / Katakana / Hangul character (U+3040–U+ABFF, U+D7A4–U+FAFF) counts as **one word**, without needing spaces.
- Latin words are split on whitespace and punctuation; `don't` and `’` contractions stay one word.
- A standalone punctuation token at the start/end does not create a word (the `-2` trims the two sentinel `d` tokens).
- Empty or whitespace-only text returns `0`.

Related rules:

- **Characters** = `markdown.length` (UTF-16 code units), not code points.
- **Lines** = `(markdown.match(/\n/g) || []).length + 1`.
- **Reading time** = `Math.round(words / 382)`. When the result is 0 the UI
  shows `≤ 1`; when it is 1 the unit is singular. There is no `Math.max(1, …)`
  forcing: an empty document reads 0 and is displayed as `≤ 1`.
- Selection counts are debounced by **50 ms** and are clamped to the document
  total before being shown as `sel / all`.

Native side of the same feature: `refreshWordCount` (`0x100015f50`),
`updateWordCount:all:delimiter:` (`0x10001755c`) and
`buildWordCountMenuItem:width:unit:useView:` (`0x1000166a8`).

## 4. Autosave and backup

Source: `File.scheduleBackupWindow`, `File.backupWindow`,
`File.startAutoSaveAndBackupService` (bundle around lines 8996–9062).

- Edits schedule a smart backup: **1,000 ms of idle**, with a hard ceiling of
  **10,000 ms** after the first unsaved change (`requestSmartSchedule(…, 1e3, 1e4)`).
- The background service checkpoints every **600,000 ms (10 minutes)**.
- Drafts are dropped every **144,000,000 ms (4 hours)**, and on power changes.
- A save only happens when the document has a path, has unsaved changes, the
  window is active and `enableAutoSave` is on.
- Files are written in place; there is no forced trailing newline.

Native support: `shouldBackupDocumentSnap` (`0x100043a10`) and
`backupDocumentSnapSync` (`0x100043ee8`).

## 5. Typewriter mode

Source: `File.editor.setTypeWriterMode` (bundle lines 57374–57386).

For a content viewport of height `H` and line height `L`:

```
e           = (H - L) / 2
padding-top = e - L
space-after = e + L        (implemented as the effective bottom padding)
```

The rule is applied after a **100 ms** delay, so layout has settled; it is
recomputed on resize. The caret line is then scrolled to the vertical centre.
The class `ty-on-typewriter-mode` is added to `<body>` while active.

Focus mode only toggles `body.on-focus-mode`; it re-applies after **100 ms** to
survive the theme repaint, and exits together with typewriter mode when source
mode is entered (see `toggleSourceMode:` at `0x10000ec44`).

## 6. Typography and themes

`style/themes/github.css` (light):

- Root font size **16px**, body line-height **1.6**, text `rgb(51,51,51)`.
- `#write`: `max-width: 860px`, `margin: 0 auto`, `padding: 30px`,
  `padding-bottom: 100px`; widens to **1024px at ≥1400px** and **1200px at
  ≥1800px** viewport width.
- Headings: `h1 2.25em/1.2`, `h2 1.75em/1.225`, `h3 1.5em/1.43`,
  `h4 1.25em`, `h5/h6 1em`; `h1/h2` have a 1px `#eee` bottom border;
  headings use `margin: 1rem 0`.
- Paragraphs / blockquotes / lists / tables: `margin: 0.8em 0`; lists
  `padding-left: 30px`.
- Blockquote: `border-left: 4px solid #dfe2e5; padding: 0 15px; color: #777`.
- Table cells: `padding: 6px 13px`, 1px `#dfe2e5` borders, zebra `#f8f8f8`.
- Inline code / fences: `#f8f8f8` background, 1px `#e7eaed` border, radius 3px,
  `font-size: 0.9em`; fences have 15px vertical margins.
- `hr`: 2px tall, `#e7e7e7`, 16px vertical margin.

`style/themes/night.css` (dark):

- Background `#363B40`, text `#b8bfc6`, sidebar `#2E3033`, selection `#4a89dc`.
- `#write` max-width **914px** (1024/1200 at the same breakpoints),
  line-height **1.625rem**; headings `2.5rem / 1.63rem / 1.17rem / 1.12rem`.

`style/base.css`: root font-size **14px** before a theme overrides it, body
line-height **1.42857143**, `#write` top padding **36px**, selection
`#B5D6FC`, title bar **20px** (28px on macOS 11+).

## 7. How Marmot uses these values

| Original value | Implementation |
| --- | --- |
| Word formula, 382 wpm, 50 ms selection debounce | `countWords()` in `src/renderer/markdown.tsx`; timings in `src/renderer/App.tsx` (`WORDS_PER_MINUTE`, `readTimeLabel`, `metricValue`). |
| Metric switch Words/Characters/Lines/Minutes | `wordMetric` state in `App.tsx`, persisted as `pd.wordMetric`; the status-bar popover switches the displayed metric. |
| Autosave 1s idle / 10s cap / 10min checkpoint | `saveSilently` and the two effects below `saveDoc` in `App.tsx`; gated by the `autoSave` preference. |
| Typewriter centring formula | `--tw-pad-top` / `--tw-pad-bottom` set in `App.tsx`, consumed by `.typewriter-mode .write` in `styles.css`. |
| 860 → 1024 → 1200 column | default `contentWidth` 860 and `effectiveContentWidth` in `App.tsx`. |
| 16px / 1.6 / 2.25em headings / 30px padding | `styles.css` (already matched, re-checked against github.css). |
| 2-space indent, 4-space code indent | block editor Tab handler already inserts two spaces and Shift+Tab removes them. |
| md default extension | `defaultExtension` behaviour of the save dialog (`md` filters). |

## 8. Honest limits

- The executable's Objective-C methods are only the shell. The behaviour that
  matters (counting, scheduling, rendering) is JavaScript; values were read from
  the shipped bundle, not guessed.
- Ghidra's decompiler is unavailable for macOS in the installed engine, so the
  native listings are register-level. Constants such as `0x1e` (30 retries) and
  the 12pt/20pt menu metrics are read from those listings; no control-flow
  equivalence is claimed.
- Typora's live-preview hiding of markers depends on its own DOM/brush engine.
  Marmot reproduces the interaction (focused block shows markers, others
  render) but not its internals.
- Reading time is a rounded estimate by definition; no per-language speed table
  is present in the original either.
