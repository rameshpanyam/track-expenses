/* ═══════════════════════════════════════════════════════════════════
   SAVINGS MODULE — v29.0
   Multi-category savings: each "pot" is a named bucket with its own
   credit/debit ledger.

   Data model:
     {
       pots:    [ { id, name, createdAt } ],
       entries: [ { id, date, type:'credit'|'debit', amount, note, potId } ]
     }
   • potId = null / undefined → "Unassigned" entries.
   • Migration: existing data (no pots key) → pots=[], entries unchanged.
   • Balance = Σ credits − Σ debits (per pot, or across all entries).

   Google Sheets:
     "Savings" tab     — 9 cols: ID|Date|Type|Amount|Note|CreatedAt|UpdatedAt|PotId|PotName
     "SavingsPots" tab — 3 cols: ID|Name|CreatedAt

   Storage key unchanged: localStorage['expense-tracker.savings.v1']
   ═══════════════════════════════════════════════════════════════════ */

'use strict';

const SAVINGS_STORAGE_KEY = 'expense-tracker.savings.v1';

/* ─── Sheet sync constants ───────────────────────────────────────── */
const SAVINGS_TAB_NAME      = 'Savings';
const SAVINGS_POTS_TAB_NAME = 'SavingsPots';
const SAVINGS_HEADERS       = ['ID','Date','Type','Amount','Note','CreatedAt','UpdatedAt','PotId','PotName'];
const SAVINGS_POTS_HEADERS  = ['ID','Name','CreatedAt'];

/* ─── State ──────────────────────────────────────────────────────── */
var savingsState        = null;   // { pots: [], entries: [] }
var savingsEditingId    = null;   // entry being edited
var savingsEntryType    = 'credit';
var savingsActivePotId  = null;   // null = "All" view
var savingsEditingPotId = null;   // pot being renamed/deleted
var savingsGid          = Number(localStorage.getItem('savingsSheetGid') ?? -1);
var savingsPotsGid      = Number(localStorage.getItem('savingsPotsSheetGid') ?? -1);

/* ═══════════════════════════════════════════════════════════════════
   STORAGE + MIGRATION
   ═══════════════════════════════════════════════════════════════════ */
