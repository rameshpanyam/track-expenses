/**
 * Tasks — your own goal types (categories): starters, create/rename/delete,
 * filter chips, badge, scoped hero, form + planning pickers, sheet sync.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { loadApp } = require('../helpers/setup');
const { bootTasks, goToTasks, addTask, rowTitles, row } = require('./helpers');

const thisWeek = (extra = {}) => ({ horizon: 'week', periodKey: '@week:0', ...extra });
const typeChips = page => page.locator('#tasks-type-bar .savings-pot-chip-name').allTextContents();
const typeChip  = (page, name) => page.locator('#tasks-type-bar .savings-pot-chip', { hasText: name });

/* ── starters ────────────────────────────────────────────────────── */
test.describe('starter types', () => {
  test('a fresh install gets the six starters, in order', async ({ page }) => {
    await bootTasks(page);
    await goToTasks(page);
    expect(await typeChips(page)).toEqual(['All', 'Health', 'Career', 'Finance', 'Learning', 'Family', 'Personal']);
    await expect(page.locator('[data-action="new-type"]')).toHaveText('+ New type');
  });

  test('existing v2 data with NO types key is seeded once', async ({ page }) => {
    await loadApp(page);
    const names = await page.evaluate(() => tasksNormalizeState({ tasks: [{ id: 'a', title: 'x', horizon: 'long' }] }).types.map(t => t.name));
    expect(names).toEqual(['Health', 'Career', 'Finance', 'Learning', 'Family', 'Personal']);
  });

  test('deleting them all stays deleted: an empty list is not re-seeded', async ({ page }) => {
    await loadApp(page);
    const n = await page.evaluate(() => tasksNormalizeState({ tasks: [], types: [] }).types.length);
    expect(n).toBe(0);
  });

  test('v1 migration also gets starters', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('expense-tracker.tasks.v1', JSON.stringify({ types: [], tasks: [{ id: 'a', title: 'old', typeId: null, completed: false }] }));
    });
    await loadApp(page);
    expect(await page.evaluate(() => tasksState.types.length)).toBe(6);
  });
});

/* ── create / rename / delete ────────────────────────────────────── */
test.describe('managing types', () => {
  test.beforeEach(async ({ page }) => { await bootTasks(page); await goToTasks(page); });

  test('+ New type creates one and jumps into it', async ({ page }) => {
    await page.click('[data-action="new-type"]');
    await page.fill('#tasks-type-name-input', 'Side project');
    await page.click('#tasks-type-modal >> text=Save');
    expect(await typeChips(page)).toContain('Side project');
    await expect(typeChip(page, 'Side project')).toHaveClass(/active/);
  });

  test('duplicate names (any case), blanks and over-long names are refused', async ({ page }) => {
    await page.click('[data-action="new-type"]');
    await page.fill('#tasks-type-name-input', 'health');
    await page.click('#tasks-type-modal >> text=Save');
    await expect(page.locator('#toast')).toContainText(/already exists/i);
    await page.fill('#tasks-type-name-input', '   ');
    await page.click('#tasks-type-modal >> text=Save');
    await expect(page.locator('#toast')).toContainText(/enter a type name/i);
    const tooLong = await page.evaluate(() => validateTaskTypeName('x'.repeat(31)));
    expect(tooLong).toMatch(/under 30/);
    await expect(page.locator('#tasks-type-modal')).toBeVisible();
  });

  test('rename keeps the tasks attached', async ({ page }) => {
    await page.evaluate(() => { tasksAdd({ title: 'Run', horizon: 'week', periodKey: tasksCurrentPeriod('week'), typeId: 'type_health' }); renderTasks(); });
    await page.click('[data-action="edit-type"][data-id="type_health"]');
    await page.fill('#tasks-type-name-input', 'Fitness');
    await page.click('#tasks-type-modal >> text=Save');
    await expect(row(page, 'Run').locator('.tasks-type-badge')).toHaveText('Fitness');
  });

  test('renaming to its own name is allowed', async ({ page }) => {
    await page.click('[data-action="edit-type"][data-id="type_health"]');
    await page.click('#tasks-type-modal >> text=Save');
    await expect(page.locator('#tasks-type-modal')).toBeHidden();
  });

  test('deleting a type keeps its tasks, uncategorised, and resets the filter', async ({ page }) => {
    await page.evaluate(() => { tasksAdd({ title: 'Run', horizon: 'week', periodKey: tasksCurrentPeriod('week'), typeId: 'type_health' }); renderTasks(); });
    await typeChip(page, 'Health').click();
    await page.click('[data-action="edit-type"][data-id="type_health"]');
    await page.click('#tasks-type-delete-btn');
    expect(await typeChips(page)).not.toContain('Health');
    await expect(typeChip(page, 'All')).toHaveClass(/active/);
    expect(await rowTitles(page)).toEqual(['Run']);                        // task survived
    await expect(page.locator('.tasks-type-badge')).toHaveCount(0);        // but uncategorised
    expect(await page.evaluate(() => tasksState.tasks[0].typeId)).toBeNull();
  });
});

