/* ═══════════════════════════════════════════════════════════════════
   TASKS MODULE — v30.0
   Track tasks with a tentative start/end timeline, grouped by "type"
   (Short-term / Long-term / Personal by default; user can add more).

   Data model:
     {
       types: [ { id, name, createdAt } ],
       tasks: [ { id, title, startDate, endDate, typeId,
                  completed, completedAt, createdAt } ]
     }
   • typeId = null → "Unassigned" (type was deleted — tasks are never lost).
   • Default types are seeded ONLY when no saved state exists, so a type
     you deleted never comes back.
   • Overdue = not completed AND endDate is before today.

   Google Sheets:
     "Tasks" tab     — 10 cols: ID|Title|StartDate|EndDate|Completed|
                                CompletedAt|CreatedAt|UpdatedAt|TypeId|TypeName
     "TaskTypes" tab —  3 cols: ID|Name|CreatedAt

   Reuses from app.js: escapeHTML, todayStr, fmtDate, showToast.
   ═══════════════════════════════════════════════════════════════════ */

'use strict';

const TASKS_STORAGE_KEY = 'expense-tracker.tasks.v1';

const TASKS_TAB = {
  name: 'Tasks',
  headers: ['ID','Title','StartDate','EndDate','Completed','CompletedAt',
            'CreatedAt','UpdatedAt','TypeId','TypeName'],
};
const TASK_TYPES_TAB = {
  name: 'TaskTypes',
  headers: ['ID','Name','CreatedAt'],
};
const TASKS_SHEET_CLEAR_PADDING = 200; // stale rows to wipe below the data

const TASKS_DEFAULT_TYPES = [
  { id: 'type_short',    name: 'Short-term' },
  { id: 'type_long',     name: 'Long-term'  },
  { id: 'type_personal', name: 'Personal'   },
];

/* ─── State ──────────────────────────────────────────────────────── */
var tasksState         = null;   // { types: [], tasks: [] }
var tasksEditingId     = null;   // task being edited
var tasksActiveTypeId  = null;   // null = "All" view
var tasksEditingTypeId = null;   // type being renamed/deleted

/* ═══════════════════════════════════════════════════════════════════
   STORAGE
   ═══════════════════════════════════════════════════════════════════ */
function tasksSeedState() {
  const now = new Date().toISOString();
  return {
    types: TASKS_DEFAULT_TYPES.map(t => ({ ...t, createdAt: now })),
    tasks: [],
  };
}

function loadTasksState() {
  try {
    const raw = localStorage.getItem(TASKS_STORAGE_KEY);
    tasksState = raw ? JSON.parse(raw) : tasksSeedState();
    if (!Array.isArray(tasksState.types)) tasksState.types = [];
    if (!Array.isArray(tasksState.tasks)) tasksState.tasks = [];
  } catch (e) {
    console.warn('loadTasksState error', e);
    tasksState = tasksSeedState();
  }
}

function saveTasksState() {
  try {
    localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasksState));
  } catch (e) {
    console.warn('saveTasksState error', e);
  }
  // Fire-and-forget sheet sync (non-blocking — UI stays instant)
  syncTasksToSheet().catch(e => console.warn('Tasks sheet sync failed:', e.message));
}

/* ═══════════════════════════════════════════════════════════════════
   GOOGLE SHEETS SYNC  (one generic ensure/write pair serves both tabs)
   ═══════════════════════════════════════════════════════════════════ */
function tasksSheetsReady() {
  return !!(window.spreadsheetId && window.accessToken &&
            typeof window.sheetsRequest === 'function');
}

function tasksLastCol(tab) {
  return String.fromCharCode(64 + tab.headers.length); // 3 → 'C', 10 → 'J'
}

/** Create the tab if missing, and (re)write the header row if it's wrong. */
async function ensureTasksTab(tab) {
  const sid  = window.spreadsheetId;
  const last = tasksLastCol(tab);
  const hdrRange = `${tab.name}!A1:${last}1`;

  const meta = typeof window.getCachedSheetMeta === 'function'
    ? await window.getCachedSheetMeta()
    : await window.sheetsRequest('GET', `/${sid}?fields=sheets.properties`);
  const exists = meta.sheets.some(s => s.properties.title === tab.name);

  if (!exists) {
    await window.sheetsRequest('POST', `/${sid}:batchUpdate`,
      { requests: [{ addSheet: { properties: { title: tab.name } } }] });
    window.invalidateSheetMetaCache?.();
  } else {
    const hdr = await window.sheetsRequest('GET', `/${sid}/values/${hdrRange}`);
    const current = (hdr.values && hdr.values[0]) || [];
    if (current.length === tab.headers.length) return;
  }
  await window.sheetsRequest('PUT',
    `/${sid}/values/${hdrRange}?valueInputOption=RAW`, { values: [tab.headers] });
}

