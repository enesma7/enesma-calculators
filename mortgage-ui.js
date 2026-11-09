/* Mortgage calculator UI. Math is in mortgage-math.js. The page and the Agent Hub both call mount(). */
(function () {
  var M = window.ENESMAMortgage;
  if (!M) return;

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var TYPES = [
    ["conventional", "Conventional"],
    ["fha", "FHA"],
    ["va", "VA"]
  ];

  function num(v) {
    v = parseFloat(v);
    return isFinite(v) ? v : 0;
  }

  function money(v, cents) {
    var neg = v < -0.005;
    var abs = Math.abs(cents ? v : Math.round(v));
    var opts = cents ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : {};
    return (neg ? "−$" : "$") + abs.toLocaleString("en-US", opts);
  }

  function moneyAuto(v) {
    return money(v, Math.abs(v - Math.round(v)) > 0.001);
  }

  function fmtRate(v) {
    return (Math.round(v * 1000) / 1000).toString();
  }

  function fmtDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!m) return iso || "";
    return MONTHS[+m[2] - 1] + " " + (+m[3]) + ", " + m[1];
  }

  function field(k, label, kind, value) {
    var affix = kind === "d" ? '<i class="pre">$</i>' : '<i class="suf">' + (kind === "p" ? "%" : "/yr") + "</i>";
    var shown = value === undefined || value === null ? "" : value;
    return '<label><span class="t">' + label + '</span><span class="box ' + kind + '">' + affix +
      '<input type="number" step="any" min="0" inputmode="decimal" value="' + shown + '" placeholder="0" data-k="' + k + '" aria-label="' + label + '">' +
      '</span><span class="calc" id="c_' + k + '"></span></label>';
  }

  function mount() {
    var cards = document.getElementById("cards");
    var res = document.getElementById("res");
    if (!cards || !res || !M) return;

    var V = {
      price: 600000,
      down: 120000,
      downPct: 20,
      rate: "",
      term: 30,
      taxPct: 1.25,
      ins: 1500,
      hoa: 0,
      pmi: 0,
      loanType: "conventional",
      vaUse: "first",
      vaExempt: false
    };
    var rateOverride = { conventional: null, fha: null, va: null };
    var pmiManual = false;
    var rates = null;
    var ratesState = "loading";

    cards.innerHTML =
      '<div class="card"><h2>Home &amp; loan<span id="t0"></span></h2>' +
      '<label class="loan-type-label"><span class="t">Loan type</span>' +
      '<div class="seg loan-type" id="loanType" role="group" aria-label="Loan type">' +
      TYPES.map(function (t) {
        return '<button type="button" data-type="' + t[0] + '"' + (t[0] === V.loanType ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + ">" + t[1] + "</button>";
      }).join("") +
      '</div></label>' +
      '<p class="type-note" id="typeNote"></p>' +
      '<div class="f">' +
      field("price", "Purchase price", "d", V.price) +
      field("down", "Down payment ($)", "d", V.down) +
      field("downPct", "Down payment (%)", "p", V.downPct) +
      field("rate", "Interest rate", "p", "") +
      '<label><span class="t">Loan term</span><div class="seg" id="term">' +
      [15, 20, 30].map(function (y) {
        return '<button type="button" data-y="' + y + '"' + (y === V.term ? ' class="on"' : "") + ">" + y + " yr</button>";
      }).join("") +
      '</div><span class="calc" id="c_term"></span></label></div>' +
      '<p class="rate-src" id="rateSrc"></p>' +
      '<div class="va-block" id="vaBlock" hidden>' +
      '<label><span class="t">VA loan use</span><div class="seg" id="vaUse">' +
      '<button type="button" data-use="first" class="on">First use</button>' +
      '<button type="button" data-use="subsequent">Subsequent</button>' +
      '</div><span class="calc" id="c_vaUse"></span></label>' +
      '<label class="tog"><span>Exempt (disability)<small>Sets the VA funding fee to $0</small></span>' +
      '<span class="sw"><input type="checkbox" id="vaExempt" aria-label="Exempt (disability)"><b></b></span></label>' +
      "</div></div>" +
      '<div class="card"><h2>Monthly costs<span id="t1"></span></h2><div class="f">' +
      field("taxPct", "Property tax", "p", V.taxPct) +
      field("ins", "Homeowners ins.", "y", V.ins) +
      field("hoa", "HOA dues (monthly)", "d", V.hoa) +
      '<div id="pmiWrap">' + field("pmi", "PMI rate (annual)", "p", V.pmi) + "</div>" +
      "</div></div>";

    var q = function (k) { return document.querySelector('[data-k="' + k + '"]'); };
    q("rate").setAttribute("aria-describedby", "rateSrc");

    function price() { return num(V.price); }

    function syncDown(from) {
      var p = price();
      if (from === "down") {
        V.downPct = p ? +(num(V.down) / p * 100).toFixed(3) : 0;
        q("downPct").value = V.downPct;
      } else {
        V.down = Math.round(p * num(V.downPct) / 100);
        q("down").value = V.down;
      }
    }

    function ensureMinDown() {
      var min = M.minDownPct(V.loanType);
      var p = price();
      var pct = p ? num(V.down) / p * 100 : num(V.downPct);
      if (pct + 1e-6 < min) {
        V.downPct = min;
        V.down = Math.round(p * min / 100);
        q("down").value = V.down;
        q("downPct").value = V.downPct;
      }
    }

    function syncPmiDefault() {
      if (V.loanType !== "conventional" || pmiManual) return;
      var p = price();
      var ltv = p > 0 ? Math.max(0, p - num(V.down)) / p : 0;
      V.pmi = M.defaultPmiRate(ltv);
      q("pmi").value = V.pmi;
    }

    function applyRate() {
      var t = V.loanType;
      var ov = rateOverride[t];
      if (ov != null) V.rate = ov;
      else if (rates && typeof rates[t] === "number") V.rate = String(rates[t]);
      else V.rate = "";
      if (document.activeElement !== q("rate")) q("rate").value = V.rate;
    }

    function current() {
      return M.calc({
        loanType: V.loanType,
        price: V.price,
        down: V.down,
        rate: V.rate,
        termYears: V.term,
        taxPct: V.taxPct,
        insAnnual: V.ins,
        hoaMonthly: V.hoa,
        pmiRate: V.pmi,
        vaUse: V.vaUse,
        vaExempt: V.vaExempt
      });
    }

    function rateCaption() {
      if (ratesState === "loading") return "Loading the California average…";
      var avg = rates && typeof rates[V.loanType] === "number" ? rates[V.loanType] : null;
      var src = rates && rates.source ? rates.source : "";
      var when = rates && rates.asOf ? fmtDate(rates.asOf) : "";
      var national = /national/i.test(src);
      var kind = national ? "National avg" : "CA avg";
      var custom = rateOverride[V.loanType] != null;
      if (avg == null) {
        return rates ? "No published average for this loan type. Enter a rate." : "Published average unavailable. Enter a rate.";
      }
      if (custom) return "Your rate · " + kind + " " + fmtRate(avg) + "% as of " + when + " · " + src;
      return kind + " as of " + when + " · " + src;
    }

    function setHtml(id, html) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = html;
    }

    function upd() {
      var r = current();
      var names = { conventional: "Conventional", fha: "FHA", va: "VA" };
      document.getElementById("pmiWrap").hidden = V.loanType !== "conventional";
      var vaBlock = document.getElementById("vaBlock");
      vaBlock.hidden = V.loanType !== "va";
      document.getElementById("vaUse").querySelectorAll("button").forEach(function (b) {
        b.disabled = V.vaExempt;
      });

      setHtml("t0", "Loan <b>" + moneyAuto(r.loan) + "</b>");
      setHtml("t1", "Escrow <b>" + money(r.tax + r.ins + r.mi, true) + "</b>/mo");
      setHtml("c_price", "<em>home price</em>");
      setHtml("c_down", "<em>" + r.downPct.toFixed(1) + "% down</em>");

      var downNote = "<em>" + r.downPct.toFixed(1) + "% of price</em>";
      if (V.loanType === "conventional") downNote = r.ltv > 0.8 ? "PMI applies <em>· under 20%</em>" : "<em>no PMI · 20%+</em>";
      if (r.belowMin) downNote = "Minimum is " + r.minDown + "%";
      else if (V.loanType === "fha") downNote = "<em>FHA minimum 3.5%</em>";
      else if (V.loanType === "va") downNote = "<em>0% down allowed</em>";
      setHtml("c_downPct", downNote);

      setHtml("c_rate", r.rate === "" || r.rate === null ? "<em>enter a rate</em>" : money(r.pi, true) + " <em>P&amp;I / mo</em>");
      setHtml("c_term", "<em>" + r.nPayments + " payments</em>");
      setHtml("c_taxPct", money(r.tax, true) + " <em>/ mo</em>");
      setHtml("c_ins", money(r.ins, true) + " <em>/ mo</em>");
      setHtml("c_hoa", "<em>if applicable</em>");

      var pmiLine;
      if (V.loanType !== "conventional") pmiLine = "";
      else if (r.miOn) pmiLine = money(r.mi, true) + " <em>/ mo · cancels at 78% LTV</em>";
      else pmiLine = "<em>no PMI at 20%+ down</em>";
      setHtml("c_pmi", pmiLine);

      var typeNote = "";
      if (V.loanType === "conventional") {
        typeNote = "PMI applies above 80% of the price and cancels automatically at 78% of the original value.";
      } else if (V.loanType === "fha") {
        var dur = r.miLife ? "for the life of the loan" : "for 11 years";
        typeNote = "Upfront MIP " + fmtRate(r.feeRate) + "% (" + money(r.financedFee, true) + ") is financed. Annual MIP " +
          fmtRate(r.miAnnual) + "% " + dur + ".";
      } else if (r.exempt) {
        typeNote = "Exempt. The VA funding fee is $0. VA loans have no monthly PMI or MIP.";
      } else {
        typeNote = "VA funding fee " + fmtRate(r.feeRate) + "% (" + money(r.financedFee, true) +
          ") is financed. VA loans have no monthly PMI or MIP.";
      }
      document.getElementById("typeNote").textContent = typeNote;
      document.getElementById("rateSrc").textContent = rateCaption();

      var useNote = V.vaExempt ? "<em>fee waived</em>" : money(r.financedFee, true) + " <em>financed · " + fmtRate(r.feeRate) + "%</em>";
      setHtml("c_vaUse", useNote);

      var rateMissing = String(V.rate).trim() === "";
      var piText = rateMissing ? "—" : money(r.pi, true);
      var totalText = rateMissing ? "—" : money(r.total, true);
      var interestText = rateMissing ? "—" : money(r.interest);
      var miName = r.miLabel;
      if (V.loanType === "conventional") {
        miName = r.miOn ? "PMI (" + fmtRate(r.miAnnual) + "%/yr · cancels at 78% LTV)" : "PMI (not required)";
      } else if (V.loanType === "fha") {
        miName = "FHA MIP (" + fmtRate(r.miAnnual) + "%/yr · " + (r.miLife ? "life of loan" : "11 years") + ")";
      } else {
        miName = "PMI / MIP (none on VA)";
      }

      var loanSub = r.downPct.toFixed(1) + "% down · " + money(r.down);
      if (r.financedFee > 0.004) loanSub += " · includes " + money(r.financedFee, true) + " " + r.feeName;
      else if (V.loanType === "va" && r.exempt) loanSub += " · funding fee exempt";

      var warn = "";
      if (r.belowMin && V.loanType === "conventional") {
        warn = '<div class="warn">Conventional programs in this estimate allow a down payment as low as 3%.</div>';
      } else if (r.belowMin && V.loanType === "fha") {
        warn = '<div class="warn">FHA purchase loans require a down payment of at least 3.5%.</div>';
      }

      var rateShown = V.rate === "" ? "—" : num(V.rate) + "%";
      var seg = [
        ["Principal & interest", rateMissing ? 0 : r.pi, "var(--gold)"],
        ["Property tax", r.tax, "linear-gradient(135deg,rgba(234,213,158,.75),rgba(213,190,135,.75))"],
        ["Insurance", r.ins, "#FBFBFB"],
        ["HOA", r.hoa, "rgba(251,251,251,.45)"],
        [r.miLabel, r.mi, "linear-gradient(135deg,rgba(234,213,158,.4),rgba(213,190,135,.4))"]
      ];
      var tot = Math.max(0.01, rateMissing ? r.total - r.pi : r.total);
      var rows =
        "<div><span>Principal &amp; interest</span><span>" + piText + "</span></div>" +
        "<div><span>Property tax</span><span>" + money(r.tax, true) + "</span></div>" +
        "<div><span>Homeowners insurance</span><span>" + money(r.ins, true) + "</span></div>" +
        "<div><span>HOA dues</span><span>" + money(r.hoa, true) + "</span></div>" +
        "<div><span>" + miName + "</span><span>" + money(r.mi, true) + "</span></div>" +
        '<div class="tot"><span>Total monthly payment</span><span>' + totalText + "</span></div>" +
        '<div style="border:0"><span>Loan amount, including financed fees</span><span>' + moneyAuto(r.loan) + "</span></div>" +
        '<div style="border:0"><span>Total interest over ' + V.term + " years</span><span>" + interestText + "</span></div>";

      res.innerHTML =
        '<div class="top"><div class="k">Estimated monthly payment</div><div class="big" id="out">' + totalText + "</div>" +
        '<div class="note">' + V.term + "-year fixed " + names[V.loanType] + " at " + rateShown + "</div>" + warn + "</div>" +
        '<div class="kpis"><div class="kpi"><div class="k">Principal &amp; interest</div><div class="v">' + piText + '</div><div class="s">per month</div></div>' +
        '<div class="kpi"><div class="k">Loan amount</div><div class="v">' + moneyAuto(r.loan) + '</div><div class="s">' + loanSub + "</div></div></div>" +
        '<div class="stack">' + seg.map(function (s) { return '<div style="width:' + (s[1] / tot * 100) + "%;background:" + s[2] + '"></div>'; }).join("") + "</div>" +
        '<div class="legend">' + seg.map(function (s) { return '<span><i style="background:' + s[2] + '"></i>' + s[0] + "</span>"; }).join("") + "</div>" +
        '<div class="tbl">' + rows + "</div>";
    }

    cards.addEventListener("input", function (e) {
      var el = e.target;
      if (!el || !el.dataset || !el.dataset.k) {
        if (el && el.id === "vaExempt") {
          V.vaExempt = el.checked;
          upd();
        }
        return;
      }
      var k = el.dataset.k;
      V[k] = el.value;
      if (k === "down") syncDown("down");
      if (k === "downPct" || k === "price") syncDown("pct");
      if (k === "price" || k === "down" || k === "downPct") syncPmiDefault();
      if (k === "pmi") {
        if (el.value.trim() === "") {
          pmiManual = false;
          syncPmiDefault();
        } else pmiManual = true;
      }
      if (k === "rate") {
        rateOverride[V.loanType] = el.value.trim() === "" ? "" : el.value;
      }
      upd();
    });

    document.getElementById("loanType").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      V.loanType = b.dataset.type;
      document.getElementById("loanType").querySelectorAll("button").forEach(function (x) {
        var on = x === b;
        x.classList.toggle("on", on);
        x.setAttribute("aria-pressed", on ? "true" : "false");
      });
      ensureMinDown();
      syncPmiDefault();
      applyRate();
      upd();
    });

    document.getElementById("term").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      V.term = +b.dataset.y;
      document.getElementById("term").querySelectorAll("button").forEach(function (x) {
        x.classList.toggle("on", x === b);
      });
      upd();
    });

    document.getElementById("vaUse").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b || b.disabled) return;
      V.vaUse = b.dataset.use;
      document.getElementById("vaUse").querySelectorAll("button").forEach(function (x) {
        x.classList.toggle("on", x === b);
      });
      upd();
    });

    syncPmiDefault();
    upd();

    fetch("/data/ca-rates.json", { cache: "no-cache" })
      .then(function (res) {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then(function (data) {
        if (!data || typeof data.source !== "string" || typeof data.asOf !== "string") throw new Error("shape");
        rates = data;
        ratesState = "ready";
      })
      .catch(function () {
        rates = null;
        ratesState = "missing";
      })
      .then(function () {
        if (rateOverride[V.loanType] == null) applyRate();
        upd();
      });
  }

  window.ENESMAMortgage.mount = mount;
})();
