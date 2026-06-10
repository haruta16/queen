import { spawn } from 'node:child_process';

const children = [];

function run(name, command, args) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: process.env,
  });
  children.push(child);
  child.on('exit', (code, signal) => {
    if (signal) return;
    if (code && code !== 0) {
      shutdown(code);
    }
  });
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run('analyzer', 'python3', ['server/queen_analyzer_server.py', '--port', '8765']);
run('vite', 'npm', ['run', 'dev']);
