/* ═══════════════════════════════════════════════════════════════════
   TASKS · FORM MODAL  (v31.0)
   One modal for add AND edit: title, horizon (add only), status,
   blocked reason (required when Blocked), parent link, move-forward,
   and a nudge for tasks carried over 3+ times.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

var tasksFormCtx = null;   // { id|null, horizon, periodKey }

function tasksOptionsHTML(items, selected) {
  return items.map(i =>
    `<option value="${escapeHTML(i.value)}"${i.value === selected ? ' selected' : ''}>${escapeHTML(i.label)}</option>`
  ).join('');
}

/* ─── Field refreshers ───────────────────────────────────────────── */
function refreshTasksFormParent(selectedId) {
  const { horizon, periodKey } = tasksFormCtx;
  const wrap = tasksEl('tasks-form-parent-wrap');
  const candidates = tasksParentCandidates(horizon, periodKey);
  const current = tasksById(selectedId);
  if (current && !candidates.includes(current)) candidates.push(current);

  wrap.hidden = candidates.length === 0;   // nothing to link to → no empty picker
  const items = [{ value: '', label: '\u2014 None \u2014' }]
    .concat(candidates.map(t => ({ value: t.id, label: t.title })));
  tasksEl('tasks-form-parent').innerHTML = tasksOptionsHTML(items, selectedId || '');
}

/** Type picker. Hidden when no types exist (nothing to choose). */
function refreshTasksFormType(selectedId) {
  const items = [{ value: '', label: '\u2014 None \u2014' }]
    .concat(tasksState.types.map(t => ({ value: t.id, label: t.name })));
  tasksEl('tasks-form-type').innerHTML = tasksOptionsHTML(items, selectedId || '');
  tasksEl('tasks-form-type-wrap').hidden = tasksState.types.length === 0;
}

function refreshTasksFormReason() {
  const blocked = tasksEl('tasks-form-status').value === 'blocked';
  tasksEl('tasks-form-reason-wrap').hidden = !blocked;
  if (blocked) setTimeout(() => tasksEl('tasks-form-reason').focus(), 0);
}

function refreshTasksFormNudge(task) {
  const box = tasksEl('tasks-form-nudge');
  const nudge = !!task && tasksIsOpen(task) && tasksCarryCount(task) >= TASKS_NUDGE_AFTER_CARRIES;
  box.hidden = !nudge;
  if (!nudge) return;
  box.innerHTML = `
    <p class="tasks-nudge-text">&#8635; Carried over ${tasksCarryCount(task)}&times;. Time to decide:</p>
    <div class="tasks-nudge-actions">
      <button type="button" class="tasks-nudge-btn" onclick="tasksFormNudge('do')">Do it</button>
      <button type="button" class="tasks-nudge-btn" onclick="tasksFormNudge('break')">Break it down</button>
      <button type="button" class="tasks-nudge-btn" onclick="tasksFormNudge('drop')">Drop it</button>
    </div>`;
}

function refreshTasksFormMove(task) {
  const btn = tasksEl('tasks-form-move');
  const canMove = !!task && tasksHasPeriod(task.horizon) && tasksIsOpen(task);
  btn.hidden = !canMove;
  if (canMove) btn.textContent = `Move to next ${tasksHorizon(task.horizon).noun} \u2192`;
}

/* ─── Open / close ───────────────────────────────────────────────── */
function openTasksForm(task, preset = {}) {
  if (!tasksState) loadTasksState();
  const horizon = task ? task.horizon : (preset.horizon || tasksActiveHorizon);
  tasksFormCtx = {
    id: task ? task.id : null,
    horizon,
    periodKey: task ? task.periodKey : (preset.periodKey ?? tasksViewKey(horizon)),
  };

  tasksEl('tasks-form-title-text').textContent = task ? 'Edit Task' : 'Add Task';
  tasksEl('tasks-form-title').value   = task ? task.title : (preset.title || '');
  tasksEl('tasks-form-status').value  = task ? task.status : 'todo';
  tasksEl('tasks-form-reason').value  = task ? task.blockedReason : '';

  const horizonSel = tasksEl('tasks-form-horizon');
  horizonSel.innerHTML = tasksOptionsHTML(
    TASKS_HORIZONS.map(h => ({ value: h.id, label: h.label })), horizon);
  tasksEl('tasks-form-horizon-wrap').hidden = !!task;   // horizon is fixed once created

  refreshTasksFormParent(task ? task.parentId : (preset.parentId || null));
  refreshTasksFormType(task ? task.typeId : (preset.typeId ?? tasksActiveTypeId));
  refreshTasksFormReason();
  refreshTasksFormNudge(task);
  refreshTasksFormMove(task);
  tasksEl('tasks-form-delete').style.display = task ? 'inline-flex' : 'none';
  tasksEl('tasks-form-modal').style.display  = 'flex';
  tasksFocusIfIdle(tasksEl('tasks-form-modal'), tasksEl('tasks-form-title'));
}

