# 桌面 AI 桌宠 · 部署教程

一个透明的桌面浮窗（Electron），能：
- **打字** 或 **按住开麦说话**（语音识别成文字）
- AI 用文字回你，**可选语音朗读**（豆包音色）
- **拖图给它看**（视觉理解，DeepSeek 视觉模型）
- 等比例缩放（右下角）、按住人物拖动窗口、双击人物换形象

---

## 一、需要准备的东西

### 1. 豆包语音 key（火山引擎）—— 朗读 + 识别都要

去 https://console.volcengine.com 注册，开通两个服务：

| 服务 | 用途 | 要拿到的参数 |
|------|------|-------------|
| 语音合成（TTS） | AI 说话的声音 | `appid`、`token`、音色 `voice_type` |
| 语音识别（ASR） | 你开麦说话转文字 | 同上 `appid`、`token`，资源 ID（默认 `volc.bigasr.sauc.duration`） |

> 音色 `voice_type`：在控制台「语音合成」里选一个音色，或用「声音复刻」复刻一个。填到代码里。

### 2. Claude Code（已有，跳过）

朋友的 Claude Code 已经能跑，桌宠直接调它当「大脑」，不需要额外配置。

### 3. DeepSeek 视觉（可选，拖图看图才需要）

桌宠的「拖图给它看」用 DeepSeek 视觉模型。如果不需要这功能，可以跳过。
DeepSeek 的 key 填在 `main.js` 的 `vision` 函数里。

---

## 二、项目结构（5 个文件）

```
pet/
  package.json
  main.js        # 主进程：窗口 + 大脑 + 语音 + 视觉
  index.html     # 界面
  renderer.js    # 交互逻辑
  asr.js         # 豆包语音识别
  assets/
    avatar.jpg   # 你的形象图（自己放一张）
```

---

## 三、代码

### 1. package.json

```json
{
  "name": "desktop-pet",
  "version": "1.0.0",
  "main": "main.js",
  "scripts": { "start": "electron ." },
  "devDependencies": { "electron": "^44.0.0" }
}
```

### 2. main.js

> ⚠️ 三个地方要改成你自己的：
> 1. `CLAUDE_EXE` —— 你的 claude.exe 路径（终端里敲 `where claude` 能看到）
> 2. `DOUBAO` —— 豆包的 appid / token / 音色 voice_type
> 3. `vision` 函数里的 DeepSeek key（可选）

