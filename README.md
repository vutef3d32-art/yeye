# 📞 AI 来电 · 电脑版来电 + 通话

像真的电话一样——右下角弹出来电卡片，点接通就能和 AI 语音通话。

> 基于 **Electron + Claude Code + 豆包语音**，全双工语音通话，AI 主动开场、沉默追问。

---

## ✨ 功能

- 📞 **来电通知卡片**：右下角弹卡片 → 点空白进来电界面 / 点接通直接进通话
- 🎤 **全双工语音通话**：不用按键，直接说，说完自动回
- 🗣️ **AI 主动先开口**：开场白根据「时间 + 你在干嘛」动态生成（视觉模型看屏幕）
- ⏱️ **沉默追问**：你 6 秒没说话，AI 主动续一句，不冷场
- 💬 **语气温柔**，绝不凶
- ⚡ **延迟压到 3 秒左右**

---

## 🚀 快速开始

### 环境要求

- Node.js 18+
- Claude Code（`npm i -g @anthropic-ai/claude-code`）

### 安装

```bash
npm install
```

### 运行

```bash
npm start
```

---

## 🔑 配置（改 3 处）

1. **豆包 key**（语音朗读 + 识别）：`main.js` / `asr.js` 里的 `appid` / `token` / 音色
2. **DeepSeek key**（视觉，可选）：`main.js` 里的 `VISION_KEY`
3. **Claude 路径**：`main.js` 里的 `CLAUDE_EXE`（终端敲 `where claude` 查）

> 完整步骤看 **`来电项目框架电脑版.md`**。

---

## 📁 项目结构

```
├── package.json
├── main.js        # 主进程：窗口 + 大脑 + TTS + ASR + 视觉
├── index.html     # 来电界面 + 通话逻辑
├── asr.js         # 豆包语音识别（WebSocket）
├── editor.html    # 来电界面编辑器
├── editor-active.html
├── editor-notify.html
└── 来电项目框架电脑版.md   # 完整教程（含手机端移植）
```

---

## 🛠 技术栈

| 模块 | 技术 |
|------|------|
| 窗口 | Electron |
| AI 大脑 | Claude Code（`stream-json` 常驻进程） |
| 语音朗读 | 火山引擎豆包 TTS |
| 语音识别 | 火山引擎豆包 ASR（`bigmodel` 双向流式） |
| 视觉 | DeepSeek 视觉模型 |

---

## 📄 License

[MIT](LICENSE)
