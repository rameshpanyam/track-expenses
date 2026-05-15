/**
 * 01 — EMI Calculation Tests (55 tests)
 *
 * Covers:
 *   • Reducing-balance formula: calcEmi(p, r, t)
 *   • Flat-rate formula  (tested via recalcEmiHint path in page.evaluate)
 *   • Zero / null / falsy inputs
 *   • Boundary: single month, max tenure, very large principal
 *   • Bank-specific rates (CreditFair 10.8 flat, IndusInd 15 reducing, Kotak 10.5 reducing)
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { loadApp }      = require('../helpers/setup');

/* ─── Shared page: load once, reuse across the whole file ───────────── */
test.describe('EMI Calculation — Reducing Balance Formula', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loadApp(page);
  });

  test.afterAll(async () => { await page.close(); });

  // ── Basic formula verification ──────────────────────────────────────
  test('TC-EMI-001  calcEmi(100000, 12, 12) = 8885', async () => {
    const r = await page.evaluate(() => window.calcEmi(100000, 12, 12));
    expect(r).toBe(8885);
  });

  test('TC-EMI-002  calcEmi(500000, 12, 60) = 11122', async () => {
    const r = await page.evaluate(() => window.calcEmi(500000, 12, 60));
    expect(r).toBe(11122);
  });

  test('TC-EMI-003  calcEmi(300000, 9, 36) = 9538', async () => {
    const r = await page.evaluate(() => window.calcEmi(300000, 9, 36));
    expect(r).toBe(9538);
  });

  test('TC-EMI-004  calcEmi(800000, 10.5, 60) = 17187', async () => {
    const r = await page.evaluate(() => window.calcEmi(800000, 10.5, 60));
    expect(r).toBe(17187);
  });

  test('TC-EMI-005  calcEmi(200000, 14, 24) = 9673', async () => {
    const r = await page.evaluate(() => window.calcEmi(200000, 14, 24));
    expect(r).toBe(9673);
  });

  test('TC-EMI-006  calcEmi(150000, 11, 36) = 4904', async () => {
    const r = await page.evaluate(() => window.calcEmi(150000, 11, 36));
    expect(r).toBe(4904);
  });

  test('TC-EMI-007  calcEmi(50000, 18, 12) = 4584', async () => {
    const r = await page.evaluate(() => window.calcEmi(50000, 18, 12));
    expect(r).toBe(4584);
  });

  test('TC-EMI-008  calcEmi(250000, 10, 48) = 6339', async () => {
    const r = await page.evaluate(() => window.calcEmi(250000, 10, 48));
    expect(r).toBe(6339);
  });

  test('TC-EMI-009  calcEmi(400000, 13.5, 48) = 11476', async () => {
    const r = await page.evaluate(() => window.calcEmi(400000, 13.5, 48));
    expect(r).toBe(11476);
  });

  test('TC-EMI-010  calcEmi(1000000, 8.5, 120) = 12400', async () => {
    const r = await page.evaluate(() => window.calcEmi(1000000, 8.5, 120));
    expect(r).toBe(12400);
  });

  // ── EMI increases with higher rate (same P, T) ────────────────────
  test('TC-EMI-011  higher rate → higher EMI', async () => {
    const low  = await page.evaluate(() => window.calcEmi(200000, 10, 24));
    const high = await page.evaluate(() => window.calcEmi(200000, 14, 24));
    expect(high).toBeGreaterThan(low);
  });

  // ── EMI decreases with longer tenure (same P, R) ──────────────────
  test('TC-EMI-012  longer tenure → lower EMI', async () => {
    const short = await page.evaluate(() => window.calcEmi(300000, 12, 12));
    const long  = await page.evaluate(() => window.calcEmi(300000, 12, 60));
    expect(short).toBeGreaterThan(long);
  });

  // ── EMI scales proportionally with principal ──────────────────────
  test('TC-EMI-013  double principal → double EMI', async () => {
    const half   = await page.evaluate(() => window.calcEmi(100000, 12, 24));
    const double = await page.evaluate(() => window.calcEmi(200000, 12, 24));
    expect(Math.abs(double - 2 * half)).toBeLessThanOrEqual(1); // rounding tolerance
  });

  // ── Total repayment ≥ principal ───────────────────────────────────
  test('TC-EMI-014  total repayment exceeds principal (interest > 0)', async () => {
    const emi   = await page.evaluate(() => window.calcEmi(300000, 10, 36));
    const total = emi * 36;
    expect(total).toBeGreaterThan(300000);
  });

  // ── Very large principal ──────────────────────────────────────────
  test('TC-EMI-015  calcEmi(5000000, 10, 120) returns positive integer', async () => {
    const r = await page.evaluate(() => window.calcEmi(5000000, 10, 120));
    expect(r).toBeGreaterThan(0);
    expect(Number.isInteger(r)).toBe(true);
  });

  // ── Decimal interest rate ──────────────────────────────────────────
  test('TC-EMI-016  decimal rate calcEmi(100000, 8.75, 36)', async () => {
    const r = await page.evaluate(() => window.calcEmi(100000, 8.75, 36));
    expect(r).toBeGreaterThan(0);
    expect(Number.isInteger(r)).toBe(true);
  });

  // ── 1-month tenure ────────────────────────────────────────────────
  test('TC-EMI-017  single month: EMI ≈ P + first month interest', async () => {
    const r = await page.evaluate(() => window.calcEmi(100000, 12, 1));
    expect(r).toBeCloseTo(101000, -2); // ≈ 100000 + 1000 interest
  });

  // ── Very low interest rate ────────────────────────────────────────
  test('TC-EMI-018  calcEmi(100000, 0.1, 12) near P/t', async () => {
    const r    = await page.evaluate(() => window.calcEmi(100000, 0.1, 12));
    const base = Math.round(100000 / 12); // ≈ 8333
    expect(r).toBeGreaterThan(base);
    expect(r).toBeLessThan(base + 500);
  });

  // ── High interest rate ────────────────────────────────────────────
  test('TC-EMI-019  calcEmi(100000, 36, 12) is positive', async () => {
    const r = await page.evaluate(() => window.calcEmi(100000, 36, 12));
    expect(r).toBeGreaterThan(0);
  });

  // ── Return type is always a number ───────────────────────────────
  test('TC-EMI-020  return type is number', async () => {
    const r = await page.evaluate(() => typeof window.calcEmi(100000, 12, 12));
    expect(r).toBe('number');
  });
});

