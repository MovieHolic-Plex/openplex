import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/(.:)/, '$1'));
const dataDir = path.join(root, '.data');
fs.mkdirSync(dataDir, { recursive: true });

const dataPath = process.env.OPENPLEX_DATA_PATH ?? path.join(dataDir, 'openplex.db');
const mediaPath = process.env.OPENPLEX_MEDIA_PATH ?? path.join(dataDir, 'media');
const mediaPort = process.env.PORT ?? '33888';
const crawlPort = process.env.OPENPLEX_CRAWL_PORT ?? '33889';
const token = process.env.OPENPLEX_AUTH_TOKEN;
const shared = {
  ...process.env,
  OPENPLEX_DATA_PATH: dataPath,
  OPENPLEX_MEDIA_PATH: mediaPath,
  OPENPLEX_CRAWL_URL: `http://127.0.0.1:${crawlPort}`,
  OPENPLEX_MEDIA_URL: `http://127.0.0.1:${mediaPort}`,
};

const children = [];
let stopping = false;

function launch(args, env, label) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  children.push(child);
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`${label} exited (${code ?? 'null'})`);
      shutdown(code ?? 1);
    }
  });
}

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 300).unref();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(0));
}

const crawlJs = path.join(root, 'server', 'dist', 'crawl', 'server.js');
const mediaJs = path.join(root, 'server', 'dist', 'index.js');
const crawlTs = path.join(root, 'server', 'src', 'crawl', 'server.ts');
const mediaTs = path.join(root, 'server', 'src', 'index.ts');
const tsx = path.join(root, 'server', 'node_modules', 'tsx', 'dist', 'cli.mjs');
const runner = fs.existsSync(tsx) ? tsx : path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const useDist = fs.existsSync(mediaJs) && fs.existsSync(crawlJs);

launch(
  useDist ? [crawlJs] : [runner, crawlTs],
  {
    ...shared,
    PORT: crawlPort,
    OPENPLEX_CRAWL_PORT: crawlPort,
    OPENPLEX_AUTH_TOKEN: token,
  },
  'crawl',
);
launch(
  useDist ? [mediaJs] : [runner, mediaTs],
  {
    ...shared,
    PORT: mediaPort,
    OPENPLEX_AUTH_TOKEN: token,
  },
  'media',
);

console.log(`OpenPlex media http://127.0.0.1:${mediaPort}`);
console.log(`OpenPlex crawl  http://127.0.0.1:${crawlPort} (loopback)`);
