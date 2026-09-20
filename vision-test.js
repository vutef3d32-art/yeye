const https = require('https');
const fs = require('fs');
const img = fs.readFileSync('assets/avatar.jpg').toString('base64');
const body = JSON.stringify({
  model: 'deepseek-v4-flash-vision-exp',
  messages: [{ role: 'user', content: [
    { type: 'text', text: '这张图里是什么？一句话回答' },
    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + img } }
  ]}]
});
const req = https.request('https://api.deepseek.com/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + require('./config').DEEPSEEK_KEY, 'Content-Length': Buffer.byteLength(body) }
}, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => console.log(d.slice(0, 600))); });
req.on('error', e => console.error('ERR', e.message));
req.write(body); req.end();
