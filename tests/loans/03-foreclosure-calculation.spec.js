/**
 * 03 — Foreclosure Calculation Tests (65 tests)
 *
 * Critical requirement: foreclosure = outstanding PRINCIPAL only
 *   + preclosure charge (% of principal)
 *   + 18% GST on that charge
 *   No future interest included.
 *
 * Covers:
 *   • Zero-charge loans (CreditFair)
 *   • 3% charge (IndusInd)
 *   • 4% charge (Kotak)
 *   • 5% default charge
 *   • GST computation accuracy
 *   • Total = principal + charge + GST
 *   • Edge cases: zero balance, large balance, fractional charge
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { loadApp }      = require('../helpers/setup');
const { CREDIT_FAIR, INDUSIND, KOTAK } = require('../helpers/loan-data');

/* helper: call foreclosureCost on page */
async function fc(page, loan, balance) {
  return page.evaluate(([l, b]) => window.foreclosureCost(l, b), [loan, balance]);
}

/* ─── Zero Charge (CreditFair) ──────────────────────────────────────── */
test.describe('Foreclosure — Zero Charge (CreditFair)', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loadApp(page);
  });

  test.afterAll(() => page.close());

  test('TC-FC-001  0% charge: total = principal only', async () => {
    const r = await fc(page, CREDIT_FAIR, 400000);
    expect(r.total).toBe(400000);
  });

  test('TC-FC-002  0% charge: charge component = 0', async () => {
    const r = await fc(page, CREDIT_FAIR, 400000);
    expect(r.charge).toBe(0);
  });

  test('TC-FC-003  0% charge: GST = 0', async () => {
    const r = await fc(page, CREDIT_FAIR, 400000);
    expect(r.gst).toBe(0);
  });

  test('TC-FC-004  0% charge: principal field matches input balance', async () => {
    const r = await fc(page, CREDIT_FAIR, 350000);
    expect(r.principal).toBe(350000);
  });

  test('TC-FC-005  0% charge: chargePercent field = 0', async () => {
    const r = await fc(page, CREDIT_FAIR, 300000);
    expect(r.chargePercent).toBe(0);
  });

  test('TC-FC-006  0% charge small balance: total = balance', async () => {
    const r = await fc(page, CREDIT_FAIR, 50000);
    expect(r.total).toBe(50000);
  });

  test('TC-FC-007  0% charge large balance: total = balance', async () => {
    const r = await fc(page, CREDIT_FAIR, 480000);
    expect(r.total).toBe(480000);
  });

  test('TC-FC-008  0% charge zero balance: total = 0', async () => {
    const r = await fc(page, CREDIT_FAIR, 0);
    expect(r.total).toBe(0);
  });

  test('TC-FC-009  0% charge result is a plain object with required keys', async () => {
    const r = await fc(page, CREDIT_FAIR, 100000);
    expect(r).toHaveProperty('principal');
    expect(r).toHaveProperty('chargePercent');
    expect(r).toHaveProperty('charge');
    expect(r).toHaveProperty('gst');
    expect(r).toHaveProperty('total');
  });

  test('TC-FC-010  0% charge total is integer', async () => {
    const r = await fc(page, CREDIT_FAIR, 333333);
    expect(Number.isInteger(r.total)).toBe(true);
  });

  test('TC-FC-011  CreditFair lower cost than IndusInd (same balance)', async () => {
    const [cf, ii] = await page.evaluate(([l1, l2]) => [
      window.foreclosureCost(l1, 300000),
      window.foreclosureCost(l2, 300000),
    ], [CREDIT_FAIR, INDUSIND]);
    expect(cf.total).toBeLessThan(ii.total);
  });

  test('TC-FC-012  CreditFair cheaper than Kotak (same balance)', async () => {
    const [cf, kt] = await page.evaluate(([l1, l2]) => [
      window.foreclosureCost(l1, 300000),
      window.foreclosureCost(l2, 300000),
    ], [CREDIT_FAIR, KOTAK]);
    expect(cf.total).toBeLessThan(kt.total);
  });
});