function openTasksAddModal() { openTasksForm(null); }

function openTasksEditModal(id) {
  const task = tasksById(id);
  if (task) openTasksForm(task);
}

function closeTasksFormModal() {
  tasksEl('tasks-form-modal').style.display = 'none';
  tasksFormCtx = null;
}

/* ─── Save / delete / move ───────────────────────────────────────── */
/** Returns an error message, or '' when the values are valid. */
function validateTaskForm({ title, status, blockedReason }) {
  if (!title) return 'Enter a task title';
  if (status === 'blocked' && !blockedReason) return 'Say what is blocking this task';
  return '';
}

function readTasksForm() {
  return {
    title:         tasksEl('tasks-form-title').value.trim(),
    status:        tasksEl('tasks-form-status').value,
    blockedReason: tasksEl('tasks-form-reason').value.trim(),
    parentId:      tasksEl('tasks-form-parent').value || null,
    typeId:        tasksEl('tasks-form-type').value || null,
  };
}

function tasksWarnIfOverCap(horizon, key) {
  const cap = tasksState.settings.weeklyCap;
  if (horizon !== 'week' || tasksPlannedCount(horizon, key) <= cap) return;
  tasksNotify(`That's more than ${cap} tasks this week. Careful not to overload yourself.`);
}

function saveTasksForm() {
  const values = readTasksForm();
  const error  = validateTaskForm(values);
  if (error) return tasksNotify(error, true);

  const { id, horizon, periodKey } = tasksFormCtx;
  if (id) {
    tasksEdit(id, values);
    tasksNotify('Task updated');
  } else {
    tasksAdd({ ...values, horizon, periodKey });
    tasksNotify('Task added');
    tasksWarnIfOverCap(horizon, periodKey);
  }
  closeTasksFormModal();
  renderTasks();
}

function deleteTasksForm() {
  if (!tasksFormCtx || !tasksFormCtx.id) return;
  if (!confirm('Delete this task?')) return;
  tasksRemove(tasksFormCtx.id);
  closeTasksFormModal();
  renderTasks();
  tasksNotify('Task deleted');
}

function moveTasksForm() {
  if (!tasksFormCtx || !tasksFormCtx.id) return;
  const task = tasksMoveForward(tasksFormCtx.id);
  if (!task) return;
  closeTasksFormModal();
  renderTasks();
  tasksNotify(`Moved to ${tasksPeriodName(task.horizon, task.periodKey).toLowerCase()} (\u21BB ${tasksCarryCount(task)}\u00D7)`);
}

/** do it → start working · drop it → give up on purpose · break it down → smaller task */
function tasksFormNudge(choice) {
  const task = tasksFormCtx && tasksById(tasksFormCtx.id);
  if (!task) return;
  if (choice === 'do' || choice === 'drop') {
    tasksChangeStatus(task.id, choice === 'do' ? 'inprogress' : 'dropped');
    closeTasksFormModal();
    renderTasks();
    return;
  }
  const childHorizon = TASKS_CHILD_HORIZON[task.horizon];
  closeTasksFormModal();
  openTasksForm(null, childHorizon
    ? { horizon: childHorizon, periodKey: tasksCurrentPeriod(childHorizon), parentId: task.id, typeId: task.typeId }
    : { horizon: task.horizon,  periodKey: task.periodKey, typeId: task.typeId, title: `${task.title} \u2013 first step` });
}

function initTasksForm() {
  tasksEl('tasks-form-status').innerHTML = tasksOptionsHTML(
    TASKS_STATUSES.map(s => ({ value: s.id, label: s.label })), 'todo');
  tasksEl('tasks-form-status').addEventListener('change', refreshTasksFormReason);
  tasksEl('tasks-form-horizon').addEventListener('change', event => {
    tasksFormCtx.horizon   = event.target.value;
    tasksFormCtx.periodKey = tasksViewKey(event.target.value);
    refreshTasksFormParent(null);
  });
}
