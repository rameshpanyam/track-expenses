/* ═══════════════════════════════════════════════════════════════════
   TASKS · MODEL  (v31.0)
   State, storage, v1 migration and every mutation. No DOM here.

   State (localStorage 'expense-tracker.tasks.v2'):
     {
       version: 2,
       tasks: [ { id, title, horizon, periodKey, status, blockedReason,
                  parentId, typeId, carriedFrom[], completedAt, createdAt, updatedAt } ],
       types:    [ { id, name, createdAt } ],      // your own categories (Health, Career…)
       reviews:  [ { horizon, periodKey, reflection, done, total, pct, createdAt } ],
       planning: { prompted: { week, month, year }, skipped: ['week:2026-11-01'] },
       settings: { weeklyCap, streakPct }
     }

   • horizon  = 'week' | 'month' | 'year' | 'long'   (see tasks-periods.js)
   • "carry count" is DERIVED: carriedFrom.length. Each time a task is
     moved to a later period, the period it left is pushed on carriedFrom,
     so past periods still remember the task as unfinished (honest stats).
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

const TASKS_STORAGE_KEY    = 'expense-tracker.tasks.v2';
const TASKS_STORAGE_KEY_V1 = 'expense-tracker.tasks.v1';

const TASKS_STATUSES = [
  { id: 'todo',       label: 'To do'       },
  { id: 'started',    label: 'Started'     },
  { id: 'inprogress', label: 'In progress' },
  { id: 'completed',  label: 'Completed'   },
  { id: 'blocked',    label: 'Blocked'     },
  { id: 'dropped',    label: 'Dropped'     },
];
const TASKS_OPEN_STATUSES = ['todo', 'started', 'inprogress', 'blocked'];
const TASKS_STATUS_RANK   = { inprogress: 0, started: 1, blocked: 2, todo: 3, completed: 4, dropped: 5 };

const TASKS_DEFAULT_SETTINGS = { weeklyCap: 7, streakPct: 80 };
const TASKS_NUDGE_AFTER_CARRIES = 3;

var tasksState = null;

/* ─── Small helpers ──────────────────────────────────────────────── */
function tasksNewId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function tasksNotify(msg, isError = false) {
  if (typeof window.showToast === 'function') window.showToast(msg, isError);
}

function tasksStatusLabel(id) {
  const s = TASKS_STATUSES.find(x => x.id === id);
  return s ? s.label : id;
}

function tasksIsOpen(task)        { return TASKS_OPEN_STATUSES.includes(task.status); }
function tasksCarryCount(task)    { return task.carriedFrom.length; }
function tasksById(id)            { return tasksState && id ? tasksState.tasks.find(t => t.id === id) || null : null; }
function tasksChildren(id)        { return tasksState.tasks.filter(t => t.parentId === id); }
function tasksOfPeriod(horizon, key) {
  return tasksState.tasks.filter(t => t.horizon === horizon && t.periodKey === key);
}

/** In-progress first, completed/dropped last; oldest first inside a group. */
function tasksSorted(list) {
  return list.slice().sort((a, b) =>
    TASKS_STATUS_RANK[a.status] - TASKS_STATUS_RANK[b.status] ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id));
}

/** Open parent goals a task of this horizon/period could roll up into. */
function tasksParentCandidates(horizon, key) {
  const parentHorizon = TASKS_PARENT_HORIZON[horizon];
  if (!parentHorizon) return [];
  const keys = horizon === 'week' ? tasksPeriodMonths(horizon, key) : [key.slice(0, 4)];
  return tasksState.tasks.filter(t =>
    t.horizon === parentHorizon && keys.includes(t.periodKey) && tasksIsOpen(t));
}

/* ═══════════════════════════════════════════════════════════════════
   NORMALISE / SEED / MIGRATE
   ═══════════════════════════════════════════════════════════════════ */
function tasksNormalizeTask(raw) {
  const now     = new Date().toISOString();
  const status  = TASKS_STATUSES.some(s => s.id === raw.status) ? raw.status : 'todo';
  const horizon = tasksHorizon(raw.horizon) ? raw.horizon : 'long';
  return {
    id:            raw.id,
    title:         raw.title,
    horizon,
    periodKey:     tasksHasPeriod(horizon) ? (raw.periodKey || tasksCurrentPeriod(horizon)) : '',
    status,
    blockedReason: status === 'blocked' ? (raw.blockedReason || '') : '',
    parentId:      raw.parentId || null,
    typeId:        raw.typeId || null,          // null = uncategorised
    carriedFrom:   Array.isArray(raw.carriedFrom) ? raw.carriedFrom.slice() : [],
    completedAt:   status === 'completed' ? (raw.completedAt || now) : null,
    createdAt:     raw.createdAt || now,
    updatedAt:     raw.updatedAt || now,
  };
}

/** Month + year are pre-marked as planned so a fresh install is only
 *  asked to plan the WEEK; the others fire at their next boundary. */
function tasksSeedState() {
  return {
    version:  2,
    tasks:    [],
    types:    tasksStarterTypes(),
    reviews:  [],
    planning: {
      prompted: { month: tasksCurrentPeriod('month'), year: tasksCurrentPeriod('year') },
      skipped:  [],
    },
    settings: { ...TASKS_DEFAULT_SETTINGS },
  };
}

