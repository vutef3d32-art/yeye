// 豆包流式语音识别(ASR) —— 火山引擎 bigmodel_nostream 协议（已实测通过）
const WebSocket = require('ws');
const crypto = require('crypto');

const { DOUBAO: _d } = require('./config');

const DOUBAO = {
  appid: _d.appid,
  token: _d.token,
  resourceId: 'volc.bigasr.sauc.duration'
};

function buildHeader(messageType, flags, serialization, compression) {
  const b0 = (0x01 << 4) | 0x01; // version 1, header size 1
  const b1 = (messageType << 4) | flags;
  const b2 = (serialization << 4) | compression;
  return Buffer.from([b0, b1, b2, 0x00]);
}

function buildFullClientRequest(json) {
  const header = buildHeader(1, 0, 1, 0);
  const payload = Buffer.from(json, 'utf8');
  const size = Buffer.alloc(4);
  size.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, size, payload]);
}

function buildAudioRequest(pcm) {
  const header = buildHeader(2, 0, 0, 0);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(pcm.length, 0);
  return Buffer.concat([header, size, pcm]);
}

function buildLastRequest() {
  const header = buildHeader(2, 2, 0, 0); // flags=2: 最后一包，不带 sequence
  const size = Buffer.alloc(4);
  size.writeUInt32BE(0, 0);
  return Buffer.concat([header, size]);
}

class DoubaoASR {
  constructor() {
    this.resultText = '';
    this.resolveResult = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('wss://openspeech.bytedance.com/api/v3/sauc/bigmodel', {
        headers: {
          'X-Api-App-Key': DOUBAO.appid,
          'X-Api-Access-Key': DOUBAO.token,
          'X-Api-Resource-Id': DOUBAO.resourceId,
          'X-Api-Connect-Id': crypto.randomUUID()
        }
      });
      this.ws.on('open', () => {
        const meta = JSON.stringify({
          user: { uid: 'baby' },
          audio: { format: 'pcm', rate: 16000, bits: 16, channel: 1, language: 'zh-CN' },
          request: { model_name: 'bigmodel', enable_itn: true, enable_punc: true, enable_ddc: true }
        });
        try { this.ws.send(buildFullClientRequest(meta)); } catch (e) {}
        resolve();
      });
      this.ws.on('error', reject);
      this.ws.on('message', (data) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (buf.length < 8) return;
        const messageType = (buf[1] >> 4) & 0x0f;
        const flags = buf[1] & 0x0f;
        const hasSeq = (flags & 0x01) === 0x01;
        let offset = 4;
        if (hasSeq) offset += 4;
        if (buf.length < offset + 4) return;
        const size = buf.readUInt32BE(offset);
        const payload = buf.slice(offset + 4, offset + 4 + size);
        if (messageType === 0x09) {
          try {
            const j = JSON.parse(payload.toString('utf8'));
            if (j.result && j.result.text) {
              this.resultText = j.result.text;
              if (this.onPartial) this.onPartial(this.resultText); // 实时增量
              const definite = j.result.utterances && j.result.utterances.some((u) => u.definite);
              if (definite && this.onDefinite && !this._definiteFired) {
                this._definiteFired = true;
                this.onDefinite(this.resultText); // VAD 判停，自动完成
              }
              if (this.resolveResult) {
                this.resolveResult(this.resultText);
                this.resolveResult = null;
              }
            }
          } catch (e) {}
        }
      });
    });
  }

  sendAudio(pcm) {
    if (this.ws && this.ws.readyState === 1 && pcm.length) {
      this.ws.send(buildAudioRequest(pcm));
    }
  }

  finish() {
    return new Promise((resolve) => {
      this.resolveResult = resolve;
      try { this.ws.send(buildLastRequest()); } catch (e) { resolve(this.resultText); }
      setTimeout(() => {
        if (this.resolveResult) {
          this.resolveResult(this.resultText);
          this.resolveResult = null;
        }
      }, 5000);
    });
  }

  close() {
    try { this.ws && this.ws.close(); } catch (e) {}
  }
}

module.exports = { DoubaoASR };
