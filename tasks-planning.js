/* ═══════════════════════════════════════════════════════════════════
   TASKS · PLANNING PROMPT  (v31.0)
   Full-screen "plan your week / month / year" overlay, shown on the
   first open of each new period. Three exits:
     Done planning → needs at least one task, marks the period planned
     Skip          → marks it planned AND records that you skipped
     Later         → snoozes for this session only (asked again next open)

   For a new period it also shows a REVIEW of the previous one:
   score, leftovers (Carry / Done / Drop) and a one-line reflection.
   In the monthly prompt, open long-term tasks get a check-in too.

   If several periods are due at once (e.g. 1 January) they are asked
   in order: year → month → week.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

const TASKS_PLAN_ORDER = ['year', 'month', 'week'];

var tasksPlanHorizon = null;          // horizon being planned, null = overlay closed
var tasksSnoozed     = new Set();     // horizons snoozed this session
var tasksPlanReview  = null;          // { key, stats } of the previous period, if shown

/* ─── When is a prompt due? ──────────────────────────────────────── */
function tasksAppVisible() {
  const app = tasksEl('app');
  return !!app && getComputedStyle(app).display !== 'none';
}

function tasksPendingPlans() {
  return TASKS_PLAN_ORDER.filter(h =>
    tasksState.planning.prompted[h] !== tasksCurrentPeriod(h) && !tasksSnoozed.has(h));
}

function checkTasksPlanning() {
  if (!tasksState) loadTasksState();
  if (tasksPlanHorizon || !tasksAppVisible()) return;
  const next = tasksPendingPlans()[0];
  if (next) openTasksPlanning(next);
}

/* ─── Review of the previous period ──────────────────────────────── */
function tasksReviewSummaryHTML(stats, horizon) {
  const noun = tasksHorizon(horizon).noun;
  const parts = [`${stats.done} of ${stats.total} done (${stats.pct}%)`];
  if (stats.moved)          parts.push(`${stats.moved} moved on`);
  if (stats.counts.blocked) parts.push(`${stats.counts.blocked} blocked`);
  if (horizon === 'week') {
    const streak = tasksWeeklyStreak();
    parts.push(streak > 0 ? `&#128293; ${streak}-week streak` : 'streak at 0');
  }
  return `<p class="tasks-plan-summary">Last ${noun}: ${parts.join(' &middot; ')}</p>`;
}

function tasksCheckInRows(horizon) {
  const rows = tasksLeftovers(horizon).map(t => ({ task: t, canCarry: true }));
  if (horizon === 'month') {
    for (const t of tasksState.tasks) {
      if (t.horizon === 'long' && tasksIsOpen(t)) rows.push({ task: t, canCarry: false });
    }
  }
  return rows;
}

function tasksPlanRowHTML({ task, canCarry }) {
  const id = escapeHTML(task.id);
  const carries = tasksCarryCount(task);
  const meta = [
    carries ? `&#8635; ${carries}&times;` : '',
    task.status === 'blocked' && task.blockedReason ? `Blocked: ${escapeHTML(task.blockedReason)}` : '',
  ].filter(Boolean).join(' &middot; ');
  return `
    <div class="tasks-plan-row">
      <div class="tasks-plan-row-text">
        <div class="tasks-item-title">${escapeHTML(task.title)}</div>
        ${meta ? `<div class="tasks-plan-meta">${meta}</div>` : ''}
      </div>
      <div class="tasks-plan-row-actions">
        ${canCarry ? `<button type="button" class="tasks-plan-btn" data-plan="carry" data-id="${id}">Carry &rarr;</button>` : ''}
        <button type="button" class="tasks-plan-btn" data-plan="done" data-id="${id}">Done</button>
        <button type="button" class="tasks-plan-btn" data-plan="drop" data-id="${id}">Drop</button>
      </div>
    </div>`;
}

function renderTasksPlanLeftovers() {
  const el = tasksEl('tasks-plan-leftovers');
  if (!el) return;
  const rows = tasksCheckInRows(tasksPlanHorizon);
  const left = rows.filter(r => r.canCarry);
  const long = rows.filter(r => !r.canCarry);
  const group = (title, list) => list.length
    ? `<p class="tasks-plan-group">${title}</p>${list.map(tasksPlanRowHTML).join('')}` : '';
  el.innerHTML = group('Unfinished from before', left) + group('Long-term check-in', long);
}

