/**
 * DraftPilot analysis engine.
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
    const tiersToTrack = 12;

    for (const draft of auctionDrafts) {
      const byPosition = {};
      for (const position of POSITIONS) {
        const positionPicks = draft.picks
          .filter((p) => p.position === position && p.amount != null && p.amount > 0)
          .sort((a, b) => (b.amount || 0) - (a.amount || 0));
        byPosition[position] = {
          totalSpend: sum(positionPicks.map((p) => p.amount)),
          pickCount: positionPicks.length,
          tiers: positionPicks.slice(0, tiersToTrack).map((p, i) => ({
            rank: i + 1,
            playerName: p.playerName,
            amount: p.amount,
            drafter: p.displayName,
          })),
        };
      }
      bySeason.push({ season: draft.season, leagueName: draft.leagueName, byPosition });
    }

    const tierAggregates = {};
    for (const position of POSITIONS) {
      const tiers = [];
      for (let rank = 1; rank <= tiersToTrack; rank++) {
        const amounts = bySeason
          .map((s) => s.byPosition[position].tiers[rank - 1] && s.byPosition[position].tiers[rank - 1].amount)
          .filter((v) => v != null);
        if (amounts.length) {
          tiers.push({
            rank,
            median: median(amounts),
            min: Math.min(...amounts),
            max: Math.max(...amounts),
            samples: amounts.length,
          });
        }
      }
      tierAggregates[position] = tiers;
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

  return {
    POSITIONS,
    extractFormat,
    detectFormatChanges,
    perManagerSpending,
    leaguePositionalTrends,
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
