/*
 * CBS Brick Pricing engine
 * One source of truth for how Central Brick Society prices a consigned LEGO set.
 * Used by Brick Price Check (browser) and by the CBS Consignment Tracker (Google Apps Script).
 *
 *   BrickPricing.priceSet(input) -> result
 *
 * input (all prices in dollars; any field may be left out):
 *   new:   { brickset, bricklink6, brickeconomy, brickowl, bricklink3 }   new/sealed figures
 *   used:  { brickset, bricklink6, brickeconomy, brickowl }               used figures
 *   usedOther: [numbers]          used figures from other sites (used only if `used` is empty)
 *   rrp, cost                     retail (Brickset RRP) and initial cost each
 *   lr                            LR Suggested Price (DasBot !price)
 *   stillAtRetail                 true if LEGO still sells the set (LR estimate = retail)
 *   discount                      condition discount: 15, 0.15, "15%", or a key of RULES.conditionDiscounts
 *   consignmentRate               CBS share: 35 or 0.35 (default RULES.consignmentRate)
 */
(function (root) {
  "use strict";

  var RULES = {
    version: "1.2.0",
    consignmentRate: 0.35,          // CBS keeps this share; consignor gets the rest
    memberDiscount: 0.05,           // member / employee discount, split on the discounted price
    shelfRounding: 5,               // LR Suggested Price is rounded to the nearest $5
    averageSources: ["brickset", "bricklink6", "brickeconomy", "brickowl"],
    lrEstimateSources: ["bricklink3", "bricklink6", "brickeconomy"],
    conditionDiscounts: {
      minor_dents: 5,
      major_crease: 10,
      crushed_box: 15,
      opened_sealed_bags: 15
    },
    rules: [
      "Avg market value = average of Brickset, BrickLink 6-month sold, BrickEconomy and Brick Owl (new), using the sources that have a figure.",
      "Price floor = retail (Brickset RRP) or initial cost, whichever is higher.",
      "Recommended price = average, never below the floor, in whole dollars.",
      "Normal shelf price = LR Suggested Price rounded to the nearest $5, never below the floor. With no LR price, the recommended price.",
      "A set is never priced below retail unless a condition discount is applied.",
      "Condition discount comes off the normal shelf price and may take a damaged set below retail.",
      "Used price = average of the used figures, rounded to $1. Used is a condition discount, so it is not held to retail.",
      "Consignment split: CBS keeps 35%, consignor gets 65%. Member/employee 5% is split on the discounted price."
    ]
  };

  function num(v) {
    if (v === null || v === undefined || v === "") return null;
    var n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,%\s]/g, ""));
    return isFinite(n) && n > 0 ? n : null;
  }
  function mean(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s / a.length; }
  function round2(v) { return Math.round(v * 100) / 100; }
  function pick(obj, keys) {
    var out = [];
    obj = obj || {};
    for (var i = 0; i < keys.length; i++) { var v = num(obj[keys[i]]); if (v !== null) out.push(v); }
    return out;
  }
  function pctOf(v) {           // 15, "15%", 0.15 -> 15
    if (v === null || v === undefined || v === "") return 0;
    if (typeof v === "string" && RULES.conditionDiscounts.hasOwnProperty(v)) return RULES.conditionDiscounts[v];
    var n = num(v);
    if (n === null) return 0;
    if (n < 1) n = n * 100;
    return Math.min(95, n);
  }
  function rateOf(v) {          // 35 or 0.35 -> 0.35
    var n = num(v);
    if (n === null) return RULES.consignmentRate;
    return n > 1 ? n / 100 : n;
  }
  function split(price, rate) {
    if (price === null) return { price: null, consignor: null, cbs: null };
    return { price: price, consignor: round2(price * (1 - rate)), cbs: round2(price * rate) };
  }

  function priceSet(input) {
    input = input || {};
    var nw = input["new"] || {};
    // Parts are priced in cents; sets and minifigs in whole dollars
    var cents = input.itemType === "part" || input.itemType === "element";
    var whole = cents ? round2 : Math.round;
    var rrp = num(input.rrp), cost = num(input.cost);

    // 1. Avg market value
    var core = pick(nw, RULES.averageSources);
    var avg = core.length ? round2(mean(core)) : null;

    // 2. Floor
    var floor = Math.max(rrp || 0, cost || 0) || null;
    var floorUp = floor ? Math.ceil(floor) : 0;   // whole-dollar prices never round under retail

    // 3. Recommended
    var recommended = (avg === null && floor === null) ? null
      : Math.max(whole(Math.max(avg || 0, floor || 0)), floorUp);

    // LR Suggested Price
    // The LR price and $5 rounding are set rules; minifigs and parts use the recommended price
    var isSet = !input.itemType || input.itemType === "set";
    var lr = isSet ? num(input.lr) : null, lrSource = lr !== null ? "dasbot" : null;
    if (lr === null && isSet) {
      if (input.stillAtRetail && rrp) { lr = rrp; lrSource = "retail"; }
      else {
        var parts = pick(nw, RULES.lrEstimateSources);
        if (parts.length) { lr = round2(mean(parts)); lrSource = "estimate"; }
      }
    }

    // 4. Normal shelf price
    var normal = null, normalSource = null;
    if (lr !== null) {
      var r = Math.round(lr / RULES.shelfRounding) * RULES.shelfRounding;
      normal = Math.max(r, floorUp);
      normalSource = (floor && r < floor) ? "floor" : "lr";
    } else if (recommended !== null) { normal = recommended; normalSource = "recommended"; }

    // Condition discount
    var discountPct = pctOf(input.discount);
    var setPrice = normal === null ? null
      : (discountPct > 0 ? whole(normal * (1 - discountPct / 100)) : Math.max(normal, floorUp));

    // Used price
    var usedCore = pick(input.used, RULES.averageSources);
    var usedList = usedCore.length ? usedCore : (input.usedOther || []).map(num).filter(function (v) { return v !== null; });
    var usedAvg = usedList.length ? round2(mean(usedList)) : null;
    var usedPrice = usedAvg === null ? null : whole(usedAvg);

    var rate = rateOf(input.consignmentRate);
    var spread = core.length > 1 ? Math.max.apply(null, core) / Math.min.apply(null, core) : 1;

    return {
      avgMarketValue: avg,
      sourcesInAverage: core.length,
      sourceRange: core.length ? [Math.min.apply(null, core), Math.max.apply(null, core)] : null,
      wideSpread: spread >= 1.35,
      priceFloor: floor,
      recommendedPrice: recommended,
      lrSuggestedPrice: lr,
      lrSource: lrSource,                 // "dasbot" | "retail" | "estimate" | null
      normalShelfPrice: normal,
      normalSource: normalSource,         // "lr" | "floor" | "recommended" | null
      discountPct: discountPct,
      setPrice: setPrice,
      belowRetail: !!(floor && setPrice !== null && setPrice < floor),
      usedAvgMarketValue: usedAvg,
      usedSources: usedList.length,
      usedFrom: usedCore.length ? "core" : (usedList.length ? "other" : null),
      usedPrice: usedPrice,
      consignmentRate: rate,
      split: split(setPrice, rate),
      memberSplit: split(setPrice === null ? null : round2(setPrice * (1 - RULES.memberDiscount)), rate),
      usedSplit: split(usedPrice, rate),
      rulesVersion: RULES.version
    };
  }

  var api = { RULES: RULES, priceSet: priceSet };
  root.BrickPricing = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
