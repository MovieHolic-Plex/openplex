import { test, expect } from '@playwright/test';

test.describe('OpenPlex Web UI Shell & Pages', () => {
  test('renders desktop shell with navigation, hero carousel, shelves, search and detail modal', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');

    // 1. Verify Header and Logo
    await expect(page.locator('header')).toBeVisible();
    await expect(page.locator('header').getByText('OPENPLEX')).toBeVisible();
    await expect(page.locator('header').getByRole('button', { name: 'Home' })).toBeVisible();
    await expect(page.locator('header').getByRole('button', { name: 'Drama' })).toBeVisible();
    await expect(page.locator('header').getByRole('button', { name: 'Movie' })).toBeVisible();
    await expect(page.locator('header').getByRole('button', { name: 'Animation' })).toBeVisible();
    await expect(page.locator('header').getByRole('button', { name: 'My List' })).toBeVisible();

    // 2. Verify Hero Banner & Backdrop
    await expect(page.getByRole('button', { name: 'Watch Now' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Details' })).toBeVisible();

    // 3. Verify Shelves
    await expect(page.getByText('Continue Watching')).toBeVisible();
    await expect(page.getByText('Trending K-Drama')).toBeVisible();
    await expect(page.getByText('Popular Movies')).toBeVisible();
    await expect(page.getByText('Top Animation')).toBeVisible();

    // 4. Test Search Modal Overlay & Debounced Input
    const searchBtn = page.locator('header').getByRole('button', { name: /search/i });
    await searchBtn.click();
    const searchInput = page.getByPlaceholder(/search titles/i);
    await expect(searchInput).toBeVisible();
    const desktopSearch = page.waitForResponse((response) => response.url().includes('/api/search?q=Squid'));
    await searchInput.fill('Squid');
    await desktopSearch;
    await expect(page.locator('h4').filter({ hasText: 'Squid Game: The Challenge Season 2' })).toBeVisible();

    // Close search modal with ESC key
    await page.keyboard.press('Escape');
    await expect(searchInput).not.toBeVisible();

    // 5. Test Title Detail Modal with Synopsis, Badges, and Episode Cards
    const detailsBtn = page.getByRole('button', { name: 'Details' }).first();
    await detailsBtn.click();
    await expect(page.getByRole('heading', { name: 'Synopsis' })).toBeVisible();
    await expect(page.getByText(/Episodes \(/)).toBeVisible();
    await expect(page.getByText('Play Ep 1')).toBeVisible();
    await expect(page.getByText('Add to List')).toBeVisible();

    // Close detail modal
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Synopsis' })).not.toBeVisible();

    // 6. Test Category Browse Page Navigation
    await page.locator('header').getByRole('button', { name: 'Drama' }).click();
    await expect(page.getByText('OpenPlex Catalog')).toBeVisible();
    await expect(page.getByText('한국 드라마 (K-Drama)')).toBeVisible();

    // 7. Test My List Page
    await page.locator('header').getByRole('button', { name: 'My List' }).click();
    await expect(page.getByText('Saved Collection')).toBeVisible();
    await expect(page.locator('main').getByText('My List', { exact: true })).toBeVisible();
  });

  test('renders mobile viewport responsively (390x844)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    // 1. Verify Brand and Mobile Toggle
    await expect(page.locator('header').getByText('OPENPLEX')).toBeVisible();
    const menuToggle = page.getByRole('button', { name: 'Toggle Menu' });
    await expect(menuToggle).toBeVisible();

    // 2. Open Mobile Navigation Drawer
    await menuToggle.click();
    await expect(page.locator('header').getByRole('button', { name: 'Drama' })).toBeVisible();
    await expect(page.locator('header').getByRole('button', { name: 'Movie' })).toBeVisible();

    // 3. Navigate to Movie via mobile drawer
    await page.locator('header').getByRole('button', { name: 'Movie' }).click();
    await expect(page.getByText('영화 (Movie)')).toBeVisible();

    // 4. Test Search modal on mobile
    const searchBtn = page.locator('header').getByRole('button', { name: /search/i }).first();
    await searchBtn.click();
    const searchInput = page.getByPlaceholder(/search titles/i);
    await expect(searchInput).toBeVisible();
    const mobileSearch = page.waitForResponse((response) => response.url().includes('/api/search?q=Cyberpunk'));
    await searchInput.fill('Cyberpunk');
    await mobileSearch;
    await expect(page.locator('h4').filter({ hasText: 'Cyberpunk Neo: Shinjuku 2099' })).toBeVisible();
  });
});
