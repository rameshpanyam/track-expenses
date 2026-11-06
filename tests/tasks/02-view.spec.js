/**
 * Tasks — the tab itself: horizons, period navigation, the task modal,
 * statuses, blocked reason, move-forward, links, nudge, stats & settings.
 * Drives the real UI (clicks, typing) wherever practical.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { bootTasks, goToTasks, addTask, rowTitles, row, chip } = require('./helpers');

const thisWeek = (extra = {}) => ({ horizon: 'week', periodKey: '@week:0', ...extra });

/* ── layout ──────────────────────────────────────────────────────── */
test.describe('sections', () => {
  test.beforeEach(async ({ page }) => { await bootTasks(page); await goToTasks(page); });

  test('Tasks tab shows the four horizons, Weekly first and active', async ({ page }) => {
    const names = await page.locator('#tasks-horizon-bar .savings-pot-chip-name').allTextContents();
    expect(names).toEqual(['Weekly', 'Monthly', 'Yearly', 'Long-term']);
    await expect(chip(page, 'Weekly')).toHaveClass(/active/);
    await expect(page.locator('#header-month-label')).toContainText('Tasks');
  });

  test('empty state invites you to add a first task', async ({ page }) => {
    await expect(page.locator('#tasks-list .savings-empty')).toContainText('No weekly tasks for this week');
    await expect(page.locator('#tasks-hero .savings-hero-amount')).toHaveText('0 / 0 done');
  });

  test('period navigator exists for week/month/year but not Long-term', async ({ page }) => {
    for (const name of ['Weekly', 'Monthly', 'Yearly']) {
      await chip(page, name).click();
      await expect(page.locator('#tasks-period-nav')).toBeVisible();
    }
    await chip(page, 'Long-term').click();
    await expect(page.locator('#tasks-period-nav')).toBeHidden();
  });

  test('browsing to next week and back; adding there plans ahead', async ({ page }) => {
    await page.click('[data-action="period-next"]');
    await expect(page.locator('.tasks-nav-now')).toContainText('Next week');
    await addTask(page, { title: 'Plan ahead' });
    expect(await rowTitles(page)).toEqual(['Plan ahead']);
    await page.click('.tasks-nav-now');                       // jump to this week
    await expect(page.locator('.tasks-nav-now')).toContainText('This week');
    expect(await rowTitles(page)).toEqual([]);
  });
});

/* ── adding & completing ─────────────────────────────────────────── */
test.describe('tasks', () => {
  test.beforeEach(async ({ page }) => { await bootTasks(page); await goToTasks(page); });

  test('add to the active section; the other sections stay separate', async ({ page }) => {
    await addTask(page, { title: 'Weekly one' });
    await chip(page, 'Monthly').click();
    await addTask(page, { title: 'Monthly one' });
    expect(await rowTitles(page)).toEqual(['Monthly one']);
    await chip(page, 'Weekly').click();
    expect(await rowTitles(page)).toEqual(['Weekly one']);
  });

  test('the modal can add into any section regardless of the active chip', async ({ page }) => {
    await addTask(page, { title: 'Big dream', horizon: 'long' });
    await chip(page, 'Long-term').click();
    expect(await rowTitles(page)).toEqual(['Big dream']);
  });

  test('title is required', async ({ page }) => {
    await page.click('#view-tasks [data-action="add"]');
    await page.click('#tasks-form-modal >> text=Save');
    await expect(page.locator('#toast')).toContainText(/title/i);
    await expect(page.locator('#tasks-form-modal')).toBeVisible();
  });

  test('checkbox completes and un-completes; hero and chip counts follow', async ({ page }) => {
    await addTask(page, { title: 'A' });
    await addTask(page, { title: 'B' });
    await row(page, 'A').locator('.tasks-check').click();
    await expect(page.locator('#tasks-hero .savings-hero-amount')).toHaveText('1 / 2 done');
    await expect(chip(page, 'Weekly').locator('.savings-pot-chip-bal')).toHaveText('1/2');
    await expect(row(page, 'A')).toHaveClass(/st-completed/);
    await row(page, 'A').locator('.tasks-check').click();
    await expect(page.locator('#tasks-hero .savings-hero-amount')).toHaveText('0 / 2 done');
  });

  test('open tasks sort above completed ones', async ({ page }) => {
    await addTask(page, { title: 'First' });
    await addTask(page, { title: 'Second' });
    await row(page, 'First').locator('.tasks-check').click();
    expect(await rowTitles(page)).toEqual(['Second', 'First']);
  });

  test('edit title, then delete', async ({ page }) => {
    await addTask(page, { title: 'Old name' });
    await row(page, 'Old name').click();
    await page.fill('#tasks-form-title', 'New name');
    await page.click('#tasks-form-modal >> text=Save');
    expect(await rowTitles(page)).toEqual(['New name']);
    await row(page, 'New name').click();
    await page.click('#tasks-form-delete');
    expect(await rowTitles(page)).toEqual([]);
  });

  test('hero shows breakdown of in progress and blocked', async ({ page }) => {
    await addTask(page, { title: 'A', status: 'inprogress' });
    await addTask(page, { title: 'B', status: 'blocked', reason: 'waiting' });
    await expect(page.locator('.tasks-progress-label')).toContainText('1 in progress');
    await expect(page.locator('.tasks-progress-label')).toContainText('1 blocked');
  });
});

