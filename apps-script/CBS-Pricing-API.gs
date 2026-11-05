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
    version: "1.3.0",
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
      "LR Suggested Price = DasBot !price when entered; otherwise the BrickEconomy new value (what DasBot shows), or retail when BrickEconomy has none.",
      "A set is never priced below retail unless a condition discount is applied.",
      "Condition discount comes off the normal shelf price and may take a damaged set below retail.",
      "Used price = average of the used figures, rounded to $1. Used is a condition discount, so it is not held to retail.",
      "Consignment split: the store keeps 35%, consignor gets 65%. Member/employee 5% is split on the discounted price."
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
    // Without a DasBot number, copy what DasBot does: BrickEconomy value, else retail
    if (lr === null && isSet) {
      var be = num(nw.brickeconomy);
      if (input.stillAtRetail && rrp) { lr = rrp; lrSource = "retail"; }   // you ticked "LEGO still sells this set"
      else if (be !== null) { lr = be; lrSource = "brickeconomy"; }
      else if (rrp) { lr = rrp; lrSource = "retail"; }
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
      lrSource: lrSource,                 // "dasbot" | "brickeconomy" | "retail" | "estimate" | null
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

/*
 * CBS Pricing API for the CBS Consignment Tracker (Google Apps Script)
 * Paste this whole file into Extensions > Apps Script in the tracker. It includes the
 * same pricing engine as Brick Price Check, so the sheet and the app always agree.
 *
 * Sheet formulas (work as soon as the script is saved):
 *   =CBS_RECOMMENDED(N2, O2, Q2, R2, J2, I2)          Brickset, BL6, BE, Brick Owl, RRP, cost
 *   =CBS_SET_PRICE(E2, N2, O2, Q2, R2, J2, I2, L2)    LR, the four sites, RRP, cost, discount
 *   =CBS_USED_PRICE(X2:AA2)                            any used figures
 *   =CBS_SPLIT(D2, "consignor")   or  "cbs"             optional 3rd argument: rate
 *
 * Web API (Deploy > New deployment > Web app), then call the /exec URL:
 *   ?set=42127              price one set from the Pricing tab
 *   ?all=1                  price every set on the Pricing tab
 *   ?rules=1                the pricing rules
 *   ?lookup=75192           live data from BrickLink, Brickset, BrickEconomy, Rebrickable (see lookup section)
 *   ?lr=140&bs=107&bl6=113.04&be=140&bo=133.02&rrp=99.99&discount=15
 *                           price from values you pass (used_bs, used_bl6, used_be, used_bo,
 *                           bl3, cost, retail=1, rate also accepted)
 */

var PRICING_SHEET = "Pricing";
var COLS = {
  set: "Set #", name: "Set name", sheetSetPrice: "Set price", lr: "LR Suggested Price",
  cost: "Initial cost (each)", rrp: "Brickset RRP", discount: "Condition discount", reason: "Discount reason",
  brickset: "Brickset value - new", bricklink6: "BrickLink 6-mo sold avg - new",
  brickeconomy: "BrickEconomy value", brickowl: "Brick Owl sold avg - new",
  // Optional columns: add them to the Pricing tab to price used copies
  used_brickset: "Brickset value - used", used_bricklink6: "BrickLink 6-mo sold avg - used",
  used_brickeconomy: "BrickEconomy value - used", used_brickowl: "Brick Owl sold avg - used"
};

/* ---------- Sheet formulas ---------- */

/** Recommended price: average of the four sites, never below retail or cost. @customfunction */
function CBS_RECOMMENDED(brickset, bricklink6, brickeconomy, brickowl, rrp, cost) {
  return BrickPricing.priceSet({ "new": { brickset: brickset, bricklink6: bricklink6, brickeconomy: brickeconomy, brickowl: brickowl }, rrp: rrp, cost: cost }).recommendedPrice || "";
}

/** Set price: LR price rounded to $5, never below retail unless discounted, minus condition discount. @customfunction */
function CBS_SET_PRICE(lr, brickset, bricklink6, brickeconomy, brickowl, rrp, cost, discount) {
  return BrickPricing.priceSet({ lr: lr, "new": { brickset: brickset, bricklink6: bricklink6, brickeconomy: brickeconomy, brickowl: brickowl }, rrp: rrp, cost: cost, discount: discount }).setPrice || "";
}

/** Used price: average of the used figures given, rounded to $1. @customfunction */
function CBS_USED_PRICE() {
  var vals = [];
  for (var i = 0; i < arguments.length; i++) {
    var a = arguments[i];
    if (Array.isArray(a)) a.forEach(function (r) { (Array.isArray(r) ? r : [r]).forEach(function (v) { vals.push(v); }); });
    else vals.push(a);
  }
  return BrickPricing.priceSet({ usedOther: vals }).usedPrice || "";
}

/** Consignment split of a price: who = "consignor" or "cbs"; rate defaults to 35%. @customfunction */
function CBS_SPLIT(price, who, rate) {
  var p = parseFloat(price); if (!(p > 0)) return "";
  var r = rate === undefined || rate === "" ? BrickPricing.RULES.consignmentRate : (rate > 1 ? rate / 100 : rate);
  var cbs = Math.round(p * r * 100) / 100;
  return String(who).toLowerCase() === "cbs" ? cbs : Math.round((p - cbs) * 100) / 100;
}

/* ---------- Web API ---------- */

function doGet(e) {
  var q = (e && e.parameter) || {};
  var out;
  try {
    if (q.config) return json_({ signIn: !!prop_("GOOGLE_CLIENT_ID"), googleClientId: prop_("GOOGLE_CLIENT_ID") || null });
    if (!q.rules) authorize_({ idToken: q.id_token, token: q.token });
    var live = q.rules ? null : (lookupRoute_(q) || syncRoute_(q));
    if (live) out = live;
    else if (q.rules) out = BrickPricing.RULES;
    else if (q.set) out = priceFromSheet_(String(q.set).trim());
    else if (q.all) out = { sets: readPricingRows_().map(priceRow_) };
    else out = priceFromParams_(q);
  } catch (err) {
    out = { error: String(err && err.message || err) };
  }
  return json_(out);
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o, null, 2)).setMimeType(ContentService.MimeType.JSON); }

