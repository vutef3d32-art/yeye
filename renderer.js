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
