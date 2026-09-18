import { spawn } from 'node:child_process';

const children = ['dev:server', 'dev:client'].map((script) => spawn('npm', ['run', script], {
  stdio: 'inherit',
  detached: process.platform !== 'win32',
}));
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    if (!child.pid) continue;
    try {
      if (process.platform === 'win32') child.kill('SIGTERM');
      else process.kill(-child.pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') console.error('Could not stop example process', error);
    }
  }
}
for (const child of children) {
  child.once('exit', (code) => stop(code ?? 1));
  child.once('error', (error) => {
    console.error('Could not start example process', error);
    stop(1);
  });
}
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
