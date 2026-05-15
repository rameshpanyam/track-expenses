/* ═══════════════════════════════════════════════════════════
   EXPENSE TRACKER — Google Sheets + Financial Dashboard
   ═══════════════════════════════════════════════════════════ */
const CLIENT_ID = '1093636568303-n89biq36ui8as34r9dblglcd91o44crq.apps.googleusercontent.com';

/* ── Sheets config ─────────────────────────────────────────── */
/* Scopes:
   - spreadsheets        → full r/w on any sheet by ID (used by all CRUD ops)
   - drive.metadata.readonly → list every spreadsheet in the user's Drive
     (metadata only — names, IDs, modifiedTime — no file contents)
   NOTE: drive.metadata.readonly must be added to the OAuth consent screen in
   Google Cloud Console for project 1093636568303. */
const SCOPES           = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.metadata.readonly';
const SPREADSHEET_NAME = 'Track Expenses';
const TAB_NAME         = 'Expenses';
const HEADERS          = ['Date', 'Category', 'Amount', 'Note', 'CreatedAt'];

/* Budget tab — auto-created on first budget save */
const BUDGET_TAB_NAME  = 'Budgets';
const BUDGET_HEADERS   = ['Month', 'Year', 'Budget', 'Spent', 'Status', 'Spillover', 'UpdatedAt'];

/* Categories tab — auto-created on first category save. Persisting custom
   categories to the Sheet is essential so they survive a fresh sign-in or
   a Safari "Clear Website Data" wipe (which kills localStorage). */
const CATEGORY_TAB_NAME = 'Categories';
const CATEGORY_HEADERS  = ['Key', 'Label', 'Icon', 'Color', 'CreatedAt'];

/* ── Categories ────────────────────────────────────────────── */
const CATEGORIES = [
  { key: 'food',     icon: '🍽️', label: 'Food',     color: '#FF6B6B' },
  { key: 'grocery',  icon: '🛒', label: 'Grocery',  color: '#26C6DA' },
  { key: 'market',   icon: '🥦', label: 'Market',   color: '#66BB6A' },
  { key: 'medicine', icon: '💊', label: 'Medicine', color: '#AB47BC' },
  { key: 'petrol',   icon: '⛽', label: 'Petrol',   color: '#FFA726' },
  { key: 'recharge', icon: '📱', label: 'Recharge', color: '#7C5CFC' },
  { key: 'water',    icon: '💧', label: 'Water',    color: '#42A5F5' },
  { key: 'gifts',    icon: '🎁', label: 'Gifts',    color: '#EC407A' },
  { key: 'other',    icon: '📦', label: 'Other',    color: '#78909C' },
];
/* ── Custom categories (persisted in localStorage) ─────────── */
/* IMPORTANT: declared with `var` (not `let`) at script top-level so they
   become real window.* properties. features.js reads many of these via
   window.allExpenses / window.viewMonth / window.customCategories etc.
   A `let` at top level creates a script binding but does NOT attach to
   window — caused the heatmap to silently render zeros in v25–v25.2. */
var customCategories = JSON.parse(localStorage.getItem('customCategories') || '[]');

function allCategories() { return [...CATEGORIES, ...customCategories]; }

let CAT_MAP = buildCatMap();
function buildCatMap() {
  return Object.fromEntries(allCategories().map(c => [c.key, c]));
}
function rebuildCatMap() { CAT_MAP = buildCatMap(); }

/* Colour palette for the "Add Category" picker */
const CAT_COLOR_PALETTE = [
  '#FF6B6B','#FF8A65','#FFCA28','#D4E157','#66BB6A',
  '#26C6DA','#42A5F5','#5C6BC0','#7C5CFC','#AB47BC',
  '#EC407A','#F06292','#78909C','#FFA726','#8D6E63',
];
let newCatColor = CAT_COLOR_PALETTE[0];

/* ── State ─────────────────────────────────────────────────── */
/* Cross-script globals: declared as `var` so features.js can read them
   via window.* (see customCategories note above for the full rationale). */
let tokenClient   = null;
let accessToken   = null;
let tokenExpiry   = 0;
var spreadsheetId = localStorage.getItem('expenseSheetId') || null;
var sheetGid      = Number(localStorage.getItem('expenseSheetGid') ?? -1);
var budgetGid     = Number(localStorage.getItem('budgetSheetGid') ?? -1);
var categoryGid   = Number(localStorage.getItem('categorySheetGid') ?? -1);
var allExpenses   = [];
var allBudgets    = [];          /* { rowIndex, month, year, budget, spent, status, spillover, updatedAt } */
let lastWrapMonth = localStorage.getItem('lastWrapMonth') || '';   /* yyyy-mm of last shown wrap-up */
var currentView   = 'add';
var selectedCat   = null;
var viewMonth     = new Date(); viewMonth.setDate(1);
var pendingDeleteRow = null;

/* Chart instances — must destroy before recreating */
let barChart    = null;
let donutChart  = null;

/* ═══════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════ */
const fmt = amount =>
  '₹' + Number(amount).toLocaleString('en-IN', { maximumFractionDigits: 0 });

function fmtDate(dateStr) {
  if (!dateStr) return '';
  const [, m, d] = dateStr.split('-');
  return `${parseInt(d)} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m)-1]}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/* HTML-escape user-supplied strings before injecting into innerHTML. */
function escapeHTML(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* Confetti burst — spawns money emojis from the given element's center,
   each shooting outward in a random direction. Pure CSS animation, no deps. */
function burstConfetti(originEl) {
  if (!originEl) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const rect = originEl.getBoundingClientRect();
  const cx   = rect.left + rect.width  / 2;
  const cy   = rect.top  + rect.height / 2;
  const symbols = ['₹', '💸', '💰', '🪙', '✨'];
  const layer = document.createElement('div');
  layer.className = 'confetti-layer';
  for (let i = 0; i < 14; i++) {
    const p = document.createElement('span');
    p.className = 'confetti-piece';
    p.textContent = symbols[Math.floor(Math.random() * symbols.length)];
    const angle = (Math.PI * 2 * i) / 14 + (Math.random() - .5) * .4;
    const dist  = 80 + Math.random() * 90;
    const dx    = Math.cos(angle) * dist;
    const dy    = Math.sin(angle) * dist - 30;       // bias upward
    p.style.left = cx + 'px';
    p.style.top  = cy + 'px';
    p.style.setProperty('--dx', dx + 'px');
    p.style.setProperty('--dy', dy + 'px');
    p.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
    p.style.animationDelay = (Math.random() * 60) + 'ms';
    layer.appendChild(p);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 1400);
}

function monthLabel(date) {
  return date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

function monthShort(date) {
  return date.toLocaleDateString('en-IN', { month: 'short' });
}

function daysElapsedInMonth(date) {
  const now   = new Date();
  const isNow = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  return isNow
    ? now.getDate()
    : new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function expensesForMonth(date) {
  const y = date.getFullYear(), m = date.getMonth() + 1;
  return allExpenses.filter(e => {
    if (!e.date) return false;
    const [ey, em] = e.date.split('-').map(Number);
    return ey === y && em === m;
  });
}

/* ── Toast ─────────────────────────────────────────────────── */
function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent  = msg;
  t.style.background = isError ? 'var(--red)' : 'var(--dark-card)';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

/* ── Loading ───────────────────────────────────────────────── */
function setLoading(msg)  {
  document.getElementById('loading-msg').textContent = msg || 'Loading…';
  document.getElementById('loading-overlay').style.display = 'flex';
}
function clearLoading()   { document.getElementById('loading-overlay').style.display = 'none'; }

/* ── Category badge background ─────────────────────────────── */
function catBg(cat) {
  const c = CAT_MAP[cat];
  return c ? c.color + '22' : '#78909C22';
}

/* ═══════════════════════════════════════════════════════════
   GOOGLE SHEETS API
   ═══════════════════════════════════════════════════════════ */
async function sheetsRequest(method, path, body) {
  const url = path.startsWith('https') ? path : `https://sheets.googleapis.com/v4/spreadsheets${path}`;
  const r   = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error?.message || `Sheets API ${method} → HTTP ${r.status}`);
  }
  return r.json();
}

/* ── Verify a stored spreadsheet ID is still valid ─────────── */
async function verifyStoredSheet() {
  if (!spreadsheetId) return false;
  try {
    const dr = await fetch(
      `https://www.googleapis.com/drive/v3/files/${spreadsheetId}?fields=id,trashed`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!dr.ok) return false;
    const info = await dr.json();
    if (info.trashed) return false;

    /* Make sure the Expenses tab exists */
    const meta = await sheetsRequest('GET', `/${spreadsheetId}?fields=sheets.properties`);
    const tab  = meta.sheets.find(s => s.properties.title === TAB_NAME);
    if (tab) {
      sheetGid = tab.properties.sheetId;
      localStorage.setItem('expenseSheetGid', sheetGid);
      return true;
    }
    /* Tab missing — add it */
    const res = await sheetsRequest('POST', `/${spreadsheetId}:batchUpdate`, {
      requests: [{ addSheet: { properties: { title: TAB_NAME } } }]
    });
    sheetGid = res.replies[0].addSheet.properties.sheetId;
    localStorage.setItem('expenseSheetGid', sheetGid);
    await writeHeaders();
    return true;
  } catch (e) {
    console.warn('Stored sheet invalid:', e.message);
    return false;
  }
}

/* ── Set the active sheet (called from chooser) ───────────── */
async function setActiveSheet(id) {
  spreadsheetId = id;
  localStorage.setItem('expenseSheetId', id);

  /* Get tab info — create Expenses tab if missing */
  const meta = await sheetsRequest('GET', `/${spreadsheetId}?fields=sheets.properties`);
  let tab = meta.sheets.find(s => s.properties.title === TAB_NAME);
  if (!tab) {
    const res = await sheetsRequest('POST', `/${spreadsheetId}:batchUpdate`, {
      requests: [{ addSheet: { properties: { title: TAB_NAME } } }]
    });
    sheetGid = res.replies[0].addSheet.properties.sheetId;
    localStorage.setItem('expenseSheetGid', sheetGid);
    await writeHeaders();
  } else {
    sheetGid = tab.properties.sheetId;
    localStorage.setItem('expenseSheetGid', sheetGid);
    /* Ensure header row exists */
    const data = await sheetsRequest('GET', `/${spreadsheetId}/values/${TAB_NAME}!A1:E1`);
    if (!data.values || data.values.length === 0) await writeHeaders();
  }
}

/* ── Create a brand-new spreadsheet ───────────────────────── */
async function createNewSpreadsheet(customName) {
  const title = (customName && customName.trim()) || SPREADSHEET_NAME;
  const created = await sheetsRequest('POST', '', {
    properties: { title },
    sheets:     [{ properties: { title: TAB_NAME } }],
  });
  spreadsheetId = created.spreadsheetId;
  sheetGid      = created.sheets[0].properties.sheetId;
  localStorage.setItem('expenseSheetId', spreadsheetId);
  localStorage.setItem('expenseSheetGid', sheetGid);
  await writeHeaders();
}

async function writeHeaders() {
  await sheetsRequest('POST',
    `/${spreadsheetId}/values/${TAB_NAME}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { values: [HEADERS] });
}

async function loadExpenses() {
  const data = await sheetsRequest('GET', `/${spreadsheetId}/values/${TAB_NAME}!A:E`);
  const rows = data.values || [];
  allExpenses = rows.slice(1)
    .map((row, i) => ({
      rowIndex:  i + 2,
      date:      row[0] || '',
      category:  row[1] || '',
      amount:    parseFloat(row[2]) || 0,
      note:      row[3] || '',
      createdAt: row[4] || '',
    }))
    .filter(e => e.date && e.amount > 0);
}

async function appendExpenseRow(exp) {
  await sheetsRequest('POST',
    `/${spreadsheetId}/values/${TAB_NAME}!A:E:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { values: [[exp.date, exp.category, exp.amount, exp.note, exp.createdAt]] });
}

async function deleteSheetRow(rowIndex) {
  if (sheetGid < 0) {
    const meta = await sheetsRequest('GET', `/${spreadsheetId}?fields=sheets.properties`);
    const tab  = meta.sheets.find(s => s.properties.title === TAB_NAME);
    sheetGid   = tab?.properties.sheetId ?? 0;
    localStorage.setItem('expenseSheetGid', sheetGid);
  }
  await sheetsRequest('POST', `/${spreadsheetId}:batchUpdate`, {
    requests: [{ deleteDimension: {
      range: { sheetId: sheetGid, dimension: 'ROWS', startIndex: rowIndex - 1, endIndex: rowIndex }
    }}]
  });
}

/* ═══════════════════════════════════════════════════════════
   BUDGET DATA LAYER
   - Lazy-creates a "Budgets" tab the first time a budget is saved.
   - Schema: Month | Year | Budget | Spent | Status | Spillover | UpdatedAt
   - One row per (year, month). Upserts only — no destructive deletes
     unless user explicitly removes a budget.
   ═══════════════════════════════════════════════════════════ */

