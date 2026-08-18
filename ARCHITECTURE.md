# Draft Pilot — Architecture & Design Notes (v0.3)

> This is the deep technical reference for contributors. If you're a **user**
> looking to install and use Draft Pilot, start with the [README](README.md).

---


A browser extension that exports Sleeper Fantasy Football draft data to CSV.
Two exports today: the currently open draft room's player list (with
projections, stats, and auction/ADP), and any of your past completed drafts'
full pick history (drafter, price, keeper flag, etc). On top of that,
**Live Draft Mode** watches an in-progress auction and answers one question
per nomination — *"what is the most I should pay for this player, given my
roster, my remaining budget, the remaining player pool, and the current
state of the auction?"* The answer is a manager-specific **Your Max**
distinct from the player's market **Fair Value**, driven by a roster-aware
bid engine (`utils/bidEngine.js`) that reasons across roster-slot marginal
value, opportunity cost (required future budget vs. remaining budget),
scarcity, replacement depth, competition, and hard budget legality — then
compares that ceiling to the current bid to produce **BUY** / **CAUTION**
/ **PASS**. A **Positional Scarcity engine** (in `utils/analysis.js`)
answers "how hard is it to replace this level of production?" as one canonical
market calc, and derived layers turn that market number into decision-support:
**Value Cliff** (production drop after comparable alts), **Market Pressure**
(plain-language label), **Scarcity Impact** (personalized by roster need +
budget, never mutates the market score), **Pass Consequence** (what happens
if you skip), **Insight Priority** (picks THE single dominant reason to
avoid recommendation overload), and **Alternative Score** (per-candidate
0–100 replacement strength relative to the nominee — production, scarcity,
consistency, playoff, roster-fit — with auction $ exposed as separate
context, never inflating the score). Every consumer — bid rec, alternatives
panel, opportunity cost, positional snapshot — reads from that one engine.
Supporting evidence (Primary Insight, cliff line, likely competitors, biggest
threat, ranked alternatives with $-delta) sits underneath the recommendation;
a full analytical breakdown with per-lift dollar contributions lives in an
expandable panel. Parser output is a stable, normalized schema so new
features can build on it without touching the extraction layer.

```
Sleeper Draft Room ──► DOM Parser (content/parser.js)
                              │
                              ▼
                    Normalized Player Objects
                              │
   ┌──────────────────────────┼──────────────────────────┐
   ▼                          ▼                          ▼
CSV / XLSX Export     League Analysis            Live Draft Mode
(content/exporter.js) (utils/analysis.js)        (content/liveObserver.js
                       tier aggregates,           + utils/liveDraft.js
                       league-adjusted values,    + popup/popup.js panels)
                       scarcity engine +                 │
                       derived layers)                   │
                              │                          │
                              └──────────┬───────────────┘
                                         ▼
                        Scarcity engine (analysis.js) — ONE
                        canonical calc, consumed by all features:
                          computePositionalScarcity   (market)
                          computeValueCliff           (drop-off)
                          computeMarketPressure       (UI labels)
                          computeScarcityImpact       (personal)
                          computePassConsequence      (skip cost)
                          computeInsightPriority      (which reason wins)
                          computePositionalMarketSnapshot
                          computeAlternativeScore     (per-candidate
                                                      relative-to-nominee)
                          computeAlternativeCandidates(ranked 3–5 alts
                                                      + replacement +
                                                      recommendation ctx)
                                         │
                                         ▼
                        Nomination orchestrator (liveDraft.js):
                          buildNominationInsights({nom, pool, teams,
                          you, tier, scarcity, tierAggregates, ...})
                          assembles every derived layer in one pass —
                          scarcity, cliff, marketPressure,
                          scarcityImpact, primaryInsight, alternatives,
                          rec — the memoization boundary; downstream
                          consumers never recompute anything.
                                         │
                                         ▼
                        Roster-aware Max Bid engine
                        (utils/bidEngine.js — computeYourMax):
                          Fair Value   (league value × inflation —
                                        the market number)
                                +
                          Roster need  (marginal lineup value from
                                        rosterOptimizer.marginalValue
                                        — Henry problem: RB1 filled +
                                        RB2/FLEX open still HIGH need)
                                +
                          Scarcity     (dollars, only when the player
                                        fits — never lifts a bench-only
                                        role just because a position is
                                        scarce league-wide)
                                +
                          Replacement  (± based on alternatives depth)
                                +
                          Competition  (modest lift ±3%)
                                −
                          Opportunity  (required future budget vs.
                          cost         remaining budget → pressure
                                        tone → cut)
                                =
                          Your Max     (clamped by spendableIfBuy and
                                        maxLegal = remainingBudget −
                                        $1 per other open slot)
                              │
                              ▼
                       currentBid vs. Your Max ladder:
                          rv ≥ ~10% cushion  →  BUY to $X
                          rv ≥ 0             →  CAUTION · max $X
                          rv < 0             →  PASS · $Y over
                              │
                              ▼
                        + one plain-language primaryReason
                          ("Fills your RB2 and few RBs remain.")
                        + confidence (high/medium/low)
                        + ALTERNATIVES section (unchanged)
                        + Why? panel — breakdown in dollars:
                            Fair value / Roster need / Scarcity /
                            Alternatives / Competition / Budget
                            pressure / Opportunity cost / Your max
                        (legacy computeBidRecommendation stack in
                         liveDraft.js kept as a fallback for missing
                         data — see Roadmap for Stage 3 cleanup)
```

### Roster-aware Max Bid engine (`utils/bidEngine.js`, flagged `rosterAwareMaxBid`, default ON)

