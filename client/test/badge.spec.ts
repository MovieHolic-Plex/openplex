import { test, expect } from '@playwright/test';

test.describe('Poster Cards Badge, Progress Bar, and Unwatched Count Chip', () => {
  test('renders watched circular badge, progress bar, and unwatched chip correctly across profiles', async ({
    page,
    request,
  }) => {
    // Ensure profile 2 exists in store so backend allows x-profile-id: 2
    await request.post('/api/profiles', {
      data: { name: `ProfileTwo-${Date.now().toString(36)}`, color: '#10b981' },
    });

    // Intercept category drama to return items with different watch states
    await page.route('**/api/category/drama?page=1', async (route) => {
      const headers = route.request().headers();
      const profileId = headers['x-profile-id'] || '1';

      if (profileId === '2') {
        // Profile B: Item 201 is unwatched (0%), Item 202 is watched (>=90%), Item 203 series has no progress
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [
              {
                category: 'drama',
                wrId: 201,
                episodeId: null,
                title: 'Drama 201 (Unwatched on Profile B)',
                thumbUrl: null,
                country: '한국',
                rating: 9.0,
                description: 'Drama 201 description',
                goodCount: 50,
                watchState: {
                  watched: false,
                  progress: 0,
                  unwatchedCount: 16,
                },
              },
              {
                category: 'drama',
                wrId: 202,
                episodeId: null,
                title: 'Drama 202 (Watched on Profile B)',
                thumbUrl: null,
                country: '한국',
                rating: 8.5,
                description: 'Drama 202 description',
                goodCount: 30,
                watchState: {
                  watched: true,
                  progress: 0.95,
                  unwatchedCount: 0,
                },
              },
            ],
            hasNext: false,
            page: 1,
          }),
        });
      } else {
        // Profile A (or default 1):
        // Item 201: In progress (40%), unwatchedCount = 8 -> shows 8화 남음 chip + 40% progress bar
        // Item 202: Watched (100%), watched = true -> shows circular check badge, NO progress bar
        // Item 203: Movie (movie category), progress = 0.5, unwatchedCount = 0 -> shows 50% bar, NO unwatched chip (movie)
        // Item 204: Series, unwatchedCount = null (not yet enriched) -> NO unwatched chip, NO badge, NO progress
        // Item 205: Malformed progress (NaN / Infinity) -> safe, no progress bar, no crash
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [
              {
                category: 'drama',
                wrId: 201,
                episodeId: null,
                title: 'Drama 201 (40% Progress, 8 Remaining)',
                thumbUrl: null,
                country: '한국',
                rating: 9.0,
                description: 'Drama 201 description',
                goodCount: 50,
                watchState: {
                  watched: false,
                  progress: 0.4,
                  unwatchedCount: 8,
                },
              },
              {
                category: 'drama',
                wrId: 202,
                episodeId: null,
                title: 'Drama 202 (Watched 100%)',
                thumbUrl: null,
                country: '한국',
                rating: 8.5,
                description: 'Drama 202 description',
                goodCount: 30,
                watchState: {
                  watched: true,
                  progress: 1.0,
                  unwatchedCount: 0,
                },
              },
              {
                category: 'movie',
                wrId: 203,
                episodeId: null,
                title: 'Movie 203 (50% Progress)',
                thumbUrl: null,
                country: '미국',
                rating: 7.5,
                description: 'Movie 203 description',
                goodCount: 20,
                watchState: {
                  watched: false,
                  progress: 0.5,
                  unwatchedCount: 0,
                },
              },
              {
                category: 'drama',
                wrId: 204,
                episodeId: null,
                title: 'Drama 204 (Unenriched Catalog null)',
                thumbUrl: null,
                country: '한국',
                rating: 8.0,
                description: 'Drama 204 description',
                goodCount: 10,
                watchState: {
                  watched: false,
                  progress: 0,
                  unwatchedCount: null,
                },
              },
              {
                category: 'drama',
                wrId: 205,
                episodeId: null,
                title: 'Drama 205 (Malformed Stale Progress)',
                thumbUrl: null,
                country: '한국',
                rating: 8.0,
                description: 'Drama 205 description',
                goodCount: 10,
                watchState: {
                  watched: false,
                  progress: 'invalid' as unknown as number,
                  unwatchedCount: null,
                },
              },
            ],
            hasNext: false,
            page: 1,
          }),
        });
      }
    });

    // Test on desktop viewport
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.addInitScript(() => {
      window.localStorage.setItem('openplex.profileId', '1');
    });
    await page.goto('/');

    // Navigate to Drama browse page
    await page.locator('header').getByRole('button', { name: 'Drama' }).click();
    await expect(page.getByText('OpenPlex Catalog')).toBeVisible();

    const cardWrappers = page.locator('[data-testid="media-card-wrapper"]');
    await expect(cardWrappers).toHaveCount(5);

    // --- Profile A checks ---
    // Item 201: 40% progress bar + "8화 남음" chip + NO watched badge
    const card201 = cardWrappers.nth(0);
    await expect(card201.getByTestId('unwatched-chip')).toBeVisible();
    await expect(card201.getByTestId('unwatched-chip')).toHaveText('8화 남음');
    await expect(card201.getByTestId('watched-badge')).not.toBeVisible();
    await expect(card201.getByTestId('progress-bar')).toBeVisible();
    await expect(card201.getByTestId('progress-bar')).toHaveCSS('width', /^[0-9]+(\.[0-9]+)?px|40%/); // has amber width

    // Item 202: Watched badge present + NO progress bar + NO unwatched chip (unwatchedCount = 0)
    const card202 = cardWrappers.nth(1);
    await expect(card202.getByTestId('watched-badge')).toBeVisible();
    await expect(card202.getByTestId('progress-bar')).not.toBeVisible();
    await expect(card202.getByTestId('unwatched-chip')).not.toBeVisible();

    // Item 203: Movie with 50% progress -> progress bar visible, NO unwatched chip because mediaType is movie
    const card203 = cardWrappers.nth(2);
    await expect(card203.getByTestId('progress-bar')).toBeVisible();
    await expect(card203.getByTestId('unwatched-chip')).not.toBeVisible();
    await expect(card203.getByTestId('watched-badge')).not.toBeVisible();

    // Item 204: Catalog unenriched (unwatchedCount is null) -> omit chip entirely (no misleading zero)
    const card204 = cardWrappers.nth(3);
    await expect(card204.getByTestId('unwatched-chip')).not.toBeVisible();
    await expect(card204.getByTestId('watched-badge')).not.toBeVisible();
    await expect(card204.getByTestId('progress-bar')).not.toBeVisible();

    // Item 205: Malformed progress -> no crash, no progress bar
    const card205 = cardWrappers.nth(4);
    await expect(card205.getByTestId('unwatched-chip')).not.toBeVisible();
    await expect(card205.getByTestId('watched-badge')).not.toBeVisible();
    await expect(card205.getByTestId('progress-bar')).not.toBeVisible();

    // --- Profile B switch checks (switch profile via localStorage) ---
    await page.evaluate(() => {
      window.localStorage.setItem('openplex.profileId', '2');
    });
    // Switch tab to Movie and then back to Drama, or reload to trigger Profile B fetch with x-profile-id: 2
    const dramaResponsePromise = page.waitForResponse((r) => r.url().includes('/api/category/drama'));
    await page.locator('header').getByRole('button', { name: 'Movie' }).click();
    await page.locator('header').getByRole('button', { name: 'Drama' }).click();
    await dramaResponsePromise;
    await expect(page.getByText('OpenPlex Catalog')).toBeVisible();

    const profileBCards = page.locator('[data-testid="media-card-wrapper"]');
    await expect(profileBCards).toHaveCount(2);

    // Profile B: Item 201 is unwatched (0%), unwatchedCount = 16 -> shows 16화 남음, NO progress bar, NO watched badge
    const cardB201 = profileBCards.nth(0);
    await expect(cardB201.getByTestId('unwatched-chip')).toBeVisible();
    await expect(cardB201.getByTestId('unwatched-chip')).toHaveText('16화 남음');
    await expect(cardB201.getByTestId('watched-badge')).not.toBeVisible();
    await expect(cardB201.getByTestId('progress-bar')).not.toBeVisible();

    // Profile B: Item 202 is watched (watched: true) -> watched badge visible, NO progress bar
    const cardB202 = profileBCards.nth(1);
    await expect(cardB202.getByTestId('watched-badge')).toBeVisible();
    await expect(cardB202.getByTestId('progress-bar')).not.toBeVisible();
  });

  test('maintains layout responsiveness on mobile viewport (390x844)', async ({ page }) => {
    await page.route('**/api/category/drama?page=1', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              category: 'drama',
              wrId: 301,
              episodeId: null,
              title: 'Mobile Test Drama',
              thumbUrl: null,
              country: '한국',
              rating: 9.0,
              description: 'Mobile description',
              goodCount: 50,
              watchState: {
                watched: false,
                progress: 0.6,
                unwatchedCount: 3,
              },
            },
          ],
          hasNext: false,
          page: 1,
        }),
      });
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      window.localStorage.setItem('openplex.profileId', '1');
    });
    await page.goto('/');

    const menuToggle = page.getByRole('button', { name: 'Toggle Menu' });
    await menuToggle.click();
    await page.locator('header').getByRole('button', { name: 'Drama' }).click();

    await expect(page.getByText('OpenPlex Catalog')).toBeVisible();
    const cardWrapper = page.locator('[data-testid="media-card-wrapper"]').first();
    await expect(cardWrapper.getByTestId('unwatched-chip')).toHaveText('3화 남음');
    await expect(cardWrapper.getByTestId('progress-bar')).toBeVisible();
  });
});
