const fs = require('fs');
const { DoubaoASR } = require('./asr');

const wav = fs.readFileSync('test.wav');
const dataIdx = wav.indexOf(Buffer.from('data')) + 8;
const pcm = wav.slice(dataIdx);
console.log('PCM 大小:', pcm.length, '字节 ≈', Math.round(pcm.length / 32000), '秒');

const asr = new DoubaoASR();
asr.onResult = (text) => {
  console.log('识别结果: ' + text);
  asr.close();
  process.exit(0);
};

asr.connect().then(() => {
  const chunk = 3200; // 100ms
  for (let i = 0; i < pcm.length; i += chunk) {
    asr.sendAudio(pcm.slice(i, i + chunk));
  }
  setTimeout(() => asr.finish(), 500);
}).catch((e) => {
  console.error('连接失败:', e.message);
  process.exit(1);
});

setTimeout(() => { console.error('超时'); process.exit(1); }, 15000);
