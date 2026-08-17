(function (global) {
  // ---------------------------------------------------------------------
  // Slot-driven roster optimizer
  //
  // League-format agnostic. Reasons from three inputs:
  //   startingSlots[]  -- [{ id, allowedPositions[] }, ...]
  //                       Multiple entries with the same id are allowed
  //                       (e.g., two { id:'RB', allowedPositions:['RB'] }
  //                       for a 2-RB league). Slot semantics live entirely
  //                       in allowedPositions -- 'FLEX', 'SUPER_FLEX',
  //                       'QB_FLEX', or any custom id are just labels.
  //   players[]        -- [{ id, position, projection, eligiblePositions? }]
  //                       eligiblePositions defaults to [position].
  //   candidate        -- a single Player (for marginalValue).
  //
  // Produces:
  //   computeOptimalLineup(slots, players) -> {
  //     assignments: [{ slotIndex, slot, player }],  // player=null if unfilled
  //     totalProjection,
  //     unfilledSlots,
  //     bench,                                       // Player[] not started
  //   }
  //   marginalValue(slots, roster, candidate) ->
  //     optimalTotal(roster + candidate) - optimalTotal(roster)
  //
  // No hardcoded position lists, no hardcoded slot names, no FLEX/SF
  // heuristics. Eligibility is answered by string-membership in
  // slot.allowedPositions against player.eligiblePositions.
  // ---------------------------------------------------------------------

  const NEG_INF = -1e15;

  /**
   * Returns the set of positions a player is eligible for. Prefers the
   * explicit eligiblePositions[] on the player (some platforms expose
   * multi-position eligibility like RB/WR). Falls back to [position].
   */
  function eligiblePositionsOf(player) {
    if (!player) return [];
    if (Array.isArray(player.eligiblePositions) && player.eligiblePositions.length) {
      return player.eligiblePositions.map(normalizePos);
    }
    if (player.position) return [normalizePos(player.position)];
    return [];
  }

  function normalizePos(p) {
    return String(p || '').toUpperCase();
  }

  /**
   * True iff `player` can legally fill `slot`. Case-insensitive on
   * position strings; empty allowedPositions means "no player is
   * eligible" (a slot that accepts nothing is dead weight but valid).
   */
  function playerEligibleForSlot(player, slot) {
    if (!slot || !Array.isArray(slot.allowedPositions)) return false;
    const allowed = slot.allowedPositions.map(normalizePos);
    const elig = eligiblePositionsOf(player);
    for (const p of elig) if (allowed.includes(p)) return true;
    return false;
  }

  /**
   * Coerce a projection to a finite non-negative number. Missing /
   * malformed projections become 0 so the optimizer still assigns the
   * player (it just contributes nothing to totalProjection). Callers
   * that want to *prevent* assignment of a value-less player should
   * filter before calling.
   */
  function projOf(player) {
    const v = Number(player && player.projection);
    return Number.isFinite(v) && v > 0 ? v : 0;
  }

  // ---------------------------------------------------------------------
  // Max-weight bipartite matching (Hungarian on square cost matrix).
  //
  // We build an n x n cost matrix where n = max(slots, players), pad
  // both dims with dummies, and encode ineligibility as NEG_INF weight
  // (so it is only chosen when nothing else is available -- and only
  // against dummies, since real slots always have a zero-cost dummy
  // player option after padding).
  //
  // Minimizes cost; we feed it -weights so it maximizes projection.
  // O(n^3), n typically <= 15-20. Trivially fast.
  // ---------------------------------------------------------------------
  function hungarianMinCost(cost) {
    const n = cost.length;
    if (n === 0) return [];
    const INF = Infinity;
    const u = new Array(n + 1).fill(0);
    const v = new Array(n + 1).fill(0);
    const p = new Array(n + 1).fill(0);
    const way = new Array(n + 1).fill(0);

    for (let i = 1; i <= n; i++) {
      p[0] = i;
      let j0 = 0;
      const minv = new Array(n + 1).fill(INF);
      const used = new Array(n + 1).fill(false);
      do {
        used[j0] = true;
        const i0 = p[j0];
        let delta = INF, j1 = -1;
        for (let j = 1; j <= n; j++) {
          if (used[j]) continue;
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (let j = 0; j <= n; j++) {
          if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
          else { minv[j] -= delta; }
        }
        j0 = j1;
      } while (p[j0] !== 0);
      do {
        const j1 = way[j0];
        p[j0] = p[j1];
        j0 = j1;
      } while (j0 !== 0);
    }

    const assign = new Array(n).fill(-1); // row -> col
    for (let j = 1; j <= n; j++) {
      if (p[j] > 0) assign[p[j] - 1] = j - 1;
    }
    return assign;
  }

  /**
   * Solve the optimal starting lineup.
   *
   * Rows = starting slots (as given, preserving order).
   * Cols = players (as given, then padded with dummies to make the
   * matrix square). Dummy rows have zero cost against any col (so
   * "extra" players go to bench). Dummy cols have zero cost against
   * any row (so slots that can't be filled get "no player").
   *
   * Real (slot, player) edge weight: player.projection when eligible,
   * else NEG_INF. Minimizing -weight => maximizing projection.
   */
  function computeOptimalLineup(startingSlots, players) {
    const slots = Array.isArray(startingSlots) ? startingSlots : [];
    const pool = Array.isArray(players) ? players.slice() : [];
    const nSlots = slots.length;
    const nPlayers = pool.length;

    // Empty starting lineup: trivially optimal at zero, everyone benches.
    if (nSlots === 0) {
      return {
        assignments: [],
        totalProjection: 0,
        unfilledSlots: 0,
        bench: pool.slice(),
      };
    }

    const n = Math.max(nSlots, nPlayers);
    // Build cost matrix. cost[i][j] is what we minimize.
    // - i < nSlots, j < nPlayers : -projection if eligible else -NEG_INF
    // - i < nSlots, j >= nPlayers: 0        (real slot to dummy player => unfilled)
    // - i >= nSlots, j < nPlayers: 0        (dummy slot to real player => bench)
    // - i >= nSlots, j >= nPlayers: 0
    //
    // NEG_INF as a *weight* -> +|NEG_INF| as a cost. That value stays
    // large enough that it's never picked over any zero-cost dummy.
    const cost = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < nSlots; i++) {
      const slot = slots[i];
      for (let j = 0; j < nPlayers; j++) {
        const player = pool[j];
        if (playerEligibleForSlot(player, slot)) {
          cost[i][j] = -projOf(player);
        } else {
          cost[i][j] = -NEG_INF; // huge positive cost => avoided
        }
      }
    }

    const rowToCol = hungarianMinCost(cost);

    const assignments = [];
    const usedPlayerIdx = new Set();
    let totalProjection = 0;
    let unfilledSlots = 0;

    for (let i = 0; i < nSlots; i++) {
      const col = rowToCol[i];
      const player = (col != null && col >= 0 && col < nPlayers) ? pool[col] : null;
      // A "player" assignment counts only if the edge was legal (finite
      // weight). If ineligibility slipped through (nPlayers < nSlots and
      // no eligible player for this slot), player will be null.
      let assignedPlayer = null;
      if (player && playerEligibleForSlot(player, slots[i])) {
        assignedPlayer = player;
        usedPlayerIdx.add(col);
        totalProjection += projOf(player);
      } else {
        unfilledSlots++;
      }
      assignments.push({ slotIndex: i, slot: slots[i], player: assignedPlayer });
    }

    const bench = [];
    for (let j = 0; j < nPlayers; j++) {
      if (!usedPlayerIdx.has(j)) bench.push(pool[j]);
    }

    return { assignments, totalProjection, unfilledSlots, bench };
  }

  /**
   * Marginal starting-lineup value of adding `candidate` to `roster`.
   *
   * Sign convention: positive means the candidate strictly improves the
   * optimal lineup (either fills an empty slot, or displaces a weaker
   * starter who drops to the bench). Zero means the candidate is bench
   * depth only. Never negative (adding a player can never hurt the
   * optimal lineup).
   */
  function marginalValue(startingSlots, roster, candidate) {
    if (!candidate) return 0;
    const baseline = computeOptimalLineup(startingSlots, roster || []).totalProjection;
    const withCand = computeOptimalLineup(startingSlots, (roster || []).concat([candidate])).totalProjection;
    // Clamp tiny negatives from floating-point noise.
    return Math.max(0, withCand - baseline);
  }

  // ---------------------------------------------------------------------
  // Exports
  // ---------------------------------------------------------------------
  const api = {
    computeOptimalLineup,
    marginalValue,
    // Exposed for tests / adapters:
    _playerEligibleForSlot: playerEligibleForSlot,
    _eligiblePositionsOf: eligiblePositionsOf,
    _hungarianMinCost: hungarianMinCost,
  };

  global.DraftPilot = global.DraftPilot || {};
  global.DraftPilot.rosterOptimizer = api;

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