/* Ensure the Budgets tab exists; create + write headers if not. */
async function ensureBudgetTab() {
  if (!spreadsheetId) return false;
  const meta = await sheetsRequest('GET', `/${spreadsheetId}?fields=sheets.properties`);
  const tab  = meta.sheets.find(s => s.properties.title === BUDGET_TAB_NAME);
  if (tab) {
    budgetGid = tab.properties.sheetId;
    localStorage.setItem('budgetSheetGid', budgetGid);
    /* Ensure headers row exists */
    const data = await sheetsRequest('GET', `/${spreadsheetId}/values/${BUDGET_TAB_NAME}!A1:G1`);
    if (!data.values || data.values.length === 0) {
      await sheetsRequest('POST',
        `/${spreadsheetId}/values/${BUDGET_TAB_NAME}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        { values: [BUDGET_HEADERS] });
    }
    return true;
  }
  /* Create tab + headers */
  const res = await sheetsRequest('POST', `/${spreadsheetId}:batchUpdate`, {
    requests: [{ addSheet: { properties: { title: BUDGET_TAB_NAME } } }]
  });
  budgetGid = res.replies[0].addSheet.properties.sheetId;
  localStorage.setItem('budgetSheetGid', budgetGid);
  await sheetsRequest('POST',
    `/${spreadsheetId}/values/${BUDGET_TAB_NAME}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { values: [BUDGET_HEADERS] });
  return true;
}

/* Load all budget rows into memory. Tolerates missing tab (returns empty). */
async function loadBudgets() {
  if (!spreadsheetId) { allBudgets = []; return; }
  try {
    const data = await sheetsRequest('GET', `/${spreadsheetId}/values/${BUDGET_TAB_NAME}!A:G`);
    const rows = data.values || [];
    allBudgets = rows.slice(1)
      .map((row, i) => ({
        rowIndex:  i + 2,
        month:     parseInt(row[0]) || 0,
        year:      parseInt(row[1]) || 0,
        budget:    parseFloat(row[2]) || 0,
        spent:     parseFloat(row[3]) || 0,
        status:    row[4] || 'good',
        spillover: parseFloat(row[5]) || 0,
        updatedAt: row[6] || '',
      }))
      .filter(b => b.month > 0 && b.year > 0);
  } catch (e) {
    /* Tab doesn't exist yet — that's fine, just means no budgets set */
    allBudgets = [];
  }
}

/* Find budget for a given (year, month). Returns null if not set. */
function getBudgetForMonth(year, month) {
  return allBudgets.find(b => b.year === year && b.month === month) || null;
}

/* Compute spent for a given calendar month from in-memory expenses. */
function computeSpentForMonth(year, month) {
  return allExpenses.reduce((sum, e) => {
    if (!e.date) return sum;
    const [ey, em] = e.date.split('-').map(Number);
    return (ey === year && em === month) ? sum + e.amount : sum;
  }, 0);
}

/* Derive verdict for a budget row (live for current month, locked for past). */
function deriveVerdict(year, month, budget, spent) {
  if (!budget || budget <= 0) return { status: 'no-budget', spillover: 0 };
  const spillover = Math.max(0, spent - budget);
  return { status: spillover > 0 ? 'bad' : 'good', spillover };
}

/* Upsert a budget row: write Month, Year, Budget, recomputed Spent/Status/Spillover. */
async function upsertBudgetRow(year, month, budgetAmount) {
  await ensureBudgetTab();
  const spent      = computeSpentForMonth(year, month);
  const v          = deriveVerdict(year, month, budgetAmount, spent);
  const updatedAt  = new Date().toISOString();
  const row        = [month, year, budgetAmount, spent, v.status, v.spillover, updatedAt];

  const existing = getBudgetForMonth(year, month);
  if (existing) {
    /* Update existing row in place */
    await sheetsRequest('PUT',
      `/${spreadsheetId}/values/${BUDGET_TAB_NAME}!A${existing.rowIndex}:G${existing.rowIndex}?valueInputOption=RAW`,
      { values: [row] });
  } else {
    /* Append new row */
    await sheetsRequest('POST',
      `/${spreadsheetId}/values/${BUDGET_TAB_NAME}!A:G:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { values: [row] });
  }
  await loadBudgets();
}

/* Recompute Spent/Status/Spillover for any budget row whose month matches an
   added/deleted expense. Called after every expense write so the Budgets tab
   stays in sync without the user having to do anything. */
async function recomputeBudgetForMonth(year, month) {
  const existing = getBudgetForMonth(year, month);
  if (!existing) return;             /* No budget set for that month — nothing to sync */
  const spent     = computeSpentForMonth(year, month);
  const v         = deriveVerdict(year, month, existing.budget, spent);
  const updatedAt = new Date().toISOString();
  const row       = [month, year, existing.budget, spent, v.status, v.spillover, updatedAt];
  await sheetsRequest('PUT',
    `/${spreadsheetId}/values/${BUDGET_TAB_NAME}!A${existing.rowIndex}:G${existing.rowIndex}?valueInputOption=RAW`,
    { values: [row] });
  /* Update in-memory copy so UI re-renders correctly without a full refetch */
  Object.assign(existing, { spent, status: v.status, spillover: v.spillover, updatedAt });
}

/* Remove a budget row entirely (user clicked "Remove budget for this month"). */
async function deleteBudgetRow(year, month) {
  const existing = getBudgetForMonth(year, month);
  if (!existing) return;
  if (budgetGid < 0) await ensureBudgetTab();
  await sheetsRequest('POST', `/${spreadsheetId}:batchUpdate`, {
    requests: [{ deleteDimension: {
      range: { sheetId: budgetGid, dimension: 'ROWS',
               startIndex: existing.rowIndex - 1, endIndex: existing.rowIndex }
    }}]
  });
  await loadBudgets();
}

/* ═══════════════════════════════════════════════════════════
   CUSTOM CATEGORIES DATA LAYER
   - Source of truth: the "Categories" tab on the user's Sheet.
   - localStorage is a hot cache only; if it's wiped (fresh sign-in,
     clear-site-data, new device), we re-hydrate from the Sheet.
   - One-time migration: if Sheet has none but localStorage has some,
     push them up so they sync across devices going forward.
   - Orphan recovery: expenses whose category key isn't in our list
     get a generated placeholder so old rows stay visible.
   ═══════════════════════════════════════════════════════════ */

/* Deterministic color for an orphan key — so the same key always
   gets the same color across reloads and devices. */
function colorForKey(key) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash) + key.charCodeAt(i);
    hash |= 0;
  }
  return CAT_COLOR_PALETTE[Math.abs(hash) % CAT_COLOR_PALETTE.length];
}

/* Best-effort label from a key: "custom_outside_food" → "Outside Food" */
function labelFromKey(key) {
  return key
    .replace(/^custom_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, m => m.toUpperCase());
}

/* Ensure the Categories tab exists; create + write headers if not. */
async function ensureCategoryTab() {
  if (!spreadsheetId) return false;
  const meta = await sheetsRequest('GET', `/${spreadsheetId}?fields=sheets.properties`);
  const tab  = meta.sheets.find(s => s.properties.title === CATEGORY_TAB_NAME);
  if (tab) {
    categoryGid = tab.properties.sheetId;
    localStorage.setItem('categorySheetGid', categoryGid);
    const data = await sheetsRequest('GET', `/${spreadsheetId}/values/${CATEGORY_TAB_NAME}!A1:E1`);
    if (!data.values || data.values.length === 0) {
      await sheetsRequest('POST',
        `/${spreadsheetId}/values/${CATEGORY_TAB_NAME}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        { values: [CATEGORY_HEADERS] });
    }
    return true;
  }
  const res = await sheetsRequest('POST', `/${spreadsheetId}:batchUpdate`, {
    requests: [{ addSheet: { properties: { title: CATEGORY_TAB_NAME } } }]
  });
  categoryGid = res.replies[0].addSheet.properties.sheetId;
  localStorage.setItem('categorySheetGid', categoryGid);
  await sheetsRequest('POST',
    `/${spreadsheetId}/values/${CATEGORY_TAB_NAME}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { values: [CATEGORY_HEADERS] });
  return true;
}

/* Append a single custom category row to the Sheet. */
async function appendCategoryRow(cat) {
  await ensureCategoryTab();
  await sheetsRequest('POST',
    `/${spreadsheetId}/values/${CATEGORY_TAB_NAME}!A:E:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { values: [[cat.key, cat.label, cat.icon, cat.color, new Date().toISOString()]] });
}

/* Read all custom categories from the Sheet. Handles three scenarios:
     1. Sheet has cats → that's the truth, overwrite local cache
     2. Sheet missing/empty but localStorage has cats → push them up
     3. Both empty → no-op
   Local-only cats (added on this device before sync) are also pushed up. */
async function loadCustomCategories() {
  if (!spreadsheetId) return;
  let sheetCats = null;
  try {
    const data = await sheetsRequest('GET', `/${spreadsheetId}/values/${CATEGORY_TAB_NAME}!A:E`);
    sheetCats = (data.values || []).slice(1)
      .map(r => ({
        key:   r[0] || '',
        label: r[1] || '',
        icon:  r[2] || '📦',
        color: r[3] || '#78909C',
      }))
      .filter(c => c.key && c.label);
  } catch (e) {
    /* Tab doesn't exist yet — treat as empty Sheet */
    sheetCats = null;
  }

  if (sheetCats === null || sheetCats.length === 0) {
    /* Sheet has nothing; if localStorage has cats, migrate them up so other
       devices recover them. We DO NOT clear localStorage here. */
    if (customCategories.length > 0) {
      try {
        await ensureCategoryTab();
        for (const c of customCategories) await appendCategoryRow(c);
        console.log('Migrated', customCategories.length, 'local categories to Sheet');
      } catch (e) {
        console.warn('Category migrate-up failed:', e.message);
      }
    }
    rebuildCatMap();
    return;
  }

  /* Sheet IS the truth — merge any local-only cats up first */
  const sheetKeys = new Set(sheetCats.map(c => c.key));
  const localOnly = customCategories.filter(c => !sheetKeys.has(c.key));
  if (localOnly.length > 0) {
    try {
      await ensureCategoryTab();
      for (const c of localOnly) await appendCategoryRow(c);
      sheetCats.push(...localOnly);
      console.log('Synced', localOnly.length, 'local-only categories up to Sheet');
    } catch (e) {
      console.warn('Local-only category sync failed:', e.message);
    }
  }

  customCategories = sheetCats;
  localStorage.setItem('customCategories', JSON.stringify(customCategories));
  rebuildCatMap();
}

/* For any expense whose category key is unknown (e.g. user wiped localStorage
   before we had Sheet sync), create a placeholder so the rows still render.
   Placeholders are persisted to the Sheet so they survive future reloads
   and other devices pick them up. User can later customize via UI. */
async function reconcileOrphanCategories() {
  const known = new Set(allCategories().map(c => c.key));
  const orphanKeys = new Set();
  for (const e of allExpenses) {
    if (e.category && !known.has(e.category)) orphanKeys.add(e.category);
  }
  if (orphanKeys.size === 0) return;

  const placeholders = [];
  for (const key of orphanKeys) {
    const placeholder = {
      key,
      label: labelFromKey(key),
      icon:  '📦',
      color: colorForKey(key),
    };
    customCategories.push(placeholder);
    placeholders.push(placeholder);
  }
  localStorage.setItem('customCategories', JSON.stringify(customCategories));
  rebuildCatMap();

  /* Persist to the Sheet best-effort so other devices auto-recover too */
  try {
    await ensureCategoryTab();
    for (const c of placeholders) await appendCategoryRow(c);
    console.log('Reconciled', placeholders.length, 'orphan categories');
  } catch (e) {
    console.warn('Orphan persist failed:', e.message);
  }

  showToast(`Recovered ${placeholders.length} categor${placeholders.length === 1 ? 'y' : 'ies'} from your data ✓`);
}

/* ═══════════════════════════════════════════════════════════
   GOOGLE AUTH
   ═══════════════════════════════════════════════════════════ */
function initGoogleAuth() {
  if (CLIENT_ID.includes('YOUR_GOOGLE_CLIENT_ID')) {
    const btn = document.getElementById('signin-btn');
    btn.textContent = '⚠️ CLIENT_ID not set — see README';
    btn.disabled    = true;
    return;
  }
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope:     SCOPES,
    callback:  handleTokenResponse,
  });
}

async function handleTokenResponse(resp) {
  if (resp.error) { showToast('Sign-in failed: ' + resp.error, true); clearLoading(); return; }
  accessToken = resp.access_token;
  tokenExpiry = Date.now() + resp.expires_in * 1000;

  document.getElementById('login-screen').style.display = 'none';

  /* If we have a stored sheet ID, try to use it directly. Otherwise prompt
     the user to pick or create a sheet. */
  setLoading('Checking your saved sheet…');
  let valid = false;
  try {
    valid = await verifyStoredSheet();
  } catch (e) {
    valid = false;
  }
  clearLoading();

  if (valid) {
    await enterMainApp();
  } else {
    spreadsheetId = null; sheetGid = -1;
    localStorage.removeItem('expenseSheetId');
    localStorage.removeItem('expenseSheetGid');
    showSheetChooser();
  }
}

/* Enter the main app once a sheet is selected */
async function enterMainApp() {
  document.getElementById('login-screen').style.display  = 'none';
  document.getElementById('sheet-chooser').style.display = 'none';
  document.getElementById('app').style.display           = 'flex';

  setLoading('Loading your expenses…');
  try {
    await loadExpenses();
    await loadCustomCategories();      /* Re-hydrate custom cats from Sheet */
    await reconcileOrphanCategories(); /* Recover orphan keys from old data */
    await loadBudgets();
    clearLoading();
    buildAddView();
    switchView('add');
    /* Show wrap-up toast if we just rolled into a new month (non-blocking) */
    setTimeout(() => maybeShowMonthWrapUp(), 600);
  } catch (e) {
    clearLoading();
    showToast('Error: ' + e.message, true);
    console.error(e);
  }
}

/* ═══════════════════════════════════════════════════════════
   SHEET CHOOSER
   ═══════════════════════════════════════════════════════════ */
async function showSheetChooser() {
  /* If user is not signed in yet, this should never be called — guard anyway */
  if (!accessToken) { showToast('Please sign in first', true); return; }

  /* Hide other screens, show chooser */
  document.getElementById('login-screen').style.display  = 'none';
  document.getElementById('app').style.display           = 'none';
  document.getElementById('sheet-chooser').style.display = 'flex';

  const loadingEl = document.getElementById('chooser-loading');
  const listEl    = document.getElementById('chooser-list');
  const emptyEl   = document.getElementById('chooser-empty');

  loadingEl.style.display = 'flex';
  listEl.style.display    = 'none';
  emptyEl.style.display   = 'none';
  listEl.innerHTML        = '';

  try {
    await ensureToken();
    const sheets = await listMySheets();
    loadingEl.style.display = 'none';

    if (sheets.length === 0) {
      emptyEl.style.display = 'block';
      return;
    }

    listEl.style.display = 'flex';
    listEl.innerHTML = sheets.map(s => {
      const safeName = (s.name || 'Untitled').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      return `
        <button class="chooser-item" onclick="chooseSheet('${s.id}')">
          <div class="chooser-item-icon">📊</div>
          <div class="chooser-item-text">
            <div class="chooser-item-name">${safeName}</div>
            <div class="chooser-item-meta">Updated ${formatRelative(s.modifiedTime)}</div>
          </div>
          <div class="chooser-item-arrow">›</div>
        </button>
      `;
    }).join('');
  } catch (e) {
    loadingEl.style.display = 'none';
    emptyEl.style.display   = 'block';
    document.querySelector('#chooser-empty p').textContent = 'Could not list sheets — ' + e.message;
    console.error(e);
  }
}

/* List spreadsheets accessible via drive.file scope (created/opened by this app) */
async function listMySheets() {
  const params = new URLSearchParams({
    q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    fields: 'files(id,name,modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: '50',
  });
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error?.message || `Drive HTTP ${r.status}`);
  }
  const data = await r.json();
  return data.files || [];
}