/** Overwrite the tab's data rows and clear any stale rows beneath them. */
async function writeTasksTab(tab, rows) {
  const sid  = window.spreadsheetId;
  const last = tasksLastCol(tab);
  if (rows.length > 0) {
    await window.sheetsRequest('PUT',
      `/${sid}/values/${tab.name}!A2:${last}${rows.length + 1}?valueInputOption=RAW`,
      { values: rows });
  }
  const clearFrom = rows.length + 2;
  await window.sheetsRequest('POST',
    `/${sid}/values/${tab.name}!A${clearFrom}:${last}${clearFrom + TASKS_SHEET_CLEAR_PADDING}:clear`,
    null);
}

async function syncTasksToSheet() {
  if (!tasksSheetsReady()) return;
  if (!tasksState) loadTasksState();
  await Promise.all([ensureTasksTab(TASKS_TAB), ensureTasksTab(TASK_TYPES_TAB)]);

  const now = new Date().toISOString();
  const taskRows = tasksState.tasks.map(t => {
    const type = tasksTypeById(t.typeId);
    return [
      t.id, t.title, t.startDate, t.endDate,
      t.completed ? 'TRUE' : 'FALSE',
      t.completedAt || '', t.createdAt || now, now,
      t.typeId || '', type ? type.name : '',
    ];
  });
  const typeRows = tasksState.types.map(t => [t.id, t.name, t.createdAt || now]);

  await writeTasksTab(TASKS_TAB, taskRows);
  await writeTasksTab(TASK_TYPES_TAB, typeRows);
}

/** Pull from sheet into local state. Called on sign-in. Sheet wins —
 *  unless the sheet is completely empty (first sign-in), in which case
 *  we keep local data (incl. the seeded types) and push it up instead. */
async function loadTasksFromSheet() {
  if (!tasksSheetsReady()) return false;
  if (!tasksState) loadTasksState();
  await Promise.all([ensureTasksTab(TASKS_TAB), ensureTasksTab(TASK_TYPES_TAB)]);

  const sid = window.spreadsheetId;
  const [typeData, taskData] = await Promise.all([
    window.sheetsRequest('GET', `/${sid}/values/${TASK_TYPES_TAB.name}!A:C`),
    window.sheetsRequest('GET', `/${sid}/values/${TASKS_TAB.name}!A:J`),
  ]);

  const types = (typeData.values || []).slice(1)
    .filter(r => r[0] && r[1])
    .map(r => ({ id: r[0], name: r[1], createdAt: r[2] || '' }));

  const tasks = (taskData.values || []).slice(1)
    .filter(r => r[0] && r[1])
    .map(r => ({
      id:          r[0],
      title:       r[1],
      startDate:   r[2] || '',
      endDate:     r[3] || '',
      completed:   String(r[4]).toUpperCase() === 'TRUE',
      completedAt: r[5] || null,
      createdAt:   r[6] || '',
      typeId:      r[8] || null,
    }));

  if (!types.length && !tasks.length) {
    await syncTasksToSheet();
    return true;
  }
  tasksState = { types, tasks };
  try {
    localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasksState));
  } catch (e) { /* no-op */ }
  return true;
}

/* ═══════════════════════════════════════════════════════════════════
   PURE HELPERS
   ═══════════════════════════════════════════════════════════════════ */
function tasksNewId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function tasksTypeById(id) {
  if (!tasksState || !id) return null;
  return tasksState.types.find(t => t.id === id) || null;
}

/** Tasks for a type, or ALL tasks when typeId is null. */
function tasksForType(typeId) {
  if (!tasksState) return [];
  if (!typeId) return tasksState.tasks;
  return tasksState.tasks.filter(t => t.typeId === typeId);
}

