import { expect, test } from '@playwright/test';

test('정렬 칩이 서버 쿼리를 바꾸고 카드가 한글 종류를 표시한다', async ({ page }) => {
  await page.route(/\/api\/libraries(\?|$)/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [{ id: 3, name: '미디어 보관함', kind: 'video_series' }] }),
    });
  });
  await page.route(/\/api\/library(\?|$)/, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          {
            id: 21,
            kind: 'video_series',
            title: '테스트시리즈',
            overview: null,
            poster: null,
            backdrop: null,
          },
        ],
      }),
    });
  });

  await page.goto('/');
  await page.locator('header').getByRole('button', { name: '보관함' }).click();
  await expect(page.getByRole('heading', { name: '내 라이브러리' })).toBeVisible();

  for (const label of ['보관함', '종류', '정렬']) {
    await expect(page.getByRole('group', { name: label })).toBeVisible();
  }

  const sorts = page.getByRole('group', { name: '정렬' });
  await expect(sorts.getByRole('button')).toHaveCount(4);
  for (const name of ['최신', '추가순', '제목', '연도']) {
    await expect(sorts.getByRole('button', { name, exact: true })).toBeVisible();
  }

  const card = page.getByRole('button', { name: /테스트시리즈/ });
  await expect(card).toBeVisible();
  await expect(card.getByText('시리즈', { exact: true })).toBeVisible();
  expect(await page.getByText('VIDEO_SERIES').count()).toBe(0);

  await expect(card.locator('svg')).toBeVisible();

  const sortRequest = page.waitForRequest(
    (req) => req.url().includes('/api/library') && req.url().includes('sort=title'),
    { timeout: 5000 },
  );
  await sorts.getByRole('button', { name: '제목', exact: true }).click();
  const req = await sortRequest;
  expect(req.url()).toContain('sort=title');
});

test('보관함 lists works, opens work detail, and shows the agent drawer', async ({ page }) => {
  await page.route(/\/api\/library(\?|$)/, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [{
          id: 7,
          kind: 'comic',
          title: '테스트만화',
          overview: null,
          poster: '/p.jpg',
          backdrop: null,
        }],
      }),
    });
  });
  await page.route('**/api/library/7', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        work: {
          id: 7,
          kind: 'comic',
          title: '테스트만화',
          overview: null,
          poster: null,
          backdrop: null,
        },
        units: [{
          id: 11,
          work_id: 7,
          kind: 'chapter',
          ordinal: 0,
          title: '1화',
          thumb: null,
        }],
      }),
    });
  });
  await page.route('**/api/agent/turn', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        reply: '테스트만화를 이어 보세요.',
        tools: [{
          name: 'recommend_next',
          arguments: {},
          result: [{ work: { id: 7, title: '테스트만화' }, unitId: 11, score: 1 }],
        }],
      }),
    });
  });

  await page.goto('/');
  await page.locator('header').getByRole('button', { name: '보관함' }).click();
  await expect(page.getByRole('heading', { name: '내 라이브러리' })).toBeVisible();
  await expect(page.getByRole('button', { name: /테스트만화/ })).toBeVisible();
  await expect(page.locator('img[src*="p.jpg"]')).toBeVisible();
  await page.getByRole('button', { name: /테스트만화/ }).click();
  await expect(page.getByRole('dialog', { name: '테스트만화' })).toBeVisible();
  await expect(page.getByRole('button', { name: '읽기' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: '에이전트' }).click();
  await expect(page.getByRole('dialog', { name: '에이전트' })).toBeVisible();
  await page.getByRole('button', { name: '묻기' }).click();
  await expect(page.getByText('테스트만화를 이어 보세요.')).toBeVisible();
  await expect(page.getByRole('button', { name: '받기' })).toBeVisible();
});
