# 🐾 AI Desktop Pet · 桌面 AI 桌宠

一个透明的桌面浮窗，你的 AI 就住在里面——**打字、开麦都能聊，会说话、会看图、会换形象**。

[![Electron](https://img.shields.io/badge/Electron-44-47848F.svg)](https://www.electronjs.org)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> 基于 **Electron + Claude Code + 豆包语音**，一个能开麦、能打字、会读图、会朗读的桌面宠物浮窗。

---

## ✨ 功能

- 💬 **对话**：打字，或按住开麦说话（语音实时转文字）
- 🔊 **语音朗读**：AI 回复用豆包音色朗读（可开关）
- 👀 **视觉**：拖一张图给它，它能看懂（DeepSeek 视觉模型）
- 🖼️ **换形象**：双击人物选图，或拖图进来换
- 📐 **缩放**：右下角等比例拖拽
- 🖱️ **移动**：按住人物拖动窗口
- 🌫️ **透明浮窗**：背景透明，文字浮在桌面

---

## 🚀 快速开始

### 环境要求

- Node.js 18+
- Claude Code（`npm i -g @anthropic-ai/claude-code`）

### 安装

```bash
npm install
```

### 配置（改 3 处）

1. **形象图**：把 `assets/avatar.jpg` 换成你的图
2. **豆包 key**（朗读 + 识别）：
   - `main.js` 里的 `DOUBAO`（`appid` / `token` / `voice` 音色）
   - `asr.js` 里的 `DOUBAO`（`appid` / `token` / `resourceId`）
3. **Claude 路径**：`main.js` 里的 `CLAUDE_EXE`（终端敲 `where claude` 查）

### 运行

```bash
npm start
```

---

## 🎮 使用

| 操作 | 方式 |
|------|------|
| 打字聊天 | 输入框打字，回车 |
| 开麦说话 | 点 🎙，说完自动出字发过去 |
| 我说话开关 | 点 🔊（开 = 我的回复会朗读） |
| 移动窗口 | 按住人物图拖动 |
| 缩放 | 按住右下角小三角拖（等比例） |
| 换形象 | 双击人物，选一张图 |
| 给它看图 | 拖一张图到对话区 |

---

## 🔑 API Key 申请

### 豆包语音（火山引擎）—— 必填

1. 去 [火山引擎控制台](https://console.volcengine.com) 注册
2. 开通「**语音合成**」和「**语音识别**」两个服务
3. 拿到：
   - `appid`、`token`
   - 音色 `voice_type`（语音合成里选一个，或用声音复刻）

### DeepSeek 视觉 —— 可选（拖图看图才需要）

[DeepSeek 平台](https://platform.deepseek.com) 申请 key，填在 `main.js` 的 `vision` 函数里。

---

## 📁 项目结构

```
├── package.json
├── main.js        # 主进程：窗口 + 大脑 + TTS + ASR + 视觉
├── index.html     # 界面
├── renderer.js    # 交互逻辑
├── asr.js         # 豆包语音识别（WebSocket 协议）
└── assets/
    └── avatar.jpg # 形象图
```

---

## 🛠 技术栈

| 模块 | 技术 |
|------|------|
| 窗口 | Electron（透明 frameless 浮窗） |
| AI 大脑 | Claude Code（`stream-json` 常驻进程，免冷启动） |
| 语音朗读 | 火山引擎豆包 TTS |
| 语音识别 | 火山引擎豆包 ASR（`bigmodel` 双向流式，实时出字） |
| 视觉 | DeepSeek 视觉模型（`deepseek-v4-flash-vision-exp`） |

---

## ⚠️ 踩坑记录

1. **Electron 透明窗口移动会 +1px**（"按住就放大"的根因）——移动必须用 CSS `-webkit-app-region: drag` 原生拖拽，不要自己 `setPosition`/`setBounds`。
2. **透明窗口 `setSize` 缩小会失效**——用 `setBounds` + 显式 `minWidth`/`minHeight`。
3. **claude -p 冷启动慢（4 秒+）**——用 `stream-json` 常驻进程 + 启动预热，回复降到 1.5 秒。
4. **claude -p 多请求会串结果**——必须加请求队列，串行处理。

---

## 📄 License

[MIT](LICENSE)
