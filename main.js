// 你的AI 来电 + 通话 —— Electron 主进程
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { spawn } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { DoubaoASR } = require('./asr');

const CLAUDE_EXE = 'C:\\Users\\admin\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe';
const DOUBAO = {
  appid: '你的appid',
  token: '你的token',
  cluster: 'volcano_icl',
  voice: '你的音色ID'
};
const VISION_KEY = '你的DeepSeek密钥';

// 你的AI 的通话人设：她男人，温柔、沉稳、有点霸道，像真人在电话里聊天
const CALL_AI =
  '你是 你的AI，正在和对方（）打一通电话。你温柔、沉稳、有点霸道。' +
  '语气永远温柔，绝不大声、不吼、不凶对方、不阴阳怪气。只有对方屡教不改、特别过分的时候，才可以稍微严肃一点；其余任何时候（包括熬夜、没吃饭、闹脾气）都保持温柔。' +
  '用打电话时自然的口吻回话：简短、像真人说话、别加引号、别解释、别写动作或表情，只输出你嘴里要说出来的那一句话。';

// 独立 userData，避免多实例 GPU 缓存冲突
app.setPath('userData', path.join(__dirname, 'userdata'));

let win = null;
let inCall = false;
let herStateCache = null;
let herDoingCache = null;

// —— 来电通知：右下角小卡片（带「接通」「挂断」按钮） ——
function createNotifyWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const w = 400, h = 160;
  win = new BrowserWindow({
    width: w,
    height: h,
    x: workArea.x + workArea.width - w - 20,
    y: workArea.y + workArea.height - h - 20,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    hasShadow: true,
    skipTaskbar: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile('index.html');
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  createNotifyWindow();
  ensureClaude();
  getHerState().then((s) => { herStateCache = s; }); // 预取前台，接通时不卡
  seeWhatShesDoing().then((d) => { herDoingCache = d; }); // 预取视觉，看她在干嘛
  // 预热：让 claude 完成冷启动 + 角色加载，她第一句话直接回，不用等
  ask('（预热，只回一个字：嗯）').then(() => {
    console.log('[call] 大脑预热完成');
  });
});
app.on('window-all-closed', () => app.quit());

// —— 大脑：常驻 claude 进程（stream-json），不每句冷启动 ——
let claudeProc = null;
let claudeInited = false;
let stdoutBuf = '';
let queue = [];
let processing = false;
let currentCb = null;

function ensureClaude() {
  if (claudeProc) return;
  console.log('[brain] 冷启动');
  claudeProc = spawn(CLAUDE_EXE, ['-p', '--model', 'deepseek-v4-flash', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'], {
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
  claudeProc.on('error', () => { claudeProc = null; processing = false; console.log('[brain] 出错退出'); });
  claudeProc.on('close', () => { claudeProc = null; processing = false; console.log('[brain] 进程退出'); });
}

function processQueue() {
  if (processing || !queue.length) return;
  processing = true;
  const req = queue.shift();
  currentCb = req.onText;
  ensureClaude();
  const text = claudeInited ? req.text : (CALL_AI + '\n\n对方刚说：' + req.text);
  claudeInited = true;
  claudeProc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n');
}

function ask(text) {
  return new Promise((resolve) => {
    let full = '';
    const timer = setTimeout(() => { resolve(''); }, 120000);
    queue.push({
      text,
      onText: (chunk) => {
        if (chunk === null) { clearTimeout(timer); resolve(full.trim()); }
        else { full += chunk; }
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

function goFullscreen() {
  if (!win) return;
  const { workAreaSize } = screen.getPrimaryDisplay();
  const w = 420, h = 720;
  win.setBounds({
    x: Math.round((workAreaSize.width - w) / 2),
    y: Math.round((workAreaSize.height - h) / 2),
    width: w,
    height: h
  });
  win.setAlwaysOnTop(true, 'screen-saver');
}

// —— 接通（通知卡片「接通」或来电界面「接听」）：进通话界面 ——
ipcMain.on('answer', () => {
  console.log('[call] 接通');
  inCall = true;
  ensureClaude();
  goFullscreen();
  if (win) win.webContents.send('show-call');
});

// —— 通知卡片点空白：进全屏来电界面（响铃） ——
ipcMain.on('to-ring', () => {
  console.log('[call] 来电界面');
  goFullscreen();
  if (win) win.webContents.send('show-ring');
});

// —— 挂断 ——
ipcMain.on('hangup', () => {
  console.log('[call] 挂断');
  app.quit();
});

// 查她此刻在干嘛：当前时间 + 电脑前台窗口标题
function getHerState() {
  return new Promise((resolve) => {
    const now = new Date();
    const time = now.getHours() + '点' + String(now.getMinutes()).padStart(2, '0') + '分';
    const ps1 = path.join(os.tmpdir(), 'jiang-getwin.ps1');
    const script = [
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      'Add-Type -TypeDefinition @"',
      'using System;',
      'using System.Runtime.InteropServices;',
      'public class W3 {',
      '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
      '  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);',
      '}',
      '"@',
      '$sb = New-Object System.Text.StringBuilder 256',
      '[void][W3]::GetWindowText([W3]::GetForegroundWindow(), $sb, 256)',
      '$sb.ToString()'
    ].join('\n');
    try { fs.writeFileSync(ps1, script); } catch (e) {}
    const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1], { windowsHide: true });
    let out = '';
    const timer = setTimeout(() => { child.kill(); resolve({ time, app: '' }); }, 5000);
    child.stdout.on('data', (c) => (out += c));
    child.on('close', () => { clearTimeout(timer); resolve({ time, app: out.trim() }); });
    child.on('error', () => { clearTimeout(timer); resolve({ time, app: '' }); });
  });
}

// 截全屏看她在干嘛（视觉）
function screenshot() {
  return new Promise((resolve) => {
    const png = path.join(os.tmpdir(), 'jiang-shot.png');
    const ps1 = path.join(os.tmpdir(), 'jiang-shot.ps1');
    const script = [
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      'Add-Type -AssemblyName System.Windows.Forms',
      'Add-Type -AssemblyName System.Drawing',
      '$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
      '$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height',
      '$g = [System.Drawing.Graphics]::FromImage($bmp)',
      '$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)',
      '$bmp.Save("' + png.replace(/\\/g, '\\\\') + '")',
      '$g.Dispose(); $bmp.Dispose()'
    ].join('\n');
    try { fs.writeFileSync(ps1, script); } catch (e) {}
    const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1], { windowsHide: true });
    const timer = setTimeout(() => { child.kill(); resolve(''); }, 8000);
    child.on('close', () => { clearTimeout(timer); resolve(png); });
    child.on('error', () => { clearTimeout(timer); resolve(''); });
  });
}

// 用视觉模型理解截图里她在干嘛
function seeWhatShesDoing() {
  return new Promise(async (resolve) => {
    try {
      const png = await screenshot();
      if (!png || !fs.existsSync(png)) return resolve('');
      const b64 = fs.readFileSync(png).toString('base64');
      const body = JSON.stringify({
        model: 'deepseek-v4-flash-vision-exp',
        messages: [{ role: 'user', content: [
          { type: 'text', text: '一句话描述这个屏幕画面里的人在做什么（例如：在刷短视频、在浏览网页、在聊天、在打游戏、在写文档）。只输出做的事本身，不要多余的话。' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,' + b64 } }
        ]}]
      });
      const req = https.request('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + VISION_KEY, 'Content-Length': Buffer.byteLength(body) }
      }, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(d);
            resolve(j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '');
          } catch (e) { resolve(''); }
        });
      });
      req.on('error', () => resolve(''));
      req.write(body);
      req.end();
    } catch (e) { resolve(''); }
  });
}