/* ---------- Who may use the web app ----------
 * With GOOGLE_CLIENT_ID set: only "Sign in with Google" from an address in ALLOWED_EMAILS works.
 *   Your Google account's passkey, 2-Step Verification and password protect it; the token is ignored.
 * Without it: API_TOKEN, as before.
 * ?config=1 and ?rules=1 need no sign-in; they hold nothing private.
 */
function authorize_(cred) {
  if (prop_("GOOGLE_CLIENT_ID")) return checkGoogle_(cred.idToken);
  var need = prop_("API_TOKEN");
  if (!need) throw new Error("Set GOOGLE_CLIENT_ID (or API_TOKEN) in Script properties first; the web app refuses requests until then");
  if (cred.token !== need) throw new Error("Wrong or missing token");
  return "token";
}
function checkGoogle_(idToken) {
  if (!idToken) throw new Error("Sign in with Google first");
  var allowed = String(prop_("ALLOWED_EMAILS")).toLowerCase().split(/[\s,;]+/).filter(String);
  if (!allowed.length) throw new Error("Set ALLOWED_EMAILS in Script properties (your Google address)");
  var cache = CacheService.getScriptCache();
  var key = "gid_" + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken)).slice(0, 43);
  var known = cache.get(key);
  if (known && allowed.indexOf(known) >= 0) return known;
  // Google checks the signature and expiry; we check it was made for this app and for you
  var r = UrlFetchApp.fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken), { muteHttpExceptions: true });
  var c; try { c = JSON.parse(r.getContentText()); } catch (e) { c = {}; }
  if (r.getResponseCode() !== 200 || !c.email) throw new Error("Google sign-in expired; sign in again");
  if (c.aud !== prop_("GOOGLE_CLIENT_ID")) throw new Error("That Google sign-in was made for a different app");
  if (c.iss !== "accounts.google.com" && c.iss !== "https://accounts.google.com") throw new Error("That sign-in did not come from Google");
  if (String(c.email_verified) !== "true") throw new Error("Google has not verified that email address");
  var email = String(c.email).toLowerCase();
  if (allowed.indexOf(email) < 0) throw new Error(email + " is not allowed to use this web app");
  var left = Math.min(21600, Number(c.exp) - Math.floor(Date.now() / 1000));
  if (!(left > 0)) throw new Error("Google sign-in expired; sign in again");
  cache.put(key, email, Math.max(1, left - 30));
  return email;
}

function priceFromParams_(q) {
  return BrickPricing.priceSet({
    "new": { brickset: q.bs, bricklink6: q.bl6, brickeconomy: q.be, brickowl: q.bo, bricklink3: q.bl3 },
    used: { brickset: q.used_bs, bricklink6: q.used_bl6, brickeconomy: q.used_be, brickowl: q.used_bo },
    rrp: q.rrp, cost: q.cost, lr: q.lr, stillAtRetail: q.retail === "1" || q.retail === "true",
    discount: q.discount, consignmentRate: q.rate
  });
}

function readPricingRows_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(PRICING_SHEET);
  if (!sh) throw new Error("No tab named " + PRICING_SHEET);
  var data = sh.getDataRange().getValues();
  var head = data[0].map(function (h) { return String(h).trim(); });
  var idx = {};
  Object.keys(COLS).forEach(function (k) { idx[k] = head.indexOf(COLS[k]); });
  if (idx.set < 0) throw new Error("Pricing tab has no '" + COLS.set + "' column");
  return data.slice(1).filter(function (r) { return String(r[idx.set]).trim() !== ""; }).map(function (r) {
    var o = {};
    Object.keys(idx).forEach(function (k) { o[k] = idx[k] >= 0 ? r[idx[k]] : ""; });
    return o;
  });
}

