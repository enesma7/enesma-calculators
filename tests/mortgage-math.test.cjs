const assert = require("assert");
const m = require("../mortgage-math.js");

function cents(v) {
  return Math.round(v * 100) / 100;
}

// Standard annuity. $200,000 at 6% for 30 years is $1,199.10.
assert.strictEqual(cents(m.payment(200000, 6, 360)), 1199.1);
assert.strictEqual(cents(m.payment(100000, 6, 360)), 599.55);

// VA's published example: $200,000 price, $10,000 down (5%), first use → $2,850.
assert.strictEqual(m.vaFundingFeePct(5, "first", false), 1.5);
{
  const r = m.calc({
    loanType: "va", price: 200000, down: 10000, rate: 6, termYears: 30,
    taxPct: 0, insAnnual: 0, hoaMonthly: 0, vaUse: "first", vaExempt: false
  });
  assert.strictEqual(r.base, 190000);
  assert.strictEqual(r.financedFee, 2850);
  assert.strictEqual(r.loan, 192850);
  assert.strictEqual(r.mi, 0);
  assert.strictEqual(cents(r.pi), cents(m.payment(192850, 6, 360)));
}

// VA purchase chart.
assert.strictEqual(m.vaFundingFeePct(0, "first", false), 2.15);
assert.strictEqual(m.vaFundingFeePct(4.99, "first", false), 2.15);
assert.strictEqual(m.vaFundingFeePct(0, "subsequent", false), 3.3);
assert.strictEqual(m.vaFundingFeePct(5, "subsequent", false), 1.5);
assert.strictEqual(m.vaFundingFeePct(9.99, "subsequent", false), 1.5);
assert.strictEqual(m.vaFundingFeePct(10, "first", false), 1.25);
assert.strictEqual(m.vaFundingFeePct(10, "subsequent", false), 1.25);
assert.strictEqual(m.vaFundingFeePct(0, "subsequent", true), 0);
{
  const r = m.calc({
    loanType: "va", price: 400000, down: 0, rate: 6, termYears: 30,
    vaUse: "first", vaExempt: true
  });
  assert.strictEqual(r.loan, 400000);
  assert.strictEqual(r.financedFee, 0);
  assert.strictEqual(r.mi, 0);
  assert.strictEqual(r.belowMin, false);
}

// FHA 3.5% down, 30-year, base under $726,200, LTV 96.5% → 0.55% for the term.
// Upfront MIP 1.75% is financed. Annual MIP is on the base loan, not the gross loan.
{
  const r = m.calc({
    loanType: "fha", price: 300000, down: 10500, rate: 6, termYears: 30,
    taxPct: 1.25, insAnnual: 1500, hoaMonthly: 0
  });
  assert.strictEqual(r.base, 289500);
  assert.strictEqual(r.financedFee, 5066.25);
  assert.strictEqual(r.loan, 294566.25);
  assert.strictEqual(Math.round(r.miAnnual * 100), 55);
  assert.strictEqual(r.miLife, true);
  assert.strictEqual(cents(r.mi), 132.69);
  assert.ok(Math.abs(r.mi - 289500 * 0.0055 / 12) < 0.02);
  assert.strictEqual(cents(r.pi), cents(m.payment(294566.25, 6, 360)));
  assert.ok(Math.abs(r.pi - m.payment(289500, 6, 360)) > 1);
  assert.strictEqual(r.belowMin, false);
}

