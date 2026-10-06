// Sobe a API (com recarga automática) e o Vite juntos.
import { spawn } from 'node:child_process';

const run = (cmd, args) => spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
const api = run('node', ['--watch-path=server', '--watch-path=shared', '--disable-warning=ExperimentalWarning', 'server/index.js']);
const web = run('npx', ['vite']);
const parar = () => { api.kill(); web.kill(); process.exit(); };
process.on('SIGINT', parar);
process.on('SIGTERM', parar);
