import { test, expect } from '@playwright/test';

test.describe('Browse Page Sort and Filter', () => {
  test('sorts items by popularity and filters by country including null country handling', async ({ page }) => {
    // Seed route for category drama with mock items having varying country, goodCount, and wrId
    await page.route('**/api/category/drama?page=1', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              category: 'drama',
              wrId: 101,
              episodeId: null,
              title: 'Alpha Drama (KR, Pop 10)',
              thumbUrl: null,
              country: '한국',
              rating: 8.5,
              description: 'Korean drama Alpha',
              goodCount: 10,
            },
            {
              category: 'drama',
              wrId: 102,
              episodeId: null,
              title: 'Beta Drama (US, Pop 50)',
              thumbUrl: null,
              country: '미국',
              rating: 9.0,
              description: 'US drama Beta',
              goodCount: 50,
            },
            {
              category: 'drama',
              wrId: 103,
              episodeId: null,
              title: 'Gamma Drama (Null Country, Pop 30)',
              thumbUrl: null,
              country: null,
              rating: 7.0,
              description: 'Unknown country Gamma',
              goodCount: 30,
            },
            {
              category: 'drama',
              wrId: 104,
              episodeId: null,
              title: 'Delta Drama (Empty Country, Pop 5)',
              thumbUrl: null,
              country: '',
              rating: 6.0,
              description: 'Empty country Delta',
              goodCount: 5,
            },
            {
              category: 'drama',
              wrId: 105,
              episodeId: null,
              title: 'Epsilon Drama (KR, Pop 100)',
              thumbUrl: null,
              country: 'KR',
              rating: 9.9,
              description: 'Korean drama Epsilon',
              goodCount: 100,
            },
          ],
          hasNext: false,
          page: 1,
        }),
      });
    });

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');

    // Navigate to Drama browse page
    await page.locator('header').getByRole('button', { name: 'Drama' }).click();
    await expect(page.getByText('OpenPlex Catalog')).toBeVisible();

    const cardWrappers = page.locator('[data-testid="media-card-wrapper"]');
    await expect(cardWrappers).toHaveCount(5);

    // 1. Verify default sort is "latest" (provider order preserved) and country is "all"
    // Expected order: 101, 102, 103, 104, 105
    await expect(cardWrappers.nth(0)).toHaveAttribute('data-item-id', '101');
    await expect(cardWrappers.nth(1)).toHaveAttribute('data-item-id', '102');
    await expect(cardWrappers.nth(2)).toHaveAttribute('data-item-id', '103');
    await expect(cardWrappers.nth(3)).toHaveAttribute('data-item-id', '104');
    await expect(cardWrappers.nth(4)).toHaveAttribute('data-item-id', '105');

    // 2. Switch to Popular Sort ('인기순')
    const sortPopularBtn = page.getByTestId('sort-popular');
    await sortPopularBtn.click();

    // In 'all' + 'popular' sort:
    // Sorted by goodCount descending: 105 (100) -> 102 (50) -> 103 (30) -> 101 (10) -> 104 (5)
    await expect(cardWrappers).toHaveCount(5);
    await expect(cardWrappers.nth(0)).toHaveAttribute('data-item-id', '105');
    await expect(cardWrappers.nth(1)).toHaveAttribute('data-item-id', '102');
    await expect(cardWrappers.nth(2)).toHaveAttribute('data-item-id', '103');
    await expect(cardWrappers.nth(3)).toHaveAttribute('data-item-id', '101');
    await expect(cardWrappers.nth(4)).toHaveAttribute('data-item-id', '104');

    // 3. Filter by Korea ('한국') while still sorted by popular
    const filterKoreaBtn = page.getByTestId('filter-country-korea');
    await filterKoreaBtn.click();

    // Korean items: 105 (100) -> 101 (10)
    await expect(cardWrappers).toHaveCount(2);
    await expect(cardWrappers.nth(0)).toHaveAttribute('data-item-id', '105');
    await expect(cardWrappers.nth(1)).toHaveAttribute('data-item-id', '101');

    // 4. Filter by Overseas ('해외') while still sorted by popular
    const filterOverseasBtn = page.getByTestId('filter-country-overseas');
    await filterOverseasBtn.click();

    // Overseas items: 102 (50) - null/empty country items excluded from overseas
    await expect(cardWrappers).toHaveCount(1);
    await expect(cardWrappers.nth(0)).toHaveAttribute('data-item-id', '102');

    // 5. Filter back to All ('전체')
    const filterAllBtn = page.getByTestId('filter-country-all');
    await filterAllBtn.click();

    // All items should reappear (5 total, including null and empty country), ordered by popularity
    await expect(cardWrappers).toHaveCount(5);
    await expect(cardWrappers.nth(0)).toHaveAttribute('data-item-id', '105');
    await expect(cardWrappers.nth(1)).toHaveAttribute('data-item-id', '102');
    await expect(cardWrappers.nth(2)).toHaveAttribute('data-item-id', '103');
    await expect(cardWrappers.nth(3)).toHaveAttribute('data-item-id', '101');
    await expect(cardWrappers.nth(4)).toHaveAttribute('data-item-id', '104');

    // 6. Switch back to Latest Sort ('최신순')
    const sortLatestBtn = page.getByTestId('sort-latest');
    await sortLatestBtn.click();

    // Original provider order restored
    await expect(cardWrappers.nth(0)).toHaveAttribute('data-item-id', '101');
    await expect(cardWrappers.nth(1)).toHaveAttribute('data-item-id', '102');
    await expect(cardWrappers.nth(2)).toHaveAttribute('data-item-id', '103');
    await expect(cardWrappers.nth(3)).toHaveAttribute('data-item-id', '104');
    await expect(cardWrappers.nth(4)).toHaveAttribute('data-item-id', '105');
  });

  test('preserves sorting when infinite scroll appends more items', async ({ page }) => {
    await page.route('**/api/category/movie*', async (route) => {
      const url = new URL(route.request().url());
      const pageParam = url.searchParams.get('page') || '1';

      if (pageParam === '1') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [
              {
                category: 'movie',
                wrId: 201,
                episodeId: null,
                title: 'Movie A (Pop 10)',
                thumbUrl: null,
                country: '한국',
                rating: 8.0,
                description: 'Movie A',
                goodCount: 10,
              },
              {
                category: 'movie',
                wrId: 202,
                episodeId: null,
                title: 'Movie B (Pop 80)',
                thumbUrl: null,
                country: '한국',
                rating: 9.0,
                description: 'Movie B',
                goodCount: 80,
              },
            ],
            hasNext: true,
            page: 1,
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [
              {
                category: 'movie',
                wrId: 203,
                episodeId: null,
                title: 'Movie C (Pop 200)',
                thumbUrl: null,
                country: '한국',
                rating: 9.5,
                description: 'Movie C',
                goodCount: 200,
              },
            ],
            hasNext: false,
            page: 2,
          }),
        });
      }
    });

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');

    await page.locator('header').getByRole('button', { name: 'Movie' }).click();
    await expect(page.getByText('OpenPlex Catalog')).toBeVisible();

    // Wait for the initial page items to be loaded
    const cardWrappers = page.locator('[data-testid="media-card-wrapper"]');
    await expect(cardWrappers.first()).toBeVisible();

    // Switch to popular sort
    await page.getByTestId('sort-popular').click();

    // Simulate scroll or load more by triggering intersection if available, or dispatching scroll
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // Wait for the next page to append (total 3 items)
    await expect(cardWrappers).toHaveCount(3);

    // After appending Movie C (pop 200), since sort is 'popular', items should be ordered 203 (200) -> 202 (80) -> 201 (10)
    await expect(cardWrappers.nth(0)).toHaveAttribute('data-item-id', '203');
    await expect(cardWrappers.nth(1)).toHaveAttribute('data-item-id', '202');
    await expect(cardWrappers.nth(2)).toHaveAttribute('data-item-id', '201');
  });
});
