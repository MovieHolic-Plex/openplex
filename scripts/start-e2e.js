import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const root = new URL('../', import.meta.url);
const processes = [];
let stopping = false;

function launch(command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  processes.push(child);
  child.on('exit', (code) => {
    if (!stopping && code !== 0) shutdown(code ?? 1);
  });
  return child;
}

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of processes) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 250).unref();
}

const databasePath = path.resolve(root.pathname.replace(/^\/(.:)/, '$1'), '.data/openplex-e2e.db');
for (const suffix of ['', '-shm', '-wal']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
const mediaPath = path.resolve(root.pathname.replace(/^\/(.:)/, '$1'), '.data/e2e-media');
fs.rmSync(mediaPath, { recursive: true, force: true });
const database = new Database(databasePath);
database.exec(`
  CREATE TABLE watch_history (
    category TEXT NOT NULL, id INTEGER NOT NULL, epIdx INTEGER NOT NULL,
    title TEXT NOT NULL, thumb TEXT NOT NULL, position_sec REAL NOT NULL,
    duration_sec REAL NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY (category, id, epIdx)
  );
  CREATE TABLE bookmarks (
    category TEXT NOT NULL, id INTEGER NOT NULL, title TEXT NOT NULL,
    thumb TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY (category, id)
  );
`);
database.prepare('INSERT INTO watch_history VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
  'drama', 74001, 1, 'Fixture Drama - Episode One',
  'http://127.0.0.1:3100/poster.svg', 12, 120, Date.now(),
);
database.close();

launch(process.execPath, ['scripts/e2e-upstream.js']);
launch(process.execPath, ['server/dist/crawl/server.js'], {
  NODE_ENV: 'production',
  OPENPLEX_CRAWL_PORT: '33889',
  OPENPLEX_UPSTREAM_URL: 'http://127.0.0.1:3100',
  OPENPLEX_DATA_PATH: '.data/openplex-e2e.db',
  OPENPLEX_MEDIA_PATH: '.data/e2e-media',
  OPENPLEX_MEDIA_URL: 'http://127.0.0.1:33888',
});
launch(process.execPath, ['server/dist/index.js'], {
  NODE_ENV: 'production',
  PORT: '33888',
  OPENPLEX_DATA_PATH: '.data/openplex-e2e.db',
  OPENPLEX_MEDIA_PATH: '.data/e2e-media',
  OPENPLEX_CRAWL_URL: 'http://127.0.0.1:33889',
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown(0));
