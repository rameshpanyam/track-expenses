/* ═══════════════════════════════════════════════════════════════════
   TASKS · BOOTSTRAP  (v31.0)
   Weekly / Monthly / Yearly / Long-term targets with statuses,
   carry-over, planning prompts, reviews, streaks and Sheets sync.

   Load order (index.html) — each file only uses those above it:
     tasks-periods → tasks-model → tasks-stats → tasks-sheet →
     tasks-ui → tasks-form → tasks-planning → tasks-insights → tasks

   Public surface (plain globals; no namespace, same as loans.js / savings.js):
     used by app.js ....... loadTasksState, loadTasksFromSheet,
                            syncTasksToSheet, renderTasks, checkTasksPlanning
     used by index.html ... closeTasksFormModal, saveTasksForm, deleteTasksForm,
                            moveTasksForm, tasksFormNudge, closeTasksInsights
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

/** Sign-in pull. Always re-checks planning afterwards: the sheet may
 *  hold a newer "already planned this week" marker than local storage. */
async function loadTasksFromSheet() {
  try {
    return await pullTasksFromSheet();
  } finally {
    checkTasksPlanning();
  }
}

loadTasksState();
initTasksView();
initTasksForm();
initTasksPlanning();
initTasksInsights();