/* ── filter + hero ───────────────────────────────────────────────── */
test.describe('filtering by type', () => {
  test.beforeEach(async ({ page }) => {
    await bootTasks(page, { tasks: [
      thisWeek({ title: 'Run',       typeId: 'type_health', status: 'completed' }),
      thisWeek({ title: 'Gym',       typeId: 'type_health' }),
      thisWeek({ title: 'Report',    typeId: 'type_career' }),
      thisWeek({ title: 'No type' }),
    ] });
    await goToTasks(page);
  });

  test('chip counts are for the viewed period and horizon', async ({ page }) => {
    await expect(typeChip(page, 'All').locator('.savings-pot-chip-bal')).toHaveText('1/4');
    await expect(typeChip(page, 'Health').locator('.savings-pot-chip-bal')).toHaveText('1/2');
    await expect(typeChip(page, 'Career').locator('.savings-pot-chip-bal')).toHaveText('0/1');
    await page.click('[data-action="horizon"][data-id="month"]');
    await expect(typeChip(page, 'Health').locator('.savings-pot-chip-bal')).toHaveText('0/0');
  });

  test('choosing a type scopes the list AND the hero', async ({ page }) => {
    await typeChip(page, 'Health').click();
    expect((await rowTitles(page)).sort()).toEqual(['Gym', 'Run']);
    await expect(page.locator('#tasks-hero .savings-hero-amount')).toHaveText('1 / 2 done');
    await expect(page.locator('#tasks-hero .savings-hero-label')).toContainText('HEALTH');
    await typeChip(page, 'All').click();
    await expect(page.locator('#tasks-hero .savings-hero-amount')).toHaveText('1 / 4 done');
  });

  test('the filter sticks when you switch section or week', async ({ page }) => {
    await typeChip(page, 'Career').click();
    await page.click('[data-action="horizon"][data-id="month"]');
    await expect(typeChip(page, 'Career')).toHaveClass(/active/);
    await page.click('[data-action="horizon"][data-id="week"]');
    expect(await rowTitles(page)).toEqual(['Report']);
  });

  test('empty state names the type', async ({ page }) => {
    await typeChip(page, 'Finance').click();
    await expect(page.locator('#tasks-list .savings-empty-title')).toContainText('No Finance weekly tasks');
  });

  test('streak and history ignore the filter (they stay overall)', async ({ page }) => {
    const overall = await page.evaluate(() => tasksPeriodStats('week', tasksCurrentPeriod('week')).total);
    await typeChip(page, 'Career').click();
    const afterFilter = await page.evaluate(() => tasksHistory('week', 1)[0].stats.total);
    expect(afterFilter).toBe(overall);
  });
});