function tasksProgress(typeId) {
  const list  = tasksForType(typeId);
  const done  = list.filter(t => t.completed).length;
  const total = list.length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

function tasksIsOverdue(task) {
  return !task.completed && !!task.endDate && task.endDate < todayStr();
}

/** Soonest end date first; ties broken by start date, then id (stable). */
function tasksSorted(list) {
  return list.slice().sort((a, b) =>
    a.endDate.localeCompare(b.endDate) ||
    a.startDate.localeCompare(b.startDate) ||
    a.id.localeCompare(b.id));
}

function tasksFmtDate(iso) {
  if (!iso) return '';
  const year = iso.slice(0, 4);
  const sameYear = year === String(new Date().getFullYear());
  return sameYear ? fmtDate(iso) : `${fmtDate(iso)} ${year}`;
}

function tasksNotify(msg, isError = false) {
  if (typeof window.showToast === 'function') window.showToast(msg, isError);
}

/* ═══════════════════════════════════════════════════════════════════
   RENDER
   ═══════════════════════════════════════════════════════════════════ */
function renderTasks() {
  if (!tasksState) loadTasksState();
  renderTasksHero();
  renderTasksTypeBar();
  renderTasksList();
}

function renderTasksHero() {
  const el = document.getElementById('tasks-hero');
  if (!el) return;
  const type  = tasksTypeById(tasksActiveTypeId);
  const label = type ? type.name.toUpperCase() : 'ALL TASKS';
  const { done, total, pct } = tasksProgress(tasksActiveTypeId);
  el.innerHTML = `
    <div class="savings-hero-label">${escapeHTML(label)}</div>
    <div class="savings-hero-amount">${done} / ${total} done</div>
    <div class="tasks-progress" role="progressbar" aria-label="Tasks completed"
         aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">
      <div class="tasks-progress-fill" style="width:${pct}%"></div>
    </div>
    <div class="tasks-progress-label">${pct}% complete</div>`;
}

function renderTasksTypeBar() {
  const el = document.getElementById('tasks-type-bar');
  if (!el || !tasksState) return;

  const all = tasksProgress(null);
  let html = `
    <button class="savings-pot-chip${tasksActiveTypeId === null ? ' active' : ''}"
            data-action="select-type" data-id="">
      <span class="savings-pot-chip-name">All</span>
      <span class="savings-pot-chip-bal">${all.done}/${all.total}</span>
    </button>`;

  for (const type of tasksState.types) {
    const { done, total } = tasksProgress(type.id);
    html += `
      <button class="savings-pot-chip${tasksActiveTypeId === type.id ? ' active' : ''}"
              data-action="select-type" data-id="${escapeHTML(type.id)}">
        <span class="savings-pot-chip-name">${escapeHTML(type.name)}</span>
        <span class="savings-pot-chip-bal">${done}/${total}</span>
        <span class="savings-pot-edit-btn" role="button" aria-label="Edit ${escapeHTML(type.name)}"
              data-action="edit-type" data-id="${escapeHTML(type.id)}"></span>
      </button>`;
  }
  html += `<button class="savings-pot-chip savings-pot-new-chip" data-action="new-type">+ New</button>`;
  el.innerHTML = html;
}

function tasksRowHTML(task, showTypeBadge) {
  const overdue = tasksIsOverdue(task);
  const type    = tasksTypeById(task.typeId);
  const title   = escapeHTML(task.title);
  const badge   = showTypeBadge
    ? `<span class="savings-entry-pot-badge${type ? '' : ' unassigned'}">${type ? escapeHTML(type.name) : 'Unassigned'}</span>`
    : '';
  const classes = ['tasks-item', task.completed && 'done', overdue && 'overdue']
    .filter(Boolean).join(' ');

  return `
    <div class="${classes}" data-action="edit" data-id="${escapeHTML(task.id)}">
      <button type="button" class="tasks-check" role="checkbox"
              aria-checked="${task.completed}"
              aria-label="${task.completed ? 'Mark not done' : 'Mark done'}: ${title}"
              data-action="toggle" data-id="${escapeHTML(task.id)}"></button>
      <div class="tasks-item-meta">
        <div class="tasks-item-title">${title}</div>
        <div class="tasks-item-dates">
          ${tasksFmtDate(task.startDate)} → ${tasksFmtDate(task.endDate)}
          ${overdue ? '<span class="tasks-overdue-tag">Overdue</span>' : ''}
        </div>
        ${badge ? `<div class="tasks-item-row3">${badge}</div>` : ''}
      </div>
    </div>`;
}

function renderTasksList() {
  const el = document.getElementById('tasks-list');
  if (!el || !tasksState) return;

  const type  = tasksTypeById(tasksActiveTypeId);
  const tasks = tasksSorted(tasksForType(tasksActiveTypeId));

  const labelEl = document.getElementById('tasks-section-label');
  if (labelEl) labelEl.textContent = type ? `${type.name} tasks` : 'All tasks';

  if (!tasks.length) {
    el.innerHTML = `
      <div class="savings-empty">
        <div class="savings-empty-icon">&#128221;</div>
        <div class="savings-empty-title">${type ? 'No tasks in ' + escapeHTML(type.name) : 'No tasks yet'}</div>
        <div class="savings-empty-sub">Tap <strong>+ Add Task</strong> above to plan your first one.</div>
      </div>`;
    return;
  }
  const showBadge = tasksActiveTypeId === null;
  el.innerHTML = `<div class="tasks-items">${tasks.map(t => tasksRowHTML(t, showBadge)).join('')}</div>`;
}

/* ═══════════════════════════════════════════════════════════════════
   EVENT DELEGATION — one listener for every dynamic control
   ═══════════════════════════════════════════════════════════════════ */
const TASKS_ACTIONS = {
  'toggle':      id => toggleTaskCompleted(id),
  'edit':        id => openTasksEditModal(id),
  'select-type': id => setTasksActiveType(id),
  'edit-type':   id => openTasksTypeEditModal(id),
  'new-type':    ()  => openTasksTypeAddModal(),
};

function handleTasksViewClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const handler = TASKS_ACTIONS[target.dataset.action];
  if (!handler) return;
  event.stopPropagation(); // chip/pencil and checkbox/row are nested
  handler(target.dataset.id || null);
}

