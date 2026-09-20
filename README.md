# 🐾 AI Desktop Pet · 桌面 AI 桌宠

一个透明的桌面浮窗，你的 AI 就住在里面——**打字、开麦都能聊，会说话、会看图、会换形象**，还能把消息直接送进你正在跑的 Claude Code 会话。

[![Electron](https://img.shields.io/badge/Electron-44-47848F.svg)](https://www.electronjs.org)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> 基于 **Electron + Claude Code + 豆包语音**，一个能开麦、能打字、会读图、会朗读的桌面宠物浮窗。

---

## ✨ 功能

- 💬 **对话**：打字，或按住开麦说话（语音实时转文字）
- 🔊 **语音朗读**：AI 回复用豆包音色朗读（可开关）
- 👀 **视觉**：拖一张图给它，它能看懂（DeepSeek 视觉模型）
- 🖼️ **换形象**：双击人物选图，或拖图进来换
- 📐 **缩放 / 🖱️ 移动 / 🌫️ 透明浮窗**：背景透明，抓哪儿都能拖
- 🎧 **耳机通道**：认到耳机才出声，`setSinkId` 把声音钉进耳机；认不到耳机一个字不外放
- 🔗 **会话唤醒**：在浮窗里打字或说话，直接注入你正在跑的 Claude Code 交互式会话，读同一份上下文
- 🐕 **看门狗**：进程意外退出后自动拉起，带退避，同一时间只允许一个实例
- 🗣 **说话队列**：多条回复排队逐句念，不会几条音频叠成「两个人一起说话」
- ⏱ **输入防抖**：连续说几句合并成一次唤醒，不会回你两条重复的

---

## 🚀 快速开始

### 环境要求

- Node.js 18+
- Claude Code（`npm i -g @anthropic-ai/claude-code`）

### 安装

```bash
npm install
```

### 配置

1. **形象图**：把 `assets/avatar.jpg` 换成你自己的图（或运行后在浮窗上双击选图）
2. **密钥**：复制 `config.example.json` 为 `config.local.json`，填进豆包与 DeepSeek 的 key
   （`config.local.json` 已在 `.gitignore` 里，不会进仓库；也可改用环境变量 `DOUBAO_APPID` / `DOUBAO_TOKEN` / `DEEPSEEK_KEY`）
3. **Claude 路径**：默认按 npm 全局安装位置自动取（`~/AppData/Roaming/npm/.../claude.exe`）。
   如果装在别处，设环境变量 `CLAUDE_EXE` 指向它

### 运行

```bash
npm start
```

或者用看门狗跑（推荐，崩了自动重启）：

```bash
node guard.js
```

---

## 🎮 使用

| 操作 | 方式 |
|------|------|
| 打字聊天 | 输入框打字，回车 |
| 开麦说话 | 点 🎙，说完自动出字发过去 |
| 朗读开关 | 点 🔊（开 = AI 回复会朗读） |
| 移动窗口 | 按住浮窗任意位置拖动 |
| 缩放 | 按住右下角小三角拖（等比例） |
| 换形象 | 双击人物，选一张图 |
| 给它看图 | 拖一张图到对话区 |

---

## 🎧 耳机通道

只要系统里有音频输出设备被识别为耳机（含蓝牙耳机），声音就只走耳机；一个耳机都没认到时，**一个字都不外放**。

设计目的是避免在宿舍、办公室这类场合突然外放。日志里会落一份「认没认到耳机」的记录，排查用。

---

## 🔑 API Key 申请

### 豆包语音（火山引擎）—— 必填

1. 去 [火山引擎控制台](https://console.volcengine.com) 注册
2. 开通「**语音合成**」和「**语音识别**」两个服务
3. 拿到 `appid`、`token`，以及音色 `voice_type`（语音合成里选一个，或用声音复刻）

### DeepSeek 视觉 —— 可选（拖图看图才需要）

[DeepSeek 平台](https://platform.deepseek.com) 申请 key。

---

## 🔗 会话唤醒（可选）

在浮窗里打字或说话，消息会落盘到 `peek/log.jsonl`，同时被注入到你本机正在运行的 Claude Code 交互式会话里——这样它读的是同一个上下文，不是另起一个什么都不记得的副本。

注入用的是一段独立的启动器（`velle-attach-node.py`），**不修改任何第三方源码**：
它从自身进程往上找到第一个 `node.exe` 祖先，把控制台贴到那个进程上再写输入。

配套的 `velle-daily-reset.patch` 是一个独立的额度重置补丁，按需取用。

---

## 🛡 隐私与安全

- **密钥只在本机**：真实 key 放在 `config.local.json`（已 gitignore）或环境变量里，源码和仓库中不含任何凭据
- **路径不写死**：工作目录取当前用户家目录，可执行文件路径可用环境变量覆盖
- **不外传**：语音与文本只发往你自己配置的服务商（火山引擎 / DeepSeek / Claude），本程序不做任何额外上报
- **本地留痕**：对话记录只落在本机 `peek/log.jsonl`，不上传
- 提交前建议自查一遍本地生成的文件（如日志、`config.local.json`）有没有误入版本控制

---

## 📁 项目结构

```
├── package.json
├── main.js            # 主进程：窗口 + 大脑 + TTS + ASR + 视觉 + 会话注入
├── index.html         # 界面
├── renderer.js        # 交互逻辑
├── asr.js             # 豆包语音识别（WebSocket 协议）
├── guard.js           # 看门狗：崩了自动拉起
├── config.js          # 密钥读取（只读 config.local.json / 环境变量）
├── config.example.json
├── velle-attach-node.py     # 会话注入启动器（可选）
├── velle-daily-reset.patch  # 独立补丁（可选）
└── assets/
    └── avatar.jpg     # 形象图
```

---

## 🛠 技术栈

| 模块 | 技术 |
|------|------|
| 窗口 | Electron（透明 frameless 浮窗） |
| AI 大脑 | Claude Code（`stream-json` 常驻进程，免冷启动） |
| 语音朗读 | 火山引擎豆包 TTS |
| 语音识别 | 火山引擎豆包 ASR（`bigmodel` 双向流式，实时出字） |
| 视觉 | DeepSeek 视觉模型 |
| 会话注入 | 控制台附着（Windows `AttachConsole`），不改第三方源码 |

---

## ⚠️ 踩坑记录

1. **Electron 透明窗口移动会 +1px**（"按住就放大"的根因）——移动必须用 CSS `-webkit-app-region: drag` 原生拖拽，不要自己 `setPosition`/`setBounds`。
2. **透明窗口 `setSize` 缩小会失效**——用 `setBounds` + 显式 `minWidth`/`minHeight`。
3. **`claude -p` 冷启动慢（4 秒+）**——用 `stream-json` 常驻进程 + 启动预热，回复降到 1.5 秒。
4. **`claude -p` 多请求会串结果**——必须加请求队列，串行处理。
5. **控制台附着找错进程**：贴到父进程可能是个没人读的空控制台，字打进去也没人看见。要从自身往上找目标会话所在的那个进程。
6. **多条回复同时念会叠音**——TTS 要排队，一句念完再念下一句。
7. **连续输入会被当成多次唤醒**——加防抖窗口，合并成一次。

---

## 📄 License

[MIT](LICENSE)