/* ── statuses ────────────────────────────────────────────────────── */
test.describe('statuses', () => {
  test.beforeEach(async ({ page }) => { await bootTasks(page, { tasks: [thisWeek({ title: 'Task' })] }); await goToTasks(page); });

  test('all six statuses are offered', async ({ page }) => {
    await row(page, 'Task').click();
    const labels = await page.locator('#tasks-form-status option').allTextContents();
    expect(labels).toEqual(['To do', 'Started', 'In progress', 'Completed', 'Blocked', 'Dropped']);
  });

  test('changing status shows a matching pill', async ({ page }) => {
    for (const [value, label] of [['started', 'Started'], ['inprogress', 'In progress'], ['completed', 'Completed'], ['dropped', 'Dropped']]) {
      await row(page, 'Task').click();
      await page.selectOption('#tasks-form-status', value);
      await page.click('#tasks-form-modal >> text=Save');
      await expect(row(page, 'Task').locator('.tasks-status')).toHaveText(label);
    }
  });

  test('Blocked reveals a required reason field, and shows the reason on the row', async ({ page }) => {
    await row(page, 'Task').click();
    await expect(page.locator('#tasks-form-reason-wrap')).toBeHidden();
    await page.selectOption('#tasks-form-status', 'blocked');
    await expect(page.locator('#tasks-form-reason-wrap')).toBeVisible();

    await page.click('#tasks-form-modal >> text=Save');            // no reason yet
    await expect(page.locator('#toast')).toContainText(/blocking/i);
    await expect(page.locator('#tasks-form-modal')).toBeVisible();

    await page.fill('#tasks-form-reason', 'Waiting on bank');
    await page.click('#tasks-form-modal >> text=Save');
    await expect(row(page, 'Task').locator('.tasks-blocked-reason')).toContainText('Waiting on bank');
  });

  test('leaving Blocked clears the reason', async ({ page }) => {
    await row(page, 'Task').click();
    await page.selectOption('#tasks-form-status', 'blocked');
    await page.fill('#tasks-form-reason', 'x');
    await page.click('#tasks-form-modal >> text=Save');
    await row(page, 'Task').click();
    await page.selectOption('#tasks-form-status', 'inprogress');
    await page.click('#tasks-form-modal >> text=Save');
    await expect(page.locator('.tasks-blocked-reason')).toHaveCount(0);
  });
});

