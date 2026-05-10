/* ═══════════════════════════════════════════════════════════
   EXPENSE TRACKER — Google Sheets backend + Google Sign-In
   ═══════════════════════════════════════════════════════════

   ⚠️  SETUP REQUIRED — replace the line below with your
       Google OAuth Client ID (see README for instructions).
   ═══════════════════════════════════════════════════════════ */
const CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';

/* ── Google Sheets config ──────────────────────────────────── */
const SCOPES         = 'https://www.googleapis.com/auth/spreadsheets';
const SPREADSHEET_NAME = 'Track Expenses';
const TAB_NAME         = 'Expenses';
const HEADERS          = ['Date', 'Category', 'Amount', 'Note', 'CreatedAt'];

/* ── Categories (matching your Excel) ─────────────────────── */
const CATEGORIES = [
  { key: 'food',      icon: '🍽️',  label: 'Food'     },
  { key: 'grocery',   icon: '🛒',  label: 'Grocery'  },
  { key: 'market',    icon: '🥦',  label: 'Market'   },
  { key: 'medicine',  icon: '💊',  label: 'Medicine' },
  { key: 'petrol',    icon: '⛽',  label: 'Petrol'   },
  { key: 'recharge',  icon: '📱',  label: 'Recharge' },
  { key: 'water',     icon: '💧',  label: 'Water'    },
  { key: 'gifts',     icon: '🎁',  label: 'Gifts'    },
  { key: 'other',     icon: '📦',  label: 'Other'    },
];
const CAT_MAP = Object.fromEntries(CATEGORIES.map(c => [c.key, c]));

/* ── App state ─────────────────────────────────────────────── */
let tokenClient   = null;
let accessToken   = null;
let tokenExpiry   = 0;

// Spreadsheet IDs saved to localStorage so we don't recreate each session
let spreadsheetId = localStorage.getItem('expenseSheetId') || null;
let sheetGid      = Number(localStorage.getItem('expenseSheetGid') ?? -1);

let allExpenses   = [];   // { rowIndex, date, category, amount, note, createdAt }
let currentView   = 'add';
let selectedCat   = null;
let viewMonth     = new Date();
viewMonth.setDate(1);

/* ── Pending delete confirmation ───────────────────────────── */
let pendingDeleteRow = null;

/* ═══════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════ */
function fmt(amount) {
  return '₹' + Number(amount).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}
function fmtDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(d)} ${months[parseInt(m) - 1]}`;
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function monthLabel(date) {
  return date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

/* ── Toast ─────────────────────────────────────────────────── */
function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = isError ? 'var(--red)' : 'var(--green)';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

/* ── Loading overlay ───────────────────────────────────────── */
function setLoading(msg) {
  document.getElementById('loading-msg').textContent = msg || 'Loading…';
  document.getElementById('loading-overlay').style.display = 'flex';
}
function clearLoading() {
  document.getElementById('loading-overlay').style.display = 'none';
}

/* ═══════════════════════════════════════════════════════════
   GOOGLE SHEETS API
   ═══════════════════════════════════════════════════════════ */
async function sheetsRequest(method, path, body) {
  const url = path.startsWith('https')
    ? path
    : `https://sheets.googleapis.com/v4/spreadsheets${path}`;

  const r = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type':  'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error?.message || `Sheets API ${method} → HTTP ${r.status}`);
  }
  return r.json();
}

