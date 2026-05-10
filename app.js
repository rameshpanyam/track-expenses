/* ── Database (Dexie / IndexedDB) ─────────────────────────── */
const db = new Dexie('ExpenseTracker');
db.version(1).stores({
  expenses: '++id, date, category, amount, note, createdAt'
});

/* ── Categories ───────────────────────────────────────────── */
const CATEGORIES = [
  { key: 'food',      icon: '🍽️',  label: 'Food' },
  { key: 'grocery',  icon: '🛒',  label: 'Grocery' },
  { key: 'market',   icon: '🥦',  label: 'Market' },
  { key: 'medicine', icon: '💊',  label: 'Medicine' },
  { key: 'petrol',   icon: '⛽',  label: 'Petrol' },
  { key: 'recharge', icon: '📱',  label: 'Recharge' },
  { key: 'water',    icon: '💧',  label: 'Water' },
  { key: 'gifts',    icon: '🎁',  label: 'Gifts' },
  { key: 'other',    icon: '📦',  label: 'Other' },
];
const CAT_MAP = Object.fromEntries(CATEGORIES.map(c => [c.key, c]));

/* ── State ────────────────────────────────────────────────── */
let currentView    = 'add';          // 'add' | 'summary' | 'history'
let selectedCat    = null;
let viewMonth      = new Date();     // summary/history month context
viewMonth.setDate(1);

/* ── Helpers ──────────────────────────────────────────────── */
function fmt(amount) {
  return '₹' + Number(amount).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}
function fmtDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(d)} ${months[parseInt(m) - 1]}`;
}
function todayStr() {
  // Use LOCAL date (not UTC) so midnight-to-5am IST shows the correct calendar date
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function monthLabel(date) {
  return date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}
function monthRange(date) {
  const y = date.getFullYear(), m = date.getMonth();
  const start = `${y}-${String(m + 1).padStart(2,'0')}-01`;
  const end   = `${y}-${String(m + 1).padStart(2,'0')}-31`;
  return { start, end };
}

/* ── Toast ────────────────────────────────────────────────── */
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

/* ── View router ──────────────────────────────────────────── */
function switchView(view) {
  currentView = view;
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  document.getElementById('nav-' + view).classList.add('active');
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

/* ── Build Add view ───────────────────────────────────────── */
function buildAddView() {
  const grid = document.getElementById('cat-grid');
  grid.innerHTML = CATEGORIES.map(c => `
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
  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.cat === key);
  });
  refreshAddBtn();
}

function refreshAddBtn() {
  const amount = parseFloat(document.getElementById('amount-input').value);
  const btn = document.querySelector('.add-btn');
  const ready = amount > 0 && selectedCat != null;
  btn.disabled = !ready;
  btn.textContent = ready ? `+ Add ₹${Number(amount).toLocaleString('en-IN', {maximumFractionDigits:0})}` : '+ Add Expense';
}

