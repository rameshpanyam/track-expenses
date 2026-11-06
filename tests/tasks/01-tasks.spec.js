/**
 * Tasks module — behaviour tests.
 * Drives the real UI (clicks, typing) wherever practical.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { loadApp } = require('../helpers/setup');

/* ── helpers ─────────────────────────────────────────────────────── */
const isoDay = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Skip Google sign-in: reveal the main shell exactly as enterMainApp() does. */
async function showApp(page) {
  await page.evaluate(() => {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
  });
}

async function goToTasks(page) {
  await showApp(page);
  await page.click('#nav-tasks');
  await expect(page.locator('#view-tasks')).toHaveClass(/active/);
}

/** Add a task through the modal. */
async function addTask(page, { title, start = isoDay(0), end = isoDay(7), type = '' }) {
  await page.click('text=+ Add Task');
  await page.fill('#tasks-form-title', title);
  await page.fill('#tasks-form-start', start);
  await page.fill('#tasks-form-end', end);
  if (type) await page.selectOption('#tasks-form-type', { label: type });
  await page.click('#tasks-form-modal >> text=Save');
}

const rowTitles = page => page.locator('.tasks-item-title').allTextContents();
const chip = (page, name) => page.locator('#tasks-type-bar .savings-pot-chip', { hasText: name });

test.beforeEach(async ({ page }) => {
  page.on('dialog', d => d.accept());
  await loadApp(page);
  await goToTasks(page);
});

/* ── navigation + seeding ────────────────────────────────────────── */
test('Tasks is a 6th tab and opens its view', async ({ page }) => {
  await expect(page.locator('.bottom-nav .nav-btn:visible')).toHaveCount(5); // insights tab is hidden
  await expect(page.locator('#nav-tasks')).toHaveClass(/active/);
  await expect(page.locator('#header-month-label')).toContainText('Tasks');
});

test('seeds Short-term, Long-term and Personal types', async ({ page }) => {
  const names = await page.locator('#tasks-type-bar .savings-pot-chip-name').allTextContents();
  expect(names).toEqual(['All', 'Short-term', 'Long-term', 'Personal']);
  await expect(page.locator('#tasks-list')).toContainText('No tasks yet');
});

/* ── validation ──────────────────────────────────────────────────── */
test('rejects empty title, missing end date, and end before start', async ({ page }) => {
  await page.click('text=+ Add Task');

  await page.click('#tasks-form-modal >> text=Save');
  await expect(page.locator('#toast')).toContainText('Enter a task title');

  await page.fill('#tasks-form-title', 'Pay rent');
  await page.click('#tasks-form-modal >> text=Save');
  await expect(page.locator('#toast')).toContainText('Pick a start and end date');

  await page.fill('#tasks-form-start', isoDay(5));
  await page.fill('#tasks-form-end', isoDay(2));
  await page.click('#tasks-form-modal >> text=Save');
  await expect(page.locator('#toast')).toContainText('End date');

  // Nothing was saved and the modal is still open
  await expect(page.locator('#tasks-form-modal')).toBeVisible();
  expect(await page.evaluate(() => tasksState.tasks.length)).toBe(0);
});

/* ── add / sort ──────────────────────────────────────────────────── */
test('adds tasks and sorts them by end date, soonest first', async ({ page }) => {
  await addTask(page, { title: 'Later',  end: isoDay(30) });
  await addTask(page, { title: 'Soonest', end: isoDay(2) });
  await addTask(page, { title: 'Middle', end: isoDay(10) });
  expect(await rowTitles(page)).toEqual(['Soonest', 'Middle', 'Later']);
});

test('escapes HTML in task titles', async ({ page }) => {
  await addTask(page, { title: '<img src=x onerror="window.__pwned=1">' });
  await expect(page.locator('.tasks-item-title')).toContainText('<img src=x');
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
});

/* ── completion ──────────────────────────────────────────────────── */
test('marking complete strikes through, stays listed, and is reversible', async ({ page }) => {
  await addTask(page, { title: 'Buy laptop' });
  const check = page.locator('.tasks-check');
  const item  = page.locator('.tasks-item');

  await expect(page.locator('#tasks-hero')).toContainText('0 / 1 done');
  await check.click();
  await expect(check).toHaveAttribute('aria-checked', 'true');
  await expect(item).toHaveClass(/done/);
  await expect(item).toHaveCount(1);                       // still in the list
  await expect(page.locator('#tasks-hero')).toContainText('1 / 1 done');
  await expect(page.locator('#tasks-hero')).toContainText('100% complete');
  await expect(page.locator('.tasks-item-title')).toHaveCSS('text-decoration-line', 'line-through');

  await check.click();                                      // untick
  await expect(item).not.toHaveClass(/done/);
  await expect(page.locator('#tasks-hero')).toContainText('0 / 1 done');
});

