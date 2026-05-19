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

/* ─── State ──────────────────────────────────────────────────────── */
var savingsState   = null;
var savingsEditingId = null;
var savingsEntryType = 'credit';  // form-side selection

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
window.loadSavingsState     = loadSavingsState;
window.renderSavings        = renderSavings;
window.savingsBalance       = savingsBalance;        // read-only: loans closure can use this
window.openSavingsAddModal  = openSavingsAddModal;
window.openSavingsEditModal = openSavingsEditModal;
window.closeSavingsFormModal = closeSavingsFormModal;
window.saveSavingsForm      = saveSavingsForm;
window.deleteSavingsForm    = deleteSavingsForm;
window.setSavingsFormType   = setSavingsFormType;

/* Auto-bootstrap (same pattern as loans.js) */
loadSavingsState();
