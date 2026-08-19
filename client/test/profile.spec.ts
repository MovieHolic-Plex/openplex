import { test, expect } from '@playwright/test';

test.describe('Profile Picker and Switcher UI', () => {
  test('first visit shows profile picker gate, creates profile, switches and sends X-Profile-Id header', async ({
    page,
    request,
  }) => {
    // 1. Seed unique profiles for this test via REST
    const suffix = Date.now().toString(36);
    const profileName1 = `User-${suffix}-1`;
    const profileName2 = `User-${suffix}-2`;

    const res1 = await request.post('/api/profiles', {
      data: { name: profileName1, color: '#3b82f6' },
    });
    expect(res1.ok()).toBeTruthy();
    const { profile: created1 } = await res1.json();

    const res2 = await request.post('/api/profiles', {
      data: { name: profileName2, color: '#10b981' },
    });
    expect(res2.ok()).toBeTruthy();
    const { profile: created2 } = await res2.json();

    // 2. Set viewport & ensure localStorage has NO profileId (first visit)
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.addInitScript(() => {
      window.localStorage.removeItem('openplex.profileId');
    });

    // Wait for profiles response on load
    const profilesResponsePromise = page.waitForResponse((r) => r.url().includes('/api/profiles') && r.status() === 200);
    await page.goto('/');
    await profilesResponsePromise;

    // 3. Verify ProfilePicker gate overlay is visible
    const overlay = page.locator('[data-testid="profile-picker-overlay"]');
    await expect(overlay).toBeVisible();
    await expect(overlay.getByText('누가 시청 중인가요?')).toBeVisible();
    await expect(overlay.getByText(profileName1)).toBeVisible();
    await expect(overlay.getByText(profileName2)).toBeVisible();

    // Select profileName2 to verify direct profile selection from grid
    const selectP2Promise = page.waitForResponse((r) => r.url().includes('/api/home'));
    await overlay.locator(`[data-testid="profile-card-${created2.id}"] button`).click();
    await selectP2Promise;
    await expect(overlay).not.toBeVisible();

    // Clear profile from localStorage and reload to test create flow
    await page.evaluate(() => window.localStorage.removeItem('openplex.profileId'));
    const reloadProfilesPromise = page.waitForResponse((r) => r.url().includes('/api/profiles') && r.status() === 200);
    await page.reload();
    await reloadProfilesPromise;
    await expect(overlay).toBeVisible();

    // 4. Test profile creation via UI inside picker
    const addProfileBtn = overlay.getByRole('button', { name: 'Add Profile' });
    await addProfileBtn.click();
    await expect(overlay.getByText('프로필 만들기')).toBeVisible();

    // Fill form
    const newProfileName = `New-${suffix}`;
    const nameInput = overlay.getByPlaceholder('이름을 입력하세요');
    await nameInput.fill(newProfileName);

    // Track creation API response
    const createResponsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/profiles') && r.request().method() === 'POST',
    );
    const homeLoadPromise = page.waitForResponse((r) => r.url().includes('/api/home'));

    // Submit form (since first-visit gate canClose=false, submitting will select newly created profile)
    await overlay.getByRole('button', { name: '완료' }).click();
    const createRes = await createResponsePromise;
    expect(createRes.status()).toBe(201);
    const { profile: createdNew } = await createRes.json();
    await homeLoadPromise;

    // 5. Verify gate overlay dismissed and header displays active profile name
    await expect(overlay).not.toBeVisible();
    const headerProfileBtn = page.locator('header').getByRole('button', { name: `Profile: ${newProfileName}` });
    await expect(headerProfileBtn).toBeVisible();
    await expect(headerProfileBtn.getByText(newProfileName)).toBeVisible();

    // Verify localStorage has persisted profileId
    const storedId = await page.evaluate(() => window.localStorage.getItem('openplex.profileId'));
    expect(storedId).toBe(String(createdNew.id));

    // 6. Test Profile Switcher dropdown and assert X-Profile-Id header is sent
    const recordedHeaders: Record<string, string>[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/home')) {
        recordedHeaders.push(req.headers());
      }
    });

    // Open dropdown
    await headerProfileBtn.click();
    await expect(page.getByText('현재 프로필')).toBeVisible();
    await expect(page.getByText('프로필 관리')).toBeVisible();
    await expect(page.getByText('자막 설정')).toBeVisible();

    // Switch to profileName1
    const switchHomePromise = page.waitForResponse((r) => r.url().includes('/api/home'));
    await page.getByRole('button', { name: profileName1 }).click();
    await switchHomePromise;

    // Header should now show profileName1
    const updatedHeaderBtn = page.locator('header').getByRole('button', { name: `Profile: ${profileName1}` });
    await expect(updatedHeaderBtn).toBeVisible();

    // Verify stored profileId is updated
    const updatedStoredId = await page.evaluate(() => window.localStorage.getItem('openplex.profileId'));
    expect(updatedStoredId).toBe(String(created1.id));

    // Verify header was injected on fetch
    const lastHomeHeaders = recordedHeaders[recordedHeaders.length - 1];
    expect(lastHomeHeaders).toBeDefined();
    expect(lastHomeHeaders?.['x-profile-id']).toBe(String(created1.id));

    // 7. Test "프로필 관리" opens picker overlay in edit mode
    await updatedHeaderBtn.click();
    const manageProfilesBtn = page.getByRole('button', { name: '프로필 관리' });
    await manageProfilesBtn.click();

    await expect(overlay).toBeVisible();
    await expect(overlay.getByText('누가 시청 중인가요?')).toBeVisible();

    // Toggle edit mode
    const editToggleBtn = overlay.getByRole('button', { name: '프로필 관리' });
    await editToggleBtn.click();
    await expect(overlay.getByText('수정하거나 삭제할 프로필을 선택하세요.')).toBeVisible();

    // Close button should be present since canClose=true
    const closeBtn = overlay.getByRole('button', { name: 'Close' });
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();
    await expect(overlay).not.toBeVisible();
  });
});
