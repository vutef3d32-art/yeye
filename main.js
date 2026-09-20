// AI Desktop Pet —— 主进程
const { app, BrowserWindow, ipcMain, screen, dialog } = require('electron');
const { spawn, exec } = require('child_process');
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

// Claude Code 可执行文件：优先读环境变量 CLAUDE_EXE，否则按 npm 全局安装的默认位置拼
const CLAUDE_EXE = process.env.CLAUDE_EXE ||
  path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
const { DOUBAO, DEEPSEEK_KEY } = require('./config');
const WORK_DIR = __dirname; // 独立目录，隔离会话，避免延续到被污染的旧会话

// —— 唤醒词：命中后不启动一次性副本，直接唤起交互式会话 ——
const WAKE_WORDS = ['claude', 'assistant', '助手'];

function isWakeWord(text) {
  const t = (text || '').trim().toLowerCase();
  return WAKE_WORDS.some((w) => t.includes(w.toLowerCase()));
}

function wakeRealMe() {
  // 新开终端窗口，运行交互式 Claude Code 会话（带完整上下文）
  exec('start "AI Pet" claude', { windowsHide: false }, (err) => {
    if (err) console.error('[wake] 弹出终端失败:', err.message);
  });
}

// —— 对话面板：消息落盘 peek/log.jsonl，用户输入后注入主会话 ——
const PEEK_LOG = path.join(__dirname, '..', 'peek', 'log.jsonl');

function readPeekLog() {
  try {
    return fs.readFileSync(PEEK_LOG, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } })
      .filter(Boolean)
      .slice(-200);
  } catch (e) { return []; }
}

function pushPeek(who, text) {
  fs.appendFileSync(PEEK_LOG, JSON.stringify({ who, text, t: Date.now() }) + '\n', 'utf8');
}

function sendPeekLog() {
  if (!win) return;
  win.webContents.send('peek-log', readPeekLog());
  // 自检用：锁屏底下也能把窗口画面拍下来看它对不对（PET_SNAP=1 才拍）
  if (process.env.PET_SNAP) {
    setTimeout(() => {
      win.webContents.capturePage().then((img) => {
        fs.writeFileSync(path.join(__dirname, 'pet-self.png'), img.toPNG());
      }).catch((e) => console.log('[对话] 截图失败', e));
    }, 600);
  }
}

function wakeMe(lines) {
  const said = Array.isArray(lines) ? lines : [lines];
  const head = said.length === 1
    ? '用户说：' + said[0] + '\n'
    : '用户连续说了 ' + said.length + ' 句：\n' + said.map((s) => '· ' + s).join('\n') + '\n';
  const tip = '（完整对话见 peek/log.jsonl，'
    + '用 node peek/say.js "……" 回复。'
    + '只发一条，别在同一秒发两条'
    + (said.length > 1 ? '；这些消息一次回完，不要拆开。' : '。') + '）';
  const body = JSON.stringify({ text: head + tip, reason: '桌宠小窗' });
  const req = http.request({
    host: '127.0.0.1', port: 7839, path: '/velle_prompt', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, (res) => {
    let b = '';
    res.on('data', (c) => (b += c));
    res.on('end', () => console.log('[对话] 唤醒:', res.statusCode, b.slice(0, 120)));
  });
  req.on('error', (err) => console.log('[对话] 唤醒失败（sidecar 未运行？）:', err.message));
  req.write(body);
  req.end();
}

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
  win.webContents.on('console-message', (e, level, message) => {
    console.log('[render]', message);
  });
  win.loadFile('index.html');
  win.webContents.on('did-finish-load', sendPeekLog);
}

let peekSize = -1;
fs.watchFile(PEEK_LOG, { interval: 250 }, (cur, prev) => {
  if (cur.size === peekSize) return;
  peekSize = cur.size;
  sendPeekLog();
});

// 免去系统弹窗：麦克风与音频输出由应用自行接管
app.whenReady().then(() => {
  const ses = require('electron').session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, cb) => {
    cb(['media', 'audioCapture', 'speaker-selection'].includes(permission));
  });
  ses.setPermissionCheckHandler((wc, permission) => ['media', 'audioCapture', 'speaker-selection'].includes(permission));
  createWindow();
});

// 耳机认没认到，落一份盘留证（排查用）
ipcMain.on('audio-devices', (e, list) => {
  try {
    fs.writeFileSync(path.join(__dirname, 'audio-devices.json'), JSON.stringify(list, null, 1));
  } catch (err) {}
});

