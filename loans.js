/* ═══════════════════════════════════════════════════════════════════
   LOAN TRACKER MODULE — v26
   Track loans, project monthly outstanding, plan closures, simulate.
   Storage: localStorage (separate from expense Google Sheet, by design).

   Data model (window.loanState):
   {
     loans: [{
       id, name, type, principal, interestRate, tenureMonths,
       startDate (YYYY-MM-DD), emi, status: 'active'|'closed',
       closedDate, closedAmount, color, createdAt, updatedAt
     }],
     monthlySavings: number,           // for closure cascade
     targetDate: 'YYYY-MM-DD' | null,  // debt-free goal
     closureOrder: [loanId, ...]       // user-defined order
   }
   ═══════════════════════════════════════════════════════════════════ */

'use strict';

/* ── State (var so it attaches to window for cross-script reads) ── */
var loanState = null;
var loanActiveSubtab = 'overview'; // overview | projection | closure | simulator
var loanEditingId = null;

const LOAN_STORAGE_KEY = 'expense-tracker.loans.v1';

const LOAN_TYPES = [
  { key: 'personal',     icon: '💼', label: 'Personal Loan' },
  { key: 'home',         icon: '🏠', label: 'Home Loan' },
  { key: 'auto',         icon: '🚗', label: 'Auto Loan' },
  { key: 'credit-card',  icon: '💳', label: 'Credit Card' },
  { key: 'education',    icon: '🎓', label: 'Education Loan' },
  { key: 'business',     icon: '🏢', label: 'Business Loan' },
  { key: 'other',        icon: '📦', label: 'Other' },
];

const LOAN_COLORS = [
  '#FF6B6B', '#FFA726', '#FFCA28', '#66BB6A', '#26C6DA',
  '#42A5F5', '#7C5CFC', '#AB47BC', '#EC407A', '#78909C',
];

/* ═══════════ STORAGE ═══════════ */
function loadLoanState() {
  try {
    const raw = localStorage.getItem(LOAN_STORAGE_KEY);
    if (raw) {
      loanState = JSON.parse(raw);
    } else {
      loanState = { loans: [], monthlySavings: 0, targetDate: null, closureOrder: [] };
    }
    // Ensure all fields exist (forward-compat)
    if (!loanState.loans) loanState.loans = [];
    if (loanState.monthlySavings == null) loanState.monthlySavings = 0;
    if (!loanState.closureOrder) loanState.closureOrder = [];
  } catch (e) {
    console.warn('loadLoanState failed', e);
    loanState = { loans: [], monthlySavings: 0, targetDate: null, closureOrder: [] };
  }
}

function saveLoanState() {
  try {
    localStorage.setItem(LOAN_STORAGE_KEY, JSON.stringify(loanState));
  } catch (e) {
    console.warn('saveLoanState failed', e);
  }
}

/* ═══════════ AMORTIZATION MATH ═══════════ */

/**
 * Calculate EMI from principal, annual rate, tenure (months).
 * Standard amortization formula: EMI = P * r * (1+r)^n / ((1+r)^n - 1)
 */
function calcEmi(principal, annualRate, tenureMonths) {
  if (!principal || !tenureMonths) return 0;
  const r = (annualRate || 0) / 12 / 100;
  if (r === 0) return Math.round(principal / tenureMonths);
  const n = tenureMonths;
  const emi = principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
  return Math.round(emi);
}

/**
 * Outstanding balance after monthsPaid EMI payments.
 * Caps at 0 (loan can't go negative).
 */
function outstandingAfterMonths(principal, annualRate, emi, monthsPaid) {
  if (!principal || monthsPaid <= 0) return Math.max(0, principal);
  const r = (annualRate || 0) / 12 / 100;
  let bal = principal;
  for (let i = 0; i < monthsPaid; i++) {
    const interest = bal * r;
    const principalPaid = emi - interest;
    bal -= principalPaid;
    if (bal <= 0) return 0;
  }
  return Math.round(bal);
}

/**
 * How many EMIs left to reach 0 balance from current point?
 * Uses inverse amortization formula.
 */
function monthsToPayoff(currentBalance, annualRate, emi) {
  if (!currentBalance || currentBalance <= 0) return 0;
  if (!emi || emi <= 0) return Infinity;
  const r = (annualRate || 0) / 12 / 100;
  if (r === 0) return Math.ceil(currentBalance / emi);
  // EMI must exceed monthly interest, else loan never closes
  if (emi <= currentBalance * r) return Infinity;
  const n = Math.log(emi / (emi - currentBalance * r)) / Math.log(1 + r);
  return Math.ceil(n);
}