function initTasksView() {
  const view = document.getElementById('view-tasks');
  if (view) view.addEventListener('click', handleTasksViewClick);
}

function setTasksActiveType(typeId) {
  tasksActiveTypeId = typeId || null;
  renderTasks();
}

function toggleTaskCompleted(id) {
  const task = tasksState.tasks.find(t => t.id === id);
  if (!task) return;
  task.completed   = !task.completed;
  task.completedAt = task.completed ? new Date().toISOString() : null;
  saveTasksState();
  renderTasks();
}

/* ═══════════════════════════════════════════════════════════════════
   TYPE MODAL (create / rename / delete)
   ═══════════════════════════════════════════════════════════════════ */
function openTasksTypeModal(typeId) {
  const type  = tasksTypeById(typeId);
  const modal = document.getElementById('tasks-type-modal');
  const input = document.getElementById('tasks-type-name-input');
  if (!modal || !input) return;
  tasksEditingTypeId = type ? type.id : null;
  document.getElementById('tasks-type-modal-title').textContent = type ? 'Edit Task Type' : 'New Task Type';
  document.getElementById('tasks-type-delete-btn').style.display = type ? 'inline-flex' : 'none';
  input.value         = type ? type.name : '';
  modal.style.display = 'flex';
  setTimeout(() => input.focus(), 80);
}

function openTasksTypeAddModal()        { openTasksTypeModal(null); }
function openTasksTypeEditModal(typeId) { if (tasksTypeById(typeId)) openTasksTypeModal(typeId); }

function closeTasksTypeModal() {
  const modal = document.getElementById('tasks-type-modal');
  if (modal) modal.style.display = 'none';
  tasksEditingTypeId = null;
}

function saveTasksType() {
  const name = (document.getElementById('tasks-type-name-input').value || '').trim();
  if (!name) return tasksNotify('Enter a type name', true);

  const duplicate = tasksState.types.some(t =>
    t.name.toLowerCase() === name.toLowerCase() && t.id !== tasksEditingTypeId);
  if (duplicate) return tasksNotify('Type already exists', true);

  const existing = tasksTypeById(tasksEditingTypeId);
  if (existing) {
    existing.name = name;
    tasksNotify('Type renamed');
  } else {
    tasksState.types.push({ id: tasksNewId('type'), name, createdAt: new Date().toISOString() });
    tasksNotify('Type created');
  }
  saveTasksState();
  closeTasksTypeModal();
  renderTasks();
}

