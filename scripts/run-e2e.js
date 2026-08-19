import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import { startE2eUpstream, server as upstreamServer } from './e2e-upstream.js';

const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/(.:)/, '$1'));
const databasePath = path.join(root, '.data', 'openplex-e2e.db');
for (const suffix of ['', '-shm', '-wal']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
const mediaPath = path.join(root, '.data', 'e2e-media');
fs.rmSync(mediaPath, { recursive: true, force: true });
process.env.OPENPLEX_MEDIA_PATH = mediaPath;
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

await startE2eUpstream();
const { startServer } = await import('../server/dist/index.js');
const { startCrawlServer } = await import('../server/dist/crawl/server.js');
const { SQLiteStore } = await import('../server/dist/store/sqlite-store.js');
const crawl = await startCrawlServer({
  port: 33889,
  logger: false,
  dependencies: {
    store: new SQLiteStore(databasePath),
    mediaRoot: mediaPath,
    mediaUrl: 'http://127.0.0.1:33888',
  },
});
const app = await startServer({
  port: 33888,
  logger: false,
  dependencies: {
    store: new SQLiteStore(databasePath),
    mediaRoot: mediaPath,
    crawlUrl: 'http://127.0.0.1:33889',
  },
});

const playwrightCli = path.join(root, 'node_modules', 'playwright', 'cli.js');
const playwright = spawn(
  process.execPath,
  [playwrightCli, 'test', '--config=playwright.config.ts'],
  {
    cwd: root,
    env: { ...process.env, OPENPLEX_MANAGED_SERVER: '1' },
    stdio: 'inherit',
  },
);

const exitCode = await new Promise((resolve) => {
  playwright.once('exit', (code) => resolve(code ?? 1));
});
await app.close();
await crawl.close();
await new Promise((resolve) => upstreamServer.close(resolve));
process.exitCode = exitCode;
