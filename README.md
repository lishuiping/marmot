<div align="center">
  <img src="docs/images/banner.jpg" alt="Marmot" width="100%" />
</div>

<h1 align="center">Marmot</h1>

<p align="center">
  <b>一个完全免费、无需激活码、无需账户的实时渲染 Markdown 编辑器</b>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg" alt="Platform" />
  <img src="https://img.shields.io/badge/electron-37-blue.svg" alt="Electron" />
  <img src="https://img.shields.io/badge/typescript-5.6-blue.svg" alt="TypeScript" />
</p>

<p align="center">
  <a href="#为什么开源">为什么开源</a> ·
  <a href="#功能特性">功能特性</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#目录结构">目录结构</a> ·
  <a href="#技术栈">技术栈</a> ·
  <a href="#路线图">路线图</a>
</p>

---

## 为什么开源

**Typora 需要付费购买。**

Typora 是一款优秀的 Markdown 编辑器，但它是一款**商业付费软件**——需要一次性付费购买激活码授权才能使用。对只想安静写点东西的用户来说，这笔支出并不总是合理，尤其是学生、开发者日常写文档和笔记的场景。

Marmot 的出发点就是这件事：

> **把 Typora 那种"输入即渲染"的写作体验，做成一个任何人可以免费使用、免费修改、免费分发的开源项目。**

所以 Marmot 从第一天起就带着这些原则：

| 原则 | 具体表现 |
|---|---|
| **完全免费** | 没有激活码、没有试用期、没有功能阉割版 |
| **无需账户** | 打开就能写，不注册、不登录、不联网 |
| **本地优先** | 文档只保存在你自己的电脑上，不上传任何服务器 |
| **无遥测** | 代码里没有一行数据上报逻辑 |
| **开源可审计** | 全部源码公开，你可以自己验证上面每一条 |
| **不捆绑** | 没有内置推广、没有推荐安装、没有"了解更多"弹窗 |

### 关于与 Typora 的关系

请务必明确：

- Marmot 是一个**完全独立、从零编写的原创实现**，所有代码均由本项目作者编写。
- 本项目**不包含** Typora 的任何源代码、资源、图标、字体或受版权保护的素材。
- Marmot 受到 Typora 的**交互思路**启发（就像很多编辑器受到彼此启发一样），但两者没有从属关系，也不存在代码搬运。
- Marmot 使用 [Apache-2.0](LICENSE) 协议开源，这是一个宽松许可，允许任何人自由使用、修改、商用衍生作品。
- 如果你喜欢 Typora，**请支持 Typora**。Typora 的作者投入了大量心血，它值得被付费使用。Marmot 的存在不是要取代谁，而是给那些不愿意或不能付费的人多一个选择。

如果你也在为一款好的工具付费与否纠结过，希望这个项目能给你一个喘息的机会。

---

## 功能特性

### ✍️ 编辑

