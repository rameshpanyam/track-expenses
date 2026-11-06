/* ═══════════════════════════════════════════════════════════════════
   TASKS · TYPES  (v31.2)
   Your own goal categories (Health, Career, Finance …). A type is just
   an optional label on a task — it works in every section — plus a
   filter chip bar and a coloured badge.

   • Starter types are seeded ONCE (when the saved state has no `types`
     key at all). Delete them all and they stay deleted.
   • Deleting a type never deletes tasks: they just become uncategorised.
   • The filter scopes the list and the hero score. Streaks and history
     stay overall on purpose.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

const TASKS_STARTER_TYPE_NAMES = ['Health', 'Career', 'Finance', 'Learning', 'Family', 'Personal'];
const TASKS_TYPE_NAME_MAX = 30;

var tasksActiveTypeId  = null;   // null = "All"
var tasksEditingTypeId = null;   // type open in the modal (null = creating)

/* ─── Data ───────────────────────────────────────────────────────── */
/** Deterministic ids, so two devices seeding the same starters agree. */
function tasksStarterTypes() {
  const now = new Date().toISOString();
  return TASKS_STARTER_TYPE_NAMES.map(name => ({
    id: `type_${name.toLowerCase()}`, name, createdAt: now,
  }));
}

function tasksTypeById(id) {
  return tasksState && id ? tasksState.types.find(t => t.id === id) || null : null;
}

/** Same id → same colour, forever. Text/background are picked for AA contrast. */
function tasksTypeHue(id) {
  let hue = 0;
  for (const ch of id) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  return hue;
}

function tasksMatchesType(task) {
  return !tasksActiveTypeId || task.typeId === tasksActiveTypeId;
}

function tasksTypeBadgeHTML(task) {
  const type = tasksTypeById(task.typeId);
  return type
    ? `<span class="tasks-type-badge" style="--hue:${tasksTypeHue(type.id)}">${escapeHTML(type.name)}</span>`
    : '';
}

function tasksTypeNameTaken(name, exceptId = null) {
  return tasksState.types.some(t =>
    t.id !== exceptId && t.name.toLowerCase() === name.toLowerCase());
}

/** Returns an error message, or '' when the name is fine. */
function validateTaskTypeName(name, exceptId = null) {
  if (!name)                          return 'Enter a type name';
  if (name.length > TASKS_TYPE_NAME_MAX) return `Keep it under ${TASKS_TYPE_NAME_MAX} characters`;
  if (tasksTypeNameTaken(name, exceptId)) return 'That type already exists';
  return '';
}

function tasksTypeAdd(name) {
  const type = { id: tasksNewId('type'), name, createdAt: new Date().toISOString() };
  tasksState.types.push(type);
  saveTasksState();
  return type;
}

function tasksTypeRename(id, name) {
  const type = tasksTypeById(id);
  if (!type) return null;
  type.name = name;
  saveTasksState();
  return type;
}

/** Tasks are never deleted with their type; they become uncategorised. */
function tasksTypeRemove(id) {
  for (const t of tasksState.tasks) {
    if (t.typeId === id) { t.typeId = null; tasksTouch(t); }
  }
  tasksState.types = tasksState.types.filter(t => t.id !== id);
  if (tasksActiveTypeId === id) tasksActiveTypeId = null;
  saveTasksState();
}

/* ─── Filter chip bar: All · each type · + New ───────────────────── */
function renderTasksTypeBar() {
  const el = tasksEl('tasks-type-bar');
  if (!el || !tasksState) return;
  const horizon = tasksActiveHorizon;
  const key     = tasksViewKey(horizon);
  const count   = typeId => {
    const { done, total } = tasksPeriodStats(horizon, key, typeId);
    return `${done}/${total}`;
  };

  let html = `
    <button class="savings-pot-chip${tasksActiveTypeId === null ? ' active' : ''}"
            data-action="select-type" data-id="">
      <span class="savings-pot-chip-name">All</span>
      <span class="savings-pot-chip-bal">${count(null)}</span>
    </button>`;
  for (const type of tasksState.types) {
    html += `
      <button class="savings-pot-chip${tasksActiveTypeId === type.id ? ' active' : ''}"
              data-action="select-type" data-id="${escapeHTML(type.id)}">
        <span class="savings-pot-chip-name">${escapeHTML(type.name)}</span>
        <span class="savings-pot-chip-bal">${count(type.id)}</span>
        <span class="savings-pot-edit-btn" role="button" aria-label="Edit ${escapeHTML(type.name)}"
              data-action="edit-type" data-id="${escapeHTML(type.id)}"></span>
      </button>`;
  }
  html += `<button class="savings-pot-chip savings-pot-new-chip" data-action="new-type">+ New type</button>`;
  el.innerHTML = html;
}

function setTasksActiveType(typeId) {
  tasksActiveTypeId = typeId || null;
  renderTasks();
}

/* ─── Create / rename / delete modal ─────────────────────────────── */
function openTasksTypeModal(typeId) {
  const type  = tasksTypeById(typeId);
  const modal = tasksEl('tasks-type-modal');
  const input = tasksEl('tasks-type-name-input');
  tasksEditingTypeId = type ? type.id : null;
  tasksEl('tasks-type-modal-title').textContent = type ? 'Edit Type' : 'New Type';
  tasksEl('tasks-type-delete-btn').style.display = type ? 'inline-flex' : 'none';
  input.value = type ? type.name : '';
  modal.style.display = 'flex';
  tasksFocusIfIdle(modal, input);
}

function openTasksTypeAddModal()        { openTasksTypeModal(null); }
function openTasksTypeEditModal(typeId) { if (tasksTypeById(typeId)) openTasksTypeModal(typeId); }

function closeTasksTypeModal() {
  tasksEl('tasks-type-modal').style.display = 'none';
  tasksEditingTypeId = null;
}

function saveTasksType() {
  const name  = tasksEl('tasks-type-name-input').value.trim();
  const error = validateTaskTypeName(name, tasksEditingTypeId);
  if (error) return tasksNotify(error, true);

  if (tasksEditingTypeId) {
    tasksTypeRename(tasksEditingTypeId, name);
    tasksNotify('Type renamed');
  } else {
    const type = tasksTypeAdd(name);
    tasksActiveTypeId = type.id;           // jump straight into the new type
    tasksNotify('Type created');
  }
  closeTasksTypeModal();
  renderTasks();
}

function deleteTasksType() {
  const type = tasksTypeById(tasksEditingTypeId);
  if (!type) return;
  if (!confirm(`Delete "${type.name}"? Its tasks stay, just uncategorised.`)) return;
  tasksTypeRemove(type.id);
  closeTasksTypeModal();
  renderTasks();
  tasksNotify('Type deleted');
}
