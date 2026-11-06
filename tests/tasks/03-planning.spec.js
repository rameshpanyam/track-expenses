/**
 * Tasks — the planning prompt: first-open overlay, review of the previous
 * period, Carry / Done / Drop, reflection, Skip / Later, chaining.
 *
 * bootTasks({ planned:false }) leaves the WEEK unplanned (month + year are
 * pre-marked by the seed), so opening the Tasks tab triggers the weekly prompt.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { loadApp } = require('../helpers/setup');
const { showApp, bootTasks, goToTasks, rowTitles } = require('./helpers');

const overlay = page => page.locator('#tasks-planning');
const title   = page => page.locator('#tasks-plan-title');
const lastWeek = (extra = {}) => ({ horizon: 'week', periodKey: '@week:-1', ...extra });

async function planTask(page, text) {
  await page.fill('#tasks-plan-input', text);
  await page.press('#tasks-plan-input', 'Enter');
}

/* ── when it shows ───────────────────────────────────────────────── */
test.describe('trigger', () => {
  test('first open of a new week shows "Plan your week" — and only the week', async ({ page }) => {
    await bootTasks(page, { planned: false });
    await goToTasks(page);
    await expect(overlay(page)).toBeVisible();
    await expect(title(page)).toHaveText('Plan your week');
    await expect(page.locator('#tasks-plan-leftovers')).toHaveCount(0);   // nothing to review yet
  });

  test('it is an accessible dialog and focuses the task input', async ({ page }) => {
    await bootTasks(page, { planned: false });
    await goToTasks(page);
    await expect(page.locator('#tasks-planning [role="dialog"]')).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('#tasks-plan-input')).toBeFocused();
  });

  test('an already-planned week does not prompt', async ({ page }) => {
    await bootTasks(page, { planned: true });
    await goToTasks(page);
    await expect(overlay(page)).toBeHidden();
  });

  test('never shows over the login screen', async ({ page }) => {
    await loadApp(page);      // app shell still hidden
    await page.evaluate(() => { tasksState = tasksSeedState(); checkTasksPlanning(); });
    await expect(overlay(page)).toBeHidden();
  });

  test('a previous week\'s marker means a new week is due', async ({ page }) => {
    await bootTasks(page, { planned: false, extra: { planning: { prompted: { week: '2000-01-02' } } } });
    await goToTasks(page);
    await expect(overlay(page)).toBeVisible();
  });
});

/* ── planning ────────────────────────────────────────────────────── */
test.describe('planning the period', () => {
  test.beforeEach(async ({ page }) => { await bootTasks(page, { planned: false }); await goToTasks(page); });

  test('add tasks with Enter, see the count, finish → tasks land in this week', async ({ page }) => {
    await planTask(page, 'Write report');
    await planTask(page, 'Call dentist');
    await expect(page.locator('#tasks-plan-counter')).toHaveText('2 / 7 planned');
    await expect(page.locator('#tasks-plan-input')).toHaveValue('');
    await page.click('[data-plan="finish"]');
    await expect(overlay(page)).toBeHidden();
    expect((await rowTitles(page)).sort()).toEqual(['Call dentist', 'Write report']);
  });

  test('once planned, the prompt does not come back', async ({ page }) => {
    await planTask(page, 'One');
    await page.click('[data-plan="finish"]');
    await page.evaluate(() => checkTasksPlanning());
    await page.click('#nav-add'); await goToTasks(page);
    await expect(overlay(page)).toBeHidden();
    expect(await page.evaluate(() => tasksState.planning.prompted.week === tasksCurrentPeriod('week'))).toBe(true);
  });

  test('"Done planning" with nothing planned is refused', async ({ page }) => {
    await page.click('[data-plan="finish"]');
    await expect(page.locator('#toast')).toContainText(/at least one task/i);
    await expect(overlay(page)).toBeVisible();
  });

  test('an empty task name is refused', async ({ page }) => {
    await page.click('[data-plan="add"]');
    await expect(page.locator('#toast')).toContainText(/type a task/i);
  });

  test('planning past the weekly cap shows a warning', async ({ page }) => {
    await page.evaluate(() => { tasksState.settings.weeklyCap = 2; });
    await planTask(page, 'a'); await planTask(page, 'b');
    await expect(page.locator('.tasks-plan-over')).toHaveCount(0);
    await planTask(page, 'c');
    await expect(page.locator('.tasks-plan-over')).toContainText(/3 \/ 2.*overloading/i);
  });

  test('a planned task can be removed again', async ({ page }) => {
    await planTask(page, 'Oops');
    await page.click('[data-plan="remove"]');
    await expect(page.locator('#tasks-plan-list .tasks-plan-row')).toHaveCount(0);
    await expect(page.locator('#tasks-plan-counter')).toHaveText('0 / 7 planned');
  });
});