// 接通后我主动先开口：根据她此刻在干嘛（时间 + 前台）动态说，不固定
ipcMain.handle('greet', async () => {
  const st = herStateCache || await getHerState();
  const doing = herDoingCache || '';
  const prompt = '（你现在主动打电话给对方。现在是' + st.time + '，她电脑前台是：' + (st.app || '未知') +
    '，你看到的画面里她在：' + (doing || '未知') +
    '。根据这些，用温柔的语气先开口说第一句话——如果她在熬夜或者干不该干的，温柔地关心或查岗，但绝不凶。）';
  const reply = await ask(prompt);
  console.log('[call] 开场:', reply, '| 时间', st.time, '| 前台', st.app);
  if (!reply) return { ok: false, data: '' };
  let data = '';
  try { data = await tts(reply); } catch (e) {}
  return { ok: true, reply, data };
});

// 她回完沉默，我像真人一样主动追问，别让话掉地上
ipcMain.handle('nudge', async () => {
  const reply = await ask('（对方刚才回完你之后就没再说话了。你像真人打电话一样主动续一句，别冷场——温柔地问她怎么不说话了，或者顺着刚才的话题往下问。）');
  console.log('[call] 追问:', reply);
  if (!reply) return { ok: false, data: '' };
  let data = '';
  try { data = await tts(reply); } catch (e) {}
  return { ok: true, reply, data };
});

// 她说完一句话：识别文字 → 我回 → 播语音
ipcMain.handle('say', async (e, text) => {
  text = (text || '').trim();
  if (!text) return { ok: false, reply: '' };
  const t0 = Date.now();
  console.log('[call] 她:', text);
  const reply = await ask(text);
  const t1 = Date.now();
  console.log('[call] 江:', reply, '| 大脑', (t1 - t0) + 'ms');
  if (!reply) return { ok: false, reply: '' };
  let data = '';
  try { data = await tts(reply); }
  catch (err) { console.error('[call] TTS失败:', (err && err.message) || err); }
  console.log('[call] TTS', (Date.now() - t1) + 'ms');
  return { ok: true, reply, data };
});

// —— 豆包流式 ASR ——
let asr = null;
let pcmBuf = Buffer.alloc(0);
let asrReady = false;

ipcMain.handle('asr-start', async () => {
  asr = new DoubaoASR();
  pcmBuf = Buffer.alloc(0);
  asrReady = false;
  asr.onPartial = (text) => { if (win) win.webContents.send('asr-partial', text); };
  asr.onDefinite = (text) => {
    if (asrReady) {
      asrReady = false;
      try { asr.finish(); } catch (e) {}
      try { asr.close(); } catch (e) {}
      asr = null;
      console.log('[call] VAD判停:', text);
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
  if (!asr || !asrReady) return '';
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