/* ── moving between periods ──────────────────────────────────────── */
test.describe('move to next period', () => {
  test('moves the task, shows the carry count, and removes it from this week', async ({ page }) => {
    await bootTasks(page, { tasks: [thisWeek({ title: 'Stubborn' })] });
    await goToTasks(page);
    await row(page, 'Stubborn').click();
    await expect(page.locator('#tasks-form-move')).toHaveText(/Move to next week/);
    await page.click('#tasks-form-move');
    await expect(page.locator('#toast')).toContainText(/next week/i);
    expect(await rowTitles(page)).toEqual([]);

    await page.click('[data-action="period-next"]');
    await expect(row(page, 'Stubborn').locator('.tasks-carry-tag')).toContainText('1×');
  });

  test('this week\'s hero still shows the moved task as "moved on"', async ({ page }) => {
    await bootTasks(page, { tasks: [thisWeek({ title: 'Stubborn' }), thisWeek({ title: 'Easy', status: 'completed' })] });
    await goToTasks(page);
    await row(page, 'Stubborn').click();
    await page.click('#tasks-form-move');
    await expect(page.locator('#tasks-hero .savings-hero-amount')).toHaveText('1 / 2 done');
    await expect(page.locator('.tasks-progress-label')).toContainText('1 moved on');
  });

  test('the button says "month" in Monthly, and is absent for Long-term and finished tasks', async ({ page }) => {
    await bootTasks(page, { tasks: [
      { title: 'Open goal', horizon: 'month', periodKey: '@month:0' },
      { title: 'Dream', horizon: 'long' },
      { title: 'Finished goal', horizon: 'month', periodKey: '@month:0', status: 'completed' },
    ] });
    await goToTasks(page);
    await chip(page, 'Monthly').click();
    await row(page, 'Open goal').click();
    await expect(page.locator('#tasks-form-move')).toHaveText(/next month/);
    await page.click('#tasks-form-modal >> text=Cancel');
    await row(page, 'Finished goal').click();
    await expect(page.locator('#tasks-form-move')).toBeHidden();
    await page.click('#tasks-form-modal >> text=Cancel');
    await chip(page, 'Long-term').click();
    await row(page, 'Dream').click();
    await expect(page.locator('#tasks-form-move')).toBeHidden();
  });
});

/* ── nudge after repeated carry-overs ────────────────────────────── */
test.describe('carry-over nudge', () => {
  const carried = (n, status) => thisWeek({
    title: 'Procrastinated', status,
    carriedFrom: Array.from({ length: n }, (_, i) => `@week:${-(n - i)}`),
  });

  test('2 carries: no nudge. 3+: red tag and Do / Break down / Drop', async ({ page }) => {
    await bootTasks(page, { tasks: [carried(2)] });
    await goToTasks(page);
    await row(page, 'Procrastinated').click();
    await expect(page.locator('#tasks-form-nudge')).toBeHidden();
    await page.click('#tasks-form-modal >> text=Cancel');

    await page.evaluate(() => { tasksById('t0').carriedFrom.push('x'); renderTasks(); });
    await expect(row(page, 'Procrastinated').locator('.tasks-carry-tag')).toHaveClass(/hot/);
    await row(page, 'Procrastinated').click();
    await expect(page.locator('#tasks-form-nudge')).toBeVisible();
    await expect(page.locator('.tasks-nudge-btn')).toHaveText(['Do it', 'Break it down', 'Drop it']);
  });

  test('Drop it → dropped status; Do it → in progress', async ({ page }) => {
    await bootTasks(page, { tasks: [carried(3)] });
    await goToTasks(page);
    await row(page, 'Procrastinated').click();
    await page.click('.tasks-nudge-btn >> text=Do it');
    await expect(row(page, 'Procrastinated').locator('.tasks-status')).toHaveText('In progress');
    await row(page, 'Procrastinated').click();
    await page.click('.tasks-nudge-btn >> text=Drop it');
    await expect(row(page, 'Procrastinated').locator('.tasks-status')).toHaveText('Dropped');
  });

  test('Break it down on a weekly task opens an add form with a first-step title', async ({ page }) => {
    await bootTasks(page, { tasks: [carried(3)] });
    await goToTasks(page);
    await row(page, 'Procrastinated').click();
    await page.click('.tasks-nudge-btn >> text=Break it down');
    await expect(page.locator('#tasks-form-title-text')).toHaveText('Add Task');
    await expect(page.locator('#tasks-form-title')).toHaveValue('Procrastinated – first step');
  });

  test('Break it down on a monthly goal pre-links a new weekly task to it', async ({ page }) => {
    await bootTasks(page, { tasks: [{
      title: 'Big goal', horizon: 'month', periodKey: '@month:0', carriedFrom: ['@month:-3', '@month:-2', '@month:-1'],
    }] });
    await goToTasks(page);
    await chip(page, 'Monthly').click();
    await row(page, 'Big goal').click();
    await page.click('.tasks-nudge-btn >> text=Break it down');
    await expect(page.locator('#tasks-form-horizon')).toHaveValue('week');
    await expect(page.locator('#tasks-form-parent option:checked')).toHaveText('Big goal');
  });
});