function priceRow_(r) {
  var res = BrickPricing.priceSet({
    "new": { brickset: r.brickset, bricklink6: r.bricklink6, brickeconomy: r.brickeconomy, brickowl: r.brickowl },
    used: { brickset: r.used_brickset, bricklink6: r.used_bricklink6, brickeconomy: r.used_brickeconomy, brickowl: r.used_brickowl },
    rrp: r.rrp, cost: r.cost, lr: r.lr, discount: r.discount
  });
  res.set = String(r.set);
  res.name = r.name;
  res.discountReason = r.reason || "";
  res.sheetSetPrice = r.sheetSetPrice === "" ? null : r.sheetSetPrice;   // what the tracker shows now, incl. manual holds
  return res;
}

function priceFromSheet_(setNum) {
  var rows = readPricingRows_().filter(function (r) { return String(r.set).trim() === setNum; });
  if (!rows.length) return { error: "Set " + setNum + " is not on the Pricing tab" };
  return priceRow_(rows[0]);
}

/*
 * ---------- Live lookup: BrickLink, Brickset, BrickEconomy, Rebrickable ----------
 *
 * Keys live in Project Settings > Script properties (never in this file):
 *   REBRICKABLE_API_KEY        free: rebrickable.com > Profile > Settings > API
 *   BRICKSET_API_KEY           free: brickset.com/tools/webservices/requestkey
 *   BRICKLINK_CONSUMER_KEY, BRICKLINK_CONSUMER_SECRET, BRICKLINK_TOKEN, BRICKLINK_TOKEN_SECRET
 *                              bricklink.com > My BrickLink > API (needs a BrickLink account; register IP 0.0.0.0
 *                              for the token so Google's servers can use it)
 *   BRICKECONOMY_API_KEY       BrickEconomy Premium > API
 *   API_TOKEN                  required: every request must include &token=<same value>
 * Any source without a key is skipped and reported as "no key".
 *
 * Requests (add &token=... if API_TOKEN is set):
 *   ?lookup=75192                 auto-detects set, minifig, part or LEGO element
 *   ?lookup=sw0001&type=minifig   type = set | minifig | part | element
 *   ?lookup=3001&type=part&color=5    part in a BrickLink color id
 *   ?colors=1                     BrickLink color list
 *   ?status=1                     which sources have keys
 */

var CACHE_SECONDS = 6 * 60 * 60;
var UA = "CBS-Brick-Price-Check/1.2 (Apps Script)";

function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k) || ""; }
function hasBrickLink_() { return !!(prop_("BRICKLINK_CONSUMER_KEY") && prop_("BRICKLINK_CONSUMER_SECRET") && prop_("BRICKLINK_TOKEN") && prop_("BRICKLINK_TOKEN_SECRET")); }
function sourceStatus_() {
  return {
    rebrickable: prop_("REBRICKABLE_API_KEY") ? "ready" : "no key",
    brickset: prop_("BRICKSET_API_KEY") ? "ready" : "no key",
    bricklink: hasBrickLink_() ? "ready" : "no key",
    brickeconomy: prop_("BRICKECONOMY_API_KEY") ? "ready" : "no key",
    tokenRequired: !!prop_("API_TOKEN")
  };
}

function cached_(key, fn) {
  var c = CacheService.getScriptCache(), hit = c.get(key);
  if (hit) return JSON.parse(hit);
  var v = fn();
  try { c.put(key, JSON.stringify(v), CACHE_SECONDS); } catch (e) { /* value too large to cache */ }
  return v;
}

function fetchJson_(url, opts) {
  opts = opts || {};
  opts.muteHttpExceptions = true;
  opts.headers = opts.headers || {};
  opts.headers["User-Agent"] = UA;
  var r = UrlFetchApp.fetch(url, opts);
  var code = r.getResponseCode(), body = r.getContentText();
  var json = null;
  try { json = JSON.parse(body); } catch (e) { /* not JSON */ }
  return { code: code, json: json, text: body };
}

function num_(v) { var n = parseFloat(v); return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; }

/* ---------- Rebrickable ---------- */
function rb_(path) {
  var key = prop_("REBRICKABLE_API_KEY");
  if (!key) return { status: "no key" };
  var r = fetchJson_("https://rebrickable.com/api/v3/lego/" + path, { headers: { Authorization: "key " + key } });
  if (r.code === 404) return { status: "not found" };
  if (r.code !== 200 || !r.json) return { status: "error " + r.code };
  return { status: "ok", data: r.json };
}