/* ─── 3% Charge (IndusInd) ─────────────────────────────────────────── */
test.describe('Foreclosure — 3% Charge (IndusInd)', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loadApp(page);
  });

  test.afterAll(() => page.close());

  test('TC-FC-013  3% on 350000: charge = 10500', async () => {
    const r = await fc(page, INDUSIND, 350000);
    expect(r.charge).toBe(10500);
  });

  test('TC-FC-014  3% on 350000: GST = round(10500 × 18/100) = 1890', async () => {
    const r = await fc(page, INDUSIND, 350000);
    expect(r.gst).toBe(1890);
  });

  test('TC-FC-015  3% on 350000: total = 350000+10500+1890 = 362390', async () => {
    const r = await fc(page, INDUSIND, 350000);
    expect(r.total).toBe(362390);
  });

  test('TC-FC-016  3% charge: principal field = input balance', async () => {
    const r = await fc(page, INDUSIND, 250000);
    expect(r.principal).toBe(250000);
  });

  test('TC-FC-017  3% on 100000: charge = 3000, gst = 540, total = 103540', async () => {
    const r = await fc(page, INDUSIND, 100000);
    expect(r.charge).toBe(3000);
    expect(r.gst).toBe(540);
    expect(r.total).toBe(103540);
  });

  test('TC-FC-018  3% on 500000: charge = 15000, gst = 2700, total = 517700', async () => {
    const r = await fc(page, INDUSIND, 500000);
    expect(r.charge).toBe(15000);
    expect(r.gst).toBe(2700);
    expect(r.total).toBe(517700);
  });

  test('TC-FC-019  3% chargePercent field = 3', async () => {
    const r = await fc(page, INDUSIND, 200000);
    expect(r.chargePercent).toBe(3);
  });

  test('TC-FC-020  3% all values are integers', async () => {
    const r = await fc(page, INDUSIND, 350000);
    expect(Number.isInteger(r.principal)).toBe(true);
    expect(Number.isInteger(r.charge)).toBe(true);
    expect(Number.isInteger(r.gst)).toBe(true);
    expect(Number.isInteger(r.total)).toBe(true);
  });

  test('TC-FC-021  3% zero balance: all components = 0', async () => {
    const r = await fc(page, INDUSIND, 0);
    expect(r.charge).toBe(0);
    expect(r.gst).toBe(0);
    expect(r.total).toBe(0);
  });

  test('TC-FC-022  3% total > principal (charge incurred)', async () => {
    const r = await fc(page, INDUSIND, 300000);
    expect(r.total).toBeGreaterThan(300000);
  });
});

/* ─── 4% Charge (Kotak) ────────────────────────────────────────────── */
test.describe('Foreclosure — 4% Charge (Kotak)', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loadApp(page);
  });

  test.afterAll(() => page.close());

  test('TC-FC-023  4% on 350000: charge = 14000', async () => {
    const r = await fc(page, KOTAK, 350000);
    expect(r.charge).toBe(14000);
  });

  test('TC-FC-024  4% on 350000: GST = round(14000×18/100) = 2520', async () => {
    const r = await fc(page, KOTAK, 350000);
    expect(r.gst).toBe(2520);
  });

  test('TC-FC-025  4% on 350000: total = 366520', async () => {
    const r = await fc(page, KOTAK, 350000);
    expect(r.total).toBe(366520);
  });

  test('TC-FC-026  4% on 600000: charge = 24000, gst = 4320, total = 628320', async () => {
    const r = await fc(page, KOTAK, 600000);
    expect(r.charge).toBe(24000);
    expect(r.gst).toBe(4320);
    expect(r.total).toBe(628320);
  });

  test('TC-FC-027  4% chargePercent = 4', async () => {
    const r = await fc(page, KOTAK, 500000);
    expect(r.chargePercent).toBe(4);
  });

  test('TC-FC-028  Kotak cost > IndusInd cost (4% > 3%, same balance)', async () => {
    const [kt, ii] = await page.evaluate(([l1, l2]) => [
      window.foreclosureCost(l1, 400000),
      window.foreclosureCost(l2, 400000),
    ], [KOTAK, INDUSIND]);
    expect(kt.total).toBeGreaterThan(ii.total);
  });

  test('TC-FC-029  4% charge scales linearly with balance', async () => {
    const [r1, r2] = await page.evaluate((loan) => [
      window.foreclosureCost(loan, 200000),
      window.foreclosureCost(loan, 400000),
    ], KOTAK);
    expect(r2.charge).toBe(r1.charge * 2);
  });

  test('TC-FC-030  4% GST is exactly 18% of charge', async () => {
    const r = await fc(page, KOTAK, 750000);
    expect(r.gst).toBe(Math.round(r.charge * 0.18));
  });

  test('TC-FC-031  4% zero balance: total = 0', async () => {
    const r = await fc(page, KOTAK, 0);
    expect(r.total).toBe(0);
  });
});

/* ─── 5% Default Charge ─────────────────────────────────────────────── */
test.describe('Foreclosure — 5% Default Charge', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loadApp(page);
  });

  test.afterAll(() => page.close());

  const DEFAULT_LOAN = {
    id: 'default-test',
    name: 'Generic Bank',
    foreclosureChargePercent: 5,
    status: 'active',
  };

  test('TC-FC-032  5% on 350000: charge = 17500', async () => {
    const r = await fc(page, DEFAULT_LOAN, 350000);
    expect(r.charge).toBe(17500);
  });

  test('TC-FC-033  5% on 350000: GST = round(17500×18/100) = 3150', async () => {
    const r = await fc(page, DEFAULT_LOAN, 350000);
    expect(r.gst).toBe(3150);
  });

  test('TC-FC-034  5% on 350000: total = 370650', async () => {
    const r = await fc(page, DEFAULT_LOAN, 350000);
    expect(r.total).toBe(370650);
  });

  test('TC-FC-035  5% on 1000000: charge = 50000, gst = 9000, total = 1059000', async () => {
    const r = await fc(page, DEFAULT_LOAN, 1000000);
    expect(r.charge).toBe(50000);
    expect(r.gst).toBe(9000);
    expect(r.total).toBe(1059000);
  });

  test('TC-FC-036  foreclosureChargePercent=null falls back to DEFAULT (5%)', async () => {
    const loan = { id: 'null-pct', name: 'Test', foreclosureChargePercent: null, status: 'active' };
    const r    = await fc(page, loan, 100000);
    // Default is 5%: charge = 5000, gst = 900, total = 105900
    expect(r.chargePercent).toBe(5);
    expect(r.total).toBe(105900);
  });

  test('TC-FC-037  foreclosureChargePercent=undefined falls back to DEFAULT (5%)', async () => {
    const loan = { id: 'undef-pct', name: 'Test', status: 'active' };
    const r    = await fc(page, loan, 200000);
    expect(r.chargePercent).toBe(5);
  });

  test('TC-FC-038  5% all components are non-negative', async () => {
    const r = await fc(page, DEFAULT_LOAN, 200000);
    expect(r.principal).toBeGreaterThanOrEqual(0);
    expect(r.charge).toBeGreaterThanOrEqual(0);
    expect(r.gst).toBeGreaterThanOrEqual(0);
    expect(r.total).toBeGreaterThanOrEqual(0);
  });
});