// FHA duration and the amount/LTV grid from ML 2023-05.
function mip(price, downPct, term) {
  const down = price * downPct / 100;
  return m.calc({ loanType: "fha", price, down, rate: 6, termYears: term });
}
function band(price, downPct, term) {
  const r = mip(price, downPct, term);
  return { bps: Math.round(r.miAnnual * 100), life: r.miLife, years: r.miYears };
}
assert.deepStrictEqual(band(400000, 3.5, 30), { bps: 55, life: true, years: 30 });
assert.deepStrictEqual(band(400000, 5, 30), { bps: 50, life: true, years: 30 });
assert.deepStrictEqual(band(400000, 10, 30), { bps: 50, life: false, years: 11 });
assert.deepStrictEqual(band(800000, 3.5, 30), { bps: 75, life: true, years: 30 });
assert.deepStrictEqual(band(800000, 5, 30), { bps: 70, life: true, years: 30 });
assert.deepStrictEqual(band(900000, 10, 30), { bps: 70, life: false, years: 11 });
assert.strictEqual(mip(900000, 10, 30).base > 726200, true);
assert.deepStrictEqual(band(300000, 3.5, 20), { bps: 55, life: true, years: 20 });
assert.deepStrictEqual(band(300000, 3.5, 15), { bps: 40, life: true, years: 15 });
assert.deepStrictEqual(band(300000, 10, 15), { bps: 15, life: false, years: 11 });
assert.deepStrictEqual(band(1000000, 15, 15), { bps: 40, life: false, years: 11 });
assert.deepStrictEqual(band(1000000, 30, 15), { bps: 15, life: false, years: 11 });
assert.deepStrictEqual(band(1000000, 3.5, 15), { bps: 65, life: true, years: 15 });
{
  const r = mip(300000, 3, 30);
  assert.strictEqual(r.belowMin, true);
  assert.strictEqual(r.minDown, 3.5);
}

// Conventional: PMI only above 80% LTV, defaults by band, 78% is a note for the UI.
assert.strictEqual(m.defaultPmiRate(0.8), 0);
assert.strictEqual(m.defaultPmiRate(0.85), 0.3);
assert.strictEqual(m.defaultPmiRate(0.9), 0.5);
assert.strictEqual(m.defaultPmiRate(0.95), 0.75);
assert.strictEqual(m.defaultPmiRate(0.97), 1);
{
  const r = m.calc({
    loanType: "conventional", price: 600000, down: 120000, rate: 6.5, termYears: 30,
    taxPct: 1.25, insAnnual: 1500, hoaMonthly: 250, pmiRate: 0.5
  });
  assert.strictEqual(r.loan, 480000);
  assert.strictEqual(r.financedFee, 0);
  assert.strictEqual(r.mi, 0);
  assert.strictEqual(r.ltv, 0.8);
  assert.strictEqual(cents(r.tax), 625);
  assert.strictEqual(r.ins, 125);
  assert.strictEqual(r.hoa, 250);
  assert.strictEqual(cents(r.pi), cents(m.payment(480000, 6.5, 360)));
  assert.strictEqual(r.belowMin, false);
}
{
  const price = 500000;
  const down = 50000;
  const loan = 450000;
  const r = m.calc({
    loanType: "conventional", price, down, rate: 6.5, termYears: 30, pmiRate: 0.5,
    taxPct: 0, insAnnual: 0, hoaMonthly: 0
  });
  assert.strictEqual(r.ltv, 0.9);
  assert.strictEqual(r.mi, loan * 0.005 / 12);
  assert.strictEqual(r.miOn, true);
}
{
  const r = m.calc({ loanType: "conventional", price: 400000, down: 8000, rate: 6, termYears: 30 });
  assert.strictEqual(r.belowMin, true);
  assert.strictEqual(r.minDown, 3);
}
{
  const r = m.calc({ loanType: "conventional", price: 400000, down: 12000, rate: 6, termYears: 30 });
  assert.strictEqual(r.belowMin, false);
}

console.log("mortgage-math tests passed");
console.log("example conventional 600k / 20% / 6.5% / 30yr P&I", cents(m.payment(480000, 6.5, 360)));
console.log("example VA 192850 / 6% / 30yr P&I", cents(m.payment(192850, 6, 360)));
console.log("example FHA 294566.25 / 6% / 30yr P&I", cents(m.payment(294566.25, 6, 360)));