/* ---------- Brickset ---------- */
function brickset_(setNum) {
  var key = prop_("BRICKSET_API_KEY");
  if (!key) return { status: "no key" };
  var url = "https://brickset.com/api/v3.asmx/getSets?apiKey=" + encodeURIComponent(key) +
    "&userHash=&params=" + encodeURIComponent(JSON.stringify({ setNumber: setNum }));
  var r = fetchJson_(url);
  if (!r.json || r.json.status !== "success") return { status: "error " + (r.json && r.json.message || r.code) };
  if (!r.json.sets || !r.json.sets.length) return { status: "not found" };
  var s = r.json.sets[0];
  return {
    status: "ok", name: s.name, year: s.year, pieces: s.pieces, minifigs: s.minifigs,
    theme: s.theme, image: s.image && s.image.imageURL,
    rrp: s.LEGOCom && s.LEGOCom.US ? num_(s.LEGOCom.US.retailPrice) : null,
    url: s.bricksetURL
  };
}

/* ---------- BrickLink (OAuth 1.0, HMAC-SHA1) ---------- */
function pct_(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, function (c) { return "%" + c.charCodeAt(0).toString(16).toUpperCase(); });
}
function bl_(path, query) {
  if (!hasBrickLink_()) return { status: "no key" };
  var url = "https://api.bricklink.com/api/store/v1" + path;
  query = query || {};
  var oauth = {
    oauth_consumer_key: prop_("BRICKLINK_CONSUMER_KEY"),
    oauth_token: prop_("BRICKLINK_TOKEN"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_nonce: Utilities.getUuid().replace(/-/g, ""),
    oauth_version: "1.0"
  };
  var all = {};
  Object.keys(query).forEach(function (k) { all[k] = String(query[k]); });
  Object.keys(oauth).forEach(function (k) { all[k] = oauth[k]; });
  var paramStr = Object.keys(all).map(function (k) { return pct_(k) + "=" + pct_(all[k]); }).sort().join("&");
  var base = "GET&" + pct_(url) + "&" + pct_(paramStr);
  var signKey = pct_(prop_("BRICKLINK_CONSUMER_SECRET")) + "&" + pct_(prop_("BRICKLINK_TOKEN_SECRET"));
  oauth.oauth_signature = Utilities.base64Encode(Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_1, base, signKey));
  var qs = Object.keys(query).map(function (k) { return pct_(k) + "=" + pct_(String(query[k])); });
  qs.push("Authorization=" + encodeURIComponent(JSON.stringify(oauth)));
  var r = fetchJson_(url + "?" + qs.join("&"));
  if (!r.json) return { status: "error " + r.code };
  var meta = r.json.meta || {};
  if (meta.code && meta.code !== 200) return { status: meta.code === 404 ? "not found" : ("error " + meta.code + " " + (meta.description || meta.message || "")) };
  return { status: "ok", data: r.json.data };
}

// Sold price guide: 6-month avg (BrickLink's window) plus a 3-month avg computed from the sale dates
function blSold_(type, no, cond, color) {
  var q = { guide_type: "sold", new_or_used: cond, currency_code: "USD" };
  if (color) q.color_id = color;
  var r = bl_("/items/" + type + "/" + encodeURIComponent(no) + "/price", q);
  if (r.status !== "ok") return { status: r.status };
  var d = r.data || {}, cutoff = Date.now() - 90 * 864e5, qty = 0, sum = 0, sales = 0;
  (d.price_detail || []).forEach(function (s) {
    var t = Date.parse(s.date_ordered);
    if (isFinite(t) && t >= cutoff) { var n = parseInt(s.quantity, 10) || 1; qty += n; sum += n * parseFloat(s.unit_price); sales++; }
  });
  return {
    status: "ok",
    avg6: num_(d.avg_price), qtyAvg6: num_(d.qty_avg_price),
    min: num_(d.min_price), max: num_(d.max_price),
    sales6: parseInt(d.unit_quantity, 10) || 0, units6: parseInt(d.total_quantity, 10) || 0,
    avg3: qty ? Math.round(sum / qty * 100) / 100 : null, sales3: sales
  };
}
function blItem_(type, no) {
  var r = bl_("/items/" + type + "/" + encodeURIComponent(no));
  if (r.status !== "ok") return { status: r.status };
  var d = r.data || {};
  var img = d.image_url || d.thumbnail_url || "";
  if (img && img.indexOf("//") === 0) img = "https:" + img;
  return { status: "ok", name: d.name, year: d.year_released, image: img, obsolete: d.is_obsolete };
}
function blColors_() {
  return cached_("bl:colors", function () {
    var r = bl_("/colors");
    if (r.status !== "ok") return { status: r.status, colors: [] };
    return { status: "ok", colors: (r.data || []).map(function (c) { return { id: c.color_id, name: c.color_name, hex: c.color_code }; }) };
  });
}

