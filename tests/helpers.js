// tests/helpers.js — serveur éphémère sur données temporaires, client HTTP minimal.
// Chaque suite obtient son propre dossier : aucun test ne touche data/ du dépôt.

import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

export async function tempDataDir({ seed = 'small.m3u' } = {}) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'streamtv-test-'));
  await fsp.mkdir(path.join(dir, 'seed'), { recursive: true });
  if (seed) {
    const fixture = path.join(ROOT, 'tests', 'fixtures', seed);
    await fsp.copyFile(fixture, path.join(dir, 'seed', 'seed.m3u'));
  }
  return dir;
}

export async function startServer({ dataDir, env = {} } = {}) {
  const dir = dataDir || await tempDataDir();
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), HOST: '127.0.0.1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`le serveur s’est arrêté :\n${output}`);
    try {
      const response = await fetch(`${base}/healthz`);
      if (response.ok) break;
    } catch { /* pas encore prêt */ }
    if (Date.now() > deadline) throw new Error(`démarrage trop lent :\n${output}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const client = async (pathname, { method = 'GET', body = undefined, token = '', headers = {} } = {}) => {
    const init = { method, headers: { ...headers } };
    if (token) init.headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) {
      init.headers['Content-Type'] = init.headers['Content-Type'] || 'application/json';
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const response = await fetch(`${base}${pathname}`, init);
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: response.status, headers: response.headers, text, json };
  };

  const login = async (password = 'admin') => {
    const response = await client('/api/login', { method: 'POST', body: { password } });
    return { ...response, token: response.json?.token || '' };
  };

  const stop = async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    }
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  };

  return { base, port, dataDir: dir, client, login, stop, output: () => output, child };
}

export { ROOT };

/** Exécute une suite sur un serveur isolé puis l'arrête, même en cas d'échec. */
export async function withServer(options, fn) {
  const server = await startServer(options);
  try {
    return await fn(server);
  } finally {
    await server.stop();
  }
}