function tasksNormalizeState(raw) {
  const seed = tasksSeedState();
  const src  = raw || {};
  const plan = src.planning || {};
  return {
    version: 2,
    tasks:   (Array.isArray(src.tasks) ? src.tasks : [])
               .filter(t => t && t.id && t.title).map(tasksNormalizeTask),
    // Starter types only when the key is MISSING; an empty list means
    // "I deleted them all" and must stay empty.
    types:   Array.isArray(src.types)
               ? src.types.filter(t => t && t.id && t.name).map(t => ({ ...t, createdAt: t.createdAt || '' }))
               : tasksStarterTypes(),
    reviews: Array.isArray(src.reviews) ? src.reviews : [],
    planning: {
      prompted: { ...seed.planning.prompted, ...(plan.prompted || {}) },
      skipped:  Array.isArray(plan.skipped) ? plan.skipped : [],
    },
    settings: { ...TASKS_DEFAULT_SETTINGS, ...(src.settings || {}) },
  };
}

/** v1 (types + start/end dates) → v2. Short-term → Weekly; everything
 *  else (Long-term, Personal, Unassigned) → Long-term. Nothing is lost. */
function tasksMigrateV1(old) {
  const types  = Array.isArray(old.types) ? old.types : [];
  const isShort = t => {
    const type = types.find(x => x.id === t.typeId);
    return t.typeId === 'type_short' || (type && type.name.toLowerCase() === 'short-term');
  };
  const weekOf = t => (t.completed && t.completedAt)
    ? tasksPeriodKey('week', tasksIso(new Date(t.completedAt)))
    : tasksCurrentPeriod('week');

  return tasksNormalizeState({
    tasks: (Array.isArray(old.tasks) ? old.tasks : []).map(t => ({
      id: t.id, title: t.title,
      horizon:     isShort(t) ? 'week' : 'long',
      periodKey:   isShort(t) ? weekOf(t) : '',
      status:      t.completed ? 'completed' : 'todo',
      completedAt: t.completedAt || null,
      createdAt:   t.createdAt,
    })),
  });
}

/* ═══════════════════════════════════════════════════════════════════
   STORAGE
   ═══════════════════════════════════════════════════════════════════ */
function tasksReadJson(key) {
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}

function loadTasksState() {
  try {
    const v2 = tasksReadJson(TASKS_STORAGE_KEY);
    const v1 = v2 ? null : tasksReadJson(TASKS_STORAGE_KEY_V1);
    tasksState = v2 ? tasksNormalizeState(v2) : v1 ? tasksMigrateV1(v1) : tasksSeedState();
    if (!v2) saveTasksLocal();   // v1 key is left untouched → easy rollback
  } catch (e) {
    console.warn('loadTasksState error', e);
    tasksState = tasksSeedState();
  }
}

function saveTasksLocal() {
  try {
    localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasksState));
  } catch (e) {
    console.warn('saveTasksState error', e);
  }
}

function saveTasksState() {
  saveTasksLocal();
  // Fire-and-forget sheet sync (non-blocking — UI stays instant)
  syncTasksToSheet().catch(e => console.warn('Tasks sheet sync failed:', e.message));
}

/* ═══════════════════════════════════════════════════════════════════
   MUTATIONS  (each one saves, so callers never forget to)
   ═══════════════════════════════════════════════════════════════════ */
function tasksTouch(task) { task.updatedAt = new Date().toISOString(); }

function tasksApplyStatus(task, status, reason = '') {
  task.status        = status;
  task.blockedReason = status === 'blocked' ? reason : '';
  task.completedAt   = status === 'completed' ? (task.completedAt || new Date().toISOString()) : null;
  tasksTouch(task);
}

function tasksAdd({ title, horizon, periodKey = '', parentId = null, typeId = null, status = 'todo', blockedReason = '' }) {
  const task = tasksNormalizeTask({
    id: tasksNewId('task'), title, horizon, periodKey, parentId, typeId, status, blockedReason,
  });
  tasksState.tasks.push(task);
  saveTasksState();
  return task;
}

/** Edit title / status / reason / parent / type in one save. */
function tasksEdit(id, { title, status, blockedReason, parentId, typeId }) {
  const task = tasksById(id);
  if (!task) return null;
  task.title    = title;
  task.parentId = parentId || null;
  task.typeId   = typeId || null;
  tasksApplyStatus(task, status, blockedReason);
  saveTasksState();
  return task;
}

function tasksChangeStatus(id, status, reason = '') {
  const task = tasksById(id);
  if (!task) return null;
  tasksApplyStatus(task, status, reason);
  saveTasksState();
  return task;
}

/** Move a task to a later period; remember the one it left. */
function tasksCarryTo(id, targetKey) {
  const task = tasksById(id);
  if (!task || !tasksHasPeriod(task.horizon) || task.periodKey === targetKey) return null;
  task.carriedFrom.push(task.periodKey);
  task.periodKey = targetKey;
  tasksTouch(task);
  saveTasksState();
  return task;
}

function tasksMoveForward(id) {
  const task = tasksById(id);
  if (!task) return null;
  return tasksCarryTo(id, tasksShiftPeriod(task.horizon, task.periodKey, 1));
}

/** Delete a task. Its children survive (they just lose their parent). */
function tasksRemove(id) {
  const idx = tasksState.tasks.findIndex(t => t.id === id);
  if (idx === -1) return;
  tasksState.tasks.splice(idx, 1);
  for (const t of tasksState.tasks) if (t.parentId === id) t.parentId = null;
  saveTasksState();
}
