import { expect, test } from '@playwright/test';

const SETTINGS_GET = (response: import('@playwright/test').Response) =>
  response.url().endsWith('/api/settings') && response.request().method() === 'GET';

test('server settings modal toggles visibility, saves paths, and hides entries for visitors', async ({ page }) => {
  await page.route('**/api/settings', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          visibility: 'private',
          libraries: [
            { id: 1, name: 'Drama', kind: 'video_series', path: null },
            { id: 2, name: 'Movies', kind: 'movie', path: 'C:\\Media\\Movies' },
          ],
          originHint: 'http://127.0.0.1:33888',
          bindUnchanged: true,
          visitor: false,
        }),
      });
      return;
    }
    if (method === 'PUT') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          visibility: 'public',
          libraries: [
            { id: 1, name: 'Drama', kind: 'video_series', path: 'D:\\Media\\Drama' },
            { id: 2, name: 'Movies', kind: 'movie', path: 'C:\\Media\\Movies' },
          ],
          originHint: 'http://127.0.0.1:33888',
          bindUnchanged: true,
          visitor: false,
        }),
      });
      return;
    }
    await route.continue();
  });

  const settingsLoaded = page.waitForResponse(SETTINGS_GET);
  await page.goto('/');
  await settingsLoaded;

  await page.getByRole('button', { name: 'Profile: default' }).click();
  await page.getByRole('menu').getByRole('button', { name: '서버 설정' }).click();

  const panel = page.getByTestId('server-settings-overlay');
  await expect(panel).toBeVisible();

  // Origin is shown from window.location.origin.
  await expect(panel.getByTestId('server-settings-origin')).toHaveText('http://127.0.0.1:33888');

  // Toggle visibility -> PUT /api/settings.
  const putVisibility = page.waitForResponse(
    (response) => response.url().endsWith('/api/settings') && response.request().method() === 'PUT',
  );
  await panel.getByRole('switch', { name: '이 URL로 들어온 사람에게 보관함 공개' }).click();
  expect((await putVisibility).ok()).toBeTruthy();
  await expect(panel.getByRole('switch', { name: '이 URL로 들어온 사람에게 보관함 공개' })).toHaveAttribute('aria-checked', 'true');

  // Path save -> PUT /api/settings.
  await panel.getByLabel('Drama').fill('D:\\Media\\Drama');
  const putPaths = page.waitForResponse(
    (response) => response.url().endsWith('/api/settings') && response.request().method() === 'PUT',
  );
  await panel.getByRole('button', { name: '저장', exact: true }).click();
  expect((await putPaths).ok()).toBeTruthy();

  // Visitor mode: settings.visitor=true -> no server settings entry.
  await page.unroute('**/api/settings');
  await page.route('**/api/settings', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          visibility: 'public',
          libraries: [
            { id: 1, name: 'Drama', kind: 'video_series', path: null },
            { id: 2, name: 'Movies', kind: 'movie', path: 'C:\\Media\\Movies' },
          ],
          originHint: 'http://127.0.0.1:33888',
          bindUnchanged: true,
          visitor: true,
        }),
      });
      return;
    }
    await route.continue();
  });

  await panel.getByRole('button', { name: '닫기' }).click();
  const visitorLoaded = page.waitForResponse(SETTINGS_GET);
  await page.reload();
  await visitorLoaded;

  // Profile switcher stays hidden for visitors, so the dropdown cannot be
  // opened at all; assert the entry is absent from the document entirely
  // (both the top-level header button and the dropdown entry).
  await expect(page.getByRole('button', { name: '서버 설정' })).toHaveCount(0);
});

test('owner with no profiles still reaches server settings from the header', async ({ page }) => {
  await page.route('**/api/settings', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        visibility: 'private',
        libraries: [],
        originHint: 'http://127.0.0.1:33888',
        bindUnchanged: true,
        visitor: false,
      }),
    });
  });
  // No profiles at all -> currentProfile stays null and the profile
  // dropdown never renders. The ProfilePicker gate overlays the page, so
  // create a profile to dismiss it; currentProfile stays null because the
  // boot pass already ran against the empty list.
  await page.route('**/api/profiles', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) });
      return;
    }
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 1, name: 'default', avatar_color: '#e5a00d' }),
      });
      return;
    }
    await route.continue();
  });

  const settingsLoaded = page.waitForResponse(SETTINGS_GET);
  await page.goto('/');
  await settingsLoaded;

  // The mandatory first-profile gate is up; dismiss it by creating a profile.
  const profilesCreated = page.waitForResponse(
    (response) => response.url().endsWith('/api/profiles') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Add Profile' }).click();
  await page.getByPlaceholder('이름을 입력하세요').fill('default');
  await page.getByRole('button', { name: '완료' }).click();
  await profilesCreated;

  await expect(page.getByRole('button', { name: '서버 설정' })).toBeVisible();

  await page.screenshot({
    path: '.omo/evidence/openplex-library-ux-meta/task-6-owner-nullprofile.png',
    fullPage: true,
  });
});

const providersBody = (kmdbConfigured: boolean, metadataProviders?: string[]) => JSON.stringify({
  visibility: 'private',
  libraries: [{ id: 1, name: 'Drama', kind: 'video_series', path: null }],
  originHint: 'http://127.0.0.1:33888',
  bindUnchanged: true,
  visitor: false,
  ...(metadataProviders ? { metadataProviders } : {}),
  kmdbConfigured,
});