```js
const { app, BrowserWindow, ipcMain, screen, dialog } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { DoubaoASR } = require('./asr');

app.disableHardwareAcceleration();
app.setPath('userData', path.join(__dirname, 'userdata'));

// ⬇️ 改成你的 claude.exe 路径
const CLAUDE_EXE = 'C:\\Users\\你的用户名\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe';
// ⬇️ 改成你的豆包 key
const DOUBAO = {
  appid: '你的appid',
  token: '你的token',
  cluster: 'volcano_icl',
  voice: '你的音色voice_type'
};
const WORK_DIR = __dirname;

let win;

function createWindow() {
  const { workAreaSize } = screen.getPrimaryDisplay();
  const w = 300, h = 460;
  win = new BrowserWindow({
    width: w, height: h,
    x: Math.round((workAreaSize.width - w) / 2),
    y: Math.round(workAreaSize.height - h - 30),
    transparent: true, frame: false, alwaysOnTop: true,
    hasShadow: false, resizable: false, skipTaskbar: true,
    minWidth: 100, minHeight: 100,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();
  setTimeout(() => { try { ask('（预热）'); } catch (e) {} }, 2000);
});
app.on('window-all-closed', () => app.quit());

// —— 大脑：常驻 claude 进程（stream-json）+ 请求队列 ——
let claudeProc = null, stdoutBuf = '', queue = [], processing = false, currentCb = null;

function ensureClaude() {
  if (claudeProc) return;
  claudeProc = spawn(CLAUDE_EXE, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'], { cwd: WORK_DIR, windowsHide: true });
  claudeProc.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString();
    let idx;
    while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, idx).trim();
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (!line) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
          for (const c of ev.message.content) if (c.type === 'text' && c.text && currentCb) currentCb(c.text);
        } else if (ev.type === 'result') {
          if (currentCb) currentCb(null);
          currentCb = null; processing = false; processQueue();
        }
      } catch (e) {}
    }
  });
  claudeProc.stderr.on('data', () => {});
  claudeProc.on('error', () => { claudeProc = null; processing = false; });
  claudeProc.on('close', () => { claudeProc = null; processing = false; });
}

function processQueue() {
  if (processing || !queue.length) return;
  processing = true;
  const req = queue.shift();
  currentCb = req.onText;
  ensureClaude();
  claudeProc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: req.text } }) + '\n');
}

function ask(text) {
  return new Promise((resolve) => {
    let full = '';
    const timer = setTimeout(() => resolve(''), 120000);
    queue.push({ text, onText: (chunk) => {
      if (chunk === null) { clearTimeout(timer); resolve(full.trim()); }
      else { full += chunk; if (win) win.webContents.send('ask-partial', full); }
    }});
    processQueue();
  });
}

// —— 豆包 TTS 朗读 ——
function tts(text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      app: { appid: DOUBAO.appid, token: DOUBAO.token, cluster: DOUBAO.cluster },
      user: { uid: 'pet' },
      audio: { voice_type: DOUBAO.voice, encoding: 'mp3', speed_ratio: 1.0 },
      request: { reqid: 'r' + Date.now(), text, text_type: 'plain', operation: 'query' }
    });
    const req = https.request({
      host: 'openspeech.bytedance.com', path: '/api/v1/tts', method: 'POST',
      headers: { 'Authorization': 'Bearer;' + DOUBAO.token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => { try { const j = JSON.parse(b); resolve(j.data || ''); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

// —— 开麦 ASR ——
let asr = null, pcmBuf = Buffer.alloc(0), asrReady = false;

ipcMain.handle('asr-start', async () => {
  asr = new DoubaoASR(); pcmBuf = Buffer.alloc(0); asrReady = false;
  asr.onPartial = (text) => { if (win) win.webContents.send('asr-partial', text); };
  asr.onDefinite = (text) => {
    if (asrReady) { asrReady = false; try { asr.finish(); } catch (e) {} try { asr.close(); } catch (e) {} asr = null; if (win) win.webContents.send('asr-done', text); }
  };
  try { await asr.connect(); asrReady = true; return { ok: true }; }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});
ipcMain.on('asr-audio', (e, pcmArray) => {
  if (!asr || !asrReady) return;
  pcmBuf = Buffer.concat([pcmBuf, Buffer.from(pcmArray)]);
  while (pcmBuf.length >= 3200) { asr.sendAudio(pcmBuf.slice(0, 3200)); pcmBuf = pcmBuf.slice(3200); }
});
ipcMain.handle('asr-finish', async () => {
  if (!asr || !asrReady) return '';
  asrReady = false;
  try { if (pcmBuf.length) asr.sendAudio(pcmBuf); const text = await asr.finish(); asr.close(); asr = null; return text || ''; }
  catch (e) { return ''; }
});

// —— IPC ——
ipcMain.handle('ask', async (e, text) => { return { ok: true, reply: await ask(text) }; });
ipcMain.handle('speak', async (e, text) => { try { return { ok: true, data: await tts(text) }; } catch (err) { return { ok: false }; } });

// 缩放（右下角拖拽，等比例）
ipcMain.handle('resize-by', (e, dx, dy) => {
  const [w, h] = win.getSize();
  const ratio = h / w;
  const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
  const nw = Math.max(120, w + delta);
  const nh = Math.max(180, Math.round(nw * ratio));
  const [x, y] = win.getPosition();
  win.setBounds({ x, y, width: nw, height: nh });
});

// 换形象：双击人物选图
ipcMain.handle('chooseImage', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp'] }] });
  if (r.canceled || !r.filePaths.length) return { ok: false };
  const dest = path.join(__dirname, 'assets', 'avatar.jpg');
  fs.copyFileSync(r.filePaths[0], dest);
  return { ok: true, path: dest };
});

// 视觉（拖图看图，DeepSeek 视觉，可选）
ipcMain.handle('vision', async (e, imagePath, question) => {
  return new Promise((resolve) => {
    try {
      const ext = path.extname(imagePath).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
      const b64 = fs.readFileSync(imagePath).toString('base64');
      const body = JSON.stringify({
        model: 'deepseek-v4-flash-vision-exp',
        messages: [{ role: 'user', content: [
          { type: 'text', text: question || '描述这张图，简短一点' },
          { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + b64 } }
        ]}]
      });
      // ⬇️ 改成你的 DeepSeek key（或删掉视觉功能）
      const req = https.request('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer 你的DeepSeek-key', 'Content-Length': Buffer.byteLength(body) }
      }, (res) => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => { try { const j = JSON.parse(d); const reply = j.choices[0].message.content; resolve({ ok: true, reply }); } catch (e) { resolve({ ok: false }); } });
      });
      req.on('error', () => resolve({ ok: false })); req.write(body); req.end();
    } catch (e) { resolve({ ok: false }); }
  });
});
```