// 用户输入 → 落盘并注入主会话
// 连续消息合并为一次注入，避免重复回复
let pendingSays = [];
let wakeTimer = null;
ipcMain.on('peek-say', (e, text) => {
  const t = (text || '').trim();
  if (!t) return;
  pushPeek('baby', t);
  sendPeekLog();
  pendingSays.push(t);
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = setTimeout(() => {
    wakeTimer = null;
    const said = pendingSays.slice();
    pendingSays = [];
    wakeMe(said);
  }, 2500);
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
    cwd: os.homedir(),
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

// —— 声音：豆包 TTS ——
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

// —— 开麦：SAPI 中文听写（按住说话，说一句出字）——
function listen(seconds = 8) {
  seconds = Math.max(1, Math.min(60, seconds | 0));
  return new Promise((resolve) => {
    const ps = [
      "Add-Type -AssemblyName System.Speech",
      "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
      "$e = New-Object System.Speech.Recognition.SpeechRecognitionEngine -ArgumentList 'MS-2052-80-DESK'",
      "$e.SetInputToDefaultAudioDevice()",
      "$e.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))",
      "$r = $e.Recognize([TimeSpan]::FromSeconds(" + seconds + "))",
      "if($r){[Console]::Out.Write($r.Text)}",
      "$e.Dispose()"
    ].join('; ');
    const child = spawn('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.on('close', () => resolve(out.trim()));
    child.on('error', () => resolve(''));
  });
}

ipcMain.handle('ask', async (e, text) => {
  const t0 = Date.now();
  const reply = await ask(text);
  console.log('[ask] 耗时', Date.now() - t0, 'ms:', reply.slice(0, 30));
  return { ok: true, reply };
});

ipcMain.handle('speak', async (e, text) => {
  console.log('[speak] 文本:', text);
  try {
    const data = await tts(text);
    console.log('[speak] 返回base64长度:', data ? data.length : 0);
    return { ok: true, data };
  }
  catch (err) {
    console.log('[speak] 错误:', (err && err.message) || err);
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('listen', async (e, seconds) => {
  return await listen(seconds);
});

// 换形象：拖图进来，复制到 assets 持久化
ipcMain.handle('setAvatar', async (e, srcPath) => {
  try {
    const dest = path.join(__dirname, 'assets', 'avatar.jpg');
    fs.copyFileSync(srcPath, dest);
    return { ok: true, path: dest };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
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

// 位置切换：下半居中 / 右下角 / 顶部居中
const POSITIONS = ['bottom', 'corner', 'top'];
let posIndex = 0;
ipcMain.handle('cyclePos', async () => {
  const { workAreaSize } = screen.getPrimaryDisplay();
  const [w, h] = win.getSize();
  posIndex = (posIndex + 1) % POSITIONS.length;
  const mode = POSITIONS[posIndex];
  if (mode === 'bottom') {
    win.setPosition(Math.round((workAreaSize.width - w) / 2), Math.round(workAreaSize.height - h - 30));
  } else if (mode === 'corner') {
    win.setPosition(workAreaSize.width - w - 20, workAreaSize.height - h - 20);
  } else {
    win.setPosition(Math.round((workAreaSize.width - w) / 2), 30);
  }
  return { ok: true, mode };
});

// 大小切换：小 / 中 / 大
const SIZES = [[200, 320], [300, 460], [420, 620]];
let sizeIndex = 1;
ipcMain.handle('cycleSize', async () => {
  sizeIndex = (sizeIndex + 1) % SIZES.length;
  const [w, h] = SIZES[sizeIndex];
  win.setSize(w, h);
  return { ok: true };
});

// 拖拽移动窗口（用 setBounds 锁死尺寸，避免 setPosition 在透明窗口上触发尺寸增长）
ipcMain.handle('move', (e, dx, dy) => {
  const b = win.getBounds();
  win.setBounds({ x: b.x + dx, y: b.y + dy, width: b.width, height: b.height });
  const after = win.getBounds();
  console.log('[move] 尺寸', b.width, b.height, '->', after.width, after.height);
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
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + DEEPSEEK_KEY, 'Content-Length': Buffer.byteLength(body) }
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
      console.log('[asr] VAD判停, 结果:', text);
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
  if (!asr || !asrReady) { console.log('[asr-finish] 没在开麦'); return ''; }
  asrReady = false;
  try {
    if (pcmBuf.length) asr.sendAudio(pcmBuf);
    const text = await asr.finish();
    console.log('[asr-finish] 返回文字:', text);
    asr.close();
    asr = null;
    return text || '';
  } catch (e) {
    console.log('[asr-finish] 错误:', (e && e.message) || e);
    return '';
  }
});
