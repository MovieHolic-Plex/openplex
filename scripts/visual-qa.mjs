/* global console, document, localStorage, process */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const outputDir = path.resolve('artifacts/visual-qa');
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const findings = [];

async function inspectViewport(name, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.addInitScript(() => localStorage.setItem('openplex.profileId', '1'));
  await page.goto('http://127.0.0.1:33888/', { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(outputDir, `${name}-home.png`), fullPage: true });

  const overflow = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  if (overflow.document > overflow.viewport + 1) findings.push(`${name}: horizontal overflow ${overflow.document - overflow.viewport}px`);

  const detailButton = page.getByRole('button', { name: 'Details' }).first();
  await detailButton.click();
  await page.getByRole('dialog').waitFor();
  await page.screenshot({ path: path.join(outputDir, `${name}-detail.png`), fullPage: true });
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Profile: default' }).click();
  await page.screenshot({ path: path.join(outputDir, `${name}-profile-menu.png`), fullPage: true });
  await page.getByRole('button', { name: '자막 설정' }).click();
  await page.getByTestId('subtitle-settings-overlay').waitFor();
  await page.screenshot({ path: path.join(outputDir, `${name}-subtitles.png`), fullPage: true });
  await page.getByTestId('subtitle-settings-overlay').getByRole('button', { name: '취소' }).click();

  const statsButton = page.locator('header').getByRole('button', { name: '통계' });
  if (!(await statsButton.isVisible())) {
    await page.locator('header').getByRole('button', { name: 'Toggle Menu' }).click();
  }
  await page.locator('header').getByRole('button', { name: '통계' }).click();
  await page.getByRole('heading', { name: '시청 통계' }).waitFor();
  await page.screenshot({ path: path.join(outputDir, `${name}-stats.png`), fullPage: true });

  const homeButton = page.locator('header').getByRole('button', { name: 'Home' });
  if (!(await homeButton.isVisible())) {
    await page.locator('header').getByRole('button', { name: 'Toggle Menu' }).click();
  }
  await page.locator('header').getByRole('button', { name: 'Home' }).click();
  await page.getByRole('button', { name: 'Details' }).first().click();
  await page.getByText('Episode One', { exact: true }).click();
  const player = page.getByTestId('openplex-player-container');
  await player.waitFor();
  await page.screenshot({ path: path.join(outputDir, `${name}-player.png`) });

  if (consoleErrors.length) findings.push(`${name}: console errors: ${consoleErrors.join(' | ')}`);
  await context.close();
}

await inspectViewport('desktop-1440x900', { width: 1440, height: 900 });
await inspectViewport('mobile-390x844', { width: 390, height: 844 });

const pickerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const pickerPage = await pickerContext.newPage();
await pickerPage.addInitScript(() => localStorage.removeItem('openplex.profileId'));
await pickerPage.goto('http://127.0.0.1:33888/', { waitUntil: 'networkidle' });
await pickerPage.getByTestId('profile-picker-overlay').waitFor();
await pickerPage.screenshot({ path: path.join(outputDir, 'desktop-profile-picker.png'), fullPage: true });
await pickerContext.close();

await browser.close();
console.log(JSON.stringify({ screenshots: fs.readdirSync(outputDir).sort(), findings }, null, 2));
if (findings.length) process.exitCode = 1;