/* ---------- BrickEconomy (field names matched loosely; check ?debug=1) ---------- */
function brickeconomy_(kind, no) {
  var key = prop_("BRICKECONOMY_API_KEY");
  if (!key) return { status: "no key" };
  var r = fetchJson_("https://www.brickeconomy.com/api/v1/" + kind + "/" + encodeURIComponent(no) + "?currency=USD",
    { headers: { "x-apikey": key, Accept: "application/json" } });
  if (r.code === 404) return { status: "not found" };
  if (r.code !== 200 || !r.json) return { status: "error " + r.code };
  var d = r.json.data || r.json;
  function find(re) {
    var ks = Object.keys(d);
    for (var i = 0; i < ks.length; i++) if (re.test(ks[i]) && num_(d[ks[i]]) !== null) return num_(d[ks[i]]);
    return null;
  }
  return {
    status: "ok", name: d.name, year: d.year,
    newValue: find(/^current_value_new$|^value_new$|current.*new/i),
    usedValue: find(/^current_value_used$|^value_used$|current.*used/i),
    rrp: find(/^retail_price_us$|retail.*us/i),
    keys: Object.keys(d)
  };
}

/* ---------- Detect what a number is ---------- */
function detectType_(q) {
  if (/^fig-\d+$/i.test(q)) return "minifig";
  if (/^[a-z]{2,4}\d{3,4}[a-z]?$/i.test(q)) return "minifig";      // sw0001, cty1234, hp150
  if (/^\d{3,6}(-\d+)?$/.test(q)) return "set";                     // 75192, 75192-1 (falls back to element)
  if (/^\d{7}$/.test(q)) return "element";                          // 4211398
  return "part";                                                    // 3001, 3001pr0001, 973c01
}

function lookup_(raw, type, color, debug) {
  var q = String(raw || "").trim();
  if (!q) return { error: "Enter a set, minifig, part or element number" };
  type = (type && type !== "auto") ? type : detectType_(q);
  var key = "lk:" + type + ":" + q.toLowerCase() + ":" + (color || "");
  var res = cached_(key, function () {
    if (type === "set") {
      var r = lookupSet_(q);
      if (r.found || /-\d+$/.test(q) || !/^\d{6,7}$/.test(q)) return r;
      var e = lookupElement_(q);                                     // 6-digit numbers may be element IDs
      return e.found ? e : r;
    }
    if (type === "minifig") return lookupMinifig_(q);
    if (type === "element") return lookupElement_(q);
    return lookupPart_(q, color);
  });
  res.sourcesStatus = sourceStatus_();
  if (!debug && res.brickeconomy) delete res.brickeconomy.keys;
  return res;
}

function lookupSet_(q) {
  var full = /-\d+$/.test(q) ? q : q + "-1";
  var rb = rb_("sets/" + encodeURIComponent(full) + "/");
  var bs = brickset_(full);
  var blI = blItem_("SET", full);
  var be = brickeconomy_("set", full);
  var blN = blSold_("SET", full, "N"), blU = blSold_("SET", full, "U");
  var d = rb.data || {};
  var found = rb.status === "ok" || bs.status === "ok" || blI.status === "ok" || be.status === "ok";
  return {
    found: found, type: "set", number: full,
    name: d.name || bs.name || blI.name || be.name || "",
    year: d.year || bs.year || blI.year || be.year || null,
    pieces: d.num_parts || bs.pieces || null, minifigs: bs.minifigs || null, theme: bs.theme || null,
    image: d.set_img_url || bs.image || blI.image || "",
    rrp: bs.rrp || be.rrp || null,
    prices: {
      bricklink: { status: blN.status, new: blN, used: blU },
      brickeconomy: be,
      brickset: { status: bs.status, rrp: bs.rrp || null }
    },
    rebrickable: { status: rb.status }
  };
}

function lookupMinifig_(q) {
  // Rebrickable uses fig-000123; BrickLink and BrickEconomy use sw0001-style ids
  var rb = /^fig-/i.test(q) ? rb_("minifigs/" + encodeURIComponent(q) + "/") : rb_("minifigs/?search=" + encodeURIComponent(q) + "&page_size=1");
  var rbd = rb.data && rb.data.results ? rb.data.results[0] : rb.data;
  var blNo = /^fig-/i.test(q) ? null : q;
  var blI = blNo ? blItem_("MINIFIG", blNo) : { status: "needs BrickLink id" };
  var blN = blNo ? blSold_("MINIFIG", blNo, "N") : blI, blU = blNo ? blSold_("MINIFIG", blNo, "U") : blI;
  var be = blNo ? brickeconomy_("minifig", blNo) : { status: "needs BrickLink id" };
  return {
    found: !!(rbd || blI.status === "ok" || be.status === "ok"), type: "minifig", number: q,
    name: blI.name || (rbd && rbd.name) || be.name || "", year: blI.year || be.year || null,
    pieces: rbd ? rbd.num_parts : null, image: (rbd && rbd.set_img_url) || blI.image || "",
    rrp: null,
    prices: { bricklink: { status: blN.status, new: blN, used: blU }, brickeconomy: be },
    rebrickable: { status: rb.status, id: rbd ? rbd.set_num : null }
  };
}

