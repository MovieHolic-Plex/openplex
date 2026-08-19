import { test, expect } from '@playwright/test';

test.describe('OpenPlex Player Component & Playback Controls', () => {
  test('launches player from details modal, renders custom controls, toggles settings/subtitles, handles keyboard shortcuts, and reports history', async ({ page }) => {
    // Intercept history update API call
    let historyReported = false;
    let reportedPayload: Record<string, unknown> | null = null;
    await page.route('**/api/history', async (route) => {
      if (route.request().method() === 'POST') {
        historyReported = true;
        try {
          reportedPayload = JSON.parse(route.request().postData() || '{}');
        } catch {
          // ignore
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      } else {
        await route.continue();
      }
    });

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');

    // 1. Launch player by clicking "Details" -> "Play Ep 1"
    const detailsBtn = page.getByRole('button', { name: 'Details' }).first();
    await detailsBtn.click();
    const episode = page.getByText('Episode One', { exact: true });
    await expect(episode).toBeVisible();
    const streamResponse = page.waitForResponse((response) =>
      response.request().method() === 'POST' && response.url().includes('/api/stream/'),
    );
    await episode.click();
    const stream = await streamResponse;
    expect(stream.ok(), await stream.text()).toBe(true);

    // Verify Player component is visible
    const playerContainer = page.getByTestId('openplex-player-container');
    await expect(playerContainer).toBeVisible();

    const video = playerContainer.locator('video');
    await expect(video).toBeVisible();

    // 2. Play / Pause toggle
    const togglePlayBtn = playerContainer.locator('button[aria-label="Play"], button[aria-label="Pause"]').first();
    await expect(togglePlayBtn).toBeVisible();
    await togglePlayBtn.click();

    // 3. Subtitles Menu & Track Attachment
    const subBtn = playerContainer.getByRole('button', { name: 'Subtitles' });
    await expect(subBtn).toBeVisible();
    await subBtn.click();
    const subMenu = playerContainer.getByTestId('subtitles-menu');
    await expect(subMenu).toBeVisible();

    // Select a subtitle or Off
    const offBtn = subMenu.getByRole('button', { name: 'Off' });
    await expect(offBtn).toBeVisible();
    await offBtn.click();
    await expect(subMenu).not.toBeVisible();

    // Verify <track> tags in DOM inside <video>
    const tracks = playerContainer.locator('video track');
    expect(await tracks.count()).toBeGreaterThanOrEqual(1);

    // 4. Settings & Speed Selector
    const settingsBtn = playerContainer.getByRole('button', { name: 'Settings' });
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();
    const settingsMenu = playerContainer.getByTestId('settings-menu');
    await expect(settingsMenu).toBeVisible();
    await expect(settingsMenu.getByText('Playback Speed')).toBeVisible();

    // Click 1.5x speed
    const speed15Btn = settingsMenu.getByRole('button', { name: '1.5x' });
    await expect(speed15Btn).toBeVisible();
    await speed15Btn.click();
    await expect(settingsMenu).not.toBeVisible();

    // 5. Global Keyboard Shortcuts
    // Space for play/pause
    await page.keyboard.press('Space');
    // ArrowRight for seek forward (+5s)
    await page.keyboard.press('ArrowRight');
    // ArrowLeft for seek backward (-5s)
    await page.keyboard.press('ArrowLeft');
    // ArrowUp for volume (+10%)
    await page.keyboard.press('ArrowUp');
    // ArrowDown for volume (-10%)
    await page.keyboard.press('ArrowDown');
    // 'M' for mute toggle
    await page.keyboard.press('KeyM');

    // 6. Test History Reporting when paused or on close
    await video.evaluate((element) => {
      const media = element as HTMLVideoElement;
      Object.defineProperty(media, 'currentTime', { configurable: true, value: 25 });
      Object.defineProperty(media, 'duration', { configurable: true, value: 120 });
      media.dispatchEvent(new Event('pause'));
    });

    // Close player with ESC
    await page.keyboard.press('Escape');
    await expect(video).not.toBeVisible();

    // Verify history API was called
    expect(historyReported).toBe(true);
    expect(reportedPayload).not.toBeNull();
  });
});

