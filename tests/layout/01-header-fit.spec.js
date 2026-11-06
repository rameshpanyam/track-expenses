/**
 * Layout — the header must fit the phone on every tab.
 * Regression: title + month block + 5 action buttons used to need 410-433px,
 * so pages scrolled sideways, "Sign out" was clipped, and fixed modals
 * (sized to the widened page) spilled off-screen.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { bootTasks } = require('../tasks/helpers');

const TABS = ['add', 'dashboard', 'loans', 'savings', 'tasks'];

for (const width of [360, 390, 430]) {
  test.describe(`${width}px wide phone`, () => {
    test.use({ viewport: { width, height: 800 } });

    for (const tab of TABS) {
      test(`${tab}: page is no wider than the screen and Sign out is fully visible`, async ({ page }) => {
        await bootTasks(page);
        await page.click(`#nav-${tab}`);
        const m = await page.evaluate(() => ({
          viewport: document.documentElement.clientWidth,
          scroll:   document.documentElement.scrollWidth,
          signOutRight: document.querySelector('.signout-btn').getBoundingClientRect().right,
        }));
        expect(m.scroll).toBeLessThanOrEqual(m.viewport);
        expect(m.signOutRight).toBeLessThanOrEqual(m.viewport);
      });
    }

    test('modals are laid out inside the screen (Add Task modal fits)', async ({ page }) => {
      await bootTasks(page);
      await page.click('#nav-tasks');
      await page.click('#view-tasks [data-action="add"]');
      const box = await page.locator('#tasks-form-modal .confirm-box').boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    });
  });
}

test('the month navigation stays reachable on the dashboard', async ({ page }) => {
  await bootTasks(page);
  await page.click('#nav-dashboard');
  await expect(page.locator('#month-prev')).toBeVisible();
  await expect(page.locator('#month-next')).toBeVisible();
  await expect(page.locator('#header-month-label')).toContainText(/\d{4}/);
});

test('hidden month arrows take no space on label-only tabs', async ({ page }) => {
  await bootTasks(page);
  await page.click('#nav-tasks');
  await expect(page.locator('#month-prev')).toBeHidden();
  await expect(page.locator('#header-month-label')).toContainText('Tasks');
});