/* ── skip / later ────────────────────────────────────────────────── */
test.describe('skip and later', () => {
  test.beforeEach(async ({ page }) => { await bootTasks(page, { planned: false }); await goToTasks(page); });

  test('Skip closes it, marks the week planned, and records that you skipped', async ({ page }) => {
    await page.click('[data-plan="skip"]');
    await expect(overlay(page)).toBeHidden();
    const out = await page.evaluate(() => ({
      prompted: tasksState.planning.prompted.week === tasksCurrentPeriod('week'),
      skipped: tasksState.planning.skipped,
      key: `week:${tasksCurrentPeriod('week')}`,
    }));
    expect(out.prompted).toBe(true);
    expect(out.skipped).toEqual([out.key]);
  });

  test('Later closes it for now without marking the week planned', async ({ page }) => {
    await page.click('[data-plan="later"]');
    await expect(overlay(page)).toBeHidden();
    await page.evaluate(() => checkTasksPlanning());
    await expect(overlay(page)).toBeHidden();                      // snoozed this session
    expect(await page.evaluate(() => tasksState.planning.prompted.week)).toBeUndefined();
    expect(await page.evaluate(() => tasksState.planning.skipped.length)).toBe(0);
  });

  test('Later only snoozes: it asks again on the next app open', async ({ page }) => {
    await page.click('[data-plan="later"]');
    await page.reload();
    await showApp(page);
    await goToTasks(page);
    await expect(overlay(page)).toBeVisible();
  });

  test('Escape snoozes too', async ({ page }) => {
    await page.press('#tasks-plan-input', 'Escape');
    await expect(overlay(page)).toBeHidden();
  });
});

/* ── review of last week ─────────────────────────────────────────── */
test.describe('review of the previous week', () => {
  const seed = [
    lastWeek({ title: 'Finished',   status: 'completed' }),
    lastWeek({ title: 'Half done',  status: 'inprogress' }),
    lastWeek({ title: 'Never began' }),
  ];
  test.beforeEach(async ({ page }) => { await bootTasks(page, { planned: false, tasks: seed }); await goToTasks(page); });

  test('shows last week\'s score and the unfinished tasks', async ({ page }) => {
    await expect(page.locator('.tasks-plan-summary')).toContainText('Last week: 1 of 3 done (33%)');
    await expect(page.locator('#tasks-plan-leftovers .tasks-plan-row')).toHaveCount(2);
    await expect(page.locator('#tasks-plan-leftovers')).toContainText('Half done');
    await expect(page.locator('#tasks-plan-leftovers')).not.toContainText('Finished');
  });

  test('Carry moves a leftover into this week with a carry count', async ({ page }) => {
    await page.locator('#tasks-plan-leftovers .tasks-plan-row', { hasText: 'Never began' }).locator('[data-plan="carry"]').click();
    await expect(page.locator('#tasks-plan-leftovers .tasks-plan-row')).toHaveCount(1);
    await expect(page.locator('#tasks-plan-list')).toContainText('Never began');
    await expect(page.locator('#tasks-plan-list')).toContainText('carried 1×');
    await expect(page.locator('#tasks-plan-counter')).toHaveText('1 / 7 planned');
  });

  test('Done and Drop resolve a leftover in place', async ({ page }) => {
    await page.locator('#tasks-plan-leftovers .tasks-plan-row', { hasText: 'Half done' }).locator('[data-plan="done"]').click();
    await page.locator('#tasks-plan-leftovers .tasks-plan-row', { hasText: 'Never began' }).locator('[data-plan="drop"]').click();
    await expect(page.locator('#tasks-plan-leftovers .tasks-plan-row')).toHaveCount(0);
    const s = await page.evaluate(() => Object.fromEntries(tasksState.tasks.map(t => [t.title, t.status])));
    expect(s).toMatchObject({ 'Half done': 'completed', 'Never began': 'dropped' });
  });

  test('last week\'s score stays honest after carrying', async ({ page }) => {
    await page.locator('#tasks-plan-leftovers .tasks-plan-row', { hasText: 'Never began' }).locator('[data-plan="carry"]').click();
    const pct = await page.evaluate(() => tasksPeriodStats('week', tasksShiftPeriod('week', tasksCurrentPeriod('week'), -1)).pct);
    expect(pct).toBe(33);       // carrying must not turn 1/3 into 1/2
  });

  test('your one-line reflection is saved and shows up in Stats', async ({ page }) => {
    await page.fill('#tasks-plan-reflection', 'Too many meetings');
    await planTask(page, 'Protect mornings');
    await page.click('[data-plan="finish"]');
    const review = await page.evaluate(() => tasksState.reviews[0]);
    expect(review).toMatchObject({ horizon: 'week', reflection: 'Too many meetings', done: 1, total: 3, pct: 33 });
    await page.click('[data-action="stats"]');
    await expect(page.locator('.tasks-hist-note')).toContainText('Too many meetings');
  });

  test('a streak summary is part of the weekly review', async ({ page }) => {
    await expect(page.locator('.tasks-plan-summary')).toContainText('streak at 0');
  });
});