/* Format an ISO timestamp as a friendly relative string */
function formatRelative(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const now  = Date.now();
  const diff = Math.max(0, now - then);
  const min  = Math.floor(diff / 60000);
  if (min < 1)    return 'just now';
  if (min < 60)   return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24)    return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  if (day < 7)    return `${day} day${day !== 1 ? 's' : ''} ago`;
  return new Date(iso).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* User picked an existing sheet from the list */
async function chooseSheet(id) {
  setLoading('Opening sheet…');
  try {
    await ensureToken();
    await setActiveSheet(id);
    clearLoading();
    showToast('Sheet selected ✓');
    await enterMainApp();
  } catch (e) {
    clearLoading();
    showToast('Could not open: ' + e.message, true);
    console.error(e);
  }
}

/* User clicked "Create new sheet" in the chooser */
async function createNewSheetFromChooser() {
  const nameInput = document.getElementById('chooser-new-name');
  const name      = (nameInput?.value || '').trim() || SPREADSHEET_NAME;

  setLoading(`Creating "${name}"…`);
  try {
    await ensureToken();
    await createNewSpreadsheet(name);
    if (nameInput) nameInput.value = '';
    clearLoading();
    showToast('New sheet created ✓');
    await enterMainApp();
  } catch (e) {
    clearLoading();
    showToast('Create failed: ' + e.message, true);
    console.error(e);
  }
}

function signIn() {
  if (!tokenClient) { showToast('Google Sign-In loading, try again.', true); return; }
  tokenClient.requestAccessToken({ prompt: '' });
}

function signOut() {
  /* Do NOT call revoke() — revoking destroys the drive.file association so
     next sign-in can't find the existing sheet and creates a duplicate.
     Just clear local state; the access token expires naturally in ~1 hour. */
  google.accounts.id.disableAutoSelect(); /* prevent silent re-sign-in */
  accessToken   = null;
  spreadsheetId = null;
  sheetGid      = -1;
  allExpenses   = [];
  document.getElementById('app').style.display           = 'none';
  document.getElementById('sheet-chooser').style.display = 'none';
  document.getElementById('login-screen').style.display  = 'flex';
  destroyCharts();
}

async function ensureToken() {
  if (Date.now() < tokenExpiry - 60_000) return;
  await new Promise(resolve => {
    tokenClient.requestAccessToken({
      prompt: '',
      callback: (resp) => {
        if (!resp.error) { accessToken = resp.access_token; tokenExpiry = Date.now() + resp.expires_in * 1000; }
        resolve();
      }
    });
  });
}

function onGoogleLibraryLoad() { setTimeout(initGoogleAuth, 100); }

/* ═══════════════════════════════════════════════════════════
   ADD VIEW
   ═══════════════════════════════════════════════════════════ */
function buildCatGrid() {
  document.getElementById('cat-grid').innerHTML =
    allCategories().map(c => `
      <button class="cat-btn" data-cat="${c.key}" onclick="selectCat('${c.key}')">
        <div class="cat-icon-wrap" style="background:${c.color}22;">${c.icon}</div>
        <span class="cat-name">${c.label}</span>
      </button>
    `).join('') +
    `<button class="cat-btn add-cat-btn" onclick="openAddCatModal()">
      <div class="cat-icon-wrap add-cat-icon-wrap">＋</div>
      <span class="cat-name">New</span>
    </button>`;
}

function buildAddView() {
  buildCatGrid();
  document.getElementById('date-input').value = todayStr();
  refreshAddBtn();
  renderTodayTotal();
}

function selectCat(key) {
  selectedCat = key;
  document.querySelectorAll('.cat-btn').forEach(b =>
    b.classList.toggle('selected', b.dataset.cat === key)
  );
  refreshAddBtn();
}

function refreshAddBtn() {
  const amount = parseFloat(document.getElementById('amount-input').value);
  const btn    = document.querySelector('.add-btn');
  const ready  = amount > 0 && selectedCat != null;
  btn.disabled    = !ready;
  btn.textContent = ready
    ? `+ Add ₹${Number(amount).toLocaleString('en-IN', {maximumFractionDigits:0})}`
    : '+ Add Expense';
}

function renderTodayTotal() {
  const today = todayStr();
  const list  = allExpenses.filter(e => e.date === today);
  const total = list.reduce((s, e) => s + e.amount, 0);
  const el    = document.getElementById('today-total');
  if (!el) return;
  el.textContent  = total > 0 ? `Today so far: ${fmt(total)} · ${list.length} entr${list.length === 1 ? 'y' : 'ies'}` : '';
  el.style.display = total > 0 ? 'block' : 'none';
}

async function saveExpense() {
  const amountEl = document.getElementById('amount-input');
  const noteEl   = document.getElementById('note-input');
  const dateEl   = document.getElementById('date-input');
  const amount   = parseFloat(amountEl.value);

  if (!amount || amount <= 0) { amountEl.focus(); showToast('Enter an amount', true); return; }
  if (!selectedCat)            { showToast('Pick a category', true); return; }
  if (!dateEl.value)           { dateEl.focus(); return; }

  setLoading('Saving to Google Sheets…');
  try {
    await ensureToken();
    const dateValue = dateEl.value;
    await appendExpenseRow({ date: dateValue, category: selectedCat, amount, note: noteEl.value.trim(), createdAt: new Date().toISOString() });
    await loadExpenses();
    /* Keep Budgets tab in sync if a budget exists for this expense's month */
    const [ey, em] = dateValue.split('-').map(Number);
    try { await recomputeBudgetForMonth(ey, em); } catch (err) { console.warn('Budget sync failed:', err); }

    amountEl.value = '';
    noteEl.value   = '';
    dateEl.value   = todayStr();
    selectedCat    = null;
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('selected'));
    refreshAddBtn();
    renderTodayTotal();
    clearLoading();
    showToast('Saved ✓');
    burstConfetti(document.getElementById('add-btn'));
  } catch (e) {
    clearLoading();
    showToast('Save failed: ' + e.message, true);
    console.error(e);
  }
}

/* ═══════════════════════════════════════════════════════════
   DELETE
   ═══════════════════════════════════════════════════════════ */
function deleteExpense(rowIndex) {
  pendingDeleteRow = rowIndex;
  document.getElementById('confirm-modal').style.display = 'flex';
  document.getElementById('confirm-ok-btn').onclick = confirmDelete;
}
function closeConfirm() {
  pendingDeleteRow = null;
  document.getElementById('confirm-modal').style.display = 'none';
}
async function confirmDelete() {
  const row = pendingDeleteRow;   // capture BEFORE closeConfirm() nullifies it
  closeConfirm();
  if (row === null || row === undefined) return;

  setLoading('Deleting…');
  /* Capture the expense's month before deletion so we can resync its budget */
  const target  = allExpenses.find(e => e.rowIndex === row);
  const monthOf = target?.date ? target.date.split('-').map(Number) : null;
  try {
    await ensureToken();
    await deleteSheetRow(row);
    await loadExpenses();
    if (monthOf) {
      try { await recomputeBudgetForMonth(monthOf[0], monthOf[1]); } catch (err) { console.warn('Budget sync failed:', err); }
    }
    if (currentView === 'dashboard') renderDashboard();
    if (currentView === 'insights')  renderInsights();
    renderTodayTotal();
    clearLoading();
    showToast('Deleted — undo in Google Sheets ✓');
  } catch (e) {
    clearLoading();
    showToast('Delete failed: ' + e.message, true);
    console.error(e);
  }
}

/* ═══════════════════════════════════════════════════════════
   ADD CATEGORY MODAL
   ═══════════════════════════════════════════════════════════ */
