/**
 * Draft Pilot analysis engine.
 *
 * Pure functions -- no I/O, no globals, no framework coupling. Consumed
 * by both the extension popup and the Node prototype runner via a shared
 * UMD-ish wrapper so there's a single source of truth. The prototype
 * (prototype/analyzers.js) requires this file; the extension attaches it
 * to window.DraftPilot.analysis via popup.html's <script> tag.
 *
 * Input shape (one entry per draft):
 *   {
 *     season, leagueId, leagueName, draftId,
 *     type: 'auction' | 'snake',
 *     budget, teams,
 *     format: { pprType, isSuperflex, twoQB, rosterSlots, teams, rounds, budget, shortLabel },
 *     picks: [{
 *       pickNo, round, draftSlot, userId, displayName, teamName,
 *       playerName, position, team, yearsExp, playerId,
 *       amount, isKeeper (boolean),
 *     }]
 *   }
 */
(function (global, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    global.DraftPilot = global.DraftPilot || {};
    global.DraftPilot.analysis = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

  function sum(arr) {
    return arr.reduce((a, b) => a + b, 0);
  }
  function mean(arr) {
    return arr.length ? sum(arr) / arr.length : 0;
  }
  function median(arr) {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  function stdDev(arr) {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    return Math.sqrt(mean(arr.map((v) => (v - m) ** 2)));
  }
  // -------------------------------------------------------------------
  // Positional tiering
  //
  // Tiers are groups of players who are reasonably interchangeable in
  // fantasy value -- NOT rank slots. The number of tiers per position
  // is driven by natural gaps in the strength curve, softly constrained
  // by human-scale target counts. Historical closing auction prices are
  // the strength score (crowd-derived valuation from the user's own
  // league) -- no new metric needed.
  //
  // Downstream consumers (findTier, computeLeagueAdjustedValue,
  // tierBreaks, exporter enrichment) read tier.median as before; the
  // playerCount + rank range fields are additive.
  // -------------------------------------------------------------------

  const POSITION_TIERING = {
    QB:  { targetMin: 4, targetMax: 5, minSize: 3, maxRanks: 24 },
    RB:  { targetMin: 6, targetMax: 8, minSize: 4, maxRanks: 40 },
    WR:  { targetMin: 6, targetMax: 8, minSize: 4, maxRanks: 40 },
    TE:  { targetMin: 5, targetMax: 6, minSize: 3, maxRanks: 20 },
    K:   { targetMin: 2, targetMax: 3, minSize: 2, maxRanks: 14 },
    DEF: { targetMin: 2, targetMax: 3, minSize: 2, maxRanks: 14 },
  };

  // Significance multipliers, applied to a *robust* reference gap:
  //   refGap = max( median(positive gaps), spread / (2 * effN) )
  // The floor keeps extremely heavy-tailed pools (long flat $1 tail)
  // from collapsing medGap to 0 -- which used to make every top-of-
  // curve gap "extreme", fragmenting the top of the pool into a solo
  // tier per player. See test/tiers.test.js "heavy-tail" cases.
  //
  //   - "extreme" (>= EXTREME_GAP_MULT * refGap): may create tiers
  //     smaller than minSize (an obvious outlier deserves its own
  //     tier). Still counts toward the hard targetMax cap.
  //   - "meaningful" (>= MEANINGFUL_GAP_MULT * refGap): candidate
  //     break gated by minSize.
  const EXTREME_GAP_MULT = 5;
  const MEANINGFUL_GAP_MULT = 1.5;

  /**
   * Build tier groups from a descending-sorted strength score array.
   * Tiers represent players whose fantasy value is close enough to be
   * reasonably interchangeable -- built from natural gaps in the
   * strength curve, hard-capped at `targetMax` so heavy-tailed pools
   * (typical of Sleeper auction $ curves) cannot fragment into 20+
   * tiny tiers.
   *
   * If `maxRanks` is provided, only the top-N players participate in
   * gap analysis; any remaining players join the final tier. This
   * keeps the flat $1 backup tail from polluting the median-gap
   * reference used to classify significance.
   */
  function buildTiersFromScores(scores, opts) {
    const { targetMax = 6, minSize = 3, maxRanks } = opts || {};
    const n = scores.length;
    if (n === 0) return [];
    if (n === 1) return [makeTier(scores, 0, 0, 0)];

    // Effective analysis window. Everything beyond effN gets absorbed
    // into the last tier at emit time so every player still has a tier.
    const effN = maxRanks && maxRanks > 0 ? Math.min(n, maxRanks) : n;
    const spread = Math.max(scores[0] - scores[effN - 1], 0.001);

    // Adjacent gaps within the effective window.
    const gaps = [];
    for (let i = 0; i < effN - 1; i++) {
      gaps.push({ idx: i, size: scores[i] - scores[i + 1] });
    }

    // Robust reference gap. Median of *positive* gaps ignores the
    // flat tail, and the spread-based floor guards against pools that
    // are still tail-heavy inside the window.
    const positiveGapSizes = gaps.map((g) => g.size).filter((s) => s > 0);
    const medPositive = positiveGapSizes.length ? median(positiveGapSizes) : 0;
    const refGap = Math.max(medPositive, spread / (2 * effN), 0.001);

    // Score every non-zero gap by significance. Sort desc so we pick
    // the biggest structural breaks first; ties broken by earlier
    // index (rewarding breaks nearer the top, where fantasy stakes
    // are highest).
    const scored = gaps
      .filter((g) => g.size > 0)
      .map((g) => ({ idx: g.idx, size: g.size, sig: g.size / refGap }))
      .sort((a, b) => b.sig - a.sig || a.idx - b.idx);

    // Hard cap: at most `targetMax - 1` breaks -> `targetMax` tiers.
    // Extreme breaks count toward the cap; they don't bypass it.
    const maxBreaks = Math.max(1, targetMax - 1);
    const chosen = new Set();
    const extremeSet = new Set();

    // Pass 1: extreme breaks. Bypass minSize but not the cap. Ordered
    // by significance so if the cap runs out we keep the biggest
    // outliers.
    for (const g of scored) {
      if (g.sig < EXTREME_GAP_MULT) break; // scored is sig-desc
      if (chosen.size >= maxBreaks) break;
      chosen.add(g.idx);
      extremeSet.add(g.idx);
    }

    // Pass 2: meaningful breaks. Gated by minSize -- won't accept a
    // break that shrinks a non-extreme tier below minSize.
    for (const g of scored) {
      if (chosen.size >= maxBreaks) break;
      if (g.sig < MEANINGFUL_GAP_MULT) break;
      if (chosen.has(g.idx)) continue;
      const trial = Array.from(chosen).concat(g.idx).sort((a, b) => a - b);
      if (validateTierSizes(trial, effN, minSize, [...extremeSet])) {
        chosen.add(g.idx);
      }
    }

    // Fill-to-targetMin pass. Smoothly decaying pools (typical WR/RB
    // curves once you're past the elite cliff) can leave the gap-based
    // pass with only 1-2 tiers because minSize rejected the mid-curve
    // breaks. When that happens, split the LARGEST remaining tier at
    // its biggest internal gap -- respecting minSize on both sides --
    // until we reach targetMin. This keeps 40-player mid-tail regions
    // from collapsing into "everyone is Tier 2".
    const { targetMin = 4 } = opts || {};
    while (chosen.size + 1 < targetMin && chosen.size < maxBreaks) {
      const currentBreaks = Array.from(chosen).sort((a, b) => a - b);
      const bounds = [0].concat(currentBreaks.map((b) => b + 1)).concat([effN]);
      // Pick the tier with the largest player count -- that's where a
      // structural sub-tier is most likely to be missed.
      let bestTierStart = 0;
      let bestTierEnd = effN - 1;
      let bestSize = 0;
      for (let i = 0; i < bounds.length - 1; i++) {
        const s = bounds[i];
        const e = bounds[i + 1] - 1;
        if (e - s + 1 > bestSize) {
          bestSize = e - s + 1;
          bestTierStart = s;
          bestTierEnd = e;
        }
      }
      if (bestSize < 2 * minSize) break; // can't split without violating minSize
      // Largest internal gap of that tier, at least minSize from either edge.
      let bestGap = -1;
      let bestIdx = -1;
      for (let i = bestTierStart + minSize - 1; i <= bestTierEnd - minSize; i++) {
        const g = scores[i] - scores[i + 1];
        if (g > bestGap) { bestGap = g; bestIdx = i; }
      }
      if (bestIdx < 0 || bestGap <= 0) break;
      chosen.add(bestIdx);
    }

    // Emit tiers. Any players outside the analysis window (effN..n-1)
    // fall into the final tier so every player still gets a tier
    // assignment.
    const breakIdxs = Array.from(chosen).sort((a, b) => a - b);
    const tiers = [];
    let start = 0;
    const endpoints = breakIdxs.concat([n - 1]);
    endpoints.forEach((endIdx, i) => {
      tiers.push(makeTier(scores, start, endIdx, i));
      start = endIdx + 1;
    });
    return tiers;
  }

  // Verify no non-extreme tier ends up smaller than minSize. Extreme
  // breaks are exempt from this check since we let them create small
  // tiers on purpose.
  function validateTierSizes(sortedBreakIdxs, n, minSize, extremeIdxs) {
    const bounds = [-1].concat(sortedBreakIdxs).concat([n - 1]);
    for (let i = 1; i < bounds.length; i++) {
      const size = bounds[i] - bounds[i - 1];
      if (size < minSize) {
        // Which break created this small tier?
        const leftBreak = bounds[i - 1] > -1 ? bounds[i - 1] : null;
        const rightBreak = bounds[i] < n - 1 ? bounds[i] : null;
        // A small tier is OK only if BOTH bounding breaks are extreme
        // (or nonexistent). Otherwise reject this configuration.
        const leftExempt = leftBreak == null || extremeIdxs.includes(leftBreak);
        const rightExempt = rightBreak == null || extremeIdxs.includes(rightBreak);
        if (!leftExempt || !rightExempt) return false;
      }
    }
    return true;
  }

  function makeTier(scores, startIdx, endIdx, tierIndex) {
    const slice = scores.slice(startIdx, endIdx + 1);
    const min = Math.min(...slice);
    const max = Math.max(...slice);
    // Gap-to-next / gap-to-prev are surfaced for the debug view so
    // "why is this a tier boundary?" is inspectable at a glance.
    const gapToNext = endIdx + 1 < scores.length ? slice[slice.length - 1] - scores[endIdx + 1] : null;
    const gapToPrev = startIdx > 0 ? scores[startIdx - 1] - slice[0] : null;
    return {
      // Kept fields that downstream consumers already read:
      rank: startIdx + 1,        // legacy compat; = startRank
      median: median(slice),
      min,
      max,
      samples: slice.length,
      // New fields:
      tierIndex,                 // 0-indexed tier number (T1 = 0)
      startRank: startIdx + 1,
      endRank: endIdx + 1,
      playerCount: slice.length,
      spread: max - min,
      gapToPrev,                 // null for the top tier
      gapToNext,                 // null for the last tier
    };
  }

  function groupBy(arr, keyFn) {
    const map = new Map();
    for (const item of arr) {
      const key = keyFn(item);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return map;
  }
  function pct(part, whole) {
    return whole > 0 ? part / whole : 0;
  }

  /** Derives a normalized `format` block for a single draft. `leagueDetail`
   * is the /league/{id} response (needed for PPR since draft metadata only
   * carries "2qb"/"std"-style labels, not the reception value). */
  function extractFormat(draft, leagueDetail) {
    const settings = draft.settings || {};
    const rec =
      (leagueDetail && leagueDetail.scoring_settings && leagueDetail.scoring_settings.rec) || 0;
    const pprType = rec >= 1 ? 'full-ppr' : rec >= 0.5 ? 'half-ppr' : 'standard';
    const slotsSuperFlex = settings.slots_super_flex || 0;
    const slotsQb = settings.slots_qb || 0;
    const isSuperflex = slotsSuperFlex > 0;
    const twoQB = slotsQb + slotsSuperFlex >= 2;

    const parts = [];
    if (twoQB) parts.push(isSuperflex ? 'Superflex' : '2QB');
    parts.push(pprType === 'full-ppr' ? 'Full PPR' : pprType === 'half-ppr' ? 'Half-PPR' : 'Standard');
    parts.push(`${settings.teams || '?'} teams`);
    if (draft.type === 'auction') parts.push(`$${settings.budget || '?'} budget`);
    else parts.push('snake');

    return {
      scoringType: (draft.metadata && draft.metadata.scoring_type) || null,
      pprType,
      pprValue: rec,
      isSuperflex,
      twoQB,
      rosterSlots: {
        QB: slotsQb,
        RB: settings.slots_rb || 0,
        WR: settings.slots_wr || 0,
        TE: settings.slots_te || 0,
        FLEX: settings.slots_flex || 0,
        SUPER_FLEX: slotsSuperFlex,
        K: settings.slots_k || 0,
        DEF: settings.slots_def || 0,
        BN: settings.slots_bn || 0,
      },
      teams: settings.teams || null,
      rounds: settings.rounds || null,
      budget: settings.budget || null,
      shortLabel: parts.join(' · '),
    };
  }

  /** Detects format changes across seasons. Returns
   * {formats: Map<label, drafts[]>, latestFormat, hasChanges}. */
  function detectFormatChanges(drafts) {
    const formats = new Map();
    for (const draft of drafts) {
      const label = draft.format.shortLabel;
      if (!formats.has(label)) formats.set(label, []);
      formats.get(label).push(draft);
    }
    const latest = [...drafts].sort((a, b) => b.season.localeCompare(a.season))[0];
    return {
      formats,
      latestFormat: latest ? latest.format.shortLabel : null,
      hasChanges: formats.size > 1,
    };
  }

  function classifyStyle(concentration) {
    if (concentration >= 0.5) return 'studs-and-duds';
    if (concentration <= 0.4) return 'balanced';
    return 'mixed';
  }

  /** Per-manager spending profile across every season provided. */
  function perManagerSpending(drafts) {
    const auctionDrafts = drafts.filter((d) => d.type === 'auction');
    const byUser = new Map();

    for (const draft of auctionDrafts) {
      const picksByUser = groupBy(draft.picks, (p) => p.userId);

      for (const [userId, picks] of picksByUser) {
        const first = picks[0];
        if (!byUser.has(userId)) {
          byUser.set(userId, {
            userId,
            displayName: first.displayName,
            teamName: first.teamName,
            seasons: [],
          });
        }

        const totalSpend = sum(picks.map((p) => p.amount || 0));
        const byPosition = {};
        for (const position of POSITIONS) {
          const positionPicks = picks.filter((p) => p.position === position);
          const positionSpend = sum(positionPicks.map((p) => p.amount || 0));
          byPosition[position] = {
            total: positionSpend,
            share: pct(positionSpend, totalSpend),
            count: positionPicks.length,
            avgPrice: positionPicks.length ? positionSpend / positionPicks.length : 0,
            topPlayers: positionPicks
              .sort((a, b) => (b.amount || 0) - (a.amount || 0))
              .slice(0, 3)
              .map((p) => ({ playerName: p.playerName, amount: p.amount })),
          };
        }

        // Top-2 pick share of budget: >=50% reads as studs-and-duds,
        // <=40% reads as balanced (thresholds tuned empirically).
        const topTwoSpend = sum(
          picks
            .map((p) => p.amount || 0)
            .sort((a, b) => b - a)
            .slice(0, 2)
        );
        const concentrationScore = pct(topTwoSpend, totalSpend);

        byUser.get(userId).seasons.push({
          season: draft.season,
          leagueName: draft.leagueName,
          totalSpend,
          budget: draft.budget,
          pickCount: picks.length,
          keeperCount: picks.filter((p) => p.isKeeper).length,
          byPosition,
          concentrationScore,
          style: classifyStyle(concentrationScore),
        });
      }
    }

    const result = [];
    for (const user of byUser.values()) {
      const seasons = user.seasons;
      const avgShareByPosition = {};
      for (const position of POSITIONS) {
        avgShareByPosition[position] = mean(seasons.map((s) => s.byPosition[position].share));
      }
      const concentrations = seasons.map((s) => s.concentrationScore);
      const avgConcentration = mean(concentrations);
      const concentrationStdDev = stdDev(concentrations);
      const dominantStyle = classifyStyle(avgConcentration);
      const consistency = concentrationStdDev < 0.1 ? 'consistent' : 'inconsistent';

      result.push({
        ...user,
        aggregate: {
          seasonsAnalyzed: seasons.length,
          avgConcentration,
          concentrationStdDev,
          dominantStyle,
          consistency,
          avgShareByPosition,
          preferredPositions: [...POSITIONS].sort(
            (a, b) => avgShareByPosition[b] - avgShareByPosition[a]
          ),
        },
      });
    }
    return result.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
  }

  /** League-wide positional pricing tiers, per season and averaged. */
  function leaguePositionalTrends(drafts) {
    const auctionDrafts = drafts.filter((d) => d.type === 'auction');
    const bySeason = [];

    // Widen the per-season sample so tier detection has late-round
    // context to compute gaps against. Position-specific caps live on
    // POSITION_TIERING.maxRanks; anything beyond is late-round noise.
    for (const draft of auctionDrafts) {
      const byPosition = {};
      for (const position of POSITIONS) {
        const cfg = POSITION_TIERING[position] || { maxRanks: 12 };
        const positionPicks = draft.picks
          .filter((p) => p.position === position && p.amount != null && p.amount > 0)
          .sort((a, b) => (b.amount || 0) - (a.amount || 0));
        byPosition[position] = {
          totalSpend: sum(positionPicks.map((p) => p.amount)),
          pickCount: positionPicks.length,
          // Keep the per-season top-N slice; tiers here remain
          // rank-indexed since they represent one season's actual
          // picks. The GROUPING happens below at the aggregate layer.
          tiers: positionPicks.slice(0, cfg.maxRanks).map((p, i) => ({
            rank: i + 1,
            playerName: p.playerName,
            amount: p.amount,
            drafter: p.displayName,
          })),
        };
      }
      bySeason.push({ season: draft.season, leagueName: draft.leagueName, byPosition });
    }

    // For each position: build a cross-season median-per-rank strength
    // curve, then feed it to buildTiersFromScores. The output is
    // meaningful groups (not one-per-rank), which the downstream
    // findTier / computeLeagueAdjustedValue / tierBreaks consumers
    // read via tier.median as before.
    const tierAggregates = {};
    for (const position of POSITIONS) {
      const cfg = POSITION_TIERING[position] || { targetMin: 4, targetMax: 6, minSize: 3, maxRanks: 20 };
      const perRankMedian = [];
      for (let rank = 1; rank <= cfg.maxRanks; rank++) {
        const amounts = bySeason
          .map((s) => s.byPosition[position].tiers[rank - 1] && s.byPosition[position].tiers[rank - 1].amount)
          .filter((v) => v != null);
        if (!amounts.length) break; // no more data at this depth
        perRankMedian.push(median(amounts));
      }
      tierAggregates[position] = buildTiersFromScores(perRankMedian, cfg);
    }

    const positionShareTrend = {};
    for (const position of POSITIONS) {
      positionShareTrend[position] = bySeason.map((s) => {
        const totalDraftSpend = sum(POSITIONS.map((p) => s.byPosition[p].totalSpend));
        return {
          season: s.season,
          share: pct(s.byPosition[position].totalSpend, totalDraftSpend),
        };
      });
    }

    return { bySeason, tierAggregates, positionShareTrend };
  }

  /**
   * Detects positional tier breaks -- the tiers where price drops sharply
   * relative to the surrounding drops. Answers "when should I stop
   * waiting and grab an RB before the run happens?"
   *
   * Two signals per drop:
   *   - dropPct: how much cheaper the next tier is (e.g. 0.35 = 35% drop)
   *   - severity: dropPct minus the position's average drop, so a break
   *     is only meaningful if it stands out from the position's normal
   *     tier-to-tier decay. Prevents flagging every drop in a position
   *     that just decays steadily.
   *
   * `isBiggest` marks each position's most severe break; `isMeaningful`
   * additionally filters out tiny relative drops (< 20% drop AND < 1.5x
   * the average drop) so the output only surfaces genuine cliffs.
   */
  function tierBreaks(trends, options) {
    if (!trends || !trends.tierAggregates) return {};
    // Budget-proportional noise floor: 2.5% of budget filters out K/DEF
    // trivial-dollar cliffs consistently across formats. $5 for a $200
    // budget, $12.50 for $500, $2.50 for $100. Defaults to $5 when no
    // budget is passed (single-league backwards compat).
    const budget = (options && options.budget) || 200;
    const noiseFloor = Math.max(1, budget * 0.025);
    const result = {};
    for (const position of POSITIONS) {
      const tiers = trends.tierAggregates[position] || [];
      if (tiers.length < 2) {
        result[position] = { breaks: [] };
        continue;
      }
      const drops = [];
      for (let i = 0; i < tiers.length - 1; i++) {
        const from = tiers[i];
        const to = tiers[i + 1];
        if (!from.median || from.median <= 0 || to.median == null) continue;
        const dropPct = 1 - to.median / from.median;
        drops.push({
          fromTier: from.rank,
          toTier: to.rank,
          fromPrice: from.median,
          toPrice: to.median,
          dropPct,
        });
      }
      if (!drops.length) {
        result[position] = { breaks: [] };
        continue;
      }
      const avgDrop = mean(drops.map((d) => d.dropPct));
      const withSeverity = drops.map((d) => ({
        ...d,
        severity: d.dropPct - avgDrop,
        // fromPrice >= noiseFloor filters K/DEF noise where a $2 -> $1
        // drop is technically "50%" but not actually a strategic cliff.
        // Floor scales with budget so this works across formats.
        isMeaningful:
          d.dropPct >= 0.2 && d.dropPct >= avgDrop * 1.5 && d.fromPrice >= noiseFloor,
      }));
      const biggest = withSeverity.reduce(
        (best, d) => (d.dropPct > best.dropPct ? d : best),
        withSeverity[0]
      );
      const marked = withSeverity.map((d) => ({
        ...d,
        isBiggest: d === biggest,
      }));
      result[position] = {
        avgDropPct: avgDrop,
        breaks: marked,
      };
    }
    return result;
  }

  /**
   * Per-position rookie multiplier: how much rookies (yearsExp == 0) have
   * historically been paid relative to the position's average price in
   * this league. A value of 0.65 means "rookies at this position tend to
   * go for 65% of what an average player at this position goes for"; 1.2
   * means rookies get bid up above average. Falls back to 1.0 (no
   * adjustment) when there aren't enough rookie samples for a position.
   *
   * Used at current-draft-export time to nudge Sleeper's rookie
   * projections toward what this specific league actually pays for them.
   */
  function rookieMultipliers(drafts) {
    const auctionDrafts = drafts.filter((d) => d.type === 'auction');
    const perPositionRatios = {};

    for (const draft of auctionDrafts) {
      for (const position of POSITIONS) {
        const positionPicks = draft.picks.filter(
          (p) => p.position === position && p.amount != null && p.amount > 0
        );
        const rookies = positionPicks.filter((p) => p.yearsExp === 0);
        if (rookies.length < 2 || positionPicks.length < 2) continue;

        const avgRookiePrice = mean(rookies.map((p) => p.amount));
        const avgPositionPrice = mean(positionPicks.map((p) => p.amount));
        if (avgPositionPrice === 0) continue;

        const ratio = avgRookiePrice / avgPositionPrice;
        if (!perPositionRatios[position]) perPositionRatios[position] = [];
        perPositionRatios[position].push(ratio);
      }
    }

    const result = {};
    for (const position of POSITIONS) {
      const samples = perPositionRatios[position];
      result[position] = {
        multiplier: samples && samples.length ? mean(samples) : 1,
        seasonsWithSamples: samples ? samples.length : 0,
      };
    }
    return result;
  }

  /** Delta of each manager's positional spend share vs. league median. */
  function positionOverpayVsLeague(managers, referenceBudget) {
    referenceBudget = referenceBudget || 200;
    const eligible = managers.filter((m) => m.aggregate);
    if (!eligible.length) return { leagueMedianShare: {}, perManager: [] };

    const leagueMedianShare = {};
    for (const position of POSITIONS) {
      leagueMedianShare[position] = median(
        eligible.map((m) => m.aggregate.avgShareByPosition[position])
      );
    }

    const perManager = eligible.map((m) => {
      const deltasByPosition = {};
      for (const position of POSITIONS) {
        const share = m.aggregate.avgShareByPosition[position];
        const shareDelta = share - leagueMedianShare[position];
        deltasByPosition[position] = {
          share,
          leagueMedianShare: leagueMedianShare[position],
          shareDelta,
          dollarDelta: Math.round(shareDelta * referenceBudget),
        };
      }
      const sorted = POSITIONS.slice().sort(
        (a, b) => deltasByPosition[b].shareDelta - deltasByPosition[a].shareDelta
      );
      return {
        userId: m.userId,
        displayName: m.displayName,
        teamName: m.teamName,
        deltasByPosition,
        biggestOverpay: sorted[0],
        biggestUnderpay: sorted[sorted.length - 1],
      };
    });

    return { leagueMedianShare, perManager };
  }

  function classifyTiming(ratio) {
    if (ratio == null) return 'unknown';
    if (ratio <= 0.13) return 'aggressive-front-loader';
    if (ratio >= 0.22) return 'patient-value-hunter';
    return 'typical';
  }

  /** Spending timing classification per manager. */
  function spendingTiming(drafts) {
    const auctionDrafts = drafts.filter((d) => d.type === 'auction');
    const byUser = new Map();

    for (const draft of auctionDrafts) {
      const totalPicks = draft.picks.length;
      if (!totalPicks) continue;
      const picksByUser = groupBy(draft.picks, (p) => p.userId);

      for (const [userId, picks] of picksByUser) {
        const first = picks[0];
        if (!byUser.has(userId)) {
          byUser.set(userId, {
            userId,
            displayName: first.displayName,
            teamName: first.teamName,
            seasons: [],
          });
        }

        const topPicks = [...picks]
          .filter((p) => (p.amount || 0) > 0)
          .sort((a, b) => (b.amount || 0) - (a.amount || 0))
          .slice(0, 3);
        const topPickTimingRatio = topPicks.length
          ? mean(topPicks.map((p) => (p.pickNo - 1) / (totalPicks - 1)))
          : null;

        const totalSpend = sum(picks.map((p) => p.amount || 0));
        const quartileSpend = [0, 0, 0, 0];
        for (const pick of picks) {
          if (!pick.amount) continue;
          const ratio = (pick.pickNo - 1) / totalPicks;
          const q = Math.min(3, Math.floor(ratio * 4));
          quartileSpend[q] += pick.amount;
        }
        const budgetPacing = quartileSpend.map((s) => pct(s, totalSpend));

        byUser.get(userId).seasons.push({
          season: draft.season,
          leagueName: draft.leagueName,
          topPickTimingRatio,
          budgetPacing,
          topPickAmounts: topPicks.map((p) => ({
            playerName: p.playerName,
            amount: p.amount,
            pickNo: p.pickNo,
          })),
        });
      }
    }

    const result = [];
    for (const user of byUser.values()) {
      const seasons = user.seasons;
      const avgTimingRatio = mean(
        seasons.map((s) => s.topPickTimingRatio).filter((v) => v != null)
      );
      const avgPacing = [0, 1, 2, 3].map((q) => mean(seasons.map((s) => s.budgetPacing[q])));
      result.push({
        ...user,
        aggregate: {
          seasonsAnalyzed: seasons.length,
          avgTopPickTimingRatio: avgTimingRatio,
          avgBudgetPacing: avgPacing,
          timingStyle: classifyTiming(avgTimingRatio),
        },
      });
    }
    return result.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
  }

  /**
   * Combines per-manager spending, overpay, and timing signals into a
   * scouting-report-style row per league mate. Produces both structured
   * fields (for filtering/pivoting in a spreadsheet) and a
   * plain-language narrative + strategy hint (for readers who just want
   * to know "how do I draft against this person?").
   *
   * Requires the outputs from perManagerSpending, positionOverpayVsLeague,
   * and spendingTiming so it doesn't recompute anything.
   */
  function rivalScoutingProfiles(managers, overpay, timing) {
    const overpayByUser = new Map();
    if (overpay && overpay.perManager) {
      for (const m of overpay.perManager) overpayByUser.set(m.userId, m);
    }
    const timingByUser = new Map();
    for (const t of timing || []) timingByUser.set(t.userId, t);

    return managers
      .filter((m) => m.aggregate)
      .map((m) => {
        const styleHuman = humanStyle(m.aggregate.dominantStyle);
        const timingHuman = humanTiming(
          (timingByUser.get(m.userId) || {}).aggregate &&
            timingByUser.get(m.userId).aggregate.timingStyle
        );
        const overpayEntry = overpayByUser.get(m.userId);
        const overpayPos = overpayEntry && overpayEntry.biggestOverpay;
        const overpayData =
          overpayEntry && overpayEntry.deltasByPosition[overpayPos];
        const underpayPos = overpayEntry && overpayEntry.biggestUnderpay;
        const underpayData =
          overpayEntry && overpayEntry.deltasByPosition[underpayPos];

        const timingEntry = timingByUser.get(m.userId);
        const q1Share = timingEntry
          ? Math.round(timingEntry.aggregate.avgBudgetPacing[0] * 100)
          : null;

        const overpayNote =
          overpayData && overpayData.shareDelta >= 0.03
            ? {
                position: overpayPos,
                pp: Math.round(overpayData.shareDelta * 100),
                dollarDelta: overpayData.dollarDelta,
              }
            : null;
        const underpayNote =
          underpayData && underpayData.shareDelta <= -0.03
            ? {
                position: underpayPos,
                pp: Math.round(underpayData.shareDelta * 100),
                dollarDelta: underpayData.dollarDelta,
              }
            : null;

        return {
          userId: m.userId,
          displayName: m.displayName,
          teamName: m.teamName || null,
          style: styleHuman,
          consistency: humanConsistency(m.aggregate.consistency),
          topPickShare: m.aggregate.avgConcentration,
          timing: timingHuman,
          q1SharePct: q1Share,
          overpay: overpayNote,
          underpay: underpayNote,
          preferredPositions: m.aggregate.preferredPositions.slice(0, 3),
          narrative: buildNarrative({
            name: m.displayName,
            style: styleHuman,
            consistency: humanConsistency(m.aggregate.consistency),
            topPickShare: m.aggregate.avgConcentration,
            timing: timingHuman,
            q1Share,
            overpay: overpayNote,
            underpay: underpayNote,
            preferred: m.aggregate.preferredPositions[0],
          }),
          strategy: buildStrategy({
            style: m.aggregate.dominantStyle,
            timing: (timingByUser.get(m.userId) || {}).aggregate &&
              timingByUser.get(m.userId).aggregate.timingStyle,
            overpay: overpayNote,
          }),
        };
      })
      .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
  }

  function humanStyle(kebab) {
    if (kebab === 'studs-and-duds') return 'Studs and Duds';
    if (kebab === 'balanced') return 'Balanced';
    return 'Mixed';
  }
  function humanTiming(kebab) {
    if (kebab === 'aggressive-front-loader') return 'Aggressive Front-Loader';
    if (kebab === 'patient-value-hunter') return 'Patient Value Hunter';
    return 'Typical';
  }
  function humanConsistency(kebab) {
    return kebab === 'consistent' ? 'Consistent' : 'Inconsistent';
  }

  function buildNarrative({
    name,
    style,
    consistency,
    topPickShare,
    timing,
    q1Share,
    overpay,
    underpay,
    preferred,
  }) {
    const parts = [];
    const topPct = Math.round(topPickShare * 100);
    parts.push(
      `${name} — ${style.toLowerCase()} spender (~${topPct}% of budget on top 2 picks, ${consistency.toLowerCase()} year over year).`
    );
    if (overpay) {
      parts.push(
        `Overpays ${overpay.position} by +${overpay.pp}pp vs. league median (~$${overpay.dollarDelta} more per draft).`
      );
    }
    if (underpay) {
      const absPp = Math.abs(underpay.pp);
      const absDollar = Math.abs(underpay.dollarDelta);
      parts.push(
        `Underspends on ${underpay.position} (-${absPp}pp, ~$${absDollar} less per draft).`
      );
    }
    if (timing === 'Aggressive Front-Loader' && q1Share != null) {
      parts.push(
        `Aggressive front-loader: about ${q1Share}% of budget is gone by the end of Q1.`
      );
    } else if (timing === 'Patient Value Hunter' && q1Share != null) {
      parts.push(
        `Patient value hunter: only ~${q1Share}% spent in Q1, waiting for mid-draft deals.`
      );
    } else if (q1Share != null) {
      parts.push(`Typical pacing (~${q1Share}% spent in Q1).`);
    }
    if (preferred && !overpay) {
      parts.push(`Historically leans toward ${preferred}.`);
    }
    return parts.join(' ');
  }

  function buildStrategy({ style, timing, overpay }) {
    const hints = [];
    if (timing === 'aggressive-front-loader' && overpay) {
      hints.push(
        `Nominate top ${overpay.position}s early to drain their budget before they can hoard.`
      );
    } else if (timing === 'aggressive-front-loader') {
      hints.push(
        'Nominate any top-tier player early — they burn cash fast and lose leverage later.'
      );
    } else if (timing === 'patient-value-hunter') {
      hints.push(
        "Expect them to shop mid-draft. Don't let them steal value at your positions of need in Q2-Q3."
      );
    }
    if (overpay && !hints.length) {
      hints.push(
        `Avoid bidding wars at ${overpay.position} — they will out-spend you here on principle.`
      );
    }
    if (style === 'studs-and-duds') {
      hints.push(
        'Studs-and-duds: they blow the budget on 1-2 elite players. Use their thin bench as leverage in trades later.'
      );
    } else if (style === 'balanced') {
      hints.push(
        'Balanced spender: predictable, hardest to bait, hardest to steal from.'
      );
    }
    return hints.join(' ');
  }

  /** Recommends a budget split from the league's historical distribution. */
  function budgetPlanner(drafts, budget) {
    const auctionDrafts = drafts.filter((d) => d.type === 'auction');
    if (!auctionDrafts.length) return null;

    const totalByPosition = {};
    let grandTotal = 0;
    for (const draft of auctionDrafts) {
      for (const position of POSITIONS) {
        const positionSpend = sum(
          draft.picks.filter((p) => p.position === position).map((p) => p.amount || 0)
        );
        totalByPosition[position] = (totalByPosition[position] || 0) + positionSpend;
        grandTotal += positionSpend;
      }
    }

    const recommendation = {};
    const effectiveBudget = budget || (auctionDrafts[0] && auctionDrafts[0].budget) || 200;
    for (const position of POSITIONS) {
      const share = pct(totalByPosition[position], grandTotal);
      recommendation[position] = {
        historicalShare: share,
        recommendedSpend: Math.round(share * effectiveBudget),
      };
    }
    return { budget: effectiveBudget, seasonsAnalyzed: auctionDrafts.length, recommendation };
  }

  /** Keeper picks across seasons with basic per-keeper cost info. */
  function keeperRadar(drafts) {
    const keepers = [];
    for (const draft of drafts) {
      for (const pick of draft.picks) {
        if (!pick.isKeeper) continue;
        keepers.push({
          season: draft.season,
          leagueName: draft.leagueName,
          pickNo: pick.pickNo,
          round: pick.round,
          drafter: pick.displayName,
          teamName: pick.teamName,
          playerName: pick.playerName,
          position: pick.position,
          team: pick.team,
          amount: pick.amount,
        });
      }
    }
    return keepers.sort((a, b) => b.season.localeCompare(a.season) || a.pickNo - b.pickNo);
  }

  /** Top TL;DR-ready insights, drawn from the analyzers above. */
  function summarizeInsights({ managers, trends, budgetPlan, overpay, timing, breaks }) {
    const insights = [];

    if (overpay && overpay.perManager.length) {
      const rows = overpay.perManager
        .map((m) => ({
          manager: m.displayName,
          overpaysAt: m.biggestOverpay,
          overpayAmount: m.deltasByPosition[m.biggestOverpay],
        }))
        .filter((r) => r.overpayAmount.shareDelta > 0.03)
        .sort((a, b) => b.overpayAmount.shareDelta - a.overpayAmount.shareDelta)
        .slice(0, 6)
        .map((r) => ({
          manager: r.manager,
          position: r.overpaysAt,
          vsLeagueMedian: `+${(r.overpayAmount.shareDelta * 100).toFixed(0)}pp`,
          approxExtraSpend: `$${r.overpayAmount.dollarDelta}/draft`,
        }));
      insights.push({
        id: 'position-overpay-vs-median',
        title: 'Overpays vs. league median (by position)',
        rows,
      });
    }

    insights.push({
      id: 'manager-styles',
      title: 'Draft style by manager',
      rows: managers
        .filter((m) => m.aggregate)
        .map((m) => ({
          manager: m.displayName,
          style: m.aggregate.dominantStyle,
          avgConcentration: (m.aggregate.avgConcentration * 100).toFixed(0) + '%',
          consistency: m.aggregate.consistency,
        })),
    });

    if (timing && timing.length) {
      insights.push({
        id: 'spending-timing',
        title: 'Spending timing by manager',
        rows: timing
          .filter((t) => t.aggregate)
          .sort((a, b) => a.aggregate.avgTopPickTimingRatio - b.aggregate.avgTopPickTimingRatio)
          .map((t) => ({
            manager: t.displayName,
            timing: t.aggregate.timingStyle,
            bigPickAvgAt: `${(t.aggregate.avgTopPickTimingRatio * 100).toFixed(0)}% of draft`,
            Q1: (t.aggregate.avgBudgetPacing[0] * 100).toFixed(0) + '%',
            Q2: (t.aggregate.avgBudgetPacing[1] * 100).toFixed(0) + '%',
            Q3: (t.aggregate.avgBudgetPacing[2] * 100).toFixed(0) + '%',
            Q4: (t.aggregate.avgBudgetPacing[3] * 100).toFixed(0) + '%',
          })),
      });
    }

    if (budgetPlan) {
      insights.push({
        id: 'budget-plan',
        title: `Budget split ($${budgetPlan.budget}) recommended for this league`,
        rows: POSITIONS.map((position) => ({
          position,
          recommendedSpend: '$' + budgetPlan.recommendation[position].recommendedSpend,
          historicalShare:
            (budgetPlan.recommendation[position].historicalShare * 100).toFixed(0) + '%',
        })),
      });
    }

    if (trends && trends.tierAggregates) {
      const topTierRows = [];
      for (const position of POSITIONS) {
        const rank1 = trends.tierAggregates[position][0];
        if (rank1) {
          topTierRows.push({
            position,
            medianTop: '$' + rank1.median.toFixed(0),
            range: `$${rank1.min}-$${rank1.max}`,
            seasonsSeen: rank1.samples,
          });
        }
      }
      insights.push({
        id: 'top-tier-cost',
        title: `Typical top-of-position cost in this league`,
        rows: topTierRows,
      });
    }

    if (breaks) {
      // Surface the single most meaningful drop per position, if any.
      const rows = [];
      for (const position of POSITIONS) {
        const posBreaks = breaks[position] && breaks[position].breaks;
        if (!posBreaks || !posBreaks.length) continue;
        const cliff = posBreaks
          .filter((b) => b.isMeaningful)
          .sort((a, b) => b.severity - a.severity)[0];
        if (!cliff) continue;
        rows.push({
          position,
          break: `After ${position}${cliff.fromTier}`,
          dropsFrom: '$' + Math.round(cliff.fromPrice),
          to: '$' + Math.round(cliff.toPrice),
          dropPct: (cliff.dropPct * 100).toFixed(0) + '%',
        });
      }
      if (rows.length) {
        insights.push({
          id: 'tier-breaks',
          title: 'Positional cliffs (where prices fall off in your league)',
          rows,
        });
      }
    }

    return insights;
  }

  // -------------------------------------------------------------------
  // Positional scarcity engine
  //
  // Answers: "how hard is it to replace THIS level of production at this
  // position if I don't buy this player?" Deterministic, pure, and
  // decoupled from any live-draft plumbing so it can back the bid
  // recommendation, alternative-player score, opportunity cost, and any
  // future strategy feature from a single source of truth.
  //
  // Deliberately NOT just "how many players remain": 20 mediocre WRs
  // don't relieve WR scarcity if only 3 elite ones are left. The score
  // blends three signals so shallow-top and shallow-overall pools both
  // register.
  //
  // Signals (each normalized to 0..1, higher = more scarce):
  //   supply    -- comparable players remaining vs. teams still needing
  //                the position. If demand outstrips comparable supply
  //                (few similar producers, many buyers), scarce.
  //   dropoff   -- how much production falls off from the anchor player
  //                to the projected "replacement" (the next player a
  //                needy team would end up with). Big cliff = scarce.
  //   depth     -- overall pool size relative to remaining league demand.
  //                Catches "shallow pool overall" cases even when the
  //                anchor player isn't elite.
  //
  // Combined with weights [0.45, 0.40, 0.15], then a soft superflex QB
  // boost, capped [0, 100]. Bucketed LOW/MED/HIGH/CRITICAL on fixed
  // thresholds (25/50/75) chosen so LOW = "replacement is easy" and
  // CRITICAL = "this is basically the last one".
  // -------------------------------------------------------------------

  // Fraction of the anchor player's projection that still counts as
  // "comparable production." 80% mirrors how humans talk about draft
  // tiers ("within striking distance") and keeps the count honest --
  // 60% would be too permissive (replacement-level players count as
  // comparable), 90% too strict (nobody's comparable to a top pick).
  const SCARCITY_COMPARABLE_FRACTION = 0.8;

  // Signal weights. Supply dominates because it's the clearest signal
  // (demand vs. comparable supply). Dropoff second (production cliff).
  // Depth is a tiebreaker for shallow-overall pools.
  const SCARCITY_WEIGHTS = { supply: 0.45, dropoff: 0.40, depth: 0.15 };

  // Fixed classification thresholds on the 0..100 score.
  const SCARCITY_LEVEL_THRESHOLDS = { medium: 25, high: 50, critical: 75 };

  // How many starter slots a single team is expected to fill at each
  // position, including FLEX/SUPER_FLEX distribution. Used to compute
  // total league demand when the caller passes format info.
  //
  // FLEX splits proportionally across RB/WR/TE (empirical prior: 40/40/20
  // in most formats; deliberately opinionated so we don't need extra
  // config). SUPER_FLEX splits across QB/RB/WR/TE with QB heavily
  // favored (70/10/10/10) since that's the whole point of the slot.
  const FLEX_SPLIT = { RB: 0.4, WR: 0.4, TE: 0.2 };
  const SUPERFLEX_SPLIT = { QB: 0.7, RB: 0.1, WR: 0.1, TE: 0.1 };

  function startersPerTeamAtPosition(rosterSlots, position) {
    if (!rosterSlots) return 0;
    const base = Number(rosterSlots[position]) || 0;
    const flexShare = (FLEX_SPLIT[position] || 0) * (Number(rosterSlots.FLEX) || 0);
    const sfShare = (SUPERFLEX_SPLIT[position] || 0) * (Number(rosterSlots.SUPER_FLEX) || 0);
    return base + flexShare + sfShare;
  }

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  /**
   * Compute positional scarcity for `position` given the current
   * available player pool, live draft context, and (optionally) an
   * anchor projection that defines "comparable to this player".
   *
   * Params (all optional except position + availableProjections):
   *   position               -- 'QB'|'RB'|'WR'|'TE'|'K'|'DEF'
   *   availableProjections   -- number[] descending, projections of
   *                             every undrafted player at this position.
   *                             Zero / null entries are ignored.
   *   anchorProjection       -- the nominated player's projection.
   *                             Falls back to the top available if null.
   *   teamsStillNeeding      -- teams with an open starter slot at this
   *                             position AND affordability. If omitted,
   *                             derived from format (teamCount, roster
   *                             slots, draftedAtPosition).
   *   format                 -- { teamCount, rosterSlots, isSuperflex }
   *   draftedAtPosition      -- count of players already drafted at
   *                             this position (used only when
   *                             teamsStillNeeding is omitted).
   *
   * Returns:
   *   {
   *     score,               // 0..100
   *     level,               // 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
   *     comparableRemaining, // int, players within COMPARABLE_FRACTION
   *     availableCount,      // int, total undrafted at position
   *     teamsStillNeeding,   // int used in the calc
   *     dropoffPct,          // 0..1, drop from anchor to replacement
   *     reason,              // one-sentence human summary
   *     signals: { supply, dropoff, depth }  // each 0..1
   *   }
   *
   * Or null when there is no defensible calculation (no position, no
   * availability data at all, and no way to guess demand).
   */
  function computePositionalScarcity(opts) {
    const o = opts || {};
    if (!o.position) return null;
    const position = String(o.position).toUpperCase();

    // Sanitize projections: descending, positive, finite.
    const projections = (o.availableProjections || [])
      .filter((v) => typeof v === 'number' && isFinite(v) && v > 0)
      .slice()
      .sort((a, b) => b - a);

    // Anchor: nominated player's projection, else the top available.
    // If neither exists we bail -- there's nothing to compare against.
    let anchor = typeof o.anchorProjection === 'number' && o.anchorProjection > 0
      ? o.anchorProjection
      : (projections[0] || 0);
    if (!anchor) {
      return {
        score: 100,
        level: 'CRITICAL',
        comparableRemaining: 0,
        availableCount: 0,
        teamsStillNeeding: Number(o.teamsStillNeeding) || 0,
        dropoffPct: 1,
        reason: `No comparable ${position} left on the board.`,
        signals: { supply: 1, dropoff: 1, depth: 1 },
      };
    }

    const threshold = anchor * SCARCITY_COMPARABLE_FRACTION;
    const comparableRemaining = projections.filter((v) => v >= threshold).length;
    const availableCount = projections.length;

    // Teams still needing this position. Prefer the caller-supplied
    // count (derived from live team objects with roster gaps and
    // affordability); otherwise reconstruct from format.
    let teamsStillNeeding = null;
    if (typeof o.teamsStillNeeding === 'number' && o.teamsStillNeeding >= 0) {
      teamsStillNeeding = o.teamsStillNeeding;
    } else if (o.format && o.format.teamCount && o.format.rosterSlots) {
      const perTeam = startersPerTeamAtPosition(o.format.rosterSlots, position);
      const totalStarters = perTeam * o.format.teamCount;
      const drafted = Number(o.draftedAtPosition) || 0;
      teamsStillNeeding = Math.max(0, Math.round(totalStarters - drafted));
    } else {
      // No format info at all -- assume one team-per-comparable so the
      // supply signal is neutral (0 scarcity from supply alone). Depth
      // and dropoff still fire.
      teamsStillNeeding = comparableRemaining;
    }

    // Supply signal: how far short are we of "one comparable per team
    // that still needs this position"? 1.0 means zero comparable for
    // any of them; 0 means as-many-or-more comparable as demand.
    const supply = teamsStillNeeding <= 0
      ? 0
      : clamp01(1 - comparableRemaining / teamsStillNeeding);

    // Dropoff signal: gap from anchor to the "replacement" player -- the
    // one a needy team would end up with if this pick is claimed. Index
    // is teamsStillNeeding (0-based rank of the last comparable a team
    // could hope to get). Falls back to the bottom of the pool when
    // demand exceeds pool size (that's already reflected in supply).
    const replacementIdx = Math.min(
      Math.max(1, teamsStillNeeding),
      Math.max(0, projections.length - 1)
    );
    const replacement = projections.length
      ? projections[Math.min(replacementIdx, projections.length - 1)]
      : 0;
    // Guard: if replacement >= anchor (weird sort edge case), dropoff is 0.
    const dropoffPct = clamp01(1 - (replacement / anchor));
    // Map the raw drop to a 0..1 signal. A 40% drop already reads as a
    // major cliff; anything larger just saturates. Linear below that.
    const dropoff = clamp01(dropoffPct / 0.4);

    // Depth signal: overall shallow-pool pressure. Undrafted players
    // vs. 1.5x the remaining starter demand. The 1.5x buffer says
    // "healthy depth is when supply comfortably exceeds demand"; any
    // less and the market is thin regardless of tier gaps.
    const depthDemand = Math.max(1, teamsStillNeeding * 1.5);
    const depth = clamp01(1 - availableCount / depthDemand);

    let rawScore = 100 * (
      SCARCITY_WEIGHTS.supply * supply
      + SCARCITY_WEIGHTS.dropoff * dropoff
      + SCARCITY_WEIGHTS.depth * depth
    );

    // Superflex boosts QB scarcity: demand roughly doubles vs. 1QB.
    // The format-derived teamsStillNeeding already captures most of
    // this via the SUPER_FLEX split, but the effect is under-weighted
    // for QB specifically because 70% of a superflex slot isn't a
    // full QB slot in the eyes of most managers -- they'll pay like
    // it is. Small nudge (+10 pts, capped at 100) matches how the
    // room actually behaves.
    if (position === 'QB' && o.format && o.format.isSuperflex) {
      rawScore = Math.min(100, rawScore + 10);
    }

    const score = Math.max(0, Math.min(100, Math.round(rawScore)));
    const level = score >= SCARCITY_LEVEL_THRESHOLDS.critical
      ? 'CRITICAL'
      : score >= SCARCITY_LEVEL_THRESHOLDS.high
        ? 'HIGH'
        : score >= SCARCITY_LEVEL_THRESHOLDS.medium
          ? 'MEDIUM'
          : 'LOW';

    // One-sentence reason. Prefer the strongest signal so the copy
    // matches the number: cliff-driven reads different than
    // demand-driven, which reads different than pool-depletion.
    const reason = buildScarcityReason({
      position, level, comparableRemaining, teamsStillNeeding,
      dropoffPct, availableCount, signals: { supply, dropoff, depth },
    });

    return {
      score,
      level,
      comparableRemaining,
      availableCount,
      teamsStillNeeding,
      dropoffPct,
      reason,
      signals: { supply, dropoff, depth },
    };
  }

  function buildScarcityReason(ctx) {
    const { position, level, comparableRemaining, teamsStillNeeding,
      dropoffPct, availableCount, signals } = ctx;
    const posLabel = position === 'DEF' ? 'DEF' : `${position}s`;
    if (level === 'LOW') {
      return `${comparableRemaining} comparable ${posLabel} still available.`;
    }
    // Rank the three drivers; the highest scoring one shapes the copy.
    const strongest = ['supply', 'dropoff', 'depth']
      .sort((a, b) => signals[b] - signals[a])[0];
    if (strongest === 'dropoff' && dropoffPct >= 0.25) {
      const pct = Math.round(dropoffPct * 100);
      return `Only ${comparableRemaining} comparable ${posLabel} remain; next best is ~${pct}% worse.`;
    }
    if (strongest === 'depth') {
      return `Only ${availableCount} ${posLabel} left for ${teamsStillNeeding} teams still needing one.`;
    }
    // Supply-driven (default).
    if (comparableRemaining <= 1) {
      return comparableRemaining === 0
        ? `No comparable ${posLabel} left on the board.`
        : `Last comparable ${position} on the board.`;
    }
    return `Only ${comparableRemaining} comparable ${posLabel} for ${teamsStillNeeding} teams still needing one.`;
  }

  // -------------------------------------------------------------------
  // Derived decision-support layers on top of Positional Scarcity.
  //
  // ARCHITECTURE (spec item 20 -- keep these separate):
  //   Positional Scarcity  -- market condition (computePositionalScarcity).
  //     One canonical calc; every consumer reads it. Never inflated by
  //     personal roster context.
  //   Value Cliff          -- production drop after comparable alts.
  //     Reads the same availableProjections; doesn't recompute scarcity.
  //   Market Pressure      -- plain-language wrapper on scarcity level.
  //     UI-facing terminology only ("Low / Building / High / Critical").
  //   Scarcity Impact      -- how much the market condition matters to
  //     THIS manager (roster need + budget + surplus). Never mutates the
  //     underlying scarcity score.
  //   Pass Consequence     -- what happens if you skip THIS player.
  //   Insight Priority     -- picks THE single most important thing to
  //     surface, so the UI never shows three competing explanations.
  //
  // All layers are pure functions and deterministic. Callers pass
  // already-computed inputs so nothing recalculates redundantly.
  // -------------------------------------------------------------------

  /**
   * Find the meaningful production drop-off after the anchor player's
   * comparable alternatives. Does NOT re-derive scarcity; consumes the
   * same sorted-descending availableProjections plus the same
   * SCARCITY_COMPARABLE_FRACTION threshold so cliff and scarcity always
   * agree on what "comparable" means.
   *
   * Returns:
   *   {
   *     comparableCount,           // players within 80% of anchor
   *     nextComparableProjection,  // best projection below threshold
   *     dropoffAbsolute,           // anchor - nextComparableProjection
   *     dropoffPct,                // (anchor - next) / anchor
   *     hasCliff,                  // dropoffPct >= 0.15 (meaningful)
   *     isSevere,                  // dropoffPct >= 0.30
   *   }
   *
   * Or null when the pool is too shallow to compute (no anchor / <1
   * player). Callers should hide cliff copy on null.
   */
  function computeValueCliff(opts) {
    const o = opts || {};
    const projections = (o.availableProjections || [])
      .filter((v) => typeof v === 'number' && isFinite(v) && v > 0)
      .slice()
      .sort((a, b) => b - a);
    const anchor = typeof o.anchorProjection === 'number' && o.anchorProjection > 0
      ? o.anchorProjection
      : projections[0];
    if (!anchor) return null;
    const threshold = anchor * SCARCITY_COMPARABLE_FRACTION;
    const comparable = projections.filter((v) => v >= threshold);
    const belowThreshold = projections.filter((v) => v < threshold);
    const nextComparableProjection = belowThreshold.length ? belowThreshold[0] : null;
    if (nextComparableProjection == null) {
      // Whole pool is above the threshold, OR the anchor is the only
      // player. Both mean "no next tier to fall to" -- treat as an
      // absolute cliff so callers can warn appropriately.
      return {
        comparableCount: comparable.length,
        nextComparableProjection: null,
        dropoffAbsolute: null,
        dropoffPct: 1,
        hasCliff: true,
        isSevere: true,
      };
    }
    const dropoffAbsolute = anchor - nextComparableProjection;
    const dropoffPct = anchor > 0 ? dropoffAbsolute / anchor : 0;
    return {
      comparableCount: comparable.length,
      nextComparableProjection,
      dropoffAbsolute,
      dropoffPct,
      hasCliff: dropoffPct >= 0.15,
      isSevere: dropoffPct >= 0.30,
    };
  }

  /**
   * Plain-language wrapper on the scarcity level. UI-facing. Never
   * exposes the raw score or formulas. Returns null when scarcity is
   * null so callers can hide the row.
   */
  function computeMarketPressure(scarcity) {
    if (!scarcity || !scarcity.level) return null;
    const posLabel = null; // stays position-agnostic; caller composes copy
    switch (scarcity.level) {
      case 'CRITICAL':
        return {
          level: 'Critical',
          tone: 'critical',
          headline: 'Market pressure: Critical',
          blurb: 'Passing could leave you with a major drop-off.',
        };
      case 'HIGH':
        return {
          level: 'High',
          tone: 'high',
          headline: 'Market pressure: High',
          blurb: 'Only a few comparable players remain.',
        };
      case 'MEDIUM':
        return {
          level: 'Building',
          tone: 'medium',
          headline: 'Market pressure: Building',
          blurb: 'Good alternatives are starting to thin out.',
        };
      default:
        return {
          level: 'Low',
          tone: 'low',
          headline: 'Market pressure: Low',
          blurb: 'Plenty of comparable players remain.',
        };
    }
  }

  /**
   * Personalized layer: how much does the current market scarcity
   * actually matter to THIS manager?
   *
   * Inputs:
   *   scarcity       -- computePositionalScarcity() result
   *   cliff          -- computeValueCliff() result (may be null)
   *   need           -- 'starter' | 'bench' | 'none' (from bidderProfile)
   *   hasSurplus     -- boolean: manager already covered at this position
   *                     with a strong player (spec item 13)
   *   budgetPressure -- 0..1, higher = manager is cash-strapped
   *
   * Returns:
   *   {
   *     level,        // 'ignore' | 'nudge' | 'prioritize' | 'urgent'
   *     dollarLift,   // suggested % lift on top of value ($ terms
   *                   //  applied by the bid recommendation)
   *     headline,     // plain-language personal recommendation
   *     rationale,    // why this level
   *   }
   *
   * The dollarLift is a PROPORTION (0..0.25), never an absolute dollar
   * value -- the bid recommendation applies it against league value so
   * budgets scale correctly.
   *
   * Design principle (spec item 4): personal need MAY change the impact
   * level and dollarLift, but MUST NOT feed back into the underlying
   * positional scarcity score. That input is `scarcity` here and we
   * treat it as read-only.
   */
  function computeScarcityImpact(opts) {
    const o = opts || {};
    if (!o.scarcity || !o.scarcity.level) return null;
    const sLevel = o.scarcity.level;
    const need = o.need || 'none';
    const hasSurplus = !!o.hasSurplus;
    const budgetPressure = typeof o.budgetPressure === 'number' ? o.budgetPressure : 0;
    const cliffSevere = !!(o.cliff && o.cliff.isSevere);

    // No roster need -> impact caps at 'nudge' regardless of market.
    // Spec item 6/13: don't blindly tell the manager to buy a scarce
    // player they don't need.
    if (need === 'none' || hasSurplus) {
      return {
        level: 'ignore',
        dollarLift: 0,
        headline: 'You can let others pay the scarcity premium.',
        rationale: hasSurplus
          ? 'Your roster is already covered at this position.'
          : 'This slot is filled on your roster.',
      };
    }

    // Bench-only need + shallow market -> weak nudge.
    if (need === 'bench') {
      if (sLevel === 'CRITICAL' || sLevel === 'HIGH') {
        return {
          level: 'nudge',
          dollarLift: 0.03,
          headline: 'Depth pick — modest premium only if the price stays reasonable.',
          rationale: 'You have a bench slot, not a starter hole.',
        };
      }
      return {
        level: 'ignore',
        dollarLift: 0,
        headline: 'Bench depth only — no need to reach.',
        rationale: 'Wait for value.',
      };
    }

    // Starter need — the interesting case.
    let level, lift, headline, rationale;
    switch (sLevel) {
      case 'CRITICAL':
        level = 'urgent';
        lift = 0.18;
        headline = 'Prioritize this — the market is drying up.';
        rationale = 'You need this position and the pool is near-empty.';
        break;
      case 'HIGH':
        level = 'prioritize';
        lift = 0.12;
        headline = 'Worth a premium — alternatives are thinning fast.';
        rationale = 'You need this position and comparable options are limited.';
        break;
      case 'MEDIUM':
        level = 'nudge';
        lift = 0.06;
        headline = "Reasonable to reach a little — market's tightening.";
        rationale = 'You need this position; competition is building.';
        break;
      default:
        level = 'nudge';
        lift = 0;
        headline = 'Stick to your value.';
        rationale = 'Plenty of comparable players remain.';
    }
    // A severe cliff adds a small further premium on top of a starter
    // need (this is EXACTLY the "last chance at this production" case).
    if (cliffSevere && (level === 'urgent' || level === 'prioritize')) {
      lift = Math.min(0.22, lift + 0.04);
    }
    // Budget pressure trims the premium the manager can afford to add.
    // High budget pressure (>0.7) halves the lift.
    if (budgetPressure > 0.7) lift = lift * 0.5;
    else if (budgetPressure > 0.4) lift = lift * 0.75;

    return { level, dollarLift: lift, headline, rationale };
  }

  /**
   * The consequence of passing on THIS player, expressed for the
   * manager who is deciding whether to bid. Derived from scarcity +
   * cliff only -- roster need shapes the framing at the caller.
   *
   * Severity buckets:
   *   'none'         -- plenty of comparable, no cliff.
   *   'moderate'     -- getting thin, but real options remain.
   *   'significant'  -- only a couple of comparable, or an amber cliff.
   *   'severe'       -- last-or-only comparable, or an immediate cliff.
   *
   * Returns null when there isn't enough data to be honest.
   */
  function computePassConsequence(opts) {
    const o = opts || {};
    if (!o.scarcity || !o.scarcity.level) return null;
    const s = o.scarcity;
    const cliff = o.cliff || null;
    const position = o.position || 'players';
    const posLabel = position === 'DEF' ? 'DEFs'
      : (['QB', 'RB', 'WR', 'TE', 'K'].indexOf(position) >= 0 ? `${position}s` : position);

    if (s.level === 'CRITICAL' || (s.comparableRemaining != null && s.comparableRemaining <= 1)) {
      const cliffTail = cliff && cliff.hasCliff && cliff.dropoffPct
        ? ` A major production drop follows this tier.`
        : '';
      return {
        severity: 'severe',
        headline: 'This may be your last good chance',
        blurb: `Only ${s.comparableRemaining || 0} comparable ${posLabel} remain.${cliffTail}`,
      };
    }
    if (s.level === 'HIGH' || (cliff && cliff.isSevere)) {
      return {
        severity: 'significant',
        headline: 'Passing could cost you',
        blurb: cliff && cliff.hasCliff && cliff.dropoffPct >= 0.15
          ? `Only ${s.comparableRemaining} comparable ${posLabel} remain, and the next tier drops ~${Math.round(cliff.dropoffPct * 100)}%.`
          : `Only ${s.comparableRemaining} comparable ${posLabel} remain.`,
      };
    }
    if (s.level === 'MEDIUM') {
      return {
        severity: 'moderate',
        headline: 'Waiting gets riskier',
        blurb: `Only ${s.comparableRemaining} comparable ${posLabel} remain.`,
      };
    }
    return {
      severity: 'none',
      headline: 'You can wait',
      blurb: `Plenty of comparable ${posLabel} remain.`,
    };
  }

  /**
   * Insight Priority (spec item 19) -- picks THE single most important
   * thing to surface on the On-the-Block card. Prevents recommendation
   * overload by never returning more than one primary insight.
   *
   * Inputs (all optional except that at least one must be non-null):
   *   scarcity   -- computePositionalScarcity() result
   *   cliff      -- computeValueCliff() result
   *   impact     -- computeScarcityImpact() result
   *   fitTone    -- 'strong' | 'depth' | 'low'
   *   position   -- position label for copy
   *   budgetPressure -- 0..1
   *
   * Returns:
   *   { type, priority, headline, explanation, consequence, tone }
   *
   * Types:
   *   'FIT_LOCKED'   -- roster full; nothing else matters
   *   'CLIFF'        -- severe production drop-off dominates
   *   'PERSONAL_URGENT' -- you need it AND it's scarce
   *   'SCARCITY'     -- market is scarce (whether or not you need it)
   *   'ROSTER_FIT'   -- strong personal fit even in a healthy market
   *   'BUDGET'       -- cash preservation dominates
   *   'VALUE'        -- default: play to value
   *
   * Priority is 0..1; higher = more urgent to surface. Not currently
   * used to rank across cards, but reserved for future features that
   * summarize "what should the manager pay attention to right now?"
   */
  function computeInsightPriority(opts) {
    const o = opts || {};
    const position = o.position || 'this position';
    const posLabel = position === 'DEF' ? 'DEFs'
      : (['QB', 'RB', 'WR', 'TE', 'K'].indexOf(position) >= 0 ? `${position}s` : position);
    const fitTone = o.fitTone || null;
    const scarcity = o.scarcity || null;
    const cliff = o.cliff || null;
    const impact = o.impact || null;
    const budgetPressure = typeof o.budgetPressure === 'number' ? o.budgetPressure : 0;

    // 1) Roster locked -> nothing else matters; skip the position.
    if (fitTone === 'low') {
      return {
        type: 'FIT_LOCKED',
        priority: 0.95,
        headline: 'Roster is full here',
        explanation: `You can let others pay the scarcity premium.`,
        consequence: null,
        tone: 'muted',
      };
    }

    // 2) You NEED it + high/critical scarcity -> the strongest positive
    // insight we can produce. Beats plain scarcity because it's actionable.
    if (impact && (impact.level === 'urgent' || impact.level === 'prioritize')) {
      return {
        type: 'PERSONAL_URGENT',
        priority: impact.level === 'urgent' ? 0.9 : 0.8,
        headline: `You need ${posLabel === position ? posLabel : `a ${position}`} and they're getting scarce`,
        explanation: scarcity && scarcity.comparableRemaining != null
          ? `Only ${scarcity.comparableRemaining} comparable ${posLabel} remain.`
          : impact.rationale,
        consequence: cliff && cliff.isSevere
          ? `A major production drop follows this tier.`
          : null,
        tone: impact.level === 'urgent' ? 'critical' : 'high',
      };
    }

    // 3) Severe cliff regardless of personal fit -> educational + tactical.
    if (cliff && cliff.isSevere && scarcity && scarcity.comparableRemaining <= 3) {
      return {
        type: 'CLIFF',
        priority: 0.75,
        headline: `Big ${position} drop-off after this tier`,
        explanation: `Only ${scarcity.comparableRemaining} comparable ${posLabel} remain.`,
        consequence: cliff.nextComparableProjection != null
          ? `Next comparable is ~${Math.round(cliff.dropoffPct * 100)}% worse.`
          : null,
        tone: 'high',
      };
    }

    // 4) Scarcity but manager doesn't especially need it -> softer.
    if (scarcity && (scarcity.level === 'HIGH' || scarcity.level === 'CRITICAL')) {
      // If manager doesn't need it, be explicit that they can pass.
      if (!impact || impact.level === 'ignore') {
        return {
          type: 'SCARCITY',
          priority: 0.55,
          headline: `${posLabel} are getting scarce`,
          explanation: 'But you can wait — your roster is already covered.',
          consequence: null,
          tone: 'muted',
        };
      }
      return {
        type: 'SCARCITY',
        priority: 0.6,
        headline: `${posLabel} are getting scarce`,
        explanation: `Only ${scarcity.comparableRemaining} comparable ${posLabel} remain.`,
        consequence: null,
        tone: 'medium',
      };
    }

    // 5) Perfect roster fit in a healthy market.
    if (fitTone === 'strong') {
      return {
        type: 'ROSTER_FIT',
        priority: 0.5,
        headline: 'Perfect roster fit',
        explanation: `You still need a ${position}.`,
        consequence: null,
        tone: 'medium',
      };
    }

    // 6) Budget-driven insight.
    if (budgetPressure > 0.7) {
      return {
        type: 'BUDGET',
        priority: 0.4,
        headline: 'Protect your remaining budget',
        explanation: 'Similar players are still available.',
        consequence: null,
        tone: 'muted',
      };
    }

    // 7) Default: play to value.
    return {
      type: 'VALUE',
      priority: 0.2,
      headline: 'Play to value',
      explanation: 'No dominant scarcity or need signal — trust the market.',
      consequence: null,
      tone: 'muted',
    };
  }

  /**
   * Positional Market Snapshot (spec item 12) -- one row per position
   * summarizing league-wide market pressure. Delegates entirely to
   * computePositionalScarcity (single source of truth) so per-position
   * numbers always match the On-the-Block card.
   *
   * Inputs:
   *   poolByPosition   -- { QB: [projections desc], RB: [...], ... }
   *   teamsStillNeedingByPosition -- { QB: n, RB: n, ... }
   *   format           -- { teamCount, rosterSlots, isSuperflex }
   *   draftedByPosition -- { QB: n, ... }
   *
   * Returns an array of { position, scarcity, pressure, teamsNeeding,
   * comparableRemaining, headline, blurb } sorted by pressure desc.
   */
  function computePositionalMarketSnapshot(opts) {
    const o = opts || {};
    const rows = [];
    for (const position of POSITIONS) {
      const availableProjections = (o.poolByPosition && o.poolByPosition[position]) || [];
      const teamsStillNeeding = o.teamsStillNeedingByPosition
        ? o.teamsStillNeedingByPosition[position]
        : undefined;
      const draftedAtPosition = o.draftedByPosition ? o.draftedByPosition[position] : 0;
      const scarcity = computePositionalScarcity({
        position,
        availableProjections,
        teamsStillNeeding,
        format: o.format,
        draftedAtPosition,
      });
      if (!scarcity) continue;
      const pressure = computeMarketPressure(scarcity);
      const teamsNeeding = scarcity.teamsStillNeeding != null ? scarcity.teamsStillNeeding : 0;
      const posLabel = position === 'DEF' ? 'DEFs' : `${position}s`;
      let blurb;
      if (scarcity.level === 'CRITICAL' || scarcity.level === 'HIGH') {
        blurb = `${teamsNeeding} team${teamsNeeding === 1 ? '' : 's'} still need one`;
      } else if (scarcity.level === 'MEDIUM') {
        blurb = 'Alternatives thinning';
      } else {
        blurb = 'Plenty of alternatives';
      }
      rows.push({
        position,
        scarcity,
        pressure,
        teamsNeeding,
        comparableRemaining: scarcity.comparableRemaining,
        headline: `${pressure.level} pressure`,
        blurb: `${blurb.charAt(0).toUpperCase() + blurb.slice(1)}`,
      });
    }
    // Sort by score desc so the most urgent positions surface first.
    rows.sort((a, b) => (b.scarcity.score || 0) - (a.scarcity.score || 0));
    return rows;
  }

  // -------------------------------------------------------------------
  // Alternative Score (spec: "Alternative Score")
  //
  // Answers: "if I pass on the nominated player, how strong are my
  // other options?" Components are graded RELATIVE to the nominee, not
  // in absolute terms -- an alternative isn't good because they're
  // objectively good; they're good because they're close to what you'd
  // be getting. Auction price is exposed as reusable context but never
  // inflates the score (a cheap-but-worse player must not out-score a
  // pricier-but-stronger one).
  //
  // Weights are exported so tests and future configuration can tune
  // them; when a component's data is missing (playoff, consistency),
  // its weight is dropped and the remainder is renormalized so the
  // resulting score is still on the same 0..100 scale.
  // -------------------------------------------------------------------

  const ALTERNATIVE_SCORE_WEIGHTS = {
    production: 0.40,
    scarcity:   0.20,
    consistency:0.15,
    playoff:    0.10,
    rosterFit:  0.15,
  };

  // How close two projections must be to count as a "true peer" ceiling.
  // At <=5% below the nominee, production reads as effectively identical.
  const PRODUCTION_PEER_TOLERANCE = 0.05;
  // Below this fraction of the nominee's projection, production drops
  // to zero regardless of the raw gap (a 50%-worse player is not a
  // meaningful alternative at any price).
  const PRODUCTION_FLOOR_FRACTION = 0.50;
  // Minimum overall alternative score to appear in the candidate list.
  const ALTERNATIVE_MIN_SCORE = 55;
  // Candidate list size cap; the UI shows the strongest few.
  const ALTERNATIVE_MAX_CANDIDATES = 5;
  const ALTERNATIVE_MIN_CANDIDATES = 3;

  /**
   * Score a single alternative against the nominated player. All inputs
   * are relative -- the alternative is graded on how close/useful it
   * is compared to the nominee within the current league context.
   *
   * Inputs:
   *   nom            -- { position, projection, leagueValue? }
   *   candidate      -- { name, position, projection, leagueValue?,
   *                       consistency?, playoff? }  (nullables allowed)
   *   scarcity       -- computePositionalScarcity() result for the
   *                     nominee's position (shared, not re-derived)
   *   cliff          -- computeValueCliff() result (may be null)
   *   format         -- optional { rosterSlots, isSuperflex, teamCount }
   *   you            -- optional resolved user team; when omitted
   *                     rosterFit is dropped from the weight blend
   *   openSlotsForPosition(you, pos) -- optional injected helper
   *                     (kept as a parameter so this module has no
   *                     hard dependency on liveDraft.js)
   *   weights        -- optional override of ALTERNATIVE_SCORE_WEIGHTS
   *
   * Returns:
   *   {
   *     alternativeScore,        // 0..100 int
   *     componentScores: {
   *       production, scarcity, consistency, playoff, rosterFit
   *     },                       // each 0..100 or null (missing data)
   *     activeWeights,           // renormalized weights actually used
   *     plainLanguage,           // short one-line "why this is a good
   *                              //   alternative" summary (or "" when
   *                              //   the score is weak)
   *   }
   */
  function computeAlternativeScore(opts) {
    const o = opts || {};
    const nom = o.nom || {};
    const cand = o.candidate || {};
    const weights = Object.assign({}, ALTERNATIVE_SCORE_WEIGHTS, o.weights || {});
    const nomProj = Number(nom.projection);
    const candProj = Number(cand.projection);
    if (!isFinite(nomProj) || nomProj <= 0 || !isFinite(candProj) || candProj <= 0) {
      return null;
    }

    // --- Production: magnitude of the gap, not just same-position ---
    const production = scoreProductionRelative(nomProj, candProj);

    // --- Scarcity: relative positional-value contribution ---
    // Same-position candidates inherit the shared scarcity reading,
    // scaled by how close their projection sits to the nominee's tier.
    // Cross-position candidates aren't rated here (candidate selection
    // already restricts to the nominee's position pool).
    const scarcity = scoreScarcityRelative({
      nomProjection: nomProj,
      candProjection: candProj,
      scarcity: o.scarcity,
      cliff: o.cliff,
    });

    // --- Consistency: relative reliability, or null when unavailable ---
    const consistency = scoreConsistencyRelative(nom.consistency, cand.consistency);

    // --- Playoff schedule: relative outlook, or null when unavailable ---
    const playoff = scorePlayoffRelative(nom.playoff, cand.playoff);

    // --- Roster fit: how does the alt fit YOUR roster vs. the nominee? ---
    const rosterFit = scoreRosterFitRelative({
      nomPosition: nom.position,
      candPosition: cand.position,
      you: o.you,
      league: o.league,
      openSlotsForPosition: o.openSlotsForPosition,
      positionCap: o.positionCap,
      countRosterAtPosition: o.countRosterAtPosition,
    });

    const componentScores = { production, scarcity, consistency, playoff, rosterFit };

    // Renormalize weights over components that produced a real score,
    // so missing playoff/consistency data doesn't silently deflate the
    // final number (spec §25). Production always participates (guarded
    // above); the others may drop out.
    const activeWeights = {};
    let weightSum = 0;
    Object.keys(weights).forEach((k) => {
      if (componentScores[k] != null) {
        activeWeights[k] = weights[k];
        weightSum += weights[k];
      }
    });
    if (weightSum <= 0) return null;
    Object.keys(activeWeights).forEach((k) => { activeWeights[k] = activeWeights[k] / weightSum; });

    let raw = 0;
    Object.keys(activeWeights).forEach((k) => {
      raw += componentScores[k] * activeWeights[k];
    });
    const alternativeScore = Math.max(0, Math.min(100, Math.round(raw)));

    const plainLanguage = buildAlternativePlainLanguage({
      alternativeScore, componentScores, nomProjection: nomProj, candProjection: candProj,
    });

    return { alternativeScore, componentScores, activeWeights, plainLanguage };
  }

  function scoreProductionRelative(nomProj, candProj) {
    if (candProj >= nomProj) return 100;
    const ratio = candProj / nomProj;               // 0..1
    if (ratio >= 1 - PRODUCTION_PEER_TOLERANCE) return 100;
    if (ratio <= PRODUCTION_FLOOR_FRACTION) return 0;
    // Linear between the floor (0) and the peer tolerance (100).
    // Small gaps (5-15%) drop noticeably; big gaps (30%+) crater. A
    // 10% below-nominee candidate lands around 78; 25% below → 44.
    const span = (1 - PRODUCTION_PEER_TOLERANCE) - PRODUCTION_FLOOR_FRACTION;
    return Math.round(((ratio - PRODUCTION_FLOOR_FRACTION) / span) * 100);
  }

  function scoreScarcityRelative(opts) {
    const scarcity = opts.scarcity || null;
    const cliff = opts.cliff || null;
    // Without a scarcity read we can't meaningfully compare positional
    // value; skip the component and let the weight redistribute.
    if (!scarcity || !scarcity.level) return null;
    const ratio = opts.candProjection / opts.nomProjection; // 0..1 typically

    // Two forces shape this component:
    //   1) The production-tier gap between candidate and nominee. A
    //      near-peer keeps positional value; a step down loses it.
    //   2) The market's own scarcity level. In a SCARCE market the
    //      same production gap costs the manager more (fewer chances
    //      to make it up later); in a HEALTHY market the same gap is
    //      easier to absorb because comparable alts still exist.
    // The cliff steepness modulates the per-point penalty when
    // available; otherwise falls back to a neutral 0.5 scaling.
    const cliffScale = cliff && cliff.hasCliff && cliff.nextComparableProjection != null
      ? Math.min(1, (cliff.dropoffPct || 0) / 0.4) : 0.5;
    const production_penalty = clamp01(1 - ratio) * (0.5 + 0.5 * cliffScale) * 100;

    // Market-scarcity modulation: a scarcer market applies a small
    // linear drag on the score (each remaining alt is worth relatively
    // more, so a candidate that ISN'T a perfect peer is less useful).
    // Uses signals.supply directly so the read comes from the same
    // engine that drives the scarcity chip -- no re-derivation.
    const supply = scarcity.signals && typeof scarcity.signals.supply === 'number'
      ? scarcity.signals.supply : (scarcity.score || 0) / 100;
    const scarcityDrag = supply * clamp01(1 - ratio) * 40;

    const raw = 100 - production_penalty - scarcityDrag;
    return Math.max(0, Math.min(100, Math.round(raw)));
  }

  function scoreConsistencyRelative(nomC, candC) {
    if (nomC == null || candC == null) return null;
    // consistency assumed to be 0..1 (higher = more reliable).
    // Cap upside at parity; a wildly more consistent alt doesn't get
    // credit beyond "as reliable as the nominee" -- production dominates.
    const delta = candC - nomC;             // negative = worse
    if (delta >= 0) return 100;
    // A 0.20 consistency deficit reads as roughly halving the score.
    const worseness = Math.min(1, -delta / 0.40);
    return Math.round(100 * (1 - worseness));
  }

  function scorePlayoffRelative(nomP, candP) {
    if (nomP == null || candP == null) return null;
    // playoff assumed to be 0..1 (higher = better outlook).
    const delta = candP - nomP;
    if (delta >= 0) {
      // Better outlook is a modest upside; cap at 100. A 0.10 lift
      // (10 percentage points better) lands around 100; smaller lifts
      // scale up linearly from a 75 baseline (the "matching" floor).
      const boost = Math.min(1, delta / 0.10);
      return Math.round(75 + 25 * boost);
    }
    const drop = Math.min(1, -delta / 0.20);
    return Math.round(75 * (1 - drop));
  }

  function scoreRosterFitRelative(opts) {
    const you = opts.you;
    if (!you) return null;
    const nomPos = opts.nomPosition;
    const candPos = opts.candPosition;
    if (!nomPos || !candPos) return null;
    const getSlots = opts.openSlotsForPosition;
    if (typeof getSlots !== 'function') return null;

    const nomSlots = getSlots(you, nomPos) || 0;
    const candSlots = getSlots(you, candPos) || 0;

    // Hard-lock cases handled first.
    if (candSlots <= 0) return 0;
    if (nomSlots <= 0 && candSlots > 0) return 100;

    // Position-limit checks (fail-open when data missing).
    if (typeof opts.positionCap === 'function' && typeof opts.countRosterAtPosition === 'function') {
      const cap = opts.positionCap(opts.league, candPos);
      if (cap != null) {
        const owned = opts.countRosterAtPosition(you, candPos);
        if (owned >= cap) return 0;
      }
    }

    // Both usable. Same position => full parity. Cross-position (flex/
    // superflex-eligible alt) => modest penalty because the alt isn't
    // a like-for-like starter replacement.
    if (candPos === nomPos) return 100;

    // Cross-position: prefer more open slots. A candidate whose
    // position has more roster room than the nominee's is a stronger
    // fit (you get to fill a gap), but the mismatch itself trims 15%.
    const ratio = candSlots / Math.max(1, nomSlots);
    const base = 85;
    const bonus = ratio >= 1 ? 10 : (ratio - 1) * 20; // -20 max
    return Math.max(0, Math.min(100, Math.round(base + bonus)));
  }

  function buildAlternativePlainLanguage(opts) {
    const cs = opts.componentScores || {};
    if (opts.alternativeScore >= 90) {
      if (cs.production >= 95) return 'Nearly the same projected production.';
      return 'Comparable production with similar positional value.';
    }
    if (opts.alternativeScore >= 75) {
      if (cs.production >= 85) return 'Similar production with a manageable trade-off.';
      return 'Solid alternative with a noticeable but reasonable drop-off.';
    }
    if (opts.alternativeScore >= 60) {
      return 'Reasonable fallback, but the production gap is real.';
    }
    return '';
  }

  /**
   * Rank all eligible undrafted players at the nominee's position (or,
   * for superflex, cross-position flex-eligible pool) and return the
   * strongest 3-5 alternatives, applying a minimum score floor. Does
   * NOT invent alternatives to fill the slate: the count shrinks below
   * the floor rather than degrade to false positives (spec §13).
   *
   * Inputs:
   *   nom              -- { name, position, projection }
   *   pool             -- { players: [{ name, position, projection,
   *                                    isDrafted, leagueValue? }] }
   *   picks            -- raw Sleeper picks (drafted-set fallback)
   *   scarcity         -- shared scarcity read
   *   cliff            -- shared cliff read
   *   you / league / format
   *   openSlotsForPosition / positionCap / countRosterAtPosition
   *                    -- injected helpers (see computeAlternativeScore)
   *   leagueAdjustedValueOf(candidatePlayer) -- optional; if provided
   *                    we surface auction context per candidate
   *   nomLeagueValue   -- nominee's league-adjusted $ value (optional)
   *   crossPosition    -- when true (superflex QB scenarios), pull
   *                    from the SUPER_FLEX-eligible union
   *   weights, minScore, maxCandidates -- overrides for tests
   *
   * Returns:
   *   {
   *     candidates: [{
   *       name, position, projection,
   *       alternativeScore, componentScores, plainLanguage,
   *       auctionContext: {
   *         alternativeValue, nominatedValue,
   *         valueDifference,       // nominated - alternative (positive = cheaper)
   *         priceAdvantage,        // 'cheaper' | 'even' | 'more_expensive'
   *       } | null,
   *     }],
   *     replacementContext: {
   *       strongAlternativesRemaining, productionDropOff,
   *       replacementDepth,        // 'strong' | 'moderate' | 'weak'
   *       supplyScarcity,          // scarcity.signals.supply (0..1) or null
   *       demandScarcity,          // scarcity.teamsStillNeeding | comparableRemaining
   *     },
   *     recommendationContext: {
   *       replaceability,          // 0..1 (higher = safer to pass)
   *       passingRisk,             // 'low' | 'moderate' | 'high'
   *     },
   *   }
   */
  function computeAlternativeCandidates(opts) {
    const o = opts || {};
    const nom = o.nom || {};
    if (!nom.position || !nom.projection) return emptyAlternatives(o);
    const pool = o.pool;
    if (!pool || !Array.isArray(pool.players)) return emptyAlternatives(o);

    const drafted = new Set();
    for (const p of pool.players) {
      if (p.isDrafted && p.name && p.position) {
        drafted.add(`${String(p.name).trim().toLowerCase()}|${String(p.position).toUpperCase()}`);
      }
    }
    for (const pick of o.picks || []) {
      const md = pick && pick.metadata;
      if (!md) continue;
      const name = `${md.first_name || ''} ${md.last_name || ''}`.trim();
      if (name && md.position) {
        drafted.add(`${name.toLowerCase()}|${String(md.position).toUpperCase()}`);
      }
    }

    const nomPos = String(nom.position).toUpperCase();
    const nomKey = `${String(nom.name || '').trim().toLowerCase()}|${nomPos}`;

    // Position-eligibility filter. Superflex extension is opt-in
    // (cross-position QB alts don't apply to standard leagues).
    let eligiblePositions = [nomPos];
    if (o.crossPosition && nomPos === 'QB' && o.format && o.format.isSuperflex) {
      // In superflex, a top-tier QB's "alternative" pool stays QB-only:
      // no other position substitutes for the passing production.
      // Leaving the hook here so a future format-aware policy can widen
      // the pool (e.g. FLEX slot alternatives for RB/WR).
      eligiblePositions = ['QB'];
    }

    const minScore = typeof o.minScore === 'number' ? o.minScore : ALTERNATIVE_MIN_SCORE;
    const maxCands = typeof o.maxCandidates === 'number' ? o.maxCandidates : ALTERNATIVE_MAX_CANDIDATES;

    const scored = [];
    for (const p of pool.players) {
      if (!p || !p.name || !p.position) continue;
      const key = `${String(p.name).trim().toLowerCase()}|${String(p.position).toUpperCase()}`;
      if (key === nomKey) continue;
      if (drafted.has(key)) continue;
      if (!eligiblePositions.includes(String(p.position).toUpperCase())) continue;
      if (p.projection == null || p.projection <= 0) continue;

      const score = computeAlternativeScore({
        nom: { position: nomPos, projection: nom.projection, consistency: nom.consistency, playoff: nom.playoff },
        candidate: {
          name: p.name,
          position: String(p.position).toUpperCase(),
          projection: p.projection,
          consistency: p.consistency,
          playoff: p.playoff,
        },
        scarcity: o.scarcity,
        cliff: o.cliff,
        format: o.format,
        league: o.league,
        you: o.you,
        openSlotsForPosition: o.openSlotsForPosition,
        positionCap: o.positionCap,
        countRosterAtPosition: o.countRosterAtPosition,
        weights: o.weights,
      });
      if (!score) continue;
      scored.push({ player: p, score });
    }

    // Rank primarily by alternativeScore, then by projection (tiebreak).
    scored.sort((a, b) => {
      if (b.score.alternativeScore !== a.score.alternativeScore) {
        return b.score.alternativeScore - a.score.alternativeScore;
      }
      return (b.player.projection || 0) - (a.player.projection || 0);
    });

    // Apply floor; keep at least ALTERNATIVE_MIN_CANDIDATES if we can,
    // but never manufacture: if the pool has only 1 defensible option
    // we show 1 (spec §13).
    const overFloor = scored.filter((s) => s.score.alternativeScore >= minScore);
    const kept = overFloor.slice(0, maxCands);
    // If floor rejected everyone but there ARE candidates, show the top
    // few anyway (still ranked) so the user can see the fall-off; the
    // UI can color-code weak candidates but we don't hide the fact
    // that alternatives exist at all.
    const finalList = kept.length >= ALTERNATIVE_MIN_CANDIDATES
      ? kept
      : (kept.length ? kept : scored.slice(0, ALTERNATIVE_MIN_CANDIDATES));

    const nomLeagueValue = typeof o.nomLeagueValue === 'number' ? o.nomLeagueValue : null;
    const laFn = typeof o.leagueAdjustedValueOf === 'function' ? o.leagueAdjustedValueOf : null;

    const candidates = finalList.map(({ player, score }) => {
      const altValue = laFn ? laFn(player) : (typeof player.leagueValue === 'number' ? player.leagueValue : null);
      let auctionContext = null;
      if (nomLeagueValue != null && altValue != null) {
        const diff = nomLeagueValue - altValue;
        const advantage = diff > 1 ? 'cheaper' : diff < -1 ? 'more_expensive' : 'even';
        auctionContext = {
          alternativeValue: altValue,
          nominatedValue: nomLeagueValue,
          valueDifference: diff,
          priceAdvantage: advantage,
        };
      } else if (altValue != null || nomLeagueValue != null) {
        auctionContext = {
          alternativeValue: altValue,
          nominatedValue: nomLeagueValue,
          valueDifference: null,
          priceAdvantage: 'even',
        };
      }
      return {
        name: player.name,
        position: String(player.position).toUpperCase(),
        projection: player.projection,
        alternativeScore: score.alternativeScore,
        componentScores: score.componentScores,
        activeWeights: score.activeWeights,
        plainLanguage: score.plainLanguage,
        auctionContext,
      };
    });

    const replacementContext = computeReplacementContext({
      nom, candidates, scarcity: o.scarcity, cliff: o.cliff,
    });
    const recommendationContext = computeRecommendationContext({
      candidates, scarcity: o.scarcity, replacement: replacementContext,
    });

    return { candidates, replacementContext, recommendationContext };
  }

  function emptyAlternatives(o) {
    return {
      candidates: [],
      replacementContext: {
        strongAlternativesRemaining: 0,
        productionDropOff: null,
        replacementDepth: 'weak',
        supplyScarcity: o && o.scarcity ? (o.scarcity.signals && o.scarcity.signals.supply) || null : null,
        demandScarcity: o && o.scarcity ? o.scarcity.teamsStillNeeding : null,
      },
      recommendationContext: {
        replaceability: 0,
        passingRisk: 'high',
      },
    };
  }

  function computeReplacementContext(opts) {
    const cands = opts.candidates || [];
    const scarcity = opts.scarcity || null;
    const cliff = opts.cliff || null;
    const strong = cands.filter((c) => c.alternativeScore >= 80).length;
    const productionDropOff = cliff && cliff.dropoffPct != null ? cliff.dropoffPct : null;
    // computeValueCliff flags isSevere in two very different cases:
    //   (a) a real cliff -- next tier is 30%+ worse (bad),
    //   (b) the whole remaining pool is ABOVE the comparable threshold
    //       so there's simply no "next tier" to fall to (this is
    //       actually a rich pool, not a warning).
    // Distinguish (b) via nextComparableProjection === null with
    // strong alts still present.
    const richPoolFalseSevere = cliff && cliff.isSevere
      && cliff.nextComparableProjection == null && strong >= 3;
    const realSevereCliff = cliff && cliff.isSevere && !richPoolFalseSevere;
    // Depth: strong when >=3 strong alts and no severe cliff; moderate
    // when 1-2 strong alts OR a shallow cliff; weak otherwise.
    let depth = 'weak';
    if (strong >= 3 && !realSevereCliff) depth = 'strong';
    else if (strong >= 1 || (cands.length >= 2 && cands[0].alternativeScore >= 70)) depth = 'moderate';
    return {
      strongAlternativesRemaining: strong,
      productionDropOff,
      replacementDepth: depth,
      supplyScarcity: scarcity && scarcity.signals ? scarcity.signals.supply : null,
      demandScarcity: scarcity ? scarcity.teamsStillNeeding : null,
    };
  }

  function computeRecommendationContext(opts) {
    const cands = opts.candidates || [];
    const scarcity = opts.scarcity || null;
    const replacement = opts.replacement || {};
    if (!cands.length) return { replaceability: 0, passingRisk: 'high' };
    // Replaceability blends the top alt's score with replacement depth
    // and inverse market scarcity. Bounded 0..1.
    const topScore = (cands[0].alternativeScore || 0) / 100;
    const depthLift = replacement.replacementDepth === 'strong' ? 0.15
      : replacement.replacementDepth === 'moderate' ? 0.05 : -0.05;
    const scarcityDrag = scarcity && scarcity.score ? -(scarcity.score / 100) * 0.15 : 0;
    const replaceability = clamp01(topScore + depthLift + scarcityDrag);
    const passingRisk = replaceability >= 0.75 ? 'low'
      : replaceability >= 0.55 ? 'moderate' : 'high';
    return { replaceability, passingRisk };
  }

  return {
    POSITIONS,
    POSITION_TIERING,
    SCARCITY_COMPARABLE_FRACTION,
    SCARCITY_LEVEL_THRESHOLDS,
    ALTERNATIVE_SCORE_WEIGHTS,
    ALTERNATIVE_MIN_SCORE,
    ALTERNATIVE_MAX_CANDIDATES,
    ALTERNATIVE_MIN_CANDIDATES,
    computePositionalScarcity,
    computeValueCliff,
    computeMarketPressure,
    computeScarcityImpact,
    computePassConsequence,
    computeInsightPriority,
    computePositionalMarketSnapshot,
    computeAlternativeScore,
    computeAlternativeCandidates,
    startersPerTeamAtPosition,
    extractFormat,
    detectFormatChanges,
    perManagerSpending,
    leaguePositionalTrends,
    buildTiersFromScores,
    positionOverpayVsLeague,
    spendingTiming,
    budgetPlanner,
    tierBreaks,
    rookieMultipliers,
    rivalScoutingProfiles,
    keeperRadar,
    summarizeInsights,
  };
});
