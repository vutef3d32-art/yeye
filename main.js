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
