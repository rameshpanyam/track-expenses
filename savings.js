/* ═══════════════════════════════════════════════════════════════════
   SAVINGS MODULE — v28.2
   Simple debit/credit ledger for cash savings. Isolated by design:
     • No other module writes to savings state.
     • No expense/loan/dashboard hooks mutate this data.
     • Loans CAN read the total (already supported via currentSavings in
       its own state) but uses its own copy — savings stays the source
       of truth here, never altered from outside.

   Data model:
     { entries: [ { id, date, type: 'credit' | 'debit', amount, note } ] }
     Balance = Σ credits − Σ debits

   Storage:
     localStorage['expense-tracker.savings.v1']
   ═══════════════════════════════════════════════════════════════════ */

'use strict';

const SAVINGS_STORAGE_KEY = 'expense-tracker.savings.v1';

/* ─── Sheet sync constants (v28.3) ───────────────────────────────── */
const SAVINGS_TAB_NAME = 'Savings';
const SAVINGS_HEADERS  = ['ID', 'Date', 'Type', 'Amount', 'Note', 'CreatedAt', 'UpdatedAt'];

/* ─── State ──────────────────────────────────────────────────────── */
var savingsState   = null;
var savingsEditingId = null;
var savingsEntryType = 'credit';  // form-side selection
var savingsGid       = Number(localStorage.getItem('savingsSheetGid') ?? -1);

/* ═══════════════════════════════════════════════════════════════════
   STORAGE
   ═══════════════════════════════════════════════════════════════════ */
function loadSavingsState() {
  try {
    const raw = localStorage.getItem(SAVINGS_STORAGE_KEY);
    savingsState = raw ? JSON.parse(raw) : { entries: [] };
    if (!savingsState.entries) savingsState.entries = [];
  } catch (e) {
    console.warn('loadSavingsState error', e);
    savingsState = { entries: [] };
  }
}

function saveSavingsState() {
  try {
    localStorage.setItem(SAVINGS_STORAGE_KEY, JSON.stringify(savingsState));
  } catch (e) {
    console.warn('saveSavingsState error', e);
  }
  // Fire-and-forget sheet sync (non-blocking — UI stays instant)
  syncSavingsToSheet().catch(e => console.warn('Savings sheet sync failed:', e.message));
}

/* ═══════════════════════════════════════════════════════════════════
   GOOGLE SHEETS SYNC (v28.3)
   - Tab name: "Savings" inside the same expense spreadsheet.
   - Columns: ID | Date | Type | Amount | Note | CreatedAt | UpdatedAt
   - Strategy: localStorage is the working copy; every save overwrites
     the full Savings tab range (idempotent). On sign-in, we pull from
     the sheet to refresh local state (sheet wins on conflict).
   ═══════════════════════════════════════════════════════════════════ */