function openAddCatModal() {
  /* Reset fields */
  document.getElementById('new-cat-icon').value = '';
  document.getElementById('new-cat-name').value = '';
  document.getElementById('add-cat-ok-btn').disabled = true;
  newCatColor = CAT_COLOR_PALETTE[0];

  /* Build colour picker */
  document.getElementById('new-cat-color-grid').innerHTML = CAT_COLOR_PALETTE.map(col => `
    <button class="color-swatch${col === newCatColor ? ' selected' : ''}"
            style="background:${col};"
            onclick="pickCatColor('${col}')"></button>
  `).join('');

  document.getElementById('add-cat-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('new-cat-icon').focus(), 80);
}

function pickCatColor(col) {
  newCatColor = col;
  /* Rebuild picker to reliably reflect selection (avoids hex vs rgb mismatch) */
  document.getElementById('new-cat-color-grid').innerHTML = CAT_COLOR_PALETTE.map(c => `
    <button class="color-swatch${c === col ? ' selected' : ''}"
            style="background:${c};"
            onclick="pickCatColor('${c}')"></button>
  `).join('');
}

function closeAddCatModal() {
  document.getElementById('add-cat-modal').style.display = 'none';
}

function validateNewCat() {
  const icon = document.getElementById('new-cat-icon').value.trim();
  const name = document.getElementById('new-cat-name').value.trim();
  document.getElementById('add-cat-ok-btn').disabled = !(icon && name);
}

async function saveNewCategory() {
  const icon  = document.getElementById('new-cat-icon').value.trim();
  const name  = document.getElementById('new-cat-name').value.trim();
  if (!icon || !name) { showToast('Enter both an icon and a name', true); return; }

  /* Guard duplicates */
  const key = 'custom_' + name.toLowerCase().replace(/\s+/g, '_');
  if (allCategories().find(c => c.key === key)) {
    showToast('Category "' + name + '" already exists', true); return;
  }

  const newCat = { key, icon, label: name, color: newCatColor };
  customCategories.push(newCat);
  localStorage.setItem('customCategories', JSON.stringify(customCategories));
  rebuildCatMap();

  closeAddCatModal();
  buildCatGrid();          /* rebuild cat grid with new button */
  showToast(`"${name}" added ✓`);

  /* Persist to Sheet so it survives re-login / clear-site-data / new device.
     Best-effort: if the sync fails the cat is still saved locally and will
     be migrated up the next time loadCustomCategories runs successfully. */
  try {
    await ensureToken();
    await appendCategoryRow(newCat);
  } catch (e) {
    console.warn('Category sync to Sheet failed (kept locally):', e.message);
    showToast('Saved locally — will sync on next reload', true);
  }
}

/* ═══════════════════════════════════════════════════════════
   MONTH HELPERS
   ═══════════════════════════════════════════════════════════ */
function monthExpenses() {
  const y = viewMonth.getFullYear(), m = viewMonth.getMonth() + 1;
  return allExpenses.filter(e => {
    if (!e.date) return false;
    const [ey, em] = e.date.split('-').map(Number);
    return ey === y && em === m;
  });
}

/* ═══════════════════════════════════════════════════════════
   DASHBOARD VIEW
   ═══════════════════════════════════════════════════════════ */
function destroyCharts() {
  if (barChart)   { barChart.destroy();   barChart   = null; }
  if (donutChart) { donutChart.destroy(); donutChart = null; }
}

function renderDashboard() {
  const expenses  = monthExpenses();
  const total     = expenses.reduce((s, e) => s + e.amount, 0);
  const days      = daysElapsedInMonth(viewMonth);
  const dailyAvg  = days > 0 ? total / days : 0;

  /* Category totals */
  const byCategory = {};
  expenses.forEach(e => { byCategory[e.category] = (byCategory[e.category] || 0) + e.amount; });
  const topCatEntry = Object.entries(byCategory).sort((a,b) => b[1]-a[1])[0];
  const topCat = topCatEntry ? CAT_MAP[topCatEntry[0]] : null;

  /* Month-over-month */
  const prevMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1);
  const prevTotal = expensesForMonth(prevMonth).reduce((s, e) => s + e.amount, 0);
  const momPct    = prevTotal > 0 ? ((total - prevTotal) / prevTotal * 100).toFixed(1) : null;

  /* Hero card */
  document.getElementById('dash-hero-month').textContent  = monthLabel(viewMonth);
  document.getElementById('dash-hero-amount').textContent = fmt(total);
  document.getElementById('dash-hero-sub').textContent    =
    `${expenses.length} expense${expenses.length !== 1 ? 's' : ''} · ${days} days tracked`;

  const badge = document.getElementById('dash-mom-badge');
  if (momPct === null) {
    badge.className   = 'dash-hero-badge flat';
    badge.textContent = '— vs last month';
  } else {
    const up = Number(momPct) > 0;
    badge.className   = `dash-hero-badge ${up ? 'up' : 'down'}`;
    badge.textContent = `${up ? '↑' : '↓'} ${Math.abs(momPct)}% vs last month (${fmt(prevTotal)})`;
  }

  /* Budget hero overlay — green / red / no-budget CTA */
  applyBudgetToHero(viewMonth, total);

  /* Stat pills */
  document.getElementById('pill-daily').textContent   = fmt(dailyAvg);
  document.getElementById('pill-topcat').textContent  = topCat ? topCat.icon : '—';
  document.getElementById('pill-entries').textContent = expenses.length;

  /* ── Bar chart: last 6 months ── */
  const months6 = Array.from({ length: 6 }, (_, i) =>
    new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 5 + i, 1)
  );
  const barLabels = months6.map(m => monthShort(m));
  const barData   = months6.map(m => expensesForMonth(m).reduce((s, e) => s + e.amount, 0));
  const barColors = months6.map((m, i) =>
    i === 5 ? 'rgba(124,92,252,1)' : 'rgba(124,92,252,0.25)'
  );

  document.getElementById('bar-chart-sub').textContent =
    `${barLabels[0]} → ${barLabels[5]} · current month highlighted`;

  destroyCharts();

  const barCtx = document.getElementById('monthlyBarChart').getContext('2d');
  barChart = new Chart(barCtx, {
    type: 'bar',
    data: {
      labels: barLabels,
      datasets: [{
        data:            barData,
        backgroundColor: barColors,
        borderRadius:    8,
        borderSkipped:   false,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ' ' + fmt(ctx.raw),
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: 'IBM Plex Sans', size: 11 }, color: '#9098B1' } },
        y: {
          grid: { color: 'rgba(0,0,0,.05)' },
          ticks: {
            font: { family: 'IBM Plex Sans', size: 10 },
            color: '#9098B1',
            callback: v => v >= 1000 ? '₹' + (v/1000).toFixed(0) + 'k' : '₹' + v,
          }
        }
      }
    }
  });

  /* ── Donut chart: this month categories ── */
  const catSorted = allCategories()
    .map(c => ({ ...c, amount: byCategory[c.key] || 0 }))
    .filter(c => c.amount > 0)
    .sort((a,b) => b.amount - a.amount);

  document.getElementById('donut-chart-sub').textContent = monthLabel(viewMonth);
  document.getElementById('donut-center-val').textContent = fmt(total);

  if (catSorted.length > 0) {
    const donutCtx = document.getElementById('categoryDonutChart').getContext('2d');
    donutChart = new Chart(donutCtx, {
      type: 'doughnut',
      data: {
        labels:   catSorted.map(c => c.label),
        datasets: [{
          data:              catSorted.map(c => c.amount),
          backgroundColor:   catSorted.map(c => c.color),
          borderWidth:       2,
          borderColor:       '#FFFFFF',
          hoverBorderWidth:  3,
          borderRadius:      4,
        }]
      },
      options: {
        responsive: false,
        cutout: '68%',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmt(ctx.raw)}` } }
        }
      }
    });
  }

  /* Donut legend */
  document.getElementById('donut-legend').innerHTML = catSorted.slice(0, 5).map(c => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${c.color};"></div>
      <span class="legend-name">${c.label}</span>
      <span class="legend-amt">${fmt(c.amount)}</span>
    </div>
  `).join('') || '<p style="font-size:.8rem;color:var(--muted)">No data for this month</p>';

  /* ── Smart insights ── */
  const insights = buildInsights(expenses, total, dailyAvg, topCat, topCatEntry, prevTotal, momPct);
  document.getElementById('insights-list').innerHTML = insights.map(i => `
    <div class="insight-card">
      <div class="insight-icon" style="background:${i.bg};">${i.icon}</div>
      <div class="insight-body">
        <div class="insight-title">${i.title}</div>
        <div class="insight-sub">${i.sub}</div>
      </div>
      ${i.val ? `<div class="insight-val">${i.val}</div>` : ''}
    </div>
  `).join('');

  /* ── All entries for this month — grouped by category, collapsible ── */
  const byCat = {};
  expenses.forEach(e => {
    if (!byCat[e.category]) byCat[e.category] = [];
    byCat[e.category].push(e);
  });
  /* Sort entries inside each category by date desc */
  Object.keys(byCat).forEach(k => {
    byCat[k].sort((a, b) => b.date.localeCompare(a.date) || b.rowIndex - a.rowIndex);
  });
  /* Sort categories by total spend desc so biggest spenders appear first */
  const catKeys = Object.keys(byCat).sort((a, b) => {
    const ta = byCat[a].reduce((s, e) => s + e.amount, 0);
    const tb = byCat[b].reduce((s, e) => s + e.amount, 0);
    return tb - ta;
  });

  /* Preserve which categories the user expanded across re-renders */
  if (!window.expandedCatGroups) window.expandedCatGroups = new Set();

  document.getElementById('dash-entries').innerHTML = catKeys.length === 0
    ? `<div class="empty-state"><div class="empty-icon">📭</div><p>No entries for ${monthLabel(viewMonth)}.<br/>Tap <strong>Add</strong> to record one.</p></div>`
    : catKeys.map(catKey => {
        const rows  = byCat[catKey];
        const cat   = CAT_MAP[catKey] || { icon: '📦', label: catKey, color: '#78909C' };
        const ctot  = rows.reduce((s, e) => s + e.amount, 0);
        const count = rows.length;
        const open  = window.expandedCatGroups.has(catKey) ? 'expanded' : '';
        return `
          <div class="cat-group ${open}" data-cat="${catKey}">
            <button class="cat-group-header" onclick="toggleCatGroup('${catKey.replace(/'/g, "\\'")}')">
              <div class="cat-group-icon" style="background:${cat.color}22;">${cat.icon}</div>
              <div class="cat-group-info">
                <div class="cat-group-name">${cat.label}</div>
                <div class="cat-group-meta">${count} ${count === 1 ? 'entry' : 'entries'}</div>
              </div>
              <div class="cat-group-total">${fmt(ctot)}</div>
              <div class="cat-group-chevron">▾</div>
            </button>
            <div class="cat-group-body">
              ${rows.map(e => expenseRowHTML(e, false, true)).join('')}
            </div>
          </div>`;
      }).join('');
}

function toggleCatGroup(catKey) {
  if (!window.expandedCatGroups) window.expandedCatGroups = new Set();
  const el = document.querySelector(`.cat-group[data-cat="${CSS.escape(catKey)}"]`);
  if (!el) return;
  const isExpanded = el.classList.toggle('expanded');
  if (isExpanded) window.expandedCatGroups.add(catKey);
  else            window.expandedCatGroups.delete(catKey);
}

function buildInsights(expenses, total, dailyAvg, topCat, topCatEntry, prevTotal, momPct) {
  const insights = [];

  /* Daily average */
  if (total > 0) {
    insights.push({
      icon: '📅', bg: 'rgba(124,92,252,.12)',
      title: 'Daily average spend',
      sub:   `Based on ${daysElapsedInMonth(viewMonth)} days tracked this month`,
      val:   fmt(dailyAvg),
    });
  }

  /* Top category */
  if (topCat && topCatEntry) {
    const pct = total > 0 ? Math.round(topCatEntry[1] / total * 100) : 0;
    insights.push({
      icon: topCat.icon, bg: topCat.color + '22',
      title: `${topCat.label} is your biggest spend`,
      sub:   `${pct}% of your total this month`,
      val:   fmt(topCatEntry[1]),
    });
  }

  /* vs last month */
  if (momPct !== null) {
    const up = Number(momPct) > 0;
    insights.push({
      icon: up ? '📈' : '📉',
      bg:   up ? 'rgba(220,38,38,.1)' : 'rgba(22,163,74,.1)',
      title: up ? `Spending up ${Math.abs(momPct)}% vs last month` : `Spending down ${Math.abs(momPct)}% vs last month`,
      sub:   `Last month: ${fmt(prevTotal)} · This month: ${fmt(total)}`,
      val:   (up ? '+' : '−') + fmt(Math.abs(total - prevTotal)),
    });
  }

  /* Biggest single expense */
  if (expenses.length > 0) {
    const biggest = [...expenses].sort((a,b) => b.amount - a.amount)[0];
    const bigCat  = CAT_MAP[biggest.category] || { icon: '📦', label: biggest.category };
    insights.push({
      icon: '💎', bg: 'rgba(255,167,38,.12)',
      title: `Biggest expense this month`,
      sub:   `${bigCat.icon} ${bigCat.label}${biggest.note ? ' · ' + biggest.note : ''} on ${fmtDate(biggest.date)}`,
      val:   fmt(biggest.amount),
    });
  }

  /* Days with expenses */
  if (expenses.length > 0) {
    const uniqueDays = new Set(expenses.map(e => e.date)).size;
    const allDays    = daysElapsedInMonth(viewMonth);
    const pct        = Math.round(uniqueDays / allDays * 100);
    insights.push({
      icon: '🗓️', bg: 'rgba(38,198,218,.12)',
      title: `Spent on ${uniqueDays} out of ${allDays} days`,
      sub:   `${pct}% of days this month had at least one expense`,
      val:   null,
    });
  }

  /* Projection: end of month */
  const now = new Date();
  const isCurrentMonth = viewMonth.getFullYear() === now.getFullYear() && viewMonth.getMonth() === now.getMonth();
  if (isCurrentMonth && dailyAvg > 0) {
    const daysInMonth   = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const projected     = dailyAvg * daysInMonth;
    insights.push({
      icon: '🔮', bg: 'rgba(171,71,188,.12)',
      title: 'Projected month-end total',
      sub:   `At your current pace of ${fmt(dailyAvg)}/day`,
      val:   fmt(projected),
    });
  }

  if (insights.length === 0) {
    insights.push({
      icon: '🌱', bg: 'rgba(102,187,106,.12)',
      title: 'Start tracking to see insights',
      sub:   'Add your first expense and your financial story will appear here.',
      val:   null,
    });
  }

  return insights;
}

/* ── Shared expense row HTML ───────────────────────────────── */
/* opts:
     hideDate    – suppress the date column (default false)
     inCatGroup  – row is rendered inside the dashboard category dropdown.
                   The category is already shown in the group header, so we
                   surface the NOTE as the primary line instead.            */
function expenseRowHTML(e, hideDate = false, inCatGroup = false) {
  const cat       = CAT_MAP[e.category] || { icon: '📦', label: e.category, color: '#78909C' };
  const safeNote  = e.note ? escapeHTML(e.note) : '';
  const primary   = inCatGroup
    ? (safeNote ? `<div class="expense-note expense-note--primary">📝 ${safeNote}</div>`
                : `<div class="expense-note expense-note--empty">— no note —</div>`)
    : `<div class="expense-cat-name">${cat.label}</div>${safeNote ? `<div class="expense-note">${safeNote}</div>` : ''}`;
  return `
    <div class="expense-row">
      <div class="expense-cat-icon" style="background:${cat.color}22;">${cat.icon}</div>
      <div class="expense-info">
        ${primary}
      </div>
      <div class="expense-right">
        <div class="expense-amount">${fmt(e.amount)}</div>
        ${!hideDate ? `<div class="expense-date">${fmtDate(e.date)}</div>` : ''}
      </div>
      <button class="expense-delete" onclick="deleteExpense(${e.rowIndex})" title="Delete">✕</button>
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════
   BUDGET HERO + MODAL + INSIGHTS
   ═══════════════════════════════════════════════════════════ */

/* Apply budget state to the dashboard hero. Mutates DOM in-place. */
function applyBudgetToHero(monthDate, spent) {
  const y = monthDate.getFullYear();
  const m = monthDate.getMonth() + 1;
  const hero        = document.getElementById('dash-hero');
  const cta         = document.getElementById('budget-cta');
  const overspent   = document.getElementById('dash-hero-overspent');
  const budgetBox   = document.getElementById('dash-hero-budget');
  const budgetFill  = document.getElementById('dash-hero-budget-fill');
  const budgetMeta  = document.getElementById('dash-hero-budget-meta');
  const subEl       = document.getElementById('dash-hero-sub');

  /* Reset hero classes */
  hero.classList.remove('hero--good', 'hero--bad');
  overspent.style.display = 'none';
  budgetBox.style.display = 'none';

  const b = getBudgetForMonth(y, m);
  if (!b) {
    /* No budget set — show CTA card below hero */
    cta.style.display = 'flex';
    document.getElementById('budget-cta-month').textContent = monthLabel(monthDate);
    return;
  }

  cta.style.display = 'none';
  const v       = deriveVerdict(y, m, b.budget, spent);
  const pct     = Math.min(100, b.budget > 0 ? (spent / b.budget) * 100 : 0);
  budgetBox.style.display     = 'block';
  budgetFill.style.width      = pct + '%';

  if (v.status === 'bad') {
    hero.classList.add('hero--bad');
    overspent.style.display = 'inline-flex';
    budgetMeta.innerHTML =
      `<strong>${fmt(spent)}</strong> spent of ${fmt(b.budget)} ` +
      `· <span class="budget-over">${fmt(v.spillover)} over</span>`;
    subEl.textContent =
      `${monthExpensesCount(y, m)} expense${monthExpensesCount(y, m) !== 1 ? 's' : ''} · day ${daysElapsedInMonth(monthDate)} of ${daysInMonth(monthDate)}`;
  } else {
    hero.classList.add('hero--good');
    const remaining = b.budget - spent;
    budgetMeta.innerHTML =
      `<strong>${fmt(spent)}</strong> spent of ${fmt(b.budget)} ` +
      `· <span class="budget-left">${fmt(remaining)} left</span>`;
    subEl.textContent =
      `${monthExpensesCount(y, m)} expense${monthExpensesCount(y, m) !== 1 ? 's' : ''} · day ${daysElapsedInMonth(monthDate)} of ${daysInMonth(monthDate)}`;
  }
}

function monthExpensesCount(y, m) {
  return allExpenses.filter(e => {
    const [ey, em] = (e.date || '').split('-').map(Number);
    return ey === y && em === m;
  }).length;
}

function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

/* ── Budget modal ───────────────────────────────────────────── */
function openBudgetModal() {
  const y     = viewMonth.getFullYear();
  const m     = viewMonth.getMonth() + 1;
  const b     = getBudgetForMonth(y, m);
  const input = document.getElementById('budget-amount-input');
  document.getElementById('budget-modal-title').textContent = b ? 'Edit monthly budget' : 'Set monthly budget';
  document.getElementById('budget-modal-month').textContent = monthLabel(viewMonth);
  document.getElementById('budget-clear-btn').style.display = b ? 'block' : 'none';
  input.value = b ? b.budget : '';
  document.getElementById('budget-modal').style.display = 'flex';
  setTimeout(() => input.focus(), 50);
}

function closeBudgetModal() {
  document.getElementById('budget-modal').style.display = 'none';
}

function fillBudgetQuick(amt) {
  document.getElementById('budget-amount-input').value = amt;
  document.getElementById('budget-amount-input').focus();
}

async function saveBudgetFromModal() {
  const raw = document.getElementById('budget-amount-input').value;
  const amt = parseFloat(raw);
  if (!amt || amt <= 0) { showToast('Enter a budget amount', true); return; }
  const y = viewMonth.getFullYear();
  const m = viewMonth.getMonth() + 1;
  closeBudgetModal();
  setLoading('Saving budget…');
  try {
    await ensureToken();
    await upsertBudgetRow(y, m, amt);
    clearLoading();
    showToast(`Budget for ${monthLabel(viewMonth)} set to ${fmt(amt)} ✓`);
    if (currentView === 'dashboard') renderDashboard();
    if (currentView === 'insights')  renderInsights();
    /* Voice reply if user enabled — keep silent on manual save */
  } catch (e) {
    clearLoading();
    showToast('Save failed: ' + e.message, true);
    console.error(e);
  }
}

async function clearBudgetFromModal() {
  const y = viewMonth.getFullYear();
  const m = viewMonth.getMonth() + 1;
  closeBudgetModal();
  setLoading('Removing budget…');
  try {
    await ensureToken();
    await deleteBudgetRow(y, m);
    clearLoading();
    showToast('Budget removed for ' + monthLabel(viewMonth));
    if (currentView === 'dashboard') renderDashboard();
    if (currentView === 'insights')  renderInsights();
  } catch (e) {
    clearLoading();
    showToast('Remove failed: ' + e.message, true);
    console.error(e);
  }
}

/* ═══════════════════════════════════════════════════════════
   INSIGHTS VIEW — Monthly Verdict horizontal strip + streak
   ═══════════════════════════════════════════════════════════ */
function renderInsights() {
  renderVerdictStrip();
  renderStreakCard();
  renderBydate();
}

/* Build a list of months from the earliest expense to the current month, with
   their verdict computed live (current month uses live spend; past months use
   whatever's stored in Budgets tab, recomputed against actual expenses). */
function buildMonthlyVerdicts() {
  if (!allExpenses.length && !allBudgets.length) {
    /* Show at least the current month */
    const now = new Date();
    return [verdictForMonth(now.getFullYear(), now.getMonth() + 1)];
  }
  /* Determine earliest month from expenses + budgets */
  let earliestY = 9999, earliestM = 12;
  const consider = (y, m) => {
    if (y < earliestY || (y === earliestY && m < earliestM)) { earliestY = y; earliestM = m; }
  };
  allExpenses.forEach(e => {
    if (!e.date) return;
    const [y, m] = e.date.split('-').map(Number);
    consider(y, m);
  });
  allBudgets.forEach(b => consider(b.year, b.month));
  const now = new Date();
  const latestY = now.getFullYear(), latestM = now.getMonth() + 1;

  const result = [];
  let y = earliestY, m = earliestM;
  while (y < latestY || (y === latestY && m <= latestM)) {
    result.push(verdictForMonth(y, m));
    m++;
    if (m > 12) { m = 1; y++; }
  }
  /* Newest first */
  return result.reverse();
}

function verdictForMonth(year, month) {
  const spent = computeSpentForMonth(year, month);
  const b     = getBudgetForMonth(year, month);
  if (!b) return { year, month, status: 'no-budget', spent, budget: 0, spillover: 0, savings: 0 };
  const v = deriveVerdict(year, month, b.budget, spent);
  const savings = v.status === 'good' ? Math.max(0, b.budget - spent) : 0;
  return { year, month, status: v.status, spent, budget: b.budget, spillover: v.spillover, savings };
}

function renderVerdictStrip() {
  const strip    = document.getElementById('verdict-strip');
  const verdicts = buildMonthlyVerdicts();
  const now      = new Date();
  const isCurr   = (v) => v.year === now.getFullYear() && v.month === now.getMonth() + 1;

  strip.innerHTML = verdicts.map(v => {
    const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][v.month - 1];
    const dot       = v.status === 'good' ? '🟢' : v.status === 'bad' ? '🔴' : '⚪';
    const statusCls = `verdict-card--${v.status}`;
    let primary, secondary;
    if (v.status === 'good') {
      primary   = '−' + fmt(v.savings);
      secondary = isCurr(v) ? 'left' : 'saved';
    } else if (v.status === 'bad') {
      primary   = '+' + fmt(v.spillover);
      secondary = 'over';
    } else {
      primary   = fmt(v.spent);
      secondary = 'no budget';
    }
    return `
      <button class="verdict-card ${statusCls} ${isCurr(v) ? 'verdict-card--current' : ''}"
              onclick="jumpToMonth(${v.year}, ${v.month})">
        <div class="verdict-card-month">${monthName} '${String(v.year).slice(-2)}</div>
        <div class="verdict-card-dot">${dot}</div>
        <div class="verdict-card-amt">${primary}</div>
        <div class="verdict-card-sub">${secondary}</div>
      </button>`;
  }).join('') || '<p class="empty-state-inline">Nothing to show yet — add an expense or set a budget.</p>';
}

function jumpToMonth(year, month) {
  viewMonth = new Date(year, month - 1, 1);
  switchView('dashboard');
  destroyCharts();
  renderDashboard();
}

function renderStreakCard() {
  const verdicts = buildMonthlyVerdicts().filter(v => v.status !== 'no-budget');
  const emojiEl  = document.getElementById('streak-emoji');
  const titleEl  = document.getElementById('streak-title');
  const subEl    = document.getElementById('streak-sub');
  if (!verdicts.length) {
    emojiEl.textContent = '🆕';
    titleEl.textContent = 'No history yet';
    subEl.textContent   = 'Set a budget for this month to start tracking your verdict streak.';
    return;
  }
  /* Streak = consecutive same-status months from newest backward */
  const newest = verdicts[0].status;
  let streak = 0;
  for (const v of verdicts) {
    if (v.status === newest) streak++;
    else break;
  }
  if (newest === 'good') {
    emojiEl.textContent = '🔥';
    titleEl.textContent = `${streak} good month${streak === 1 ? '' : 's'} in a row`;
    subEl.textContent   = streak >= 3 ? 'Excellent discipline. Keep it going!' : 'Nice work — consistency builds savings.';
  } else {
    emojiEl.textContent = '⚠️';
    titleEl.textContent = `${streak} bad month${streak === 1 ? '' : 's'} in a row`;
    subEl.textContent   = 'Time to revisit your spending — small changes compound.';
  }
}

/* ── Month rollover: detect a new calendar month and announce verdict ── */
function maybeShowMonthWrapUp() {
  const now      = new Date();
  const thisYM   = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (lastWrapMonth === thisYM) return;
  /* Mark current month as "seen" so we don't toast again until next month rolls over */
  lastWrapMonth = thisYM;
  localStorage.setItem('lastWrapMonth', thisYM);

  /* Show wrap-up for the PREVIOUS calendar month */
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const v    = verdictForMonth(prev.getFullYear(), prev.getMonth() + 1);
  if (v.status === 'no-budget') return;
  const label = monthLabel(prev);
  if (v.status === 'good') {
    showToast(`🎉 ${label}: Good month — saved ${fmt(v.savings)}`);
  } else {
    showToast(`💸 ${label}: Bad month — over by ${fmt(v.spillover)}`, true);
  }
}

/* ═══════════════════════════════════════════════════════════
   BY-DATE LENS (Insights → day / range summary)
   ═══════════════════════════════════════════════════════════ */
/* State — always reset to 'today' on each tab switch into Insights
   (per design decision: no persistence across tab switches). */
let bydatePreset = 'today';        /* today | yesterday | this-week | last-7 | custom */
let bydateFrom   = todayStr();     /* yyyy-mm-dd */
let bydateTo     = todayStr();
let bydateChart  = null;           /* Chart.js doughnut instance */

/* ── Date helpers (range math, all in local calendar time) ── */
function dateToStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function strToDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function startOfWeek(d) {
  /* Monday = start of week (en-IN convention). 0 = Sun → shift back 6 */
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(d, diff);
}

/* Map preset name → { from, to } strings */
function rangeForPreset(preset) {
  const now = new Date();
  const today = dateToStr(now);
  if (preset === 'today')     return { from: today, to: today };
  if (preset === 'yesterday') {
    const y = dateToStr(addDays(now, -1));
    return { from: y, to: y };
  }
  if (preset === 'this-week') return { from: dateToStr(startOfWeek(now)), to: today };
  if (preset === 'last-7')    return { from: dateToStr(addDays(now, -6)),  to: today };
  /* 'custom' uses existing bydateFrom/bydateTo */
  return { from: bydateFrom, to: bydateTo };
}

/* Filter allExpenses to those whose date falls within [from, to] inclusive. */
function expensesInRange(fromStr, toStr) {
  return allExpenses.filter(e => {
    if (!e.date) return false;
    return e.date >= fromStr && e.date <= toStr;
  });
}

/* Produce a human-friendly label for the active range. */
function formatRangeLabel(fromStr, toStr) {
  const today     = todayStr();
  const yesterday = dateToStr(addDays(new Date(), -1));
  if (fromStr === toStr) {
    if (fromStr === today)     return 'Today · ' + fmtFullDate(fromStr);
    if (fromStr === yesterday) return 'Yesterday · ' + fmtFullDate(fromStr);
    return fmtFullDate(fromStr);
  }
  const f = strToDate(fromStr), t = strToDate(toStr);
  /* Same month — "1–10 May 2026" */
  if (f.getFullYear() === t.getFullYear() && f.getMonth() === t.getMonth()) {
    return `${f.getDate()}–${t.getDate()} ${monthLabel(f)}`;
  }
  /* Same year — "5 Apr – 12 May 2026" */
  if (f.getFullYear() === t.getFullYear()) {
    return `${fmtFullDate(fromStr, false)} – ${fmtFullDate(toStr)}`;
  }
  /* Different year */
  return `${fmtFullDate(fromStr)} – ${fmtFullDate(toStr)}`;
}

/* Like fmtDate() but always includes year (configurable). */
function fmtFullDate(dateStr, withYear = true) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  const mn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m)-1];
  return withYear ? `${parseInt(d)} ${mn} ${y}` : `${parseInt(d)} ${mn}`;
}

/* Compact range label for the app header (short form). */
function formatHeaderRangeLabel(fromStr, toStr) {
  const today     = todayStr();
  const yesterday = dateToStr(addDays(new Date(), -1));
  if (fromStr === toStr) {
    if (fromStr === today)     return 'Today';
    if (fromStr === yesterday) return 'Yesterday';
    return fmtFullDate(fromStr, false);
  }
  const f = strToDate(fromStr), t = strToDate(toStr);
  if (f.getFullYear() === t.getFullYear() && f.getMonth() === t.getMonth()) {
    return `${f.getDate()}–${t.getDate()} ${monthShort(f)}`;
  }
  return `${fmtFullDate(fromStr, false)} – ${fmtFullDate(toStr, false)}`;
}

/* ── Chip & custom-picker handlers ── */
function setBydatePreset(preset) {
  bydatePreset = preset;
  const r = rangeForPreset(preset);
  bydateFrom = r.from;
  bydateTo   = r.to;
  /* Visual chip state */
  document.querySelectorAll('.bydate-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.preset === preset);
  });
  /* Hide custom panel unless explicitly opened */
  if (preset !== 'custom') document.getElementById('bydate-custom').style.display = 'none';
  renderBydate();
  updateHeaderMonth();
}

function toggleBydateCustom() {
  const panel = document.getElementById('bydate-custom');
  const opening = panel.style.display !== 'block';
  panel.style.display = opening ? 'block' : 'none';
  if (opening) {
    /* Pre-fill with current range to make tweaking easier */
    document.getElementById('bydate-from').value = bydateFrom;
    document.getElementById('bydate-to').value   = bydateTo;
    /* Mark the custom chip as active visually */
    document.querySelectorAll('.bydate-chip').forEach(c => {
      c.classList.toggle('active', c.dataset.preset === 'custom');
    });
  }
}

function applyBydateCustom() {
  const fromEl = document.getElementById('bydate-from');
  const toEl   = document.getElementById('bydate-to');
  const from = fromEl.value;
  const to   = toEl.value;
  if (!from || !to) { showToast('Pick both From and To dates', true); return; }
  if (from > to)    { showToast('From date is after To date', true);   return; }
  bydatePreset = 'custom';
  bydateFrom   = from;
  bydateTo     = to;
  document.getElementById('bydate-custom').style.display = 'none';
  renderBydate();
  updateHeaderMonth();
}

function destroyBydateChart() {
  if (bydateChart) { bydateChart.destroy(); bydateChart = null; }
}

/* Reset to today — called on every entry into the Insights tab. */
function resetBydate() {
  bydatePreset = 'today';
  const r = rangeForPreset('today');
  bydateFrom = r.from;
  bydateTo   = r.to;
  document.querySelectorAll('.bydate-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.preset === 'today');
  });
  const customPanel = document.getElementById('bydate-custom');
  if (customPanel) customPanel.style.display = 'none';
}

/* ── Render the By-Date summary card ── */
function renderBydate() {
  const card        = document.getElementById('bydate-card');
  if (!card) return;          /* Insights HTML not yet in DOM (defensive) */
  const labelEl     = document.getElementById('bydate-range-label');
  const totalEl     = document.getElementById('bydate-total');
  const metaEl      = document.getElementById('bydate-meta');
  const donutRow    = document.getElementById('bydate-donut-row');
  const donutVal    = document.getElementById('bydate-donut-val');
  const catsEl      = document.getElementById('bydate-cats');
  const entriesEl   = document.getElementById('bydate-entries');

  const expenses = expensesInRange(bydateFrom, bydateTo);
  const total    = expenses.reduce((s, e) => s + e.amount, 0);
  const count    = expenses.length;

  labelEl.textContent = formatRangeLabel(bydateFrom, bydateTo);
  totalEl.textContent = fmt(total);
  donutVal.textContent = fmt(total);

  /* Group by category for chart + list */
  const byCat = {};
  expenses.forEach(e => {
    if (!byCat[e.category]) byCat[e.category] = { amount: 0, count: 0 };
    byCat[e.category].amount += e.amount;
    byCat[e.category].count  += 1;
  });
  const cats = Object.entries(byCat).map(([key, v]) => {
    const c = CAT_MAP[key] || { icon: '📦', label: key, color: '#78909C' };
    return { key, label: c.label, icon: c.icon, color: c.color, amount: v.amount, count: v.count };
  }).sort((a, b) => b.amount - a.amount);

  metaEl.textContent = count === 0
    ? 'No expenses in this range'
    : `${count} expense${count !== 1 ? 's' : ''} · ${cats.length} categor${cats.length !== 1 ? 'ies' : 'y'}`;

  destroyBydateChart();

  if (count === 0) {
    donutRow.style.display = 'none';
    catsEl.innerHTML       = '';   /* clear any stale chips from prior range */
    entriesEl.innerHTML    = '<p class="empty-state-inline">Nothing here. Try another date or range.</p>';
    return;
  }
  donutRow.style.display = 'flex';

  /* Donut */
  const donutCtx = document.getElementById('bydateDonutChart').getContext('2d');
  bydateChart = new Chart(donutCtx, {
    type: 'doughnut',
    data: {
      labels: cats.map(c => c.label),
      datasets: [{
        data:            cats.map(c => c.amount),
        backgroundColor: cats.map(c => c.color),
        borderWidth:     2,
        borderColor:     '#FFFFFF',
        borderRadius:    4,
      }]
    },
    options: {
      responsive: false,
      cutout: '66%',
      plugins: {
        legend:  { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmt(ctx.raw)}` } }
      }
    }
  });

  /* Category list with %, ₹, ×count */
  catsEl.innerHTML = cats.map(c => {
    const pct = total > 0 ? Math.round((c.amount / total) * 100) : 0;
    return `
      <div class="bydate-cat-row">
        <span class="bydate-cat-dot" style="background:${c.color};"></span>
        <span class="bydate-cat-icon">${c.icon}</span>
        <span class="bydate-cat-name">${c.label}</span>
        <span class="bydate-cat-pct">${pct}%</span>
        <span class="bydate-cat-amt">${fmt(c.amount)}</span>
        <span class="bydate-cat-ct">×${c.count}</span>
      </div>
    `;
  }).join('');

  /* Entries — grouped by category, collapsible, biggest spender first.
     Mirrors the Dashboard accordion pattern so users get one consistent UX. */
  const groups = {};
  expenses.forEach(e => {
    if (!groups[e.category]) groups[e.category] = [];
    groups[e.category].push(e);
  });
  Object.keys(groups).forEach(k => {
    groups[k].sort((a, b) => b.date.localeCompare(a.date) || b.rowIndex - a.rowIndex);
  });
  /* Order categories by total spend desc — top spender at the top */
  const orderedKeys = Object.keys(groups).sort((a, b) => {
    const ta = groups[a].reduce((s, e) => s + e.amount, 0);
    const tb = groups[b].reduce((s, e) => s + e.amount, 0);
    return tb - ta;
  });

  /* Track expanded state across re-renders. Auto-expand the top spender on
     first paint of each range so the user immediately sees where money went. */
  if (!window.expandedBydateGroups) window.expandedBydateGroups = new Set();
  const rangeKey = `${bydateFrom}~${bydateTo}`;
  if (window.lastBydateRangeKey !== rangeKey) {
    window.expandedBydateGroups = new Set(orderedKeys.slice(0, 1));
    window.lastBydateRangeKey = rangeKey;
  }

  entriesEl.innerHTML = orderedKeys.map((catKey, idx) => {
    const rows  = groups[catKey];
    const cat   = CAT_MAP[catKey] || { icon: '📦', label: catKey, color: '#78909C' };
    const ctot  = rows.reduce((s, e) => s + e.amount, 0);
    const ccnt  = rows.length;
    const cpct  = total > 0 ? Math.round((ctot / total) * 100) : 0;
    const open  = window.expandedBydateGroups.has(catKey) ? 'expanded' : '';
    const crown = idx === 0 ? '<span class="cat-group-crown" title="Biggest spend">👑</span>' : '';
    return `
      <div class="cat-group ${open}" data-bydate-cat="${catKey}">
        <button class="cat-group-header" onclick="toggleBydateCatGroup('${catKey.replace(/'/g, "\\'")}')">
          <div class="cat-group-icon" style="background:${cat.color}22;">${cat.icon}</div>
          <div class="cat-group-info">
            <div class="cat-group-name">${crown}${cat.label}</div>
            <div class="cat-group-meta">${ccnt} ${ccnt === 1 ? 'entry' : 'entries'} · ${cpct}% of total</div>
          </div>
          <div class="cat-group-total">${fmt(ctot)}</div>
          <div class="cat-group-chevron">▾</div>
        </button>
        <div class="cat-group-body">
          ${rows.map(e => expenseRowHTML(e, false, true)).join('')}
        </div>
      </div>`;
  }).join('');
}

