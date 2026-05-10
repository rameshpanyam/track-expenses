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
let customCategories = JSON.parse(localStorage.getItem('customCategories') || '[]');

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
let tokenClient   = null;
let accessToken   = null;
let tokenExpiry   = 0;
let spreadsheetId = localStorage.getItem('expenseSheetId') || null;
let sheetGid      = Number(localStorage.getItem('expenseSheetGid') ?? -1);
let allExpenses   = [];
let currentView   = 'add';
let selectedCat   = null;
let viewMonth     = new Date(); viewMonth.setDate(1);
let pendingDeleteRow = null;

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
    clearLoading();
    buildAddView();
    switchView('add');
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
    await appendExpenseRow({ date: dateEl.value, category: selectedCat, amount, note: noteEl.value.trim(), createdAt: new Date().toISOString() });
    await loadExpenses();

    amountEl.value = '';
    noteEl.value   = '';
    dateEl.value   = todayStr();
    selectedCat    = null;
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('selected'));
    refreshAddBtn();
    renderTodayTotal();
    clearLoading();
    showToast('Saved ✓');
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
  try {
    await ensureToken();
    await deleteSheetRow(row);
    await loadExpenses();
    if (currentView === 'dashboard') renderDashboard();
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

function saveNewCategory() {
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

  /* ── All entries for this month (date-grouped) ── */
  const byDate = {};
  [...expenses].sort((a,b) => b.date.localeCompare(a.date)).forEach(e => {
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  });
  const dates = Object.keys(byDate);
  document.getElementById('dash-entries').innerHTML = dates.length === 0
    ? `<div class="empty-state"><div class="empty-icon">📭</div><p>No entries for ${monthLabel(viewMonth)}.<br/>Tap <strong>Add</strong> to record one.</p></div>`
    : dates.map(date => {
        const rows     = byDate[date];
        const dayTotal = rows.reduce((s,e) => s + e.amount, 0);
        return `
          <div class="month-group">
            <div class="month-group-header">
              <span>${fmtDate(date)}</span>
              <span class="month-group-total">${fmt(dayTotal)}</span>
            </div>
            ${rows.map(e => expenseRowHTML(e, true)).join('')}
          </div>`;
      }).join('');
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
function expenseRowHTML(e, hideDate = false) {
  const cat = CAT_MAP[e.category] || { icon: '📦', label: e.category, color: '#78909C' };
  return `
    <div class="expense-row">
      <div class="expense-cat-icon" style="background:${cat.color}22;">${cat.icon}</div>
      <div class="expense-info">
        <div class="expense-cat-name">${cat.label}</div>
        ${e.note ? `<div class="expense-note">${e.note}</div>` : ''}
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
   VIEW ROUTER
   ═══════════════════════════════════════════════════════════ */
function switchView(view) {
  currentView = view;
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('view-'  + view).classList.add('active');
  document.getElementById('nav-'   + view).classList.add('active');
  updateHeaderMonth();

  if (view === 'add')       renderTodayTotal();
  if (view === 'dashboard') renderDashboard();
}

function updateHeaderMonth() {
  const el   = document.getElementById('header-month-label');
  const prev = document.getElementById('month-prev');
  const next = document.getElementById('month-next');

  if (currentView === 'add') {
    el.textContent          = 'Today';
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
}

/* ═══════════════════════════════════════════════════════════
   VOICE ENTRY ENGINE
   ═══════════════════════════════════════════════════════════ */
let recognition = null;
let voiceParsed = null;

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

function parseVoiceCommand(text) {
  const lower = text.toLowerCase().trim();

  /* ── Amount: first number found ── */
  const amountMatch = lower.match(/\b(\d+(?:\.\d+)?)\b/);
  const amount = amountMatch ? parseFloat(amountMatch[1]) : null;

  /* ── Category: keyword match (built-in first, then custom) ── */
  let category = null;
  for (const [cat, keywords] of Object.entries(VOICE_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) { category = cat; break; }
  }
  if (!category) {
    for (const c of customCategories) {
      if (lower.includes(c.label.toLowerCase())) { category = c.key; break; }
    }
  }

  /* ── Date: default today, then check keywords ── */
  let date = todayStr();
  if (lower.includes('yesterday')) {
    const d = new Date(); d.setDate(d.getDate() - 1);
    date = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  } else {
    /* Match "12th january", "12 jan", "january 12", "jan 12" */
    const monthNames = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec';
    const p1 = new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNames})`, 'i');
    const p2 = new RegExp(`(${monthNames})\\s+(\\d{1,2})`, 'i');
    let dm = lower.match(p1) || lower.match(p2);
    if (dm) {
      let day, monthStr;
      if (/^\d/.test(dm[1])) { day = parseInt(dm[1]); monthStr = dm[2]; }
      else                   { monthStr = dm[1]; day = parseInt(dm[2]); }
      const month = MONTH_MAP[monthStr.toLowerCase()];
      if (month && day >= 1 && day <= 31) {
        const now = new Date();
        let year  = now.getFullYear();
        /* If the specified month is in the future this year, use last year */
        if (month > now.getMonth() + 1) year -= 1;
        date = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      }
    }
  }

  return { amount, category, date };
}

function startVoice() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    showToast('Voice not supported — try Safari on iPhone', true);
    return;
  }
  recognition = new SpeechRec();
  recognition.lang           = 'en-IN';
  recognition.continuous     = false;
  recognition.interimResults = true;

  document.getElementById('voice-idle').style.display      = 'none';
  document.getElementById('voice-listening').style.display = 'flex';
  document.getElementById('voice-transcript-text').textContent = 'Listening…';

  recognition.onresult = e => {
    const t = Array.from(e.results).map(r => r[0].transcript).join('');
    document.getElementById('voice-transcript-text').textContent = t || 'Listening…';
  };

  recognition.onend = () => {
    const text = document.getElementById('voice-transcript-text').textContent.trim();
    document.getElementById('voice-idle').style.display      = 'flex';
    document.getElementById('voice-listening').style.display = 'none';
    if (text && text !== 'Listening…') handleVoiceResult(text);
  };

  recognition.onerror = e => {
    document.getElementById('voice-idle').style.display      = 'flex';
    document.getElementById('voice-listening').style.display = 'none';
    if (e.error !== 'no-speech') showToast('Mic error: ' + e.error, true);
  };

  recognition.start();
}

function stopVoice() {
  if (recognition) { recognition.stop(); recognition = null; }
}

function handleVoiceResult(transcript) {
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
  cancelVoice();
}

async function confirmVoiceAdd() {
  if (!voiceParsed?.amount || !voiceParsed?.category) return;
  const { amount, category, date } = voiceParsed;
  cancelVoice();
  setLoading('Saving to Google Sheets…');
  try {
    await ensureToken();
    await appendExpenseRow({ date, category, amount, note: '', createdAt: new Date().toISOString() });
    await loadExpenses();
    renderTodayTotal();
    clearLoading();
    showToast('Saved ✓');
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