async function renderTodayTotal() {
  const today = todayStr();
  const entries = await db.expenses.where('date').equals(today).toArray();
  const total = entries.reduce((s, e) => s + e.amount, 0);
  const el = document.getElementById('today-total');
  if (!el) return;
  if (total > 0) {
    el.textContent = `Today: ${fmt(total)} across ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`;
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

/* ── Save expense ─────────────────────────────────────────── */
async function saveExpense() {
  const amountEl = document.getElementById('amount-input');
  const noteEl   = document.getElementById('note-input');
  const dateEl   = document.getElementById('date-input');

  const amount = parseFloat(amountEl.value);
  if (!amount || amount <= 0) { amountEl.focus(); return; }
  if (!selectedCat) { showToast('Pick a category'); return; }
  if (!dateEl.value) { dateEl.focus(); return; }

  await db.expenses.add({
    date:      dateEl.value,
    category:  selectedCat,
    amount:    amount,
    note:      noteEl.value.trim(),
    createdAt: Date.now()
  });

  // Reset form
  amountEl.value = '';
  noteEl.value   = '';
  dateEl.value   = todayStr();
  selectedCat    = null;
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('selected'));
  refreshAddBtn();
  renderTodayTotal();

  showToast('Expense added ✓');
}

/* ── Render Summary view ──────────────────────────────────── */
async function renderSummary() {
  const { start, end } = monthRange(viewMonth);
  const expenses = await db.expenses
    .where('date').between(start, end, true, true)
    .toArray();

  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const byCategory = {};
  CATEGORIES.forEach(c => { byCategory[c.key] = 0; });
  expenses.forEach(e => {
    byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
  });

  // Total card
  document.getElementById('summary-total-amount').textContent = fmt(total);
  document.getElementById('summary-total-count').textContent = `${expenses.length} expense${expenses.length !== 1 ? 's' : ''}`;

  // Category breakdown
  const sorted = CATEGORIES
    .map(c => ({ ...c, amount: byCategory[c.key] || 0 }))
    .filter(c => c.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const listEl = document.getElementById('cat-summary-list');
  if (sorted.length === 0) {
    listEl.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>No expenses recorded for ${monthLabel(viewMonth)}.</p></div>`;
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

  // Recent expenses in this month (newest first)
  const recent = [...expenses].sort((a,b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const expListEl = document.getElementById('summary-expense-list');
  if (recent.length === 0) {
    expListEl.innerHTML = '';
  } else {
    expListEl.innerHTML = recent.map(e => {
      const cat = CAT_MAP[e.category] || { icon: '📦', label: e.category };
      return `
        <div class="expense-row" id="exp-${e.id}">
          <span class="expense-cat-icon">${cat.icon}</span>
          <div class="expense-info">
            <div class="expense-cat-name">${cat.label}</div>
            ${e.note ? `<div class="expense-note">${e.note}</div>` : ''}
          </div>
          <div class="expense-right">
            <div class="expense-amount">${fmt(e.amount)}</div>
            <div class="expense-date">${fmtDate(e.date)}</div>
          </div>
          <button class="expense-delete" onclick="deleteExpense(${e.id})" title="Delete">✕</button>
        </div>
      `;
    }).join('');
  }
}

/* ── Render History view ──────────────────────────────────── */
async function renderHistory() {
  const { start, end } = monthRange(viewMonth);
  const allInMonth = await db.expenses
    .where('date').between(start, end, true, true)
    .toArray();

  // Group by date
  const byDate = {};
  allInMonth.forEach(e => {
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  });

  const dates = Object.keys(byDate).sort().reverse();
  const container = document.getElementById('history-list');

  if (dates.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>No expenses for ${monthLabel(viewMonth)}.</p></div>`;
    return;
  }

  container.innerHTML = dates.map(date => {
    const rows = byDate[date].sort((a,b) => b.createdAt - a.createdAt);
    const dayTotal = rows.reduce((s, e) => s + e.amount, 0);
    return `
      <div class="month-group">
        <div class="month-group-header">
          <span>${fmtDate(date)}</span>
          <span class="month-group-total">${fmt(dayTotal)}</span>
        </div>
        <div class="expense-list">
          ${rows.map(e => {
            const cat = CAT_MAP[e.category] || { icon: '📦', label: e.category };
            return `
              <div class="expense-row" id="exp-h-${e.id}">
                <span class="expense-cat-icon">${cat.icon}</span>
                <div class="expense-info">
                  <div class="expense-cat-name">${cat.label}</div>
                  ${e.note ? `<div class="expense-note">${e.note}</div>` : ''}
                </div>
                <div class="expense-right">
                  <div class="expense-amount">${fmt(e.amount)}</div>
                </div>
                <button class="expense-delete" onclick="deleteExpense(${e.id}, true)" title="Delete">✕</button>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');
}

/* ── Delete expense ───────────────────────────────────────── */
async function deleteExpense(id, fromHistory = false) {
  await db.expenses.delete(id);
  // Remove from DOM instantly, then refresh totals
  const elA = document.getElementById('exp-' + id);
  const elB = document.getElementById('exp-h-' + id);
  if (elA) elA.remove();
  if (elB) elB.remove();
  if (currentView === 'summary') renderSummary();
  if (currentView === 'history') renderHistory();
}

/* ── Service Worker registration ──────────────────────────── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Use a relative path so it works on GitHub Pages (e.g. /expense-tracker/sw.js)
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('SW registration failed:', err);
    });
  });
}

/* ── Init ─────────────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  buildAddView();
  switchView('add');

  // Amount input: only allow numbers + decimal, update button state
  document.getElementById('amount-input').addEventListener('input', function() {
    this.value = this.value.replace(/[^0-9.]/g, '');
    refreshAddBtn();
  });

  // Month nav buttons
  document.getElementById('month-prev').addEventListener('click', () => changeMonth(-1));
  document.getElementById('month-next').addEventListener('click', () => changeMonth(1));
});