/* ── Find or create the spreadsheet ───────────────────────── */
async function initSpreadsheet() {
  // Try the stored spreadsheet ID first
  if (spreadsheetId) {
    try {
      const meta = await sheetsRequest('GET', `/${spreadsheetId}?fields=spreadsheetId,sheets.properties`);
      spreadsheetId = meta.spreadsheetId;
      const tab = meta.sheets.find(s => s.properties.title === TAB_NAME);
      if (tab) {
        sheetGid = tab.properties.sheetId;
        localStorage.setItem('expenseSheetGid', sheetGid);
        return; // all good, existing sheet found
      }
      // Spreadsheet exists but our tab is missing — add it
      const addResp = await sheetsRequest('POST', `/${spreadsheetId}:batchUpdate`, {
        requests: [{ addSheet: { properties: { title: TAB_NAME } } }]
      });
      sheetGid = addResp.replies[0].addSheet.properties.sheetId;
      localStorage.setItem('expenseSheetGid', sheetGid);
      await writeHeaders();
      return;
    } catch (e) {
      console.warn('Stored sheet ID not usable, creating new one:', e.message);
      spreadsheetId = null;
      sheetGid      = -1;
      localStorage.removeItem('expenseSheetId');
      localStorage.removeItem('expenseSheetGid');
    }
  }

  // Create a brand-new spreadsheet in the user's Drive
  const created = await sheetsRequest('POST', '', {
    properties: { title: SPREADSHEET_NAME },
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
    { values: [HEADERS] }
  );
}

/* ── Load all expenses ─────────────────────────────────────── */
async function loadExpenses() {
  const data = await sheetsRequest('GET', `/${spreadsheetId}/values/${TAB_NAME}!A:E`);
  const rows = data.values || [];
  // Row 1 is the header; data starts at row 2 (rowIndex 2 = 0-based index 1 in Sheets)
  allExpenses = rows
    .slice(1)
    .map((row, i) => ({
      rowIndex:  i + 2,                   // 1-based sheet row (header is row 1)
      date:      row[0] || '',
      category:  row[1] || '',
      amount:    parseFloat(row[2]) || 0,
      note:      row[3] || '',
      createdAt: row[4] || '',
    }))
    .filter(e => e.date && e.amount > 0);
}

/* ── Append a new expense row ──────────────────────────────── */
async function appendExpenseRow(expense) {
  await sheetsRequest('POST',
    `/${spreadsheetId}/values/${TAB_NAME}!A:E:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { values: [[expense.date, expense.category, expense.amount, expense.note, expense.createdAt]] }
  );
}

/* ── Delete a row by its 1-based sheet row number ─────────── */
async function deleteSheetRow(rowIndex) {
  if (sheetGid < 0) {
    // Re-fetch sheetGid if it got lost
    const meta = await sheetsRequest('GET', `/${spreadsheetId}?fields=sheets.properties`);
    const tab  = meta.sheets.find(s => s.properties.title === TAB_NAME);
    sheetGid   = tab ? tab.properties.sheetId : 0;
    localStorage.setItem('expenseSheetGid', sheetGid);
  }
  await sheetsRequest('POST', `/${spreadsheetId}:batchUpdate`, {
    requests: [{
      deleteDimension: {
        range: {
          sheetId:    sheetGid,
          dimension:  'ROWS',
          startIndex: rowIndex - 1,   // 0-based
          endIndex:   rowIndex,
        }
      }
    }]
  });
}

/* ═══════════════════════════════════════════════════════════
   TOKEN / AUTH
   ═══════════════════════════════════════════════════════════ */
function initGoogleAuth() {
  // Bail out if CLIENT_ID is still the placeholder
  if (CLIENT_ID.includes('YOUR_GOOGLE_CLIENT_ID')) {
    document.getElementById('signin-btn').textContent = '⚠️ CLIENT_ID not set — see README';
    document.getElementById('signin-btn').disabled = true;
    return;
  }

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope:     SCOPES,
    callback:  handleTokenResponse,
  });
}

async function handleTokenResponse(resp) {
  if (resp.error) {
    showToast('Sign-in failed: ' + resp.error, true);
    clearLoading();
    return;
  }
  accessToken = resp.access_token;
  tokenExpiry = Date.now() + resp.expires_in * 1000;

  // Show the app shell, hide login
  document.getElementById('login-screen').style.display  = 'none';
  document.getElementById('app').style.display            = 'flex';

  setLoading('Setting up your Google Sheet…');
  try {
    await initSpreadsheet();
    setLoading('Loading your expenses…');
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

function signIn() {
  if (!tokenClient) {
    showToast('Google Sign-In not ready yet, try again in a moment.', true);
    return;
  }
  // prompt: '' → silent if user already granted; 'select_account' to force picker
  tokenClient.requestAccessToken({ prompt: '' });
}

function signOut() {
  google.accounts.oauth2.revoke(accessToken, () => {
    accessToken   = null;
    spreadsheetId = null;
    sheetGid      = -1;
    allExpenses   = [];
    localStorage.removeItem('expenseSheetId');
    localStorage.removeItem('expenseSheetGid');
    document.getElementById('app').style.display           = 'none';
    document.getElementById('login-screen').style.display  = 'flex';
  });
}

/* Silently refresh the token before it expires */
async function ensureToken() {
  if (Date.now() < tokenExpiry - 60_000) return; // still valid for ≥1 min
  await new Promise(resolve => {
    tokenClient.requestAccessToken({
      prompt: '',
      callback: (resp) => {
        if (!resp.error) {
          accessToken = resp.access_token;
          tokenExpiry = Date.now() + resp.expires_in * 1000;
        }
        resolve();
      }
    });
  });
}

/* Called by Google's script after it loads */
function onGoogleLibraryLoad() {
  // google.accounts is now available
  setTimeout(initGoogleAuth, 100);
}

/* ═══════════════════════════════════════════════════════════
   ADD VIEW
   ═══════════════════════════════════════════════════════════ */
function buildAddView() {
  document.getElementById('cat-grid').innerHTML = CATEGORIES.map(c => `
    <button class="cat-btn" data-cat="${c.key}" onclick="selectCat('${c.key}')">
      <span class="cat-icon">${c.icon}</span>
      <span class="cat-name">${c.label}</span>
    </button>
  `).join('');
  document.getElementById('date-input').value = todayStr();
  refreshAddBtn();
  renderTodayTotal();
}

function selectCat(key) {
  selectedCat = key;
  document.querySelectorAll('.cat-btn').forEach(btn =>
    btn.classList.toggle('selected', btn.dataset.cat === key)
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
  const today  = todayStr();
  const todayE = allExpenses.filter(e => e.date === today);
  const total  = todayE.reduce((s, e) => s + e.amount, 0);
  const el     = document.getElementById('today-total');
  if (!el) return;
  if (total > 0) {
    el.textContent = `Today: ${fmt(total)} · ${todayE.length} entr${todayE.length === 1 ? 'y' : 'ies'}`;
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

async function saveExpense() {
  const amountEl = document.getElementById('amount-input');
  const noteEl   = document.getElementById('note-input');
  const dateEl   = document.getElementById('date-input');
  const amount   = parseFloat(amountEl.value);

  if (!amount || amount <= 0) { amountEl.focus(); return; }
  if (!selectedCat)            { showToast('Pick a category'); return; }
  if (!dateEl.value)           { dateEl.focus(); return; }

  setLoading('Saving to Google Sheets…');
  try {
    await ensureToken();
    await appendExpenseRow({
      date:      dateEl.value,
      category:  selectedCat,
      amount:    amount,
      note:      noteEl.value.trim(),
      createdAt: new Date().toISOString(),
    });
    await loadExpenses();   // reload so rowIndex is accurate

    // Reset form
    amountEl.value = '';
    noteEl.value   = '';
    dateEl.value   = todayStr();
    selectedCat    = null;
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('selected'));
    refreshAddBtn();
    renderTodayTotal();
    clearLoading();
    showToast('Saved to Google Sheets ✓');
  } catch (e) {
    clearLoading();
    showToast('Save failed: ' + e.message, true);
    console.error(e);
  }
}

/* ═══════════════════════════════════════════════════════════
   DELETE — custom confirm modal (iOS PWA blocks window.confirm)
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
  closeConfirm();
  if (pendingDeleteRow === null) return;
  const row = pendingDeleteRow;
  pendingDeleteRow = null;

  setLoading('Deleting…');
  try {
    await ensureToken();
    await deleteSheetRow(row);
    await loadExpenses();
    if (currentView === 'summary') renderSummary();
    if (currentView === 'history') renderHistory();
    renderTodayTotal();
    clearLoading();
    showToast('Deleted — check Google Sheets to undo ✓');
  } catch (e) {
    clearLoading();
    showToast('Delete failed: ' + e.message, true);
    console.error(e);
  }
}

/* ═══════════════════════════════════════════════════════════
   SUMMARY VIEW
   ═══════════════════════════════════════════════════════════ */
function monthExpenses() {
  const y = viewMonth.getFullYear(), m = viewMonth.getMonth() + 1;
  return allExpenses.filter(e => {
    if (!e.date) return false;
    const [ey, em] = e.date.split('-').map(Number);
    return ey === y && em === m;
  });
}

function renderSummary() {
  const expenses = monthExpenses().sort((a, b) => b.date.localeCompare(a.date));
  const total    = expenses.reduce((s, e) => s + e.amount, 0);

  document.getElementById('summary-total-amount').textContent = fmt(total);
  document.getElementById('summary-total-count').textContent  =
    `${expenses.length} expense${expenses.length !== 1 ? 's' : ''}`;

  // Category breakdown
  const byCategory = {};
  CATEGORIES.forEach(c => { byCategory[c.key] = 0; });
  expenses.forEach(e => { byCategory[e.category] = (byCategory[e.category] || 0) + e.amount; });

  const sorted = CATEGORIES
    .map(c => ({ ...c, amount: byCategory[c.key] || 0 }))
    .filter(c => c.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const listEl = document.getElementById('cat-summary-list');
  if (sorted.length === 0) {
    listEl.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div>
      <p>No expenses recorded for ${monthLabel(viewMonth)}.</p></div>`;
  } else {
    const maxAmt = sorted[0].amount;
    listEl.innerHTML = sorted.map(c => `
      <div class="cat-summary-row">
        <span class="cat-summary-icon">${c.icon}</span>
        <div class="cat-summary-info">
          <div class="cat-summary-name">${c.label}</div>
          <div class="cat-summary-bar-track">
            <div class="cat-summary-bar-fill" style="width:${Math.round((c.amount/maxAmt)*100)}%"></div>
          </div>
        </div>
        <div>
          <div class="cat-summary-amount">${fmt(c.amount)}</div>
          <div class="cat-summary-pct">${total > 0 ? Math.round((c.amount/total)*100) : 0}%</div>
        </div>
      </div>
    `).join('');
  }

  // All expenses list
  document.getElementById('summary-expense-list').innerHTML = expenses.length === 0 ? '' :
    expenses.map(e => expenseRowHTML(e)).join('');
}

/* ═══════════════════════════════════════════════════════════
   HISTORY VIEW
   ═══════════════════════════════════════════════════════════ */
function renderHistory() {
  const expenses = monthExpenses();
  const byDate   = {};
  expenses.forEach(e => {
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  });

  const dates     = Object.keys(byDate).sort().reverse();
  const container = document.getElementById('history-list');

  if (dates.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div>
      <p>No expenses for ${monthLabel(viewMonth)}.</p></div>`;
    return;
  }

  container.innerHTML = dates.map(date => {
    const rows     = byDate[date].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const dayTotal = rows.reduce((s, e) => s + e.amount, 0);
    return `
      <div class="month-group">
        <div class="month-group-header">
          <span>${fmtDate(date)}</span>
          <span class="month-group-total">${fmt(dayTotal)}</span>
        </div>
        <div class="expense-list">
          ${rows.map(e => expenseRowHTML(e, true)).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function expenseRowHTML(e, hideDate = false) {
  const cat = CAT_MAP[e.category] || { icon: '📦', label: e.category };
  return `
    <div class="expense-row">
      <span class="expense-cat-icon">${cat.icon}</span>
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
  document.getElementById('view-' + view).classList.add('active');
  document.getElementById('nav-'  + view).classList.add('active');
  updateHeaderMonth();
  if (view === 'add')     renderTodayTotal();
  if (view === 'summary') renderSummary();
  if (view === 'history') renderHistory();
}

function updateHeaderMonth() {
  const el = document.getElementById('header-month-label');
  if (currentView === 'add') {
    el.textContent = 'Today';
    document.getElementById('month-prev').style.visibility = 'hidden';
    document.getElementById('month-next').style.visibility = 'hidden';
  } else {
    el.textContent = monthLabel(viewMonth);
    document.getElementById('month-prev').style.visibility = 'visible';
    document.getElementById('month-next').style.visibility = 'visible';
  }
}

function changeMonth(delta) {
  viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + delta, 1);
  updateHeaderMonth();
  if (currentView === 'summary') renderSummary();
  if (currentView === 'history') renderHistory();
}

/* ═══════════════════════════════════════════════════════════
   SERVICE WORKER + INIT
   ═══════════════════════════════════════════════════════════ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err =>
      console.warn('SW registration failed:', err)
    );
  });
}

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('amount-input').addEventListener('input', function() {
    this.value = this.value.replace(/[^0-9.]/g, '');
    refreshAddBtn();
  });
  document.getElementById('month-prev').addEventListener('click', () => changeMonth(-1));
  document.getElementById('month-next').addEventListener('click', () => changeMonth(1));

  // Close confirm modal on backdrop click
  document.getElementById('confirm-modal').addEventListener('click', function(e) {
    if (e.target === this) closeConfirm();
  });

  // Google library may have loaded before DOMContentLoaded
  if (typeof google !== 'undefined' && google.accounts) {
    initGoogleAuth();
  }
  // Otherwise onGoogleLibraryLoad() will be called by the GSI script
});