function lookupPart_(q, color) {
  var rb = rb_("parts/" + encodeURIComponent(q) + "/");
  var d = rb.data || {};
  var blNo = d.external_ids && d.external_ids.BrickLink && d.external_ids.BrickLink[0] || q;
  var blI = blItem_("PART", blNo);
  var known = bl_("/items/PART/" + encodeURIComponent(blNo) + "/colors");
  var names = {};
  (blColors_().colors || []).forEach(function (c) { names[c.id] = c.name; });
  var colors = known.status === "ok" ? (known.data || []).map(function (k) { return { id: k.color_id, name: names[k.color_id] || ("Color " + k.color_id), qty: k.quantity }; }) : [];
  var useColor = color || (colors.length === 1 ? colors[0].id : null);
  var blN = useColor ? blSold_("PART", blNo, "N", useColor) : { status: colors.length ? "pick a color" : known.status };
  var blU = useColor ? blSold_("PART", blNo, "U", useColor) : blN;
  return {
    found: rb.status === "ok" || blI.status === "ok", type: "part", number: q, bricklinkNo: blNo,
    name: d.name || blI.name || "", year: d.year_from || blI.year || null,
    image: d.part_img_url || blI.image || "", rrp: null,
    color: useColor ? { id: +useColor, name: names[useColor] || "" } : null, colors: colors,
    prices: { bricklink: { status: blN.status, new: blN, used: blU } },
    rebrickable: { status: rb.status }
  };
}

function lookupElement_(q) {
  var rb = rb_("elements/" + encodeURIComponent(q) + "/");
  if (rb.status !== "ok") return { found: false, type: "element", number: q, rebrickable: { status: rb.status }, prices: {} };
  var d = rb.data, part = d.part || {}, col = d.color || {};
  var blColor = col.external_ids && col.external_ids.BrickLink && col.external_ids.BrickLink.ext_ids ? col.external_ids.BrickLink.ext_ids[0] : null;
  var r = lookupPart_(part.part_num, blColor);
  r.type = "element"; r.number = q; r.elementOf = part.part_num;
  r.image = d.element_img_url || r.image;
  if (col.name && !r.color) r.color = { id: blColor, name: col.name };
  return r;
}

/* Route lookups through doGet: call this first inside doGet (see CBS-Pricing-API.gs). */
function lookupRoute_(q) {
  var need = prop_("API_TOKEN");
  if ((q.lookup || q.colors || q.status) && need && q.token !== need) return { error: "Wrong or missing token" };
  if (q.status) return sourceStatus_();
  if (q.colors) return blColors_();
  if (q.lookup) return lookup_(q.lookup, q.type, q.color, q.debug);
  return null;
}

/*
 * ---------- Collection sync: Brickset is the master ----------
 *
 * Extra Script properties:
 *   BRICKSET_USERNAME, BRICKSET_PASSWORD        to read (and only read) your Brickset collection
 *   REBRICKABLE_USERNAME, REBRICKABLE_PASSWORD  to read and update your Rebrickable sets
 *   (or REBRICKABLE_USER_TOKEN if you already have one)
 *
 * What each site allows:
 *   Brickset     read sets with new/used quantities, and loose minifigs        -> master
 *   Rebrickable  read and write owned sets; minifigs are read-only there       -> pushed by this script
 *   BrickLink    no API for personal collections or wanted lists; the Store API
 *                inventory would list items FOR SALE, so it is never touched    -> wanted-list XML to upload
 *   BrickEconomy no collection API confirmed                                    -> CSV export
 *
 * Requests (add &id_token=... from Google sign-in, or &token=... before that is set up):
 *   GET  ?collection=1          your Brickset collection (sets + minifigs)
 *   GET  ?sync=preview          what would change on Rebrickable, plus BrickLink XML and CSV
 *   POST {"action":"apply","removeExtras":false,"token":"..."}   push to Rebrickable (in batches)
 */

var BS = "https://brickset.com/api/v3.asmx/";
var RB = "https://rebrickable.com/api/v3/";