/* ── links ───────────────────────────────────────────────────────── */
test.describe('linking tasks upward', () => {
  test('a weekly task links to a monthly goal; both rows show it', async ({ page }) => {
    await bootTasks(page, { tasks: [{ title: 'Get fit', horizon: 'month', periodKey: '@month:0' }] });
    await goToTasks(page);
    await addTask(page, { title: 'Gym Monday', parent: 'Get fit' });
    await expect(row(page, 'Gym Monday').locator('.tasks-link-tag')).toContainText('Get fit');

    await chip(page, 'Monthly').click();
    await expect(row(page, 'Get fit').locator('.tasks-link-tag')).toContainText('0/1 weekly');
    await page.evaluate(() => { const t = tasksState.tasks.find(x => x.title === 'Gym Monday'); tasksChangeStatus(t.id, 'completed'); renderTasks(); });
    await expect(row(page, 'Get fit').locator('.tasks-link-tag')).toContainText('1/1 weekly');
  });

  test('the parent picker is hidden when there is nothing to link to', async ({ page }) => {
    await bootTasks(page);
    await goToTasks(page);
    await page.click('#view-tasks [data-action="add"]');
    await expect(page.locator('#tasks-form-parent-wrap')).toBeHidden();      // weekly, but no monthly goals exist yet
    await page.selectOption('#tasks-form-horizon', 'year');
    await expect(page.locator('#tasks-form-parent-wrap')).toBeHidden();
    await page.selectOption('#tasks-form-horizon', 'long');
    await expect(page.locator('#tasks-form-parent-wrap')).toBeHidden();
  });
});

/* ── weekly cap ──────────────────────────────────────────────────── */
test('adding beyond the weekly cap warns you but still adds', async ({ page }) => {
  await bootTasks(page, {
    tasks: Array.from({ length: 3 }, (_, i) => thisWeek({ title: `t${i}` })),
    extra: { settings: { weeklyCap: 3 } },
  });
  await goToTasks(page);
  await addTask(page, { title: 'One too many' });
  await expect(page.locator('#toast')).toContainText(/more than 3/i);
  expect((await rowTitles(page)).length).toBe(4);
});

/* ── stats & settings ────────────────────────────────────────────── */
test.describe('stats modal', () => {
  test('shows streak and history; skipped planning is flagged', async ({ page }) => {
    await bootTasks(page, {
      tasks: [
        thisWeek({ title: 'now', status: 'completed' }),
        { title: 'last', horizon: 'week', periodKey: '@week:-1', status: 'completed' },
      ],
    });
    await page.evaluate(() => { tasksState.planning.skipped.push(`week:${tasksShiftPeriod('week', tasksCurrentPeriod('week'), -3)}`); });
    await goToTasks(page);
    await page.click('[data-action="stats"]');
    await expect(page.locator('#tasks-insights-streak')).toContainText('2-week streak');
    await expect(page.locator('.tasks-hist-row')).toHaveCount(8 + 6);
    await expect(page.locator('.tasks-skip-tag')).toHaveCount(1);
  });

  test('settings persist, clamp, and change the streak rule', async ({ page }) => {
    await bootTasks(page, { tasks: [{ title: 'p', horizon: 'week', periodKey: '@week:-1', status: 'completed' },
                                     { title: 'q', horizon: 'week', periodKey: '@week:-1' }] });   // 50%
    await goToTasks(page);
    await page.click('[data-action="stats"]');
    await expect(page.locator('#tasks-insights-streak')).toContainText('0-week streak');
    await page.fill('#tasks-setting-streakPct', '50');
    await page.locator('#tasks-setting-streakPct').blur();
    await expect(page.locator('#tasks-insights-streak')).toContainText('1-week streak');

    await page.fill('#tasks-setting-weeklyCap', '999');
    await page.locator('#tasks-setting-weeklyCap').blur();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('expense-tracker.tasks.v2')).settings);
    expect(saved).toEqual({ weeklyCap: 50, streakPct: 50 });   // 999 clamped to the max
  });
});

/* ── persistence ─────────────────────────────────────────────────── */
test('tasks are written to localStorage (v2 key) as they are added', async ({ page }) => {
  await bootTasks(page);
  await goToTasks(page);
  await addTask(page, { title: 'Persistent', status: 'started' });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('expense-tracker.tasks.v2')).tasks.map(t => [t.title, t.status]));
  expect(stored).toEqual([['Persistent', 'started']]);
});