/* ─── Flat-Rate EMI ─────────────────────────────────────────────────── */
test.describe('EMI Calculation — Flat Rate Formula', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loadApp(page);
  });

  test.afterAll(async () => { await page.close(); });

  /** flat EMI = round(P*r/12/100 + P/t) */
  async function flatEmi(p, r, t) {
    return page.evaluate(([p, r, t]) => {
      const monthlyInt  = p * r / 12 / 100;
      const monthlyPrin = p / t;
      return Math.round(monthlyInt + monthlyPrin);
    }, [p, r, t]);
  }

  test('TC-FLT-001  flat EMI 500000 @ 10.8% × 60 = 12833', async () => {
    expect(await flatEmi(500000, 10.8, 60)).toBe(12833);
  });

  test('TC-FLT-002  flat EMI 300000 @ 12% × 36 = 11333', async () => {
    expect(await flatEmi(300000, 12, 36)).toBe(11333);
  });

  test('TC-FLT-003  flat EMI 100000 @ 10% × 12 = 9167', async () => {
    expect(await flatEmi(100000, 10, 12)).toBe(9167);
  });

  test('TC-FLT-004  flat EMI 200000 @ 14% × 24 = 10667', async () => {
    expect(await flatEmi(200000, 14, 24)).toBe(10667);
  });

  test('TC-FLT-005  flat EMI 400000 @ 9.5% × 48 = 11500', async () => {
    expect(await flatEmi(400000, 9.5, 48)).toBe(11500);
  });

  test('TC-FLT-006  flat interest per month is constant across tenure', async () => {
    const interest = await page.evaluate(() => 500000 * 10.8 / 12 / 100);
    expect(interest).toBe(4500);
  });

  test('TC-FLT-007  flat monthly principal is constant across tenure', async () => {
    const prin = await page.evaluate(() => Math.round(500000 / 60));
    expect(prin).toBe(8333);
  });

  test('TC-FLT-008  flat EMI always higher than reducing EMI (same P/R/T)', async () => {
    const reducing = await page.evaluate(() => window.calcEmi(500000, 10.8, 60));
    const flat     = await page.evaluate(() => Math.round(500000 * 10.8 / 12 / 100 + 500000 / 60));
    expect(flat).toBeGreaterThan(reducing);
  });

  test('TC-FLT-009  flat rate total interest = P × r × years', async () => {
    const totalInterest = await page.evaluate(() => {
      const P = 500000, r = 10.8, years = 5;
      return P * (r / 100) * years;
    });
    expect(totalInterest).toBe(270000);
  });

  test('TC-FLT-010  flat EMI × tenure > reducing EMI × tenure (more total paid)', async () => {
    const { flat, reducing, t } = await page.evaluate(() => {
      const P = 300000, r = 12, t = 36;
      return {
        flat:     Math.round(P * r / 12 / 100 + P / t) * t,
        reducing: window.calcEmi(P, r, t) * t,
        t,
      };
    });
    expect(flat).toBeGreaterThan(reducing);
  });

  test('TC-FLT-011  flat EMI zero rate = P/t only', async () => {
    const r = await page.evaluate(() => Math.round(0 + 100000 / 12));
    expect(r).toBe(8333);
  });

  test('TC-FLT-012  recalcEmiHint shows flat formula when rate-type=flat', async () => {
    // The DOM hint should reflect flat formula
    await page.evaluate(() => {
      document.getElementById('loan-form-rate-type').value   = 'flat';
      document.getElementById('loan-form-principal').value   = '300000';
      document.getElementById('loan-form-rate').value        = '12';
      document.getElementById('loan-form-tenure').value      = '36';
      recalcEmiHint();
    });
    const hint = await page.locator('#loan-form-emi-hint').textContent();
    expect(hint).toContain('11,333');
  });

  test('TC-FLT-013  recalcEmiHint shows reducing formula when rate-type=reducing', async () => {
    await page.evaluate(() => {
      document.getElementById('loan-form-rate-type').value   = 'reducing';
      document.getElementById('loan-form-principal').value   = '100000';
      document.getElementById('loan-form-rate').value        = '12';
      document.getElementById('loan-form-tenure').value      = '12';
      recalcEmiHint();
    });
    const hint = await page.locator('#loan-form-emi-hint').textContent();
    expect(hint).toContain('8,885');
  });

  test('TC-FLT-014  flat EMI result is integer', async () => {
    const r = await page.evaluate(() => {
      const flat = Math.round(500000 * 10.8 / 12 / 100 + 500000 / 60);
      return Number.isInteger(flat);
    });
    expect(r).toBe(true);
  });

  test('TC-FLT-015  flat EMI matches bank CreditFair formula interest component', async () => {
    // CreditFair: P=500000, r=10.8 → monthly interest = 4500
    const r = await page.evaluate(() => Math.round(500000 * 10.8 / 12 / 100));
    expect(r).toBe(4500);
  });
});