/* ─── The plan itself ────────────────────────────────────────────── */
function tasksPlanCounterHTML(horizon, key) {
  const n = tasksPlannedCount(horizon, key);
  if (horizon !== 'week') return `${n} planned`;
  const cap = tasksState.settings.weeklyCap;
  return n > cap
    ? `<span class="tasks-plan-over">${n} / ${cap} planned &mdash; that is a lot. Are you overloading yourself?</span>`
    : `${n} / ${cap} planned`;
}

function renderTasksPlanList() {
  const h   = tasksPlanHorizon;
  const key = tasksCurrentPeriod(h);
  const list = tasksSorted(tasksOfPeriod(h, key).filter(t => t.status !== 'dropped'));
  tasksEl('tasks-plan-counter').innerHTML = tasksPlanCounterHTML(h, key);
  tasksEl('tasks-plan-list').innerHTML = list.map(t => `
    <div class="tasks-plan-row">
      <div class="tasks-plan-row-text">
        <div class="tasks-item-title">${escapeHTML(t.title)}</div>
        ${tasksCarryCount(t) ? `<div class="tasks-plan-meta">&#8635; carried ${tasksCarryCount(t)}&times;</div>` : ''}
      </div>
      <button type="button" class="tasks-plan-btn" data-plan="remove" data-id="${escapeHTML(t.id)}"
              aria-label="Remove ${escapeHTML(t.title)}">&#10005;</button>
    </div>`).join('');
}

function tasksPlanFrameHTML(h, key, parents, showReview) {
  const noun = tasksHorizon(h).noun;
  const reflect = showReview ? `
    <label class="savings-form-label" for="tasks-plan-reflection">One line: how did last ${noun} go?</label>
    <input id="tasks-plan-reflection" class="savings-form-note" type="text" maxlength="200" autocomplete="off"
           placeholder="What worked, what got in the way&hellip;" />` : '';
  const parentSel = parents.length ? `
    <select id="tasks-plan-parent" class="savings-form-pot-select" aria-label="Part of (optional)">
      <option value="">Part of&hellip; (optional)</option>
      ${parents.map(p => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.title)}</option>`).join('')}
    </select>` : '';

  return `
    <div class="tasks-plan-sheet" role="dialog" aria-modal="true" aria-labelledby="tasks-plan-title">
      <h2 id="tasks-plan-title" class="tasks-plan-title">Plan your ${noun}</h2>
      <p class="tasks-plan-sub">${escapeHTML(tasksPeriodLabel(h, key))}</p>
      ${showReview ? `<section class="tasks-plan-section" aria-label="Review">
        ${tasksPlanReview.summaryHTML}
        <div id="tasks-plan-leftovers"></div>
        ${reflect}
      </section>` : ''}
      <section class="tasks-plan-section" aria-label="Plan">
        <p class="tasks-plan-group">This ${noun}</p>
        <div id="tasks-plan-counter" class="tasks-plan-counter" aria-live="polite"></div>
        <div id="tasks-plan-list"></div>
        <div class="tasks-plan-add">
          <input id="tasks-plan-input" class="savings-form-note" type="text" maxlength="120"
                 autocomplete="off" aria-label="New task" placeholder="Add a task&hellip;" />
          ${parentSel}
          <button type="button" class="tasks-plan-add-btn" data-plan="add">Add</button>
        </div>
      </section>
      <div class="tasks-plan-footer">
        <button type="button" class="confirm-ok" data-plan="finish">Done planning</button>
        <button type="button" class="confirm-cancel" data-plan="skip">Skip this ${noun}</button>
        <button type="button" class="tasks-plan-later" data-plan="later">Later</button>
      </div>
    </div>`;
}

/* ─── Open / close ───────────────────────────────────────────────── */
function openTasksPlanning(horizon) {
  const key     = tasksCurrentPeriod(horizon);
  const prevKey = tasksShiftPeriod(horizon, key, -1);
  const stats   = tasksPeriodStats(horizon, prevKey);
  const showReview = stats.total > 0 || tasksCheckInRows(horizon).length > 0;

  tasksPlanHorizon = horizon;
  tasksPlanReview  = showReview
    ? { key: prevKey, stats, summaryHTML: stats.total ? tasksReviewSummaryHTML(stats, horizon) : '' }
    : null;

  const parents = tasksParentCandidates(horizon, key);
  const overlay = tasksEl('tasks-planning');
  overlay.innerHTML = tasksPlanFrameHTML(horizon, key, parents, showReview);
  overlay.hidden = false;
  renderTasksPlanLeftovers();
  renderTasksPlanList();
  tasksFocusIfIdle(overlay, tasksEl('tasks-plan-input'));
}

function closeTasksPlanning() {
  tasksPlanHorizon = null;
  tasksPlanReview  = null;
  tasksEl('tasks-planning').hidden = true;
  tasksEl('tasks-planning').innerHTML = '';
  renderTasks();
  checkTasksPlanning();           // chain: next period that is due, if any
}

function tasksSaveReview(horizon) {
  const input = tasksEl('tasks-plan-reflection');
  if (!tasksPlanReview || !input) return;
  const { key, stats } = tasksPlanReview;
  const reflection = input.value.trim();
  if (!stats.total && !reflection) return;   // nothing worth recording
  tasksState.reviews = tasksState.reviews.filter(r => !(r.horizon === horizon && r.periodKey === key));
  tasksState.reviews.push({
    horizon, periodKey: key, reflection,
    done: stats.done, total: stats.total, pct: stats.pct, createdAt: new Date().toISOString(),
  });
}

function finishTasksPlanning(skipped) {
  const h   = tasksPlanHorizon;
  const key = tasksCurrentPeriod(h);
  if (!skipped && tasksPlannedCount(h, key) === 0) {
    return tasksNotify('Add at least one task, or choose Skip', true);
  }
  tasksSaveReview(h);
  tasksState.planning.prompted[h] = key;
  if (skipped) tasksState.planning.skipped.push(`${h}:${key}`);
  saveTasksState();
  closeTasksPlanning();
}

function snoozeTasksPlanning() {
  tasksSnoozed.add(tasksPlanHorizon);
  closeTasksPlanning();
}

/* ─── Overlay actions ────────────────────────────────────────────── */
function addTasksPlanTask() {
  const input = tasksEl('tasks-plan-input');
  const title = input.value.trim();
  if (!title) return tasksNotify('Type a task first', true);
  const parent = tasksEl('tasks-plan-parent');
  tasksAdd({
    title, horizon: tasksPlanHorizon, periodKey: tasksCurrentPeriod(tasksPlanHorizon),
    parentId: parent && parent.value ? parent.value : null,
  });
  input.value = '';
  renderTasksPlanList();
  input.focus();
}

function runTasksPlanAction(action, id) {
  const cur = tasksCurrentPeriod(tasksPlanHorizon);
  const refresh = () => { renderTasksPlanLeftovers(); renderTasksPlanList(); };
  const actions = {
    add:    addTasksPlanTask,
    finish: () => finishTasksPlanning(false),
    skip:   () => finishTasksPlanning(true),
    later:  snoozeTasksPlanning,
    carry:  () => { tasksCarryTo(id, cur);                   refresh(); },
    done:   () => { tasksChangeStatus(id, 'completed');      refresh(); },
    drop:   () => { tasksChangeStatus(id, 'dropped');        refresh(); },
    remove: () => { tasksRemove(id);                         refresh(); },
  };
  if (actions[action]) actions[action]();
}

function handleTasksPlanningClick(event) {
  const target = event.target.closest('[data-plan]');
  if (target) runTasksPlanAction(target.dataset.plan, target.dataset.id || null);
}

function handleTasksPlanningKey(event) {
  if (event.key === 'Escape') return snoozeTasksPlanning();
  if (event.key === 'Enter' && event.target.id === 'tasks-plan-input') {
    event.preventDefault();
    addTasksPlanTask();
  }
}

function initTasksPlanning() {
  const overlay = tasksEl('tasks-planning');
  if (!overlay) return;
  overlay.addEventListener('click', handleTasksPlanningClick);
  overlay.addEventListener('keydown', handleTasksPlanningKey);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkTasksPlanning();
  });
}
