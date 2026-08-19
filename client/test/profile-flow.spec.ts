import { expect, test, type Page } from '@playwright/test';

interface Profile {
  id: number;
  name: string;
}

interface HistoryItem {
  id: number;
  epIdx: number;
  position_sec: number;
}

const titleId = 74001;

async function createProfileFromPicker(page: Page, name: string): Promise<Profile> {
  const picker = page.getByTestId('profile-picker-overlay');
  await picker.getByRole('button', { name: 'Add Profile' }).click();
  await picker.getByPlaceholder('이름을 입력하세요').fill(name);

  const createdResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/profiles')
      && response.request().method() === 'POST',
  );
  await picker.getByRole('button', { name: '완료' }).click();
  const response = await createdResponse;
  expect(response.status()).toBe(201);
  const { profile } = await response.json() as { profile: Profile };
  return profile;
}

async function switchProfile(page: Page, fromName: string, toName: string): Promise<void> {
  await page.getByRole('button', { name: `Profile: ${fromName}` }).click();
  const homeResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/home')
      && response.request().method() === 'GET'
      && response.request().headers()['x-profile-id'] !== undefined,
  );
  await page.getByRole('button', { name: toName }).click();
  expect((await homeResponse).ok()).toBe(true);
  await expect(page.getByRole('button', { name: `Profile: ${toName}` })).toBeVisible();
}