/* ── badge + pickers ─────────────────────────────────────────────── */
test.describe('assigning types', () => {
  test.beforeEach(async ({ page }) => { await bootTasks(page); await goToTasks(page); });

  test('a task shows a badge for its type, and uncategorised tasks show none', async ({ page }) => {
    await page.evaluate(() => {
      tasksAdd({ title: 'Typed', horizon: 'week', periodKey: tasksCurrentPeriod('week'), typeId: 'type_finance' });
      tasksAdd({ title: 'Plain', horizon: 'week', periodKey: tasksCurrentPeriod('week') });
      renderTasks();
    });
    await expect(row(page, 'Typed').locator('.tasks-type-badge')).toHaveText('Finance');
    await expect(row(page, 'Plain').locator('.tasks-type-badge')).toHaveCount(0);
  });

  test('the same type always gets the same colour; different types differ', async ({ page }) => {
    const hues = await page.evaluate(() => ({
      a1: tasksTypeHue('type_health'), a2: tasksTypeHue('type_health'),
      b: tasksTypeHue('type_career'), c: tasksTypeHue('type_finance'),
    }));
    expect(hues.a1).toBe(hues.a2);
    expect(new Set([hues.a1, hues.b, hues.c]).size).toBe(3);
  });

  test('the form offers a Type picker; saving stores it; editing can change or clear it', async ({ page }) => {
    await page.click('#view-tasks [data-action="add"]');
    await page.fill('#tasks-form-title', 'Read book');
    await page.selectOption('#tasks-form-type', { label: 'Learning' });
    await page.click('#tasks-form-modal >> text=Save');
    await expect(row(page, 'Read book').locator('.tasks-type-badge')).toHaveText('Learning');

    await row(page, 'Read book').click();
    await page.selectOption('#tasks-form-type', { label: 'Family' });
    await page.click('#tasks-form-modal >> text=Save');
    await expect(row(page, 'Read book').locator('.tasks-type-badge')).toHaveText('Family');

    await row(page, 'Read book').click();
    await page.selectOption('#tasks-form-type', '');
    await page.click('#tasks-form-modal >> text=Save');
    await expect(page.locator('.tasks-type-badge')).toHaveCount(0);
  });

  test('adding while a type filter is on preselects that type', async ({ page }) => {
    await typeChip(page, 'Career').click();
    await page.click('#view-tasks [data-action="add"]');
    await expect(page.locator('#tasks-form-type option:checked')).toHaveText('Career');
  });

  test('the Type picker is hidden when you have no types at all', async ({ page }) => {
    await page.evaluate(() => { tasksState.types = []; renderTasks(); });
    await page.click('#view-tasks [data-action="add"]');
    await expect(page.locator('#tasks-form-type-wrap')).toBeHidden();
    expect(await typeChips(page)).toEqual(['All']);
    await expect(page.locator('[data-action="new-type"]')).toBeVisible();     // you can always create one
  });

  test('moving a task to next week keeps its type', async ({ page }) => {
    await page.evaluate(() => { tasksAdd({ title: 'Keep', horizon: 'week', periodKey: tasksCurrentPeriod('week'), typeId: 'type_health' }); renderTasks(); });
    await row(page, 'Keep').click();
    await page.click('#tasks-form-move');
    await page.click('[data-action="period-next"]');
    await expect(row(page, 'Keep').locator('.tasks-type-badge')).toHaveText('Health');
  });

  test('Break it down inherits the parent type', async ({ page }) => {
    await page.evaluate(() => {
      tasksAdd({ title: 'Big', horizon: 'month', periodKey: tasksCurrentPeriod('month'), typeId: 'type_career' });
      tasksState.tasks[0].carriedFrom = ['a', 'b', 'c'];
      renderTasks();
    });
    await page.click('[data-action="horizon"][data-id="month"]');
    await row(page, 'Big').click();
    await page.click('.tasks-nudge-btn >> text=Break it down');
    await expect(page.locator('#tasks-form-type option:checked')).toHaveText('Career');
  });
});