Pure module (`~500` lines, Node + browser exports). Single entrypoint
`computeYourMax({ nom, fairValue, currentBid, you, teams, league, draft,
format, pool, scarcity, cliff, alternatives, inflation })` returns the
full spec §24 schema — `fairValue`, `recommendedMax`, `currentBid`,
`remainingValue`, `recommendation` (BUY|CAUTION|PASS), `confidence`
(high|medium|low), `rosterNeed`, `opportunityCost`, `scarcity`,
`replacementDepth`, `competition`, `budgetPressure`, `primaryReason`,
`reasons`, `breakdown` — or `null` when it can't run (falls back to the
legacy stack in `computeBidRecommendation`).

Core reasoning, in order:

1. **Roster-slot marginal value** — builds `startingSlots[]` from Sleeper
   `draft.settings.slots_*` via `sleeperSlotAdapter.buildStartingSlots`,
   joins the user's scraped roster to `pool` projections by
   name+position, runs `rosterOptimizer.computeOptimalLineup` twice
   (baseline vs. with candidate). Normalized ratio
   `marginal / candidate.projection` classifies need:
   `≥0.60 high`, `≥0.20 moderate`, `≥0.05 low`, else `none`. This is the
   Henry-problem fix (spec §21): RB1 filled + RB2/FLEX open still
   registers as HIGH, because adding the candidate creates ~full
   projection value in the lineup.
2. **Roster-lift $** — need tone → percentage lift on Fair Value
   (`high +18% · moderate +6% · low −5% · none −30%`). Never an automatic
   PASS (spec §19).
3. **Scarcity $** — only when the player would fit (`high|moderate`
   need). CRITICAL `+15%`, HIGH `+10%`, MEDIUM `+5%`, plus `+5%` on a
   severe value cliff. Bench-only players don't inherit market scarcity
   lift (spec §10).
4. **Replacement depth trim** — from `alternatives.replacementContext.
   replacementDepth`. Strong `−5%` (comparable options remain), weak
   `+3%` (few alternatives).
5. **Competition** — `seriousCompetitors` counts teams with an eligible
   open slot and `maxBid ≥ 60% × fairValue`. Modest: `≥3 competitors
   +3%`, `0 competitors −3%`. Never a driver on its own (spec §11).
6. **Opportunity cost** — the differentiator vs. the legacy stack.
   `requiredFutureBudget` sums a per-position `RESERVE_FLOOR`
   (`QB:$4 · RB:$6 · WR:$5 · TE:$3 · K/DEF:$1`) across every remaining
   open slot except the one this player would fill; bench slots always
   reserve $1. `pressure = requiredFuture / remainingBudget`, tone at
   `<0.20 none (+3%) · <0.35 low (0) · <0.70 moderate (−7%) · else
   high (−15%)`. Floors are deliberately league-agnostic, not pool-
   derived — an earlier pool-median version over-reserved top-tier $
   for every empty slot and wiped every manager's spendable budget.
7. **Assemble & clamp** —
   `rawMax = fairValue × (1 + Σ lifts − opportunityCut)`, total lift
   clamped to `[−0.60, +0.35]`. Two hard caps:
   `maxLegal = remainingBudget − $1 × otherOpenSlots` (§15) and
   `spendableIfBuy = remainingBudget − requiredFuture` (§8). Rounded to
   integer dollars, floor $1.
8. **Ladder decision** — `remainingValue = yourMax − currentBid`;
   `rv < 0` PASS, `rv ≥ max($3, 10% of yourMax)` BUY, else CAUTION.

The design decision at every step: percentages inform the calculation,
but the decision surface is a manager-specific *ceiling* (spec §14),
not a stacked-percent adjustment of the market price. Same $35 player
can produce Your Max $40 for a needy manager with cash and Your Max
$27 for one who still owes a QB and RB with a tight cap (spec §22, §23).

**Wiring:**

- `computeBidRecommendation` in `utils/liveDraft.js:1292` short-circuits
  to `bidEngine.computeYourMax` when `rosterAwareMaxBid` is enabled and
  the engine returns non-null. `mapEngineResultToLegacyShape` preserves
  every legacy field the popup UI already reads (`action`, `headline`,
  `target`, `comfort`, `max`, `fitTone`, `fitText`, `breakdown`,
  `competitionSummary`, `biggestThreat`, `scarcityLift`, `fitLift`,
  `replacementDepth`) and adds the new ones alongside
  (`engine: 'bidEngine'`, `fairValue`, `recommendedMax`, `currentBid`,
  `remainingValue`, `recommendation`, `confidence`, `rosterNeed`,
  `opportunityCost`, `budgetPressure`, `primaryReason`).
- `buildNominationInsights` forwards `draft`, `format`, `pool` into the
  Rec so the engine can derive `startingSlots[]` — Sleeper puts
  `slots_*` on `draft.settings` for auctions, not `league.settings`, so
  the popup must also pass `session.draft` (added at
  `popup/popup.js:1683`). Without `draft`, the engine returns null and
  the legacy Rec runs.
- Popup UI: `renderRecommendation` in `popup/popup.js:2396` branches on
  `rec.engine === 'bidEngine'` and delegates to `renderMaxBidRecommendation`.
  Headline reads `BUY to $X` / `CAUTION · max $X` / `PASS · $Y over`
  with a compact sub-line `Fair $X · Bid $Y · $Z room — <primaryReason>`.
  Details panel (`renderMaxBidDetails`) renders the engine's own
  `breakdown` plus the alternatives list + confidence footnote.
  Legacy path preserved in the same functions for the fallback branch.