test('ticking the checkbox does not open the edit modal', async ({ page }) => {
  await addTask(page, { title: 'Quick one' });
  await page.locator('.tasks-check').click();
  await expect(page.locator('#tasks-form-modal')).toBeHidden();
});

/* ── overdue ─────────────────────────────────────────────────────── */
test('flags overdue tasks only while incomplete', async ({ page }) => {
  await addTask(page, { title: 'Late one', start: isoDay(-10), end: isoDay(-1) });
  await addTask(page, { title: 'On time', start: isoDay(0), end: isoDay(3) });

  const late = page.locator('.tasks-item', { hasText: 'Late one' });
  await expect(late).toHaveClass(/overdue/);
  await expect(late.locator('.tasks-overdue-tag')).toBeVisible();
  await expect(page.locator('.tasks-item', { hasText: 'On time' })).not.toHaveClass(/overdue/);

  await late.locator('.tasks-check').click();               // complete it
  await expect(late).not.toHaveClass(/overdue/);
});

test('a task ending today is not overdue', async ({ page }) => {
  await addTask(page, { title: 'Due today', start: isoDay(0), end: isoDay(0) });
  await expect(page.locator('.tasks-item')).not.toHaveClass(/overdue/);
});

/* ── types ───────────────────────────────────────────────────────── */
test('type chips filter the list and scope the hero', async ({ page }) => {
  await addTask(page, { title: 'Call plumber', type: 'Short-term' });
  await addTask(page, { title: 'Buy a house', type: 'Long-term' });
  await addTask(page, { title: 'Yoga',        type: 'Personal' });
  await page.locator('.tasks-item', { hasText: 'Yoga' }).locator('.tasks-check').click();

  await expect(page.locator('#tasks-hero')).toContainText('1 / 3 done');

  await chip(page, 'Long-term').click();
  expect(await rowTitles(page)).toEqual(['Buy a house']);
  await expect(page.locator('#tasks-hero')).toContainText('LONG-TERM');
  await expect(page.locator('#tasks-hero')).toContainText('0 / 1 done');
  await expect(page.locator('#tasks-section-label')).toHaveText('Long-term tasks');

  await chip(page, 'Personal').click();
  await expect(page.locator('#tasks-hero')).toContainText('1 / 1 done');

  await chip(page, 'All').click();
  expect(await rowTitles(page)).toHaveLength(3);
});

test('new task pre-selects the active type', async ({ page }) => {
  await chip(page, 'Personal').click();
  await page.click('text=+ Add Task');
  expect(await page.locator('#tasks-form-type').inputValue()).toBe('type_personal');
});

test('create, reject duplicate, rename a type', async ({ page }) => {
  await page.click('text=+ New');
  await page.fill('#tasks-type-name-input', 'Work');
  await page.click('#tasks-type-modal >> text=Save');
  await expect(chip(page, 'Work')).toBeVisible();

  await page.click('text=+ New');
  await page.fill('#tasks-type-name-input', 'work');       // case-insensitive dup
  await page.click('#tasks-type-modal >> text=Save');
  await expect(page.locator('#toast')).toContainText('already exists');
  await page.click('#tasks-type-modal >> text=Cancel');

  await chip(page, 'Work').locator('.savings-pot-edit-btn').click();
  await page.fill('#tasks-type-name-input', 'Office');
  await page.click('#tasks-type-modal >> text=Save');
  await expect(chip(page, 'Office')).toBeVisible();
  await expect(chip(page, 'Work')).toHaveCount(0);
});

test('deleting a type keeps its tasks as Unassigned', async ({ page }) => {
  await addTask(page, { title: 'Orphan me', type: 'Short-term' });
  await chip(page, 'Short-term').click();                   // make it the active filter

  await chip(page, 'Short-term').locator('.savings-pot-edit-btn').click();
  await page.click('#tasks-type-delete-btn');

  await expect(chip(page, 'Short-term')).toHaveCount(0);
  // Falls back to the All view, and the task survived
  await expect(chip(page, 'All')).toHaveClass(/active/);
  const row = page.locator('.tasks-item', { hasText: 'Orphan me' });
  await expect(row).toBeVisible();
  await expect(row.locator('.unassigned')).toHaveText('Unassigned');
});