/* Toggle a single category accordion inside the Insights By-Date list.
   Kept separate from the Dashboard toggler so the two views don't share state. */
function toggleBydateCatGroup(catKey) {
  if (!window.expandedBydateGroups) window.expandedBydateGroups = new Set();
  const el = document.querySelector(`.cat-group[data-bydate-cat="${CSS.escape(catKey)}"]`);
  if (!el) return;
  const isExpanded = el.classList.toggle('expanded');
  if (isExpanded) window.expandedBydateGroups.add(catKey);
  else            window.expandedBydateGroups.delete(catKey);
}

/* ═══════════════════════════════════════════════════════════
   VIEW ROUTER
   ═══════════════════════════════════════════════════════════ */
function switchView(view) {
  currentView = view;
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('view-'  + view).classList.add('active');
  document.getElementById('nav-'   + view).classList.add('active');

  /* By-Date lens always resets to "Today" on each Insights entry */
  if (view === 'insights') resetBydate();

  updateHeaderMonth();

  if (view === 'add')       renderTodayTotal();
  if (view === 'dashboard') renderDashboard();
  if (view === 'insights')  renderInsights();
  if (view === 'loans')     window.renderLoans && window.renderLoans();
}

function updateHeaderMonth() {
  const el   = document.getElementById('header-month-label');
  const prev = document.getElementById('month-prev');
  const next = document.getElementById('month-next');

  if (currentView === 'add') {
    el.textContent          = 'Today';
    prev.style.visibility   = 'hidden';
    next.style.visibility   = 'hidden';
  } else if (currentView === 'loans') {
    el.textContent          = '💳 Loans';
    prev.style.visibility   = 'hidden';
    next.style.visibility   = 'hidden';
  } else if (currentView === 'insights') {
    /* Reflect the active By-Date range in the header for constant feedback */
    el.textContent          = formatHeaderRangeLabel(bydateFrom, bydateTo);
    prev.style.visibility   = 'hidden';
    next.style.visibility   = 'hidden';
  } else {
    el.textContent          = monthLabel(viewMonth);
    prev.style.visibility   = 'visible';
    next.style.visibility   = 'visible';
  }
}

