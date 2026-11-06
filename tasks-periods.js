/* ═══════════════════════════════════════════════════════════════════
   TASKS · PERIODS  (v31.0)
   Pure date logic for the four horizons. No DOM, no storage.

   Period keys (plain strings, sortable with < and >):
     week  → the SUNDAY's ISO date   "2026-11-01"   (weeks run Sun–Sat)
     month → "2026-11"
     year  → "2026"
     long  → ""  (long-term targets have no period)
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

const TASKS_HORIZONS = [
  { id: 'week',  label: 'Weekly',    noun: 'week'  },
  { id: 'month', label: 'Monthly',   noun: 'month' },
  { id: 'year',  label: 'Yearly',    noun: 'year'  },
  { id: 'long',  label: 'Long-term', noun: ''      },
];

/** A task may link UP to one of these. long-term has no children. */
const TASKS_PARENT_HORIZON = { week: 'month', month: 'year' };
const TASKS_CHILD_HORIZON  = { month: 'week',  year: 'month' };

const TASKS_WEEK_START_DAY = 0; // 0 = Sunday

function tasksHorizon(id) {
  return TASKS_HORIZONS.find(h => h.id === id) || null;
}

function tasksHasPeriod(horizon) {
  return horizon !== 'long';
}

/* ─── ISO date helpers (local time, never UTC) ───────────────────── */
function tasksIso(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function tasksParseIso(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/* ─── Period keys ────────────────────────────────────────────────── */
function tasksPeriodKey(horizon, iso) {
  switch (horizon) {
    case 'week': {
      const d = tasksParseIso(iso);
      const back = (d.getDay() - TASKS_WEEK_START_DAY + 7) % 7;
      d.setDate(d.getDate() - back);
      return tasksIso(d);
    }
    case 'month': return iso.slice(0, 7);
    case 'year':  return iso.slice(0, 4);
    default:      return '';
  }
}

function tasksCurrentPeriod(horizon) {
  return tasksPeriodKey(horizon, tasksIso(new Date()));
}

/** Move a period key forwards (+1) or backwards (-1). */
function tasksShiftPeriod(horizon, key, delta) {
  switch (horizon) {
    case 'week': {
      const d = tasksParseIso(key);
      d.setDate(d.getDate() + 7 * delta);
      return tasksIso(d);
    }
    case 'month': {
      const [y, m] = key.split('-').map(Number);
      return tasksIso(new Date(y, m - 1 + delta, 1)).slice(0, 7);
    }
    case 'year': return String(Number(key) + delta);
    default:     return '';
  }
}

/** Calendar months touched by a period (used to offer parent goals). */
function tasksPeriodMonths(horizon, key) {
  if (horizon === 'week') {
    const start = tasksParseIso(key);
    const end   = new Date(start);
    end.setDate(end.getDate() + 6);
    return [...new Set([tasksIso(start).slice(0, 7), tasksIso(end).slice(0, 7)])];
  }
  return horizon === 'month' ? [key] : [];
}

/* ─── Labels ─────────────────────────────────────────────────────── */
function tasksShortDate(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function tasksPeriodLabel(horizon, key) {
  switch (horizon) {
    case 'week': {
      const start = tasksParseIso(key);
      const end   = new Date(start);
      end.setDate(end.getDate() + 6);
      return `${tasksShortDate(start)} – ${tasksShortDate(end)}`;
    }
    case 'month': {
      const [y, m] = key.split('-').map(Number);
      return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    case 'year': return key;
    default:     return 'Long-term';
  }
}

/** "This week" / "Last week" / "Next month" … or the plain label. */
function tasksPeriodName(horizon, key) {
  const noun = (tasksHorizon(horizon) || {}).noun;
  if (!noun) return 'Long-term';
  const current = tasksCurrentPeriod(horizon);
  if (key === current)                                return `This ${noun}`;
  if (key === tasksShiftPeriod(horizon, current, -1)) return `Last ${noun}`;
  if (key === tasksShiftPeriod(horizon, current,  1)) return `Next ${noun}`;
  return tasksPeriodLabel(horizon, key);
}
