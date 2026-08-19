import { expect, test } from '@playwright/test';

test('persists profile subtitle settings and applies cue variables on the player root', async ({ page, request }) => {
  const profileName = `Subtitle-${Date.now().toString(36)}`;
  const createdResponse = await request.post('/api/profiles', {
    data: { name: profileName, color: '#06b6d4' },
  });
  expect(createdResponse.ok()).toBeTruthy();
  const { profile } = await createdResponse.json() as { profile: { id: number } };

  await page.addInitScript((profileId: number) => {
    window.localStorage.setItem('openplex.profileId', String(profileId));
  }, profile.id);

  const profilesLoaded = page.waitForResponse((response) =>
    response.url().includes('/api/profiles') && response.request().method() === 'GET',
  );
  await page.goto('/');
  await profilesLoaded;

  await page.getByRole('button', { name: `Profile: ${profileName}` }).click();
  await page.getByRole('button', { name: '자막 설정' }).click();

  const panel = page.getByTestId('subtitle-settings-overlay');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Chromium에서 완전 지원')).toBeVisible();

  await panel.getByRole('slider', { name: '자막 크기' }).fill('150');
  await panel.getByRole('button', { name: '노란색' }).click();
  await panel.getByRole('slider', { name: '배경 불투명도' }).fill('40');
  await panel.getByRole('button', { name: '외곽선' }).click();

  const saveResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith(`/api/profiles/${profile.id}/subtitle-style`)
      && response.request().method() === 'PUT',
  );
  await panel.getByRole('button', { name: '저장' }).click();
  expect((await saveResponsePromise).ok()).toBeTruthy();
  await expect(panel).not.toBeVisible();

  const detailsButton = page.getByRole('button', { name: 'Details' }).first();
  await detailsButton.click();
  const episode = page.getByText('Episode One', { exact: true });
  const streamResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().includes('/api/stream/'),
  );
  await episode.click();
  expect((await streamResponsePromise).ok()).toBeTruthy();

  const player = page.getByTestId('openplex-player-container');
  await expect(player).toBeVisible();
  await expect.poll(() => player.evaluate((element) => ({
    color: element.style.getPropertyValue('--sub-color'),
    background: element.style.getPropertyValue('--sub-bg'),
    edge: element.style.getPropertyValue('--sub-edge'),
  }))).toEqual({
    color: '#ff0',
    background: 'rgba(0, 0, 0, 0.4)',
    edge: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000',
  });

  const cueRuleExists = await page.evaluate(() =>
    Array.from(document.styleSheets).some((sheet) =>
      Array.from(sheet.cssRules).some((rule) =>
        rule.cssText.includes('video::cue')
          && rule.cssText.includes('var(--sub-color')
          && rule.cssText.includes('var(--sub-bg')
          && rule.cssText.includes('var(--sub-edge'),
      ),
    ),
  );
  expect(cueRuleExists).toBe(true);

  await page.reload();
  await page.getByRole('button', { name: `Profile: ${profileName}` }).click();
  await page.getByRole('button', { name: '자막 설정' }).click();
  await expect(panel.getByRole('slider', { name: '자막 크기' })).toHaveValue('150');
  await expect(panel.getByRole('button', { name: '노란색' })).toHaveAttribute('aria-pressed', 'true');
});