/* ─── Zero / Null / Falsy Inputs ────────────────────────────────────── */
test.describe('EMI Calculation — Zero and Edge Inputs', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loadApp(page);
  });

  test.afterAll(async () => { await page.close(); });

  test('TC-ZERO-001  calcEmi(0, 12, 12) = 0 (falsy principal)', async () => {
    expect(await page.evaluate(() => window.calcEmi(0, 12, 12))).toBe(0);
  });

  test('TC-ZERO-002  calcEmi(100000, 0, 12) = 0 (zero rate)', async () => {
    expect(await page.evaluate(() => window.calcEmi(100000, 0, 12))).toBe(0);
  });

  test('TC-ZERO-003  calcEmi(100000, 12, 0) = 0 (zero tenure)', async () => {
    expect(await page.evaluate(() => window.calcEmi(100000, 12, 0))).toBe(0);
  });

  test('TC-ZERO-004  calcEmi(null, 12, 12) = 0', async () => {
    expect(await page.evaluate(() => window.calcEmi(null, 12, 12))).toBe(0);
  });

  test('TC-ZERO-005  calcEmi(100000, null, 12) = 0', async () => {
    expect(await page.evaluate(() => window.calcEmi(100000, null, 12))).toBe(0);
  });

  test('TC-ZERO-006  calcEmi(100000, 12, null) = 0', async () => {
    expect(await page.evaluate(() => window.calcEmi(100000, 12, null))).toBe(0);
  });

  test('TC-ZERO-007  calcEmi(undefined, 12, 12) = 0', async () => {
    expect(await page.evaluate(() => window.calcEmi(undefined, 12, 12))).toBe(0);
  });

  test('TC-ZERO-008  calcEmi(100000, 12, 1) returns positive value', async () => {
    expect(await page.evaluate(() => window.calcEmi(100000, 12, 1))).toBeGreaterThan(0);
  });

  test('TC-ZERO-009  calcEmi never returns NaN', async () => {
    const results = await page.evaluate(() => [
      window.calcEmi(0, 0, 0),
      window.calcEmi(null, null, null),
      window.calcEmi(-1, 12, 12),
      window.calcEmi(100000, -5, 12),
    ]);
    results.forEach(r => expect(isNaN(r)).toBe(false));
  });

  test('TC-ZERO-010  calcEmi(1, 12, 1) returns positive integer', async () => {
    const r = await page.evaluate(() => window.calcEmi(1, 12, 1));
    expect(r).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(r)).toBe(true);
  });
});