/* ─── GST Calculation Accuracy ──────────────────────────────────────── */
test.describe('Foreclosure — GST Accuracy (18%)', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loadApp(page);
  });

  test.afterAll(() => page.close());

  test('TC-GST-001  GST is exactly Math.round(charge × 0.18)', async () => {
    const r = await fc(page, INDUSIND, 333333);
    expect(r.gst).toBe(Math.round(r.charge * 0.18));
  });

  test('TC-GST-002  GST on 0 charge = 0', async () => {
    const r = await fc(page, CREDIT_FAIR, 500000);
    expect(r.gst).toBe(0);
  });

  test('TC-GST-003  GST rate is 18% not 12% or 28%', async () => {
    const r = await fc(page, INDUSIND, 100000);
    expect(r.gst).toBe(Math.round(r.charge * 0.18));
    expect(r.gst).not.toBe(Math.round(r.charge * 0.12));
    expect(r.gst).not.toBe(Math.round(r.charge * 0.28));
  });

  test('TC-GST-004  GST is integer (Math.round applied)', async () => {
    const r = await fc(page, INDUSIND, 77777);
    expect(Number.isInteger(r.gst)).toBe(true);
  });

  test('TC-GST-005  total = principal + charge + gst (accounting identity)', async () => {
    const r = await fc(page, INDUSIND, 350000);
    expect(r.total).toBe(r.principal + r.charge + r.gst);
  });

  test('TC-GST-006  total = principal + charge + gst for 4% Kotak', async () => {
    const r = await fc(page, KOTAK, 400000);
    expect(r.total).toBe(r.principal + r.charge + r.gst);
  });

  test('TC-GST-007  total = principal + charge + gst for 0% CreditFair', async () => {
    const r = await fc(page, CREDIT_FAIR, 200000);
    expect(r.total).toBe(r.principal + r.charge + r.gst);
  });

  test('TC-GST-008  charge = Math.round(principal × chargePercent / 100)', async () => {
    const r = await fc(page, INDUSIND, 450000);
    expect(r.charge).toBe(Math.round(450000 * INDUSIND.foreclosureChargePercent / 100));
  });

  test('TC-GST-009  GST doubles when balance doubles (linear)', async () => {
    const [r1, r2] = await page.evaluate((loan) => [
      window.foreclosureCost(loan, 100000),
      window.foreclosureCost(loan, 200000),
    ], INDUSIND);
    expect(r2.gst).toBe(r1.gst * 2);
  });

  test('TC-GST-010  foreclosure never includes future interest', async () => {
    // total must be ≤ principal × (1 + charge% + 18% of charge%)
    const balance = 400000;
    const pct     = INDUSIND.foreclosureChargePercent / 100;
    const maxExpected = balance * (1 + pct * 1.18);
    const r = await fc(page, INDUSIND, balance);
    expect(r.total).toBeLessThanOrEqual(Math.ceil(maxExpected));
  });

  test('TC-GST-011  charge percent 2.5% works correctly', async () => {
    const loan = { ...INDUSIND, foreclosureChargePercent: 2.5 };
    const r    = await fc(page, loan, 400000);
    expect(r.charge).toBe(Math.round(400000 * 2.5 / 100));
    expect(r.gst).toBe(Math.round(r.charge * 0.18));
    expect(r.total).toBe(r.principal + r.charge + r.gst);
  });

  test('TC-GST-012  no future interest: total < balance + 20% (sanity cap)', async () => {
    const balance = 500000;
    const r       = await fc(page, KOTAK, balance);
    expect(r.total).toBeLessThan(balance * 1.20); // 4%+GST well under 20%
  });

  test('TC-GST-013  principal field in result is Math.round(input)', async () => {
    const r = await fc(page, INDUSIND, 333333.7);
    expect(r.principal).toBe(Math.round(333333.7));
  });

  test('TC-GST-014  negative balance clamped to 0', async () => {
    const r = await fc(page, INDUSIND, -50000);
    expect(r.principal).toBe(0);
    expect(r.total).toBe(0);
  });
});
