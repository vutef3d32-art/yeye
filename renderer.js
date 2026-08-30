const { ipcRenderer } = require('electron');

const img = document.getElementById('pet-img');
const log = document.getElementById('log');
const msg = document.getElementById('msg');
const mic = document.getElementById('mic');
const voice = document.getElementById('voice');
const pet = document.getElementById('pet');

let speakOn = false; // 我说话开关（F 键或 🔊 按钮切换）

img.src = 'assets/avatar.jpg';
msg.focus();

// 响应式：窗口缩小时，内容按比例缩放（zoom）
function updateZoom() {
  const w = window.innerWidth;
  const zoom = Math.min(1, w / 300);
  document.body.style.zoom = zoom;
}
window.addEventListener('resize', updateZoom);
updateZoom();

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
  if (r.ok && r.data) {
    const a = new Audio('data:audio/mp3;base64,' + r.data);
  }
}

async function send(text) {
  text = (text || '').trim();
  if (!text) return;
  addMsg(text, 'you');
  await askClaude(text);
}

let myMsgEl = null;

// 流式显示我的回复：边生成边上屏
ipcRenderer.on('ask-partial', (e, text) => {
  if (!myMsgEl) {
    myMsgEl = document.createElement('div');
    myMsgEl.className = 'msg me';
    log.appendChild(myMsgEl);
  }
  myMsgEl.textContent = text;
  log.scrollTop = log.scrollHeight;
});

async function askClaude(text) {
  myMsgEl = null;
  const r = await ipcRenderer.invoke('ask', text);
  if (r.ok && r.reply) {
    if (myMsgEl) myMsgEl.textContent = r.reply;
    playSpeak(r.reply);
  } else if (!myMsgEl) {
    addMsg('（没连上我）', 'me');
  }
}

// —— 开麦（豆包流式 ASR）——
let mediaStream = null;
let audioCtx = null;
let processor = null;

async function startMic() {
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true }
  });
  audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  const source = audioCtx.createMediaStreamSource(mediaStream);
  processor = audioCtx.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (e) => {
    const f = e.inputBuffer.getChannelData(0);
    const i16 = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) {
      const s = Math.max(-1, Math.min(1, f[i]));
      i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    ipcRenderer.send('asr-audio', i16.buffer);
  };
  source.connect(processor);
  processor.connect(audioCtx.destination);
}

function stopMic() {
  try { processor && processor.disconnect(); } catch (e) {}
  try { audioCtx && audioCtx.close(); } catch (e) {}
  try { mediaStream && mediaStream.getTracks().forEach((t) => t.stop()); } catch (e) {}
  mediaStream = null; audioCtx = null; processor = null;
}

let micLocked = false;
let partialEl = null;
let lastPartialTime = 0;
let lastPartialText = '';
let autoCloseTimer = null;

// 实时识别文字：边说边显示
ipcRenderer.on('asr-partial', (e, text) => {
  if (!micLocked) return; // 关闭麦后忽略延迟的识别结果
  if (!text) return;
  if (text === lastPartialText) return; // 文字没变，不算"还在说"
  lastPartialText = text;
  lastPartialTime = Date.now();
  if (!partialEl) {
    partialEl = document.createElement('div');
    partialEl.className = 'msg you';
    log.appendChild(partialEl);
  }
  partialEl.textContent = text;
  log.scrollTop = log.scrollHeight;
});

async function lockMic() {
  micLocked = true;
  mic.classList.add('active');
  lastPartialTime = Date.now();
  lastPartialText = '';
  const r = await ipcRenderer.invoke('asr-start');
  if (r && r.ok) {
    try { await startMic(); }
    catch (e) { addMsg('（麦克风没起来）', 'me'); }
  }
  // 说完静音 2.5 秒自动关麦出字
  autoCloseTimer = setInterval(() => {
    if (micLocked && Date.now() - lastPartialTime > 2500) {
      unlockMic();
    }
  }, 400);
}

