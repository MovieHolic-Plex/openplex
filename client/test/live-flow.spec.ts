import { expect, test } from '@playwright/test';

const titleId = 74001;

test('runs the production home, search, detail, stream, HLS, and history flow', async ({ page, request }) => {
  const homeResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/home') && response.request().method() === 'GET',
  );
  await page.goto('/');
  expect((await homeResponse).ok()).toBe(true);
  await expect(page.getByRole('heading', { level: 1, name: 'Fixture Drama', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Trending K-Drama' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Continue Watching' })).toBeVisible();

  await page.locator('header').getByRole('button', { name: 'Search' }).click();
  const searchInput = page.getByPlaceholder(/search titles/i);
  const searchResponse = page.waitForResponse((response) =>
    response.url().includes('/api/search?q=Fixture') && response.request().method() === 'GET',
  );
  await searchInput.fill('Fixture');
  expect((await searchResponse).ok()).toBe(true);
  const searchResult = page.locator('h4').filter({ hasText: 'Fixture Drama' });
  await expect(searchResult).toBeVisible();

  const detailResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/api/title/drama/${titleId}`),
  );
  await searchResult.click();
  expect((await detailResponse).ok()).toBe(true);
  await expect(page.getByText('Episodes (2)')).toBeVisible();
  await expect(page.getByText('Episode One', { exact: true })).toBeVisible();

  const streamRequest = page.waitForRequest((request) =>
    request.method() === 'POST' && request.url().endsWith(`/api/stream/drama/${titleId}/1`),
  );
  const streamResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().endsWith(`/api/stream/drama/${titleId}/1`),
  );
  await page.getByText('Episode One', { exact: true }).click();
  await streamRequest;
  const stream = await streamResponse;
  const streamBody = await stream.json() as {
    sessionId: string;
    playlistUrl: string;
    source?: 'live' | 'local';
    error?: { message: string; code: string };
  };
  expect(stream.ok(), JSON.stringify(streamBody)).toBe(true);
  if (streamBody.source === 'local') {
    expect(streamBody.playlistUrl).toBe(`/media/drama/${titleId}/1/playlist.m3u8`);
  } else {
    expect(streamBody.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(streamBody.playlistUrl).toContain(`/hls/${streamBody.sessionId}/playlist.m3u8`);
  }

  const player = page.getByTestId('openplex-player-container');
  await expect(player).toBeVisible();
  const video = player.locator('video');
  await expect(video).toHaveAttribute('data-hls-attached', /^(true|native)$/);
  await expect(video.locator('track')).toHaveCount(1);

  const playlist = await request.get(streamBody.playlistUrl);
  expect(playlist.ok()).toBe(true);
  if (streamBody.source !== 'local') {
    expect(await playlist.text()).toContain('/hls/');
  } else {
    expect(await playlist.text()).toContain('segments/seg00000.ts');
  }

  const historyResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().endsWith('/api/history'),
  );
  await video.evaluate((element) => {
    const media = element as HTMLVideoElement;
    Object.defineProperty(media, 'currentTime', { configurable: true, value: 18 });
    Object.defineProperty(media, 'duration', { configurable: true, value: 120 });
    media.dispatchEvent(new Event('timeupdate'));
    media.dispatchEvent(new Event('durationchange'));
    media.dispatchEvent(new Event('pause'));
  });
  expect((await historyResponse).ok()).toBe(true);

  await player.getByRole('button', { name: 'Close' }).click();
  await page.reload();
  const shelf = page.getByRole('heading', { name: 'Continue Watching' }).locator('xpath=ancestor::section');
  await expect(shelf).toContainText('Fixture Drama - Episode One');
  const history = await request.get('/api/history');
  const historyBody = await history.json() as { items: Array<{ id: number; position_sec: number }> };
  expect(historyBody.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: titleId, position_sec: 18 }),
  ]));
});

test('serves SPA fallback while preserving API 404 envelopes', async ({ page, request }) => {
  await page.goto('/library/fixture-drama');
  await expect(page.locator('header').getByText('OPENPLEX')).toBeVisible();

  const missingApi = await request.get('/api/not-a-route');
  expect(missingApi.status()).toBe(404);
  expect(await missingApi.json()).toEqual({
    error: { code: 'NOT_FOUND', message: 'Route not found' },
  });
});
