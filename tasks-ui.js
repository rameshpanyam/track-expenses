/* ═══════════════════════════════════════════════════════════════════
   TASKS · VIEW  (v31.0)
   Renders the Tasks tab: hero, horizon chips, period navigator, rows.
   One delegated click listener drives every dynamic control.

   Reuses from app.js: escapeHTML.  Reuses the generic .savings-* rules
   in style.css for hero / chips / buttons / empty state.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

var tasksActiveHorizon = 'week';
var tasksViewKeys      = {};   // horizon → period key being browsed (default: current)

function tasksViewKey(horizon) {
  return tasksHasPeriod(horizon) ? (tasksViewKeys[horizon] || tasksCurrentPeriod(horizon)) : '';
}

function tasksEl(id) { return document.getElementById(id); }

/** Autofocus `target` after the open animation — but ONLY if the user (or
 *  a screen reader) hasn't already moved focus somewhere inside `container`.
 *  A blind setTimeout(focus) would yank focus back and eat keystrokes. */
function tasksFocusIfIdle(container, target, delayMs = 80) {
  setTimeout(() => {
    if (!container.contains(document.activeElement)) target.focus();
  }, delayMs);
}

/* ═══════════════════════════════════════════════════════════════════
   RENDER
   ═══════════════════════════════════════════════════════════════════ */
function renderTasks() {
  if (!tasksState) loadTasksState();
  renderTasksHero();
  renderTasksHorizonBar();
  renderTasksPeriodNav();
  renderTasksList();
}

function tasksHeroDetails(stats, horizon) {
  const parts = [`${stats.pct}% complete`];
  if (stats.counts.inprogress) parts.push(`${stats.counts.inprogress} in progress`);
  if (stats.counts.blocked)    parts.push(`${stats.counts.blocked} blocked`);
  if (stats.moved)             parts.push(`${stats.moved} moved on`);
  if (horizon === 'week') {
    const streak = tasksWeeklyStreak();
    if (streak > 0) parts.push(`&#128293; ${streak}-week streak`);
  }
  return parts.join(' &middot; ');
}

function renderTasksHero() {
  const el = tasksEl('tasks-hero');
  if (!el) return;
  const horizon = tasksActiveHorizon;
  const key     = tasksViewKey(horizon);
  const stats   = tasksPeriodStats(horizon, key);
  const label   = tasksHasPeriod(horizon)
    ? `${tasksPeriodName(horizon, key)} \u00B7 ${tasksPeriodLabel(horizon, key)}`
    : 'Long-term targets';
  el.innerHTML = `
    <div class="savings-hero-label">${escapeHTML(label.toUpperCase())}</div>
    <div class="savings-hero-amount">${stats.done} / ${stats.total} done</div>
    <div class="tasks-progress" role="progressbar" aria-label="Targets completed"
         aria-valuemin="0" aria-valuemax="100" aria-valuenow="${stats.pct}">
      <div class="tasks-progress-fill" style="width:${stats.pct}%"></div>
    </div>
    <div class="tasks-progress-label">${tasksHeroDetails(stats, horizon)}</div>`;
}

function renderTasksHorizonBar() {
  const el = tasksEl('tasks-horizon-bar');
  if (!el) return;
  el.innerHTML = TASKS_HORIZONS.map(h => {
    const { done, total } = tasksPeriodStats(h.id, tasksCurrentPeriod(h.id));
    return `
      <button class="savings-pot-chip${h.id === tasksActiveHorizon ? ' active' : ''}"
              data-action="horizon" data-id="${h.id}">
        <span class="savings-pot-chip-name">${h.label}</span>
        <span class="savings-pot-chip-bal">${done}/${total}</span>
      </button>`;
  }).join('');
}

function renderTasksPeriodNav() {
  const el = tasksEl('tasks-period-nav');
  if (!el) return;
  const horizon = tasksActiveHorizon;
  el.hidden = !tasksHasPeriod(horizon);
  if (el.hidden) return;

  const noun = tasksHorizon(horizon).noun;
  const key  = tasksViewKey(horizon);
  el.innerHTML = `
    <button class="tasks-nav-btn" data-action="period-prev" aria-label="Previous ${noun}">&lsaquo;</button>
    <button class="tasks-nav-now" data-action="period-now" aria-label="Jump to this ${noun}">
      ${escapeHTML(tasksPeriodName(horizon, key))}
      <span class="tasks-nav-range">${escapeHTML(tasksPeriodLabel(horizon, key))}</span>
    </button>
    <button class="tasks-nav-btn" data-action="period-next" aria-label="Next ${noun}">&rsaquo;</button>`;
}

