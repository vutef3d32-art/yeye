// AI 桌宠 · 桌面宠物浮窗 —— 主进程
const { app, BrowserWindow, ipcMain, screen, dialog } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { DoubaoASR } = require('./asr');

// 桌宠不需要 GPU 加速，禁用反而让透明窗口更稳，也消除缓存权限报错
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.setPath('userData', path.join(__dirname, 'userdata'));

const CLAUDE_EXE = 'C:\\Users\\你的用户名\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe';
const DOUBAO = {
  appid: '你的appid',
  token: '你的token',
  cluster: 'volcano_icl',
  voice: '你的音色voice_type'
};
const WORK_DIR = __dirname; // 独立目录，隔离会话，避免延续到被污染的旧会话

let win;

function createWindow() {
  const { workAreaSize } = screen.getPrimaryDisplay();
  const w = 300;
  const h = 460;
  win = new BrowserWindow({
    width: w,
    height: h,
    x: Math.round((workAreaSize.width - w) / 2),
    y: Math.round(workAreaSize.height - h - 30),
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    minWidth: 100,
    minHeight: 100,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();
  // 预热：提前把常驻的我叫醒，你第一次打字就不用等冷启动
  setTimeout(() => {
    try {
      ask('（预热，回一个"在"）');
    } catch (e) {}
  }, 2000);
});
app.on('window-all-closed', () => app.quit());

// —— 大脑：常驻 claude 进程（stream-json）+ 请求队列（串行，避免结果串）——
let claudeProc = null;
let stdoutBuf = '';
let queue = [];
let processing = false;
let currentCb = null;

function ensureClaude() {
  if (claudeProc) return;
  claudeProc = spawn(CLAUDE_EXE, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'], {
    cwd: WORK_DIR,
    windowsHide: true
  });
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
          for (const c of ev.message.content) {
            if (c.type === 'text' && c.text && currentCb) currentCb(c.text);
          }
        } else if (ev.type === 'result') {
          if (currentCb) currentCb(null);
          currentCb = null;
          processing = false;
          processQueue();
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
    const timer = setTimeout(() => { resolve(''); }, 120000);
    queue.push({
      text,
      onText: (chunk) => {
        if (chunk === null) {
          clearTimeout(timer);
          resolve(full.trim());
        } else {
          full += chunk;
          if (win) win.webContents.send('ask-partial', full);
        }
      }
    });
    processQueue();
  });
}

// —— 声音：豆包 TTS（霸道总裁音色）——
function tts(text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      app: { appid: DOUBAO.appid, token: DOUBAO.token, cluster: DOUBAO.cluster },
      user: { uid: 'baby' },
      audio: { voice_type: DOUBAO.voice, encoding: 'mp3', speed_ratio: 1.0 },
      request: { reqid: 'r' + Date.now(), text: text, text_type: 'plain', operation: 'query' }
    });
    const req = https.request({
      host: 'openspeech.bytedance.com',
      path: '/api/v1/tts',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer;' + DOUBAO.token,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        try { const j = JSON.parse(b); resolve(j.data || ''); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

ipcMain.handle('ask', async (e, text) => {
  return { ok: true, reply: await ask(text) };
});

ipcMain.handle('speak', async (e, text) => {
  try { return { ok: true, data: await tts(text) }; }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});

// 弹出选图窗口，选一张换形象
ipcMain.handle('chooseImage', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '选一张图当形象',
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }]
  });
  if (r.canceled || !r.filePaths.length) return { ok: false };
  try {
    const dest = path.join(__dirname, 'assets', 'avatar.jpg');
    fs.copyFileSync(r.filePaths[0], dest);
    return { ok: true, path: dest };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// 拖拽右下角：等比例缩放
ipcMain.handle('resize-by', (e, dx, dy) => {
  const [w, h] = win.getSize();
  const ratio = h / w;
  const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy; // 取变化大的那个，保持比例
  const nw = Math.max(120, w + delta);
  const nh = Math.max(180, Math.round(nw * ratio));
  const [x, y] = win.getPosition();
  win.setBounds({ x: x, y: y, width: nw, height: nh });
  return { ok: true };
});

// 视觉：拖图进来，用 DeepSeek 视觉模型看图
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
      const req = https.request('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer 你的DeepSeek-key', 'Content-Length': Buffer.byteLength(body) }
      }, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(d);
            const reply = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
            resolve({ ok: true, reply: reply || '' });
          } catch (err) { resolve({ ok: false, error: d.slice(0, 200) }); }
        });
      });
      req.on('error', (err) => resolve({ ok: false, error: String(err.message) }));
      req.write(body);
      req.end();
    } catch (err) { resolve({ ok: false, error: String(err.message) }); }
  });
});

// —— 开麦 ASR：豆包流式 ——
let asr = null;
let pcmBuf = Buffer.alloc(0);
let asrReady = false;

ipcMain.handle('asr-start', async () => {
  asr = new DoubaoASR();
  pcmBuf = Buffer.alloc(0);
  asrReady = false;
  asr.onPartial = (text) => {
    if (win) win.webContents.send('asr-partial', text);
  };
  asr.onDefinite = (text) => {
    // VAD 判停：自动收尾，通知渲染进程
    if (asrReady) {
      asrReady = false;
      try { asr.finish(); } catch (e) {}
      try { asr.close(); } catch (e) {}
      asr = null;
      if (win) win.webContents.send('asr-done', text);
    }
  };
  try {
    await asr.connect();
    asrReady = true;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.on('asr-audio', (e, pcmArray) => {
  if (!asr || !asrReady) return;
  pcmBuf = Buffer.concat([pcmBuf, Buffer.from(pcmArray)]);
  while (pcmBuf.length >= 3200) {
    asr.sendAudio(pcmBuf.slice(0, 3200));
    pcmBuf = pcmBuf.slice(3200);
  }
});

ipcMain.handle('asr-finish', async () => {
  asrReady = false;
  try {
    if (pcmBuf.length) asr.sendAudio(pcmBuf);
    const text = await asr.finish();
    asr.close();
    asr = null;
    return text || '';
  } catch (e) {
    return '';
  }
});
