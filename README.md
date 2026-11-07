# DrSeussFreak's Brick Checker

Look up any LEGO set, minifigure, part or element by number. Price it new and used from live market data, and keep a list of what you own.

**Use it:** https://drseussfreak.github.io/brick-price-check/

## What it does

- **Type a number and it fills in.** Name, picture, year, pieces, retail price and market prices come from BrickLink, Brickset, BrickEconomy and Rebrickable. Changing the number clears the old item's data.
- **Sets, minifigs, parts and elements.** It detects the type from the number (`75192`, `sw0001`, `3001`, `4211398`), or you can pick it. Parts are priced per color.
- **Owned list.** Add items as New or Used. Import lists exported from Brickset or Rebrickable (CSV), BrickLink (XML wanted list or inventory) or BrickEconomy (CSV), then price them all at once.

## How a set is priced

1. **Avg market value**: the average of Brickset, BrickLink 6-month sold, BrickEconomy and Brick Owl (new).
2. **Price floor**: retail (Brickset RRP), or the initial cost if that's higher.
3. **Recommended price**: the average, never below the floor.
4. **Normal shelf price**: the LR Suggested Price (DasBot `!price` in Lego_Raffles) rounded to $5, never below the floor. If you don't enter one, the BrickEconomy new value is used (that's what DasBot shows), or retail when BrickEconomy has none.
5. **Never below retail unless discounted.** Condition discounts: minor dents 5%, major crease 10%, crushed box 15%, box opened with bags sealed 15%.
6. **Used price**: the average of the used figures, rounded to $1.
7. **Consignment split**: consignor 65%, CBS 35%. The member/employee 5% is split on the discounted price.

Minifigs and parts use the recommended price; parts are priced to the cent.

## Live data setup (one time)

Live lookups run in Google Apps Script, so your API keys stay private and the sites' cross-site limits don't apply.

1. In the CBS Consignment Tracker, open **Extensions > Apps Script**. Delete everything in `Code.gs`, paste in all of [`apps-script/CBS-Pricing-API.gs`](apps-script/CBS-Pricing-API.gs), and save. It must be this tracker's own script: `?set=` and `?all=` read its Pricing tab.
2. Under **Project Settings (gear) > Script properties**, add these, spelled exactly as shown. A source without a key is skipped.

   | Property | Where to get it |
   | --- | --- |
   | `API_TOKEN` | **Required.** Any long password you make up. The app sends it with every request. |
   | `REBRICKABLE_API_KEY` | rebrickable.com > Settings > API (free) |
   | `BRICKSET_API_KEY` | brickset.com/tools/webservices/requestkey (free) |
   | `BRICKLINK_CONSUMER_KEY`, `BRICKLINK_CONSUMER_SECRET`, `BRICKLINK_TOKEN`, `BRICKLINK_TOKEN_SECRET` | bricklink.com > My BrickLink > API. For the access token's IP, try `0.0.0.0` (any IP) so Google's servers can use it. |
   | `BRICKECONOMY_API_KEY` | BrickEconomy Premium > API |
   | `BRICKSET_USERNAME`, `BRICKSET_PASSWORD` | Your Brickset sign-in, for collection sync |
   | `REBRICKABLE_USERNAME`, `REBRICKABLE_PASSWORD` | Your Rebrickable sign-in, for collection sync |

   Don't add `BRICKSET_USER_HASH` or `REBRICKABLE_USER_TOKEN`; the script saves those itself after it signs in. Anyone you give **edit** access to the tracker can see these properties, passwords included.

3. Choose **Deploy > New deployment**, type **Web app**, **Execute as: Me**, **Who has access: Anyone**. "Anyone" is required: the app calls the script from your browser without your Google sign-in, so other settings make every lookup fail. `API_TOKEN` is what keeps it private.
4. Choose **Authorize access** and allow it. The script needs to read the tracker and connect to the four sites. Copy the **Web app URL** (ends in `/exec`).
5. In the app, open **Live data connection**, paste the URL and your `API_TOKEN`, then choose **Save and test**. It lists each site as `ready` or `no key`.

After changing the script later, use **Deploy > Manage deployments > Edit > Version: New version**. The `/exec` URL keeps running the old code until you do.

## Sign in with Google (recommended)

Locks the web app to your Google account, so your passkey, 2-Step Verification and password protect your data. Nobody else can use it, even with the URL.

