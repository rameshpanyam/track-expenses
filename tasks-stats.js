/* ═══════════════════════════════════════════════════════════════════
   TASKS · STATS  (v31.0)
   Progress, history, weekly streak, leftovers, review/skip lookups.
   Pure reads over tasksState — nothing here writes.

   "Entries" for a period = tasks currently IN it, plus tasks that were
   carried OUT of it (counted as unfinished). That keeps history honest:
   moving a task forward can't quietly inflate last week's score.
   Dropped tasks are excluded from the totals.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

function tasksEntries(horizon, key) {
  const entries = [];
  for (const task of tasksState.tasks) {
    if (task.horizon !== horizon) continue;
    if (task.periodKey === key)               entries.push({ task, status: task.status, moved: false });
    else if (task.carriedFrom.includes(key))  entries.push({ task, status: 'todo',      moved: true  });
  }
  return entries;
}

function tasksSummarize(entries) {
  const counts = Object.fromEntries(TASKS_STATUSES.map(s => [s.id, 0]));
  for (const e of entries) counts[e.status] += 1;
  const total = entries.length - counts.dropped;
  const done  = counts.completed;
  return {
    done, total, counts,
    pct:   total ? Math.round((done / total) * 100) : 0,
    moved: entries.filter(e => e.moved).length,
  };
}

function tasksPeriodStats(horizon, key) {
  return tasksSummarize(tasksEntries(horizon, key));
}

/** Done / total of a parent's linked children (dropped ones ignored). */
function tasksChildProgress(task) {
  const kids = tasksChildren(task.id).filter(k => k.status !== 'dropped');
  return { done: kids.filter(k => k.status === 'completed').length, total: kids.length };
}

/** Active (non-dropped, non-moved) tasks planned in a period. */
function tasksPlannedCount(horizon, key) {
  return tasksOfPeriod(horizon, key).filter(t => t.status !== 'dropped').length;
}

/** Open tasks left behind in periods BEFORE the current one. */
function tasksLeftovers(horizon) {
  const current = tasksCurrentPeriod(horizon);
  return tasksState.tasks.filter(t =>
    t.horizon === horizon && tasksIsOpen(t) && t.periodKey < current);
}

function tasksReviewFor(horizon, key) {
  return tasksState.reviews.find(r => r.horizon === horizon && r.periodKey === key) || null;
}

function tasksWasSkipped(horizon, key) {
  return tasksState.planning.skipped.includes(`${horizon}:${key}`);
}

/* ─── Streak: consecutive weeks that planned AND hit the target % ── */
function tasksWeekQualifies(key) {
  const s = tasksPeriodStats('week', key);
  return s.total > 0 && s.pct >= tasksState.settings.streakPct;
}

/** The running week counts if it already qualifies; it never BREAKS a
 *  streak while it is still in progress. Stops at the first miss — and
 *  an empty week (before you started) is a miss, so the loop ends. */
function tasksWeeklyStreak() {
  const current = tasksCurrentPeriod('week');
  let streak = tasksWeekQualifies(current) ? 1 : 0;
  let key    = tasksShiftPeriod('week', current, -1);
  while (tasksWeekQualifies(key)) {
    streak += 1;
    key = tasksShiftPeriod('week', key, -1);
  }
  return streak;
}

/** Newest first: the current period, then `count - 1` before it. */
function tasksHistory(horizon, count) {
  let key = tasksCurrentPeriod(horizon);
  const rows = [];
  for (let i = 0; i < count; i++) {
    const review = tasksReviewFor(horizon, key);
    rows.push({
      key,
      label:      tasksPeriodLabel(horizon, key),
      stats:      tasksPeriodStats(horizon, key),
      skipped:    tasksWasSkipped(horizon, key),
      reflection: review ? review.reflection : '',
    });
    key = tasksShiftPeriod(horizon, key, -1);
  }
  return rows;
}