/* ── planning prompt ─────────────────────────────────────────────── */
test.describe('types in the planning prompt', () => {
  test('you can pick a type while planning, and the plan list shows its badge', async ({ page }) => {
    await bootTasks(page, { planned: false });
    await goToTasks(page);
    await page.selectOption('#tasks-plan-type', { label: 'Health' });
    await page.fill('#tasks-plan-input', 'Run 5k');
    await page.press('#tasks-plan-input', 'Enter');
    await expect(page.locator('#tasks-plan-list .tasks-type-badge')).toHaveText('Health');
    await expect(page.locator('#tasks-plan-type')).toHaveValue('type_health');   // sticks for the next one
  });

  test('the picker defaults to the active filter and is hidden with no types', async ({ page }) => {
    await bootTasks(page, { planned: false, extra: { types: [] } });
    await goToTasks(page);
    await expect(page.locator('#tasks-plan-type')).toHaveCount(0);
  });
});

/* ── sync + persistence ──────────────────────────────────────────── */
test.describe('sync', () => {
  test('types and task types survive a sheet round trip', async ({ page }) => {
    await bootTasks(page, {
      tasks: [thisWeek({ title: 'Run', typeId: 'type_health' })],
      extra: { types: [{ id: 'type_x', name: 'Side project' }, { id: 'type_health', name: 'Health' }] },
    });
    await page.evaluate(() => {
      const tabs = {};
      window.sheetsRequest = async (method, path, body) => {
        if (method === 'GET' && path.includes('fields=sheets.properties')) return { sheets: Object.keys(tabs).map(title => ({ properties: { title } })) };
        if (method === 'POST' && path.endsWith(':batchUpdate')) { body.requests.forEach(r => { tabs[r.addSheet.properties.title] = []; }); return {}; }
        const [name, cells] = decodeURIComponent(path.split('/values/')[1].split('?')[0].replace(/:clear$/, '')).split('!');
        const m = /^([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/.exec(cells);
        const from = m[2] ? Number(m[2]) : 1;
        const rows = tabs[name] || (tabs[name] = []);
        if (path.endsWith(':clear')) { for (let i = from - 1; i < rows.length; i++) rows[i] = []; while (rows.length && !rows[rows.length - 1].length) rows.pop(); return {}; }
        if (method === 'PUT') { body.values.forEach((r, i) => { rows[from - 1 + i] = r; }); return {}; }
        return { values: rows.slice(from - 1) };
      };
      window.getCachedSheetMeta = () => window.sheetsRequest('GET', '/x?fields=sheets.properties');
      window.invalidateSheetMetaCache = () => {};
      window.spreadsheetId = 'fake'; window.accessToken = 't';
    });
    await page.evaluate(() => syncTasksToSheet());
    await page.evaluate(() => { tasksState = tasksSeedState(); });            // "other device"
    await page.evaluate(() => pullTasksFromSheet());
    const out = await page.evaluate(() => ({
      types: tasksState.types.map(t => t.name),
      typeOfRun: tasksState.tasks.find(t => t.title === 'Run').typeId,
    }));
    expect(out.types).toEqual(['Side project', 'Health']);
    expect(out.typeOfRun).toBe('type_health');
  });

  test('typeId round-trips through a sheet row; old 11-column rows load as uncategorised', async ({ page }) => {
    await bootTasks(page, { tasks: [thisWeek({ title: 'Run', typeId: 'type_health' })] });
    const out = await page.evaluate(() => {
      const row = tasksToRow(tasksById('t0'));
      const old = row.slice(0, 11);                                           // pre-types sheet row
      return { cols: row.length, back: tasksFromRow(row).typeId, oldBack: tasksFromRow(old).typeId };
    });
    expect(out).toEqual({ cols: 12, back: 'type_health', oldBack: null });
  });

  test('types are written to localStorage', async ({ page }) => {
    await bootTasks(page);
    await goToTasks(page);
    await page.click('[data-action="new-type"]');
    await page.fill('#tasks-type-name-input', 'Hobby');
    await page.click('#tasks-type-modal >> text=Save');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('expense-tracker.tasks.v2')).types.map(t => t.name));
    expect(saved).toContain('Hobby');
  });
});