1. Go to [console.cloud.google.com](https://console.cloud.google.com/), create a project (any name), then open **APIs & Services > OAuth consent screen** and set it up: External, app name, your email. You don't need to add any scopes.
2. Open **APIs & Services > Credentials > Create credentials > OAuth client ID**. Pick **Web application**. Under **Authorized JavaScript origins**, add `https://drseussfreak.github.io`. Create it and copy the **Client ID** (it ends in `.apps.googleusercontent.com`).
3. In the tracker's Apps Script, add two Script properties:
   - `GOOGLE_CLIENT_ID`: the Client ID
   - `ALLOWED_EMAILS`: your Google address (separate several with commas)
4. Reload the app. It opens on a sign-in screen; nothing else shows until you sign in.

**Staying signed in:** with **Stay signed in on this device** ticked, the web app gives that browser a signed session for 30 days (set `SESSION_DAYS` to change it). Unticked, it lasts until the tab closes. **Sign out** (top right) ends it on that device. To sign out everywhere at once, delete `SESSION_SECRET` in Script properties; the script makes a new one, and every old session stops working. Removing an address from `ALLOWED_EMAILS` also ends its sessions.

The sign-in screen hides the app, but the page's code is still public on GitHub Pages. Your data is protected because the web app checks the session on every request.

Once `GOOGLE_CLIENT_ID` is set, `API_TOKEN` is ignored. The only requests that work without signing in are `?rules=1` and `?config=1`, and neither holds anything private.

## Collection sync (Brickset is the master)

Uses the Brickset and Rebrickable sign-ins from step 2.

In the app, under **Owned sets**:

- **Pull from Brickset** brings your sets (split into new and used) and loose minifigs into the owned list. Brickset quantities win. Items that disappear from Brickset are flagged, not deleted.
- **Preview sync** shows exactly what would change on Rebrickable: sets to add, quantities to change, and sets that are on Rebrickable but not in Brickset.
- **Push changes to Rebrickable** applies them, about one set per second. Sets missing from Brickset are only removed if you tick the box.
- **BrickLink** has no API for personal collections or wanted lists. Its Store API inventory would list items for sale, so it is never touched. Copy the wanted-list XML and upload it at Want > Upload instead.
- **BrickEconomy** has no confirmed collection API. Copy the collection CSV for its import, if your plan has one.
- Rebrickable minifigs are read-only there; Rebrickable works them out from your sets.

Web API: `GET ?collection=1`, `GET ?sync=preview`, and `POST {"action":"apply","removeExtras":false,"token":"..."}`.

## API

All pricing is in [`pricing.js`](pricing.js), shared by the app and the tracker.

```html
<script src="https://drseussfreak.github.io/brick-price-check/pricing.js"></script>
<script>
  const r = BrickPricing.priceSet({
    itemType: "set", lr: 140, rrp: 99.99,
    new: { brickset: 107, bricklink6: 113.04, brickeconomy: 140, brickowl: 133.02 },
    used: { bricklink6: 80 }, discount: 15
  });
  // r.setPrice, r.usedPrice, r.recommendedPrice, r.split.consignor, r.split.cbs ...
</script>
```

Rules as JSON: https://drseussfreak.github.io/brick-price-check/api/rules.json

**Sheet formulas** (after step 1): `=CBS_RECOMMENDED(N2,O2,Q2,R2,J2,I2)`, `=CBS_SET_PRICE(E2,N2,O2,Q2,R2,J2,I2,L2)`, `=CBS_USED_PRICE(range)`, `=CBS_SPLIT(D2,"consignor")`.

**Web API** (after step 3; add `&token=` if you set one):

| Request | Returns |
| --- | --- |
| `?lookup=75192` | Live data for a set, minifig, part or element (`&type=`, `&color=` optional) |
| `?set=42127` | That set priced from the tracker's Pricing tab |
| `?all=1` | Every set on the Pricing tab |
| `?colors=1` | BrickLink colors |
| `?status=1` | Which sources have keys |
| `?rules=1` | The pricing rules |

Every request except `?rules=1` and `?config=1` is refused unless you are signed in with Google (or, before that is set up, send your `API_TOKEN`). That is why the "Anyone" deployment is safe.

Catalog and price data belong to BrickLink, Brickset, BrickEconomy and Rebrickable; each lookup links back to its source.