async function openSettingsModal(page: import('@playwright/test').Page) {
  // The first-profile gate overlay blocks interaction when /api/profiles is
  // empty; serve one profile so the header is reachable. Registered last, so
  // it takes precedence over per-test profiles routes.
  await page.route('**/api/profiles', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [{ id: 1, name: 'default', avatar_color: '#e5a00d', subtitle_style: null, created_at: null }],
        }),
      });
      return;
    }
    await route.continue();
  });
  await page.route('**/api/profiles/*/subtitle-style', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ style: null }) });
  });
  const settingsLoaded = page.waitForResponse(SETTINGS_GET);
  await page.goto('/');
  await settingsLoaded;
  await page.getByRole('button', { name: '서버 설정' }).first().click();
  const panel = page.getByTestId('server-settings-overlay');
  await expect(panel).toBeVisible();
  return panel;
}

test('metadata provider section renders five checkboxes and the fixed sentence', async ({ page }) => {
  await page.route('**/api/settings', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: providersBody(true, ['tmdb', 'kmdb', 'daum', 'naver', 'watcha']),
    });
  });
  await page.route('**/api/profiles', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) });
      return;
    }
    await route.continue();
  });

  const panel = await openSettingsModal(page);

  await expect(panel.getByText('메타데이터 소스')).toBeVisible();
  await expect(
    panel.getByText('한국 사이트는 제목·연도·장르·줄거리·포스터만 가지고 오며, 재생 소스로 쓰지 않습니다.'),
  ).toBeVisible();

  for (const label of ['TMDB', 'KMDb', '다음', '네이버', '왓챠']) {
    await expect(panel.getByRole('checkbox', { name: label, exact: true })).toBeVisible();
  }
  await expect(panel.getByRole('checkbox')).toHaveCount(5);
});

test('kmdb helper text appears only when key missing and kmdb enabled', async ({ page }) => {
  // kmdbConfigured=false + kmdb in saved list -> helper text visible.
  await page.route('**/api/settings', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: providersBody(false, ['tmdb', 'kmdb', 'daum']),
    });
  });
  await page.route('**/api/profiles', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) });
      return;
    }
    await route.continue();
  });

  let panel = await openSettingsModal(page);
  await expect(panel.getByTestId('kmdb-helper-text')).toBeVisible();
  await expect(panel.getByTestId('kmdb-helper-text')).toHaveText('KMDB_API_KEY 미설정 — 이 소스는 건너뜁니다');
  await panel.getByRole('button', { name: '닫기' }).click();

  // kmdbConfigured=false + kmdb NOT in saved list -> no helper text.
  await page.route('**/api/settings', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: providersBody(false, ['tmdb', 'daum']),
    });
  });
  panel = await openSettingsModal(page);
  await expect(panel.getByTestId('kmdb-helper-text')).toHaveCount(0);
  await expect(panel.getByRole('checkbox', { name: 'KMDb' })).not.toBeChecked();
  await panel.getByRole('button', { name: '닫기' }).click();

  // kmdbConfigured=true + kmdb in saved list -> no helper text.
  await page.route('**/api/settings', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: providersBody(true, ['tmdb', 'kmdb']),
    });
  });
  panel = await openSettingsModal(page);
  await expect(panel.getByTestId('kmdb-helper-text')).toHaveCount(0);
});

test('unchecking 다음 sends PUT without daum and state survives refetch', async ({ page }) => {
  let currentProviders = ['tmdb', 'kmdb', 'daum', 'naver', 'watcha'];
  await page.route('**/api/settings', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({ contentType: 'application/json', body: providersBody(true, currentProviders) });
      return;
    }
    if (method === 'PUT') {
      const body = route.request().postDataJSON() as { metadataProviders?: string[] };
      if (Array.isArray(body.metadataProviders)) currentProviders = body.metadataProviders;
      await route.fulfill({ contentType: 'application/json', body: providersBody(true, currentProviders) });
      return;
    }
    await route.continue();
  });
  await page.route('**/api/profiles', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) });
      return;
    }
    await route.continue();
  });

  let panel = await openSettingsModal(page);
  await expect(panel.getByRole('checkbox', { name: '다음', exact: true })).toBeChecked();

  const putDaum = page.waitForResponse(
    (response) => response.url().endsWith('/api/settings') && response.request().method() === 'PUT',
  );
  await panel.getByRole('checkbox', { name: '다음', exact: true }).click();
  const putResponse = await putDaum;
  expect(putResponse.ok()).toBeTruthy();
  const putBody = putResponse.request().postDataJSON() as Record<string, unknown>;
  expect(JSON.stringify(putBody.metadataProviders ?? [])).not.toContain('daum');
  expect(putBody).not.toHaveProperty('kmdbConfigured');

  await expect(panel.getByRole('checkbox', { name: '다음', exact: true })).not.toBeChecked();

  // Close and reopen -> refetch keeps the saved state.
  await panel.getByRole('button', { name: '닫기' }).click();
  panel = await openSettingsModal(page);
  await expect(panel.getByRole('checkbox', { name: '다음', exact: true })).not.toBeChecked();
  await expect(panel.getByRole('checkbox', { name: 'TMDB', exact: true })).toBeChecked();
});

test('GET missing metadataProviders field does not crash the modal', async ({ page }) => {
  await page.route('**/api/settings', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        visibility: 'private',
        libraries: [],
        originHint: 'http://127.0.0.1:33888',
        bindUnchanged: true,
        visitor: false,
      }),
    });
  });
  await page.route('**/api/profiles', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) });
      return;
    }
    await route.continue();
  });

  const panel = await openSettingsModal(page);
  await expect(panel.getByRole('checkbox')).toHaveCount(5);
  await expect(panel.getByTestId('kmdb-helper-text')).toHaveCount(0);
});