/* ── links while planning ────────────────────────────────────────── */
test('weekly planning can link a task to a monthly goal', async ({ page }) => {
  await bootTasks(page, { planned: false, tasks: [{ title: 'Get fit', horizon: 'month', periodKey: '@month:0' }] });
  await goToTasks(page);
  await page.selectOption('#tasks-plan-parent', { label: 'Get fit' });
  await planTask(page, 'Gym Monday');
  await page.click('[data-plan="finish"]');
  const parent = await page.evaluate(() => tasksState.tasks.find(t => t.title === 'Gym Monday').parentId);
  expect(parent).toBe('t0');
});

/* ── monthly prompt + long-term check-in + chaining ──────────────── */
test.describe('monthly prompt', () => {
  const staleMonth = { planning: { prompted: { month: '2000-01' } } };

  test('new month: asks to plan the month and checks in on long-term targets', async ({ page }) => {
    await bootTasks(page, {
      planned: false,
      extra: { planning: { prompted: { week: undefined, month: '2000-01' } } },
      tasks: [{ title: 'Learn piano', horizon: 'long' }],
    });
    await page.evaluate(() => { tasksState.planning.prompted.week = tasksCurrentPeriod('week'); });   // isolate the month
    await goToTasks(page);
    await expect(title(page)).toHaveText('Plan your month');
    await expect(page.locator('#tasks-plan-leftovers')).toContainText('Long-term check-in');
    await expect(page.locator('#tasks-plan-leftovers')).toContainText('Learn piano');
    await expect(page.locator('#tasks-plan-leftovers [data-plan="carry"]')).toHaveCount(0);   // long-term can't be carried
  });

  test('long-term check-in: Done completes the target', async ({ page }) => {
    await bootTasks(page, { planned: false, extra: staleMonth, tasks: [{ title: 'Learn piano', horizon: 'long' }] });
    await page.evaluate(() => { tasksState.planning.prompted.week = tasksCurrentPeriod('week'); });
    await goToTasks(page);
    await page.click('#tasks-plan-leftovers [data-plan="done"]');
    expect(await page.evaluate(() => tasksById('t0').status)).toBe('completed');
  });

  test('several periods due at once are asked in order: month, then week', async ({ page }) => {
    await bootTasks(page, { planned: false, extra: staleMonth });
    await goToTasks(page);
    await expect(title(page)).toHaveText('Plan your month');
    await planTask(page, 'Month goal');
    await page.click('[data-plan="finish"]');
    await expect(title(page)).toHaveText('Plan your week');
    await planTask(page, 'Week task');
    await page.click('[data-plan="finish"]');
    await expect(overlay(page)).toBeHidden();
    const planned = await page.evaluate(() => ({
      month: tasksState.planning.prompted.month === tasksCurrentPeriod('month'),
      week:  tasksState.planning.prompted.week  === tasksCurrentPeriod('week'),
    }));
    expect(planned).toEqual({ month: true, week: true });
  });

  test('year comes before month before week', async ({ page }) => {
    await bootTasks(page, { planned: false, extra: { planning: { prompted: { month: '2000-01', year: '2000' } } } });
    await goToTasks(page);
    await expect(title(page)).toHaveText('Plan your year');
    await page.click('[data-plan="skip"]');
    await expect(title(page)).toHaveText('Plan your month');
  });
});