function loadSavingsState() {
  try {
    const raw = localStorage.getItem(SAVINGS_STORAGE_KEY);
    savingsState = raw ? JSON.parse(raw) : { pots: [], entries: [] };
    if (!savingsState.entries) savingsState.entries = [];
    // v29.0 one-liner migration: existing installs have no pots key.
    if (!savingsState.pots) savingsState.pots = [];
  } catch (e) {
    console.warn('loadSavingsState error', e);
    savingsState = { pots: [], entries: [] };
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
   GOOGLE SHEETS SYNC
   ═══════════════════════════════════════════════════════════════════ */
async function ensureSavingsTab() {
  if (!window.spreadsheetId || !window.accessToken) return false;
  if (typeof window.sheetsRequest !== 'function') return false;

  const meta = typeof window.getCachedSheetMeta === 'function'
    ? await window.getCachedSheetMeta()
    : await window.sheetsRequest('GET', `/${window.spreadsheetId}?fields=sheets.properties`);
  const tab = meta.sheets.find(s => s.properties.title === SAVINGS_TAB_NAME);

  if (tab) {
    savingsGid = tab.properties.sheetId;
    localStorage.setItem('savingsSheetGid', savingsGid);
    // Overwrite header row when column count is wrong (v28→v29 upgrade: 7→9 cols)
    const hdr = await window.sheetsRequest('GET',
      `/${window.spreadsheetId}/values/${SAVINGS_TAB_NAME}!A1:I1`);
    const existing = (hdr.values && hdr.values[0]) || [];
    if (existing.length !== SAVINGS_HEADERS.length) {
      await window.sheetsRequest('PUT',
        `/${window.spreadsheetId}/values/${SAVINGS_TAB_NAME}!A1:I1?valueInputOption=RAW`,
        { values: [SAVINGS_HEADERS] });
    }
  } else {
    const res = await window.sheetsRequest('POST',
      `/${window.spreadsheetId}:batchUpdate`,
      { requests: [{ addSheet: { properties: { title: SAVINGS_TAB_NAME } } }] });
    savingsGid = res.replies[0].addSheet.properties.sheetId;
    localStorage.setItem('savingsSheetGid', savingsGid);
    await window.sheetsRequest('PUT',
      `/${window.spreadsheetId}/values/${SAVINGS_TAB_NAME}!A1:I1?valueInputOption=RAW`,
      { values: [SAVINGS_HEADERS] });
    window.invalidateSheetMetaCache?.();
  }
  return true;
}

async function ensureSavingsPotsTab() {
  if (!window.spreadsheetId || !window.accessToken) return false;
  if (typeof window.sheetsRequest !== 'function') return false;

  const meta = typeof window.getCachedSheetMeta === 'function'
    ? await window.getCachedSheetMeta()
    : await window.sheetsRequest('GET', `/${window.spreadsheetId}?fields=sheets.properties`);
  const tab = meta.sheets.find(s => s.properties.title === SAVINGS_POTS_TAB_NAME);

  if (tab) {
    savingsPotsGid = tab.properties.sheetId;
    localStorage.setItem('savingsPotsSheetGid', savingsPotsGid);
    const hdr = await window.sheetsRequest('GET',
      `/${window.spreadsheetId}/values/${SAVINGS_POTS_TAB_NAME}!A1:C1`);
    const existing = (hdr.values && hdr.values[0]) || [];
    if (existing.length !== SAVINGS_POTS_HEADERS.length) {
      await window.sheetsRequest('PUT',
        `/${window.spreadsheetId}/values/${SAVINGS_POTS_TAB_NAME}!A1:C1?valueInputOption=RAW`,
        { values: [SAVINGS_POTS_HEADERS] });
    }
  } else {
    const res = await window.sheetsRequest('POST',
      `/${window.spreadsheetId}:batchUpdate`,
      { requests: [{ addSheet: { properties: { title: SAVINGS_POTS_TAB_NAME } } }] });
    savingsPotsGid = res.replies[0].addSheet.properties.sheetId;
    localStorage.setItem('savingsPotsSheetGid', savingsPotsGid);
    await window.sheetsRequest('PUT',
      `/${window.spreadsheetId}/values/${SAVINGS_POTS_TAB_NAME}!A1:C1?valueInputOption=RAW`,
      { values: [SAVINGS_POTS_HEADERS] });
    window.invalidateSheetMetaCache?.();
  }
  return true;
}

async function syncSavingsToSheet() {
  if (!window.spreadsheetId || !window.accessToken) return;
  if (typeof window.sheetsRequest !== 'function') return;
  if (!savingsState) loadSavingsState();

  await Promise.all([ensureSavingsTab(), ensureSavingsPotsTab()]);

  const now = new Date().toISOString();

  // ── Entries (9 columns) ──────────────────────────────────────────
  const rows = savingsState.entries.map(e => {
    const pot = e.potId ? savingsState.pots.find(p => p.id === e.potId) : null;
    return [
      e.id,
      e.date,
      e.type,
      e.amount,
      e.note || '',
      e.createdAt || now,
      now,
      e.potId  || '',
      pot ? pot.name : '',
    ];
  });

  if (rows.length > 0) {
    await window.sheetsRequest('PUT',
      `/${window.spreadsheetId}/values/${SAVINGS_TAB_NAME}!A2:I${rows.length + 1}?valueInputOption=RAW`,
      { values: rows });
    const clearStart = rows.length + 2;
    await window.sheetsRequest('POST',
      `/${window.spreadsheetId}/values/${SAVINGS_TAB_NAME}!A${clearStart}:I${clearStart + 200}:clear`, null);
  } else {
    await window.sheetsRequest('POST',
      `/${window.spreadsheetId}/values/${SAVINGS_TAB_NAME}!A2:I500:clear`, null);
  }

  // ── Pots (3 columns) ─────────────────────────────────────────────
  const potRows = savingsState.pots.map(p => [p.id, p.name, p.createdAt || now]);
  if (potRows.length > 0) {
    await window.sheetsRequest('PUT',
      `/${window.spreadsheetId}/values/${SAVINGS_POTS_TAB_NAME}!A2:C${potRows.length + 1}?valueInputOption=RAW`,
      { values: potRows });
    const clearStart = potRows.length + 2;
    await window.sheetsRequest('POST',
      `/${window.spreadsheetId}/values/${SAVINGS_POTS_TAB_NAME}!A${clearStart}:C${clearStart + 50}:clear`, null);
  } else {
    await window.sheetsRequest('POST',
      `/${window.spreadsheetId}/values/${SAVINGS_POTS_TAB_NAME}!A2:C100:clear`, null);
  }
}

/** Pull from sheet into local state. Called on sign-in. Sheet wins. */
async function loadSavingsFromSheet() {
  if (!window.spreadsheetId || !window.accessToken) return false;
  if (typeof window.sheetsRequest !== 'function') return false;

  await Promise.all([ensureSavingsTab(), ensureSavingsPotsTab()]);

  // ── Pots ─────────────────────────────────────────────────────────
  const potsData = await window.sheetsRequest('GET',
    `/${window.spreadsheetId}/values/${SAVINGS_POTS_TAB_NAME}!A:C`);
  const pots = ((potsData.values || []).slice(1))
    .filter(r => r[0] && r[1])
    .map(r => ({ id: r[0], name: r[1], createdAt: r[2] || '' }));

  // ── Entries (9 cols now, r[7]=PotId) ─────────────────────────────
  const data = await window.sheetsRequest('GET',
    `/${window.spreadsheetId}/values/${SAVINGS_TAB_NAME}!A:I`);
  const entries = ((data.values || []).slice(1))
    .map(r => ({
      id:        r[0] || ('s_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)),
      date:      r[1] || todaysISODate(),
      type:      (r[2] === 'debit') ? 'debit' : 'credit',
      amount:    parseFloat(r[3]) || 0,
      note:      r[4] || '',
      createdAt: r[5] || '',
      potId:     r[7] || null,
    }))
    .filter(e => e.amount > 0);

  savingsState = { pots, entries };
  try {
    localStorage.setItem(SAVINGS_STORAGE_KEY, JSON.stringify(savingsState));
  } catch (e) { /* no-op */ }
  return true;
}

/* ═══════════════════════════════════════════════════════════════════
   POT HELPERS
   ═══════════════════════════════════════════════════════════════════ */
function savingsPotById(id) {
  if (!savingsState || !id) return null;
  return savingsState.pots.find(p => p.id === id) || null;
}

/** Returns entries for the given potId, or ALL entries when potId is null. */
function savingsEntriesForPot(potId) {
  if (!savingsState) return [];
  if (potId === null || potId === undefined) return savingsState.entries;
  return savingsState.entries.filter(e => e.potId === potId);
}

function savingsBalanceForPot(potId) {
  return savingsEntriesForPot(potId).reduce(
    (acc, e) => e.type === 'credit' ? acc + e.amount : acc - e.amount, 0);
}

function savingsTotalsForPot(potId) {
  let credit = 0, debit = 0;
  for (const e of savingsEntriesForPot(potId)) {
    if (e.type === 'credit') credit += e.amount; else debit += e.amount;
  }
  return { credit, debit };
}

function newPotId() {
  return 'pot_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

/* ═══════════════════════════════════════════════════════════════════
   PURE HELPERS (backward-compatible public API)
   ═══════════════════════════════════════════════════════════════════ */
function savingsBalance() {
  if (!savingsState) loadSavingsState();
  return savingsBalanceForPot(null); // null = total across all entries
}

function savingsTotalsByType() {
  if (!savingsState) loadSavingsState();
  return savingsTotalsForPot(null);
}

function fmtSavINR(n) {
  if (typeof window.fmtINR === 'function') return window.fmtINR(n);
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

function fmtSavINRShort(n) {
  if (typeof window.fmtINRShort === 'function') return window.fmtINRShort(n);
  return fmtSavINR(n);
}

function fmtSavDate(iso) {
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

function escapeHTMLSav(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ═══════════════════════════════════════════════════════════════════
   RENDER
   ═══════════════════════════════════════════════════════════════════ */
function renderSavings() {
  if (!savingsState) loadSavingsState();
  renderSavingsHero();
  renderSavingsPotBar();
  renderSavingsList();
}

function renderSavingsHero() {
  const el = document.getElementById('savings-hero');
  if (!el) return;
  const activePot = savingsActivePotId ? savingsPotById(savingsActivePotId) : null;
  const bal = savingsBalanceForPot(savingsActivePotId);
  const { credit, debit } = savingsTotalsForPot(savingsActivePotId);
  const label = activePot ? activePot.name.toUpperCase() : 'TOTAL SAVINGS';
  el.innerHTML = `
    <div class="savings-hero-label">${escapeHTMLSav(label)}</div>
    <div class="${bal < 0 ? 'savings-hero-amount neg' : 'savings-hero-amount'}">${fmtSavINR(bal)}</div>
    <div class="savings-hero-meta">
      <span class="savings-hero-chip credit"><span class="savings-hero-chip-dot"></span> Credited ${fmtSavINRShort(credit)}</span>
      <span class="savings-hero-chip debit"><span class="savings-hero-chip-dot"></span> Debited ${fmtSavINRShort(debit)}</span>
    </div>
  `;
}

function renderSavingsPotBar() {
  const el = document.getElementById('savings-pot-bar');
  if (!el || !savingsState) return;

  let html = `<button class="savings-pot-chip${savingsActivePotId === null ? ' active' : ''}" onclick="setSavingsActivePot(null)">All</button>`;

  for (const pot of savingsState.pots) {
    const isActive = savingsActivePotId === pot.id;
    const bal = savingsBalanceForPot(pot.id);
    html += `
      <button class="savings-pot-chip${isActive ? ' active' : ''}" onclick="setSavingsActivePot('${pot.id}')">
        <span class="savings-pot-chip-name">${escapeHTMLSav(pot.name)}</span>
        <span class="savings-pot-chip-bal">${fmtSavINRShort(bal)}</span>
        <span class="savings-pot-edit-btn" onclick="event.stopPropagation();openSavingsPotEditModal('${pot.id}')">✎</span>
      </button>`;
  }

  html += `<button class="savings-pot-chip savings-pot-new-chip" onclick="openSavingsPotAddModal()">+ New</button>`;
  el.innerHTML = html;
}

function setSavingsActivePot(potId) {
  savingsActivePotId = potId || null;
  renderSavings();
}

function renderSavingsList() {
  const el = document.getElementById('savings-list');
  if (!el || !savingsState) return;

  const entries = savingsEntriesForPot(savingsActivePotId);
  const isAllView = savingsActivePotId === null;
  const activePot = !isAllView ? savingsPotById(savingsActivePotId) : null;

  // Update section label
  const labelEl = document.getElementById('savings-section-label-dynamic');
  if (labelEl) {
    labelEl.textContent = activePot ? `${activePot.name} activity` : 'Recent activity';
  }

  if (!entries.length) {
    el.innerHTML = `
      <div class="savings-empty">
        <div class="savings-empty-icon">💰</div>
        <div class="savings-empty-title">${activePot ? 'No entries in ' + escapeHTMLSav(activePot.name) : 'No savings entries yet'}</div>
        <div class="savings-empty-sub">Tap <strong>+ Add Entry</strong> below to log your first deposit or withdrawal${activePot ? ' for ' + escapeHTMLSav(activePot.name) : ''}.</div>
      </div>`;
    return;
  }

  const sorted = entries.slice().sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });

  let html = '<div class="savings-entries">';
  for (const e of sorted) {
    const isCredit = e.type === 'credit';
    const note   = e.note ? escapeHTMLSav(e.note) : '<em class="savings-entry-empty-note">no note</em>';
    const pot    = e.potId ? savingsPotById(e.potId) : null;
    const badge  = isAllView
      ? (pot
          ? `<span class="savings-entry-pot-badge">${escapeHTMLSav(pot.name)}</span>`
          : `<span class="savings-entry-pot-badge unassigned">Unassigned</span>`)
      : '';

    html += `
      <div class="${isCredit ? 'savings-entry credit' : 'savings-entry debit'}" onclick="openSavingsEditModal('${e.id}')">
        <div class="savings-entry-side">
          <span class="savings-entry-icon">${isCredit ? '↗' : '↙'}</span>
          <div class="savings-entry-meta">
            <div class="savings-entry-row1">
              <span class="savings-entry-type">${isCredit ? 'Credit' : 'Debit'}</span>
              <span class="savings-entry-date">${fmtSavDate(e.date)}</span>
            </div>
            <div class="savings-entry-note">${note}</div>
            ${isAllView ? `<div class="savings-entry-row3">${badge}</div>` : ''}
          </div>
        </div>
        <div class="savings-entry-amount">${isCredit ? '+' : '−'}${fmtSavINR(e.amount)}</div>
      </div>`;
  }
  html += '</div>';
  el.innerHTML = html;
}

/* ═══════════════════════════════════════════════════════════════════
   POT MODAL (create / rename / delete)
   ═══════════════════════════════════════════════════════════════════ */
function openSavingsPotAddModal() {
  savingsEditingPotId = null;
  const modal  = document.getElementById('savings-pot-modal');
  const title  = document.getElementById('savings-pot-modal-title');
  const input  = document.getElementById('savings-pot-name-input');
  const delBtn = document.getElementById('savings-pot-delete-btn');
  if (!modal) return;
  title.textContent    = 'New Category';
  input.value          = '';
  delBtn.style.display = 'none';
  modal.style.display  = 'flex';
  setTimeout(() => input.focus(), 80);
}

function openSavingsPotEditModal(potId) {
  const pot = savingsPotById(potId);
  if (!pot) return;
  savingsEditingPotId  = potId;
  const modal  = document.getElementById('savings-pot-modal');
  const title  = document.getElementById('savings-pot-modal-title');
  const input  = document.getElementById('savings-pot-name-input');
  const delBtn = document.getElementById('savings-pot-delete-btn');
  if (!modal) return;
  title.textContent    = 'Edit Category';
  input.value          = pot.name;
  delBtn.style.display = 'inline-flex';
  modal.style.display  = 'flex';
  setTimeout(() => input.focus(), 80);
}

function closeSavingsPotModal() {
  const modal = document.getElementById('savings-pot-modal');
  if (modal) modal.style.display = 'none';
  savingsEditingPotId = null;
}

function saveSavingsPot() {
  const input = document.getElementById('savings-pot-name-input');
  const name  = (input ? input.value : '').trim();

  if (!name) {
    if (typeof window.showToast === 'function') window.showToast('Enter a category name');
    return;
  }
  // Case-insensitive duplicate check (excludes self when renaming)
  const isDuplicate = savingsState.pots.some(p =>
    p.name.toLowerCase() === name.toLowerCase() && p.id !== savingsEditingPotId);
  if (isDuplicate) {
    if (typeof window.showToast === 'function') window.showToast('Category already exists');
    return;
  }

  if (savingsEditingPotId) {
    const pot = savingsPotById(savingsEditingPotId);
    if (pot) pot.name = name;
    if (typeof window.showToast === 'function') window.showToast('Category renamed');
  } else {
    savingsState.pots.push({ id: newPotId(), name, createdAt: new Date().toISOString() });
    if (typeof window.showToast === 'function') window.showToast('Category created');
  }

  saveSavingsState();
  closeSavingsPotModal();
  renderSavings();
}

function deleteSavingsPot() {
  if (!savingsEditingPotId) return;
  const pot = savingsPotById(savingsEditingPotId);
  if (!pot) return;
  if (!confirm(`Delete "${pot.name}"? Entries will move to Unassigned.`)) return;

  // Orphan entries — never cascade-delete
  for (const e of savingsState.entries) {
    if (e.potId === savingsEditingPotId) e.potId = null;
  }
  savingsState.pots = savingsState.pots.filter(p => p.id !== savingsEditingPotId);
  if (savingsActivePotId === savingsEditingPotId) savingsActivePotId = null;

  saveSavingsState();
  closeSavingsPotModal();
  renderSavings();
  if (typeof window.showToast === 'function') window.showToast('Category deleted');
}

/* ═══════════════════════════════════════════════════════════════════
   ENTRY FORM MODAL (add / edit)
   ═══════════════════════════════════════════════════════════════════ */
function openSavingsAddModal() {
  if (!savingsState) loadSavingsState();
  savingsEditingId  = null;
  savingsEntryType  = 'credit';
  populateSavingsForm(null);
  document.getElementById('savings-form-modal').style.display = 'flex';
  document.getElementById('savings-form-delete').style.display = 'none';
  document.getElementById('savings-form-title').textContent    = 'Add Savings Entry';
  setTimeout(() => {
    const amt = document.getElementById('savings-form-amount');
    if (amt) amt.focus();
  }, 80);
}

function openSavingsEditModal(id) {
  if (!savingsState) loadSavingsState();
  const e = savingsState.entries.find(x => x.id === id);
  if (!e) return;
  savingsEditingId  = id;
  savingsEntryType  = e.type;
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
  // Pre-select active pot when adding, or entry's pot when editing
  const preselect = entry ? (entry.potId || '') : (savingsActivePotId || '');
  populateSavingsPotSelect(preselect);
}

function populateSavingsPotSelect(selectedPotId) {
  const sel = document.getElementById('savings-form-pot');
  if (!sel || !savingsState) return;
  sel.innerHTML =
    `<option value="">— Unassigned —</option>` +
    savingsState.pots.map(p =>
      `<option value="${p.id}"${p.id === selectedPotId ? ' selected' : ''}>${escapeHTMLSav(p.name)}</option>`
    ).join('');
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
  const amt    = parseFloat(document.getElementById('savings-form-amount').value);
  const note   = (document.getElementById('savings-form-note').value || '').trim();
  const date   = document.getElementById('savings-form-date').value || todaysISODate();
  const potSel = document.getElementById('savings-form-pot');
  const potId  = potSel ? (potSel.value || null) : null;

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
    e.potId  = potId;
  } else {
    savingsState.entries.push({
      id:        newSavingsId(),
      date,
      type:      savingsEntryType,
      amount:    amt,
      note,
      potId,
      createdAt: new Date().toISOString(),
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
window.loadSavingsFromSheet  = loadSavingsFromSheet;
window.syncSavingsToSheet    = syncSavingsToSheet;
window.renderSavings         = renderSavings;
window.savingsBalance        = savingsBalance;         // total across all pots
window.openSavingsAddModal   = openSavingsAddModal;
window.openSavingsEditModal  = openSavingsEditModal;
window.closeSavingsFormModal = closeSavingsFormModal;
window.saveSavingsForm       = saveSavingsForm;
window.deleteSavingsForm     = deleteSavingsForm;
window.setSavingsFormType    = setSavingsFormType;
// v29.0 — pot management
window.setSavingsActivePot     = setSavingsActivePot;
window.openSavingsPotAddModal  = openSavingsPotAddModal;
window.openSavingsPotEditModal = openSavingsPotEditModal;
window.closeSavingsPotModal    = closeSavingsPotModal;
window.saveSavingsPot          = saveSavingsPot;
window.deleteSavingsPot        = deleteSavingsPot;

/* Auto-bootstrap (same pattern as loans.js) */
loadSavingsState();
