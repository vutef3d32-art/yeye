const WebSocket = require('ws');
const crypto = require('crypto');
const fs = require('fs');

function buildHeader(mt, flags, ser, comp) {
  return Buffer.from([((0x01 << 4) | 0x01), ((mt << 4) | flags), ((ser << 4) | comp), 0x00]);
}
function fullClient(json) {
  const h = buildHeader(1, 0, 1, 0);
  const p = Buffer.from(json, 'utf8');
  const s = Buffer.alloc(4); s.writeUInt32BE(p.length, 0);
  return Buffer.concat([h, s, p]);
}
function audio(pcm) {
  const h = buildHeader(2, 0, 0, 0);
  const s = Buffer.alloc(4); s.writeUInt32BE(pcm.length, 0);
  return Buffer.concat([h, s, pcm]);
}
function last() {
  const h = buildHeader(2, 2, 0, 0); // flags=2: 最后一包，不带sequence
  const s = Buffer.alloc(4); s.writeUInt32BE(0, 0);
  return Buffer.concat([h, s]);
}

const { DOUBAO } = require('./config');

const ws = new WebSocket('wss://openspeech.bytedance.com/api/v3/sauc/bigmodel', {
  headers: {
    'X-Api-App-Key': DOUBAO.appid,
    'X-Api-Access-Key': DOUBAO.token,
    'X-Api-Resource-Id': 'volc.bigasr.sauc.duration',
    'X-Api-Connect-Id': crypto.randomUUID()
  }
});

ws.on('open', () => {
  console.log('WS 已连接');
  const meta = JSON.stringify({ user: { uid: 'baby' }, audio: { format: 'pcm', rate: 16000, bits: 16, channel: 1, language: 'zh-CN' }, request: { model_name: 'bigmodel', enable_itn: true, enable_punc: true } });
  ws.send(fullClient(meta));
  console.log('已发 full client request');
  const wav = fs.readFileSync('test.wav');
  const pcm = wav.slice(wav.indexOf(Buffer.from('data')) + 8);
  const chunk = 3200;
  for (let i = 0; i < pcm.length; i += chunk) ws.send(audio(pcm.slice(i, i + chunk)));
  console.log('已发音频', pcm.length, '字节');
  setTimeout(() => { ws.send(last()); console.log('已发负包'); }, 500);
});

ws.on('message', (data) => {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  console.log('收到消息, 长度', buf.length, 'hex前8:', buf.slice(0, 8).toString('hex'));
  const mt = (buf[1] >> 4) & 0x0f, fl = buf[1] & 0x0f;
  console.log('  messageType=', mt, 'flags=', fl);
  const hasSeq = (fl & 1) === 1;
  let off = 4; if (hasSeq) off += 4;
  if (buf.length > off + 4) {
    const size = buf.readUInt32BE(off);
    const payload = buf.slice(off + 4, off + 4 + size).toString('utf8');
    console.log('  payload:', payload.slice(0, 300));
  }
});

ws.on('error', (e) => console.error('WS错误:', e.message));
ws.on('close', (c) => console.log('WS关闭', c));

setTimeout(() => { console.log('超时退出'); process.exit(0); }, 12000);
