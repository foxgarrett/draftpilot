(function (global) {
  // ---------------------------------------------------------------------
  // Roster-aware Maximum Bid Engine
  //
  // Answers ONE question per nomination:
  //   "What is the most this manager should pay for this player, given
  //    their roster, their remaining budget, the remaining player pool,
  //    and the current state of the auction?"
  //
  // This is deliberately DIFFERENT from Fair Value (the market $). The
  // same $35 player is worth $40 to a manager who badly needs the slot
  // and has spare cash, and only $28 to a manager who still owes a QB
  // and an RB with limited cap space.
  //
  // Pure function. Node + browser exports at bottom. No DOM, no chrome,
  // no globals except the two engine deps (rosterOptimizer + slot
  // adapter, both already pure). Designed to be unit-testable.
  // ---------------------------------------------------------------------

  function req(name) {
    if (typeof module !== 'undefined' && module.exports) return require(name);
    return null;
  }

  // Engine deps -- pulled through the DraftPilot global in the browser
  // and via require() in Node tests. Falls back to no-op stubs when
  // absent so this module never throws at load time.
  function getRosterOptimizer() {
    if (typeof module !== 'undefined' && module.exports) return req('./rosterOptimizer.js');
    return (global.DraftPilot && global.DraftPilot.rosterOptimizer) || null;
  }
  function getSlotAdapter() {
    if (typeof module !== 'undefined' && module.exports) return req('./sleeperSlotAdapter.js');
    return (global.DraftPilot && global.DraftPilot.sleeperSlotAdapter) || null;
  }

  // ---------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------
  function num(v, dflt) { const n = Number(v); return Number.isFinite(n) ? n : (dflt == null ? 0 : dflt); }

  // Coerce a caller-supplied fair-value range into {low, center, high}
  // with integer dollars and the low <= center <= high invariant.
  // When absent OR malformed, synthesize a single-point range from the
  // scalar so downstream (UI + breakdown) always has a range object.
  function normalizeRange(range, scalarCenter) {
    const c = Math.max(1, Math.round(num(scalarCenter, 0)));
    if (!range || typeof range !== 'object') return { low: c, center: c, high: c };
    let low = Math.max(1, Math.round(num(range.low, c)));
    let high = Math.max(low, Math.round(num(range.high, c)));
    let center = Math.max(1, Math.round(num(range.center, c)));
    if (low > center) low = center;
    if (high < center) high = center;
    return { low, center, high };
  }

  // Format a range for UI. Collapses to a single number when
  // low == high (typically the scalar-only fallback path).
  function formatRange(r) {
    if (!r) return '';
    return r.low === r.high ? `$${r.center}` : `$${r.low}–${r.high}`;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function round(v) { return Math.max(1, Math.round(v)); }
  function upper(s) { return String(s == null ? '' : s).toUpperCase(); }
  function median(nums) {
    const a = nums.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
    if (!a.length) return null;
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  // ---------------------------------------------------------------------
  // Roster + pool assembly
  //
  // The live-draft observer scrapes team.roster as [{name, amount,
  // position, team}] with NO projection. The optimizer wants players
  // with projections. We look them up by name+position in the exported
  // pool. Missing projection defaults to 0 (rosterOptimizer treats
  // zero-projection players as fillers -- they still consume a slot).
  // ---------------------------------------------------------------------
  function buildPoolIndex(pool) {
    const idx = new Map();
    if (!pool || !Array.isArray(pool.players)) return idx;
    for (const p of pool.players) {
      const k = (upper(p.name) + '|' + upper(p.position));
      idx.set(k, p);
    }
    return idx;
  }

  function rosterAsPlayers(roster, poolIdx) {
    const out = [];
    if (!Array.isArray(roster)) return out;
    for (let i = 0; i < roster.length; i++) {
      const r = roster[i] || {};
      const pos = upper(r.position);
      if (!pos) continue;
      const k = upper(r.name) + '|' + pos;
      const src = poolIdx.get(k);
      const projection = src ? num(src.projection, 0) : 0;
      const eligiblePositions = src && Array.isArray(src.eligiblePositions) && src.eligiblePositions.length
        ? src.eligiblePositions.map(upper)
        : [pos];
      out.push({
        id: 'roster-' + i + '-' + k,
        name: r.name,
        position: pos,
        projection,
        eligiblePositions,
      });
    }
    return out;
  }

  function nomAsCandidate(nom) {
    if (!nom) return null;
    const pos = upper(nom.position);
    if (!pos) return null;
    return {
      id: 'nom',
      name: nom.playerName || 'nominee',
      position: pos,
      projection: num(nom.sleeperProjection, 0),
      eligiblePositions: Array.isArray(nom.eligiblePositions) && nom.eligiblePositions.length
        ? nom.eligiblePositions.map(upper)
        : [pos],
    };
  }

  // ---------------------------------------------------------------------
  // Starting slots
  //
  // Always derived from the actual league config -- never hard-coded.
  // Sleeper draft.settings and league.settings share the slots_* shape.
  // ---------------------------------------------------------------------
  function resolveStartingSlots({ draft, league, format }) {
    const adapter = getSlotAdapter();
    if (!adapter) return null;
    // Prefer draft.settings (auctions live here); fall back to league.settings.
    const settings = (draft && draft.settings) || (league && league.settings) || null;
    if (settings) {
      const slots = adapter.buildStartingSlots(settings);
      if (slots && slots.length) return slots;
    }
    // Last-ditch: reconstruct from format.rosterSlots if the adapter came
    // up empty (e.g. mock inputs in tests that don't carry raw settings).
    if (format && format.rosterSlots) {
      return rosterSlotsToStartingSlots(format.rosterSlots);
    }
    return null;
  }

  const DEFAULT_ELIG = {
    QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF', 'DST'],
    FLEX: ['RB', 'WR', 'TE'],
    SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
    WR_TE_FLEX: ['WR', 'TE'],
    WR_RB_FLEX: ['RB', 'WR'],
  };

  function rosterSlotsToStartingSlots(rs) {
    const out = [];
    const order = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'WR_TE_FLEX', 'WR_RB_FLEX', 'K', 'DEF'];
    for (const id of order) {
      const n = num(rs[id], 0);
      const elig = DEFAULT_ELIG[id] || [id];
      for (let i = 0; i < n; i++) out.push({ id, allowedPositions: elig.slice() });
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // Which slot(s) does the candidate fill / upgrade?
  //
  // Diff the optimal assignments before vs after adding the candidate.
  // Returns { slotId, displacedName? } for the slot the candidate
  // occupies in the post-add lineup (undefined if he lands on the bench).
  // ---------------------------------------------------------------------
  function diffFill(baseline, withCand) {
    if (!withCand || !Array.isArray(withCand.assignments)) return null;
    const cand = withCand.assignments.find((a) => a.player && a.player.id === 'nom');
    if (!cand) return null; // candidate benched
    const baseAtSlot = baseline && baseline.assignments && baseline.assignments[cand.slotIndex];
    const displaced = baseAtSlot && baseAtSlot.player && baseAtSlot.player.id !== 'nom'
      ? baseAtSlot.player
      : null;
    return {
      slotId: cand.slot && cand.slot.id,
      slotIndex: cand.slotIndex,
      displaced: displaced ? { name: displaced.name, position: displaced.position, projection: displaced.projection } : null,
      fillsEmptySlot: !baseAtSlot || !baseAtSlot.player,
    };
  }

  // ---------------------------------------------------------------------
  // Roster-need tone
  //
  // Not "is the position filled?" -- that's the Henry-problem trap.
  // Instead, normalized marginal lineup value:
  //     ratio = withCand.totalProjection - baseline.totalProjection
  //             --------------------------------------------------
  //                        candidate.projection
  //
  //   ratio >= 0.60  -> 'high'    (fills an empty slot with strong contribution,
  //                                 or displaces a much weaker starter)
  //   ratio >= 0.20  -> 'moderate' (real lineup upgrade, but partial)
  //   ratio >= 0.05  -> 'low'      (marginal upgrade, mostly bench)
  //   otherwise      -> 'none'    (bench depth only)
  // ---------------------------------------------------------------------
  function classifyNeed(ratio) {
    if (!Number.isFinite(ratio) || ratio <= 0) return 'none';
    if (ratio >= 0.60) return 'high';
    if (ratio >= 0.20) return 'moderate';
    if (ratio >= 0.05) return 'low';
    return 'none';
  }

  // ---------------------------------------------------------------------
  // Expected minimum reserve $ per open slot, by position
  //
  // These are DEFENSIVE FLOORS -- the least we should keep on hand for
  // a still-open slot at that position. Not the "market rate" a top-tier
  // player will cost. The distinction matters: opportunity cost should
  // bite when a manager can't afford even a modest starter later, not
  // whenever they can't afford the top-tier player at every position.
  //
  // Pool-derived medians were the earlier design and caused the engine
  // to reserve top-tier money for every empty slot, wiping out every
  // manager's spendable budget in the mid-early draft. Fixed floors
  // scale correctly: a $60-remaining manager gets high pressure, a
  // $200-remaining manager gets low, without touching pool-specific
  // projection scales.
  // ---------------------------------------------------------------------
  const RESERVE_FLOOR = { QB: 4, RB: 6, WR: 5, TE: 3, K: 1, DEF: 1 };

  function expectedCostByPosition(_pool, _teamCount) {
    // Deliberately ignores pool + teamCount inputs -- floors are league-
    // agnostic. Kept as an object return so requiredFutureBudget can
    // look up by position without a branch, and so future work could
    // swap in a data-driven table without changing callers.
    return Object.assign({}, RESERVE_FLOOR);
  }

  // ---------------------------------------------------------------------
  // Required Future Budget
  //
  // For each roster slot the manager still needs after this hypothetical
  // buy, estimate the minimum $ they should reserve. Starting slots use
  // the expected market cost for their eligibility; bench slots always
  // reserve $1 (min legal bid).
  //
  // fillsSlotId (if provided) is the slot the candidate would occupy --
  // that slot is EXCLUDED from the required-future sum since the buy
  // resolves it.
  // ---------------------------------------------------------------------
  function requiredFutureBudget({ openSlots, startingSlotDefs, expectedCost, fillsSlotId }) {
    if (!Array.isArray(openSlots) || openSlots.length === 0) return 0;
    // Count how many of each slot-id are still open. Sleeper's openSlots
    // is a flat list like ['RB','WR','FLEX','SUPER_FLEX','BN','BN'].
    const openCount = {};
    for (const s of openSlots) {
      const k = upper(s);
      openCount[k] = (openCount[k] || 0) + 1;
    }
    // Decrement one instance of the slot this player would fill.
    if (fillsSlotId && openCount[upper(fillsSlotId)]) {
      openCount[upper(fillsSlotId)] -= 1;
    }

    let total = 0;
    for (const slotId of Object.keys(openCount)) {
      const n = openCount[slotId];
      if (n <= 0) continue;
      if (slotId === 'BN') { total += n * 1; continue; }
      // Find the slot definition to know eligibility.
      const def = (startingSlotDefs || []).find((d) => upper(d.id) === slotId);
      const elig = def ? def.allowedPositions.map(upper) : DEFAULT_ELIG[slotId] || [slotId];
      // Cost = min expected cost across eligible positions. A flex
      // reserves only what its cheapest realistic fill costs -- managers
      // don't need to reserve QB-tier money for a WR/RB/TE flex.
      const costs = elig
        .map((pos) => expectedCost[pos])
        .filter((v) => v != null && Number.isFinite(v));
      const perSlot = costs.length ? Math.min.apply(null, costs) : (RESERVE_FLOOR[slotId] || 3);
      total += n * Math.max(1, Math.round(perSlot));
    }
    return total;
  }

  // ---------------------------------------------------------------------
  // Competition scan (mirrors legacy bidderProfile logic, but purely on
  // the inputs we already have -- no dependency on the legacy module).
  // ---------------------------------------------------------------------
  function seriousCompetitors({ teams, you, position, fairValue }) {
    if (!Array.isArray(teams) || !position) return { count: 0, biggestThreat: null };
    const pos = upper(position);
    const threshold = Math.max(1, Math.floor(num(fairValue, 1) * 0.6));
    const list = [];
    for (const t of teams) {
      if (!t || t === you) continue;
      const openSlots = t.openSlots || [];
      // A team is competitive when they have a slot the player can go into
      // AND their maxBid >= 60% of fairValue.
      const slots = openSlots.filter((s) => {
        const u = upper(s);
        if (u === 'BN') return false; // bench-only isn't a "serious" bid
        const elig = DEFAULT_ELIG[u] || [u];
        return elig.includes(pos);
      });
      if (!slots.length) continue;
      const maxBid = num(t.maxBid, 0);
      if (maxBid < threshold) continue;
      list.push({ manager: t.manager || 'Unknown', maxBid, budgetRemaining: num(t.budgetRemaining, 0) });
    }
    list.sort((a, b) => b.maxBid - a.maxBid);
    return { count: list.length, biggestThreat: list[0] || null, list };
  }

  // ---------------------------------------------------------------------
  // The recommendation ladder
  //
  //   remainingValue = yourMax - currentBid
  //
  //   > 15% of yourMax OR >= $3   -> BUY
  //   >= 0                        -> CAUTION
  //   < 0                         -> PASS
  // ---------------------------------------------------------------------
  function ladder(yourMax, currentBid) {
    const rv = yourMax - currentBid;
    if (rv < 0) return { recommendation: 'PASS', remainingValue: rv };
    const cushion = Math.max(3, Math.round(yourMax * 0.10));
    if (rv >= cushion) return { recommendation: 'BUY', remainingValue: rv };
    return { recommendation: 'CAUTION', remainingValue: rv };
  }

  // ---------------------------------------------------------------------
  // Main entrypoint
  //
  // All inputs are optional-ish. Missing pool + no starting slots ->
  // returns null and the caller (computeBidRecommendation) falls back
  // to the legacy engine. Missing scarcity / alternatives / cliff -> we
  // still return a valid recommendation, just with lower confidence and
  // no scarcity/replacement lift.
  // ---------------------------------------------------------------------
  function computeYourMax(opts) {
    const o = opts || {};
    const nom = o.nom || null;
    const fairValue = num(o.fairValue, 0);
    // Fair Value RANGE. When absent, callers get a single-point range
    // synthesized from the scalar (low==center==high) so downstream
    // code and the UI always have a range to render.
    const fairValueRange = normalizeRange(o.fairValueRange, fairValue);
    const currentBid = Math.max(0, Math.floor(num(o.currentBid, 0)));
    const you = o.you || null;
    const teams = o.teams || [];
    const league = o.league || null;
    const draft = o.draft || null;
    const format = o.format || null;
    const pool = o.pool || null;
    const scarcity = o.scarcity || null;
    const cliff = o.cliff || null;
    const alternatives = o.alternatives || null;

    if (!nom || !nom.position || fairValue <= 0) return null;

    const optimizer = getRosterOptimizer();
    const startingSlots = resolveStartingSlots({ draft, league, format });
    if (!optimizer || !startingSlots || !startingSlots.length) return null;
    if (!you) return null;

    // 1. Build roster + candidate as optimizer players.
    const poolIdx = buildPoolIndex(pool);
    const rosterPlayers = rosterAsPlayers(you.roster, poolIdx);
    const candidate = nomAsCandidate(nom);
    if (!candidate) return null;

    // 2. Optimal lineup baseline + with-candidate.
    const baseline = optimizer.computeOptimalLineup(startingSlots, rosterPlayers);
    const withCand = optimizer.computeOptimalLineup(startingSlots, rosterPlayers.concat([candidate]));
    const marginal = Math.max(0, withCand.totalProjection - baseline.totalProjection);
    const candProj = num(candidate.projection, 0);
    const ratio = candProj > 0 ? marginal / candProj : 0;
    const needTone = classifyNeed(ratio);
    const fill = diffFill(baseline, withCand);

    // 3. Convert need to a $ lift on top of fairValue.
    let rosterLiftPct = 0;
    if (needTone === 'high') rosterLiftPct = 0.18;
    else if (needTone === 'moderate') rosterLiftPct = 0.06;
    else if (needTone === 'low') rosterLiftPct = -0.05;
    else rosterLiftPct = -0.30;

    // 4. Scarcity contribution -- only when the player would meaningfully
    //    improve the lineup. Filling a slot you don't need doesn't get
    //    boosted just because the position is scarce league-wide.
    let scarcityLiftPct = 0;
    const level = scarcity && scarcity.level;
    const strongNeed = needTone === 'high' || needTone === 'moderate';
    if (strongNeed) {
      if (level === 'CRITICAL') scarcityLiftPct = 0.15;
      else if (level === 'HIGH') scarcityLiftPct = 0.10;
      else if (level === 'MEDIUM') scarcityLiftPct = 0.05;
      if (cliff && cliff.isSevere) scarcityLiftPct = Math.min(0.20, scarcityLiftPct + 0.05);
    } else if (needTone === 'low' && level === 'CRITICAL') {
      // Even bench-adjacent players get a nudge under critical scarcity.
      scarcityLiftPct = 0.03;
    }

    // 5. Replacement-depth trim -- lots of comparable alternatives means
    //    don't reach; few means willingness-to-pay goes up a touch.
    let replacementLiftPct = 0;
    const rd = alternatives && alternatives.replacementContext
      ? alternatives.replacementContext.replacementDepth : null;
    if (strongNeed && rd === 'strong') replacementLiftPct = -0.05;
    else if (strongNeed && rd === 'weak') replacementLiftPct = 0.03;

    // 6. Competition adjust -- modest. Auction-price momentum.
    const comp = seriousCompetitors({ teams, you, position: nom.position, fairValue });
    let competitionLiftPct = 0;
    if (strongNeed) {
      if (comp.count >= 3) competitionLiftPct = 0.03;
      else if (comp.count === 0) competitionLiftPct = -0.03;
    }

    // 7. Required Future Budget + opportunity cost.
    const openSlots = you.openSlots || [];
    const expectedCost = expectedCostByPosition(pool, num((format && format.teams) || o.teamCount, 12));
    const requiredFuture = requiredFutureBudget({
      openSlots, startingSlotDefs: startingSlots, expectedCost,
      fillsSlotId: fill && !fill.displaced ? fill.slotId : null,
    });
    const remainingBudget = num(you.budgetRemaining, 0);
    const spendableIfBuy = Math.max(0, remainingBudget - requiredFuture);
    // Budget pressure: how much of my remaining $ is already spoken for
    // by required-future spend. 1.0 = every dollar reserved.
    const pressure = remainingBudget > 0
      ? clamp(requiredFuture / remainingBudget, 0, 1.2)
      : 1;
    let pressureTone = 'low';
    let opportunityCutPct = 0;
    // Thresholds tuned to the RESERVE_FLOOR-based requiredFuture:
    //   >= 0.75 => can't afford floor reserves -- genuine danger.
    //   >= 0.50 => reserves eat most of the budget -- moderate caution.
    //   >= 0.30 => reserves eat a real chunk -- no adjustment either way.
    //   <  0.30 => plenty of headroom -- tiny lift.
    if (pressure >= 0.70) { pressureTone = 'high'; opportunityCutPct = 0.15; }
    else if (pressure >= 0.35) { pressureTone = 'moderate'; opportunityCutPct = 0.07; }
    else if (pressure >= 0.20) { pressureTone = 'low'; opportunityCutPct = 0; }
    else { pressureTone = 'none'; opportunityCutPct = -0.03; /* very safe -> slight lift */ }

    // 8. Assemble the raw max in dollars, then clamp by legality + spend.
    const totalLiftPct = clamp(
      rosterLiftPct + scarcityLiftPct + replacementLiftPct + competitionLiftPct - opportunityCutPct,
      -0.60, 0.35
    );
    const rawMax = fairValue * (1 + totalLiftPct);

    // Legality: after this buy, we still owe $1 for every other open slot.
    const otherOpenSlots = Math.max(0, openSlots.length - 1);
    const maxLegal = Math.max(1, Math.floor(remainingBudget - otherOpenSlots * 1));

    // Spendable cap: if buying at rawMax would prevent completing the
    // roster with real starters, hard-cap to spendableIfBuy. But never
    // below $1 -- if the player still fits legally, at least $1 is on
    // the table.
    let yourMax = Math.min(rawMax, spendableIfBuy > 0 ? spendableIfBuy : rawMax, maxLegal);
    yourMax = round(yourMax);

    // 9. Never recommend below $1 or above legal cap.
    if (yourMax > maxLegal) yourMax = maxLegal;
    if (yourMax < 1) yourMax = 1;

    // 10. Ladder decision from currentBid vs yourMax.
    const decision = ladder(yourMax, Math.max(0, currentBid));

    // 11. Confidence.
    let confidence = 'high';
    const missing = [];
    if (!pool || !Array.isArray(pool.players) || !pool.players.length) missing.push('pool');
    if (!scarcity) missing.push('scarcity');
    if (!alternatives) missing.push('alternatives');
    if (missing.length >= 2) confidence = 'low';
    else if (missing.length === 1) confidence = 'medium';

    // 12. Primary reason -- one plain sentence.
    const primaryReason = pickPrimaryReason({
      decision, needTone, fill, level, pressureTone, comp, rd,
      position: nom.position, currentBid, yourMax,
    });

    // 13. Reason chips (small array, kept short for the header row).
    const reasons = pickReasons({
      needTone, fill, level, pressureTone, comp, rd, position: nom.position,
    });

    // 14. Breakdown -- for the "Why?" details panel. Presented as
    //     dollar-terms rather than raw percentages.
    const breakdown = buildBreakdown({
      fairValue, fairValueRange, rosterLiftPct, scarcityLiftPct, replacementLiftPct,
      competitionLiftPct, opportunityCutPct, yourMax, currentBid,
      remainingBudget, requiredFuture, openSlots, comp, needTone,
      level, rd, pressureTone,
    });

    return {
      fairValue,
      fairValueRange,
      recommendedMax: yourMax,
      currentBid,
      remainingValue: decision.remainingValue,
      recommendation: decision.recommendation,
      confidence,
      rosterNeed: {
        tone: needTone,
        marginalValue: marginal,
        ratio,
        fillsSlot: fill && !fill.displaced ? fill.slotId : null,
        displaces: fill && fill.displaced ? fill.displaced : null,
      },
      opportunityCost: {
        tone: pressureTone,
        pressure,
        dollarsCut: Math.round(fairValue * opportunityCutPct),
      },
      scarcity: {
        level: level || null,
        dollars: Math.round(fairValue * scarcityLiftPct),
      },
      replacementDepth: rd,
      competition: {
        seriousBidders: comp.count,
        biggestThreat: comp.biggestThreat,
        dollars: Math.round(fairValue * competitionLiftPct),
      },
      budgetPressure: {
        remainingBudget,
        requiredFuture,
        spendable: spendableIfBuy,
        openSlots: openSlots.length,
        maxLegal,
        tone: pressureTone,
      },
      primaryReason,
      reasons,
      breakdown,
    };
  }

  // ---------------------------------------------------------------------
  // Copy generation. All plain-language, no jargon, no percentages.
  // ---------------------------------------------------------------------
  function pickPrimaryReason({ decision, needTone, fill, level, pressureTone, comp, rd, position, currentBid, yourMax }) {
    const pos = upper(position);
    if (decision.recommendation === 'PASS') {
      const over = currentBid - yourMax;
      if (pressureTone === 'high') {
        return `You're $${over} over your max — spending here leaves you short elsewhere.`;
      }
      return `You're $${over} over your max on this player.`;
    }
    // BUY / CAUTION path
    const slotText = fill && fill.slotId && fill.slotId !== 'BN' ? fill.slotId.replace(/_/g, ' ') : null;
    if (needTone === 'high' && (level === 'CRITICAL' || level === 'HIGH')) {
      return slotText
        ? `Fills your ${slotText} and few ${pos}s remain.`
        : `Strong starter fit and few ${pos}s remain.`;
    }
    if (needTone === 'high') {
      return slotText ? `Fills your ${slotText}.` : `Fills a starting spot for you.`;
    }
    if (needTone === 'moderate' && rd === 'strong') {
      return `Real upgrade, but several similar ${pos}s remain.`;
    }
    if (needTone === 'moderate') {
      return slotText ? `Upgrades your ${slotText}.` : `Real lineup upgrade.`;
    }
    if (needTone === 'low' && pressureTone === 'high') {
      return `Depth only — your budget is spoken for elsewhere.`;
    }
    if (needTone === 'low') {
      return `Depth only — comparable options remain.`;
    }
    return `Bench depth only — no lineup upgrade.`;
  }

  function pickReasons({ needTone, fill, level, pressureTone, comp, rd, position }) {
    const pos = upper(position);
    const out = [];
    if (needTone === 'high' && fill && fill.slotId && fill.slotId !== 'BN') {
      out.push(`Fills ${fill.slotId.replace(/_/g, ' ')}`);
    } else if (needTone === 'high') {
      out.push('Strong starter fit');
    } else if (needTone === 'moderate') {
      out.push('Lineup upgrade');
    } else if (needTone === 'low') {
      out.push('Bench depth');
    } else {
      out.push('No lineup upgrade');
    }
    if (level === 'CRITICAL' || level === 'HIGH') out.push(`${pos} scarcity high`);
    else if (level === 'MEDIUM') out.push(`Limited ${pos} depth`);
    if (rd === 'strong') out.push('Alternatives remain');
    else if (rd === 'weak') out.push('Few alternatives left');
    if (pressureTone === 'high') out.push('Budget tight');
    else if (pressureTone === 'moderate') out.push('Watch budget');
    if (comp && comp.count >= 3) out.push(`${comp.count} serious bidders`);
    else if (comp && comp.count === 0) out.push('No real competition');
    return out.slice(0, 4);
  }

  function buildBreakdown(x) {
    const rows = [];
    const dollarPct = (p) => Math.round(x.fairValue * p);
    // Fair value row shows the RANGE. Falls back to the scalar when
    // the range collapsed to a point (missing tierAggregates path).
    rows.push(['Fair value', formatRange(x.fairValueRange)]);
    rows.push(['Roster need', labelForNeed(x.needTone)]);
    if (x.rosterLiftPct) rows.push(['Roster adj', signed(dollarPct(x.rosterLiftPct))]);
    if (x.level) rows.push(['Scarcity', String(x.level)]);
    if (x.scarcityLiftPct) rows.push(['Scarcity adj', signed(dollarPct(x.scarcityLiftPct))]);
    if (x.rd) rows.push(['Alternatives', labelForDepth(x.rd)]);
    if (x.replacementLiftPct) rows.push(['Alt adj', signed(dollarPct(x.replacementLiftPct))]);
    rows.push(['Competition', `${x.comp.count} serious`]);
    if (x.competitionLiftPct) rows.push(['Comp adj', signed(dollarPct(x.competitionLiftPct))]);
    rows.push(['Budget pressure', labelForPressure(x.pressureTone)]);
    if (x.opportunityCutPct) rows.push(['Opportunity cost', signed(-dollarPct(x.opportunityCutPct))]);
    rows.push(['Remaining budget', `$${x.remainingBudget}`]);
    rows.push(['Reserved for other slots', `$${x.requiredFuture}`]);
    rows.push(['Your max', `$${x.yourMax}`]);
    rows.push(['Current bid', `$${x.currentBid}`]);
    return rows;
  }

  function labelForNeed(t) {
    return t === 'high' ? 'High' : t === 'moderate' ? 'Moderate' : t === 'low' ? 'Low' : 'None';
  }
  function labelForDepth(d) {
    return d === 'strong' ? 'Many remain' : d === 'moderate' ? 'Some remain' : 'Few remain';
  }
  function labelForPressure(t) {
    return t === 'high' ? 'High' : t === 'moderate' ? 'Moderate' : t === 'low' ? 'Low' : 'None';
  }
  function signed(n) {
    if (!n) return '$0';
    return (n > 0 ? '+$' : '-$') + Math.abs(n);
  }

  // ---------------------------------------------------------------------
  // Exports
  // ---------------------------------------------------------------------
  const api = {
    computeYourMax,
    // Exposed for unit tests -- callers should not use these directly.
    _classifyNeed: classifyNeed,
    _ladder: ladder,
    _requiredFutureBudget: requiredFutureBudget,
    _expectedCostByPosition: expectedCostByPosition,
    _seriousCompetitors: seriousCompetitors,
    _resolveStartingSlots: resolveStartingSlots,
    _rosterAsPlayers: rosterAsPlayers,
    _diffFill: diffFill,
  };

  global.DraftPilot = global.DraftPilot || {};
  global.DraftPilot.bidEngine = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined'
  ? window
  : typeof self !== 'undefined'
    ? self
    : typeof global !== 'undefined'
      ? global
      : globalThis);