- **实时渲染**——输入即预览，没有分屏、没有延迟，所见即所得
- **块级编辑**——光标停在哪个段落，哪个段落就展开 Markdown 源码；移开后又变回排版好的样子
- **完整语法支持**——标题、加粗、斜体、删除线、行内代码、围栏代码块、引用、有序/无序列表、任务列表、表格、分割线、链接、图片、脚注
- **语法高亮**——代码块着色显示
- **数学公式**——内置 [KaTeX](https://katex.org/)，支持 `$...$` 与 `$$...$$`
- **源码模式**（`⌘/`）——随时切到纯源码编辑，格式完全可控
- **专注模式**（`⌘⇧F`）——隐藏一切干扰，只剩文字
- **打字机模式**——当前行永远保持在视窗中央
- **查找与替换**（`⌘F`）——支持区分大小写

### 📁 文件

- 打开文件（`⌘O`）、打开文件夹（`⌘⇧O`）
- 保存（`⌘S`）、另存为（`⌘⇧S`）
- 导出 HTML、导出 Markdown
- 文件树侧边栏 + 大纲侧边栏（大纲点击可跳转）
- 最近文件列表
- 多标签页编辑
- 拖拽文件到窗口直接打开
- **所有文档都留在本机**，没有任何同步或上传

### 🎨 界面

- **三套主题**：明亮 / 夜色 / 纸墨
- **偏好设置**（`⌘,`）：正文字体、字号、正文宽度、显示行号、拼写检查、自动保存
- 缩放（放大 / 缩小 / 恢复 100%）
- 中文界面，深色模式完整适配

### 🛡️ 隐私

- 无账号系统、无遥测、无崩溃上报
- 不访问网络（除你自己在文档里写的链接）
- 文档读写完全走本地文件系统

---

## 快速开始

### 环境要求

- **Node.js ≥ 18**
- **npm ≥ 9**
- macOS / Windows / Linux 均可（开发环境为 macOS）

### 安装与运行

```bash
# 1. 克隆仓库
git clone https://github.com/lishuiping/marmot.git
cd marmot

# 2. 进入应用目录
cd app

# 3. 安装依赖（首次约需下载 Electron，约 100MB）
npm install

# 4. 构建并启动
npm start
```

`npm start` 会先执行类型检查与打包，再拉起应用窗口。

### 可用脚本

在 `app/` 目录下：

| 命令 | 说明 |
|---|---|
| `npm install` | 安装依赖 |
| `npm run build` | 类型检查（`tsc --noEmit`）+ 打包到 `dist/` |
| `npm start` | 构建后启动应用 |
| `npm run electron` | 直接启动（不重新构建） |
| `npm run shot` | 构建后启动并截取界面到 `app/shots/now.png` |

> **提示**：`npm run build` 会先跑 `prebuild`，它只在依赖缺失时才执行 `npm install`，因此重复构建不会重复下载。

---

## 目录结构

```
marmot/
├── README.md                   # 本文档
├── LICENSE                     # Apache-2.0 协议
├── .gitignore
├── docs/
│   └── images/
│       ├── banner.jpg          # README 横幅图
│       ├── icon.png            # 应用图标
│       └── screenshot-main.jpg # 界面截图
└── app/
    ├── package.json            # 依赖与脚本定义
    ├── tsconfig.json           # TypeScript 配置
    ├── index.html              # 渲染进程 HTML 模板
    ├── build.mjs               # esbuild 打包脚本
    ├── assets/
    │   ├── marmot-icon-128.png # 界面内使用的图标
    │   └── marmot.icns         # macOS 图标
    ├── scripts/
    │   ├── deps.mjs            # 首次构建自动安装依赖
    │   └── run-electron.mjs    # 以干净环境启动 Electron
    ├── src/
    │   ├── main/
    │   │   ├── main.ts         # 主进程：窗口、菜单、IPC、文件读写
    │   │   └── preload.ts      # contextBridge 桥接层
    │   ├── renderer/
    │   │   ├── index.tsx       # React 挂载入口
    │   │   ├── App.tsx         # 主界面（编辑器、侧栏、弹窗）
    │   │   ├── markdown.tsx    # Markdown 解析与渲染
    │   │   ├── styles.css      # 全部样式与主题变量
    │   │   └── globals.d.ts    # 全局类型声明
    │   └── shared/
    │       └── types.ts        # 主进程 / 渲染进程共享类型
    ├── MECHANICS.md            # 交互机制说明
    ├── mechanics.json          # 机制数据（结构化）
    └── dist/                   # 构建产物（git 忽略）
```

### 分层说明

```
┌─────────────────────────────────────────┐
│  渲染进程 (src/renderer)                 │
│  React 18 + TypeScript                   │
│  ├─ App.tsx      界面与交互状态           │
│  ├─ markdown.tsx Markdown 解析与渲染      │
│  └─ styles.css   主题变量与全部样式        │
└──────────────┬──────────────────────────┘
               │  window.marmot.*  (contextBridge)
               │  IPC: invoke / send
┌──────────────┴──────────────────────────┐
│  预加载层 (src/main/preload.ts)          │
│  contextIsolation: true                  │
│  nodeIntegration: false                  │
└──────────────┬──────────────────────────┘
               │
┌──────────────┴──────────────────────────┐
│  主进程 (src/main/main.ts)               │
│  窗口 · 菜单 · 文件系统 · 原生对话框       │
│  marmot:// 本地图片协议                   │
└─────────────────────────────────────────┘
```

安全基线：渲染进程**不能**直接访问 Node.js API，所有系统能力都必须经由 preload 白名单暴露的接口调用。

---

## 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 桌面壳 | Electron 37 | 跨平台，原生菜单与文件系统访问 |
| 界面 | React 18 + TypeScript 5.6 | 严格类型，`tsc --noEmit` 参与构建 |
| 打包 | esbuild | 极快的增量打包 |
| 公式 | KaTeX | 数学公式渲染 |
| 协议 | Apache-2.0 | 宽松许可，含专利授权条款 |

**零运行时服务依赖**——不需要后端，不需要数据库，不需要云同步。

---

## 路线图

- [ ] 打包分发（`electron-builder`，产出 dmg / exe / AppImage）
- [ ] 代码签名与公证
- [ ] 可视化表格编辑
- [ ] 自定义 CSS 主题
- [ ] 多窗口
- [ ] 全文语法高亮（而非仅代码块）
- [ ] 写作统计图表
- [ ] 国际化（i18n）

---

## 贡献

欢迎任何形式的贡献——提交 Issue、报告 Bug、完善文档、翻译界面，或者直接提 PR。

```bash
git clone https://github.com/lishuiping/marmot.git
cd marmot/app
npm install
npm start
```

开发前请确保 `npm run build` 零错误通过。项目使用 `tsc --noEmit` 做类型检查，类型定义缺失会导致构建失败。

---

## 致谢

- [Electron](https://electronjs.org/) — 跨平台桌面框架
- [React](https://react.dev/) — 界面库
- [KaTeX](https://katex.org/) — 数学公式渲染
- [esbuild](https://esbuild.github.io/) — 打包工具

---

## 许可证

[Apache License 2.0](LICENSE)

```
Copyright 2026 Marmot contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

---

<p align="center">
  <sub>为那些不想为写作工具付费的人而做。</sub>
</p>
