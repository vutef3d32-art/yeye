// 密钥不进仓库：真实值放 config.local.json（已 gitignore），或者走环境变量
const fs = require('fs');
const path = require('path');

let local = {};
try { local = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.local.json'), 'utf8')); } catch (e) {}

const d = local.doubao || {};
const s = local.deepseek || {};

module.exports = {
  DOUBAO: {
    appid: process.env.DOUBAO_APPID || d.appid || '',
    token: process.env.DOUBAO_TOKEN || d.token || '',
    cluster: process.env.DOUBAO_CLUSTER || d.cluster || 'volcano_icl',
    voice: process.env.DOUBAO_VOICE || d.voice || ''
  },
  DEEPSEEK_KEY: process.env.DEEPSEEK_KEY || s.key || ''
};