- Cross-poll smoothing (spec §18): `smoothMax(nomKey, rawMax)` snaps
  ±$2 wobble to the previous value on the same nominated player;
  meaningful moves ($3+, or a player change) always show through.

**Feature-flag mechanics** (`utils/featureFlags.js`): `KNOWN_FLAGS` has a
sibling `DEFAULT_OFF_FLAGS` set for gated-rollout flags — `rosterAware
MaxBid` shipped in `DEFAULT_OFF_FLAGS` (Stage 1) and was cleared out in
Stage 2 once the UI and plumbing were verified. The set is currently
empty; add a flag to it when landing another new engine behind a
default-off rollout.

**Test coverage:** `test/bidEngine.test.js` — 27 tests spanning §21
Henry problem, §19 no-auto-pass-when-position-filled, §5/§20 superflex
QB, §7/§22/§23 opportunity cost (same player different rosters), §10
scarcity gated by fit, §9 alternatives depth swing, §11 modest
competition, §15/§8 budget legality never exceeded, §16 BUY/CAUTION/
PASS ladder, no-flex format, multi-position eligibility, all §30 edge
cases, plus two coherence invariants (Fair Value ≠ Your Max in healthy
scenarios; Your Max monotonic in remaining budget).
`node --test test/*.test.js` → **148/148 pass** across all test files.

### Slot-driven roster optimizer (dependency of the roster-aware bid engine)

`utils/rosterOptimizer.js` is a league-format-agnostic engine that reasons from
three inputs — `startingSlots[]` (`{id, allowedPositions[]}`, multiple entries
for multi-slot leagues), `players[]`, and a candidate — and returns:

- `computeOptimalLineup(slots, players)` — exact max-weight bipartite matching
  (Hungarian, O(n³)) that picks the best legal assignment across arbitrary slot
  and eligibility configs. Zero hardcoded positions, slot names, or flex
  splits.
- `marginalValue(slots, roster, candidate)` — `optimalTotal(roster+cand) −
  optimalTotal(roster)`. The primitive the spec calls for: it collapses
  "positional need," "flex opportunity," and "displaces a weaker starter" into
  one number.

`utils/sleeperSlotAdapter.js` builds `startingSlots[]` from
`league.settings.slots_*` with Sleeper's default eligibility for FLEX /
SUPER_FLEX / WR_TE_FLEX / WR_RB_FLEX / IDP_FLEX, plus per-slot
`eligibilityOverrides` for non-standard configs. It emits nothing for slot
types the league doesn't set (no invented flex/superflex), and unknown
`slots_*` keys pass through as their own id so novel slot types don't silently
disappear.

Wiring today: the primary consumer is `bidEngine.computeYourMax` (see
above), which imports `rosterOptimizer` + `sleeperSlotAdapter` directly
and always uses the optimizer for the user-side lineup calc — no flag
gate. There is also a legacy parallel path in `computeBidRecommendation`
gated by the `slotDrivenOptimizer` flag that derived `fitTone` from
`marginalValue / candidateProjection` (`≥0.75 strong · ≥0.20 depth ·
else low`); it's dead code on the new-engine hot path and is scheduled
for deletion in Stage 3 alongside the rest of the legacy Rec body.
Opponent-side `bidderProfile` still uses slot-count heuristics
(unchanged) — see Roadmap for the projection-join blocker.

Test coverage: `test/rosterOptimizer.test.js` — the full 11-case spec matrix
(no-flex, +flex, superflex, superflex+flex, 1-RB, 3-RB, multi-flex,
2QB+SF, no-flex/no-SF, empty roster, near-full roster) plus multi-position
eligibility, custom slot ids, heterogeneous flex (WR/TE-only, RB/WR-only),
and adapter behavior. 26 tests.

### Alternative Score (in `utils/analysis.js`)

Answers the auction question the raw scarcity score can't: *"if I pass on
this player, how strong are my other options?"* Two exports in
`utils/analysis.js`:

- `computeAlternativeScore({ nom, candidate, scarcity, cliff, you, ... })`
  — grades one candidate on a 0–100 scale, **relative to the nominated
  player** (not independent absolute grading). Five weighted components,
  all comparing candidate → nominee: production magnitude (40%),
  positional-value modulated by shared scarcity/cliff (20%), consistency
  (15%), playoff outlook (10%), roster fit (15%). Weights are exported as
  `ALTERNATIVE_SCORE_WEIGHTS` and can be overridden per call. When
  consistency/playoff data is missing (current default — Sleeper's pool
  snapshot doesn't carry it), those weights drop out and the remainder
  renormalizes to 100 so the score stays comparable.
- `computeAlternativeCandidates({ nom, pool, picks, scarcity, cliff,
  format, you, league, tierAggregates, ... })` — ranks the whole
  undrafted-at-position pool, applies a minimum score floor
  (`ALTERNATIVE_MIN_SCORE = 55`), returns 3–5 candidates with
  `auctionContext` (per-candidate league-adjusted $ + `$X less` delta
  vs. nominee), `replacementContext` (`replacementDepth`:
  strong/moderate/weak; `strongAlternativesRemaining`; drop-off), and
  `recommendationContext` (`replaceability` 0..1; `passingRisk`:
  low/moderate/high) — the last two are what `computeBidRecommendation`
  reads to trim the scarcity premium.

Auction $ is **exposed as context, never scored**. A cheap-but-worse
player cannot out-rank a stronger-but-pricier one — production dominates.
Superflex is gated: `crossPosition: true` in a superflex league keeps the
QB pool QB-only rather than admitting FLEX-eligible substitutes (leaves
the format hook for a future policy widen).

Wiring:

- `buildNominationInsights` in `utils/liveDraft.js` calls
  `computeAlternativeCandidates` inside the same pass that already
  produces scarcity/cliff/impact — no duplicate math. It passes a
  `leagueAdjustedValueOf(player)` closure so per-candidate $ values
  reuse the exact same tier-aggregate + inflation math as the Rec.
- `computeBidRecommendation` reads `alternatives.replacementContext.
  replacementDepth`: **strong** trims the scarcity premium by 3¢ on the
  dollar and adds "Strong alternatives remain" to the reason strip;
  **weak** adds "Few comparable alternatives left". The bid math itself
  isn't replaced — only nudged.
- Popup UI: `renderAlternatives(insights.alternatives, nom, ctx)` in
  `popup/popup.js` paints a section inside `#live-nomination-card` with
  a header + depth chip + info popover, one row per candidate:
  `<name>  <NN% alternative>  $<value>  $<delta> less`. The delta anchors
  to the caller-supplied `leagueValue` so numbers agree with the Rec.
  Empty pool → section hidden. Pool present but no candidates cleared
  the floor → "No strong alternatives remaining." message (strategically
  useful, not an error).

Test coverage: `test/alternativeScore.test.js` — 19 tests covering high
vs. low similarity, production-gap magnitude, supply-vs-demand scarcity,
roster-fit collapse, playoff/consistency present-and-missing,
cheap-doesn't-inflate, draft-state removals, superflex, floor-not-padding,
deterministic outputs, weight-config sensitivity, and auction-context
sign correctness.

### Live-mode render guardrails

Three hard-won reliability constraints that any future work on
`popup/popup.js#renderNomination` must preserve:

- **Rec paints first, additive layers are try/wrapped.** The
  Recommendation is Level 1 — it must be directly visible whenever a
  nominated player has any usable projection. Every additive render
  (`renderScarcityRow`, `renderPrimaryInsight`, `renderValueCliff`,
  `renderPassConsequence`, `renderAlternatives`) runs inside its own
  `try/catch`, so a throw in any one of them cannot blank the Rec.
  A stray `ReferenceError` in `renderScarcityRow` previously took down
  the entire card — don't reintroduce an unguarded additive render.
- **Projection backfill from the loaded pool.** Sleeper's live-DOM
  scrape sometimes omits `sleeperProjection` for rookies, defenses, and
  certain kicker rows. Without a projection, `leagueValue` is null and
  the whole Rec stack collapses. `renderLiveDomState` backfills
  `nomination.sleeperProjection` from `cachedPlayerPool` (matched by
  name + position via `liveDraft.poolKey`) before computing
  `leagueValue`. When the pool ALSO lacks the player, the Rec shows a
  degraded "NO VALUE DATA — Load the player pool" state rather than
  hiding entirely (spec §9: Rec surface must never be hidden into a
  modal/tooltip).
- **New-engine renderer falls back to legacy on `rec.engine !==
  'bidEngine'`.** Both `renderRecommendation` and `renderDetailsPanel`
  branch on the engine marker at the top and keep the legacy code path
  intact underneath. `computeBidRecommendation` sets `engine:
  'bidEngine'` only when the roster-aware engine successfully returned
  a max; when the engine returns null (missing `draft.settings`,
  missing user roster, no pool for projection joins), the legacy stack
  runs and the legacy renderer takes over — no blank card. Same for
  the mapper: `mapEngineResultToLegacyShape` populates every legacy
  field the UI already reads, so downstream code that never got
  updated for the new fields keeps working.

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
  background.js         # service worker: side-panel wiring, message routing
  popup/                # toolbar popup / side-panel UI
    popup.html
    popup.css
    popup.js            # orchestrates sync, exports, and Live Draft Mode panels
                        #   (On-the-Block nomination card + Next Nomination
                        #    recommendation + Available Players live market
                        #    + "Recent activity" pick log; team-roster-needs
                        #    card is currently hidden).
                        #   renderNomination paints Rec FIRST, then wraps every
                        #   additive layer (renderScarcityRow, renderPrimary-
                        #   Insight, renderValueCliff, renderPassConsequence,
                        #   renderAlternatives) in try/catch so one bad render
                        #   can't blank the Rec. Also backfills nomination.
                        #   sleeperProjection from cachedPlayerPool when the
                        #   DOM scrape misses it (rookies, DEF, K) so
                        #   leagueValue stays populated.
                        #   renderAlternatives paints the ALTERNATIVES section
                        #   inside #live-nomination-card, reading only from
                        #   insights.alternatives -- no math in the UI.
    pastDrafts.js       # picks API -> normalized pick objects -> CSV -> download
  content/              # injected into the Sleeper draft page
    parser.js           # DOM -> normalized player objects
    observer.js         # auto-scroll + row collection over the virtualized list
    liveObserver.js     # MutationObserver on the auction panel; streams
                        #   nominations + per-team budget/roster to the popup
                        #   (team-roster-needs stream still wired; the card
                        #   that renders it is hidden for now)
    exporter.js         # normalized objects -> CSV/XLSX -> download,
                        #   applies keeper-inflation to league-adjusted values
    ui.js               # message listener, orchestration, on-page status banner
  utils/                # shared by popup and content scripts
    csv.js              # RFC 4180 CSV encoding, not schema-specific
    sleeperApi.js       # thin fetch wrapper around api.sleeper.app
    storage.js          # chrome.storage.local wrapper
    logger.js           # info/warn/error/debug, toggleable
    featureFlags.js     # remote kill-switches (docs/feature-flags.json)
    analysis.js         # tier building (gap-based, value-driven — NOT
                        #   rank-derived; hard-caps tier count at
                        #   POSITION_TIERING[pos].targetMax, trims heavy
                        #   tails via maxRanks, uses positive-gap median
                        #   with a spread-based floor so long $1 tails
                        #   can't collapse the reference gap to 0. Each
                        #   tier exposes gapToPrev / gapToNext / spread /
                        #   min / max / median / playerCount for the
                        #   debug view. See buildTiersFromScores +
                        #   test/validate-real-tiers.js),
                        #   historical $ aggregates,
                        #   positional-scarcity engine + derived layers:
                        #     computePositionalScarcity  (canonical market calc)
                        #     computeValueCliff          (production drop-off)
                        #     computeMarketPressure      (plain-language label)
                        #     computeScarcityImpact      (personal, roster-aware)
                        #     computePassConsequence     (skip-this-player cost)
                        #     computeInsightPriority     (one-reason picker)
                        #     computePositionalMarketSnapshot
                        #     computeAlternativeScore    (0..100 relative to
                        #                                 nominee: production,
                        #                                 scarcity, consistency,
                        #                                 playoff, roster fit)
                        #     computeAlternativeCandidates (top 3-5 alts +
                        #                                 auctionContext +
                        #                                 replacementDepth +
                        #                                 passingRisk)
                        #   ALTERNATIVE_SCORE_WEIGHTS is exported and
                        #   overridable per call; missing playoff/consistency
                        #   data renormalizes remaining weights to 100.
                        #   Auction $ is exposed as auctionContext, never
                        #   scored — cheap-but-worse cannot out-rank
                        #   pricier-but-stronger.
                        #   Pure functions; ONE canonical scarcity calc — every
                        #   derived layer consumes it, never rewrites it.
                        #   Personal need never mutates the market score.
    rosterOptimizer.js  # slot-driven optimizer: computeOptimalLineup +
                        #   marginalValue via exact max-weight bipartite
                        #   matching (Hungarian, O(n^3)). Pure, no
                        #   hardcoded positions/slot names/flex splits.
                        #   Reasons entirely from startingSlots[].
                        #   allowedPositions + player.eligiblePositions.
    sleeperSlotAdapter.js  # Sleeper league.settings.slots_* -> generic
                        #   startingSlots[{id, allowedPositions}]. Emits
                        #   nothing for slot types the league doesn't set
                        #   (no invented FLEX/SF). eligibilityOverrides
                        #   arg for non-standard flex configs. Also reads
                        #   draft.settings for auction drafts (same shape).
    bidEngine.js        # roster-aware Max Bid engine: computeYourMax
                        #   returns Fair Value vs Your Max, BUY/CAUTION/
                        #   PASS ladder, roster-need marginal value from
                        #   rosterOptimizer, opportunity cost via
                        #   requiredFutureBudget vs remainingBudget,
                        #   scarcity + replacement + competition adjusts,
                        #   plain-language primaryReason. Pure Node +
                        #   browser exports. Consumed by
                        #   computeBidRecommendation in liveDraft.js.
    liveDraft.js        # live session (picks poller), live inflation,
                        #   tier lookup (computeLiveTiers → findTier;
                        #   quality signal is projectedFantasyPoints when
                        #   the pool has it, auction $ as fallback —
                        #   auction $ is heavy-tailed and conflates
                        #   pricing with quality, which is what produced
                        #   the "Derrick Henry = RB Tier 12" bug before
                        #   the rewrite. Returns tierIndex, totalTiers,
                        #   rank, and scoreSource as SEPARATE fields;
                        #   describeTierComputation prints the per-player
                        #   table + tier-boundary summary),
                        #   scarcity ADAPTER (thin wrapper on the
                        #   analysis engine, preserves legacy fields),
                        #   bidder profile, legacy burn-potential
                        #   suggestNominations (retained for revertability;
                        #   no longer on the hot path),
                        #   suggestNextNomination — the strategy layer
                        #   (DRAIN / DISTRACT / TARGET / WAIT) behind the
                        #   Next Nomination card. Reuses bidderProfile +
                        #   findTier + computeLeagueAdjustedValueRange; adds
                        #   baseline-vs-inflated range for marketDeltaPct,
                        #   and a need-weighted topBidders ranking (two
                        #   open starter slots outrank a slightly larger
                        #   budget with one open slot) — no new valuation,
                        #   no duplicate math,
                        #   listAvailablePlayers — row model for the
                        #   Available Players live market (search / position
                        #   filter / sort / roster-fit chip / marketDeltaPct
                        #   / drafted-set from pool + picks union), same
                        #   canonical valuation engine as Next Nomination
                        #   and On-the-Block,
                        #   your-team scorecard, bid recommendation adapter
                        #   (computeBidRecommendation — short-circuits to
                        #   bidEngine.computeYourMax when rosterAwareMaxBid
                        #   is on, mapEngineResultToLegacyShape preserves
                        #   the pre-engine output shape for the UI; legacy
                        #   percentage-stack body kept as fallback for
                        #   missing-data cases, scheduled for Stage 3
                        #   deletion — see Roadmap),
                        #   buildNominationInsights
                        #   orchestrator (single call → scarcity + cliff +
                        #   impact + pressure + consequence + primary insight
                        #   + alternatives + rec; the memoization boundary for
                        #   the popup — accepts pool, picks, tierAggregates,
                        #   format so alternatives can compute per-candidate $
                        #   deltas using the same tier math as the Rec),
                        #   team-identity resolver (resolveYourTeam /
                        #   isYouByName) that matches the synced user_id
                        #   against every name variant Sleeper may render —
                        #   team_name, display_name, username — so the "you"
                        #   match is deterministic across browsers
                        #   (scorecard code retained but hidden in-draft)
  docs/
    feature-flags.json  # remotely-fetched kill-switch payload
    privacy.html
  prototype/            # standalone Node scripts for offline analysis R&D
  test/                 # node --test unit tests
                        #   tiers.test.js               gap-based tiering
                        #                                (incl. heavy-tail
                        #                                 regression — the
                        #                                 Derrick Henry bug)
                        #   validate-real-tiers.js      diagnostic runner
                        #                                over realistic 2025
                        #                                projected-points
                        #                                pools for QB/RB/WR/
                        #                                TE, with per-position
                        #                                tables + spot-check
                        #                                assertions. Not a
                        #                                unit test; run with
                        #                                `node test/…`
                        #   scarcity.test.js            core scarcity engine
                        #   scarcityIntegration.test.js derived layers,
                        #     personal-vs-market separation, superflex,
                        #     "scarcity ≠ auto-buy", strong-alt urgency
                        #   rosterOptimizer.test.js     slot-driven engine
                        #     + Sleeper adapter; full 11-case spec matrix
                        #     (no-flex, +flex, SF, SF+flex, 1-RB, 3-RB,
                        #     multi-flex, 2QB+SF, empty/near-full rosters)
                        #     plus multi-position eligibility + custom
                        #     slot ids + heterogeneous flex eligibility
                        #   alternativeScore.test.js    Alternative Score
                        #     engine + candidate ranking: high/low similarity,
                        #     production-gap dominance, supply-vs-demand,
                        #     roster-fit collapse, playoff/consistency
                        #     omit-and-renormalize, cheap-doesn't-inflate,
                        #     draft-state removals, superflex crossPosition
                        #     gate, floor-without-padding, deterministic
                        #     outputs, weight-config sensitivity
                        #   featureFlags.test.js        kill-switch parsing
  vendor/
    xlsx-js-style.bundle.js   # SheetJS + cell styling for the insights .xlsx
  icons/
```

The parser and exporter stay decoupled: `parser.js` only produces plain
player objects, and consumers (`exporter.js` for CSV/XLSX, `liveDraft.js`
for in-draft analysis, `analysis.js` for tier + $ aggregates) read them
without touching extraction. New downstream features (keeper values, custom
rankings, trade calc) plug in the same way.

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

**Pool snapshot (Live Mode).** `content/ui.js#savePool` writes a compact
subset of the player list to `chrome.storage.local` under `playerPool` for
the live suggester and tier engine. It carries `{ name, position, team,
projection, points, yearsExp, isDrafted }`, where `projection` is
`projectedAuctionValue` ($) and `points` is `projectedFantasyPoints` — the
tier engine prefers `points` (smoothly distributed, direct quality
measure) and falls back to `projection` on old snapshots. **Users on
snapshots captured before the tier rewrite need to re-capture their pool
to get points-based tiering; otherwise tier output is still valid but
degrades to auction-$-based clusters.**

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

Shipped:

- [x] **Value-driven positional tiers**, independent of positional rank.
      `buildTiersFromScores` in `utils/analysis.js` groups players by
      real gaps in the strength curve rather than by fixed rank buckets.
      Robust against heavy-tailed pools: the reference gap is the
      median of *positive* gaps with a spread-based floor, so a long
      flat $1 tail can't collapse it to 0 (the pre-rewrite failure mode
      that pushed players like Derrick Henry to "RB Tier 12" of 20).
      Tier count is hard-capped at `POSITION_TIERING[pos].targetMax`
      — extreme breaks may bypass `minSize` but still count against
      the cap — with a fill-to-`targetMin` pass so smooth curves don't
      degenerate to 2 tiers of 40 WRs. `computeLiveTiers` in
      `utils/liveDraft.js` prefers `projectedFantasyPoints` as the
      quality signal (falls back to auction $ on old snapshots), and
      `findTier` returns `tierIndex`, `totalTiers`, `rank`, and
      `scoreSource` as separate fields — rank and tier are structurally
      independent. Typical output on 2025 pools: QB 4 · RB 7 · WR 6 ·
      TE 5 tiers, all within configured target ranges. Diagnostic:
      `node test/validate-real-tiers.js`.