/**
 * Months elapsed between two YYYY-MM-DD dates. Negative if startDate is future.
 */
function monthsBetween(startDate, endDate) {
  const s = new Date(startDate);
  const e = endDate || new Date();
  const months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
  return Math.max(0, months);
}

/**
 * Current outstanding for a loan = balance after months elapsed since startDate.
 */
function loanCurrentBalance(loan) {
  if (loan.status === 'closed') return 0;
  const monthsPaid = monthsBetween(loan.startDate);
  return outstandingAfterMonths(loan.principal, loan.interestRate, loan.emi, monthsPaid);
}

/**
 * Months remaining until loan closes naturally (without prepayment).
 */
function loanMonthsRemaining(loan) {
  if (loan.status === 'closed') return 0;
  const bal = loanCurrentBalance(loan);
  return monthsToPayoff(bal, loan.interestRate, loan.emi);
}

/**
 * Project outstanding for the next `nMonths` months. Returns array of
 * { monthLabel: 'Apr 2026', monthIdx: 0, balance: 437065, isClosed: false }
 */
function projectLoan(loan, nMonths) {
  const out = [];
  const today = new Date();
  const startBal = loanCurrentBalance(loan);
  for (let i = 0; i < nMonths; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const monthsAhead = i; // 0 = current month
    const bal = outstandingAfterMonths(startBal, loan.interestRate, loan.emi, monthsAhead);
    out.push({
      monthLabel: d.toLocaleString('en-US', { month: 'short', year: 'numeric' }),
      monthKey: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'),
      monthIdx: i,
      balance: bal,
      isClosed: bal === 0,
    });
  }
  return out;
}

/* ═══════════ CLOSURE PLAN (Debt Snowball) ═══════════ */

/**
 * Simulate sequential closure based on user-defined order:
 *  - Each month: user pays all EMIs + saves monthlySavings
 *  - When savings + freed-EMI fund reaches a loan's outstanding, close it
 *  - Freed EMI from closed loan adds to monthly savings pool
 *
 * Returns array of { loanId, name, closureMonth, lumpSum, leftover }
 */
function computeClosurePlan() {
  const active = loanState.loans.filter(l => l.status === 'active');
  if (!active.length) return [];

  // Use closureOrder if defined, else default to smallest-balance-first (snowball)
  let order = (loanState.closureOrder || []).filter(id => active.find(l => l.id === id));
  const missing = active.filter(l => !order.includes(l.id)).map(l => l.id);
  order = [...order, ...missing];
  if (order.length === 0) {
    // Default snowball: smallest current balance first
    order = active
      .slice()
      .sort((a, b) => loanCurrentBalance(a) - loanCurrentBalance(b))
      .map(l => l.id);
  }

  const monthlySavings = loanState.monthlySavings || 0;
  const out = [];
  // Working copy of loan balances
  const balances = {};
  active.forEach(l => { balances[l.id] = loanCurrentBalance(l); });
  let freedEmi = 0;
  let savingsPool = 0;
  const closedSet = new Set();

  // Simulate up to 120 months (10 years) — safety cap
  for (let month = 0; month < 120; month++) {
    // Accrue savings this month
    savingsPool += monthlySavings + freedEmi;

    // Also: balances decrement by 1 month of EMI payment (interest + principal)
    active.forEach(l => {
      if (closedSet.has(l.id)) return;
      const r = (l.interestRate || 0) / 12 / 100;
      const interest = balances[l.id] * r;
      const principalPaid = l.emi - interest;
      balances[l.id] -= principalPaid;
      if (balances[l.id] < 0) balances[l.id] = 0;
    });

    // Try to close loans in order
    let closedThisMonth = true;
    while (closedThisMonth) {
      closedThisMonth = false;
      for (const id of order) {
        if (closedSet.has(id)) continue;
        const loan = active.find(l => l.id === id);
        const bal = balances[id];
        if (savingsPool >= bal && bal > 0) {
          // Close it
          savingsPool -= bal;
          freedEmi += loan.emi;
          closedSet.add(id);
          const d = new Date();
          d.setMonth(d.getMonth() + month);
          out.push({
            loanId: id,
            name: loan.name,
            closureMonth: d.toLocaleString('en-US', { month: 'short', year: 'numeric' }),
            monthOffset: month,
            lumpSum: bal,
            leftover: savingsPool,
          });
          closedThisMonth = true;
          break; // re-check order from start (chain closures)
        }
      }
    }

    if (closedSet.size === active.length) break;
  }

  return out;
}