test('keeps playback, next up, stats, and subtitle appearance isolated per profile', async ({ page, request }) => {
  test.setTimeout(60_000);
  const suffix = Date.now().toString(36);
  const profileAName = `Profile A ${suffix}`;
  const profileBName = `Profile B ${suffix}`;

  await page.addInitScript(() => window.localStorage.removeItem('openplex.profileId'));
  const profilesLoaded = page.waitForResponse((response) =>
    response.url().endsWith('/api/profiles') && response.request().method() === 'GET',
  );
  await page.goto('/');
  expect((await profilesLoaded).ok()).toBe(true);

  const picker = page.getByTestId('profile-picker-overlay');
  await expect(picker).toBeVisible();
  const profileAHome = page.waitForResponse((response) =>
    response.url().endsWith('/api/home')
      && response.request().headers()['x-profile-id'] !== undefined,
  );
  const profileA = await createProfileFromPicker(page, profileAName);
  expect((await profileAHome).ok()).toBe(true);
  await expect(picker).not.toBeVisible();
  await expect(page.getByRole('button', { name: `Profile: ${profileAName}` })).toBeVisible();

  const profilesReloaded = page.waitForResponse((response) =>
    response.url().endsWith('/api/profiles') && response.request().method() === 'GET',
  );
  await page.getByRole('button', { name: `Profile: ${profileAName}` }).click();
  await page.getByRole('button', { name: '프로필 관리' }).click();
  expect((await profilesReloaded).ok()).toBe(true);
  await expect(picker).toBeVisible();
  const profileB = await createProfileFromPicker(page, profileBName);
  await expect(picker.getByText(profileBName, { exact: true })).toBeVisible();
  await picker.getByRole('button', { name: 'Close' }).click();
  await expect(picker).not.toBeVisible();

  // Opening details passively catalogs both fixture episodes, which makes Next Up
  // derivable from SQLite after episode one is watched.
  const titleResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/api/title/drama/${titleId}`),
  );
  await page.getByRole('button', { name: 'Details' }).first().click();
  expect((await titleResponse).ok()).toBe(true);
  await expect(page.getByText('Episodes (2)')).toBeVisible();

  const streamResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/api/stream/drama/${titleId}/1`)
      && response.request().method() === 'POST',
  );
  await page.getByText('Episode One', { exact: true }).click();
  expect((await streamResponse).ok()).toBe(true);

  const player = page.getByTestId('openplex-player-container');
  const video = player.locator('video');
  await expect(player).toBeVisible();

  // Subscribe before dispatching pause: no polling or fixed delay is used to
  // observe the history write.
  const historyResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/history')
      && response.request().method() === 'POST'
      && response.request().headers()['x-profile-id'] === String(profileA.id),
  );
  await video.evaluate((element) => {
    const media = element as HTMLVideoElement;
    Object.defineProperty(media, 'currentTime', { configurable: true, value: 48 });
    Object.defineProperty(media, 'duration', { configurable: true, value: 120 });
    media.dispatchEvent(new Event('timeupdate'));
    media.dispatchEvent(new Event('durationchange'));
    media.dispatchEvent(new Event('pause'));
  });
  expect((await historyResponse).ok()).toBe(true);
  await player.getByRole('button', { name: 'Close' }).click();

  const historyAResponse = await request.get('/api/history', {
    headers: { 'X-Profile-Id': String(profileA.id) },
  });
  expect(historyAResponse.ok()).toBe(true);
  const historyA = await historyAResponse.json() as { items: HistoryItem[] };
  expect(historyA.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: titleId, epIdx: 1, position_sec: 48 }),
  ]));

  const profileListReloaded = page.waitForResponse((response) =>
    response.url().endsWith('/api/profiles') && response.request().method() === 'GET',
  );
  await page.getByRole('button', { name: `Profile: ${profileAName}` }).click();
  await page.getByRole('button', { name: '프로필 관리' }).click();
  expect((await profileListReloaded).ok()).toBe(true);
  const profileBHome = page.waitForResponse((response) =>
    response.url().endsWith('/api/home')
      && response.request().headers()['x-profile-id'] === String(profileB.id),
  );
  await picker.getByRole('button', { name: `Select profile ${profileBName}` }).click();
  expect((await profileBHome).ok()).toBe(true);
  await expect(page.getByRole('button', { name: `Profile: ${profileBName}` })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Continue Watching' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '이어서 보세요' })).toHaveCount(0);

  const historyBResponse = await request.get('/api/history', {
    headers: { 'X-Profile-Id': String(profileB.id) },
  });
  expect(historyBResponse.ok()).toBe(true);
  expect(await historyBResponse.json()).toEqual({ items: [] });

  const statsBResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/api/profiles/${profileB.id}/stats`)
      && response.request().method() === 'GET',
  );
  await page.locator('header').getByRole('button', { name: '통계' }).click();
  expect((await statsBResponse).ok()).toBe(true);
  await expect(page.getByRole('heading', { name: '시청 통계' })).toBeVisible();
  await expect(page.getByText('아직 시청 기록이 없습니다')).toBeVisible();
  await expect(page.getByText('0분', { exact: true }).first()).toBeVisible();

  // Profile B gets a distinct subtitle style; Profile A must retain defaults.
  await page.getByRole('button', { name: `Profile: ${profileBName}` }).click();
  await page.getByRole('button', { name: '자막 설정' }).click();
  const subtitlePanel = page.getByTestId('subtitle-settings-overlay');
  await subtitlePanel.getByRole('slider', { name: '자막 크기' }).fill('150');
  await subtitlePanel.getByRole('button', { name: '노란색' }).click();
  const subtitleSaved = page.waitForResponse((response) =>
    response.url().endsWith(`/api/profiles/${profileB.id}/subtitle-style`)
      && response.request().method() === 'PUT',
  );
  await subtitlePanel.getByRole('button', { name: '저장' }).click();
  expect((await subtitleSaved).ok()).toBe(true);

  const persistedBStyle = await request.get(`/api/profiles/${profileB.id}/subtitle-style`, {
    headers: { 'X-Profile-Id': String(profileB.id) },
  });
  expect(await persistedBStyle.json()).toMatchObject({
    style: { fontScale: 150, color: 'yellow' },
  });

  const profileBHomeReloaded = page.waitForResponse((response) =>
    response.url().endsWith('/api/home')
      && response.request().headers()['x-profile-id'] === String(profileB.id),
  );
  await page.locator('header').getByRole('button', { name: 'Home' }).click();
  expect((await profileBHomeReloaded).ok()).toBe(true);

  const profileBTitle = page.waitForResponse((response) =>
    response.url().endsWith(`/api/title/drama/${titleId}`),
  );
  await page.getByRole('button', { name: 'Details' }).first().click();
  expect((await profileBTitle).ok()).toBe(true);
  const profileBStream = page.waitForResponse((response) =>
    response.url().endsWith(`/api/stream/drama/${titleId}/1`)
      && response.request().headers()['x-profile-id'] === String(profileB.id),
  );
  await page.getByText('Episode One', { exact: true }).click();
  expect((await profileBStream).ok()).toBe(true);
  await expect(player).toHaveCSS('--sub-color', '#ff0');
  await expect(player).toHaveCSS('--sub-scale', '150%');
  await player.getByRole('button', { name: 'Close' }).click();

  await switchProfile(page, profileBName, profileAName);
  await expect(page.getByRole('heading', { name: 'Continue Watching' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '이어서 보세요' })).toBeVisible();
  await expect(page.getByText('Fixture Drama - Episode One', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fixture Drama 2화 재생' })).toBeVisible();

  const statsAResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/api/profiles/${profileA.id}/stats`)
      && response.request().method() === 'GET',
  );
  await page.locator('header').getByRole('button', { name: '통계' }).click();
  expect((await statsAResponse).ok()).toBe(true);
  await expect(page.getByRole('heading', { name: '시청 통계' })).toBeVisible();
  await expect(page.getByText('Fixture Drama - Episode One', { exact: true })).toBeVisible();
  await expect(page.getByText('1', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: `Profile: ${profileAName}` }).click();
  await page.getByRole('button', { name: '자막 설정' }).click();
  await expect(subtitlePanel.getByRole('slider', { name: '자막 크기' })).toHaveValue('100');
  await expect(subtitlePanel.getByRole('button', { name: '흰색' })).toHaveAttribute('aria-pressed', 'true');

  // State dump used by the Todo 11 evidence writer after the full regression.
  await test.info().attach('profile-flow-state.json', {
    body: Buffer.from(JSON.stringify({
      profileA: { id: profileA.id, history: historyA.items },
      profileB: { id: profileB.id, history: [] },
      subtitleProfileB: { fontScale: 150, color: 'yellow' },
      subtitleProfileA: { fontScale: 100, color: 'white' },
    }, null, 2)),
    contentType: 'application/json',
  });
});