- [x] League-adjusted auction values (historical tier $ aggregates,
      keeper-inflation adjusted) in the CSV/XLSX exports
- [x] Live Draft Mode: nomination card as a decision surface — headline
      recommendation (`BID TO $X` / `PASS` / `BID IF ≤ $X`), fit chip,
      compact "why" reason line, likely-competition summary + biggest-threat
      callout, and an expandable full-breakdown panel. Recommendation is
      derived from league value, live inflation, tier scarcity, roster fit,
      opponent budgets/needs, and your remaining max legal bid.
- [x] Deterministic team-identity match: the "you" resolution uses the
      user_id stored at sync time against every name variant Sleeper
      exposes for that user (team_name, display_name, username) — decoupled
      from whichever variant Sleeper's DOM happens to render in a given
      browser, so roster fit and max-bid clamping behave identically in
      Chrome and Firefox.
- [x] **Next Nomination — strategic recommendation card.** Replaces the
      old "Suggested Nominations" list. `suggestNextNomination` in
      `utils/liveDraft.js` returns one primary + up to two secondary
      candidates tagged **DRAIN** (burn opponents' budgets on a player
      you can pass on), **DISTRACT** (attract bids away from your real
      targets), **TARGET** (fits your roster and the market moment),
      or **WAIT** (nominating now would expose your intent). The card
      renders a strategy label, player, live `Est. $L–H` range, a
      plain-English reason, up to three likely bidders with budgets, a
      `Market ±N%` chip when the live/baseline delta is meaningful
      (≥8%), and a Nominate action that copies the player name for
      pasting into Sleeper. Reuses `bidderProfile`,
      `computeLeagueAdjustedValueRange`, and `findTier` — no parallel
      valuation math. WAIT hides the action button and keeps the
      bidders block, since seeing who would push the price is the
      whole reason to hold. Failsafe: when no strategic nomination
      surfaces, renders "No clear nomination — hold off until the
      next player changes the room."
