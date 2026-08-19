import { expect, test } from '@playwright/test';

// Visitor mode: settings report visitor=true (public, tokenless access).
// The client must skip the URL ingest form and the downloads filter while
// still rendering the library catalog.
test('visitor mode hides URL 가져오기 form and 받은 영상 filter', async ({ page }) => {
  await page.route('**/api/settings', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        visitor: true,
        visibility: 'public',
        libraries: [],
        originHint: null,
        bindUnchanged: true,
      }),
    });
  });
  await page.route('**/api/library**', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [{
          id: 9,
          kind: 'movie',
          title: '공개영화',
          overview: null,
          poster: '/pub.jpg',
          backdrop: null,
        }],
      }),
    });
  });
  await page.route('**/api/libraries**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) });
  });

  await page.goto('/');
  // Visitor boot lands directly on the library tab.
  await expect(page.getByRole('heading', { name: '내 라이브러리' })).toBeVisible();
  await expect(page.locator('img[src*="pub.jpg"]')).toBeVisible();

  // Owner-only chrome must stay hidden for visitors.
  await expect(page.getByRole('button', { name: 'URL 가져오기' })).toHaveCount(0);
  await expect(page.getByText('받은 영상')).toHaveCount(0);
});

test('visitor header shows only the library tab and hides owner chrome', async ({ page }) => {
  await page.route('**/api/settings', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        visitor: true,
        visibility: 'public',
        libraries: [],
        originHint: null,
        bindUnchanged: true,
      }),
    });
  });
  await page.route('**/api/library**', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [{
          id: 9,
          kind: 'movie',
          title: '공개영화',
          overview: null,
          poster: '/pub.jpg',
          backdrop: null,
        }],
      }),
    });
  });
  await page.route('**/api/libraries**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: '내 라이브러리' })).toBeVisible();

  const headerNav = page.getByRole('banner').getByRole('navigation', { name: '주요 메뉴' });
  // Hidden tabs: rendered nowhere in the header, not disabled.
  for (const label of ['홈', '드라마', '영화', '내 목록', '통계']) {
    await expect(headerNav.getByRole('button', { name: label, exact: true })).toHaveCount(0);
  }
  // Library remains reachable.
  await expect(headerNav.getByRole('button', { name: '보관함', exact: true })).toBeVisible();
  // Search / agent / downloads hidden.
  await expect(page.getByRole('button', { name: '검색' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '에이전트' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '다운로드' })).toHaveCount(0);
  // Profile switcher must not be exposed to visitors.
  await expect(page.locator('button[aria-label^="Profile:"]')).toHaveCount(0);

  // Mobile drawer: same rules.
  await page.setViewportSize({ width: 375, height: 720 });
  await page.getByRole('button', { name: '메뉴 열기' }).click();
  const drawer = page.locator('header').last();
  for (const label of ['홈', '드라마', '영화', '내 목록', '통계']) {
    await expect(drawer.getByRole('button', { name: label, exact: true })).toHaveCount(0);
  }
  await expect(drawer.getByRole('button', { name: '에이전트' })).toHaveCount(0);
  await expect(drawer.getByText('받은 영상')).toHaveCount(0);
  await expect(drawer.getByRole('button', { name: '보관함', exact: true })).toBeVisible();
});

test('malformed /api/settings payload (no visitor field) does not crash boot', async ({ page }) => {
  await page.route('**/api/settings', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ visibility: 'private', libraries: [] }),
    });
  });
  await page.goto('/');
  // The app still renders its shell: the header nav exists.
  await expect(page.getByRole('button', { name: '보관함', exact: true })).toBeVisible();
});

test('screenshot evidence: visitor header (task-6)', async ({ page }) => {
  await page.route('**/api/settings', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        visitor: true,
        visibility: 'public',
        libraries: [],
        originHint: null,
        bindUnchanged: true,
      }),
    });
  });
  await page.route('**/api/library**', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [{
          id: 9,
          kind: 'movie',
          title: '공개영화',
          overview: null,
          poster: '/pub.jpg',
          backdrop: null,
        }],
      }),
    });
  });
  await page.route('**/api/libraries**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: '내 라이브러리' })).toBeVisible();
  await page.screenshot({
    path: '.omo/evidence/openplex-library-ux-meta/task-6-visitor.png',
    fullPage: true,
  });
});
