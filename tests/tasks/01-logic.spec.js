/**
 * Tasks — pure logic: periods, v1 migration, carry-over, stats, streaks, links.
 * Everything runs inside the page against the real modules.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { loadApp } = require('../helpers/setup');
const { bootTasks } = require('./helpers');

/* ── periods (Sunday-start weeks) ────────────────────────────────── */
test.describe('periods', () => {
  test.beforeEach(async ({ page }) => { await loadApp(page); });

  test('weeks start on Sunday', async ({ page }) => {
    const keys = await page.evaluate(() => [
      '2026-11-01', // Sunday  → itself
      '2026-11-06', // Friday  → that Sunday
      '2026-11-07', // Saturday→ that Sunday
      '2026-11-08', // next Sunday starts a new week
    ].map(d => tasksPeriodKey('week', d)));
    expect(keys).toEqual(['2026-11-01', '2026-11-01', '2026-11-01', '2026-11-08']);
  });

  test('a week can start in the previous month or year', async ({ page }) => {
    const keys = await page.evaluate(() => [
      tasksPeriodKey('week', '2026-11-02'),  // Mon → Sun 1 Nov
      tasksPeriodKey('week', '2027-01-01'),  // Fri → Sun 27 Dec 2026
    ]);
    expect(keys).toEqual(['2026-11-01', '2026-12-27']);
  });

  test('month, year and long keys', async ({ page }) => {
    const keys = await page.evaluate(() => [
      tasksPeriodKey('month', '2026-11-06'),
      tasksPeriodKey('year', '2026-11-06'),
      tasksPeriodKey('long', '2026-11-06'),
    ]);
    expect(keys).toEqual(['2026-11', '2026', '']);
  });

  test('shifting crosses month and year boundaries', async ({ page }) => {
    const out = await page.evaluate(() => ({
      nextMonth: tasksShiftPeriod('month', '2026-12', 1),
      prevMonth: tasksShiftPeriod('month', '2026-01', -1),
      nextYear:  tasksShiftPeriod('year', '2026', 1),
      nextWeek:  tasksShiftPeriod('week', '2026-12-27', 1),
      prevWeek:  tasksShiftPeriod('week', '2026-11-01', -1),
    }));
    expect(out).toEqual({
      nextMonth: '2027-01', prevMonth: '2025-12', nextYear: '2027',
      nextWeek: '2027-01-03', prevWeek: '2026-10-25',
    });
  });

  test('labels', async ({ page }) => {
    const out = await page.evaluate(() => ({
      week:  tasksPeriodLabel('week', '2026-11-01'),
      month: tasksPeriodLabel('month', '2026-11'),
      year:  tasksPeriodLabel('year', '2026'),
      name:  tasksPeriodName('week', tasksCurrentPeriod('week')),
      last:  tasksPeriodName('month', tasksShiftPeriod('month', tasksCurrentPeriod('month'), -1)),
    }));
    expect(out.week).toBe('Nov 1 – Nov 7');
    expect(out.month).toBe('November 2026');
    expect(out.year).toBe('2026');
    expect(out.name).toBe('This week');
    expect(out.last).toBe('Last month');
  });
});

/* ── v1 → v2 migration ───────────────────────────────────────────── */
test('migrates v1 tasks: Short-term → Weekly, everything else → Long-term', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('expense-tracker.tasks.v1', JSON.stringify({
      types: [
        { id: 'type_short', name: 'Short-term' }, { id: 'type_long', name: 'Long-term' },
        { id: 'type_personal', name: 'Personal' },
      ],
      tasks: [
        { id: 'a', title: 'short open',  typeId: 'type_short',    completed: false },
        { id: 'b', title: 'short done',  typeId: 'type_short',    completed: true, completedAt: new Date().toISOString() },
        { id: 'c', title: 'long',        typeId: 'type_long',     completed: false },
        { id: 'd', title: 'personal',    typeId: 'type_personal', completed: false },
        { id: 'e', title: 'orphan',      typeId: null,            completed: false },
      ],
    }));
  });
  await loadApp(page);
  const out = await page.evaluate(() => ({
    tasks: tasksState.tasks.map(t => [t.title, t.horizon, t.status]),
    week:  tasksCurrentPeriod('week'),
    keys:  Object.fromEntries(tasksState.tasks.map(t => [t.title, t.periodKey])),
    v1Kept: !!localStorage.getItem('expense-tracker.tasks.v1'),
    v2Saved: !!localStorage.getItem('expense-tracker.tasks.v2'),
  }));
  expect(out.tasks).toEqual([
    ['short open', 'week', 'todo'], ['short done', 'week', 'completed'],
    ['long', 'long', 'todo'], ['personal', 'long', 'todo'], ['orphan', 'long', 'todo'],
  ]);
  expect(out.keys['short open']).toBe(out.week);
  expect(out.keys['long']).toBe('');
  expect(out.v1Kept).toBe(true);   // untouched → easy rollback
  expect(out.v2Saved).toBe(true);
});