- [x] **Live auction pricing on every recommendation.** The value range
      shown on Next Nomination (and the same shape on Available
      Players) comes from `computeLeagueAdjustedValueRange` under the
      live inflation factor, with a baseline-inflation pass used only
      to compute `marketDeltaPct`. Directional movement is expressed
      as plain text (`Market +12%` / `Market -9%`) with a subtle
      warning/success color tint; no arrows, no emojis, no false
      precision. Bidder ranking on the card is need-weighted, not
      pure budget — a team with two open starter slots at the position
      correctly outranks a modestly richer team with one open slot.
- [x] **Available Players — live auction market list.** New card
      complementing Next Nomination: exploratory, not
      recommendation-driven. `listAvailablePlayers` in
      `utils/liveDraft.js` returns filtered / sorted / capped rows
      (search by name or team, position chips derived from the live
      pool, sort by live value / biggest market ± / tier / position;
      `Fits` chip when the player fills a starter slot on your
      roster). Drafted players fall off automatically via the same
      `pool.isDrafted ∪ session.picks` union used by Next Nomination.
      80-row render cap with a "N more match — narrow the filter"
      hint; hidden until the pool snapshot has been captured, so
      there is no duplicate "load the pool" CTA next to Next
      Nomination.
- [x] Legacy `suggestNominations` (burn-potential ranking) retained as
      an export for revertability; no longer wired into the UI.
