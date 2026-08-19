/* global clearTimeout, console, HTMLMediaElement, localStorage, process, setTimeout */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const outputDir = path.resolve('artifacts/visual-qa');
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.addInitScript(() => localStorage.setItem('openplex.profileId', '1'));
await page.goto('http://127.0.0.1:33888/', { waitUntil: 'networkidle', timeout: 60_000 });

const details = page.getByRole('button', { name: 'Details' }).first();
await details.waitFor({ timeout: 60_000 });
await details.click();
const episode = page.getByRole('dialog').getByRole('button').filter({ hasText: /Episode|화/ }).first();
await episode.waitFor({ timeout: 60_000 });
const streamResponse = page.waitForResponse((response) =>
  response.request().method() === 'POST' && response.url().includes('/api/stream/'),
  { timeout: 60_000 },
);
await episode.click();
const stream = await streamResponse;
if (!stream.ok()) throw new Error(`Stream request failed: ${stream.status()} ${await stream.text()}`);

const player = page.getByTestId('openplex-player-container');
const video = player.locator('video');
await player.waitFor({ timeout: 60_000 });
await video.evaluate((element) => element.play().catch(() => undefined));

const before = await video.evaluate((element) => {
  const media = element;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`video readiness timeout: readyState=${media.readyState}, error=${media.error?.message ?? 'none'}`)), 45_000);
    const finish = () => {
      if (media.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return;
      clearTimeout(timeout);
      media.removeEventListener('canplay', finish);
      resolve({
        readyState: media.readyState,
        currentTime: media.currentTime,
        videoWidth: media.videoWidth,
        videoHeight: media.videoHeight,
        paused: media.paused,
        error: media.error ? { code: media.error.code, message: media.error.message } : null,
        currentSrc: media.currentSrc,
      });
    };
    media.addEventListener('canplay', finish);
    finish();
  });
});

const after = await video.evaluate((element) => {
  const media = element;
  return new Promise((resolve, reject) => {
    const start = media.currentTime;
    const timeout = setTimeout(() => reject(new Error(`video progress timeout: start=${start}, current=${media.currentTime}`)), 20_000);
    const finish = () => {
      if (media.currentTime <= start + 0.5) return;
      clearTimeout(timeout);
      media.removeEventListener('timeupdate', finish);
      resolve({
        readyState: media.readyState,
        currentTime: media.currentTime,
        advancedBy: media.currentTime - start,
        videoWidth: media.videoWidth,
        videoHeight: media.videoHeight,
        paused: media.paused,
        error: media.error ? { code: media.error.code, message: media.error.message } : null,
      });
    };
    media.addEventListener('timeupdate', finish);
    void media.play().then(finish, reject);
  });
});

await page.screenshot({ path: path.join(outputDir, 'live-playback.png') });
const evidence = { capturedAt: new Date().toISOString(), streamStatus: stream.status(), before, after };
fs.writeFileSync(path.join(outputDir, 'live-playback-metrics.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));

await browser.close();
if (after.readyState < 3 || after.currentTime <= before.currentTime || after.videoWidth <= 0 || after.videoHeight <= 0 || after.error !== null) {
  process.exitCode = 1;
}