/* ═══════════ SIMULATOR ═══════════ */

/**
 * Simulate prepaying `amount` to `loanId` right now. Returns:
 *  - monthsSaved (vs no prepayment)
 *  - interestSaved (vs no prepayment, approx)
 *  - newClosureMonth
 */
function simulatePrepayment(loanId, amount) {
  const loan = loanState.loans.find(l => l.id === loanId);
  if (!loan || amount <= 0) return null;

  const currentBal = loanCurrentBalance(loan);
  const newBal = Math.max(0, currentBal - amount);

  const oldMonthsLeft = monthsToPayoff(currentBal, loan.interestRate, loan.emi);
  const newMonthsLeft = monthsToPayoff(newBal, loan.interestRate, loan.emi);

  const oldTotalPayout = oldMonthsLeft * loan.emi;
  const newTotalPayout = amount + newMonthsLeft * loan.emi;
  const interestSaved = oldTotalPayout - newTotalPayout;

  const monthsSaved = oldMonthsLeft - newMonthsLeft;
  const d = new Date();
  d.setMonth(d.getMonth() + newMonthsLeft);
  const newClosureMonth = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });

  return {
    loanName: loan.name,
    currentBalance: currentBal,
    newBalance: newBal,
    oldMonthsLeft,
    newMonthsLeft,
    monthsSaved,
    interestSaved: Math.round(interestSaved),
    newClosureMonth,
  };
}