### 3. asr.js

> ⚠️ 改成你自己的豆包 appid / token。

```js
const WebSocket = require('ws');
const crypto = require('crypto');

// ⬇️ 改成你的豆包 key
const DOUBAO = { appid: '你的appid', token: '你的token', resourceId: 'volc.bigasr.sauc.duration' };

function buildHeader(messageType, flags, serialization, compression) {
  return Buffer.from([(0x01 << 4) | 0x01, (messageType << 4) | flags, (serialization << 4) | compression, 0x00]);
}
function buildFullClientRequest(json) {
  const header = buildHeader(1, 0, 1, 0);
  const payload = Buffer.from(json, 'utf8');
  const size = Buffer.alloc(4); size.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, size, payload]);
}
function buildAudioRequest(pcm) {
  const header = buildHeader(2, 0, 0, 0);
  const size = Buffer.alloc(4); size.writeUInt32BE(pcm.length, 0);
  return Buffer.concat([header, size, pcm]);
}
function buildLastRequest() {
  const header = buildHeader(2, 2, 0, 0);
  const size = Buffer.alloc(4); size.writeUInt32BE(0, 0);
  return Buffer.concat([header, size]);
}

class DoubaoASR {
  constructor() { this.resultText = ''; this.resolveResult = null; }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('wss://openspeech.bytedance.com/api/v3/sauc/bigmodel', {
        headers: {
          'X-Api-App-Key': DOUBAO.appid,
          'X-Api-Access-Key': DOUBAO.token,
          'X-Api-Resource-Id': DOUBAO.resourceId,
          'X-Api-Connect-Id': crypto.randomUUID()
        }
      });
      this.ws.on('open', () => {
        const meta = JSON.stringify({
          user: { uid: 'pet' },
          audio: { format: 'pcm', rate: 16000, bits: 16, channel: 1, language: 'zh-CN' },
          request: { model_name: 'bigmodel', enable_itn: true, enable_punc: true, enable_ddc: true }
        });
        try { this.ws.send(buildFullClientRequest(meta)); } catch (e) {}
        resolve();
      });
      this.ws.on('error', reject);
      this.ws.on('message', (data) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (buf.length < 8) return;
        const messageType = (buf[1] >> 4) & 0x0f;
        const flags = buf[1] & 0x0f;
        const hasSeq = (flags & 0x01) === 0x01;
        let offset = 4; if (hasSeq) offset += 4;
        if (buf.length < offset + 4) return;
        const size = buf.readUInt32BE(offset);
        const payload = buf.slice(offset + 4, offset + 4 + size);
        if (messageType === 0x09) {
          try {
            const j = JSON.parse(payload.toString('utf8'));
            if (j.result && j.result.text) {
              this.resultText = j.result.text;
              if (this.onPartial) this.onPartial(this.resultText);
              const definite = j.result.utterances && j.result.utterances.some(u => u.definite);
              if (definite && this.onDefinite && !this._definiteFired) { this._definiteFired = true; this.onDefinite(this.resultText); }
              if (this.resolveResult) { this.resolveResult(this.resultText); this.resolveResult = null; }
            }
          } catch (e) {}
        }
      });
    });
  }
  sendAudio(pcm) { if (this.ws && this.ws.readyState === 1 && pcm.length) this.ws.send(buildAudioRequest(pcm)); }
  finish() {
    return new Promise((resolve) => {
      this.resolveResult = resolve;
      try { this.ws.send(buildLastRequest()); } catch (e) { resolve(this.resultText); }
      setTimeout(() => { if (this.resolveResult) { this.resolveResult(this.resultText); this.resolveResult = null; } }, 5000);
    });
  }
  close() { try { this.ws && this.ws.close(); } catch (e) {} }
}

module.exports = { DoubaoASR };
```