function changeMonth(delta) {
  viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + delta, 1);
  updateHeaderMonth();
  if (currentView === 'dashboard') { destroyCharts(); renderDashboard(); }
  if (currentView === 'insights')  renderInsights();
}

/* ═══════════════════════════════════════════════════════════
   VOICE ENTRY ENGINE
   ═══════════════════════════════════════════════════════════ */
let recognition  = null;
let voiceParsed  = null;
let voiceStarting = false;   /* guard against double-tap */
let voiceAborted  = false;   /* set when error fires so onend skips processing */

/* Keyword map — covers common Indian English phrases */
const VOICE_KEYWORDS = {
  food:     ['food','lunch','dinner','breakfast','meal','eat','eating','restaurant','hotel','biryani','swiggy','zomato','snack','snacks','chai','tea','coffee','tiffin'],
  grocery:  ['grocery','groceries','supermarket','kirana','big bazaar','dmart','reliance','zepto','blinkit','instamart'],
  market:   ['market','vegetable','vegetables','fruit','fruits','sabzi','mandi'],
  medicine: ['medicine','medicines','medical','pharmacy','pharmacist','doctor','hospital','tablet','tablets','capsule','drug','health','apollo'],
  petrol:   ['petrol','fuel','diesel','gas','pump','filling'],
  recharge: ['recharge','mobile','phone','internet','data','sim','jio','airtel','vi','bsnl','broadband','wifi'],
  water:    ['water','aqua','bisleri','mineral'],
  gifts:    ['gift','gifts','present','birthday','anniversary','wedding'],
  other:    ['other','misc','miscellaneous'],
};

const MONTH_MAP = {
  january:1, jan:1, february:2, feb:2, march:3, mar:3,
  april:4, apr:4, may:5, june:6, jun:6, july:7, jul:7,
  august:8, aug:8, september:9, sep:9, october:10, oct:10,
  november:11, nov:11, december:12, dec:12,
};

/* ymd helper — Date object → "YYYY-MM-DD" */
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/* Try to extract a date from a phrase. Returns { date, stripped } where
   stripped is the original text with the matched date phrase(s) removed,
   so the caller can run amount/category detection on a clean string.
   Returns null if no date phrase found. */
