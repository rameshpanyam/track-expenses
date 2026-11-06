/* ═══════════════════════════════════════════════════════════════════
   TASKS · INSIGHTS  (v31.0)
   Stats modal: streak, completion history (8 weeks / 6 months),
   saved reflections, and the two settings (weekly cap, streak %).
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

const TASKS_HISTORY_WEEKS  = 8;
const TASKS_HISTORY_MONTHS = 6;
const TASKS_SETTING_LIMITS = {
  weeklyCap: { min: 1,  max: 50  },
  streakPct: { min: 10, max: 100 },
};

function tasksHistoryRowHTML(row) {
  const { done, total, pct } = row.stats;
  const note = row.skipped && !total ? '<span class="tasks-skip-tag">skipped planning</span>' : '';
  const score = total ? `${done}/${total} &middot; ${pct}%` : '&mdash;';
  return `
    <div class="tasks-hist-row">
      <div class="tasks-hist-top">
        <span class="tasks-hist-label">${escapeHTML(row.label)}</span>
        <span class="tasks-hist-score">${score}</span>
      </div>
      <div class="tasks-hist-bar" aria-hidden="true"><div class="tasks-hist-fill" style="width:${pct}%"></div></div>
      ${note}
      ${row.reflection ? `<div class="tasks-hist-note">&ldquo;${escapeHTML(row.reflection)}&rdquo;</div>` : ''}
    </div>`;
}

function tasksHistorySectionHTML(title, horizon, count) {
  return `
    <p class="tasks-plan-group">${title}</p>
    ${tasksHistory(horizon, count).map(tasksHistoryRowHTML).join('')}`;
}

function tasksSettingFieldHTML(id, label, value) {
  const { min, max } = TASKS_SETTING_LIMITS[id];
  return `
    <label class="savings-form-label" for="tasks-setting-${id}">${label}</label>
    <input id="tasks-setting-${id}" class="savings-form-note" type="number" inputmode="numeric"
           min="${min}" max="${max}" value="${value}" data-setting="${id}" />`;
}

function tasksStreakHTML() {
  return `&#128293; ${tasksWeeklyStreak()}-week streak
    <span class="tasks-plan-meta">weeks with at least ${tasksState.settings.streakPct}% of tasks done</span>`;
}

function renderTasksInsights() {
  const { settings } = tasksState;
  tasksEl('tasks-insights-body').innerHTML = `
    <p class="tasks-plan-summary" id="tasks-insights-streak">${tasksStreakHTML()}</p>
    ${tasksHistorySectionHTML('Weekly', 'week', TASKS_HISTORY_WEEKS)}
    ${tasksHistorySectionHTML('Monthly', 'month', TASKS_HISTORY_MONTHS)}
    <p class="tasks-plan-group">Settings</p>
    ${tasksSettingFieldHTML('weeklyCap', 'Max tasks per week (warns above this)', settings.weeklyCap)}
    ${tasksSettingFieldHTML('streakPct', 'Streak target: % of week done', settings.streakPct)}`;
}

function openTasksInsights() {
  if (!tasksState) loadTasksState();
  renderTasksInsights();
  tasksEl('tasks-insights-modal').style.display = 'flex';
}

function closeTasksInsights() {
  tasksEl('tasks-insights-modal').style.display = 'none';
  renderTasks();   // settings may have changed the hero streak
}

/** Clamp to the allowed range; ignore blanks / non-numbers. */
function saveTasksSetting(id, rawValue) {
  const limits = TASKS_SETTING_LIMITS[id];
  const value  = Math.round(Number(rawValue));
  if (!limits || !Number.isFinite(value)) return;
  tasksState.settings[id] = Math.min(limits.max, Math.max(limits.min, value));
  saveTasksState();
  const streakEl = tasksEl('tasks-insights-streak');
  if (streakEl) streakEl.innerHTML = tasksStreakHTML();
}

function initTasksInsights() {
  const body = tasksEl('tasks-insights-body');
  if (!body) return;
  body.addEventListener('change', event => {
    const id = event.target.dataset.setting;
    if (id) saveTasksSetting(id, event.target.value);
  });
}