function deleteTasksType() {
  const type = tasksTypeById(tasksEditingTypeId);
  if (!type) return;
  if (!confirm(`Delete "${type.name}"? Its tasks will move to Unassigned.`)) return;

  // Orphan tasks — never cascade-delete
  for (const t of tasksState.tasks) {
    if (t.typeId === type.id) t.typeId = null;
  }
  tasksState.types = tasksState.types.filter(t => t.id !== type.id);
  if (tasksActiveTypeId === type.id) tasksActiveTypeId = null;

  saveTasksState();
  closeTasksTypeModal();
  renderTasks();
  tasksNotify('Type deleted');
}

/* ═══════════════════════════════════════════════════════════════════
   TASK FORM MODAL (add / edit)
   ═══════════════════════════════════════════════════════════════════ */
function populateTasksTypeSelect(selectedId) {
  const sel = document.getElementById('tasks-form-type');
  if (!sel) return;
  sel.innerHTML =
    `<option value="">— Unassigned —</option>` +
    tasksState.types.map(t =>
      `<option value="${escapeHTML(t.id)}"${t.id === selectedId ? ' selected' : ''}>${escapeHTML(t.name)}</option>`
    ).join('');
}

function openTasksFormModal(task) {
  if (!tasksState) loadTasksState();
  tasksEditingId = task ? task.id : null;
  document.getElementById('tasks-form-title-text').textContent = task ? 'Edit Task' : 'Add Task';
  document.getElementById('tasks-form-title').value = task ? task.title : '';
  document.getElementById('tasks-form-start').value = task ? task.startDate : todayStr();
  document.getElementById('tasks-form-end').value   = task ? task.endDate : '';
  populateTasksTypeSelect(task ? (task.typeId || '') : (tasksActiveTypeId || ''));
  document.getElementById('tasks-form-delete').style.display = task ? 'inline-flex' : 'none';
  document.getElementById('tasks-form-modal').style.display  = 'flex';
  setTimeout(() => document.getElementById('tasks-form-title').focus(), 80);
}

function openTasksAddModal() { openTasksFormModal(null); }

function openTasksEditModal(id) {
  const task = tasksState.tasks.find(t => t.id === id);
  if (task) openTasksFormModal(task);
}

function closeTasksFormModal() {
  document.getElementById('tasks-form-modal').style.display = 'none';
  tasksEditingId = null;
}

/** Returns an error message, or '' when the form values are valid. */
function validateTaskForm({ title, startDate, endDate }) {
  if (!title)                 return 'Enter a task title';
  if (!startDate || !endDate) return 'Pick a start and end date';
  if (endDate < startDate)    return 'End date can’t be before start date';
  return '';
}

function saveTasksForm() {
  const values = {
    title:     (document.getElementById('tasks-form-title').value || '').trim(),
    startDate: document.getElementById('tasks-form-start').value,
    endDate:   document.getElementById('tasks-form-end').value,
    typeId:    document.getElementById('tasks-form-type').value || null,
  };
  const error = validateTaskForm(values);
  if (error) return tasksNotify(error, true);

  const existing = tasksState.tasks.find(t => t.id === tasksEditingId);
  if (existing) {
    Object.assign(existing, values);
  } else {
    tasksState.tasks.push({
      id: tasksNewId('task'), ...values,
      completed: false, completedAt: null,
      createdAt: new Date().toISOString(),
    });
  }
  saveTasksState();
  closeTasksFormModal();
  renderTasks();
  tasksNotify(existing ? 'Task updated' : 'Task added');
}

function deleteTasksForm() {
  const idx = tasksState.tasks.findIndex(t => t.id === tasksEditingId);
  if (idx === -1) return;
  if (!confirm('Delete this task?')) return;
  tasksState.tasks.splice(idx, 1);
  saveTasksState();
  closeTasksFormModal();
  renderTasks();
  tasksNotify('Task deleted');
}

/* ═══════════════════════════════════════════════════════════════════
   PUBLIC API
   ═══════════════════════════════════════════════════════════════════ */
Object.assign(window, {
  // used by app.js
  loadTasksState, loadTasksFromSheet, syncTasksToSheet, renderTasks,
  // used by inline onclick in index.html modals + the Add button
  openTasksAddModal, closeTasksFormModal, saveTasksForm, deleteTasksForm,
  closeTasksTypeModal, saveTasksType, deleteTasksType,
});

/* Auto-bootstrap (same pattern as savings.js / loans.js) */
loadTasksState();
initTasksView();