/* ── carry-over + honest stats ───────────────────────────────────── */
test.describe('carry-over', () => {
  test('moving a task forward counts the carry and remembers where it left', async ({ page }) => {
    await bootTasks(page, { tasks: [{ title: 'Gym', horizon: 'week', periodKey: '@week:0' }] });
    const out = await page.evaluate(() => {
      const from = tasksCurrentPeriod('week');
      const moved = tasksMoveForward('t0');
      return { carries: tasksCarryCount(moved), from: moved.carriedFrom, to: moved.periodKey,
               expected: tasksShiftPeriod('week', from, 1), origin: from };
    });
    expect(out.carries).toBe(1);
    expect(out.to).toBe(out.expected);
    expect(out.from).toEqual([out.origin]);
  });

  test('last week still counts a moved task as unfinished', async ({ page }) => {
    await bootTasks(page, { tasks: [
      { title: 'done',  horizon: 'week', periodKey: '@week:0', status: 'completed' },
      { title: 'moved', horizon: 'week', periodKey: '@week:0' },
    ] });
    const out = await page.evaluate(() => {
      const wk = tasksCurrentPeriod('week');
      tasksMoveForward('t1');
      const s = tasksPeriodStats('week', wk);
      return { done: s.done, total: s.total, pct: s.pct, moved: s.moved };
    });
    expect(out).toEqual({ done: 1, total: 2, pct: 50, moved: 1 });   // NOT 100%
  });

  test('dropped tasks are excluded from the score', async ({ page }) => {
    await bootTasks(page, { tasks: [
      { title: 'a', horizon: 'week', periodKey: '@week:0', status: 'completed' },
      { title: 'b', horizon: 'week', periodKey: '@week:0', status: 'dropped' },
    ] });
    const s = await page.evaluate(() => tasksPeriodStats('week', tasksCurrentPeriod('week')));
    expect([s.done, s.total, s.pct]).toEqual([1, 1, 100]);
  });

  test('long-term tasks cannot be moved', async ({ page }) => {
    await bootTasks(page, { tasks: [{ title: 'Someday', horizon: 'long' }] });
    expect(await page.evaluate(() => tasksMoveForward('t0'))).toBeNull();
  });
});

/* ── statuses ────────────────────────────────────────────────────── */
test.describe('statuses', () => {
  test('completedAt is set and cleared with the status; reason only when blocked', async ({ page }) => {
    await bootTasks(page, { tasks: [{ title: 'x', horizon: 'week', periodKey: '@week:0' }] });
    const out = await page.evaluate(() => {
      const snap = () => { const t = tasksById('t0'); return [t.status, !!t.completedAt, t.blockedReason]; };
      tasksChangeStatus('t0', 'completed');             const done = snap();
      tasksChangeStatus('t0', 'blocked', 'waiting');    const blocked = snap();
      tasksChangeStatus('t0', 'inprogress', 'ignored'); const prog = snap();
      return { done, blocked, prog };
    });
    expect(out.done).toEqual(['completed', true, '']);
    expect(out.blocked).toEqual(['blocked', false, 'waiting']);
    expect(out.prog).toEqual(['inprogress', false, '']);
  });

  test('form validation: title required, blocked needs a reason', async ({ page }) => {
    await loadApp(page);
    const out = await page.evaluate(() => [
      validateTaskForm({ title: '', status: 'todo', blockedReason: '' }),
      validateTaskForm({ title: 'x', status: 'blocked', blockedReason: '' }),
      validateTaskForm({ title: 'x', status: 'blocked', blockedReason: 'why' }),
      validateTaskForm({ title: 'x', status: 'todo', blockedReason: '' }),
    ]);
    expect(out[0]).toMatch(/title/i);
    expect(out[1]).toMatch(/blocking/i);
    expect(out[2]).toBe('');
    expect(out[3]).toBe('');
  });
});

