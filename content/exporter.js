(function (global) {
  // `key` looks up each value on a normalized player object; `label` is what
  // actually gets written as the CSV header. csv.js stays schema-agnostic --
  // it just writes whatever headers and rows it's given -- so the mapping
  // between the two lives here instead.
  //
  // `draftTypes` restricts a field to specific draft types; omitted means
  // the field appears in every export. Sleeper reuses the same DOM column
  // for two different stats depending on draft type (dollar values in
  // auction drafts, average draft position elsewhere), so we only emit the
  // one that actually has data.
  const FIELDS = [
    { key: 'rank', label: 'Rank' },
    { key: 'playerName', label: 'Player Name' },
    { key: 'position', label: 'Position' },
    { key: 'team', label: 'Team' },
    { key: 'bye', label: 'Bye' },
    // Available / Keeper / Drafted -- set from picks API + DOM `.drafted`
    // class. Only meaningful once at least one keeper or in-progress pick
    // exists; empty otherwise, and dropped by the all-null column filter.
    { key: 'status', label: 'Status' },
    {
      key: 'keeperCost',
      label: 'Keeper Cost',
      format: (v) => (v == null ? null : `$${v}`),
    },
    { key: 'keptBy', label: 'Kept By' },
    {
      key: 'projectedAuctionValue',
      label: 'Projected Auction Value',
      draftTypes: ['auction'],
      // Format at export only; the underlying player object keeps the raw
      // number so future features (inflation calc, etc.) can do math on it.
      format: (v) => (v == null ? null : `$${v}`),
    },
    {
      // League-adjusted value: Sleeper's projection, but re-priced to what
      // players at this position/tier have historically gone for in the
      // user's league (from the past-drafts analyzer's tier cost table).
      // Blank when past-drafts data hasn't been cached yet, or for players
      // beyond the top ~12 tiers per position.
      key: 'leagueAdjustedValue',
      label: 'League-Adjusted Value',
      draftTypes: ['auction'],
      format: (v) => (v == null ? null : `$${v}`),
    },
    {
      // Signed dollar delta: Sleeper's projection minus what this league
      // would actually pay. Positive = bargain (league pays less than
      // Sleeper says), negative = expensive in this room. Only populated
      // when past-drafts data is cached AND Sleeper has a projection.
      key: 'savingsVsSleeper',
      label: 'Savings vs. Sleeper',
      draftTypes: ['auction'],
      format: (v) => {
        if (v == null) return null;
        return v >= 0 ? `+$${v}` : `-$${Math.abs(v)}`;
      },
    },
    {
      // Categorical: Bargain / Fair / Overpriced, thresholded at ±15% of
      // Sleeper's projection so tiny deltas on cheap players don't get
      // flagged as bargains just because $1 vs. $2 is technically 50% off.
      key: 'valueRating',
      label: 'Value Rating',
      draftTypes: ['auction'],
    },
    { key: 'averageDraftPosition', label: 'Average Draft Position', draftTypes: ['snake'] },
    { key: 'projectedFantasyPoints', label: 'Projected Fantasy Points' },
    { key: 'averageFantasyPoints', label: 'Average Fantasy Points' },
    { key: 'passingAttempts', label: 'Passing Attempts' },
    { key: 'passingYards', label: 'Passing Yards' },
    { key: 'passingTD', label: 'Passing TD' },
    { key: 'rushingAttempts', label: 'Rushing Attempts' },
    { key: 'rushingYards', label: 'Rushing Yards' },
    { key: 'rushingTD', label: 'Rushing TD' },
    { key: 'receptions', label: 'Receptions' },
    { key: 'receivingYards', label: 'Receiving Yards' },
    { key: 'receivingTD', label: 'Receiving TD' },
  ];

  function fieldsFor(draftType) {
    return FIELDS.filter((f) => !f.draftTypes || f.draftTypes.includes(draftType));
  }

  const MIN_AUCTION_BID = 1;
  // ±15% of Sleeper's projection defines the "Fair" band. Tuned so cheap
  // players ($1 vs. $2) don't get labeled Bargain from a trivial delta.
  const VALUE_BAND = 0.15;

  function classifyValue(projected, leagueAdjusted) {
    if (projected == null || leagueAdjusted == null || projected <= 0) return null;
    const ratio = leagueAdjusted / projected;
    if (ratio <= 1 - VALUE_BAND) return 'Bargain';
    if (ratio >= 1 + VALUE_BAND) return 'Overpriced';
    return 'Fair';
  }

  /** Every player gets a value. Three layers stacked:
   *   1. Position-ratio derived at runtime -- median of historical top-N
   *      tier prices / median of current-year top-N Sleeper projections
   *      at the same position. Captures whether this league inflates or
   *      deflates a whole position vs. Sleeper's baseline.
   *   2. Direct historical tier lookup for players who land in the top-N
   *      tier by current-year projection (more precise than ratio).
   *   3. Rookie multiplier layered on top for players with yearsExp == 0,
   *      derived from how this league has historically paid rookies at
   *      that position relative to average.
   *
   * Players without a Sleeper projection fall back to the $1 auction
   * minimum. Nothing is ever null.
   *
   * Design note: this is a math baseline, not a smart prediction. It
   * doesn't know about breakouts, injuries, coaching changes. Users who
   * want that layer feed the exported CSV to an AI. */
  function enrichWithLeagueAdjusted(players, cachedAnalysis, options) {
    // Remote kill switch. When playerValues is off, the CSV still
    // exports raw Sleeper data untouched -- we just skip the
    // league-adjusted column enrichment. downloadCSV already drops
    // fully-null columns, so leagueAdjustedValue disappears cleanly.
    const flags = (typeof window !== 'undefined' && window.DraftPilot && window.DraftPilot.featureFlags)
      || (typeof self !== 'undefined' && self.DraftPilot && self.DraftPilot.featureFlags)
      || null;
    if (flags && !flags.isEnabled('playerValues')) return players;
    if (!cachedAnalysis || !cachedAnalysis.tierAggregates) return players;
    const tierAggregates = cachedAnalysis.tierAggregates;
    const rookieMults = cachedAnalysis.rookieMultipliers || {};
    // Inflation multiplier applied to non-keeper players only. Derived
    // upstream (in ui.js) from keeper spend vs. their expected value:
    // if keepers were overpaid, remaining players deflate (<1); if kept
    // cheap, remaining players inflate (>1). Keepers themselves aren't
    // reweighted -- their price is already locked at what was paid.
    const inflationFactor = (options && options.inflationFactor) || 1;

    // Bucket players by position so we can rank each independently.
    const byPosition = new Map();
    for (const player of players) {
      if (!player.position) continue;
      if (!byPosition.has(player.position)) byPosition.set(player.position, []);
      byPosition.get(player.position).push(player);
    }

    // Layer 1: position ratio = league tier median / current Sleeper tier
    // median. Applied to any player beyond the direct tier lookup.
    const positionRatios = {};
    for (const [position, positionPlayers] of byPosition) {
      const tiers = tierAggregates[position];
      if (!tiers || !tiers.length) {
        positionRatios[position] = 1;
        continue;
      }
      const currentProjections = positionPlayers
        .filter((p) => p.projectedAuctionValue != null && p.projectedAuctionValue > 0)
        .map((p) => p.projectedAuctionValue)
        .sort((a, b) => b - a)
        .slice(0, tiers.length);
      const historicalMedian = median(tiers.map((t) => t.median));
      const currentMedian = median(currentProjections);
      positionRatios[position] =
        currentMedian > 0 && historicalMedian > 0 ? historicalMedian / currentMedian : 1;
    }

    // Assign a value to every player.
    for (const [position, positionPlayers] of byPosition) {
      const tiers = tierAggregates[position] || [];
      const rookieMult = (rookieMults[position] && rookieMults[position].multiplier) || 1;
      const positionRatio = positionRatios[position] || 1;

      const withProjection = positionPlayers
        .filter((p) => p.projectedAuctionValue != null && p.projectedAuctionValue > 0)
        .sort((a, b) => b.projectedAuctionValue - a.projectedAuctionValue);
      const projectionSet = new Set(withProjection);

      // Layered assignment for projected players.
      withProjection.forEach((player, index) => {
        let base;
        if (index < tiers.length && tiers[index].median != null) {
          // Layer 2: direct tier lookup wins for top-N ranked players.
          base = tiers[index].median;
        } else {
          // Layer 1 fallback for players beyond the top-N tiers.
          base = player.projectedAuctionValue * positionRatio;
        }
        const rookieAdjust = player.yearsExp === 0 ? rookieMult : 1;
        // Keepers keep their tier-derived value untouched so the user can
        // see what the league would normally pay. Non-keepers get the
        // inflation multiplier layered on top.
        const inflationAdjust = player.status === 'Keeper' || player.status === 'Drafted' ? 1 : inflationFactor;
        player.leagueAdjustedValue = Math.max(
          MIN_AUCTION_BID,
          Math.round(base * rookieAdjust * inflationAdjust)
        );
      });

      // Anyone without a Sleeper projection still gets the minimum bid.
      for (const player of positionPlayers) {
        if (!projectionSet.has(player)) {
          player.leagueAdjustedValue = MIN_AUCTION_BID;
        }
      }
    }

    // Layer 4: Value Finder columns. Skip when there's no projection or
    // no cached data to compare against so we don't invent signal.
    // For keepers/drafted, use the actual price paid instead of the
    // hypothetical league-adjusted value -- what was PAID is the number
    // that matters for judging whether a keeper was a bargain.
    for (const player of players) {
      if (
        player.projectedAuctionValue == null ||
        player.projectedAuctionValue <= 0
      ) {
        continue;
      }
      const isLocked = player.status === 'Keeper' || player.status === 'Drafted';
      const compareTo = isLocked && player.keeperCost != null
        ? player.keeperCost
        : player.leagueAdjustedValue;
      if (compareTo == null) continue;
      player.savingsVsSleeper = player.projectedAuctionValue - compareTo;
      player.valueRating = classifyValue(player.projectedAuctionValue, compareTo);
    }

    return players;
  }

  function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function buildFilename(date = new Date()) {
    const y = date.getFullYear();
    const m = pad(date.getMonth() + 1);
    const d = pad(date.getDate());
    const hh = pad(date.getHours());
    const mm = pad(date.getMinutes());
    return `SleeperDraft_${y}-${m}-${d}_${hh}-${mm}.csv`;
  }

  /** Builds an RFC 4180 CSV and triggers a browser download -- no chrome.downloads
   * permission needed, since a clicked <a download> anchor is enough.
   * Drops fields where every row is null so users don't see mysterious
   * empty columns (e.g. League-Adjusted Value before past drafts are loaded). */
  function downloadCSV(players, { filename, draftType = 'auction' } = {}) {
    const candidateFields = fieldsFor(draftType);
    const fields = candidateFields.filter((field) =>
      players.some((p) => p[field.key] != null)
    );
    const headers = fields.map((field) => field.label);
    const rows = players.map((player) => {
      const row = {};
      for (const { key, label, format } of fields) {
        row[label] = format ? format(player[key]) : player[key];
      }
      return row;
    });
    const csv = global.DraftPilot.csv.toCSV(rows, headers);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename || buildFilename();
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  global.DraftPilot = global.DraftPilot || {};
  global.DraftPilot.exporter = {
    downloadCSV,
    buildFilename,
    enrichWithLeagueAdjusted,
    FIELDS,
    fieldsFor,
  };
})(typeof window !== 'undefined' ? window : globalThis);
