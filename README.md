# Draft Pilot (v0.2)

A browser extension that exports Sleeper Fantasy Football draft data to CSV.
Two exports today: the currently open draft room's player list (with
projections, stats, and auction/ADP), and any of your past completed drafts'
full pick history (drafter, price, keeper flag, etc). Parser output is a
stable, normalized schema so later features — auction inflation calculator,
per-team spending analysis, live recommendations — can build on it without
touching the extraction layer.

```
Sleeper Draft Room
        │
        ▼
   DOM Parser (content/parser.js)
        │
        ▼
Normalized Player Objects
        │
   ┌────┴─────┐
   ▼          ▼
CSV Export   Future Features
(v0.1)       (auction calc, rankings, live assistant, ...)
```

## Installation (temporary / unpacked)

**Chrome**
1. Go to `chrome://extensions`.
2. Enable "Developer mode" (top right).
3. Click "Load unpacked" and select this `draftpilot/` folder.

**Firefox**
1. Go to `about:debugging#/runtime/this-firefox`.
2. Click "Load Temporary Add-on…".
3. Select `manifest.json` inside this folder.
4. Note: Firefox temporary add-ons are removed when the browser restarts —
   reload it from `about:debugging` each session during development.

## Usage

### Export the current draft room's player list

1. Open a Sleeper draft room (`sleeper.com/draft/...` or `sleeper.app/draft/...`).
2. Click the Draft Pilot toolbar icon.
3. Click **Export Draft Room**.
4. The extension auto-scrolls the player list, collects the top 500 available
   players, and downloads `SleeperDraft_YYYY-MM-DD_HH-MM.csv`.

Works pre-draft, mid-draft, and on auction / snake / dynasty formats. Drafted
players correctly disappear mid-draft.

**Bonus for auction drafts:** if you've loaded your past drafts (see below),
the CSV also includes a **League-Adjusted Value** column — Sleeper's current
projection re-priced to what players at that position/tier have historically
gone for in your league. Purely a math baseline, no narrative reasoning
(injuries, breakouts, coaching changes). Users who want that layer hand the
CSV + past-drafts export to Claude/GPT for smarter predictions.

### Export past drafts' pick history

1. Click the Draft Pilot toolbar icon (from anywhere — no need to be on Sleeper).
2. Under **Past Drafts**, enter your Sleeper username and click **Load Past Drafts**
   (the current season's draft is not listed here — export it from the "Current
   Draft Room" flow above while the draft page is open).
3. Pick a single draft from the list and click **Export** — downloads
   `SleeperDraft_{LeagueName}_{Season}_YYYY-MM-DD_HH-MM.csv`.
4. Or click **Export All (one tab per season)** to download every draft in
   one `.xlsx` workbook, with one sheet per season and a leading
   `League Name` column so multi-league seasons stay readable —
   `SleeperDrafts_All_YYYY-MM-DD_HH-MM.xlsx`.

Every completed pick is included: pick #, round, draft slot, drafter's
username / team name, player, position, NFL team, keeper flag, and — for
auction drafts — the actual dollar amount paid. Auction and non-auction
formats emit different column sets so no column is ever meaningless.

**Historical projections aren't preserved by Sleeper**, so this export
records what players actually went for but not what they were projected for
at the time. That "projected vs actual" analysis is a planned feature that
will operate on live current-season drafts, where the projection is real.

## Permissions

- `storage` — remembers your Sleeper username and the timestamp/count of
  your last exports so the popup can show them next time.
- `host_permissions` (Sleeper draft URLs + `api.sleeper.app`) — lets the
  content scripts run on Sleeper draft pages, lets the popup read the active
  tab's URL to detect whether you're on a draft page, and lets the past-drafts
  export call Sleeper's public read-only API. No broad `<all_urls>` access.

No `downloads` permission is requested — CSVs are downloaded via a plain
`<a download>` link, which needs no special permission.

## Project structure

```
draftpilot/
  manifest.json
  popup/                # toolbar popup UI
    popup.html
    popup.css
    popup.js            # orchestrates both current-draft and past-drafts flows
    pastDrafts.js       # picks API -> normalized pick objects -> CSV -> download
  content/              # injected into the Sleeper draft page
    parser.js           # DOM -> normalized player objects
    observer.js         # auto-scroll + row collection over the virtualized list
    exporter.js         # normalized objects -> CSV -> download
    ui.js               # message listener, orchestration, on-page status banner
  utils/                # shared by popup and content scripts
    csv.js              # RFC 4180 CSV encoding, not schema-specific
    sleeperApi.js       # thin fetch wrapper around api.sleeper.app
    storage.js          # chrome.storage.local wrapper
    logger.js           # info/warn/error/debug, toggleable
  vendor/
    xlsx.full.min.js    # SheetJS CE, used by the popup's Export All flow
  icons/
```

The parser and exporter are intentionally decoupled: `parser.js` only ever
produces plain player objects, and `exporter.js` only ever consumes them.
Future features (auction inflation, keeper values, rankings, live
recommendations) can read the same player objects without touching the
parsing or export code.

## Data model

Every player row becomes:

```js
{
  rank, playerName, position, team, bye,
  projectedAuctionValue, averageDraftPosition,
  projectedFantasyPoints, averageFantasyPoints,
  passingAttempts, passingYards, passingTD,
  rushingAttempts, rushingYards, rushingTD,
  receptions, receivingYards, receivingTD,
}
```

Missing data is always `null`, never a thrown error. The exported CSV uses
human-readable column headers (e.g. `Projected Auction Value`) mapped from
these keys in `content/exporter.js`; the keys themselves stay camelCase for
code that consumes the player objects directly.

**Draft-type-dependent fields:** Sleeper reuses the same `.adp` column for two
different stats depending on draft type -- a dollar estimate in auction
drafts, average draft position everywhere else (snake, linear, etc). Draft Pilot
detects the draft type from the DOM and populates exactly one of
`projectedAuctionValue` / `averageDraftPosition` per export; the other is
always `null` rather than mislabeled.

**Known gap:** Sleeper's draft board exposes receiving *targets*, not
receptions/catches, so `receptions` is currently always `null`. If receptions
matter for your use case, they'd need to come from a different data source.

## How the auto-scroll works

Sleeper's player list is virtualized (`react-virtualized`). Setting
`element.scrollTop` directly does nothing — the scroll position lives in the
component's internal state and gets reset. `observer.js` instead dispatches
synthetic `wheel` events, which the library does respond to, and collects
rows into a `Map` keyed by rank as they render, so recycled DOM nodes never
produce duplicates. It stops once the highest collected rank stays the same
for a few consecutive scroll steps, with a timeout as a backstop.

## Error handling

`ui.js` shows a small on-page banner and the popup shows an inline error for:

- not being on a Sleeper draft page
- the draft room / player grid not being found
- no players found in the list
- a scroll timeout
- any unexpected exception during export

Extraction itself never throws on a single missing field — see "Data model"
above.

## Development

No build step or bundler. Content scripts are classic (non-module) scripts
that attach their exports to a shared `window.Draft Pilot` namespace, loaded
in dependency order via `manifest.json`'s `content_scripts.js` array. Reload
the unpacked extension after editing any file.

## Roadmap

- [ ] Auction inflation calculator
- [ ] Keeper value calculations
- [ ] Custom rankings import/override
- [ ] Live in-draft player recommendations
- [ ] Roster analysis / trade calculator
- [ ] AI-powered draft strategy assistant

These are expected to consume the same normalized player objects `parser.js`
already produces, as new modules alongside `exporter.js` rather than changes
to it.
