/**
 * Shared Playwright test helpers for the Expense Tracker PWA Loans module.
 * Handles: page load, auth mocking, localStorage seeding, navigation.
 */
'use strict';

const path = require('path');

/** Full file:// URL to the PWA entry point */
const APP_FILE = `file://${path.resolve(__dirname, '../../index.html')}`;

/**
 * Boot the app in a Playwright page with all external APIs mocked so tests
 * don't hang waiting for Google auth / jsDelivr / googleapis.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ loans?: object, schedules?: object }} [seed]  Optional localStorage seed
 */
async function loadApp(page, seed = {}) {
  /* ── Block every external network call ────────────────────────────── */
  await page.route('**/*googleapis.com/**', r => r.abort());
  await page.route('**/*accounts.google.com/**', r => r.abort());
  await page.route('**/*gstatic.com/**', r => r.abort());
  await page.route('**/*jsdelivr.net/**', r => r.abort());
  await page.route('**/*cdnjs.cloudflare.com/**', r => r.abort());
  await page.route('**/*fonts.googleapis.com/**', r => r.abort());

  /* ── Inject mocks + seed BEFORE scripts run ───────────────────────── */
  await page.addInitScript((seed) => {
    /* Clear any previous state */
    localStorage.removeItem('expense-tracker.loans.v1');
    localStorage.removeItem('expense-tracker.loan-sch.v1');

    /* Seed provided state */
    if (seed.loans) {
      localStorage.setItem('expense-tracker.loans.v1', JSON.stringify(seed.loans));
    }
    if (seed.schedules) {
      localStorage.setItem('expense-tracker.loan-sch.v1', JSON.stringify(seed.schedules));
    }

    /* Stub gapi so app.js doesn't block on Google auth */
    window.gapi = {
      load(lib, cfg) {
        const cb = typeof cfg === 'function' ? cfg : (cfg && cfg.callback);
        if (cb) setTimeout(cb, 0);
      },
      auth2: {
        getAuthInstance() {
          return {
            isSignedIn: { get: () => false, listen: () => {} },
            signIn: () => Promise.reject(new Error('auth-mocked')),
          };
        },
      },
      client: {
        init: () => Promise.resolve(),
        load: () => Promise.resolve(),
        sheets: {
          spreadsheets: {
            values: {
              get:    () => Promise.resolve({ result: {} }),
              append: () => Promise.resolve({}),
              update: () => Promise.resolve({}),
            },
          },
        },
      },
    };

    /* Prevent Sheets sync from firing (no credentials) */
    window.spreadsheetId = null;
    window.accessToken   = null;
  }, seed);

  await page.goto(APP_FILE, { waitUntil: 'domcontentloaded' });

  /* Wait until loans.js has executed and exposed its functions */
  await page.waitForFunction(
    () => typeof window.calcEmi === 'function' &&
          typeof window.foreclosureCost === 'function' &&
          typeof window.loanCurrentBalance === 'function',
    { timeout: 15_000 }
  );
}

/** Switch to the Loans view via the JS API (bypasses click-timing issues) */
async function goToLoans(page) {
  await page.evaluate(() => {
    if (typeof switchView === 'function') switchView('loans');
  });
  await page.waitForSelector('#loan-sub-overview', { timeout: 5_000 });
}

/** Open the Add Loan modal */
async function openAddModal(page) {
  await page.evaluate(() => openLoanAddModal());
  await page.waitForSelector('#loan-form-modal[style*="flex"]', { timeout: 5_000 });
}

/** Open the Edit Loan modal for a specific loan ID */
async function openEditModal(page, loanId) {
  await page.evaluate((id) => openLoanEditModal(id), loanId);
  await page.waitForSelector('#loan-form-modal[style*="flex"]', { timeout: 5_000 });
}

/** Close the loan form modal */
async function closeModal(page) {
  await page.evaluate(() => closeLoanFormModal());
}

/**
 * Seed loanState directly into the page's live module without reload.
 * Useful for mid-test state manipulation.
 */
async function seedLoanState(page, loans, schedules = {}) {
  await page.evaluate(({ loans, schedules }) => {
    const state = {
      loans,
      monthlySavings: 0,
      targetDate: null,
      closureOrder: loans.map(l => l.id),
    };
    localStorage.setItem('expense-tracker.loans.v1', JSON.stringify(state));
    localStorage.setItem('expense-tracker.loan-sch.v1', JSON.stringify(schedules));
    window.loadLoanState();
    window.loanState = JSON.parse(localStorage.getItem('expense-tracker.loans.v1'));
  }, { loans, schedules });
}

/**
 * Mock parseLoanPDF to return preset rows so PDF upload tests work
 * without real bank PDFs.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ rows: object[], format: string }} mockResult
 */
async function mockPdfParser(page, mockResult) {
  await page.evaluate((result) => {
    window.parseLoanPDF = async () => result;
  }, mockResult);
}

module.exports = {
  APP_FILE,
  loadApp,
  goToLoans,
  openAddModal,
  openEditModal,
  closeModal,
  seedLoanState,
  mockPdfParser,
};