- [x] Auction inflation calculator — live inflation factor with trend,
      plain-language interpretation, and per-bid actionable advice
- [x] **Positional Scarcity engine** in `utils/analysis.js` —
      `computePositionalScarcity` produces a 0–100 score + LOW/MEDIUM/
      HIGH/CRITICAL level from three weighted signals (comparable supply
      vs. demand, dropoff to replacement, overall depth), superflex-aware,
      handles missing projections and degenerate pools. Pure /
      deterministic / node-testable.
- [x] **Derived scarcity layers** in the same engine — Value Cliff,
      Market Pressure (plain-language wrapper), Scarcity Impact
      (personal, roster + budget aware), Pass Consequence, Insight
      Priority (single-reason picker), Positional Market Snapshot.
      All read the one canonical scarcity result; personal need never
      feeds back into the market score. Consumed by the bid rec's
      `scarcityLift`, the On-the-Block card's Primary Insight / cliff /
      pass-consequence rows, the Market Pressure chip, and the
      Positional Market card.
- [x] `buildNominationInsights` orchestrator in `utils/liveDraft.js` —
      one call per nomination assembles every derived layer + the bid
      recommendation, so the popup never re-derives scarcity across
      components.
- [x] **Slot-driven roster optimizer** (`utils/rosterOptimizer.js`
      + `utils/sleeperSlotAdapter.js`) — league-format-agnostic
      `computeOptimalLineup` + `marginalValue` via exact max-weight
      bipartite matching. Zero hardcoded positions, slot names, or
      FLEX/SUPERFLEX splits — reasons purely from
      `slot.allowedPositions` + `player.eligiblePositions`. Works for
      no-flex, multi-flex, 1-RB, 3-RB, 2QB+SF, heterogeneous flex
      (WR/TE-only, RB/WR-only), and any custom slot id. Wired into
      `computeBidRecommendation`'s `fitTone` for the user's team behind
      the `slotDrivenOptimizer` feature flag; old
      `describeNeed`/`bidderProfile` path remains intact when the flag
      is off or when projection data can't be joined.
- [x] **Alternative Score** (`computeAlternativeScore` +
      `computeAlternativeCandidates` in `utils/analysis.js`) — 0–100
      replacement-strength score per candidate, graded relative to the
      nominated player across production (40%) · scarcity (20%) ·
      consistency (15%) · playoff (10%) · roster fit (15%). Weights
      exported as `ALTERNATIVE_SCORE_WEIGHTS`, overridable per call;
      consistency + playoff drop out and remainder renormalizes when
      the data isn't in the pool snapshot (default today). Ranks the
      undrafted-at-position pool, returns 3–5 candidates with
      per-candidate `auctionContext` (league-adjusted $ + delta vs.
      nominee's value), `replacementContext` (`replacementDepth`:
      strong/moderate/weak; drop-off; strong-alt count), and
      `recommendationContext` (`replaceability` 0..1; `passingRisk`).
      Naming decision: user-facing label is **"Alternatives"** and
      **"NN% alternative"** — deliberately not "similar players", which
      implies raw statistical similarity rather than replaceability in
      the current auction. Auction $ is exposed as context, never
      scored: cheap-but-worse cannot out-rank pricier-but-stronger.
      Wired into `buildNominationInsights` (same pass as scarcity —
      no duplicate math) and consumed by `computeBidRecommendation`'s
      lift math (strong depth trims premium, adds "Strong alternatives
      remain" reason; weak depth adds "Few comparable alternatives
      left"). Rendered as an ALTERNATIVES section inside
      `#live-nomination-card` by `renderAlternatives` in
      `popup/popup.js`. 19 unit tests in
      `test/alternativeScore.test.js`.
- [x] **Render-guardrail hardening in the On-the-Block card** —
      `renderNomination` in `popup/popup.js` paints the Rec first and
      wraps every additive layer in try/catch so a single throw can no
      longer blank the recommendation. Also backfills
      `nomination.sleeperProjection` from the loaded player pool when
      Sleeper's DOM scrape misses it (Caleb Williams-class rookies,
      DEFs, some kickers), and shows a graceful "NO VALUE DATA — Load
      the player pool" state instead of a fully-blank card when no
      projection is available anywhere.
