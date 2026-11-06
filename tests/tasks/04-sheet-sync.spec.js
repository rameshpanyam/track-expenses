/**
 * Tasks — Google Sheets sync against a fake in-memory spreadsheet.
 * Proves: new tabs are created, rows round-trip, the sheet wins on pull,
 * an empty sheet gets seeded from local data, and the old v1 "Tasks"
 * tab is never touched.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { bootTasks } = require('./helpers');

/** Install a minimal Sheets API fake. `window.__sheet` is the "spreadsheet". */
async function installFakeSheet(page, initialTabs = {}) {
  await page.evaluate(initial => {
    const tabs = JSON.parse(JSON.stringify(initial));        // name → array of rows
    const calls = [];
    window.__sheet = { tabs, calls };

    const parseRange = raw => {
      const clean = raw.split('?')[0].replace(/:clear$/, '');
      const [name, cells = ''] = decodeURIComponent(clean).split('!');
      const m = /^([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/.exec(cells) || [];
      return { name, from: m[2] ? Number(m[2]) : 1, to: m[4] ? Number(m[4]) : Infinity };
    };

    window.sheetsRequest = async (method, path, body) => {
      calls.push(`${method} ${path.split('?')[0]}`);
      if (method === 'GET' && path.includes('fields=sheets.properties')) {
        return { sheets: Object.keys(tabs).map(title => ({ properties: { title, sheetId: 1 } })) };
      }
      if (method === 'POST' && path.endsWith(':batchUpdate')) {
        for (const r of body.requests) tabs[r.addSheet.properties.title] = [];
        return {};
      }
      const range = parseRange(path.split('/values/')[1] || '');
      const rows = tabs[range.name] || (tabs[range.name] = []);
      if (path.endsWith(':clear')) {
        for (let i = range.from - 1; i < Math.min(range.to, rows.length); i++) rows[i] = [];
        while (rows.length && !rows[rows.length - 1].length) rows.pop();
        return {};
      }
      if (method === 'PUT') {
        body.values.forEach((row, i) => { rows[range.from - 1 + i] = row; });
        return {};
      }
      return { values: rows.slice(range.from - 1, range.to === Infinity ? undefined : range.to) };
    };
    window.spreadsheetId = 'fake-sheet';
    window.accessToken   = 'fake-token';
  }, initialTabs);
}

const sampleTasks = [
  { title: 'Ship v2', horizon: 'week', periodKey: '@week:0', status: 'blocked', blockedReason: 'waiting on review',
    carriedFrom: ['@week:-2', '@week:-1'] },
  { title: 'Learn piano', horizon: 'long' },
  { title: 'Child', horizon: 'week', periodKey: '@week:0', parentId: 't0' },
];

test('push: creates TasksV2 + TasksMeta with correct headers and rows', async ({ page }) => {
  await bootTasks(page, { tasks: sampleTasks });
  await installFakeSheet(page);
  await page.evaluate(() => syncTasksToSheet());

  const out = await page.evaluate(() => ({
    names: Object.keys(__sheet.tabs).sort(),
    header: __sheet.tabs.TasksV2[0],
    rows: __sheet.tabs.TasksV2.slice(1).length,
    first: __sheet.tabs.TasksV2[1],
    meta: __sheet.tabs.TasksMeta.slice(1).map(r => r[0]),
  }));
  expect(out.names).toEqual(['TasksMeta', 'TasksV2']);
  expect(out.header).toHaveLength(12);
  expect(out.header[11]).toBe('TypeId');
  expect(out.rows).toBe(3);
  expect(out.first.slice(0, 7)).toEqual(['t0', 'Ship v2', 'week', expect.any(String), 'blocked', 'waiting on review', '']);
  expect(out.first[7].split('|')).toHaveLength(2);        // both carries survive
  expect(out.meta).toEqual(['reviews', 'planning', 'settings', 'types']);
});

test('pull: a second device gets the same tasks, reviews, settings and planning marker', async ({ page }) => {
  await bootTasks(page, {
    tasks: sampleTasks,
    extra: {
      reviews: [{ horizon: 'week', periodKey: '2026-10-25', reflection: 'Good focus', done: 3, total: 4, pct: 75 }],
      settings: { weeklyCap: 5, streakPct: 70 },
    },
  });
  await installFakeSheet(page);
  await page.evaluate(() => syncTasksToSheet());

  // "Device B": wipe local state, then pull.
  const before = await page.evaluate(() => JSON.stringify(tasksState));
  await page.evaluate(() => { tasksState = tasksSeedState(); });
  await page.evaluate(() => pullTasksFromSheet());
  const after = await page.evaluate(() => JSON.stringify(tasksState));
  expect(JSON.parse(after)).toEqual(JSON.parse(before));
});

test('pull: the sheet wins over local data', async ({ page }) => {
  await bootTasks(page, { tasks: [{ title: 'local only', horizon: 'long' }] });
  await installFakeSheet(page);
  await page.evaluate(() => { tasksState = tasksNormalizeState({ tasks: [{ id: 'remote', title: 'from sheet', horizon: 'long' }] }); });
  await page.evaluate(() => syncTasksToSheet());
  await page.evaluate(() => { tasksState = tasksNormalizeState({ tasks: [{ id: 'stale', title: 'stale local', horizon: 'long' }] }); });
  await page.evaluate(() => pullTasksFromSheet());
  expect(await page.evaluate(() => tasksState.tasks.map(t => t.title))).toEqual(['from sheet']);
});

test('pull: an EMPTY sheet is seeded from local data instead of wiping it', async ({ page }) => {
  await bootTasks(page, { tasks: sampleTasks });
  await installFakeSheet(page);
  await page.evaluate(() => pullTasksFromSheet());
  expect(await page.evaluate(() => tasksState.tasks.length)).toBe(3);              // local data survived
  expect(await page.evaluate(() => __sheet.tabs.TasksV2.length - 1)).toBe(3);      // and was pushed up
});

test('deleting a task shrinks the sheet (stale rows are cleared)', async ({ page }) => {
  await bootTasks(page, { tasks: sampleTasks });
  await installFakeSheet(page);
  await page.evaluate(() => syncTasksToSheet());
  await page.evaluate(() => { tasksState.tasks.pop(); return syncTasksToSheet(); });
  expect(await page.evaluate(() => __sheet.tabs.TasksV2.length - 1)).toBe(2);
});

test('the old v1 "Tasks" tab is never read or written', async ({ page }) => {
  const legacy = [['ID','Title','StartDate','EndDate','Completed','CompletedAt','CreatedAt','UpdatedAt','TypeId','TypeName'],
                  ['old1', 'Old task', '2026-01-01', '2026-01-09', 'FALSE', '', '', '', 'type_short', 'Short-term']];
  await bootTasks(page, { tasks: sampleTasks });
  await installFakeSheet(page, { Tasks: legacy });
  await page.evaluate(() => syncTasksToSheet());
  await page.evaluate(() => pullTasksFromSheet());
  const out = await page.evaluate(() => ({
    legacy: __sheet.tabs.Tasks,
    touched: __sheet.calls.some(c => /\/Tasks!/.test(c)),
    titles: tasksState.tasks.map(t => t.title),
  }));
  expect(out.legacy).toEqual(legacy);
  expect(out.touched).toBe(false);
  expect(out.titles).not.toContain('Old task');
});

test('loadTasksFromSheet (used by app.js) still pulls, and re-checks planning afterwards', async ({ page }) => {
  await bootTasks(page, { planned: true, tasks: sampleTasks });
  await installFakeSheet(page);
  await page.evaluate(() => syncTasksToSheet());
  // Pretend this week hasn't been planned on this device, but the sheet says it has.
  await page.evaluate(() => { tasksState.planning.prompted.week = undefined; });
  await page.evaluate(() => loadTasksFromSheet());
  await expect(page.locator('#tasks-planning')).toBeHidden();       // sheet's "planned" marker won
});