async function ensureSavingsTab() {
  if (!window.spreadsheetId || !window.accessToken) return false;
  if (typeof window.sheetsRequest !== 'function') return false;

  const meta = await window.sheetsRequest('GET',
    `/${window.spreadsheetId}?fields=sheets.properties`);
  const tab  = meta.sheets.find(s => s.properties.title === SAVINGS_TAB_NAME);

  if (tab) {
    savingsGid = tab.properties.sheetId;
    localStorage.setItem('savingsSheetGid', savingsGid);
    // Ensure headers row exists
    const hdr = await window.sheetsRequest('GET',
      `/${window.spreadsheetId}/values/${SAVINGS_TAB_NAME}!A1:G1`);
    if (!hdr.values || !hdr.values.length) {
      await window.sheetsRequest('POST',
        `/${window.spreadsheetId}/values/${SAVINGS_TAB_NAME}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        { values: [SAVINGS_HEADERS] });
    }
  } else {
    // Create the tab + write headers
    const res = await window.sheetsRequest('POST',
      `/${window.spreadsheetId}:batchUpdate`,
      { requests: [{ addSheet: { properties: { title: SAVINGS_TAB_NAME } } }] });
    savingsGid = res.replies[0].addSheet.properties.sheetId;
    localStorage.setItem('savingsSheetGid', savingsGid);
    await window.sheetsRequest('POST',
      `/${window.spreadsheetId}/values/${SAVINGS_TAB_NAME}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { values: [SAVINGS_HEADERS] });
  }
  return true;
}

async function syncSavingsToSheet() {
  if (!window.spreadsheetId || !window.accessToken) return;
  if (typeof window.sheetsRequest !== 'function') return;
  if (!savingsState) loadSavingsState();

  await ensureSavingsTab();

  const now = new Date().toISOString();
  const rows = savingsState.entries.map(e => [
    e.id,
    e.date,
    e.type,
    e.amount,
    e.note || '',
    e.createdAt || now,
    now,  // UpdatedAt is bumped on every full sync
  ]);

  if (rows.length > 0) {
    // Overwrite the data range (row 2 onwards)
    await window.sheetsRequest('PUT',
      `/${window.spreadsheetId}/values/${SAVINGS_TAB_NAME}!A2:G${rows.length + 1}?valueInputOption=RAW`,
      { values: rows });
    // Clear any leftover rows below (in case entries were deleted)
    const clearStart = rows.length + 2;
    await window.sheetsRequest('POST',
      `/${window.spreadsheetId}/values/${SAVINGS_TAB_NAME}!A${clearStart}:G${clearStart + 200}:clear`,
      null);
  } else {
    // No entries: clear the body wholesale so a deleted-only state syncs cleanly.
    await window.sheetsRequest('POST',
      `/${window.spreadsheetId}/values/${SAVINGS_TAB_NAME}!A2:G500:clear`, null);
  }
}

/** Pull all savings rows from the sheet into local state.
 *  Called on sign-in (after loadExpenses) and on manual refresh.
 *  Sheet wins on conflict — local data is overwritten by remote. */
async function loadSavingsFromSheet() {
  if (!window.spreadsheetId || !window.accessToken) return false;
  if (typeof window.sheetsRequest !== 'function') return false;

  // Ensure tab + headers exist before reading
  await ensureSavingsTab();

  const data = await window.sheetsRequest('GET',
    `/${window.spreadsheetId}/values/${SAVINGS_TAB_NAME}!A:G`);
  const rows = data.values || [];
  if (rows.length < 2) {
    // Nothing in the sheet — keep whatever localStorage has (may be empty too).
    if (!savingsState) loadSavingsState();
    return true;
  }

  const entries = rows.slice(1)
    .map(r => ({
      id:        r[0] || ('s_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)),
      date:      r[1] || todaysISODate(),
      type:      (r[2] === 'debit') ? 'debit' : 'credit',
      amount:    parseFloat(r[3]) || 0,
      note:      r[4] || '',
      createdAt: r[5] || '',
    }))
    .filter(e => e.amount > 0);

  savingsState = { entries };
  try {
    localStorage.setItem(SAVINGS_STORAGE_KEY, JSON.stringify(savingsState));
  } catch (e) { /* no-op */ }
  return true;
}

/* ═══════════════════════════════════════════════════════════════════
   PURE HELPERS
   ═══════════════════════════════════════════════════════════════════ */
function savingsBalance() {
  if (!savingsState) loadSavingsState();
  return savingsState.entries.reduce((acc, e) => {
    return e.type === 'credit' ? acc + e.amount : acc - e.amount;
  }, 0);
}

function savingsTotalsByType() {
  if (!savingsState) loadSavingsState();
  let credit = 0, debit = 0;
  for (const e of savingsState.entries) {
    if (e.type === 'credit') credit += e.amount;
    else                     debit  += e.amount;
  }
  return { credit, debit };
}

function fmtSavINR(n) {
  // Reuse the global formatter if present; else fall back.
  if (typeof window.fmtINR === 'function') return window.fmtINR(n);
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

function fmtSavINRShort(n) {
  if (typeof window.fmtINRShort === 'function') return window.fmtINRShort(n);
  return fmtSavINR(n);
}

function fmtSavDate(iso) {
  // YYYY-MM-DD → "12 Mar 2026"
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function todaysISODate() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function newSavingsId() {
  return 's_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

/* ═══════════════════════════════════════════════════════════════════
   RENDER
   ═══════════════════════════════════════════════════════════════════ */
function renderSavings() {
  if (!savingsState) loadSavingsState();
  renderSavingsHero();
  renderSavingsList();
}

function renderSavingsHero() {
  const el = document.getElementById('savings-hero');
  if (!el) return;
  const bal = savingsBalance();
  const { credit, debit } = savingsTotalsByType();
  const trendCls = bal < 0 ? 'savings-hero-amount neg' : 'savings-hero-amount';

  el.innerHTML = `
    <div class="savings-hero-label">CURRENT BALANCE</div>
    <div class="${trendCls}">${fmtSavINR(bal)}</div>
    <div class="savings-hero-meta">
      <span class="savings-hero-chip credit"><span class="savings-hero-chip-dot"></span> Credited ${fmtSavINRShort(credit)}</span>
      <span class="savings-hero-chip debit"><span class="savings-hero-chip-dot"></span> Debited ${fmtSavINRShort(debit)}</span>
    </div>
  `;
}

function renderSavingsList() {
  const el = document.getElementById('savings-list');
  if (!el) return;

  if (!savingsState.entries.length) {
    el.innerHTML = `
      <div class="savings-empty">
        <div class="savings-empty-icon">💰</div>
        <div class="savings-empty-title">No savings entries yet</div>
        <div class="savings-empty-sub">Tap <strong>+ Add Entry</strong> below to log your first deposit or withdrawal.</div>
      </div>
    `;
    return;
  }

  // Sort by date desc, then by id desc (newest entry of same date on top)
  const sorted = savingsState.entries.slice().sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });

  let html = '<div class="savings-entries">';
  for (const e of sorted) {
    const isCredit = e.type === 'credit';
    const sign  = isCredit ? '+' : '−';
    const cls   = isCredit ? 'savings-entry credit' : 'savings-entry debit';
    const icon  = isCredit ? '↗' : '↙';
    const label = isCredit ? 'Credit' : 'Debit';
    const note  = e.note ? escapeHTMLSav(e.note) : '<em class="savings-entry-empty-note">no note</em>';

    html += `
      <div class="${cls}" onclick="openSavingsEditModal('${e.id}')">
        <div class="savings-entry-side">
          <span class="savings-entry-icon">${icon}</span>
          <div class="savings-entry-meta">
            <div class="savings-entry-row1">
              <span class="savings-entry-type">${label}</span>
              <span class="savings-entry-date">${fmtSavDate(e.date)}</span>
            </div>
            <div class="savings-entry-note">${note}</div>
          </div>
        </div>
        <div class="savings-entry-amount">${sign}${fmtSavINR(e.amount)}</div>
      </div>
    `;
  }
  html += '</div>';
  el.innerHTML = html;
}

function escapeHTMLSav(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* ═══════════════════════════════════════════════════════════════════
   ADD / EDIT MODAL
   ═══════════════════════════════════════════════════════════════════ */
function openSavingsAddModal() {
  if (!savingsState) loadSavingsState();
  savingsEditingId   = null;
  savingsEntryType   = 'credit';
  populateSavingsForm(null);
  document.getElementById('savings-form-modal').style.display = 'flex';
  document.getElementById('savings-form-delete').style.display = 'none';
  document.getElementById('savings-form-title').textContent    = 'Add Savings Entry';
  // Defer focus so transition can settle
  setTimeout(() => {
    const amt = document.getElementById('savings-form-amount');
    if (amt) amt.focus();
  }, 80);
}

function openSavingsEditModal(id) {
  if (!savingsState) loadSavingsState();
  const e = savingsState.entries.find(x => x.id === id);
  if (!e) return;
  savingsEditingId   = id;
  savingsEntryType   = e.type;
  populateSavingsForm(e);
  document.getElementById('savings-form-modal').style.display = 'flex';
  document.getElementById('savings-form-delete').style.display = 'inline-flex';
  document.getElementById('savings-form-title').textContent    = 'Edit Savings Entry';
}

function closeSavingsFormModal() {
  document.getElementById('savings-form-modal').style.display = 'none';
  savingsEditingId = null;
}

function populateSavingsForm(entry) {
  document.getElementById('savings-form-amount').value = entry ? entry.amount : '';
  document.getElementById('savings-form-note').value   = entry ? (entry.note || '') : '';
  document.getElementById('savings-form-date').value   = entry ? entry.date : todaysISODate();
  setSavingsFormType(entry ? entry.type : 'credit');
}

function setSavingsFormType(type) {
  savingsEntryType = (type === 'debit') ? 'debit' : 'credit';
  const cBtn = document.getElementById('savings-type-credit');
  const dBtn = document.getElementById('savings-type-debit');
  if (cBtn && dBtn) {
    cBtn.classList.toggle('active', savingsEntryType === 'credit');
    dBtn.classList.toggle('active', savingsEntryType === 'debit');
  }
}

function saveSavingsForm() {
  const amt  = parseFloat(document.getElementById('savings-form-amount').value);
  const note = (document.getElementById('savings-form-note').value || '').trim();
  const date = document.getElementById('savings-form-date').value || todaysISODate();

  if (!Number.isFinite(amt) || amt <= 0) {
    if (typeof window.showToast === 'function') window.showToast('Enter a valid amount');
    else alert('Enter a valid amount');
    return;
  }

  if (savingsEditingId) {
    const e = savingsState.entries.find(x => x.id === savingsEditingId);
    if (!e) return;
    e.amount = amt;
    e.note   = note;
    e.date   = date;
    e.type   = savingsEntryType;
  } else {
    savingsState.entries.push({
      id:     newSavingsId(),
      date,
      type:   savingsEntryType,
      amount: amt,
      note,
    });
  }

  saveSavingsState();
  closeSavingsFormModal();
  renderSavings();

  if (typeof window.showToast === 'function') {
    window.showToast(savingsEditingId ? 'Entry updated' : 'Entry added');
  }
  savingsEditingId = null;
}

function deleteSavingsForm() {
  if (!savingsEditingId) return;
  const idx = savingsState.entries.findIndex(x => x.id === savingsEditingId);
  if (idx === -1) return;
  if (!confirm('Delete this savings entry?')) return;
  savingsState.entries.splice(idx, 1);
  saveSavingsState();
  closeSavingsFormModal();
  renderSavings();
  if (typeof window.showToast === 'function') window.showToast('Entry deleted');
}

/* ═══════════════════════════════════════════════════════════════════
   PUBLIC API (read-only access for other modules — never write)
   ═══════════════════════════════════════════════════════════════════ */
window.loadSavingsState      = loadSavingsState;
window.loadSavingsFromSheet  = loadSavingsFromSheet;   // v28.3 sheet pull
window.syncSavingsToSheet    = syncSavingsToSheet;     // v28.3 sheet push
window.renderSavings         = renderSavings;
window.savingsBalance        = savingsBalance;         // read-only: loans closure can use this
window.openSavingsAddModal   = openSavingsAddModal;
window.openSavingsEditModal  = openSavingsEditModal;
window.closeSavingsFormModal = closeSavingsFormModal;
window.saveSavingsForm       = saveSavingsForm;
window.deleteSavingsForm     = deleteSavingsForm;
window.setSavingsFormType    = setSavingsFormType;

/* Auto-bootstrap (same pattern as loans.js) */
loadSavingsState();
