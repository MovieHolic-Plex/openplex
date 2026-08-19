import { expect, test } from '@playwright/test';

const titleId = 74001;

test('queues an episode download, lists it, and plays the local bundle', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Details' }).first().click();
  await expect(page.getByText('Episode Two', { exact: true })).toBeVisible();

  const enqueue = page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().endsWith('/api/downloads'),
  );
  await page.getByRole('button', { name: 'Episode Two 다운로드' }).click();
  expect((await enqueue).ok()).toBe(true);
  await expect(page.getByRole('button', { name: 'Episode Two 다운로드' })).toContainText(/대기|받는 중|저장됨|다시 받기/);

  await expect.poll(async () => {
    const list = await request.get('/api/downloads');
    const body = await list.json() as {
      items: Array<{ epIdx: number; download_status: string }>;
    };
    return body.items.find((item) => item.epIdx === 2)?.download_status ?? '';
  }, { timeout: 15_000 }).toBe('completed');

  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Synopsis' })).not.toBeVisible();
  await page.getByRole('button', { name: 'Downloads' }).click();
  const dialog = page.getByRole('dialog', { name: '받은 영상' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('저장됨')).toBeVisible();

  const local = await request.post(`/api/stream/drama/${titleId}/2`);
  const localBody = await local.json() as { source?: string; playlistUrl: string };
  expect(local.ok()).toBe(true);
  expect(localBody.source).toBe('local');
  expect(localBody.playlistUrl).toBe(`/media/drama/${titleId}/2/playlist.m3u8`);

  const playlist = await request.get(localBody.playlistUrl);
  expect(playlist.ok()).toBe(true);
  expect(await playlist.text()).toContain('segments/seg00000.ts');
  expect((await request.get(`/media/drama/${titleId}/2/segments/seg00000.ts`)).ok()).toBe(true);
});
