/**
 * Shared helpers for the Tasks/Targets specs.
 * Tasks are seeded through the app's own normalizer, so specs only spell
 * out the fields they care about. A periodKey may be a token such as
 * '@week:-1' (= last week) which is resolved inside the page, so tests
 * never hard-code dates.
 */
'use strict';

const { expect } = require('@playwright/test');
const { loadApp } = require('../helpers/setup');

/** Skip Google sign-in: reveal the shell exactly as enterMainApp() does. */
async function showApp(page) {
  await page.evaluate(() => {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
  });
}

/**
 * Boot the app with a known Tasks state.
 * @param {{ tasks?: object[], planned?: boolean, extra?: object }} opts
 *   planned=true (default) marks week/month/year as already planned, so
 *   the planning overlay stays out of the way of UI specs.
 */
async function bootTasks(page, { tasks = [], planned = true, extra = {} } = {}) {
  page.on('dialog', d => d.accept());
  await loadApp(page);
  await showApp(page);
  await page.evaluate(({ tasks, planned, extra }) => {
    const resolve = key => {
      const m = /^@(\w+):(-?\d+)$/.exec(key || '');
      return m ? tasksShiftPeriod(m[1], tasksCurrentPeriod(m[1]), Number(m[2])) : key;
    };
    const state = tasksNormalizeState({
      ...extra,
      tasks: tasks.map((t, i) => ({
        id: `t${i}`,
        ...t,
        periodKey: resolve(t.periodKey),
        carriedFrom: (t.carriedFrom || []).map(resolve),
      })),
    });
    if (planned) {
      for (const h of ['week', 'month', 'year']) state.planning.prompted[h] = tasksCurrentPeriod(h);
    }
    tasksState = state;
    saveTasksLocal();
    renderTasks();
  }, { tasks, planned, extra });
}

async function goToTasks(page) {
  await page.click('#nav-tasks');
  await expect(page.locator('#view-tasks')).toHaveClass(/active/);
}

/** Add a task through the modal. */
async function addTask(page, { title, horizon, status, reason, parent } = {}) {
  await page.click('#view-tasks [data-action="add"]');
  await page.fill('#tasks-form-title', title);
  if (horizon) await page.selectOption('#tasks-form-horizon', horizon);
  if (status) await page.selectOption('#tasks-form-status', status);
  if (reason) await page.fill('#tasks-form-reason', reason);
  if (parent) await page.selectOption('#tasks-form-parent', { label: parent });
  await page.click('#tasks-form-modal >> text=Save');
}

const rowTitles = page => page.locator('.tasks-item-title').allTextContents();
const row = (page, title) => page.locator('.tasks-item', { hasText: title });
const chip = (page, name) => page.locator('#tasks-horizon-bar .savings-pot-chip', { hasText: name });

module.exports = { showApp, bootTasks, goToTasks, addTask, rowTitles, row, chip };
