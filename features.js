/* ═════════════════════════════════════════════════════════════════════════════
   EXPENSE TRACKER — v25 FEATURE PACK
   Layered on top of app.js. Avoids modifying existing code by wrapping
   selected functions (saveExpense, confirmDelete, renderDashboard,
   enterMainApp, handleVoiceResult, confirmVoiceAdd) once they exist on `window`.

   Features implemented here (numbered to match the PM roadmap):
     F1  Quick-add manifest shortcuts (URL ?quickadd=<cat>)
     F2  Recurring expenses                (Sheet "Recurring" tab)
     F3  Today's Spend Hero card           (Dashboard top)
     F4  Undo toast for deletes            (5-second window)
     F5  Global search bar                 (category / note / amount)
     F6  AI category suggestion            (built-in keywords + history)
     F7  Spending calendar heatmap         (month + 12-month toggle)
     F8  What-if budget simulator          (slider per category)
     F9  Year-in-review wrap               (replayable per year)
     F10 End-of-month forecast strip
     F11 Category trends (3-month sparklines)
     F12 Voice-first auto-save             (auto-save + 5s undo)
     F13 Savings goals                     (auto-credit + manual deposits)
     F14 Export CSV / PDF                  (jsPDF lazy-loaded)

   All features degrade gracefully — if a tab in the Sheet is missing or
   the network is down, the feature shows a "no data" state instead of
   breaking the app.
   ═════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Wait for app.js to finish loading before patching ── */
  function whenReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  /* ═══════════════════════════════════════════════════════════
     STATE
     ═══════════════════════════════════════════════════════════ */
  const RECURRING_TAB_NAME = 'Recurring';
  const RECURRING_HEADERS  = ['Id', 'Label', 'Amount', 'Category', 'DayOfMonth', 'LastRunYYYYMM', 'CreatedAt'];
  const GOALS_TAB_NAME     = 'Goals';
  const GOALS_HEADERS      = ['Id', 'Label', 'Target', 'Saved', 'Deadline', 'CreatedAt', 'LastCreditedYYYYMM'];

  let allRecurring = [];
  let allGoals     = [];
  let recurringGid = Number(localStorage.getItem('recurringSheetGid') ?? -1);
  let goalsGid     = Number(localStorage.getItem('goalsSheetGid') ?? -1);

  /* Undo state */
  let lastDeletedExpense = null;
  let undoTimerId        = null;

  /* AI category-from-note state */
  let aiSuggestedKey   = null;
  let aiSuggestDismissed = false;

  /* What-if state */
  let whatIfCuts = {};   /* { catKey: percentReduction } */

  /* Heatmap state */
  let heatmapMode = 'month'; /* 'month' | 'year' */
  let heatmapMonth = new Date();

  /* Voice quick-save state — when true, voice triggers auto-save + undo */
  let voiceAutoSave = true;

  /* Goal pending deposit */
  let pendingDepositGoalId = null;

  /* Charts created by features.js */
  let sparkCharts   = [];
  let yearwrapCharts = [];

  /* ═══════════════════════════════════════════════════════════
     AI KEYWORD MAP (F6) — broader than the voice expense parser
     ═══════════════════════════════════════════════════════════ */
  const AI_KEYWORDS = {
    food: ['food','lunch','dinner','breakfast','meal','eat','eating','restaurant','hotel','biryani','swiggy','zomato','snack','snacks','chai','tea','coffee','tiffin','starbucks','dominos','pizza','burger','kfc','mcdonald','mcdonalds','subway','dosa','idli','curry','rice','thali','cafe','bakery','sweet','sweets'],
    grocery: ['grocery','groceries','supermarket','kirana','big bazaar','dmart','reliance','zepto','blinkit','instamart','more','spencer','bigbasket','grofers','jiomart'],
    market: ['market','vegetable','vegetables','fruit','fruits','sabzi','mandi','farm','farmer'],
    medicine: ['medicine','medicines','medical','pharmacy','pharmacist','doctor','hospital','tablet','tablets','capsule','drug','health','apollo','wellness','prescription','clinic','dental','dentist'],
    petrol: ['petrol','fuel','diesel','gas','pump','filling','indianoil','iocl','bpcl','hpcl','shell','reliance petrol'],
    recharge: ['recharge','mobile','phone','internet','data','sim','jio','airtel','vi','bsnl','broadband','wifi','wifi bill','postpaid','prepaid'],
    water: ['water','aqua','bisleri','mineral','kinley','rail neer'],
    gifts: ['gift','gifts','present','birthday','anniversary','wedding','flower','flowers','bouquet'],
    other: ['other','misc','miscellaneous'],
  };

  /* Common merchant → category map (most-frequent Indian use cases) */
  const MERCHANT_HINTS = {
    'uber': 'other', 'ola': 'other', 'rapido': 'other',
    'amazon': 'other', 'flipkart': 'other', 'myntra': 'other', 'meesho': 'other',
    'netflix': 'recharge', 'spotify': 'recharge', 'hotstar': 'recharge', 'prime': 'recharge', 'youtube': 'recharge',
  };

  /* ═══════════════════════════════════════════════════════════
     UTILITIES
     ═══════════════════════════════════════════════════════════ */
  function uuid() {
    return 'r' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }
  function yyyymm(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  }
  function inrFmt(n) { return window.fmt ? fmt(n) : ('₹' + Math.round(n).toLocaleString('en-IN')); }
  function dToYMD(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function ymdToD(s) {
    if (!s) return null;
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function safe(s) {
    if (typeof escapeHTML === 'function') return escapeHTML(s);
    return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }
  function hasSheet() { return !!(window.spreadsheetId && window.accessToken); }

  /* ═══════════════════════════════════════════════════════════
     RECURRING EXPENSES DATA LAYER (F2)
     ═══════════════════════════════════════════════════════════ */
  async function ensureRecurringTab() {
    if (!hasSheet()) return false;
    const meta = await sheetsRequest('GET', `/${spreadsheetId}?fields=sheets.properties`);
    const tab  = meta.sheets.find(s => s.properties.title === RECURRING_TAB_NAME);
    if (tab) {
      recurringGid = tab.properties.sheetId;
      localStorage.setItem('recurringSheetGid', recurringGid);
      const data = await sheetsRequest('GET', `/${spreadsheetId}/values/${RECURRING_TAB_NAME}!A1:G1`);
      if (!data.values || data.values.length === 0) {
        await sheetsRequest('POST',
          `/${spreadsheetId}/values/${RECURRING_TAB_NAME}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
          { values: [RECURRING_HEADERS] });
      }
      return true;
    }
    const res = await sheetsRequest('POST', `/${spreadsheetId}:batchUpdate`, {
      requests: [{ addSheet: { properties: { title: RECURRING_TAB_NAME } } }]
    });
    recurringGid = res.replies[0].addSheet.properties.sheetId;
    localStorage.setItem('recurringSheetGid', recurringGid);
    await sheetsRequest('POST',
      `/${spreadsheetId}/values/${RECURRING_TAB_NAME}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { values: [RECURRING_HEADERS] });
    return true;
  }

  async function loadRecurring() {
    if (!hasSheet()) { allRecurring = []; return; }
    try {
      const data = await sheetsRequest('GET', `/${spreadsheetId}/values/${RECURRING_TAB_NAME}!A:G`);
      const rows = data.values || [];
      allRecurring = rows.slice(1)
        .map((r, i) => ({
          rowIndex:  i + 2,
          id:        r[0] || '',
          label:     r[1] || '',
          amount:    parseFloat(r[2]) || 0,
          category:  r[3] || 'other',
          dayOfMonth: parseInt(r[4]) || 1,
          lastRunYYYYMM: r[5] || '',
          createdAt: r[6] || '',
        }))
        .filter(r => r.id && r.label && r.amount > 0);
    } catch (e) {
      allRecurring = [];
    }
  }

  async function appendRecurringRow(r) {
    await ensureRecurringTab();
    await sheetsRequest('POST',
      `/${spreadsheetId}/values/${RECURRING_TAB_NAME}!A:G:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { values: [[r.id, r.label, r.amount, r.category, r.dayOfMonth, r.lastRunYYYYMM || '', new Date().toISOString()]] });
  }

  async function updateRecurringLastRun(id, lastRun) {
    const r = allRecurring.find(x => x.id === id);
    if (!r) return;
    r.lastRunYYYYMM = lastRun;
    await sheetsRequest('PUT',
      `/${spreadsheetId}/values/${RECURRING_TAB_NAME}!A${r.rowIndex}:G${r.rowIndex}?valueInputOption=RAW`,
      { values: [[r.id, r.label, r.amount, r.category, r.dayOfMonth, r.lastRunYYYYMM, r.createdAt]] });
  }

  async function deleteRecurringRow(id) {
    const r = allRecurring.find(x => x.id === id);
    if (!r) return;
    if (recurringGid < 0) await ensureRecurringTab();
    await sheetsRequest('POST', `/${spreadsheetId}:batchUpdate`, {
      requests: [{ deleteDimension: {
        range: { sheetId: recurringGid, dimension: 'ROWS',
                 startIndex: r.rowIndex - 1, endIndex: r.rowIndex }
      }}]
    });
    await loadRecurring();
  }

  /* Auto-create due recurring expenses for the current month.
     Idempotent: each recurring is created at most once per (id, yyyymm). */
  async function applyDueRecurring() {
    if (!hasSheet() || allRecurring.length === 0) return;
    const now = new Date();
    const today = now.getDate();
    const ymStr = yyyymm(now);
    const dateStr = dToYMD(now);
    let createdCount = 0;

    for (const r of allRecurring) {
      /* Only fire if day-of-month has been reached AND we haven't already
         logged this recurring for the current month. */
      if (r.dayOfMonth > today) continue;
      if (r.lastRunYYYYMM === ymStr) continue;

      const exp = {
        date:      dateStr,
        category:  r.category,
        amount:    r.amount,
        note:      `🔁 ${r.label}`,
        createdAt: new Date().toISOString(),
      };
      try {
        await appendExpenseRow(exp);
        await updateRecurringLastRun(r.id, ymStr);
        createdCount++;
      } catch (e) {
        console.warn('Recurring auto-create failed for', r.label, e.message);
      }
    }
    if (createdCount > 0) {
      await loadExpenses();
      const [ey, em] = dateStr.split('-').map(Number);
      try { await recomputeBudgetForMonth(ey, em); } catch (_) {}
      showToast(`🔁 ${createdCount} recurring expense${createdCount === 1 ? '' : 's'} added`);
    }
  }

  /* ═══════════════════════════════════════════════════════════
     SAVINGS GOALS DATA LAYER (F13)
     ═══════════════════════════════════════════════════════════ */
  async function ensureGoalsTab() {
    if (!hasSheet()) return false;
    const meta = await sheetsRequest('GET', `/${spreadsheetId}?fields=sheets.properties`);
    const tab  = meta.sheets.find(s => s.properties.title === GOALS_TAB_NAME);
    if (tab) {
      goalsGid = tab.properties.sheetId;
      localStorage.setItem('goalsSheetGid', goalsGid);
      const data = await sheetsRequest('GET', `/${spreadsheetId}/values/${GOALS_TAB_NAME}!A1:G1`);
      if (!data.values || data.values.length === 0) {
        await sheetsRequest('POST',
          `/${spreadsheetId}/values/${GOALS_TAB_NAME}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
          { values: [GOALS_HEADERS] });
      }
      return true;
    }
    const res = await sheetsRequest('POST', `/${spreadsheetId}:batchUpdate`, {
      requests: [{ addSheet: { properties: { title: GOALS_TAB_NAME } } }]
    });
    goalsGid = res.replies[0].addSheet.properties.sheetId;
    localStorage.setItem('goalsSheetGid', goalsGid);
    await sheetsRequest('POST',
      `/${spreadsheetId}/values/${GOALS_TAB_NAME}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { values: [GOALS_HEADERS] });
    return true;
  }

  async function loadGoals() {
    if (!hasSheet()) { allGoals = []; return; }
    try {
      const data = await sheetsRequest('GET', `/${spreadsheetId}/values/${GOALS_TAB_NAME}!A:G`);
      const rows = data.values || [];
      allGoals = rows.slice(1)
        .map((r, i) => ({
          rowIndex:  i + 2,
          id:        r[0] || '',
          label:     r[1] || '',
          target:    parseFloat(r[2]) || 0,
          saved:     parseFloat(r[3]) || 0,
          deadline:  r[4] || '',
          createdAt: r[5] || '',
          lastCreditedYYYYMM: r[6] || '',
        }))
        .filter(g => g.id && g.label && g.target > 0);
    } catch (e) {
      allGoals = [];
    }
  }

  async function appendGoalRow(g) {
    await ensureGoalsTab();
    await sheetsRequest('POST',
      `/${spreadsheetId}/values/${GOALS_TAB_NAME}!A:G:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { values: [[g.id, g.label, g.target, g.saved || 0, g.deadline || '', new Date().toISOString(), g.lastCreditedYYYYMM || '']] });
  }

  async function updateGoalRow(g) {
    await sheetsRequest('PUT',
      `/${spreadsheetId}/values/${GOALS_TAB_NAME}!A${g.rowIndex}:G${g.rowIndex}?valueInputOption=RAW`,
      { values: [[g.id, g.label, g.target, g.saved, g.deadline || '', g.createdAt, g.lastCreditedYYYYMM || '']] });
  }

  async function deleteGoalRow(id) {
    const g = allGoals.find(x => x.id === id);
    if (!g) return;
    if (goalsGid < 0) await ensureGoalsTab();
    await sheetsRequest('POST', `/${spreadsheetId}:batchUpdate`, {
      requests: [{ deleteDimension: {
        range: { sheetId: goalsGid, dimension: 'ROWS',
                 startIndex: g.rowIndex - 1, endIndex: g.rowIndex }
      }}]
    });
    await loadGoals();
  }

  /* Auto-credit: for every good (under-budget) month that's COMPLETED (i.e. not
     the current month) and hasn't been credited yet, split (budget - spent)
     equally across all active (not-yet-complete) goals. Run once on app start. */
  async function autoCreditGoals() {
    if (!hasSheet() || allGoals.length === 0 || !window.allBudgets) return;
    const now = new Date();
    const currYM = yyyymm(now);
    const eligibleBudgets = (allBudgets || []).filter(b => {
      const ymd = `${b.year}-${String(b.month).padStart(2,'0')}`;
      return ymd < currYM && b.spent < b.budget && b.budget > 0;
    });
    if (eligibleBudgets.length === 0) return;

    let creditsMade = 0;
    for (const b of eligibleBudgets) {
      const ymd = `${b.year}-${String(b.month).padStart(2,'0')}`;
      /* For each goal still incomplete and not credited for this month yet */
      const activeGoals = allGoals.filter(g => g.saved < g.target && (g.lastCreditedYYYYMM || '') < ymd);
      if (activeGoals.length === 0) continue;
      const savings = Math.max(0, b.budget - b.spent);
      const perGoal = savings / activeGoals.length;
      for (const g of activeGoals) {
        const headroom = Math.max(0, g.target - g.saved);
        const credit = Math.min(perGoal, headroom);
        g.saved += credit;
        g.lastCreditedYYYYMM = ymd;
        try {
          await updateGoalRow(g);
          creditsMade++;
        } catch (e) {
          console.warn('Goal auto-credit failed for', g.label, e.message);
        }
      }
    }
    if (creditsMade > 0) {
      showToast(`🎯 Goals auto-credited from good months`);
    }
  }

  /* ═══════════════════════════════════════════════════════════
     F3 — TODAY'S SPEND HERO CARD
     ═══════════════════════════════════════════════════════════ */
  function renderTodayHero() {
    const el = document.getElementById('today-hero');
    if (!el) return;
    const today = todayStr();
    const todayExpenses = (window.allExpenses || []).filter(e => e.date === today);
    const todaySpend    = todayExpenses.reduce((s, e) => s + e.amount, 0);

    const now = new Date();
    const b   = window.getBudgetForMonth ? getBudgetForMonth(now.getFullYear(), now.getMonth() + 1) : null;
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dailyAllowance = b && b.budget > 0 ? b.budget / daysInMonth : 0;

    document.getElementById('today-hero-amount').textContent = inrFmt(todaySpend);
    document.getElementById('today-hero-sub').textContent =
      todayExpenses.length === 0
        ? 'No expenses yet today'
        : `${todayExpenses.length} entr${todayExpenses.length===1?'y':'ies'} today`;

    const allowanceEl = document.getElementById('today-hero-allowance');
    const barEl       = document.getElementById('today-hero-bar-fill');
    const metaEl      = document.getElementById('today-hero-meta');

    if (dailyAllowance > 0) {
      allowanceEl.textContent = inrFmt(dailyAllowance);
      const pct = clamp((todaySpend / dailyAllowance) * 100, 0, 100);
      barEl.style.width = pct + '%';
      barEl.classList.toggle('over', todaySpend > dailyAllowance);
      if (todaySpend > dailyAllowance) {
        metaEl.textContent = `🚨 Over daily allowance by ${inrFmt(todaySpend - dailyAllowance)}`;
      } else if (todaySpend === 0) {
        metaEl.textContent = `${inrFmt(dailyAllowance)} budgeted for today`;
      } else {
        metaEl.textContent = `${inrFmt(dailyAllowance - todaySpend)} left in today's allowance`;
      }
    } else {
      allowanceEl.textContent = '—';
      barEl.style.width = '0%';
      metaEl.textContent = 'Set a monthly budget for a daily allowance';
    }
  }

  /* ═══════════════════════════════════════════════════════════
     F4 — UNDO TOAST FOR DELETES
     ═══════════════════════════════════════════════════════════ */
  function showUndoToast(deletedExp) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    /* Replace plain text with text + Undo button */
    toast.innerHTML = '<span>Deleted ✕</span><button class="toast-undo" id="toast-undo-btn">Undo</button>';
    document.getElementById('toast-undo-btn').onclick = undoLastDelete;
    toast.style.background = 'var(--dark-card)';
    toast.classList.add('show');
    if (undoTimerId) clearTimeout(undoTimerId);
    undoTimerId = setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        toast.innerHTML = '';
        toast.textContent = '';
        lastDeletedExpense = null;
      }, 400);
    }, 5000);
  }

  async function undoLastDelete() {
    if (!lastDeletedExpense) return;
    const e = lastDeletedExpense;
    lastDeletedExpense = null;
    if (undoTimerId) { clearTimeout(undoTimerId); undoTimerId = null; }
    const toast = document.getElementById('toast');
    toast.classList.remove('show');
    setTimeout(() => { toast.innerHTML = ''; toast.textContent = ''; }, 300);

    setLoading('Restoring…');
    try {
      await ensureToken();
      await appendExpenseRow(e);
      await loadExpenses();
      if (e.date) {
        const [y, m] = e.date.split('-').map(Number);
        try { await recomputeBudgetForMonth(y, m); } catch (_) {}
      }
      clearLoading();
      showToast('Restored ✓');
      if (currentView === 'dashboard') renderDashboard();
      if (currentView === 'insights')  renderInsights();
      if (typeof renderTodayTotal === 'function') renderTodayTotal();
    } catch (err) {
      clearLoading();
      showToast('Restore failed: ' + err.message, true);
    }
  }

  /* ═══════════════════════════════════════════════════════════
     F5 — SEARCH
     ═══════════════════════════════════════════════════════════ */
  let searchDebounceId = null;
  function openSearch() {
    /* Make sure we're on the Dashboard view because search results render
       inline above the entries list. */
    if (currentView !== 'dashboard') switchView('dashboard');
    document.getElementById('search-wrap').style.display = 'flex';
    document.getElementById('search-input').focus();
    document.getElementById('search-input').oninput = onSearchInput;
  }
  function closeSearch() {
    document.getElementById('search-wrap').style.display = 'none';
    document.getElementById('search-results').style.display = 'none';
    document.getElementById('search-input').value = '';
    if (searchDebounceId) clearTimeout(searchDebounceId);
  }
  function onSearchInput() {
    const q = document.getElementById('search-input').value.trim().toLowerCase();
    if (searchDebounceId) clearTimeout(searchDebounceId);
    searchDebounceId = setTimeout(() => runSearch(q), 150);
  }
  function runSearch(q) {
    const out = document.getElementById('search-results');
    if (!q) { out.style.display = 'none'; out.innerHTML = ''; return; }
    out.style.display = 'block';
    /* Match by category label, note substring, or amount equality. */
    const isAmount = /^\d+(\.\d+)?$/.test(q);
    const amtQuery = isAmount ? parseFloat(q) : null;
    const results = (window.allExpenses || []).filter(e => {
      if (!e) return false;
      if (amtQuery !== null && Math.abs(e.amount - amtQuery) < 0.5) return true;
      const note = (e.note || '').toLowerCase();
      if (note.includes(q)) return true;
      const c = (window.CAT_MAP || {})[e.category];
      if (c && c.label.toLowerCase().includes(q)) return true;
      if (e.category && e.category.toLowerCase().includes(q)) return true;
      return false;
    }).sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    if (results.length === 0) {
      out.innerHTML = `<p class="search-empty">No matches for "${safe(q)}".</p>`;
      return;
    }
    out.innerHTML = `<p class="search-count">${results.length} result${results.length===1?'':'s'} for "${safe(q)}"</p>` +
      results.slice(0, 100).map(e => (typeof expenseRowHTML === 'function' ? expenseRowHTML(e) : '')).join('');
  }

  /* ═══════════════════════════════════════════════════════════
     F6 — AI CATEGORY SUGGESTION
     - Built-in keyword map (AI_KEYWORDS + MERCHANT_HINTS)
     - User history: notes → category, weighted by frequency
     - Combined: history wins when present, else keywords
     ═══════════════════════════════════════════════════════════ */
  function loadCatHistory() {
    try {
      return JSON.parse(localStorage.getItem('catHistoryV1') || '{}');
    } catch (_) { return {}; }
  }
  function saveCatHistory(h) {
    try { localStorage.setItem('catHistoryV1', JSON.stringify(h)); } catch (_) {}
  }
  function recordCatHistory(note, catKey) {
    if (!note || !catKey) return;
    const lower = note.toLowerCase().trim();
    if (!lower) return;
    const h = loadCatHistory();
    /* Record at the level of each token (word), not the whole note, so the
       same individual word ("starbucks") generalizes across notes. */
    const tokens = lower.split(/\s+/).filter(t => t.length >= 3);
    for (const t of tokens) {
      if (!h[t]) h[t] = {};
      h[t][catKey] = (h[t][catKey] || 0) + 1;
    }
    saveCatHistory(h);
  }

  function suggestCategoryFromNote(note) {
    if (!note) return null;
    const lower = note.toLowerCase();
    /* 1. User history token vote */
    const history = loadCatHistory();
    const tokens = lower.split(/\s+/).filter(t => t.length >= 3);
    const votes = {};
    for (const t of tokens) {
      const h = history[t];
      if (!h) continue;
      for (const [cat, n] of Object.entries(h)) {
        votes[cat] = (votes[cat] || 0) + n;
      }
    }
    let bestHistory = null;
    for (const [cat, n] of Object.entries(votes)) {
      if (!bestHistory || n > bestHistory[1]) bestHistory = [cat, n];
    }
    if (bestHistory) return bestHistory[0];

    /* 2. Merchant hints */
    for (const [m, c] of Object.entries(MERCHANT_HINTS)) {
      if (new RegExp(`\\b${m}\\b`, 'i').test(lower)) return c;
    }
    /* 3. Keyword map */
    for (const [cat, kws] of Object.entries(AI_KEYWORDS)) {
      for (const kw of kws) {
        if (new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lower)) return cat;
      }
    }
    /* 4. Custom categories — match by label fragment */
    for (const c of (typeof allCategories === 'function' ? allCategories() : [])) {
      if (c.key.startsWith('custom_') && lower.includes(c.label.toLowerCase())) return c.key;
    }
    return null;
  }

  function onNoteInput() {
    const note = document.getElementById('note-input').value.trim();
    aiSuggestDismissed = false;   /* fresh typing resets dismiss flag */
    if (!note || note.length < 3) { hideAiSuggest(); return; }
    /* If user already picked a category, don't overlay */
    if (window.selectedCat) { hideAiSuggest(); return; }
    const suggestion = suggestCategoryFromNote(note);
    if (!suggestion) { hideAiSuggest(); return; }
    aiSuggestedKey = suggestion;
    const c = (CAT_MAP || {})[suggestion];
    if (!c) { hideAiSuggest(); return; }
    document.getElementById('ai-suggest-cat').textContent = c.label;
    document.getElementById('ai-suggest').style.display = 'flex';
  }
  function acceptAiSuggestion() {
    if (!aiSuggestedKey) return;
    if (typeof selectCat === 'function') selectCat(aiSuggestedKey);
    hideAiSuggest();
  }
  function dismissAiSuggestion() { aiSuggestDismissed = true; hideAiSuggest(); }
  function hideAiSuggest() { document.getElementById('ai-suggest').style.display = 'none'; aiSuggestedKey = null; }

  /* ═══════════════════════════════════════════════════════════
     F10 — END-OF-MONTH FORECAST
     ═══════════════════════════════════════════════════════════ */
  function computeForecast() {
    const vm = window.viewMonth || new Date();
    const now = new Date();
    const isCurrent = vm.getFullYear() === now.getFullYear() && vm.getMonth() === now.getMonth();
    if (!isCurrent) return null;   /* forecast only meaningful for current month */

    const y = vm.getFullYear(), m = vm.getMonth() + 1;
    const exps = (window.allExpenses || []).filter(e => {
      if (!e.date) return false;
      const [ey, em] = e.date.split('-').map(Number);
      return ey === y && em === m;
    });
    const spentSoFar = exps.reduce((s, e) => s + e.amount, 0);
    const daysElapsed = now.getDate();
    const daysInMonth = new Date(y, m, 0).getDate();
    if (daysElapsed < 3) return null;   /* need at least 3 days of data */

    /* Linear projection: dailyAvg × daysInMonth */
    const dailyAvg  = spentSoFar / daysElapsed;
    const projected = dailyAvg * daysInMonth;

    /* Add unfired recurrings due this month into projection */
    let recRemaining = 0;
    const ymStr = yyyymm(now);
    for (const r of allRecurring) {
      if (r.lastRunYYYYMM !== ymStr && r.dayOfMonth > daysElapsed) {
        recRemaining += r.amount;
      }
    }
    const totalProjection = projected + recRemaining;

    const budget = window.getBudgetForMonth ? getBudgetForMonth(y, m) : null;
    return {
      spentSoFar, dailyAvg, daysElapsed, daysInMonth,
      projected: totalProjection,
      budget: budget ? budget.budget : 0,
      overBy: budget && totalProjection > budget.budget ? totalProjection - budget.budget : 0,
      underBy: budget && totalProjection <= budget.budget ? budget.budget - totalProjection : 0,
    };
  }

  function renderForecast() {
    const card = document.getElementById('forecast-card');
    if (!card) return;
    const f = computeForecast();
    if (!f) { card.style.display = 'none'; return; }
    card.style.display = 'flex';
    const titleEl = document.getElementById('forecast-title');
    const subEl   = document.getElementById('forecast-sub');
    const valEl   = document.getElementById('forecast-val');
    const iconEl  = document.getElementById('forecast-icon');

    valEl.textContent = inrFmt(f.projected);
    if (f.budget > 0) {
      if (f.overBy > 0) {
        titleEl.textContent = 'On pace to overspend';
        subEl.textContent   = `Projected to be ${inrFmt(f.overBy)} over the ${inrFmt(f.budget)} budget.`;
        iconEl.textContent  = '🚨';
        card.classList.remove('good'); card.classList.add('bad');
      } else {
        titleEl.textContent = 'On track to save';
        subEl.textContent   = `Projected ${inrFmt(f.underBy)} under the ${inrFmt(f.budget)} budget.`;
        iconEl.textContent  = '✨';
        card.classList.remove('bad'); card.classList.add('good');
      }
    } else {
      titleEl.textContent = 'End-of-month forecast';
      subEl.textContent   = `At ${inrFmt(f.dailyAvg)}/day pace, you'll spend ${inrFmt(f.projected)} this month.`;
      iconEl.textContent  = '📈';
      card.classList.remove('good','bad');
    }
  }

  /* ═══════════════════════════════════════════════════════════
     F11 — CATEGORY SPARKLINES (last 3 months)
     ═══════════════════════════════════════════════════════════ */
  function destroySparkCharts() {
    sparkCharts.forEach(c => { try { c.destroy(); } catch (_) {} });
    sparkCharts = [];
  }
  function monthTotalForCat(year, month, catKey) {
    return (window.allExpenses || []).reduce((s, e) => {
      if (!e.date) return s;
      if (e.category !== catKey) return s;
      const [ey, em] = e.date.split('-').map(Number);
      return (ey === year && em === month) ? s + e.amount : s;
    }, 0);
  }
  function renderSparklines() {
    const wrap = document.getElementById('sparklines-list');
    if (!wrap) return;
    destroySparkCharts();

    const vm = window.viewMonth || new Date();
    /* 3 months ending in vm */
    const months = [
      new Date(vm.getFullYear(), vm.getMonth() - 2, 1),
      new Date(vm.getFullYear(), vm.getMonth() - 1, 1),
      new Date(vm.getFullYear(), vm.getMonth(),     1),
    ];

    /* Aggregate per category */
    const seenCats = new Set();
    months.forEach(d => {
      const y = d.getFullYear(), m = d.getMonth() + 1;
      (window.allExpenses || []).forEach(e => {
        if (!e.date) return;
        const [ey, em] = e.date.split('-').map(Number);
        if (ey === y && em === m && e.category) seenCats.add(e.category);
      });
    });
    if (seenCats.size === 0) {
      wrap.innerHTML = '<p class="search-empty">No data yet — keep adding expenses to see trends.</p>';
      return;
    }

    /* Build list of { catKey, totals[3], delta } sorted by latest month spend desc */
    const items = [...seenCats].map(catKey => {
      const totals = months.map(d => monthTotalForCat(d.getFullYear(), d.getMonth() + 1, catKey));
      const prev   = totals[1];
      const last   = totals[2];
      const delta  = prev > 0 ? ((last - prev) / prev) * 100 : null;
      return { catKey, totals, delta };
    }).sort((a, b) => b.totals[2] - a.totals[2]);

    /* Render rows + canvas placeholders */
    wrap.innerHTML = items.slice(0, 8).map(it => {
      const c = (CAT_MAP || {})[it.catKey] || { icon:'📦', label: it.catKey, color: '#78909C' };
      const max = Math.max(...it.totals, 1);
      const points = it.totals.map((v, i) => ({ x: i, y: v / max }));
      const dArrow = it.delta === null ? '—' : (it.delta >= 0 ? '↑' : '↓');
      const dPct   = it.delta === null ? '' : Math.abs(Math.round(it.delta)) + '%';
      const dCls   = it.delta === null ? 'flat' : (it.delta > 0 ? 'up' : (it.delta < 0 ? 'down' : 'flat'));
      const polyline = polylineFor(points);
      return `
        <div class="spark-row">
          <div class="spark-cat-icon" style="background:${c.color}22;">${c.icon}</div>
          <div class="spark-info">
            <div class="spark-name">${c.label}</div>
            <div class="spark-meta">${months.map(m => m.toLocaleDateString('en-IN',{month:'short'})).join(' · ')}</div>
          </div>
          <svg class="spark-svg" viewBox="0 0 60 24" preserveAspectRatio="none" aria-hidden="true">
            <polyline points="${polyline}" fill="none" stroke="${c.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            ${points.map(p => `<circle cx="${(p.x/2)*60}" cy="${24 - p.y*22 - 1}" r="1.6" fill="${c.color}" />`).join('')}
          </svg>
          <div class="spark-right">
            <div class="spark-val">${inrFmt(it.totals[2])}</div>
            <div class="spark-delta ${dCls}">${dArrow} ${dPct}</div>
          </div>
        </div>
      `;
    }).join('');
  }
  function polylineFor(points) {
    /* Map [0..2] x → [0..60], y in [0..1] → [22..2] (inverted, padded) */
    return points.map(p => `${(p.x / 2) * 60},${24 - p.y * 22 - 1}`).join(' ');
  }

  /* ═══════════════════════════════════════════════════════════
     F7 — SPENDING CALENDAR HEATMAP
     ═══════════════════════════════════════════════════════════ */
  function setHeatmapMode(mode) {
    heatmapMode = mode;
    document.querySelectorAll('.heatmap-toggle-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    renderHeatmap();
  }
  function renderHeatmap() {
    const wrap = document.getElementById('heatmap-wrap');
    if (!wrap) return;
    if (heatmapMode === 'year') renderHeatmapYear(wrap);
    else renderHeatmapMonth(wrap);
  }
  function renderHeatmapMonth(wrap) {
    const vm = window.viewMonth || new Date();
    const y = vm.getFullYear(), m = vm.getMonth();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const firstWeekday = (new Date(y, m, 1).getDay() + 6) % 7; /* Monday=0 */

    /* Pre-compute totals per day */
    const totals = new Array(daysInMonth + 1).fill(0);
    (window.allExpenses || []).forEach(e => {
      if (!e.date) return;
      const [ey, em, ed] = e.date.split('-').map(Number);
      if (ey === y && em === m + 1 && ed >= 1 && ed <= daysInMonth) {
        totals[ed] += e.amount;
      }
    });
    const max = Math.max(...totals, 1);

    let html = '<div class="heatmap-month">';
    html += '<div class="heatmap-dows">' + ['M','T','W','T','F','S','S'].map(d => `<span>${d}</span>`).join('') + '</div>';
    html += '<div class="heatmap-grid">';
    for (let i = 0; i < firstWeekday; i++) html += '<div class="heatmap-cell empty"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const v = totals[d];
      const level = v === 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4));
      html += `<div class="heatmap-cell level-${level}" title="${d} ${vm.toLocaleDateString('en-IN',{month:'short'})}: ${inrFmt(v)}">
        <span class="heatmap-day">${d}</span>
        ${v > 0 ? `<span class="heatmap-amt">${v >= 1000 ? '₹'+(v/1000).toFixed(0)+'k' : '₹'+Math.round(v)}</span>` : ''}
      </div>`;
    }
    html += '</div>';
    html += '<div class="heatmap-legend"><span>Less</span><span class="heatmap-cell level-0"></span><span class="heatmap-cell level-1"></span><span class="heatmap-cell level-2"></span><span class="heatmap-cell level-3"></span><span class="heatmap-cell level-4"></span><span>More</span></div>';
    html += '</div>';
    wrap.innerHTML = html;
  }
  function renderHeatmapYear(wrap) {
    const now = new Date();
    /* 53 weeks back rolling */
    const weeks = 53;
    const cells = []; /* each cell: { date: 'yyyy-mm-dd', amount } */
    const end = new Date(now);
    /* Go back to Monday of the week of (now - 53 weeks) */
    const start = new Date(now);
    start.setDate(start.getDate() - (weeks * 7 - 1));
    /* Roll to nearest Monday */
    const dow = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - dow);

    /* Build per-day total lookup */
    const map = {};
    (window.allExpenses || []).forEach(e => {
      if (!e.date) return;
      map[e.date] = (map[e.date] || 0) + e.amount;
    });
    /* Build grid */
    const max = Math.max(...Object.values(map), 1);
    let html = '<div class="heatmap-year"><div class="heatmap-year-grid">';
    for (let w = 0; w < weeks; w++) {
      html += '<div class="heatmap-year-col">';
      for (let d = 0; d < 7; d++) {
        const cur = new Date(start);
        cur.setDate(cur.getDate() + (w * 7 + d));
        if (cur > end) {
          html += '<span class="heatmap-cell empty"></span>';
        } else {
          const ymd = dToYMD(cur);
          const v = map[ymd] || 0;
          const level = v === 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4));
          html += `<span class="heatmap-cell level-${level}" title="${ymd}: ${inrFmt(v)}"></span>`;
        }
      }
      html += '</div>';
    }
    html += '</div></div>';
    html += '<div class="heatmap-legend"><span>Less</span><span class="heatmap-cell level-0"></span><span class="heatmap-cell level-1"></span><span class="heatmap-cell level-2"></span><span class="heatmap-cell level-3"></span><span class="heatmap-cell level-4"></span><span>More</span></div>';
    wrap.innerHTML = html;
  }

  /* ═══════════════════════════════════════════════════════════
     F8 — WHAT-IF BUDGET SIMULATOR
     ═══════════════════════════════════════════════════════════ */
  function openWhatIfModal() {
    whatIfCuts = {};
    renderWhatIf();
    document.getElementById('whatif-modal').style.display = 'flex';
  }
  function closeWhatIfModal() {
    document.getElementById('whatif-modal').style.display = 'none';
  }
  function resetWhatIf() {
    whatIfCuts = {};
    document.querySelectorAll('.whatif-slider').forEach(s => { s.value = 0; });
    renderWhatIf();
  }
  function renderWhatIf() {
    /* Build per-category totals from CURRENT month */
    const vm = window.viewMonth || new Date();
    const y = vm.getFullYear(), m = vm.getMonth() + 1;
    const byCat = {};
    (window.allExpenses || []).forEach(e => {
      if (!e.date) return;
      const [ey, em] = e.date.split('-').map(Number);
      if (ey === y && em === m && e.category) {
        byCat[e.category] = (byCat[e.category] || 0) + e.amount;
      }
    });
    const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    const wrap = document.getElementById('whatif-sliders');
    if (cats.length === 0) {
      wrap.innerHTML = '<p class="search-empty">Add expenses this month to simulate cuts.</p>';
      updateWhatIfSummary(0, 0);
      return;
    }
    wrap.innerHTML = cats.map(([k, v]) => {
      const c = (CAT_MAP || {})[k] || { icon:'📦', label: k, color:'#78909C' };
      const pct = whatIfCuts[k] || 0;
      return `
        <div class="whatif-row-cat">
          <div class="whatif-cat-head">
            <span class="whatif-cat-icon" style="background:${c.color}22;">${c.icon}</span>
            <span class="whatif-cat-label">${c.label}</span>
            <span class="whatif-cat-cur">${inrFmt(v)}</span>
          </div>
          <div class="whatif-slider-row">
            <input type="range" class="whatif-slider" data-cat="${k}" min="0" max="100" value="${pct}" oninput="onWhatIfChange(this)" />
            <span class="whatif-cut-label" id="whatif-cut-${k.replace(/[^\w]/g,'_')}">cut ${pct}%</span>
          </div>
          <div class="whatif-saved-row">
            → ${inrFmt(v * (1 - pct / 100))} <span class="whatif-saved-pct">(save ${inrFmt(v * pct / 100)})</span>
          </div>
        </div>
      `;
    }).join('');
    recalcWhatIf();
  }
  function onWhatIfChange(slider) {
    const k = slider.dataset.cat;
    const v = parseInt(slider.value);
    whatIfCuts[k] = v;
    const lbl = document.getElementById('whatif-cut-' + k.replace(/[^\w]/g,'_'));
    if (lbl) lbl.textContent = 'cut ' + v + '%';
    /* Update the per-row "→ X (save Y)" without full re-render */
    const row = slider.closest('.whatif-row-cat');
    if (row) {
      const vm = window.viewMonth || new Date();
      const y = vm.getFullYear(), m = vm.getMonth() + 1;
      const cur = (window.allExpenses || []).reduce((s, e) => {
        if (!e.date || e.category !== k) return s;
        const [ey, em] = e.date.split('-').map(Number);
        return (ey === y && em === m) ? s + e.amount : s;
      }, 0);
      const savedRow = row.querySelector('.whatif-saved-row');
      if (savedRow) {
        savedRow.innerHTML = `→ ${inrFmt(cur * (1 - v / 100))} <span class="whatif-saved-pct">(save ${inrFmt(cur * v / 100)})</span>`;
      }
    }
    recalcWhatIf();
  }
  function recalcWhatIf() {
    const vm = window.viewMonth || new Date();
    const y = vm.getFullYear(), m = vm.getMonth() + 1;
    let cur = 0, after = 0;
    const byCat = {};
    (window.allExpenses || []).forEach(e => {
      if (!e.date) return;
      const [ey, em] = e.date.split('-').map(Number);
      if (ey === y && em === m && e.category) {
        byCat[e.category] = (byCat[e.category] || 0) + e.amount;
      }
    });
    for (const [k, v] of Object.entries(byCat)) {
      cur += v;
      const cut = whatIfCuts[k] || 0;
      after += v * (1 - cut / 100);
    }
    updateWhatIfSummary(cur, after);
  }
  function updateWhatIfSummary(cur, after) {
    document.getElementById('whatif-current').textContent  = inrFmt(cur);
    document.getElementById('whatif-newspend').textContent = inrFmt(after);
    document.getElementById('whatif-saved').textContent    = inrFmt(cur - after);
    document.getElementById('whatif-6mo').textContent      = inrFmt((cur - after) * 6);
  }

  /* ═══════════════════════════════════════════════════════════
     F9 — YEAR-IN-REVIEW
     ═══════════════════════════════════════════════════════════ */
  function destroyYearWrapCharts() {
    yearwrapCharts.forEach(c => { try { c.destroy(); } catch (_) {} });
    yearwrapCharts = [];
  }
  function openYearWrapModal() {
    const yrs = availableYears();
    if (yrs.length === 0) {
      showToast('No expense data yet — add some first', true);
      return;
    }
    const sel = document.getElementById('yearwrap-year');
    sel.innerHTML = yrs.map(y => `<option value="${y}">${y}</option>`).join('');
    sel.value = yrs[yrs.length - 1];
    document.getElementById('yearwrap-modal').style.display = 'flex';
    renderYearWrap();
  }
  function closeYearWrapModal() {
    destroyYearWrapCharts();
    document.getElementById('yearwrap-modal').style.display = 'none';
  }
  function availableYears() {
    const set = new Set();
    (window.allExpenses || []).forEach(e => {
      if (e.date) set.add(parseInt(e.date.slice(0, 4)));
    });
    return [...set].filter(y => !isNaN(y)).sort();
  }
  function renderYearWrap() {
    destroyYearWrapCharts();
    const year = parseInt(document.getElementById('yearwrap-year').value);
    const body = document.getElementById('yearwrap-body');
    const exps = (window.allExpenses || []).filter(e => {
      if (!e.date) return false;
      return parseInt(e.date.slice(0, 4)) === year;
    });
    if (exps.length === 0) {
      body.innerHTML = `<p class="search-empty">No data for ${year}.</p>`;
      return;
    }
    const total = exps.reduce((s, e) => s + e.amount, 0);
    const months = new Array(12).fill(0);
    const byCat = {};
    const byDay = {};
    exps.forEach(e => {
      const [y, m, d] = e.date.split('-').map(Number);
      months[m - 1] += e.amount;
      byCat[e.category] = (byCat[e.category] || 0) + e.amount;
      byDay[e.date]     = (byDay[e.date]     || 0) + e.amount;
    });
    const topCatEntry = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
    const topCat = topCatEntry ? (CAT_MAP || {})[topCatEntry[0]] : null;
    const biggestDay = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];

    /* Compute savings from budgets vs spend */
    let savedTotal = 0, overspentTotal = 0, goodMonths = 0, badMonths = 0;
    for (let mi = 0; mi < 12; mi++) {
      const b = window.getBudgetForMonth ? getBudgetForMonth(year, mi + 1) : null;
      if (!b) continue;
      if (months[mi] < b.budget) { savedTotal += b.budget - months[mi]; goodMonths++; }
      else                       { overspentTotal += months[mi] - b.budget; badMonths++; }
    }
    const monthsTracked = months.filter(v => v > 0).length;
    const avgPerMonth = monthsTracked > 0 ? total / monthsTracked : 0;

    body.innerHTML = `
      <div class="yearwrap-hero">
        <div class="yearwrap-year-big">${year}</div>
        <div class="yearwrap-total">${inrFmt(total)}</div>
        <div class="yearwrap-sub">${exps.length} expenses across ${monthsTracked} months</div>
      </div>

      <div class="yearwrap-stat-row">
        <div class="yearwrap-stat">
          <div class="yearwrap-stat-icon">📅</div>
          <div class="yearwrap-stat-val">${inrFmt(avgPerMonth)}</div>
          <div class="yearwrap-stat-lbl">per month</div>
        </div>
        <div class="yearwrap-stat">
          <div class="yearwrap-stat-icon">${topCat ? topCat.icon : '📦'}</div>
          <div class="yearwrap-stat-val">${topCat ? topCat.label : '—'}</div>
          <div class="yearwrap-stat-lbl">top category</div>
        </div>
        <div class="yearwrap-stat">
          <div class="yearwrap-stat-icon">🔥</div>
          <div class="yearwrap-stat-val">${biggestDay ? fmtDate(biggestDay[0]) : '—'}</div>
          <div class="yearwrap-stat-lbl">biggest day · ${biggestDay ? inrFmt(biggestDay[1]) : '—'}</div>
        </div>
      </div>

      <p class="dash-section-title">Monthly trend</p>
      <div class="chart-card"><div class="chart-wrap" style="height:160px;"><canvas id="yearwrap-bar"></canvas></div></div>

      <p class="dash-section-title">Where money went</p>
      <div class="chart-card">
        <div class="donut-layout">
          <div class="donut-wrap"><canvas id="yearwrap-donut" width="130" height="130"></canvas></div>
          <div class="donut-legend" id="yearwrap-legend"></div>
        </div>
      </div>

      <p class="dash-section-title">Verdict</p>
      <div class="yearwrap-verdict">
        <div>🟢 ${goodMonths} good month${goodMonths === 1 ? '' : 's'} — saved ${inrFmt(savedTotal)}</div>
        <div>🔴 ${badMonths} bad month${badMonths === 1 ? '' : 's'} — overspent ${inrFmt(overspentTotal)}</div>
        <div class="yearwrap-verdict-net">Net: ${inrFmt(savedTotal - overspentTotal)}</div>
      </div>
    `;

    /* Bar chart */
    if (typeof Chart !== 'undefined') {
      const barCtx = document.getElementById('yearwrap-bar').getContext('2d');
      yearwrapCharts.push(new Chart(barCtx, {
        type: 'bar',
        data: {
          labels: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
          datasets: [{
            data: months,
            backgroundColor: 'rgba(124,92,252,0.75)',
            borderRadius: 6,
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + inrFmt(ctx.raw) } } },
          scales: {
            x: { grid: { display: false }, ticks: { font: { size: 10 } } },
            y: { ticks: { callback: v => v >= 1000 ? '₹' + (v/1000).toFixed(0) + 'k' : '₹' + v } }
          }
        }
      }));

      /* Donut */
      const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
      const donutCtx = document.getElementById('yearwrap-donut').getContext('2d');
      yearwrapCharts.push(new Chart(donutCtx, {
        type: 'doughnut',
        data: {
          labels: cats.map(([k]) => (CAT_MAP[k] || { label: k }).label),
          datasets: [{
            data:            cats.map(([, v]) => v),
            backgroundColor: cats.map(([k]) => (CAT_MAP[k] || { color: '#78909C' }).color),
            borderWidth: 2,
            borderColor: '#FFFFFF',
          }]
        },
        options: {
          responsive: false, cutout: '66%',
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${inrFmt(ctx.raw)}` } } }
        }
      }));

      document.getElementById('yearwrap-legend').innerHTML = cats.slice(0, 5).map(([k, v]) => {
        const c = CAT_MAP[k] || { color: '#78909C', label: k };
        return `<div class="legend-item"><div class="legend-dot" style="background:${c.color};"></div><span class="legend-name">${c.label}</span><span class="legend-amt">${inrFmt(v)}</span></div>`;
      }).join('');
    }
  }

  /* ═══════════════════════════════════════════════════════════
     F14 — EXPORT (CSV + PDF)
     ═══════════════════════════════════════════════════════════ */
  function openExportModal() {
    document.getElementById('export-modal').style.display = 'flex';
  }
  function closeExportModal() {
    document.getElementById('export-modal').style.display = 'none';
  }

  function exportRangeData() {
    const range = document.getElementById('export-range').value;
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth() + 1;
    let from, to;
    if (range === 'this-month') {
      from = `${y}-${String(m).padStart(2,'0')}-01`;
      to   = `${y}-${String(m).padStart(2,'0')}-${String(new Date(y, m, 0).getDate()).padStart(2,'0')}`;
    } else if (range === 'last-month') {
      const lm = new Date(y, m - 2, 1);
      const ly = lm.getFullYear(), lmo = lm.getMonth() + 1;
      from = `${ly}-${String(lmo).padStart(2,'0')}-01`;
      to   = `${ly}-${String(lmo).padStart(2,'0')}-${String(new Date(ly, lmo, 0).getDate()).padStart(2,'0')}`;
    } else if (range === 'this-year') {
      from = `${y}-01-01`; to = `${y}-12-31`;
    } else if (range === 'last-year') {
      from = `${y-1}-01-01`; to = `${y-1}-12-31`;
    } else {
      from = '0000-01-01'; to = '9999-12-31';
    }
    const exps = (window.allExpenses || []).filter(e => e.date >= from && e.date <= to)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    return { exps, from, to, rangeLabel: range };
  }

  function exportAsCSV() {
    const { exps, rangeLabel } = exportRangeData();
    if (exps.length === 0) { showToast('No expenses in that range', true); return; }
    const rows = [['Date','Category','Amount','Note','CreatedAt']];
    exps.forEach(e => {
      const c = (CAT_MAP || {})[e.category];
      rows.push([e.date, c ? c.label : e.category, e.amount, e.note || '', e.createdAt || '']);
    });
    const csv = rows.map(r => r.map(v => {
      const s = String(v == null ? '' : v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    }).join(',')).join('\n');
    downloadBlob(csv, `expenses-${rangeLabel}-${todayStr()}.csv`, 'text/csv;charset=utf-8;');
    showToast(`Exported ${exps.length} rows ✓`);
  }

  async function loadJsPDF() {
    if (window.jspdf) return window.jspdf;
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
      s.onload  = () => resolve(window.jspdf);
      s.onerror = () => reject(new Error('Could not load jsPDF library — check internet'));
      document.head.appendChild(s);
    });
  }

  async function exportAsPDF() {
    const { exps, from, to, rangeLabel } = exportRangeData();
    if (exps.length === 0) { showToast('No expenses in that range', true); return; }
    setLoading('Preparing PDF…');
    try {
      const lib = await loadJsPDF();
      const { jsPDF } = lib;
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const w = doc.internal.pageSize.getWidth();
      let yPos = 50;
      doc.setFontSize(18); doc.setFont('helvetica','bold');
      doc.text('Expense Report', 40, yPos);
      yPos += 22;
      doc.setFontSize(10); doc.setFont('helvetica','normal');
      doc.text(`Range: ${from} → ${to}`, 40, yPos); yPos += 14;
      doc.text(`Generated: ${todayStr()}`, 40, yPos); yPos += 18;

      const total = exps.reduce((s, e) => s + e.amount, 0);
      const byCat = {};
      exps.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + e.amount; });

      doc.setFontSize(11); doc.setFont('helvetica','bold');
      doc.text(`Total: Rs. ${Math.round(total).toLocaleString('en-IN')} across ${exps.length} entries`, 40, yPos);
      yPos += 18;

      /* Category totals */
      doc.setFontSize(10); doc.setFont('helvetica','bold');
      doc.text('Category breakdown', 40, yPos); yPos += 14;
      doc.setFont('helvetica','normal');
      Object.entries(byCat).sort((a,b)=>b[1]-a[1]).forEach(([k, v]) => {
        const c = (CAT_MAP || {})[k];
        const pct = total > 0 ? Math.round((v / total) * 100) : 0;
        doc.text(`${c ? c.label : k}: Rs. ${Math.round(v).toLocaleString('en-IN')} (${pct}%)`, 50, yPos);
        yPos += 14;
        if (yPos > 760) { doc.addPage(); yPos = 50; }
      });

      yPos += 8;
      /* Entries table */
      doc.setFont('helvetica','bold');
      doc.text('Entries', 40, yPos); yPos += 14;
      doc.setFont('helvetica','normal');
      doc.setFontSize(9);
      const colDate = 40, colCat = 110, colAmt = 230, colNote = 290;
      doc.text('Date', colDate, yPos);
      doc.text('Category', colCat, yPos);
      doc.text('Amount', colAmt, yPos);
      doc.text('Note', colNote, yPos);
      yPos += 12;
      doc.setLineWidth(0.5);
      doc.line(40, yPos - 4, w - 40, yPos - 4);
      for (const e of exps) {
        if (yPos > 780) { doc.addPage(); yPos = 50; }
        const c = (CAT_MAP || {})[e.category];
        doc.text(e.date || '', colDate, yPos);
        doc.text((c ? c.label : e.category || '').slice(0, 18), colCat, yPos);
        doc.text(`Rs. ${Math.round(e.amount).toLocaleString('en-IN')}`, colAmt, yPos);
        doc.text((e.note || '').slice(0, 50), colNote, yPos);
        yPos += 12;
      }
      doc.save(`expenses-${rangeLabel}-${todayStr()}.pdf`);
      clearLoading();
      showToast(`PDF saved ✓`);
    } catch (e) {
      clearLoading();
      showToast('PDF export failed: ' + e.message, true);
    }
  }

  async function exportYearWrapAsPDF() {
    const year = parseInt(document.getElementById('yearwrap-year').value);
    setLoading('Preparing PDF…');
    try {
      const lib = await loadJsPDF();
      const { jsPDF } = lib;
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      let y = 60;
      doc.setFontSize(28); doc.setFont('helvetica','bold');
      doc.text(`${year} Year-in-Review`, 40, y); y += 36;
      doc.setFontSize(11); doc.setFont('helvetica','normal');
      const exps = (window.allExpenses || []).filter(e => e.date && parseInt(e.date.slice(0,4)) === year);
      const total = exps.reduce((s, e) => s + e.amount, 0);
      const byCat = {};
      exps.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + e.amount; });
      doc.text(`Total spent: Rs. ${Math.round(total).toLocaleString('en-IN')}`, 40, y); y += 16;
      doc.text(`Number of expenses: ${exps.length}`, 40, y); y += 16;
      const topCat = Object.entries(byCat).sort((a,b)=>b[1]-a[1])[0];
      if (topCat) {
        const c = (CAT_MAP || {})[topCat[0]];
        doc.text(`Top category: ${c ? c.label : topCat[0]} (Rs. ${Math.round(topCat[1]).toLocaleString('en-IN')})`, 40, y); y += 16;
      }
      doc.save(`year-in-review-${year}.pdf`);
      clearLoading();
      showToast('Year-wrap PDF saved ✓');
    } catch (e) {
      clearLoading();
      showToast('Export failed: ' + e.message, true);
    }
  }

  function downloadBlob(content, filename, type) {
    const blob = new Blob([content], { type });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  /* ═══════════════════════════════════════════════════════════
     TOOLS MENU + MODAL OPEN/CLOSE
     ═══════════════════════════════════════════════════════════ */
  function openToolsMenu() {
    document.getElementById('tools-menu-modal').style.display = 'flex';
  }
  function closeToolsMenu() {
    document.getElementById('tools-menu-modal').style.display = 'none';
  }

  /* ═══════════════════════════════════════════════════════════
     RECURRING UI
     ═══════════════════════════════════════════════════════════ */
  function openRecurringModal() {
    /* Populate category dropdown */
    const sel = document.getElementById('rec-cat');
    if (typeof allCategories === 'function') {
      sel.innerHTML = allCategories().map(c => `<option value="${c.key}">${c.icon} ${c.label}</option>`).join('');
    }
    document.getElementById('rec-label').value  = '';
    document.getElementById('rec-amount').value = '';
    document.getElementById('rec-day').value    = '';
    renderRecurringList();
    document.getElementById('recurring-modal').style.display = 'flex';
  }
  function closeRecurringModal() {
    document.getElementById('recurring-modal').style.display = 'none';
  }
  async function saveRecurring() {
    const label  = document.getElementById('rec-label').value.trim();
    const amount = parseFloat(document.getElementById('rec-amount').value);
    const day    = parseInt(document.getElementById('rec-day').value);
    const cat    = document.getElementById('rec-cat').value;
    if (!label)             { showToast('Enter a label', true); return; }
    if (!amount || amount <= 0) { showToast('Enter an amount', true); return; }
    if (!day || day < 1 || day > 28) { showToast('Day must be 1–28', true); return; }
    if (!cat)               { showToast('Pick a category', true); return; }

    const r = { id: uuid(), label, amount, category: cat, dayOfMonth: day, lastRunYYYYMM: '' };
    setLoading('Saving recurring…');
    try {
      await ensureToken();
      await appendRecurringRow(r);
      await loadRecurring();
      clearLoading();
      showToast(`🔁 "${label}" saved`);
      /* Fire immediately if today >= day */
      await applyDueRecurring();
      document.getElementById('rec-label').value  = '';
      document.getElementById('rec-amount').value = '';
      document.getElementById('rec-day').value    = '';
      renderRecurringList();
      if (currentView === 'dashboard') renderDashboard();
    } catch (e) {
      clearLoading();
      showToast('Save failed: ' + e.message, true);
    }
  }
  function renderRecurringList() {
    const out = document.getElementById('rec-list');
    if (!out) return;
    if (!allRecurring.length) {
      out.innerHTML = '<p class="search-empty">No recurring yet. Add Netflix, rent, gym etc. above.</p>';
      return;
    }
    out.innerHTML = allRecurring.map(r => {
      const c = (CAT_MAP || {})[r.category] || { icon:'📦', label: r.category, color:'#78909C' };
      const lastRunTxt = r.lastRunYYYYMM ? `Last run ${r.lastRunYYYYMM}` : 'Pending first run';
      return `
        <div class="rec-item">
          <div class="rec-item-icon" style="background:${c.color}22;">${c.icon}</div>
          <div class="rec-item-info">
            <div class="rec-item-label">${safe(r.label)}</div>
            <div class="rec-item-meta">Every month on day ${r.dayOfMonth} · ${c.label} · ${lastRunTxt}</div>
          </div>
          <div class="rec-item-amt">${inrFmt(r.amount)}</div>
          <button class="expense-delete" onclick="deleteRecurring('${r.id}')" title="Remove">✕</button>
        </div>
      `;
    }).join('');
  }
  async function deleteRecurring(id) {
    if (!confirm('Remove this recurring expense?')) return;
    setLoading('Removing…');
    try {
      await ensureToken();
      await deleteRecurringRow(id);
      clearLoading();
      showToast('Removed');
      renderRecurringList();
    } catch (e) {
      clearLoading();
      showToast('Remove failed: ' + e.message, true);
    }
  }

  /* ═══════════════════════════════════════════════════════════
     GOALS UI
     ═══════════════════════════════════════════════════════════ */
  function openGoalsModal() {
    document.getElementById('goal-label').value  = '';
    document.getElementById('goal-target').value = '';
    document.getElementById('goal-deadline').value = '';
    renderGoalList();
    document.getElementById('goals-modal').style.display = 'flex';
  }
  function closeGoalsModal() {
    document.getElementById('goals-modal').style.display = 'none';
  }
  async function saveGoal() {
    const label    = document.getElementById('goal-label').value.trim();
    const target   = parseFloat(document.getElementById('goal-target').value);
    const deadline = document.getElementById('goal-deadline').value;
    if (!label)                  { showToast('Enter a goal name', true); return; }
    if (!target || target <= 0)  { showToast('Enter a target', true); return; }

    const g = { id: uuid(), label, target, saved: 0, deadline, lastCreditedYYYYMM: '' };
    setLoading('Saving goal…');
    try {
      await ensureToken();
      await appendGoalRow(g);
      await loadGoals();
      clearLoading();
      showToast(`🎯 "${label}" added`);
      renderGoalList();
    } catch (e) {
      clearLoading();
      showToast('Save failed: ' + e.message, true);
    }
  }
  function renderGoalList() {
    const out = document.getElementById('goal-list');
    if (!out) return;
    if (!allGoals.length) {
      out.innerHTML = '<p class="search-empty">No goals yet. Add one above.</p>';
      return;
    }
    out.innerHTML = allGoals.map(g => {
      const pct = g.target > 0 ? Math.min(100, Math.round((g.saved / g.target) * 100)) : 0;
      const done = g.saved >= g.target;
      const deadlineTxt = g.deadline ? `By ${fmtDate(g.deadline)}` : 'No deadline';
      return `
        <div class="goal-item ${done ? 'goal-done' : ''}">
          <div class="goal-item-top">
            <div class="goal-item-label">${done ? '🏆 ' : ''}${safe(g.label)}</div>
            <div class="goal-item-amt">${inrFmt(g.saved)} / ${inrFmt(g.target)}</div>
          </div>
          <div class="goal-bar"><div class="goal-bar-fill" style="width:${pct}%;"></div></div>
          <div class="goal-item-meta">
            <span>${pct}% · ${deadlineTxt}</span>
            <span class="goal-item-actions">
              <button class="goal-action" onclick="openGoalDepositModal('${g.id}')">+ Add</button>
              <button class="goal-action goal-del" onclick="deleteGoal('${g.id}')">Remove</button>
            </span>
          </div>
        </div>
      `;
    }).join('');
  }
  async function deleteGoal(id) {
    if (!confirm('Remove this goal? Saved amount will be lost.')) return;
    setLoading('Removing…');
    try {
      await ensureToken();
      await deleteGoalRow(id);
      clearLoading();
      showToast('Removed');
      renderGoalList();
    } catch (e) {
      clearLoading();
      showToast('Remove failed: ' + e.message, true);
    }
  }
  function openGoalDepositModal(id) {
    pendingDepositGoalId = id;
    const g = allGoals.find(x => x.id === id);
    if (!g) return;
    document.getElementById('goal-deposit-title').textContent = `Add to "${g.label}"`;
    document.getElementById('goal-deposit-amount').value = '';
    document.getElementById('goal-deposit-modal').style.display = 'flex';
  }
  function closeGoalDepositModal() {
    pendingDepositGoalId = null;
    document.getElementById('goal-deposit-modal').style.display = 'none';
  }
  async function saveGoalDeposit() {
    if (!pendingDepositGoalId) return;
    const amount = parseFloat(document.getElementById('goal-deposit-amount').value);
    if (!amount || amount <= 0) { showToast('Enter an amount', true); return; }
    const g = allGoals.find(x => x.id === pendingDepositGoalId);
    if (!g) { closeGoalDepositModal(); return; }
    g.saved = (g.saved || 0) + amount;
    setLoading('Updating…');
    try {
      await ensureToken();
      await updateGoalRow(g);
      clearLoading();
      closeGoalDepositModal();
      if (g.saved >= g.target) {
        showToast(`🏆 "${g.label}" complete!`);
        if (typeof burstConfetti === 'function') {
          burstConfetti(document.querySelector(`.goal-item-label`));
        }
      } else {
        showToast(`+${inrFmt(amount)} added`);
      }
      renderGoalList();
    } catch (e) {
      clearLoading();
      showToast('Save failed: ' + e.message, true);
    }
  }

  /* ═══════════════════════════════════════════════════════════
     QUICK-ADD URL HANDLER (F1)
     ═══════════════════════════════════════════════════════════ */
  function handleQuickAddURL() {
    try {
      const params = new URLSearchParams(window.location.search);
      const qa = params.get('quickadd');
      if (!qa) return;
      /* Wait briefly for app to be fully initialized */
      setTimeout(() => {
        if (qa === 'voice') {
          if (typeof startVoice === 'function') startVoice();
        } else {
          if (typeof selectCat === 'function') selectCat(qa);
          const ai = document.getElementById('amount-input');
          if (ai) ai.focus();
        }
        /* Remove the param from URL so refresh doesn't re-trigger */
        if (window.history && window.history.replaceState) {
          const cleaned = window.location.origin + window.location.pathname;
          window.history.replaceState({}, '', cleaned);
        }
      }, 400);
    } catch (_) {}
  }

  /* ═══════════════════════════════════════════════════════════
     PATCH EXISTING FUNCTIONS
     ═══════════════════════════════════════════════════════════ */
  function patchAll() {
    /* ── 1. Patch confirmDelete to capture deleted row + show undo toast ── */
    if (typeof window.confirmDelete === 'function' && !window._origConfirmDelete) {
      window._origConfirmDelete = window.confirmDelete;
      window.confirmDelete = async function () {
        const row = window.pendingDeleteRow;
        const target = (window.allExpenses || []).find(e => e.rowIndex === row);
        const deletedCopy = target ? {
          date: target.date,
          category: target.category,
          amount: target.amount,
          note: target.note,
          createdAt: target.createdAt || new Date().toISOString(),
        } : null;

        await window._origConfirmDelete.apply(this, arguments);
        /* After deletion the toast already shows "Deleted — undo in Google
           Sheets ✓"; replace with our undo-button version for 5 seconds. */
        if (deletedCopy) {
          lastDeletedExpense = deletedCopy;
          showUndoToast(deletedCopy);
        }
      };
    }

    /* ── 2. Patch saveExpense to record AI cat history + clear AI suggest ── */
    if (typeof window.saveExpense === 'function' && !window._origSaveExpense) {
      window._origSaveExpense = window.saveExpense;
      window.saveExpense = async function () {
        const note = document.getElementById('note-input').value.trim();
        const cat  = window.selectedCat;
        await window._origSaveExpense.apply(this, arguments);
        /* selectedCat may have been cleared inside _orig — use captured cat */
        if (note && cat) recordCatHistory(note, cat);
        hideAiSuggest();
      };
    }

    /* ── 3. Patch renderDashboard to also render Today hero, forecast,
                                    sparklines, heatmap ── */
    if (typeof window.renderDashboard === 'function' && !window._origRenderDashboard) {
      window._origRenderDashboard = window.renderDashboard;
      window.renderDashboard = function () {
        window._origRenderDashboard.apply(this, arguments);
        renderTodayHero();
        renderForecast();
        renderSparklines();
        renderHeatmap();
      };
    }

    /* ── 4. Patch enterMainApp to load recurring/goals + apply due + URL param ── */
    if (typeof window.enterMainApp === 'function' && !window._origEnterMainApp) {
      window._origEnterMainApp = window.enterMainApp;
      window.enterMainApp = async function () {
        await window._origEnterMainApp.apply(this, arguments);
        try { await loadRecurring(); }   catch (e) { console.warn('loadRecurring failed:', e.message); }
        try { await applyDueRecurring(); } catch (e) { console.warn('applyDueRecurring failed:', e.message); }
        try { await loadGoals(); }        catch (e) { console.warn('loadGoals failed:', e.message); }
        try { await autoCreditGoals(); }  catch (e) { console.warn('autoCreditGoals failed:', e.message); }
        handleQuickAddURL();
      };
    }

    /* ── 5. Patch handleVoiceResult: when intent is "add expense" AND we have
                BOTH amount and category, auto-save instead of showing confirm.
                User can undo via 5-second toast. ── */
    if (typeof window.handleVoiceResult === 'function' && !window._origHandleVoiceResult) {
      window._origHandleVoiceResult = window.handleVoiceResult;
      window.handleVoiceResult = function (transcript) {
        if (!voiceAutoSave) return window._origHandleVoiceResult.call(this, transcript);
        const intent = (typeof classifyVoiceIntent === 'function') ? classifyVoiceIntent(transcript) : { type: 'add' };
        if (intent.type !== 'add' && intent.type !== undefined && intent.type !== null) {
          /* Budget commands and date queries handled by orig */
          return window._origHandleVoiceResult.call(this, transcript);
        }
        const parsed = (typeof parseVoiceCommand === 'function') ? parseVoiceCommand(transcript) : null;
        if (parsed && parsed.amount && parsed.category) {
          voiceAutoSaveExpense(parsed, transcript);
          return;
        }
        /* Fall back to confirm card */
        return window._origHandleVoiceResult.call(this, transcript);
      };
    }
  }

  async function voiceAutoSaveExpense(parsed, transcript) {
    const exp = {
      date:      parsed.date || todayStr(),
      category:  parsed.category,
      amount:    parsed.amount,
      note:      parsed.note || '',
      createdAt: new Date().toISOString(),
    };
    setLoading('Saving…');
    try {
      await ensureToken();
      await appendExpenseRow(exp);
      await loadExpenses();
      const [ey, em] = exp.date.split('-').map(Number);
      try { await recomputeBudgetForMonth(ey, em); } catch (_) {}
      if (exp.note) recordCatHistory(exp.note, exp.category);
      clearLoading();
      /* Tell user what was saved + show undo */
      const c = (CAT_MAP || {})[exp.category];
      const heard = `🎤 Saved ${inrFmt(exp.amount)} · ${c ? c.label : exp.category}`;
      /* Find the newly appended row to set as undo target */
      const recent = (window.allExpenses || [])
        .filter(e => e.date === exp.date && e.category === exp.category && e.amount === exp.amount)
        .sort((a, b) => b.rowIndex - a.rowIndex)[0];
      if (recent) {
        /* For undo we need the row info — restore by re-appending */
        lastDeletedExpense = {
          date: recent.date, category: recent.category, amount: recent.amount,
          note: recent.note || '', createdAt: recent.createdAt || new Date().toISOString(),
        };
        const toast = document.getElementById('toast');
        toast.innerHTML = `<span>${heard}</span><button class="toast-undo" id="toast-undo-btn">Undo</button>`;
        document.getElementById('toast-undo-btn').onclick = async () => {
          /* Undo = delete the row we just added */
          try {
            await ensureToken();
            await deleteSheetRow(recent.rowIndex);
            await loadExpenses();
            try { await recomputeBudgetForMonth(ey, em); } catch (_) {}
            const t = document.getElementById('toast'); t.classList.remove('show');
            setTimeout(() => { t.innerHTML = ''; t.textContent = ''; }, 300);
            showToast('Undone');
            if (currentView === 'dashboard') renderDashboard();
            if (currentView === 'insights')  renderInsights();
            if (typeof renderTodayTotal === 'function') renderTodayTotal();
          } catch (err) {
            showToast('Undo failed: ' + err.message, true);
          }
        };
        toast.classList.add('show');
        if (undoTimerId) clearTimeout(undoTimerId);
        undoTimerId = setTimeout(() => {
          toast.classList.remove('show');
          setTimeout(() => { toast.innerHTML = ''; toast.textContent = ''; lastDeletedExpense = null; }, 300);
        }, 5000);
      } else {
        showToast(heard);
      }
      if (typeof burstConfetti === 'function') burstConfetti(document.querySelector('.voice-btn'));
      if (currentView === 'dashboard') renderDashboard();
      if (currentView === 'insights')  renderInsights();
      if (typeof renderTodayTotal === 'function') renderTodayTotal();
    } catch (err) {
      clearLoading();
      showToast('Save failed: ' + err.message, true);
    }
  }

  /* ═══════════════════════════════════════════════════════════
     EXPORT TO WINDOW SCOPE (so onclick handlers in HTML can find them)
     ═══════════════════════════════════════════════════════════ */
  Object.assign(window, {
    // tools menu
    openToolsMenu, closeToolsMenu,
    // recurring
    openRecurringModal, closeRecurringModal, saveRecurring, deleteRecurring,
    // goals
    openGoalsModal, closeGoalsModal, saveGoal, deleteGoal,
    openGoalDepositModal, closeGoalDepositModal, saveGoalDeposit,
    // search
    openSearch, closeSearch,
    // AI suggest
    onNoteInput, acceptAiSuggestion, dismissAiSuggestion,
    // forecast / sparklines / heatmap
    renderForecast, renderSparklines, renderHeatmap, setHeatmapMode,
    // what-if
    openWhatIfModal, closeWhatIfModal, resetWhatIf, onWhatIfChange,
    // year-wrap
    openYearWrapModal, closeYearWrapModal, renderYearWrap, exportYearWrapAsPDF,
    // export
    openExportModal, closeExportModal, exportAsCSV, exportAsPDF,
    // undo
    undoLastDelete,
    // for tests
    suggestCategoryFromNote, recordCatHistory, computeForecast,
    AI_KEYWORDS, MERCHANT_HINTS,
    _features_state: () => ({ allRecurring, allGoals, lastDeletedExpense, voiceAutoSave, whatIfCuts, heatmapMode }),
    _features_setVoiceAutoSave: (v) => { voiceAutoSave = !!v; },
  });

  /* Run patches once DOM is ready (after app.js DOMContentLoaded handlers run) */
  whenReady(() => {
    /* Run patch on the next tick so app.js has populated all globals first */
    setTimeout(patchAll, 0);
  });
})();