/* ── edit / delete task ──────────────────────────────────────────── */
test('edits and deletes a task', async ({ page }) => {
  await addTask(page, { title: 'Draft' });
  await page.locator('.tasks-item').click();
  await page.fill('#tasks-form-title', 'Final');
  await page.click('#tasks-form-modal >> text=Save');
  expect(await rowTitles(page)).toEqual(['Final']);

  await page.locator('.tasks-item').click();
  await page.click('#tasks-form-delete');
  await expect(page.locator('#tasks-list')).toContainText('No tasks yet');
});

/* ── persistence ─────────────────────────────────────────────────── */
test('persists across reload; deleted default type does not come back', async ({ page }) => {
  await addTask(page, { title: 'Survivor', type: 'Personal' });
  await chip(page, 'Long-term').locator('.savings-pot-edit-btn').click();
  await page.click('#tasks-type-delete-btn');

  await page.reload();
  await page.waitForFunction(() => typeof window.renderTasks === 'function');
  await goToTasks(page);

  expect(await rowTitles(page)).toEqual(['Survivor']);
  await expect(chip(page, 'Long-term')).toHaveCount(0);
  await expect(chip(page, 'Personal')).toBeVisible();
});

/* ── Google Sheets sync (stubbed transport) ──────────────────────── */
test('loadTasksFromSheet maps rows into state (sheet wins)', async ({ page }) => {
  await page.evaluate(async () => {
    window.spreadsheetId = 'sheet123';
    window.accessToken   = 'token';
    window.getCachedSheetMeta = async () => ({
      sheets: [{ properties: { title: 'Tasks' } }, { properties: { title: 'TaskTypes' } }],
    });
    const tasksHdr = ['ID','Title','StartDate','EndDate','Completed','CompletedAt','CreatedAt','UpdatedAt','TypeId','TypeName'];
    const typesHdr = ['ID','Name','CreatedAt'];
    window.sheetsRequest = async (method, url) => {
      if (url.includes('TaskTypes!A1:C1')) return { values: [typesHdr] };
      if (url.includes('Tasks!A1:J1'))     return { values: [tasksHdr] };
      if (url.includes('TaskTypes!A:C'))   return { values: [typesHdr, ['t1', 'Work', '2026-01-01']] };
      if (url.includes('Tasks!A:J')) return { values: [tasksHdr,
        ['k1', 'Ship it', '2026-02-01', '2026-02-09', 'TRUE',  '2026-02-05', '', '', 't1', 'Work'],
        ['k2', 'Relax',   '2026-03-01', '2026-03-09', 'FALSE', '',           '', '', '',   ''],
      ] };
      return {};
    };
    await window.loadTasksFromSheet();
    window.renderTasks();
  });

  const state = await page.evaluate(() => tasksState);
  expect(state.types).toEqual([{ id: 't1', name: 'Work', createdAt: '2026-01-01' }]);
  expect(state.tasks.map(t => [t.id, t.completed, t.typeId]))
    .toEqual([['k1', true, 't1'], ['k2', false, null]]);
  await expect(page.locator('#tasks-hero')).toContainText('1 / 2 done');
});

test('first sign-in with an empty sheet keeps local data and pushes it up', async ({ page }) => {
  const writes = await page.evaluate(async () => {
    const puts = [];
    window.spreadsheetId = 'sheet123';
    window.accessToken   = 'token';
    window.getCachedSheetMeta = async () => ({
      sheets: [{ properties: { title: 'Tasks' } }, { properties: { title: 'TaskTypes' } }],
    });
    window.sheetsRequest = async (method, url, body) => {
      if (method === 'GET' && url.includes('!A1:')) {
        return { values: [Array(url.includes('TaskTypes') ? 3 : 10).fill('h')] };
      }
      if (method === 'GET') return { values: [] };             // empty sheet
      if (method === 'PUT') puts.push({ url, body });
      return {};
    };
    await window.loadTasksFromSheet();
    return puts;
  });

  expect((await page.evaluate(() => tasksState.types)).map(t => t.name))
    .toEqual(['Short-term', 'Long-term', 'Personal']);
  const typePut = writes.find(w => w.url.includes('TaskTypes!A2:C4'));
  expect(typePut.body.values.map(r => r[1])).toEqual(['Short-term', 'Long-term', 'Personal']);
});