async function unlockMic() {
  clearInterval(autoCloseTimer);
  micLocked = false;
  mic.classList.remove('active');
  stopMic();
  const text = await ipcRenderer.invoke('asr-finish');
  if (partialEl) {
    if (text && partialEl.textContent !== text) partialEl.textContent = text;
    partialEl = null;
    if (text) await askClaude(text);
  } else if (text) {
    addMsg(text, 'you');
    await askClaude(text);
  }
}

// VAD 判停：自动完成（豆包说完了就触发）
ipcRenderer.on('asr-done', async (e, text) => {
  clearInterval(autoCloseTimer);
  micLocked = false;
  mic.classList.remove('active');
  stopMic();
  if (partialEl) {
    if (text && partialEl.textContent !== text) partialEl.textContent = text;
    partialEl = null;
  }
  if (text) await askClaude(text);
});

// 🔊 我说话开关：点一下我开口，再点我只打字
voice.addEventListener('click', () => {
  speakOn = !speakOn;
  voice.classList.toggle('on', speakOn);
});

// 🎙 按钮：点一下开麦，再点一下关麦（出文字）
mic.addEventListener('click', () => {
  if (micLocked) unlockMic();
  else lockMic();
});

// 键盘：空格/T 长按锁定开麦，再按取消；F 键切我说话
let keyTimer = null;
document.addEventListener('keydown', async (e) => {
  if (e.code === 'KeyF') {
    speakOn = !speakOn;
    addMsg(speakOn ? '（我开口）' : '（我只打字）', 'me');
    return;
  }
  if (e.code !== 'Space' && e.code !== 'KeyT') return;
  if (e.repeat) return;
  if (document.activeElement === msg) return;
  e.preventDefault();
  if (micLocked) { unlockMic(); return; }
  keyTimer = setTimeout(() => { if (!micLocked) lockMic(); }, 400);
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space' || e.code === 'KeyT') clearTimeout(keyTimer);
});

// 打字
msg.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const t = msg.value;
    msg.value = '';
    send(t);
  }
});

// 等比例缩放（按住右下角）。移动窗口用 #pet 的原生 drag，不走 setBounds。
const resizeCorner = document.getElementById('resize-corner');
let resizing = false;
let lastX = 0;
let lastY = 0;

resizeCorner.addEventListener('mousedown', (e) => {
  resizing = true;
  lastX = e.screenX;
  lastY = e.screenY;
  e.preventDefault();
  e.stopPropagation();
});

document.addEventListener('mousemove', (e) => {
  if (e.buttons === 0) { resizing = false; return; }
  if (!resizing) return;
  const dx = e.screenX - lastX;
  const dy = e.screenY - lastY;
  lastX = e.screenX;
  lastY = e.screenY;
  if (dx === 0 && dy === 0) return;
  ipcRenderer.invoke('resize-by', dx, dy);
});

window.addEventListener('mouseup', () => { resizing = false; });

// 双击人物 = 选图换形象
pet.addEventListener('dblclick', async () => {
  const r = await ipcRenderer.invoke('chooseImage');
  if (r && r.ok) {
    img.src = r.path + '?t=' + Date.now();
    addMsg('（形象换了）', 'me');
  }
});

// 拖图：拖到人物身上 = 换形象；拖到对话区 = 我看图（视觉）
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (!f || !f.path) return;
  const petRect = pet.getBoundingClientRect();
  if (e.clientY < petRect.bottom) {
    // 落在人物区 → 换形象
    const r = await ipcRenderer.invoke('setAvatar', f.path);
    if (r && r.ok) {
      img.src = r.path + '?t=' + Date.now();
      addMsg('（形象换了）', 'me');
    }
    return;
  }
  // 落在对话区 → 我看图
  addMsg('（看图中…）', 'me');
  const r = await ipcRenderer.invoke('vision', f.path, '');
  if (r && r.ok && r.reply) {
    addMsg(r.reply, 'me');
    playSpeak(r.reply);
  } else {
    addMsg('（没看懂这张图）', 'me');
  }
});
