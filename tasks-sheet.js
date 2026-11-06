/* ═══════════════════════════════════════════════════════════════════
   TASKS · GOOGLE SHEETS SYNC  (v31.0)

   New tab names on purpose: the v1 "Tasks" tab has different columns,
   so reusing it would make old rows parse as garbage.

     "TasksV2"   — 11 cols: ID|Title|Horizon|PeriodKey|Status|BlockedReason|
                            ParentId|CarriedFrom|CompletedAt|CreatedAt|UpdatedAt
     "TasksMeta" —  2 cols: Key|Value   (reviews / planning / settings as JSON)

   One generic ensure/write pair serves both tabs.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

const TASKS_TAB = {
  name: 'TasksV2',
  headers: ['ID','Title','Horizon','PeriodKey','Status','BlockedReason',
            'ParentId','CarriedFrom','CompletedAt','CreatedAt','UpdatedAt'],
};
const TASKS_META_TAB = { name: 'TasksMeta', headers: ['Key','Value'] };
const TASKS_META_KEYS = ['reviews', 'planning', 'settings'];
const TASKS_CARRIED_SEPARATOR = '|';
const TASKS_SHEET_CLEAR_PADDING = 200; // stale rows to wipe below the data

function tasksSheetsReady() {
  return !!(window.spreadsheetId && window.accessToken &&
            typeof window.sheetsRequest === 'function');
}

function tasksLastCol(tab) {
  return String.fromCharCode(64 + tab.headers.length); // 2 → 'B', 11 → 'K'
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

/* ─── Row <-> object mapping ─────────────────────────────────────── */
function tasksToRow(t) {
  return [
    t.id, t.title, t.horizon, t.periodKey, t.status, t.blockedReason,
    t.parentId || '', t.carriedFrom.join(TASKS_CARRIED_SEPARATOR),
    t.completedAt || '', t.createdAt, t.updatedAt,
  ];
}

function tasksFromRow(r) {
  return {
    id: r[0], title: r[1], horizon: r[2], periodKey: r[3], status: r[4],
    blockedReason: r[5] || '',
    parentId:      r[6] || null,
    carriedFrom:   r[7] ? r[7].split(TASKS_CARRIED_SEPARATOR) : [],
    completedAt:   r[8] || null,
    createdAt:     r[9] || '',
    updatedAt:     r[10] || '',
  };
}

function tasksParseJson(text) {
  try { return JSON.parse(text); } catch (e) { return undefined; }
}

async function syncTasksToSheet() {
  if (!tasksSheetsReady()) return;
  if (!tasksState) loadTasksState();
  await Promise.all([ensureTasksTab(TASKS_TAB), ensureTasksTab(TASKS_META_TAB)]);

  const metaRows = TASKS_META_KEYS.map(k => [k, JSON.stringify(tasksState[k])]);
  await writeTasksTab(TASKS_TAB, tasksState.tasks.map(tasksToRow));
  await writeTasksTab(TASKS_META_TAB, metaRows);
}

/** Pull from sheet into local state (called on sign-in). Sheet wins —
 *  unless it is completely empty (first sign-in), then local data is
 *  pushed up instead. Returns true when the sheet was reachable. */
async function pullTasksFromSheet() {
  if (!tasksSheetsReady()) return false;
  if (!tasksState) loadTasksState();
  await Promise.all([ensureTasksTab(TASKS_TAB), ensureTasksTab(TASKS_META_TAB)]);

  const sid = window.spreadsheetId;
  const last = tasksLastCol(TASKS_TAB);
  const [taskData, metaData] = await Promise.all([
    window.sheetsRequest('GET', `/${sid}/values/${TASKS_TAB.name}!A:${last}`),
    window.sheetsRequest('GET', `/${sid}/values/${TASKS_META_TAB.name}!A:B`),
  ]);

  const taskRows = (taskData.values || []).slice(1).filter(r => r[0] && r[1]);
  const metaRows = (metaData.values || []).slice(1).filter(r => r[0] && r[1]);

  if (!taskRows.length && !metaRows.length) {
    await syncTasksToSheet();
    return true;
  }
  const meta = Object.fromEntries(metaRows.map(r => [r[0], tasksParseJson(r[1])]));
  tasksState = tasksNormalizeState({
    tasks:    taskRows.map(tasksFromRow),
    reviews:  meta.reviews  ?? tasksState.reviews,
    planning: meta.planning ?? tasksState.planning,
    settings: meta.settings ?? tasksState.settings,
  });
  saveTasksLocal();
  return true;
}