- [x] **Roster-aware Max Bid engine (`utils/bidEngine.js`)** — the
      full rewrite of what "the recommendation" means. Distinguishes
      Fair Value (market $) from Your Max (manager-specific ceiling)
      per spec §2. Roster need uses `rosterOptimizer.marginalValue`
      (Henry problem §21 fixed: filled RB1 + open RB2/FLEX → HIGH
      need). Opportunity cost is a first-class input: `requiredFuture
      Budget` (per-position `RESERVE_FLOOR` × remaining open slots)
      vs. `remainingBudget` produces a `budgetPressure` tone that trims
      the max — same $35 player can cap at $40 for a manager with
      slack or $27 for one with a QB and RB still to buy (§7, §22, §23).
      Hard clamps: `maxLegal = remainingBudget − $1/other slot` and
      `spendableIfBuy = remainingBudget − requiredFuture` (§8, §15).
      `remainingValue = yourMax − currentBid` drives BUY / CAUTION /
      PASS ladder (§16). Legacy `fitTone === 'low' → PASS` rule
      removed (§19). UI headline `BUY to $X` / `CAUTION · max $X` /
      `PASS · $Y over` with plain-language `primaryReason`; Why? panel
      shows dollar-terms breakdown (§27, §28). Cross-poll smoothing
      snaps ±$2 wobble (§18). Rolled out behind `rosterAwareMaxBid`
      flag (Stage 1: engine + tests + legacy-shape adapter behind
      default-off flag; Stage 2: UI redesign + flag flip). 27 tests in
      `test/bidEngine.test.js` covering every spec section that names
      a specific behavior.
- [x] **Opportunity Cost as a first-class surface** — subsumed by the
      Max Bid engine above. Not a separate chip; instead
      `opportunityCost.tone` cuts Your Max directly and appears as a
      row in the Why? panel. The engine now answers "what am I giving
      up?" as part of the ceiling, not as a warning next to a
      market-price-based recommendation.

In progress / next:

- [ ] **Stage 3 cleanup — delete the legacy Rec path.** With
      `rosterAwareMaxBid` on by default and the new UI live, the
      legacy body of `computeBidRecommendation` (`utils/liveDraft.js:
      1292`+) and the legacy branches in `renderRecommendation` +
      `renderDetailsPanel` (`popup/popup.js:2396`, `popup/popup.js:
      1844`) are dead on the hot path. Delete after a real-auction
      shakedown. The `slotDrivenOptimizer` flag also goes with it —
      the roster-aware engine imports the optimizer unconditionally.
      Keep `mapEngineResultToLegacyShape` (it's the boundary the
      downstream UI still reads through, even after cleanup).
- [ ] **Migrate remaining position-count heuristics off the optimizer**
      — opponent-side `bidderProfile` / `describeNeed` in
      `liveDraft.js` still use slot-count logic (the `bidEngine`
      itself uses a lightweight version in `seriousCompetitors` too).
      Blocker: opponent rosters carry `{position}` only — need a
      projection join (name → pool) so `marginalValue` has something
      to score for each opponent. `FLEX_SPLIT` / `SUPERFLEX_SPLIT` in
      `analysis.js` scarcity demand estimation also still use fixed
      priors; can be replaced with per-team `marginalValue` totals once
      the join lands.
- [ ] Re-enable the team-roster-needs card once the layout is redesigned
      (data stream is already flowing from `liveObserver.js`; only the
      popup render is suppressed)
- [ ] Snake-draft live assistance (best-available, tier-break alerts,
      positional-run detection) — currently auction-only
- [ ] Positional inflation breakdown (RB vs. WR spending deviations) —
      wire the existing Positional Market Snapshot into the inflation
      card so per-position pricing movement gets explained in market-
      pressure terms (spec item 11)
- [ ] Real consistency + playoff-schedule data feeding into
      Alternative Score. The engine already accepts per-player
      `consistency` and `playoff` fields and drops them out with
      weight renormalization when null; today the pool snapshot in
      `chrome.storage.local` doesn't carry either. Options: derive
      consistency from weekly variance via Sleeper's stats API; derive
      playoff outlook from NFL schedule vs. league playoff weeks. Both
      need new fetches + host permissions; either can slot in without
      changing the scoring engine.
- [ ] Keeper value calculations (surface undervalued/overvalued keepers
      pre-draft, not only mid-draft)
- [ ] Custom rankings import/override
- [ ] Roster analysis / trade calculator
- [ ] Post-draft recap view (surfaces the already-built "your team"
      scorecard — net value, verdict mix, elite starters — once the
      draft ends, where the summary is actually useful)
- [ ] AI-powered draft strategy assistant

Everything above consumes the same normalized player objects `parser.js`
already produces, as new modules alongside `exporter.js` / `liveDraft.js`
rather than changes to the extraction layer.