/* ═══════════ FORMATTERS ═══════════ */
function fmtINR(n) {
  if (n == null || isNaN(n)) return '₹0';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

function fmtINRShort(n) {
  if (n == null || isNaN(n)) return '₹0';
  const abs = Math.abs(n);
  if (abs >= 10000000) return '₹' + (n / 10000000).toFixed(2) + 'Cr';
  if (abs >= 100000)   return '₹' + (n / 100000).toFixed(2) + 'L';
  if (abs >= 1000)     return '₹' + (n / 1000).toFixed(1) + 'K';
  return '₹' + Math.round(n);
}

function loanTypeMeta(typeKey) {
  return LOAN_TYPES.find(t => t.key === typeKey) || LOAN_TYPES[LOAN_TYPES.length - 1];
}

/* ═══════════ RENDERING ═══════════ */
function renderLoans() {
  if (!loanState) loadLoanState();
  renderLoanHero();
  renderLoanSubtab();
}

function renderLoanHero() {
  const active = loanState.loans.filter(l => l.status === 'active');
  const totalOutstanding = active.reduce((s, l) => s + loanCurrentBalance(l), 0);
  const totalEmi = active.reduce((s, l) => s + l.emi, 0);
  const totalPrincipal = active.reduce((s, l) => s + l.principal, 0);
  const paidDown = totalPrincipal - totalOutstanding;
  const paidPct = totalPrincipal > 0 ? Math.round((paidDown / totalPrincipal) * 100) : 0;

  // Compute debt-free month from closure plan
  let debtFreeLabel = '—';
  let monthsLeft = 0;
  if (active.length === 0) {
    debtFreeLabel = '🎉 No active loans';
  } else {
    const plan = computeClosurePlan();
    if (plan.length === active.length) {
      const last = plan[plan.length - 1];
      debtFreeLabel = last.closureMonth;
      monthsLeft = last.monthOffset + 1;
    } else {
      // Fall back: use max naturally
      monthsLeft = Math.max(...active.map(loanMonthsRemaining).filter(n => n !== Infinity));
      const d = new Date();
      d.setMonth(d.getMonth() + monthsLeft);
      debtFreeLabel = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
    }
  }

  const heroEl = document.getElementById('loan-hero');
  if (!heroEl) return;
  heroEl.innerHTML = active.length === 0 ? `
    <div class="loan-hero-empty">
      <div class="loan-hero-empty-icon">🎯</div>
      <div class="loan-hero-empty-title">No active loans</div>
      <div class="loan-hero-empty-sub">Add a loan below to track outstanding balance, plan closures, and simulate prepayments.</div>
    </div>
  ` : `
    <div class="loan-hero-title">Total outstanding</div>
    <div class="loan-hero-amount">${fmtINRShort(totalOutstanding)}</div>
    <div class="loan-hero-meta">${active.length} active · EMI ${fmtINRShort(totalEmi)}/mo</div>
    <div class="loan-hero-progress">
      <div class="loan-hero-progress-bar"><div class="loan-hero-progress-fill" style="width:${paidPct}%"></div></div>
      <div class="loan-hero-progress-meta">${paidPct}% paid down · Debt-free by <strong>${debtFreeLabel}</strong> (${monthsLeft} mo)</div>
    </div>
  `;
}

function renderLoanSubtab() {
  // Highlight active subtab pill
  document.querySelectorAll('.loan-subtab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.subtab === loanActiveSubtab);
  });
  // Hide all panels, show active one
  document.querySelectorAll('.loan-subpanel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('loan-sub-' + loanActiveSubtab);
  if (panel) panel.classList.add('active');

  if (loanActiveSubtab === 'overview')   renderLoanOverview();
  if (loanActiveSubtab === 'projection') renderLoanProjection();
  if (loanActiveSubtab === 'closure')    renderLoanClosure();
  if (loanActiveSubtab === 'simulator')  renderLoanSimulator();
}

function setLoanSubtab(sub) {
  loanActiveSubtab = sub;
  renderLoanSubtab();
}

/* ── Overview: list of loan cards ────────────────────────────── */
function renderLoanOverview() {
  const el = document.getElementById('loan-cards-list');
  if (!el) return;
  const active = loanState.loans.filter(l => l.status === 'active');
  const closed = loanState.loans.filter(l => l.status === 'closed');

  if (loanState.loans.length === 0) {
    el.innerHTML = `
      <div class="loan-empty">
        <p>No loans yet. Tap <strong>+ Add Loan</strong> to start tracking.</p>
      </div>
    `;
    return;
  }

  let html = '';
  if (active.length > 0) {
    html += '<p class="loan-section-label">Active loans</p>';
    active.forEach(l => { html += renderLoanCard(l); });
  }
  if (closed.length > 0) {
    html += '<p class="loan-section-label loan-section-label-closed">Closed loans 🎉</p>';
    closed.forEach(l => { html += renderLoanCard(l); });
  }
  el.innerHTML = html;
}

function renderLoanCard(loan) {
  const t = loanTypeMeta(loan.type);
  const bal = loan.status === 'closed' ? 0 : loanCurrentBalance(loan);
  const monthsLeft = loan.status === 'closed' ? 0 : loanMonthsRemaining(loan);
  const isClosed = loan.status === 'closed';
  const totalEmiPaid = loan.emi * monthsBetween(loan.startDate);
  const paidDown = loan.principal - bal;
  const paidPct = loan.principal > 0 ? Math.min(100, Math.round((paidDown / loan.principal) * 100)) : 0;

  return `
    <div class="loan-card ${isClosed ? 'loan-card-closed' : ''}" onclick="openLoanEditModal('${loan.id}')">
      <div class="loan-card-head">
        <span class="loan-card-icon" style="background:${loan.color}20; color:${loan.color}">${t.icon}</span>
        <div class="loan-card-info">
          <div class="loan-card-name">${loan.name}</div>
          <div class="loan-card-sub">${t.label} · ${loan.interestRate}% · ${loan.tenureMonths} mo</div>
        </div>
        ${isClosed ? '<span class="loan-card-badge-closed">CLOSED</span>' : ''}
      </div>
      <div class="loan-card-amount-row">
        <div>
          <div class="loan-card-amount">${fmtINRShort(bal)}</div>
          <div class="loan-card-amount-lbl">${isClosed ? 'cleared' : 'outstanding'}</div>
        </div>
        <div class="loan-card-emi">
          <div class="loan-card-emi-val">${fmtINRShort(loan.emi)}</div>
          <div class="loan-card-emi-lbl">EMI/mo</div>
        </div>
        <div class="loan-card-tenure">
          <div class="loan-card-tenure-val">${isClosed ? '—' : (monthsLeft === Infinity ? '∞' : monthsLeft + ' mo')}</div>
          <div class="loan-card-tenure-lbl">${isClosed ? 'closed' : 'left'}</div>
        </div>
      </div>
      ${!isClosed ? `
        <div class="loan-card-progress">
          <div class="loan-card-progress-bar"><div class="loan-card-progress-fill" style="width:${paidPct}%; background:${loan.color}"></div></div>
          <div class="loan-card-progress-meta">${paidPct}% paid · ${fmtINRShort(paidDown)} of ${fmtINRShort(loan.principal)}</div>
        </div>
      ` : `
        <div class="loan-card-closed-meta">Closed ${loan.closedDate || ''} · Lump sum ${fmtINRShort(loan.closedAmount || 0)}</div>
      `}
    </div>
  `;
}

/* ── Projection: month-by-month table ────────────────────────── */
function renderLoanProjection() {
  const el = document.getElementById('loan-projection-table');
  if (!el) return;
  const active = loanState.loans.filter(l => l.status === 'active');
  if (active.length === 0) {
    el.innerHTML = '<div class="loan-empty"><p>No active loans to project.</p></div>';
    return;
  }

  const N_MONTHS = 12;
  const projections = active.map(l => ({ loan: l, rows: projectLoan(l, N_MONTHS) }));

  // Build table HTML
  let html = '<div class="loan-projection-wrap"><table class="loan-projection-tbl">';
  // Header row
  html += '<thead><tr><th class="sticky-col">Bank</th>';
  for (let i = 0; i < N_MONTHS; i++) {
    html += `<th>${projections[0].rows[i].monthLabel}</th>`;
  }
  html += '</tr></thead><tbody>';

  // One row per loan
  projections.forEach(({ loan, rows }) => {
    html += `<tr><td class="sticky-col"><span class="proj-bank" style="color:${loan.color}">●</span> ${loan.name}</td>`;
    rows.forEach(r => {
      const cls = r.isClosed ? 'proj-cell proj-closed' : 'proj-cell';
      html += `<td class="${cls}">${r.balance === 0 ? '✓' : fmtINRShort(r.balance)}</td>`;
    });
    html += '</tr>';
  });

  // Totals row
  html += '<tr class="proj-total-row"><td class="sticky-col"><strong>TOTAL</strong></td>';
  for (let i = 0; i < N_MONTHS; i++) {
    const total = projections.reduce((s, p) => s + p.rows[i].balance, 0);
    html += `<td><strong>${fmtINRShort(total)}</strong></td>`;
  }
  html += '</tr>';

  html += '</tbody></table></div>';
  el.innerHTML = html;
}

/* ── Closure Plan: cascade timeline ──────────────────────────── */
function renderLoanClosure() {
  const el = document.getElementById('loan-closure-content');
  if (!el) return;
  const active = loanState.loans.filter(l => l.status === 'active');
  if (active.length === 0) {
    el.innerHTML = '<div class="loan-empty"><p>No active loans for closure planning.</p></div>';
    return;
  }

  const plan = computeClosurePlan();

  let html = `
    <div class="loan-closure-input-card">
      <div class="loan-closure-input-row">
        <label class="loan-closure-input-lbl">Monthly savings available
          <span class="loan-closure-input-hint">cash you save each month after EMIs</span>
        </label>
        <div class="loan-closure-input-wrap">
          <span class="loan-closure-input-prefix">₹</span>
          <input type="number" id="loan-monthly-savings" class="loan-closure-input"
                 value="${loanState.monthlySavings || ''}"
                 placeholder="50000"
                 onchange="updateMonthlySavings(this.value)" />
        </div>
      </div>
    </div>
  `;

  if (loanState.monthlySavings === 0) {
    html += `
      <div class="loan-closure-empty">
        <p>👆 Enter your monthly savings to see the closure plan.</p>
        <p class="muted">We'll cascade savings + freed EMIs to project when each loan closes.</p>
      </div>
    `;
  } else if (plan.length === 0) {
    html += `
      <div class="loan-closure-empty">
        <p>⚠️ Your monthly savings (${fmtINRShort(loanState.monthlySavings)}) aren't enough to close any loan within 10 years.</p>
        <p class="muted">Either increase savings, or wait — loans will close naturally via EMIs.</p>
      </div>
    `;
  } else {
    html += '<p class="loan-section-label">Closure timeline (drag to reorder)</p>';
    html += '<div class="loan-closure-timeline">';
    plan.forEach((step, i) => {
      const loan = loanState.loans.find(l => l.id === step.loanId);
      const t = loanTypeMeta(loan.type);
      html += `
        <div class="loan-closure-step" data-loan-id="${step.loanId}">
          <div class="loan-closure-step-num">${i + 1}</div>
          <div class="loan-closure-step-body">
            <div class="loan-closure-step-head">
              <span class="loan-closure-step-icon" style="background:${loan.color}20; color:${loan.color}">${t.icon}</span>
              <span class="loan-closure-step-name">${loan.name}</span>
              <span class="loan-closure-step-when">${step.closureMonth}</span>
            </div>
            <div class="loan-closure-step-meta">
              Lump sum needed: <strong>${fmtINRShort(step.lumpSum)}</strong>
              · Leftover savings: <strong>${fmtINRShort(step.leftover)}</strong>
              · Frees EMI: <strong>${fmtINRShort(loan.emi)}/mo</strong>
            </div>
            <div class="loan-closure-step-actions">
              ${i > 0 ? `<button class="loan-closure-mv-btn" onclick="moveLoanInOrder('${step.loanId}', -1)">↑ Earlier</button>` : ''}
              ${i < plan.length - 1 ? `<button class="loan-closure-mv-btn" onclick="moveLoanInOrder('${step.loanId}', 1)">↓ Later</button>` : ''}
              <button class="loan-closure-close-btn" onclick="markLoanClosed('${step.loanId}', ${step.lumpSum})">✓ Mark as closed</button>
            </div>
          </div>
        </div>
      `;
    });
    html += '</div>';

    // Final summary
    const lastStep = plan[plan.length - 1];
    html += `
      <div class="loan-closure-summary">
        <div class="loan-closure-summary-icon">🎉</div>
        <div class="loan-closure-summary-body">
          <div class="loan-closure-summary-title">Debt-free by ${lastStep.closureMonth}</div>
          <div class="loan-closure-summary-sub">${lastStep.monthOffset + 1} months from today · ${fmtINRShort(lastStep.leftover)} left in savings</div>
        </div>
      </div>
    `;
  }

  el.innerHTML = html;
}

function updateMonthlySavings(value) {
  loanState.monthlySavings = Math.max(0, parseInt(value, 10) || 0);
  saveLoanState();
  renderLoans();
}

function moveLoanInOrder(loanId, delta) {
  const active = loanState.loans.filter(l => l.status === 'active');
  // Materialize current order (closurePlan order) into closureOrder
  const plan = computeClosurePlan();
  let order = plan.map(p => p.loanId);
  if (order.length === 0) order = active.map(l => l.id);

  const idx = order.indexOf(loanId);
  if (idx < 0) return;
  const newIdx = idx + delta;
  if (newIdx < 0 || newIdx >= order.length) return;
  [order[idx], order[newIdx]] = [order[newIdx], order[idx]];
  loanState.closureOrder = order;
  saveLoanState();
  renderLoans();
}

/* ── Simulator: what-if prepayment ──────────────────────────── */
function renderLoanSimulator() {
  const el = document.getElementById('loan-simulator-content');
  if (!el) return;
  const active = loanState.loans.filter(l => l.status === 'active');
  if (active.length === 0) {
    el.innerHTML = '<div class="loan-empty"><p>Add active loans to run simulations.</p></div>';
    return;
  }

  el.innerHTML = `
    <div class="loan-sim-card">
      <p class="loan-sim-title">What if I prepay extra this month?</p>
      <p class="loan-sim-sub">See months & interest saved vs no prepayment.</p>

      <label class="loan-sim-lbl">Extra amount</label>
      <div class="loan-closure-input-wrap">
        <span class="loan-closure-input-prefix">₹</span>
        <input type="number" id="loan-sim-amount" class="loan-closure-input"
               placeholder="50000" oninput="runLoanSim()" />
      </div>

      <label class="loan-sim-lbl">Apply to</label>
      <select id="loan-sim-target" class="loan-sim-select" onchange="runLoanSim()">
        ${active.map(l => `<option value="${l.id}">${l.name} (₹${Math.round(loanCurrentBalance(l)).toLocaleString('en-IN')})</option>`).join('')}
      </select>

      <div class="loan-sim-quick-row">
        <span class="loan-sim-quick-lbl">Quick amounts:</span>
        ${[10000, 25000, 50000, 100000].map(amt => `
          <button class="loan-sim-quick-btn" onclick="document.getElementById('loan-sim-amount').value=${amt}; runLoanSim();">${fmtINRShort(amt)}</button>
        `).join('')}
      </div>

      <div id="loan-sim-result" class="loan-sim-result"></div>

      <p class="loan-section-label" style="margin-top:24px;">Compare across all loans</p>
      <div id="loan-sim-compare" class="loan-sim-compare"></div>
    </div>
  `;
}

function runLoanSim() {
  const amtEl = document.getElementById('loan-sim-amount');
  const tgtEl = document.getElementById('loan-sim-target');
  if (!amtEl || !tgtEl) return;
  const amt = parseInt(amtEl.value, 10) || 0;
  const loanId = tgtEl.value;

  const result = simulatePrepayment(loanId, amt);
  const resultEl = document.getElementById('loan-sim-result');

  if (!result || amt <= 0) {
    resultEl.innerHTML = '';
  } else {
    resultEl.innerHTML = `
      <div class="loan-sim-result-card">
        <div class="loan-sim-result-row"><span>New balance</span><strong>${fmtINR(result.newBalance)}</strong></div>
        <div class="loan-sim-result-row"><span>Months left now</span><strong>${result.newMonthsLeft} mo</strong></div>
        <div class="loan-sim-result-row loan-sim-saved"><span>You save</span><strong>${result.monthsSaved} months</strong></div>
        <div class="loan-sim-result-row loan-sim-saved"><span>Interest saved</span><strong>${fmtINR(result.interestSaved)}</strong></div>
        <div class="loan-sim-result-row"><span>New closure</span><strong>${result.newClosureMonth}</strong></div>
      </div>
    `;
  }

  // Compare same amount across all loans
  const compareEl = document.getElementById('loan-sim-compare');
  if (compareEl && amt > 0) {
    const active = loanState.loans.filter(l => l.status === 'active');
    const sims = active.map(l => ({ loan: l, sim: simulatePrepayment(l.id, amt) }));
    // Sort by interest saved descending
    sims.sort((a, b) => (b.sim?.interestSaved || 0) - (a.sim?.interestSaved || 0));
    compareEl.innerHTML = sims.map(({ loan, sim }, i) => {
      if (!sim) return '';
      const isBest = i === 0;
      return `
        <div class="loan-sim-compare-row ${isBest ? 'loan-sim-best' : ''}">
          ${isBest ? '<span class="loan-sim-best-badge">🏆 BEST</span>' : ''}
          <div class="loan-sim-compare-name"><span style="color:${loan.color}">●</span> ${loan.name}</div>
          <div class="loan-sim-compare-stats">
            <span>${sim.monthsSaved} mo saved</span>
            <span>${fmtINR(sim.interestSaved)} interest saved</span>
          </div>
        </div>
      `;
    }).join('');
  } else if (compareEl) {
    compareEl.innerHTML = '';
  }
}

/* ═══════════ ADD / EDIT MODAL ═══════════ */
function openLoanAddModal() {
  loanEditingId = null;
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('loan-modal-title').textContent = 'Add Loan';
  document.getElementById('loan-form-name').value = '';
  document.getElementById('loan-form-type').value = 'personal';
  document.getElementById('loan-form-principal').value = '';
  document.getElementById('loan-form-rate').value = '';
  document.getElementById('loan-form-tenure').value = '';
  document.getElementById('loan-form-startdate').value = today;
  document.getElementById('loan-form-emi').value = '';
  document.getElementById('loan-form-emi-hint').textContent = '';
  document.getElementById('loan-form-delete').style.display = 'none';
  renderLoanColorPicker(LOAN_COLORS[Math.floor(Math.random() * LOAN_COLORS.length)]);
  document.getElementById('loan-form-modal').style.display = 'flex';
}

function openLoanEditModal(loanId) {
  const loan = loanState.loans.find(l => l.id === loanId);
  if (!loan) return;
  loanEditingId = loanId;
  document.getElementById('loan-modal-title').textContent = 'Edit Loan';
  document.getElementById('loan-form-name').value = loan.name;
  document.getElementById('loan-form-type').value = loan.type;
  document.getElementById('loan-form-principal').value = loan.principal;
  document.getElementById('loan-form-rate').value = loan.interestRate;
  document.getElementById('loan-form-tenure').value = loan.tenureMonths;
  document.getElementById('loan-form-startdate').value = loan.startDate;
  document.getElementById('loan-form-emi').value = loan.emi;
  document.getElementById('loan-form-emi-hint').textContent = '';
  document.getElementById('loan-form-delete').style.display = 'inline-block';
  renderLoanColorPicker(loan.color);
  document.getElementById('loan-form-modal').style.display = 'flex';
}

function closeLoanFormModal() {
  document.getElementById('loan-form-modal').style.display = 'none';
}

function renderLoanColorPicker(selectedColor) {
  const wrap = document.getElementById('loan-form-colors');
  if (!wrap) return;
  wrap.dataset.color = selectedColor;
  wrap.innerHTML = LOAN_COLORS.map(c => `
    <span class="loan-color-swatch ${c === selectedColor ? 'selected' : ''}"
          style="background:${c}"
          onclick="pickLoanColor('${c}')"></span>
  `).join('');
}

function pickLoanColor(c) {
  document.getElementById('loan-form-colors').dataset.color = c;
  renderLoanColorPicker(c);
}

/** Live EMI estimate as user types principal / rate / tenure */
function recalcEmiHint() {
  const p = parseInt(document.getElementById('loan-form-principal').value, 10) || 0;
  const r = parseFloat(document.getElementById('loan-form-rate').value) || 0;
  const t = parseInt(document.getElementById('loan-form-tenure').value, 10) || 0;
  const hintEl = document.getElementById('loan-form-emi-hint');
  if (p && t) {
    const emi = calcEmi(p, r, t);
    hintEl.textContent = `Calculated EMI: ${fmtINR(emi)}/mo (tap to use)`;
    hintEl.onclick = () => { document.getElementById('loan-form-emi').value = emi; hintEl.textContent = ''; };
    hintEl.style.cursor = 'pointer';
  } else {
    hintEl.textContent = '';
  }
}

function saveLoanForm() {
  const name = document.getElementById('loan-form-name').value.trim();
  const type = document.getElementById('loan-form-type').value;
  const principal = parseInt(document.getElementById('loan-form-principal').value, 10) || 0;
  const rate = parseFloat(document.getElementById('loan-form-rate').value) || 0;
  const tenure = parseInt(document.getElementById('loan-form-tenure').value, 10) || 0;
  const startDate = document.getElementById('loan-form-startdate').value;
  let emi = parseInt(document.getElementById('loan-form-emi').value, 10) || 0;
  const color = document.getElementById('loan-form-colors').dataset.color;

  if (!name) { window.toast?.('Enter a loan name', 'error'); return; }
  if (!principal || principal <= 0) { window.toast?.('Enter principal amount', 'error'); return; }
  if (!tenure || tenure <= 0) { window.toast?.('Enter tenure (months)', 'error'); return; }
  if (!startDate) { window.toast?.('Pick a start date', 'error'); return; }
  // Auto-calc EMI if user didn't enter one
  if (!emi) emi = calcEmi(principal, rate, tenure);

  const now = Date.now();
  if (loanEditingId) {
    const loan = loanState.loans.find(l => l.id === loanEditingId);
    if (loan) {
      loan.name = name;
      loan.type = type;
      loan.principal = principal;
      loan.interestRate = rate;
      loan.tenureMonths = tenure;
      loan.startDate = startDate;
      loan.emi = emi;
      loan.color = color;
      loan.updatedAt = now;
    }
  } else {
    loanState.loans.push({
      id: 'loan-' + now + '-' + Math.floor(Math.random() * 1000),
      name, type, principal, interestRate: rate, tenureMonths: tenure,
      startDate, emi, color,
      status: 'active', closedDate: null, closedAmount: null,
      createdAt: now, updatedAt: now,
    });
  }
  saveLoanState();
  closeLoanFormModal();
  renderLoans();
  window.toast?.(loanEditingId ? '✓ Loan updated' : '✓ Loan added');
}

function deleteLoanForm() {
  if (!loanEditingId) return;
  if (!confirm('Delete this loan? This cannot be undone.')) return;
  loanState.loans = loanState.loans.filter(l => l.id !== loanEditingId);
  loanState.closureOrder = (loanState.closureOrder || []).filter(id => id !== loanEditingId);
  saveLoanState();
  closeLoanFormModal();
  renderLoans();
  window.toast?.('✓ Loan deleted');
}

function markLoanClosed(loanId, lumpSum) {
  const loan = loanState.loans.find(l => l.id === loanId);
  if (!loan) return;
  if (!confirm(`Mark "${loan.name}" as closed? Lump sum: ${fmtINR(lumpSum)}`)) return;
  loan.status = 'closed';
  loan.closedDate = new Date().toISOString().slice(0, 10);
  loan.closedAmount = lumpSum;
  loan.updatedAt = Date.now();
  saveLoanState();
  renderLoans();
  window.toast?.('🎉 Loan closed!');
}

/* ═══════════ EXPOSE ═══════════ */
window.loanState = loanState;
window.loadLoanState = loadLoanState;
window.saveLoanState = saveLoanState;
window.renderLoans = renderLoans;
window.setLoanSubtab = setLoanSubtab;
window.openLoanAddModal = openLoanAddModal;
window.openLoanEditModal = openLoanEditModal;
window.closeLoanFormModal = closeLoanFormModal;
window.recalcEmiHint = recalcEmiHint;
window.saveLoanForm = saveLoanForm;
window.deleteLoanForm = deleteLoanForm;
window.pickLoanColor = pickLoanColor;
window.updateMonthlySavings = updateMonthlySavings;
window.moveLoanInOrder = moveLoanInOrder;
window.markLoanClosed = markLoanClosed;
window.runLoanSim = runLoanSim;
// Expose helpers in case other modules need them
window.calcEmi = calcEmi;
window.loanCurrentBalance = loanCurrentBalance;

/* Initialize on load */
loadLoanState();
