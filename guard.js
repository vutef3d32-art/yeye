// 桌宠看门狗：进程退出后自动重启，带退避
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const APP = __dirname;
const EXE = path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');
const LOCK = path.join(APP, 'guard.lock');
const LOG = path.join(APP, 'guard.log');

function log(line) {
  const s = new Date().toLocaleString('zh-CN', { hour12: false }) + ' ' + line + '\n';
  try { fs.appendFileSync(LOG, s, 'utf8'); } catch (e) {}
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return false; }
}

if (fs.existsSync(LOCK)) {
  const old = parseInt(fs.readFileSync(LOCK, 'utf8').trim(), 10);
  if (old && old !== process.pid && alive(old)) {
    log('[guard] 已经有一个在看着了 pid=' + old + '，我退出');
    process.exit(0);
  }
}
fs.writeFileSync(LOCK, String(process.pid), 'utf8');

let child = null;
let stopping = false;
let fails = 0;

function launch() {
  child = spawn(EXE, [APP], { cwd: APP, stdio: 'ignore' });
  log('[guard] 拉起桌宠 pid=' + child.pid);
  const born = child;
  child.on('exit', (code) => {
    if (child === born) child = null;
    if (stopping) return;
    fails += 1;
    const wait = Math.min(60000, 3000 * fails);
    log('[guard] 桌宠退出 code=' + code + '，' + wait + 'ms 后重拉');
    setTimeout(launch, wait);
  });
  child.on('error', (err) => {
    if (child === born) child = null;
    if (stopping) return;
    log('[guard] 没拉起来：' + err.message);
    setTimeout(launch, 15000);
  });
  // 活了 30 秒就算稳了，退避计数清零
  setTimeout(() => { if (child === born) fails = 0; }, 30000);
}

launch();

function bye() {
  stopping = true;
  try { fs.unlinkSync(LOCK); } catch (e) {}
  if (child) { try { child.kill(); } catch (e) {} }
  log('[guard] 收到停止信号，收工');
  process.exit(0);
}
process.on('SIGTERM', bye);
process.on('SIGINT', bye);