function extractDateFromVoice(lower) {
  const now = new Date();
  const monthNames = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec';

  /* Step 1 — pre-extract an explicit year mention if present.
     Only treat a 4-digit number as a year when it's adjacent to a
     year-context word (in / of / year). This avoids confusing a 4-digit
     amount like "2024 rupees" with the year. */
  const stripParts = [];
  let explicitYear = null;
  const yearCtxPatterns = [
    /\b(\d{4})\s+year\b/,        /* "1956 year"   */
    /\byear\s+(\d{4})\b/,        /* "year 1956"   */
    /\bin\s+(\d{4})\b/,          /* "in 1956"     */
    /\bof\s+(\d{4})\b/,          /* "of 1956"     */
  ];
  for (const p of yearCtxPatterns) {
    const ym = lower.match(p);
    if (ym) {
      const y = parseInt(ym[1]);
      if (y >= 1900 && y <= 2099) {
        explicitYear = y;
        stripParts.push(ym[0]);
        break;
      }
    }
  }
  let work = stripParts.length
    ? lower.replace(stripParts[0], ' ').replace(/\s+/g, ' ').trim()
    : lower;

  /* bundle helper: returns { date, stripped } with all matched portions
     removed from the original `lower` input so amount detection is clean. */
  function bundle(date, dateText) {
    stripParts.push(dateText);
    let stripped = lower;
    for (const part of stripParts) stripped = stripped.replace(part, ' ');
    return { date, stripped: stripped.replace(/\s+/g, ' ').trim() };
  }

  /* day before yesterday — check before "yesterday" */
  let m = work.match(/\bday\s+before\s+yesterday\b/);
  if (m) { const d = new Date(); d.setDate(d.getDate() - 2); return bundle(ymd(d), m[0]); }

  m = work.match(/\byesterday\b/);
  if (m) { const d = new Date(); d.setDate(d.getDate() - 1); return bundle(ymd(d), m[0]); }

  m = work.match(/\btoday\b/);
  if (m) return bundle(todayStr(), m[0]);

  /* this/last/next month — only if no explicit year was given */
  if (!explicitYear) {
    m = work.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?this\s+month\b/);
    if (!m) m = work.match(/\bthis\s+month\s+(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\b/);
    if (m) {
      const day = parseInt(m[1]);
      if (day >= 1 && day <= 31) {
        return bundle(ymd(new Date(now.getFullYear(), now.getMonth(), day)), m[0]);
      }
    }

    m = work.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?last\s+month\b/);
    if (!m) m = work.match(/\blast\s+month\s+(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\b/);
    if (m) {
      const day = parseInt(m[1]);
      if (day >= 1 && day <= 31) {
        return bundle(ymd(new Date(now.getFullYear(), now.getMonth() - 1, day)), m[0]);
      }
    }

    m = work.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?next\s+month\b/);
    if (!m) m = work.match(/\bnext\s+month\s+(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\b/);
    if (m) {
      const day = parseInt(m[1]);
      if (day >= 1 && day <= 31) {
        return bundle(ymd(new Date(now.getFullYear(), now.getMonth() + 1, day)), m[0]);
      }
    }
  }

  /* day + month (with optional inline trailing year):
     "23 june", "23rd june", "23 of june", "23rd of june",
     "23 june 2020", "23rd june 2020" */
  let dm = work.match(new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthNames})(?:[,\\s]+(\\d{4}))?\\b`,
    'i'
  ));
  /* "june 23", "june 23rd", "june the 23rd", "june 23 2020" */
  if (!dm) dm = work.match(new RegExp(
    `\\b(${monthNames})\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:[,\\s]+(\\d{4}))?\\b`,
    'i'
  ));
  if (dm) {
    let day, monthStr, inlineYear;
    if (/^\d/.test(dm[1])) { day = parseInt(dm[1]); monthStr = dm[2]; inlineYear = dm[3]; }
    else                   { monthStr = dm[1]; day = parseInt(dm[2]); inlineYear = dm[3]; }
    const month = MONTH_MAP[monthStr.toLowerCase()];
    if (month && day >= 1 && day <= 31) {
      let year;
      if (explicitYear) {
        year = explicitYear;
      } else if (inlineYear) {
        const yi = parseInt(inlineYear);
        year = (yi >= 1900 && yi <= 2099) ? yi : now.getFullYear();
      } else {
        year = now.getFullYear();
        /* If candidate is in the future, default to LAST year
           (e.g. in May 2026, "October 12" → 2025-10-12) */
        if (new Date(year, month - 1, day) > now) year -= 1;
      }
      return bundle(ymd(new Date(year, month - 1, day)), dm[0]);
    }
  }

  return null;
}

function parseVoiceCommand(text) {
  const lower = text.toLowerCase().trim();

  /* ── Date: parse first so we can strip it before amount detection ── */
  const dateRes = extractDateFromVoice(lower);
  const date    = dateRes ? dateRes.date : todayStr();
  let cleaned   = dateRes ? dateRes.stripped : lower;

  /* ── Note extraction. Supports:
        "... and note is mangos"
        "... note is mangos" / "note: mangos" / "note mangos"
        "... for mangos and onions"            (last clause)
        "... — mangos"   /  "... - mangos"     (em/en/dash separator)
        We pull the note out FIRST, then strip the matched fragment so it
        doesn't pollute amount/category detection.                            */
  let note = '';
  const noteMatchers = [
    /\b(?:and\s+)?note(?:\s+is|:)?\s+(.+)$/i,   // "and note is X" / "note X"
    /\bfor\s+(.+)$/i,                            // "for X"
    /\s[—–-]\s+(.+)$/                            // " - X" / " — X"
  ];
  for (const re of noteMatchers) {
    const m = cleaned.match(re);
    if (m && m[1] && m[1].trim().length) {
      note    = m[1].trim().replace(/[.,!?]+$/, '');
      cleaned = cleaned.slice(0, m.index).trim();
      break;
    }
  }

  /* ── Amount: first number in the cleaned string ── */
  const amountMatch = cleaned.match(/\b(\d+(?:\.\d+)?)\b/);
  const amount = amountMatch ? parseFloat(amountMatch[1]) : null;

  /* ── Category: longest-match wins so multi-word custom labels
        (e.g. "Outside Food") beat shorter built-in keywords (e.g. "food") ── */
  const candidates = [];
  /* Custom categories — match against the full label */
  for (const c of customCategories) {
    candidates.push({ key: c.key, term: c.label.toLowerCase() });
  }
  /* Built-in keywords */
  for (const [cat, keywords] of Object.entries(VOICE_KEYWORDS)) {
    for (const kw of keywords) candidates.push({ key: cat, term: kw });
  }
  /* Word-boundary match, sorted by term length descending */
  candidates.sort((a, b) => b.term.length - a.term.length);

  let category = null;
  for (const c of candidates) {
    /* Use word-boundary regex so "food" doesn't match inside "seafood" */
    const re = new RegExp(`\\b${c.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(cleaned)) { category = c.key; break; }
  }

  /* If the user said "for X" but X happens to be a known category keyword,
     "for" was actually the category-prefix, not a note. Re-classify. */
  if (note && !category) {
    for (const c of candidates) {
      const re = new RegExp(`\\b${c.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(note)) { category = c.key; note = note.replace(re, '').replace(/\s{2,}/g, ' ').trim(); break; }
    }
  }

  return { amount, category, date, note };
}

/* ═══════════════════════════════════════════════════════════
   VOICE INTENT — budget commands & budget queries
   ═══════════════════════════════════════════════════════════ */

/* Parse a spoken amount like "fifty thousand", "1.5 lakh", "25k", "50000".
   Handles Indian conventions (lakh/crore, k for thousand) plus plain digits. */
function parseSpokenAmount(text) {
  const t = text.toLowerCase().replace(/[,₹]/g, '').trim();

  /* Pattern 1: "1.5 lakh" / "2 lakhs" / "1 lac" */
  let m = t.match(/(\d+(?:\.\d+)?)\s*(?:lakh|lakhs|lac|lacs)/);
  if (m) return Math.round(parseFloat(m[1]) * 100000);

  /* Pattern 2: "1 crore" / "1.2 crores" */
  m = t.match(/(\d+(?:\.\d+)?)\s*(?:crore|crores|cr)\b/);
  if (m) return Math.round(parseFloat(m[1]) * 10000000);

  /* Pattern 3: "25k" / "50 k" / "1.5k" */
  m = t.match(/(\d+(?:\.\d+)?)\s*k\b/);
  if (m) return Math.round(parseFloat(m[1]) * 1000);

  /* Pattern 4: "fifty thousand" / "twenty five thousand" — handle a few common
     spoken forms by digit conversion from word numbers. We keep it light: only
     convert standalone "X thousand" where X is a word number 1..99. */
  const WORD_NUMS = {
    one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9,
    ten:10, eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15,
    sixteen:16, seventeen:17, eighteen:18, nineteen:19,
    twenty:20, thirty:30, forty:40, fifty:50, sixty:60, seventy:70,
    eighty:80, ninety:90, hundred:100
  };
  m = t.match(/((?:[a-z]+\s+){0,3}[a-z]+)\s+(thousand|hundred)/);
  if (m) {
    const words = m[1].split(/\s+/);
    let n = 0;
    for (const w of words) {
      if (WORD_NUMS[w] != null) n = (w === 'hundred') ? n * 100 : n + WORD_NUMS[w];
      else { n = NaN; break; }
    }
    if (!isNaN(n) && n > 0) {
      return m[2] === 'thousand' ? n * 1000 : n * 100;
    }
  }

  /* Pattern 5: plain digits — pick the largest standalone number. */
  const nums = (t.match(/\b\d+(?:\.\d+)?\b/g) || []).map(parseFloat);
  if (nums.length) return Math.round(Math.max(...nums));

  return null;
}

/* Classify a spoken transcript into budget-set | budget-query | none. */
function classifyVoiceIntent(transcript) {
  const t = transcript.toLowerCase().trim();

  /* ── BUDGET-SET intents ──
        "set [my] [monthly] budget [to] 50000"
        "[my] monthly budget is 50000"
        "this month budget 50000"
        "budget 50000" / "make budget 50000" */
  const setPatterns = [
    /\b(?:set|make|update|change)\s+(?:my\s+)?(?:monthly\s+)?budget(?:\s+(?:to|as|of|at))?\s+(.+)$/,
    /\b(?:my\s+)?(?:monthly\s+)?budget\s+(?:is|to|=)\s+(.+)$/,
    /\bthis\s+month(?:'s)?\s+budget\s+(?:is\s+)?(.+)$/,
    /\bbudget\s+(?:to\s+)?(\d[\d.\s]*(?:k|lakh|lac|crore|cr|thousand|hundred)?.*)$/,
  ];
  for (const re of setPatterns) {
    const m = t.match(re);
    if (m && m[1]) {
      const amount = parseSpokenAmount(m[1]);
      if (amount && amount > 0) return { type: 'budget-set', amount };
    }
  }

  /* ── BUDGET-QUERY intents ──
        Must mention "budget" / "verdict" / "overspend" so they don't collide
        with the more general DATE-QUERY patterns below. */
  const budgetTriggers = [
    /\bbudget\s+(?:left|remaining|remain)\b/,
    /\bhow\s+much\s+budget\s+(?:is\s+)?(?:left|remaining|remain)\b/,
    /\bwhat(?:'s| is)\s+my\s+budget\b/,
    /\bdid\s+i\s+(?:overspend|over\s*spend|go\s+over)\b/,
    /\bam\s+i\s+(?:over|under)\s+budget\b/,
    /\bgood\s+month\s+or\s+bad\s+month\b/,
    /\bhow\s+is\s+(?:my\s+)?budget\s+doing\b/,
    /\b(?:show|tell)\s+me\s+(?:my\s+)?(?:budget|verdict)\b/,
  ];
  if (budgetTriggers.some(re => re.test(t))) {
    return { type: 'budget-query', query: t };
  }

  /* ── DATE-QUERY intents ──
        Anything that asks about historical spend tied to a date or range.
        We attempt to extract { from, to, category? } here so the handler
        is a pure renderer. */
  const dateQuery = extractDateQueryRange(t);
  if (dateQuery) {
    return { type: 'date-query', query: t, ...dateQuery };
  }

  return { type: 'none' };
}

/* Detect "show me spending today / yesterday / last 7 days / on May 5 / from X to Y"
   and return { from, to, category?, presetName }. Null if no date intent found.

   Disambiguation rule: ambiguous phrases like "yesterday" require an explicit
   QUESTION marker (how much / what did / show / tell) so they don't collide with
   expense-add commands ("spent 500 on food yesterday"). Unambiguous range
   phrases ("this week", "last 7 days", "from X to Y") don't need the marker. */
function extractDateQueryRange(t) {
  const isQuestion = /\b(?:how\s+much|how\s+many|what\s+did\s+i|what(?:'s| is|\s+is)\s+(?:my|the)\s+(?:total|spend|spending|expenses?)|show(?:\s+me)?|tell\s+me|total\s+(?:for|of|spent|in|on)|expenses?\s+(?:for|of|on|in))\b/.test(t);

  const now = new Date();
  const today = dateToStr(now);

  /* ── Ambiguous single-day phrases — require question marker AND not look
        like an expense-add (amount+category in the same phrase). ── */
  const looksLikeAdd = !isQuestion && hasAmountWithCategory(t);

  if (/\btoday\b/.test(t) && isQuestion && !looksLikeAdd) {
    return matchCategory(t, { from: today, to: today, presetName: 'today' });
  }
  if (/\byesterday\b/.test(t) && isQuestion && !looksLikeAdd) {
    const y = dateToStr(addDays(now, -1));
    return matchCategory(t, { from: y, to: y, presetName: 'yesterday' });
  }

  /* ── Unambiguous range phrases — fire regardless of question marker.
        These are safe because "this week" / "last 7 days" / "from X to Y"
        are never naturally part of an expense-add utterance. ── */
  if (/\b(?:this\s+week|current\s+week)\b/.test(t)) {
    return matchCategory(t, { from: dateToStr(startOfWeek(now)), to: today, presetName: 'this-week' });
  }
  if (/\blast\s+(?:7|seven)\s+days\b/.test(t)) {
    return matchCategory(t, { from: dateToStr(addDays(now, -6)), to: today, presetName: 'last-7' });
  }
  if (/\blast\s+week\b/.test(t)) {
    const lastWkStart = addDays(startOfWeek(now), -7);
    const lastWkEnd   = addDays(startOfWeek(now), -1);
    return matchCategory(t, { from: dateToStr(lastWkStart), to: dateToStr(lastWkEnd), presetName: 'custom' });
  }
  if (/\blast\s+(?:30|thirty)\s+days\b/.test(t)) {
    return matchCategory(t, { from: dateToStr(addDays(now, -29)), to: today, presetName: 'custom' });
  }

  /* ── Explicit "from X to Y" — second group is greedy so multi-word dates
        like "may 10" or "may 10 2026" are captured fully. ── */
  const fromTo = t.match(/\bfrom\s+(.+?)\s+(?:to|till|until)\s+(.+)$/);
  if (fromTo) {
    const f  = parseSpokenDate(fromTo[1]);
    const tt = parseSpokenDate(fromTo[2]);
    if (f && tt) return matchCategory(t, { from: f, to: tt, presetName: 'custom' });
  }

  /* ── "show May 5" / "5th May spending" — single date needs question marker ── */
  if (isQuestion && !looksLikeAdd) {
    const single = parseSpokenDate(t);
    if (single) return matchCategory(t, { from: single, to: single, presetName: 'custom' });
  }

  return null;
}

/* Quick check: does the transcript contain BOTH an amount and a category?
   Used to bias away from date-query when the user is actually adding an expense. */
function hasAmountWithCategory(t) {
  /* parseSpokenAmount returns null if no amount; but it also matches year-like
     numbers (2026). Cheap filter: only count amounts <= 999999 to skip years. */
  const amt = parseSpokenAmount(t);
  if (!amt || amt > 1000000) return false;
  for (const c of allCategories()) {
    if (new RegExp(`\\b${c.label.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t)) return true;
  }
  for (const kws of Object.values(VOICE_KEYWORDS || {})) {
    for (const kw of kws) if (new RegExp(`\\b${kw}\\b`, 'i').test(t)) return true;
  }
  return false;
}

/* Detect a category mention inside the transcript so we can do
   "how much on food yesterday" drill-downs. */
function matchCategory(t, range) {
  for (const c of allCategories()) {
    const label = c.label.toLowerCase();
    const re = new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(t)) return { ...range, category: c.key };
  }
  /* Also check the built-in voice keywords used for expense parsing */
  for (const [cat, kws] of Object.entries(VOICE_KEYWORDS || {})) {
    for (const kw of kws) {
      const re = new RegExp(`\\b${kw}\\b`, 'i');
      if (re.test(t)) return { ...range, category: cat };
    }
  }
  return range;
}

/* Parse a single spoken date phrase to yyyy-mm-dd. Handles:
     - "may 5", "5 may", "5th may 2026"
     - "12/05" / "5-may" / numeric-only with month context
   Returns null on no match. Uses current year unless year is spoken. */
