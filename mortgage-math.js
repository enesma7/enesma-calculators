/* ENESMA mortgage math. Used by mortgage-calculator.html and the Agent Hub copy.
   Rates are never invented here. Callers pass the note rate.

   FHA mortgage insurance — HUD Mortgagee Letter 2023-05 (February 22, 2023),
   effective for case numbers endorsed on or after March 20, 2023, and carried
   into HUD Handbook 4000.1, Appendix 1.0 (Mortgage Insurance Premiums):
   https://www.hud.gov/sites/dfiles/OCHCO/documents/2023-05hsgml.pdf
   Upfront MIP is 1.75% of the base loan amount (before the upfront premium).
   Annual MIP for a term of more than 15 years:
     base loan <= $726,200
       LTV <= 90%              50 bps   11 years
       LTV > 90% and <= 95%    50 bps   mortgage term
       LTV > 95%               55 bps   mortgage term
     base loan > $726,200
       LTV <= 90%              70 bps   11 years
       LTV > 90% and <= 95%    70 bps   mortgage term
       LTV > 95%               75 bps   mortgage term
   Annual MIP for a term of 15 years or less:
     base loan <= $726,200
       LTV <= 90%              15 bps   11 years
       LTV > 90%               40 bps   mortgage term
     base loan > $726,200
       LTV <= 78%              15 bps   11 years
       LTV > 78% and <= 90%    40 bps   11 years
       LTV > 90%               65 bps   mortgage term
   The $726,200 breakpoint is the threshold printed in that letter. The monthly
   figure here is base loan × annual rate / 12, which is the initial premium.
   HUD bills annual MIP from the outstanding balance, so later years drift down.

   VA funding fee — purchase chart effective April 7, 2023, still the chart on
   https://www.va.gov/housing-assistance/home-loans/funding-fee-and-closing-costs/
   (page last updated October 5, 2026). The fee is a percent of the base loan
   (price minus down payment), not the price. VA's own example: a $200,000
   purchase with $10,000 down (5%), first use, is 1.5% of $190,000 = $2,850.
     First use:      <5% down 2.15% · 5% to <10% 1.50% · >=10% 1.25%
     Subsequent use: <5% down 3.30% · 5% to <10% 1.50% · >=10% 1.25%
   Borrowers receiving VA compensation for a service-connected disability (and
   the other exemptions on that page) pay no funding fee. The exempt option
   sets the fee to 0. VA loans do not charge monthly PMI or MIP.

   Conventional PMI defaults are an editable estimate in a typical annual range
   of about 0.30% to 1.00% by original LTV. They are not a regulator schedule.
     LTV <= 80%  none
     LTV <= 85%  0.30%
     LTV <= 90%  0.50%
     LTV <= 95%  0.75%
     LTV >  95%  1.00%
   Automatic cancellation is the Homeowners Protection Act, 12 U.S.C. § 4902(b):
   on a fixed-rate loan, PMI ends when the balance is first scheduled to reach
   78% of the original value, if the borrower is current. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ENESMAMortgage = api;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this), function () {
  var FHA_UFMIP_PCT = 1.75;
  var FHA_BASE_LIMIT = 726200;
  var MIN_DOWN = { conventional: 3, fha: 3.5, va: 0 };

  function num(v) {
    v = parseFloat(v);
    return isFinite(v) ? v : 0;
  }

  function minDownPct(loanType) {
    return Object.prototype.hasOwnProperty.call(MIN_DOWN, loanType) ? MIN_DOWN[loanType] : 0;
  }

  function defaultPmiRate(ltv) {
    if (!(ltv > 0.8)) return 0;
    if (ltv <= 0.85) return 0.3;
    if (ltv <= 0.9) return 0.5;
    if (ltv <= 0.95) return 0.75;
    return 1;
  }

  function fhaAnnualMip(base, ltv, termYears) {
    var longTerm = termYears > 15;
    var aboveLimit = base > FHA_BASE_LIMIT;
    var bps, life;
    if (longTerm && !aboveLimit) {
      if (ltv <= 0.9) { bps = 50; life = false; }
      else if (ltv <= 0.95) { bps = 50; life = true; }
      else { bps = 55; life = true; }
    } else if (longTerm) {
      if (ltv <= 0.9) { bps = 70; life = false; }
      else if (ltv <= 0.95) { bps = 70; life = true; }
      else { bps = 75; life = true; }
    } else if (!aboveLimit) {
      if (ltv <= 0.9) { bps = 15; life = false; }
      else { bps = 40; life = true; }
    } else if (ltv <= 0.78) {
      bps = 15; life = false;
    } else if (ltv <= 0.9) {
      bps = 40; life = false;
    } else {
      bps = 65; life = true;
    }
    var years = life ? termYears : Math.min(11, termYears);
    return { annualPct: bps / 100, bps: bps, life: life, years: years };
  }

  function vaFundingFeePct(downPct, use, exempt) {
    if (exempt) return 0;
    if (downPct >= 10 - 1e-6) return 1.25;
    if (downPct >= 5 - 1e-6) return 1.5;
    return use === "subsequent" ? 3.3 : 2.15;
  }

  function payment(principal, annualPct, payments) {
    if (!(principal > 0) || !(payments > 0)) return 0;
    var i = annualPct / 1200;
    if (!i) return principal / payments;
    return principal * i / (1 - Math.pow(1 + i, -payments));
  }

  function calc(input) {
    input = input || {};
    var loanType = input.loanType === "fha" || input.loanType === "va" ? input.loanType : "conventional";
    var price = Math.max(0, num(input.price));
    var down = Math.min(price, Math.max(0, num(input.down)));
    var base = Math.max(0, price - down);
    var ltv = price > 0 ? base / price : 0;
    var downPct = price > 0 ? down / price * 100 : 0;
    var termYears = input.termYears === 15 || input.termYears === 20 || input.termYears === 30 ? input.termYears : 30;
    var nPayments = termYears * 12;
    var rate = Math.max(0, num(input.rate));
    var minDown = minDownPct(loanType);
    var belowMin = price > 0 && downPct + 1e-6 < minDown;
    var financedFee = 0;
    var feeRate = 0;
    var feeName = "";
    var miAnnual = 0;
    var miBase = 0;
    var miLife = false;
    var miYears = 0;
    var miOn = false;
    var miLabel = "PMI";
    var exempt = false;

    if (loanType === "fha") {
      feeRate = FHA_UFMIP_PCT;
      financedFee = base * feeRate / 100;
      feeName = "upfront MIP";
      var mip = fhaAnnualMip(base, ltv, termYears);
      miAnnual = mip.annualPct;
      miBase = base;
      miLife = mip.life;
      miYears = mip.years;
      miOn = base > 0;
      miLabel = "FHA MIP";
    } else if (loanType === "va") {
      exempt = !!input.vaExempt;
      feeRate = vaFundingFeePct(downPct, input.vaUse, exempt);
      financedFee = base * feeRate / 100;
      feeName = "VA funding fee";
      miLabel = "PMI / MIP";
    } else if (ltv > 0.8) {
      miAnnual = Math.max(0, num(input.pmiRate));
      miBase = base;
      miOn = miAnnual > 0 && base > 0;
      miLabel = "PMI";
    }

    var loan = base + financedFee;
    var pi = payment(loan, rate, nPayments);
    var tax = price * num(input.taxPct) / 100 / 12;
    var ins = num(input.insAnnual) / 12;
    var hoa = Math.max(0, num(input.hoaMonthly));
    var mi = miOn ? miBase * miAnnual / 100 / 12 : 0;
    return {
      loanType: loanType,
      price: price,
      down: down,
      downPct: downPct,
      base: base,
      ltv: ltv,
      loan: loan,
      financedFee: financedFee,
      feeRate: feeRate,
      feeName: feeName,
      termYears: termYears,
      nPayments: nPayments,
      rate: rate,
      pi: pi,
      tax: tax,
      ins: ins,
      hoa: hoa,
      mi: mi,
      miAnnual: miAnnual,
      miOn: miOn,
      miLabel: miLabel,
      miLife: miLife,
      miYears: miYears,
      total: pi + tax + ins + hoa + mi,
      interest: pi * nPayments - loan,
      minDown: minDown,
      belowMin: belowMin,
      exempt: exempt
    };
  }

  return {
    calc: calc,
    payment: payment,
    defaultPmiRate: defaultPmiRate,
    fhaAnnualMip: fhaAnnualMip,
    vaFundingFeePct: vaFundingFeePct,
    minDownPct: minDownPct,
    FHA_UFMIP_PCT: FHA_UFMIP_PCT,
    FHA_BASE_LIMIT: FHA_BASE_LIMIT
  };
});