### 4. index.html

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: transparent; overflow: hidden; height: 100%; }
  body { font-family: "Microsoft YaHei", sans-serif; user-select: none; display: flex; flex-direction: column; height: 100vh; padding: 10px; }
  #pet { -webkit-app-region: drag; height: 52%; display: flex; align-items: center; justify-content: center; cursor: grab; }
  #pet img { height: 100%; object-fit: contain; pointer-events: none; }
  #log { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 7px; padding: 4px 8px; }
  .msg { max-width: 85%; font-size: 15px; line-height: 1.5; word-break: break-word; white-space: pre-wrap; color: #fff; text-shadow: 0 0 4px rgba(0,0,0,0.95), 0 1px 3px rgba(0,0,0,0.95); }
  .me { align-self: flex-start; }
  .you { align-self: flex-end; }
  #bar { display: flex; align-items: center; gap: 6px; padding-top: 8px; }
  #msg { flex: 1; background: rgba(20,22,34,0.55); border: 1px solid rgba(255,255,255,0.25); border-radius: 16px; outline: none; color: #fff; font-size: 13px; height: 32px; padding: 0 12px; }
  #msg::placeholder { color: rgba(255,255,255,0.5); }
  button { width: 32px; height: 32px; border-radius: 50%; border: none; cursor: pointer; font-size: 14px; background: rgba(20,22,34,0.55); color: #fff; }
  #mic.active { background: rgba(180,60,90,0.8); }
  #voice.on { background: rgba(40,140,90,0.8); }
  #resize-corner { position: fixed; right: 0; bottom: 0; width: 26px; height: 26px; cursor: nwse-resize; z-index: 11; background: linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.45) 50%); }
</style>
</head>
<body>
  <div id="pet"><img id="pet-img" alt=""></div>
  <div id="log"></div>
  <div id="bar">
    <input id="msg" placeholder="打字，或空格长按开麦" autofocus>
    <button id="voice" title="我说话开关">🔊</button>
    <button id="mic" title="开麦/关麦">🎙</button>
  </div>
  <div id="resize-corner"></div>
  <script src="renderer.js"></script>
</body>
</html>
```

### 5. renderer.js

```js
const { ipcRenderer } = require('electron');
const img = document.getElementById('pet-img');
const log = document.getElementById('log');
const msg = document.getElementById('msg');
const mic = document.getElementById('mic');
const voice = document.getElementById('voice');
const pet = document.getElementById('pet');
const resizeCorner = document.getElementById('resize-corner');

let speakOn = false;
img.src = 'assets/avatar.jpg';
msg.focus();

function addMsg(text, who) {
  const d = document.createElement('div');
  d.className = 'msg ' + who;
  d.textContent = text;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
}
async function playSpeak(text) {
  if (!speakOn) return;
  const r = await ipcRenderer.invoke('speak', text);
  if (r.ok && r.data) { const a = new Audio('data:audio/mp3;base64,' + r.data); a.play().catch(() => {}); }
}
let myMsgEl = null;
ipcRenderer.on('ask-partial', (e, text) => {
  if (!myMsgEl) { myMsgEl = document.createElement('div'); myMsgEl.className = 'msg me'; log.appendChild(myMsgEl); }
  myMsgEl.textContent = text; log.scrollTop = log.scrollHeight;
});
async function askClaude(text) {
  myMsgEl = null;
  const r = await ipcRenderer.invoke('ask', text);
  if (r.ok && r.reply) { if (myMsgEl) myMsgEl.textContent = r.reply; playSpeak(r.reply); }
  else if (!myMsgEl) addMsg('（没连上）', 'me');
}
async function send(text) { text = (text || '').trim(); if (!text) return; addMsg(text, 'you'); await askClaude(text); }

// 开麦
let mediaStream = null, audioCtx = null, processor = null;
async function startMic() {
  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  const source = audioCtx.createMediaStreamSource(mediaStream);
  processor = audioCtx.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (e) => {
    const f = e.inputBuffer.getChannelData(0);
    const i16 = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
    ipcRenderer.send('asr-audio', i16.buffer);
  };
  source.connect(processor); processor.connect(audioCtx.destination);
}
function stopMic() {
  try { processor && processor.disconnect(); } catch (e) {}
  try { audioCtx && audioCtx.close(); } catch (e) {}
  try { mediaStream && mediaStream.getTracks().forEach(t => t.stop()); } catch (e) {}
  mediaStream = null; audioCtx = null; processor = null;
}
let micLocked = false, partialEl = null;
ipcRenderer.on('asr-partial', (e, text) => {
  if (!micLocked || !text) return;
  if (!partialEl) { partialEl = document.createElement('div'); partialEl.className = 'msg you'; log.appendChild(partialEl); }
  partialEl.textContent = text; log.scrollTop = log.scrollHeight;
});
async function lockMic() {
  micLocked = true; mic.classList.add('active');
  const r = await ipcRenderer.invoke('asr-start');
  if (r && r.ok) { try { await startMic(); } catch (e) { addMsg('（麦克风没起来）', 'me'); } }
}
async function unlockMic() {
  micLocked = false; mic.classList.remove('active'); stopMic();
  const text = await ipcRenderer.invoke('asr-finish');
  if (partialEl) { if (text && partialEl.textContent !== text) partialEl.textContent = text; partialEl = null; if (text) await askClaude(text); }
  else if (text) { addMsg(text, 'you'); await askClaude(text); }
}
ipcRenderer.on('asr-done', async (e, text) => {
  micLocked = false; mic.classList.remove('active'); stopMic();
  if (partialEl) { if (text && partialEl.textContent !== text) partialEl.textContent = text; partialEl = null; }
  if (text) await askClaude(text);
});

voice.addEventListener('click', () => { speakOn = !speakOn; voice.classList.toggle('on', speakOn); });
mic.addEventListener('click', () => { if (micLocked) unlockMic(); else lockMic(); });
msg.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const t = msg.value; msg.value = ''; send(t); } });