/* ---------- Brickset ---------- */
function bsCall_(method, fields) {
  fields.apiKey = prop_("BRICKSET_API_KEY");
  if (!fields.apiKey) throw new Error("BRICKSET_API_KEY is not set");
  var r = UrlFetchApp.fetch(BS + method, { method: "post", payload: fields, muteHttpExceptions: true, headers: { "User-Agent": UA } });
  var j; try { j = JSON.parse(r.getContentText()); } catch (e) { throw new Error("Brickset " + method + ": unexpected reply (" + r.getResponseCode() + ")"); }
  if (j.status !== "success") throw new Error("Brickset " + method + ": " + (j.message || "error"));
  return j;
}
function bsHash_() {
  var p = PropertiesService.getScriptProperties(), hash = p.getProperty("BRICKSET_USER_HASH");
  if (hash) {
    try { bsCall_("checkUserHash", { userHash: hash }); return hash; } catch (e) { /* expired: log in again */ }
  }
  var u = prop_("BRICKSET_USERNAME"), pw = prop_("BRICKSET_PASSWORD");
  if (!u || !pw) throw new Error("Set BRICKSET_USERNAME and BRICKSET_PASSWORD in Script properties");
  hash = bsCall_("login", { username: u, password: pw }).hash;
  p.setProperty("BRICKSET_USER_HASH", hash);
  return hash;
}
function bricksetCollection_() {
  var hash = bsHash_(), sets = [], page = 1;
  while (true) {
    var j = bsCall_("getSets", { userHash: hash, params: JSON.stringify({ owned: 1, pageSize: 500, pageNumber: page }) });
    (j.sets || []).forEach(function (s) {
      var c = s.collection || {};
      var qty = parseInt(c.qtyOwned, 10) || 0, qNew = parseInt(c.qtyOwnedNew, 10) || 0, qUsed = parseInt(c.qtyOwnedUsed, 10) || 0;
      sets.push({
        set: s.number + "-" + (s.numberVariant || 1), name: s.name, year: s.year, theme: s.theme,
        image: s.image && s.image.imageURL, rrp: s.LEGOCom && s.LEGOCom.US ? num_(s.LEGOCom.US.retailPrice) : null,
        qty: qty || 1, qtyNew: qNew, qtyUsed: qUsed, setID: s.setID
      });
    });
    if (!j.sets || j.sets.length < 500 || page > 40) break;
    page++;
  }
  var figs = [];
  try {
    var m = bsCall_("getMinifigCollection", { userHash: hash, params: JSON.stringify({ owned: 1 }) });
    figs = (m.minifigs || []).map(function (f) {
      return { set: f.minifigNumber, name: f.name, qty: parseInt(f.ownedTotal, 10) || 0, loose: parseInt(f.ownedLoose, 10) || 0, inSets: parseInt(f.ownedInSets, 10) || 0 };
    }).filter(function (f) { return f.qty > 0; });
  } catch (e) { figs = { error: String(e.message || e) }; }
  return { sets: sets, minifigs: figs, pulled: new Date().toISOString() };
}

/* ---------- Rebrickable user sets ---------- */
function rbKey_() { var k = prop_("REBRICKABLE_API_KEY"); if (!k) throw new Error("REBRICKABLE_API_KEY is not set"); return k; }
function rbToken_() {
  var p = PropertiesService.getScriptProperties(), t = p.getProperty("REBRICKABLE_USER_TOKEN");
  if (t) return t;
  var u = prop_("REBRICKABLE_USERNAME"), pw = prop_("REBRICKABLE_PASSWORD");
  if (!u || !pw) throw new Error("Set REBRICKABLE_USERNAME and REBRICKABLE_PASSWORD (or REBRICKABLE_USER_TOKEN) in Script properties");
  var r = UrlFetchApp.fetch(RB + "users/_token/", { method: "post", payload: { username: u, password: pw }, headers: { Authorization: "key " + rbKey_(), "User-Agent": UA }, muteHttpExceptions: true });
  var j; try { j = JSON.parse(r.getContentText()); } catch (e) { j = {}; }
  t = j.user_token || j.token;
  if (!t) throw new Error("Rebrickable sign-in failed (" + r.getResponseCode() + ")");
  p.setProperty("REBRICKABLE_USER_TOKEN", t);
  return t;
}
function rbUser_(method, path, payload) {
  var opts = { method: method, headers: { Authorization: "key " + rbKey_(), "User-Agent": UA }, muteHttpExceptions: true };
  if (payload) opts.payload = payload;
  var r = UrlFetchApp.fetch(RB + "users/" + rbToken_() + "/" + path, opts);
  var code = r.getResponseCode();
  if (code === 429) throw new Error("Rebrickable is throttling requests; try again in a minute");
  var body = r.getContentText(), j = null; try { j = body ? JSON.parse(body) : null; } catch (e) { /* empty */ }
  return { code: code, json: j };
}
function rebrickableSets_() {
  var owned = {}, path = "sets/?page_size=1000", guard = 0;
  while (path && guard++ < 50) {
    var r = rbUser_("get", path);
    if (r.code !== 200 || !r.json) throw new Error("Rebrickable sets: error " + r.code);
    (r.json.results || []).forEach(function (row) {
      var sn = row.set && row.set.set_num; if (!sn) return;
      owned[sn] = (owned[sn] || 0) + (parseInt(row.quantity, 10) || 1);   // same set in several lists adds up
    });
    path = r.json.next ? r.json.next.split("/users/")[1].split("/").slice(1).join("/") : null;
    if (path) Utilities.sleep(1100);
  }
  return owned;
}