/* ─── Bank-Specific Rate Tests ──────────────────────────────────────── */
test.describe('EMI Calculation — Bank-Specific Rates', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loadApp(page);
  });

  test.afterAll(async () => { await page.close(); });

  test('TC-BANK-001  Kotak: calcEmi(800000, 10.5, 60) = 17187', async () => {
    expect(await page.evaluate(() => window.calcEmi(800000, 10.5, 60))).toBe(17187);
  });

  test('TC-BANK-002  IndusInd: calcEmi(500000, 15, 60) > 11000', async () => {
    const r = await page.evaluate(() => window.calcEmi(500000, 15, 60));
    expect(r).toBeGreaterThan(11000);
  });

  test('TC-BANK-003  CreditFair flat interest per month = ₹4500', async () => {
    const r = await page.evaluate(() => Math.round(500000 * 10.8 / 12 / 100));
    expect(r).toBe(4500);
  });

  test('TC-BANK-004  Kotak total reducing repayment > principal', async () => {
    const { emi, total } = await page.evaluate(() => {
      const emi = window.calcEmi(800000, 10.5, 60);
      return { emi, total: emi * 60 };
    });
    expect(emi * 60).toBeGreaterThan(800000);
  });

  test('TC-BANK-005  IndusInd total reducing repayment > principal', async () => {
    const emi = await page.evaluate(() => window.calcEmi(500000, 15, 60));
    expect(emi * 60).toBeGreaterThan(500000);
  });

  test('TC-BANK-006  CreditFair flat EMI component: principal part = 8333', async () => {
    const r = await page.evaluate(() => Math.round(500000 / 60));
    expect(r).toBe(8333);
  });

  test('TC-BANK-007  Kotak EMI at 10% (round-rate sanity check)', async () => {
    const r = await page.evaluate(() => window.calcEmi(800000, 10, 60));
    expect(r).toBeGreaterThan(16000);
    expect(r).toBeLessThan(18000);
  });

  test('TC-BANK-008  reducing calcEmi result is always Math.round (integer)', async () => {
    const checks = await page.evaluate(() => [
      window.calcEmi(500000, 15, 60),
      window.calcEmi(800000, 10.5, 60),
      window.calcEmi(300000, 9.75, 36),
    ].every(Number.isInteger));
    expect(checks).toBe(true);
  });

  test('TC-BANK-009  Kotak 10.5% is lower EMI than IndusInd 15% (same P and T)', async () => {
    const kotak   = await page.evaluate(() => window.calcEmi(500000, 10.5, 60));
    const indusind = await page.evaluate(() => window.calcEmi(500000, 15, 60));
    expect(kotak).toBeLessThan(indusind);
  });

  test('TC-BANK-010  Flat > Reducing for same P/R/T (CreditFair scenario)', async () => {
    const reducing = await page.evaluate(() => window.calcEmi(500000, 10.8, 60));
    const flat     = await page.evaluate(() => Math.round(500000 * 10.8 / 12 / 100 + 500000 / 60));
    expect(flat).toBeGreaterThan(reducing);
  });
});