function parseSpokenDate(phrase) {
  if (!phrase) return null;
  const s = phrase.toLowerCase().trim();
  const MONTHS = ['january','february','march','april','may','june',
                  'july','august','september','october','november','december'];

  /* Pattern: "5 may" / "5th may" / "5 may 2026" */
  let m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)(?:\s+(\d{4}))?/);
  if (m) {
    const day = parseInt(m[1]);
    const monIdx = MONTHS.findIndex(mn => mn.startsWith(m[2].slice(0, 3)));
    if (monIdx >= 0 && day >= 1 && day <= 31) {
      const year = m[3] ? parseInt(m[3]) : new Date().getFullYear();
      return `${year}-${String(monIdx + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
  }
  /* Pattern: "may 5" / "may 5th" / "may 5 2026" */
  m = s.match(/\b([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?/);
  if (m) {
    const monIdx = MONTHS.findIndex(mn => mn.startsWith(m[1].slice(0, 3)));
    const day    = parseInt(m[2]);
    if (monIdx >= 0 && day >= 1 && day <= 31) {
      const year = m[3] ? parseInt(m[3]) : new Date().getFullYear();
      return `${year}-${String(monIdx + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
  }
  return null;
}

/* Speech synthesis helper. Respects an opt-out flag in localStorage so users
   can mute voice replies (set `voiceMuted=1` to disable). */
function speak(text) {
  if (!('speechSynthesis' in window)) return;
  if (localStorage.getItem('voiceMuted') === '1') return;
  try {
    /* Cancel any in-flight utterance so replies don't queue up */
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang   = 'en-IN';
    u.rate   = 1.0;
    u.pitch  = 1.0;
    u.volume = 1.0;
    /* Prefer an Indian English voice if one is available */
    const voices = window.speechSynthesis.getVoices();
    const inVoice = voices.find(v => /en[-_]IN/i.test(v.lang)) ||
                    voices.find(v => /en[-_]GB/i.test(v.lang));
    if (inVoice) u.voice = inVoice;
    window.speechSynthesis.speak(u);
  } catch (e) {
    console.warn('Speech synthesis failed:', e);
  }
}

/* Format currency for spoken output (no ₹ symbol — TTS pronounces it weirdly).
   Uses "rupees" suffix and groups Indian-style. */
function fmtSpoken(amount) {
  const n = Math.round(amount);
  return `${n.toLocaleString('en-IN')} rupees`;
}

/* Handle "set budget X" voice command. Confirms, persists, and speaks back. */
async function handleVoiceBudgetSet(amount, transcript) {
  /* Echo the heard transcript in the result card so the user has visual confirmation */
  const card = document.getElementById('voice-result-card');
  document.getElementById('voice-heard-text').textContent = `"${transcript}"`;
  document.getElementById('voice-parsed-row').innerHTML = `
    <div class="voice-chip ok">🎯 Set budget</div>
    <div class="voice-chip ok">💰 ${fmt(amount)}</div>
    <div class="voice-chip ok">📅 ${monthLabel(viewMonth)}</div>
  `;
  /* Hide the Add-Expense confirm button since this isn't an expense */
  document.getElementById('voice-confirm-btn').style.display = 'none';
  card.style.display = 'flex';

  setLoading('Saving budget…');
  try {
    await ensureToken();
    const y = viewMonth.getFullYear();
    const m = viewMonth.getMonth() + 1;
    await upsertBudgetRow(y, m, amount);
    clearLoading();
    /* Restore confirm button for next voice use & dismiss this card */
    setTimeout(() => {
      card.style.display = 'none';
      document.getElementById('voice-confirm-btn').style.display = '';
    }, 1500);

    /* Re-render any view that shows budget info */
    if (currentView === 'dashboard') renderDashboard();
    if (currentView === 'insights')  renderInsights();

    /* Speak confirmation */
    const spent = computeSpentForMonth(y, m);
    const left  = Math.max(0, amount - spent);
    const msg   = spent > amount
      ? `Budget set to ${fmtSpoken(amount)}. You're already over by ${fmtSpoken(spent - amount)} this month.`
      : `Budget set to ${fmtSpoken(amount)}. You have ${fmtSpoken(left)} left for ${monthLabel(viewMonth)}.`;
    showToast(`Budget saved — ${fmt(amount)}`);
    speak(msg);
    burstConfetti(document.querySelector('.voice-btn'));
  } catch (e) {
    clearLoading();
    document.getElementById('voice-confirm-btn').style.display = '';
    showToast('Budget save failed: ' + e.message, true);
    speak('Sorry, I could not save your budget.');
    console.error(e);
  }
}

/* Handle a budget-status question. Computes the answer for the relevant month
   (defaults to current viewMonth, but understands "last month" / "in April"). */
function handleVoiceBudgetQuery(query, transcript) {
  /* Determine which month the question is about */
  const q = query.toLowerCase();
  let target = new Date(viewMonth);

  if (/\blast\s+month\b/.test(q)) {
    target = new Date(target.getFullYear(), target.getMonth() - 1, 1);
  } else if (/\bthis\s+month\b/.test(q) || /\bcurrent\s+month\b/.test(q)) {
    const now = new Date();
    target = new Date(now.getFullYear(), now.getMonth(), 1);
  } else {
    /* Try to match a month name (e.g. "in April", "for March 2025") */
    const MONTH_NAMES = ['january','february','march','april','may','june',
                         'july','august','september','october','november','december'];
    for (let i = 0; i < 12; i++) {
      const re = new RegExp(`\\b${MONTH_NAMES[i].slice(0,3)}[a-z]*\\b`);
      if (re.test(q)) {
        const yMatch = q.match(/\b(20\d{2})\b/);
        const year   = yMatch ? parseInt(yMatch[1]) : (new Date()).getFullYear();
        target = new Date(year, i, 1);
        break;
      }
    }
  }

  const y      = target.getFullYear();
  const m      = target.getMonth() + 1;
  const label  = monthLabel(target);
  const budget = getBudgetForMonth(y, m);
  const spent  = computeSpentForMonth(y, m);

  /* Echo the heard transcript */
  const card = document.getElementById('voice-result-card');
  document.getElementById('voice-heard-text').textContent = `"${transcript}"`;

  let answer, chips;
  if (!budget || budget.budget <= 0) {
    answer = `No budget set for ${label}. Try saying "set budget fifty thousand" to add one.`;
    chips  = `
      <div class="voice-chip err">🎯 No budget</div>
      <div class="voice-chip ok">📅 ${label}</div>
      <div class="voice-chip ok">💸 Spent ${fmt(spent)}</div>
    `;
  } else {
    const left      = budget.budget - spent;
    const overspent = left < 0;
    if (overspent) {
      answer = `Bad month for ${label}. You overspent by ${fmtSpoken(-left)} on a budget of ${fmtSpoken(budget.budget)}.`;
    } else {
      answer = `Good month so far. You have ${fmtSpoken(left)} left out of ${fmtSpoken(budget.budget)} for ${label}.`;
    }
    chips = `
      <div class="voice-chip ${overspent ? 'err' : 'ok'}">${overspent ? '💸 OVERSPENT' : '✅ ON TRACK'}</div>
      <div class="voice-chip ok">🎯 Budget ${fmt(budget.budget)}</div>
      <div class="voice-chip ok">💰 Spent ${fmt(spent)}</div>
      <div class="voice-chip ${overspent ? 'err' : 'ok'}">
        ${overspent ? '⚠️ Over by ' + fmt(-left) : '🟢 ' + fmt(left) + ' left'}
      </div>
      <div class="voice-chip ok">📅 ${label}</div>
    `;
  }

  document.getElementById('voice-parsed-row').innerHTML = chips;
  /* Hide the Add-Expense confirm button — this is just an answer card */
  document.getElementById('voice-confirm-btn').style.display = 'none';
  card.style.display = 'flex';

  /* Auto-dismiss after a short read window so it doesn't linger on the screen */
  setTimeout(() => {
    card.style.display = 'none';
    document.getElementById('voice-confirm-btn').style.display = '';
  }, 6000);

  speak(answer);
}

/* Handle a date-range voice query. Switches to Insights tab, drives the
   By-Date lens to the matched range (and optional category filter), echoes a
   visual chip card, then speaks the summary. */
function handleVoiceDateQuery(intent, transcript) {
  const { from, to, category } = intent;

  /* Drive the By-Date lens to the matched range so the user can see + tweak */
  if (intent.presetName && intent.presetName !== 'custom') {
    /* Use preset path so the active chip highlights correctly */
    if (currentView !== 'insights') switchView('insights');
    /* switchView('insights') calls resetBydate() which forces 'today' — undo
       by setting the requested preset AFTER the switch. */
    setBydatePreset(intent.presetName);
  } else {
    if (currentView !== 'insights') switchView('insights');
    bydatePreset = 'custom';
    bydateFrom = from;
    bydateTo   = to;
    document.querySelectorAll('.bydate-chip').forEach(c => {
      c.classList.toggle('active', c.dataset.preset === 'custom');
    });
    renderBydate();
    updateHeaderMonth();
  }

  /* Now compute the answer — optionally filtered by category. */
  let expenses = expensesInRange(from, to);
  let categoryLabel = '';
  if (category) {
    const c = CAT_MAP[category];
    categoryLabel = c ? c.label : category;
    expenses = expenses.filter(e => e.category === category);
  }
  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const count = expenses.length;

  /* Visual chip card */
  const card = document.getElementById('voice-result-card');
  document.getElementById('voice-heard-text').textContent = `"${transcript}"`;
  const rangeLabel = formatRangeLabel(from, to);
  const chips = [];
  chips.push(`<div class="voice-chip ok">📅 ${rangeLabel}</div>`);
  if (categoryLabel) chips.push(`<div class="voice-chip ok">${(CAT_MAP[category]?.icon) || '📦'} ${categoryLabel}</div>`);
  chips.push(`<div class="voice-chip ${count ? 'ok' : 'err'}">💰 ${fmt(total)}</div>`);
  chips.push(`<div class="voice-chip ok">📝 ${count} entr${count !== 1 ? 'ies' : 'y'}</div>`);

  /* Top-category hint when no category was asked for */
  if (!category && count > 0) {
    const byCat = {};
    expenses.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + e.amount; });
    const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
    const tc  = CAT_MAP[top[0]];
    if (tc) chips.push(`<div class="voice-chip ok">${tc.icon} Top: ${tc.label} ${fmt(top[1])}</div>`);
  }

  document.getElementById('voice-parsed-row').innerHTML = chips.join('');
  document.getElementById('voice-confirm-btn').style.display = 'none';
  card.style.display = 'flex';
  setTimeout(() => {
    card.style.display = 'none';
    document.getElementById('voice-confirm-btn').style.display = '';
  }, 6000);

  /* Spoken summary */
  let spoken;
  if (count === 0) {
    spoken = categoryLabel
      ? `No ${categoryLabel} expenses for ${rangeLabel}.`
      : `No expenses for ${rangeLabel}.`;
  } else if (categoryLabel) {
    spoken = `${rangeLabel}: you spent ${fmtSpoken(total)} on ${categoryLabel} across ${count} ${count === 1 ? 'entry' : 'entries'}.`;
  } else {
    /* Mention top category in the spoken summary for context */
    const byCat = {};
    expenses.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + e.amount; });
    const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
    const tc  = top ? CAT_MAP[top[0]] : null;
    const tail = tc ? `, most on ${tc.label.toLowerCase()} — ${fmtSpoken(top[1])}` : '';
    spoken = `${rangeLabel}: ${fmtSpoken(total)} on ${count} ${count === 1 ? 'entry' : 'entries'}${tail}.`;
  }
  speak(spoken);
}

/* Voice entry point biased toward queries — used by Insights "Ask by voice"
   button. Same recognition pipeline as startVoice(); the result is routed
   through the existing intent classifier in handleVoiceResult(). */
function startVoiceAsk() {
  /* Friendly hint so the user knows what kinds of questions work */
  showToast('Ask: "Spent yesterday?" · "Last 7 days?" · "Budget left?"');
  startVoice();
}

function startVoice() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    showToast('Voice not supported — try Safari on iPhone', true);
    return;
  }
  /* Guard against rapid double-tap: ignore until we're past start handshake */
  if (voiceStarting) return;
  voiceStarting = true;
  voiceAborted  = false;

  /* Tear down any prior recognition cleanly to avoid the race that produces
     spurious "aborted" errors when start() is called while another instance
     is still alive. */
  if (recognition) {
    try {
      recognition.onend = null;
      recognition.onerror = null;
      recognition.onresult = null;
      recognition.abort();
    } catch (_) { /* noop */ }
    recognition = null;
  }

  /* Tiny delay lets the browser fully release the mic from the previous
     session — important on iOS Safari where back-to-back start() throws. */
  setTimeout(() => {
    let r;
    try {
      r = new SpeechRec();
      r.lang           = 'en-IN';
      r.continuous     = false;
      r.interimResults = true;
    } catch (err) {
      voiceStarting = false;
      showToast('Mic init failed — try again', true);
      console.error(err);
      return;
    }

    document.getElementById('voice-idle').style.display      = 'none';
    document.getElementById('voice-listening').style.display = 'flex';
    document.getElementById('voice-transcript-text').textContent = 'Listening…';

    r.onresult = e => {
      const t = Array.from(e.results).map(res => res[0].transcript).join('');
      document.getElementById('voice-transcript-text').textContent = t || 'Listening…';
    };

    r.onend = () => {
      document.getElementById('voice-idle').style.display      = 'flex';
      document.getElementById('voice-listening').style.display = 'none';
      const text = document.getElementById('voice-transcript-text').textContent.trim();
      recognition = null;
      voiceStarting = false;
      /* Skip processing if we were aborted (error path) */
      if (voiceAborted) { voiceAborted = false; return; }
      if (text && text !== 'Listening…') handleVoiceResult(text);
    };

    r.onerror = e => {
      voiceAborted = true;
      document.getElementById('voice-idle').style.display      = 'flex';
      document.getElementById('voice-listening').style.display = 'none';
      /* Suppress noisy benign errors:
         - 'aborted'   = user re-tapped mic / system race
         - 'no-speech' = silence; nothing to do */
      if (e.error === 'aborted' || e.error === 'no-speech') return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        showToast('Mic permission blocked — enable it in browser settings', true);
      } else if (e.error === 'network') {
        showToast('Mic needs internet — check your connection', true);
      } else if (e.error === 'audio-capture') {
        showToast('No mic detected', true);
      } else {
        showToast('Mic error: ' + e.error, true);
      }
    };

    try {
      r.start();
      recognition = r;
    } catch (err) {
      /* "InvalidStateError: recognition already started" — usually a stuck
         state from a prior crash. Reset and let user retry. */
      voiceStarting = false;
      document.getElementById('voice-idle').style.display      = 'flex';
      document.getElementById('voice-listening').style.display = 'none';
      console.error('Mic start failed:', err);
      showToast('Mic busy — tap again in a moment', true);
    }
  }, 120);
}

function stopVoice() {
  if (recognition) {
    try { recognition.stop(); } catch (_) { /* noop */ }
  }
}

function handleVoiceResult(transcript) {
  /* ── Intent routing — try budget-command and budget-query first.
        If neither matches, fall through to the original "add expense" path.  */
  const intent = classifyVoiceIntent(transcript);
  if (intent.type === 'budget-set') {
    handleVoiceBudgetSet(intent.amount, transcript);
    return;
  }
  if (intent.type === 'budget-query') {
    handleVoiceBudgetQuery(intent.query, transcript);
    return;
  }
  if (intent.type === 'date-query') {
    handleVoiceDateQuery(intent, transcript);
    return;
  }

  const parsed = parseVoiceCommand(transcript);
  voiceParsed  = { ...parsed, transcript };

  const cat         = parsed.category ? CAT_MAP[parsed.category] : null;
  const dateDisplay = (() => {
    if (parsed.date === todayStr()) return 'Today';
    const [y, m, d] = parsed.date.split('-');
    return `${parseInt(d)} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m)-1]} ${y}`;
  })();

  document.getElementById('voice-heard-text').textContent = `"${transcript}"`;
  document.getElementById('voice-parsed-row').innerHTML = `
    <div class="voice-chip ${parsed.amount ? 'ok' : 'err'}">
      💰 ${parsed.amount ? fmt(parsed.amount) : 'Amount?'}
    </div>
    <div class="voice-chip ${cat ? 'ok' : 'err'}">
      ${cat ? cat.icon + ' ' + cat.label : '❓ Category?'}
    </div>
    <div class="voice-chip ok">📅 ${dateDisplay}</div>
    ${parsed.note ? `<div class="voice-chip ok">📝 ${escapeHTML(parsed.note)}</div>` : ''}
  `;

  document.getElementById('voice-confirm-btn').disabled = !(parsed.amount && parsed.category);
  document.getElementById('voice-result-card').style.display = 'flex';
}

function cancelVoice() {
  voiceParsed = null;
  document.getElementById('voice-result-card').style.display = 'none';
}

function editVoiceResult() {
  if (!voiceParsed) return;
  if (voiceParsed.amount)   { document.getElementById('amount-input').value = voiceParsed.amount; refreshAddBtn(); }
  if (voiceParsed.category) selectCat(voiceParsed.category);
  if (voiceParsed.date)     document.getElementById('date-input').value = voiceParsed.date;
  if (voiceParsed.note)     document.getElementById('note-input').value = voiceParsed.note;
  cancelVoice();
}

async function confirmVoiceAdd() {
  if (!voiceParsed?.amount || !voiceParsed?.category) return;
  const { amount, category, date, note = '' } = voiceParsed;
  cancelVoice();
  setLoading('Saving to Google Sheets…');
  try {
    await ensureToken();
    await appendExpenseRow({ date, category, amount, note, createdAt: new Date().toISOString() });
    await loadExpenses();
    /* Keep Budgets tab in sync if a budget exists for this expense's month */
    const [ey, em] = date.split('-').map(Number);
    try { await recomputeBudgetForMonth(ey, em); } catch (err) { console.warn('Budget sync failed:', err); }
    renderTodayTotal();
    if (currentView === 'dashboard') renderDashboard();
    if (currentView === 'insights')  renderInsights();
    clearLoading();
    showToast('Saved ✓');
    burstConfetti(document.querySelector('.voice-btn') || document.getElementById('add-btn'));
  } catch (e) {
    clearLoading();
    showToast('Save failed: ' + e.message, true);
    console.error(e);
  }
}

/* ═══════════════════════════════════════════════════════════
   SERVICE WORKER + INIT
   ═══════════════════════════════════════════════════════════ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(e => console.warn('SW failed:', e));
  });
}

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('amount-input').addEventListener('input', function() {
    this.value = this.value.replace(/[^0-9.]/g, '');
    refreshAddBtn();
  });
  document.getElementById('month-prev').addEventListener('click', () => changeMonth(-1));
  document.getElementById('month-next').addEventListener('click', () => changeMonth(1));
  document.getElementById('confirm-modal').addEventListener('click', function(e) {
    if (e.target === this) closeConfirm();
  });
  document.getElementById('add-cat-modal').addEventListener('click', function(e) {
    if (e.target === this) closeAddCatModal();
  });
  document.getElementById('new-cat-icon').addEventListener('input', validateNewCat);
  document.getElementById('new-cat-name').addEventListener('input', validateNewCat);
  if (typeof google !== 'undefined' && google.accounts) initGoogleAuth();
});