/* ---------- Plan, files, apply ---------- */
function syncPlan_() {
  var master = bricksetCollection_();
  var want = {};
  master.sets.forEach(function (s) { want[s.set] = (want[s.set] || 0) + s.qty; });
  var rb = null, rbError = null;
  try { rb = rebrickableSets_(); } catch (e) { rbError = String(e.message || e); }
  var add = [], update = [], extra = [];
  if (rb) {
    Object.keys(want).forEach(function (k) {
      if (!(k in rb)) add.push({ set: k, qty: want[k] });
      else if (rb[k] !== want[k]) update.push({ set: k, from: rb[k], qty: want[k] });
    });
    Object.keys(rb).forEach(function (k) { if (!(k in want)) extra.push({ set: k, qty: rb[k] }); });
  }
  return {
    master: { sets: master.sets.length, units: master.sets.reduce(function (a, s) { return a + s.qty; }, 0), minifigs: Array.isArray(master.minifigs) ? master.minifigs.length : 0 },
    rebrickable: rbError ? { error: rbError } : { add: add, update: update, extra: extra, inSync: !add.length && !update.length && !extra.length },
    bricklinkXml: bricklinkXml_(master),
    csv: collectionCsv_(master),
    collection: master
  };
}
function xmlEsc_(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
// BrickLink wanted-list upload format (Wanted > Upload on bricklink.com)
function bricklinkXml_(m) {
  var items = m.sets.map(function (s) {
    return "  <ITEM>\n    <ITEMTYPE>S</ITEMTYPE>\n    <ITEMID>" + xmlEsc_(s.set) + "</ITEMID>\n    <MINQTY>" + s.qty + "</MINQTY>\n    <CONDITION>" + (s.qtyUsed && !s.qtyNew ? "U" : "N") + "</CONDITION>\n  </ITEM>";
  });
  (Array.isArray(m.minifigs) ? m.minifigs : []).forEach(function (f) {
    items.push("  <ITEM>\n    <ITEMTYPE>M</ITEMTYPE>\n    <ITEMID>" + xmlEsc_(f.set) + "</ITEMID>\n    <MINQTY>" + f.qty + "</MINQTY>\n  </ITEM>");
  });
  return "<INVENTORY>\n" + items.join("\n") + "\n</INVENTORY>\n";
}
function collectionCsv_(m) {
  var q = function (v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; };
  var rows = [["Number", "Type", "Name", "Year", "Qty", "Qty new", "Qty used"]];
  m.sets.forEach(function (s) { rows.push([s.set, "Set", s.name, s.year, s.qty, s.qtyNew, s.qtyUsed]); });
  (Array.isArray(m.minifigs) ? m.minifigs : []).forEach(function (f) { rows.push([f.set, "Minifig", f.name, "", f.qty, "", ""]); });
  return rows.map(function (r) { return r.map(q).join(","); }).join("\n") + "\n";
}

// Push in batches so one run stays inside Apps Script's time limit; the app repeats until done
function syncApply_(removeExtras) {
  var plan = syncPlan_();
  if (plan.rebrickable.error) return { error: plan.rebrickable.error };
  var jobs = [];
  plan.rebrickable.add.concat(plan.rebrickable.update).forEach(function (x) { jobs.push({ set: x.set, qty: x.qty }); });
  if (removeExtras) plan.rebrickable.extra.forEach(function (x) { jobs.push({ set: x.set, qty: 0 }); });
  var started = Date.now(), done = [], failed = [];
  for (var i = 0; i < jobs.length && Date.now() - started < 270000; i++) {
    var j = jobs[i];
    // PUT creates the set if missing; quantity 0 deletes it
    var r = rbUser_("put", "sets/" + encodeURIComponent(j.set) + "/", { quantity: String(j.qty) });
    if (r.code >= 200 && r.code < 300) done.push(j); else failed.push({ set: j.set, qty: j.qty, code: r.code });
    Utilities.sleep(1100);
  }
  return { done: done, failed: failed, remaining: jobs.length - done.length - failed.length };
}

function syncRoute_(q) {
  if (q.collection) return bricksetCollection_();
  if (q.sync === "preview") return syncPlan_();
  return null;
}
function doPost(e) {
  var out;
  try {
    var body = JSON.parse(e.postData && e.postData.contents || "{}");
    authorize_({ idToken: body.id_token, token: body.token });
    if (body.action === "apply") out = syncApply_(!!body.removeExtras);
    else throw new Error("Unknown action");
  } catch (err) { out = { error: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