function tasksTagsHTML(task) {
  const tags = [`<span class="tasks-status st-${task.status}">${tasksStatusLabel(task.status)}</span>`];
  const carries = tasksCarryCount(task);
  if (carries) {
    const hot = carries >= TASKS_NUDGE_AFTER_CARRIES && tasksIsOpen(task);
    tags.push(`<span class="tasks-carry-tag${hot ? ' hot' : ''}" title="Carried over ${carries} time(s)">&#8635; ${carries}&times;</span>`);
  }
  const parent = tasksById(task.parentId);
  if (parent) tags.push(`<span class="tasks-link-tag">&uarr; ${escapeHTML(parent.title)}</span>`);

  const childHorizon = TASKS_CHILD_HORIZON[task.horizon];
  const kids = childHorizon ? tasksChildProgress(task) : null;
  if (kids && kids.total) {
    tags.push(`<span class="tasks-link-tag">${kids.done}/${kids.total} ${tasksHorizon(childHorizon).label.toLowerCase()}</span>`);
  }
  return tags.join('');
}

function tasksRowHTML(task) {
  const title   = escapeHTML(task.title);
  const done    = task.status === 'completed';
  const classes = ['tasks-item', `st-${task.status}`].join(' ');
  const reason  = task.status === 'blocked' && task.blockedReason
    ? `<div class="tasks-blocked-reason">Blocked: ${escapeHTML(task.blockedReason)}</div>` : '';

  return `
    <div class="${classes}" data-action="edit" data-id="${escapeHTML(task.id)}">
      <button type="button" class="tasks-check" role="checkbox" aria-checked="${done}"
              aria-label="${done ? 'Mark not done' : 'Mark done'}: ${title}"
              data-action="toggle" data-id="${escapeHTML(task.id)}"></button>
      <div class="tasks-item-meta">
        <div class="tasks-item-title">${title}</div>
        <div class="tasks-item-tags">${tasksTagsHTML(task)}</div>
        ${reason}
      </div>
    </div>`;
}

function tasksEmptyHTML(horizon, key) {
  const h = tasksHorizon(horizon);
  const where = tasksHasPeriod(horizon) ? tasksPeriodName(horizon, key).toLowerCase() : 'long-term';
  return `
    <div class="savings-empty">
      <div class="savings-empty-icon">&#127919;</div>
      <div class="savings-empty-title">No ${h.label.toLowerCase()} tasks for ${escapeHTML(where)}</div>
      <div class="savings-empty-sub">Tap <strong>+ Add Task</strong> above to set your first one.</div>
    </div>`;
}

function renderTasksList() {
  const el = tasksEl('tasks-list');
  if (!el) return;
  const horizon = tasksActiveHorizon;
  const key     = tasksViewKey(horizon);
  const tasks   = tasksSorted(tasksOfPeriod(horizon, key));

  const labelEl = tasksEl('tasks-section-label');
  if (labelEl) labelEl.textContent = `${tasksHorizon(horizon).label} tasks`;

  el.innerHTML = tasks.length
    ? `<div class="tasks-items">${tasks.map(tasksRowHTML).join('')}</div>`
    : tasksEmptyHTML(horizon, key);
}

/* ═══════════════════════════════════════════════════════════════════
   ACTIONS
   ═══════════════════════════════════════════════════════════════════ */
function setTasksHorizon(horizon) {
  if (!tasksHorizon(horizon)) return;
  tasksActiveHorizon = horizon;
  renderTasks();
}

function shiftTasksViewPeriod(delta) {
  const h = tasksActiveHorizon;
  tasksViewKeys[h] = tasksShiftPeriod(h, tasksViewKey(h), delta);
  renderTasks();
}

function resetTasksViewPeriod() {
  delete tasksViewKeys[tasksActiveHorizon];
  renderTasks();
}

function toggleTaskCompleted(id) {
  const task = tasksById(id);
  if (!task) return;
  tasksChangeStatus(id, task.status === 'completed' ? 'todo' : 'completed');
  renderTasks();
}

const TASKS_ACTIONS = {
  'toggle':      id => toggleTaskCompleted(id),
  'edit':        id => openTasksEditModal(id),
  'horizon':     id => setTasksHorizon(id),
  'period-prev': ()  => shiftTasksViewPeriod(-1),
  'period-next': ()  => shiftTasksViewPeriod(1),
  'period-now':  ()  => resetTasksViewPeriod(),
  'add':         ()  => openTasksAddModal(),
  'stats':       ()  => openTasksInsights(),
};

function handleTasksViewClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const handler = TASKS_ACTIONS[target.dataset.action];
  if (!handler) return;
  event.stopPropagation(); // checkbox sits inside the clickable row
  handler(target.dataset.id || null);
}

function initTasksView() {
  const view = tasksEl('view-tasks');
  if (view) view.addEventListener('click', handleTasksViewClick);
}