/* ── streak ──────────────────────────────────────────────────────── */
test.describe('weekly streak', () => {
  const week = (offset, done, total) => Array.from({ length: total }, (_, i) => ({
    title: `w${offset}-${i}`, horizon: 'week', periodKey: `@week:${offset}`,
    status: i < done ? 'completed' : 'todo',
  }));

  test('counts consecutive qualifying weeks, stops at the first miss', async ({ page }) => {
    await bootTasks(page, { tasks: [
      ...week(-1, 4, 5),   // 80% 
      ...week(-2, 5, 5),   // 100% 
      ...week(-3, 1, 5),   // 20%   ← streak ends here
      ...week(-4, 5, 5),
    ] });
    expect(await page.evaluate(() => tasksWeeklyStreak())).toBe(2);
  });

  test('the running week adds to the streak once it qualifies, never breaks it', async ({ page }) => {
    await bootTasks(page, { tasks: [...week(-1, 5, 5), ...week(0, 0, 3)] });
    expect(await page.evaluate(() => tasksWeeklyStreak())).toBe(1);   // current week not done yet
    await page.evaluate(() => { for (const t of tasksOfPeriod('week', tasksCurrentPeriod('week'))) tasksChangeStatus(t.id, 'completed'); });
    expect(await page.evaluate(() => tasksWeeklyStreak())).toBe(2);
  });

  test('threshold comes from settings', async ({ page }) => {
    await bootTasks(page, { tasks: week(-1, 3, 5) });   // 60%
    expect(await page.evaluate(() => tasksWeeklyStreak())).toBe(0);
    await page.evaluate(() => { tasksState.settings.streakPct = 60; });
    expect(await page.evaluate(() => tasksWeeklyStreak())).toBe(1);
  });

  test('an empty history is a streak of 0 (and terminates)', async ({ page }) => {
    await bootTasks(page);
    expect(await page.evaluate(() => tasksWeeklyStreak())).toBe(0);
  });
});

/* ── hierarchy ───────────────────────────────────────────────────── */
test.describe('links', () => {
  test('weekly tasks can link to this month\'s open monthly goals only', async ({ page }) => {
    await bootTasks(page, { tasks: [
      { title: 'open goal',  horizon: 'month', periodKey: '@month:0' },
      { title: 'done goal',  horizon: 'month', periodKey: '@month:0', status: 'completed' },
      { title: 'old goal',   horizon: 'month', periodKey: '@month:-3' },
      { title: 'a year goal',horizon: 'year',  periodKey: '@year:0' },
    ] });
    const titles = await page.evaluate(() =>
      tasksParentCandidates('week', tasksCurrentPeriod('week')).map(t => t.title));
    expect(titles).toEqual(['open goal']);
  });

  test('monthly links to yearly; yearly and long-term link to nothing', async ({ page }) => {
    await bootTasks(page, { tasks: [{ title: 'year goal', horizon: 'year', periodKey: '@year:0' }] });
    const out = await page.evaluate(() => ({
      month: tasksParentCandidates('month', tasksCurrentPeriod('month')).length,
      year:  tasksParentCandidates('year', tasksCurrentPeriod('year')).length,
      long:  tasksParentCandidates('long', '').length,
    }));
    expect(out).toEqual({ month: 1, year: 0, long: 0 });
  });

  test('progress of a parent comes from its children; deleting it orphans them', async ({ page }) => {
    await bootTasks(page, { tasks: [
      { title: 'goal', horizon: 'month', periodKey: '@month:0' },
      { title: 'k1', horizon: 'week', periodKey: '@week:0', parentId: 't0', status: 'completed' },
      { title: 'k2', horizon: 'week', periodKey: '@week:0', parentId: 't0' },
      { title: 'k3', horizon: 'week', periodKey: '@week:0', parentId: 't0', status: 'dropped' },
    ] });
    const out = await page.evaluate(() => {
      const before = tasksChildProgress(tasksById('t0'));
      tasksRemove('t0');
      return { before, orphans: tasksState.tasks.filter(t => t.parentId).length, remaining: tasksState.tasks.length };
    });
    expect(out.before).toEqual({ done: 1, total: 2 });   // dropped child ignored
    expect(out.orphans).toBe(0);
    expect(out.remaining).toBe(3);                       // children survive
  });
});

/* ── sheet row mapping ───────────────────────────────────────────── */
test('sheet rows round-trip every field, including multiple carries', async ({ page }) => {
  await bootTasks(page, { tasks: [{
    title: 'Roundtrip', horizon: 'week', periodKey: '@week:0', status: 'blocked',
    blockedReason: 'waiting', parentId: 'p1', carriedFrom: ['@week:-2', '@week:-1'],
  }] });
  const same = await page.evaluate(() => {
    const original = tasksById('t0');
    const back = tasksNormalizeTask(tasksFromRow(tasksToRow(original)));
    return { equal: JSON.stringify(back) === JSON.stringify(original), cols: tasksToRow(original).length,
             headers: TASKS_TAB.headers.length };
  });
  expect(same.equal).toBe(true);
  expect(same.cols).toBe(same.headers);
});