// 缩放（右下角拖拽）
let resizing = false, lastX = 0, lastY = 0;
resizeCorner.addEventListener('mousedown', (e) => { resizing = true; lastX = e.screenX; lastY = e.screenY; e.preventDefault(); e.stopPropagation(); });
document.addEventListener('mousemove', (e) => {
  if (e.buttons === 0) { resizing = false; return; }
  if (!resizing) return;
  const dx = e.screenX - lastX, dy = e.screenY - lastY;
  lastX = e.screenX; lastY = e.screenY;
  if (dx === 0 && dy === 0) return;
  ipcRenderer.invoke('resize-by', dx, dy);
});
window.addEventListener('mouseup', () => { resizing = false; });

// 双击换形象
pet.addEventListener('dblclick', async () => {
  const r = await ipcRenderer.invoke('chooseImage');
  if (r && r.ok) { img.src = r.path + '?t=' + Date.now(); }
});

// 拖图看图（视觉，可选）
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (!f || !f.path) return;
  const r = await ipcRenderer.invoke('vision', f.path, '');
  if (r && r.ok && r.reply) { addMsg(r.reply, 'me'); playSpeak(r.reply); }
});
```

---

## 四、跑起来

```bash
# 1. 进项目目录
cd pet

# 2. 装依赖（electron + ws）
npm install electron ws

# 3. 放一张形象图到 assets/avatar.jpg

# 4. 启动
npm start
```

---

## 五、使用

| 操作 | 方式 |
|------|------|
| 打字聊天 | 输入框打字，回车 |
| 开麦说话 | 点 🎙 开麦，说完自动出字；或长按空格 |
| 我说话开关 | 点 🔊（开了我的回复会朗读） |
| 移动窗口 | 按住人物图拖动 |
| 缩放 | 按住右下角小三角拖拽（等比例） |
| 换形象 | 双击人物，选一张图 |
| 给它看图 | 拖一张图片到对话区 |

---

## 踩坑提醒（重点看）

1. **透明窗口不能自己 setPosition/setBounds 移动**——每调一次窗口尺寸 +1px（"按住就放大"的根因）。移动必须用 CSS `-webkit-app-region: drag`（原生拖拽）。
2. **透明窗口缩小用 setBounds，且缩放可能卡**——等比例缩放 + 明确 minWidth/minHeight。
3. **claude -p 冷启动慢**——用 stream-json 常驻进程 + 启动预热。
4. **claude -p 多请求会串结果**——必须加请求队列，串行处理。
