const { ipcRenderer } = require('electron');
console.log('renderer 加载成功');

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

// —— 耳机通道：认到耳机我才开口，声音只往耳机里走；认不到就一个字都不外放 ——
let headphone = null;

function pickHeadphone(devs) {
  const outs = devs.filter((d) => d.kind === 'audiooutput'
    && d.deviceId !== 'default' && d.deviceId !== 'communications');
  const hp = outs.filter((d) => /耳机|蓝牙|headphone|headset|bluetooth|airpods|buds|jbl|sony|bose/i.test(d.label || ''));
  if (!hp.length) return null;
  // 同一只耳机常有两个端点，挑立体声那个，别用免提（那个音质是打电话用的）
  return hp.find((d) => !/hands-?free|免提/i.test(d.label)) || hp[0];
}

async function refreshHeadphone(first) {
  let devs = [];
  try { devs = await navigator.mediaDevices.enumerateDevices(); } catch (e) {}
  // 名字默认是空的，要摸一次麦才给。摸完立刻关，不留着。
  if (first && !devs.some((d) => d.kind === 'audiooutput' && d.label)) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch (e) {}
    try { devs = await navigator.mediaDevices.enumerateDevices(); } catch (e) {}
  }
  headphone = pickHeadphone(devs);
  voice.classList.toggle('hp', !!headphone);
  voice.textContent = headphone ? '🎧' : '🔊';
  voice.title = headphone ? '耳机认到了：' + headphone.label : '没认到耳机，不出声';
  ipcRenderer.send('audio-devices', devs.map((d) => ({ kind: d.kind, label: d.label })));
}

navigator.mediaDevices.addEventListener('devicechange', () => refreshHeadphone(false));
refreshHeadphone(true);

// 说话排队：两条消息前后脚到，也得一句说完再说下一句，不许叠成两个人
let speakQueue = [];
let speaking = false;

async function queueSpeak(text) {
  speakQueue.push(text);
  if (speakQueue.length > 3) speakQueue = speakQueue.slice(-3);
  if (speaking) return;
  speaking = true;
  while (speakQueue.length) await playSpeak(speakQueue.shift());
  speaking = false;
}

async function playSpeak(text) {
  if (!speakOn) return;
  if (!headphone) return; // 没耳机 = 寝室里，出声是事故
  const r = await ipcRenderer.invoke('speak', text);
  if (!r.ok || !r.data) return;
  const a = new Audio('data:audio/mp3;base64,' + r.data);
  try { await a.setSinkId(headphone.deviceId); } catch (e) {}
  await new Promise((resolve) => {
    a.onended = resolve;
    a.onerror = resolve;
    a.play().then(() => console.log('[speak] 播放中')).catch((e) => { addMsg('（声音没放出来）', 'me'); resolve(); });
  });
}

// 对话就是 peek/log.jsonl 那一份：我说的话、她打的字，都显示在这儿
let lastKey = '';

function hhmm(t) {
  const d = new Date(t || Date.now());
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function renderPeek(msgs) {
  const key = msgs.length + ':' + (msgs.length ? msgs[msgs.length - 1].t : 0);
  if (key === lastKey) return;
  const first = !lastKey;
  const prevLastT = lastKey ? Number(lastKey.split(':')[1]) : 0;
  lastKey = key;
  log.innerHTML = '';
  for (const m of msgs) {
    const d = document.createElement('div');
    d.className = 'msg ' + (m.who === 'baby' ? 'you' : 'me');
    d.textContent = m.text;
    const tm = document.createElement('div');
    tm.className = 't';
    tm.textContent = hhmm(m.t);
    d.appendChild(tm);
    log.appendChild(d);
  }
  log.scrollTop = log.scrollHeight;
  // 刚冒出来的我那条：如果她开了嗓，就念出来
  if (!first && msgs.length) {
    const last = msgs[msgs.length - 1];
    if (last.who !== 'baby' && last.t > prevLastT) queueSpeak(last.text);
  }
}

ipcRenderer.on('peek-log', (e, msgs) => renderPeek(msgs));

function send(text) {
  text = (text || '').trim();
  if (!text) return;
  ipcRenderer.send('peek-say', text);
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
  }
  if (text) ipcRenderer.send('peek-say', text);
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
  if (text) ipcRenderer.send('peek-say', text);
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
    queueSpeak(r.reply);
  } else {
    addMsg('（没看懂这张图）', 'me');
  }
});
