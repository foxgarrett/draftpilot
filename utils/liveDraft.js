(function (global) {
  const { sleeperApi } = global.DraftPilot;
  // Optional: new slot-driven optimizer + Sleeper slot adapter. Loaded
  // lazily at call sites so environments that don't ship them (older
  // tests, minimal contexts) still work.
  function getOptimizer() {
    return (global.DraftPilot && global.DraftPilot.rosterOptimizer) || null;
  }
  function getSlotAdapter() {
    return (global.DraftPilot && global.DraftPilot.sleeperSlotAdapter) || null;
  }
  function slotOptimizerEnabled() {
    const ff = global.DraftPilot && global.DraftPilot.featureFlags;
    if (!ff || typeof ff.isEnabled !== 'function') return false;
    return ff.isEnabled('slotDrivenOptimizer');
  }
  function rosterAwareMaxBidEnabled() {
    const ff = global.DraftPilot && global.DraftPilot.featureFlags;
    if (!ff || typeof ff.isEnabled !== 'function') return false;
    return ff.isEnabled('rosterAwareMaxBid');
  }
  function getBidEngine() {
    return (global.DraftPilot && global.DraftPilot.bidEngine) || null;
  }

  /**
   * Compute the user's marginal starting-lineup value for `nom` using
   * the new slot-driven engine. Returns null when we don't have enough
   * data to compute it (no league settings, no player pool with
   * projections, no user roster). Caller must be prepared for null.
   *
   * The join from team.roster ({name, position}) to pool projections is
   * name-based; players missing from the pool contribute 0 projection
   * (they still occupy slots but don't add lineup value). That mirrors
   * how a manager would view a mystery bench filler.
   */
  function computeUserMarginalValue(opts) {
    const optimizer = getOptimizer();
    const adapter = getSlotAdapter();
    if (!optimizer || !adapter) return null;
    const { you, nom, league, pool } = opts || {};
    if (!you || !nom || !nom.position || !league || !pool) return null;
    const settings = league.settings;
    if (!settings) return null;
    const slots = adapter.buildStartingSlots(settings);
    if (!slots.length) return null;

    // Index pool by canonical name for the roster join.
    const byName = new Map();
    for (const p of pool.players || []) {
      if (p && p.name) byName.set(String(p.name).toLowerCase(), p);
    }

    const rosterPlayers = (you.roster || []).map((r) => {
      const key = r && r.name ? String(r.name).toLowerCase() : null;
      const hit = key ? byName.get(key) : null;
      return {
        id: (r && r.player_id) || (r && r.name) || null,
        position: (r && r.position) || (hit && hit.position) || '',
        projection: hit && Number.isFinite(hit.projection) ? hit.projection : 0,
      };
    });

    // Candidate projection: prefer the nom's own projection (from the
    // pool lookup or nom.projection). Zero is fine — marginalValue
    // still returns 0, which is the right answer.
    let candProj = 0;
    if (typeof nom.projection === 'number' && nom.projection > 0) {
      candProj = nom.projection;
    } else if (nom.playerName) {
      const hit = byName.get(String(nom.playerName).toLowerCase());
      if (hit && Number.isFinite(hit.projection)) candProj = hit.projection;
    }
    const candidate = { id: 'nom', position: nom.position, projection: candProj };

    const delta = optimizer.marginalValue(slots, rosterPlayers, candidate);
    return { delta, candidateProjection: candProj };
  }

  const POLL_INTERVAL_MS = 5000;
  const ERROR_BACKOFF_MS = 15000;

  // Sleeper draft URLs: /draft/nfl/{draftId} or /draft/{draftId}. Draft IDs
  // are numeric strings, currently 18 digits, but we accept 10+ to be safe
  // against future length changes.
  function extractDraftIdFromUrl(url) {
    if (!url) return null;
    const m = String(url).match(/\/draft\/(?:nfl\/)?(\d{10,})/);
    return m ? m[1] : null;
  }

  function sortPicks(picks) {
    return (picks || []).slice().sort((a, b) => (a.pick_no || 0) - (b.pick_no || 0));
  }

  function playerName(pick) {
    const m = (pick && pick.metadata) || {};
    const full = `${m.first_name || ''} ${m.last_name || ''}`.trim();
    return full || (pick && pick.player_id ? `Player ${pick.player_id}` : 'Unknown');
  }

  function pickAmount(pick) {
    const raw = pick && pick.metadata && pick.metadata.amount;
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  // Sleeper returns picks with picked_by=user_id for real users and
  // roster_id for the team slot. Manager display name comes from the
  // league_users lookup; fall back to a slot label if the user isn't in
  // the users list (mock drafts, etc.).
  function managerLabel(pick, managerNames) {
    const uid = pick && pick.picked_by;
    if (uid && managerNames[uid]) return managerNames[uid];
    const slot = pick && pick.draft_slot;
    return slot ? `Slot ${slot}` : 'Unknown manager';
  }

  /**
   * Creates a live-draft session bound to a single draftId. Fetches draft
   * metadata + league users once, then polls picks every POLL_INTERVAL_MS
   * (backing off to ERROR_BACKOFF_MS after 3 consecutive errors).
   *
   * Subscribers receive the full state object on every change. Call stop()
   * to tear down the poller and clear listeners.
   */
  function createSession({ draftId }) {
    const listeners = new Set();
    let state = {
      status: 'loading', // 'loading' | 'active' | 'error' | 'stopped'
      draftId,
      draft: null,
      draftStatus: null, // 'pre_draft' | 'drafting' | 'complete'
      league: null,      // full league object; carries position_limit_* etc.
      leagueName: null,
      isAuction: false,
      budget: 0,
      teamCount: 0,
      managerNames: {},
      // Full identity map for the league's users. Each entry keeps every
      // name Sleeper might render into the draft-room DOM for that user
      // (custom team name, display name, username) so downstream can
      // resolve "which team column is me?" by matching against all
      // variants for a known user_id instead of a fragile single string.
      usersById: {},
      picks: [],
      lastUpdated: null,
      lastError: null,
    };
    let poller = null;
    let stopped = false;
    let consecutiveErrors = 0;

    function emit() {
      for (const fn of Array.from(listeners)) {
        try { fn(state); } catch (_) { /* subscriber error is not our problem */ }
      }
    }
    function setState(patch) {
      state = Object.assign({}, state, patch);
      emit();
    }

    async function bootstrap() {
      try {
        const draft = await sleeperApi.getDraft(draftId);
        if (!draft) throw new Error("Draft wasn't found.");
        const type = String(draft.type || '').toLowerCase();
        const isAuction = type === 'auction';
        const settings = draft.settings || {};
        const budget = Number(settings.budget) || (isAuction ? 200 : 0);
        const teamCount = Number(settings.teams) || 0;

        // League metadata + users are optional (mock drafts have no
        // league_id). Fetch alongside the first picks pull so we're
        // active ASAP.
        const [league, users, picks] = await Promise.all([
          draft.league_id
            ? sleeperApi.getLeague(draft.league_id).catch(() => null)
            : Promise.resolve(null),
          draft.league_id
            ? sleeperApi.getLeagueUsers(draft.league_id).catch(() => [])
            : Promise.resolve([]),
          sleeperApi.getDraftPicks(draftId).catch(() => []),
        ]);

        const managerNames = {};
        const usersById = {};
        for (const u of users || []) {
          const team = u.metadata && u.metadata.team_name;
          managerNames[u.user_id] = team || u.display_name || u.user_id;
          usersById[u.user_id] = {
            userId: u.user_id,
            username: u.username || null,
            displayName: u.display_name || null,
            teamName: team || null,
          };
        }
        const leagueName =
          (league && league.name) ||
          (draft.metadata && draft.metadata.name) ||
          `Draft ${draftId}`;

        setState({
          status: 'active',
          draft,
          draftStatus: draft.status || null,
          league,
          leagueName,
          isAuction,
          budget,
          teamCount,
          managerNames,
          usersById,
          picks: sortPicks(picks),
          lastUpdated: Date.now(),
          lastError: null,
        });
        // Only keep polling while the draft could still change.
        if (state.draftStatus !== 'complete') {
          schedulePoll(POLL_INTERVAL_MS);
        }
      } catch (err) {
        setState({
          status: 'error',
          lastError: (err && (err.userMessage || err.message)) || 'Failed to load draft.',
        });
      }
    }

    function schedulePoll(delay) {
      if (stopped) return;
      poller = setTimeout(tick, delay);
    }

    async function tick() {
      poller = null;
      if (stopped) return;
      try {
        const picks = await sleeperApi.getDraftPicks(draftId);
        consecutiveErrors = 0;
        const sorted = sortPicks(picks);
        const changed = sorted.length !== state.picks.length;
        // Re-fetch draft metadata occasionally so we notice status changes
        // (pre_draft → drafting → complete). Cheap; once every 6 polls
        // (~30s at 5s cadence) is plenty.
        let draftPatch = {};
        if (Math.floor(Date.now() / 1000) % 30 < 5) {
          try {
            const fresh = await sleeperApi.getDraft(draftId);
            if (fresh && fresh.status && fresh.status !== state.draftStatus) {
              draftPatch = { draft: fresh, draftStatus: fresh.status };
            }
          } catch (_) { /* transient */ }
        }
        setState(Object.assign(
          { lastUpdated: Date.now(), lastError: null },
          changed ? { picks: sorted } : {},
          draftPatch
        ));
        if (state.draftStatus === 'complete') return; // stop polling; final state
        schedulePoll(POLL_INTERVAL_MS);
      } catch (err) {
        consecutiveErrors++;
        setState({
          lastError: (err && (err.userMessage || err.message)) || 'Polling error.',
        });
        schedulePoll(consecutiveErrors >= 3 ? ERROR_BACKOFF_MS : POLL_INTERVAL_MS);
      }
    }

    function stop() {
      if (stopped) return;
      stopped = true;
      if (poller) { clearTimeout(poller); poller = null; }
      setState({ status: 'stopped' });
      listeners.clear();
    }

    function subscribe(fn) {
      listeners.add(fn);
      // Emit current state immediately so subscriber can render without a
      // wait cycle.
      try { fn(state); } catch (_) {}
      return () => listeners.delete(fn);
    }

    bootstrap();
    return { subscribe, stop, getState: () => state };
  }

  // Total roster slots per team from the Sleeper draft settings. Auction
  // drafts don't always populate `rounds`, so we sum every slots_* field
  // as the fallback. Defaults to 15 if neither is present -- rough but
  // keeps downstream math from dividing by zero.
  function rosterSlotsPerTeam(draft) {
    const s = (draft && draft.settings) || {};
    if (typeof s.rounds === 'number' && s.rounds > 0) return s.rounds;
    let sum = 0;
    for (const [k, v] of Object.entries(s)) {
      if (k.startsWith('slots_') && typeof v === 'number' && v > 0) sum += v;
    }
    return sum || 15;
  }

  /**
   * Live auction inflation factor derived from what teams have left to
   * spend vs. the pace they'd be at if the league were spending evenly.
   *
   *   factor = (remainingBudget / remainingSlots) / (startingBudget / totalSlots)
   *
   * >1 means teams have been conservative -- remaining players will go
   * for more than static Sleeper value. <1 means teams have been
   * aggressive (money already spent on top guys) -- remaining players
   * will go cheap. Clamped to [0.5, 2.0] so early-draft noise (a couple
   * $60 picks in a $2400-league) doesn't push the multiplier to
   * absurdities.
   *
   * This is directionally correct without needing the full remaining
   * player pool. A finer-grained calc that weights remaining slots by
   * Sleeper projections would need per-position pool data we don't
   * currently keep in the popup context.
   */
  function computeLiveInflation({ teams, startingBudgetPerTeam, slotsPerTeam }) {
    if (!teams || !teams.length) return 1;
    if (!startingBudgetPerTeam || !slotsPerTeam) return 1;
    const totalStartingBudget = startingBudgetPerTeam * teams.length;
    const totalSlots = slotsPerTeam * teams.length;
    let totalRemainingBudget = 0;
    let totalDraftedSlots = 0;
    for (const t of teams) {
      totalRemainingBudget += Number(t.budgetRemaining) || 0;
      totalDraftedSlots += Number(t.rosterCount) || 0;
    }
    const remainingSlots = Math.max(1, totalSlots - totalDraftedSlots);
    const remainingPerSlot = totalRemainingBudget / remainingSlots;
    const expectedPerSlot = totalStartingBudget / totalSlots;
    if (expectedPerSlot <= 0) return 1;
    const factor = remainingPerSlot / expectedPerSlot;
    return Math.max(0.5, Math.min(2.0, factor));
  }

  // -------------------------------------------------------------------
  // RANK != TIER
  //
  // Rank asks "who is better?" -- ordinal, every player has a unique
  // slot (WR1, WR2, WR3, ...).
  //
  // Tier asks "where are the meaningful gaps?" -- categorical, multiple
  // players share a tier when their quality is close enough to be
  // reasonably interchangeable.
  //
  // Tiers here are built from CURRENT-YEAR projections directly by
  // finding statistically-significant gaps in the strength curve
  // (analysis.buildTiersFromScores). Historical dollar tiers stay for
  // auction-value adjustment, not for tier badges.
  //
  // Rank is a byproduct we use only to look up which score-derived
  // tier a player belongs to -- NOT as the mechanism for creating
  // tiers. See test/tiers.test.js Test 1: six near-identical players
  // must NOT become six tiers just because their ranks are 1-6.
  // -------------------------------------------------------------------

  // Position-tiering config lives in analysis.js. Small local shim so
  // liveDraft can reach it without a hard require -- both modules
  // attach to global.DraftPilot at load.
  function positionTieringConfig(position) {
    const a = (typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis))
      .DraftPilot && (typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis)).DraftPilot.analysis;
    if (!a || !a.POSITION_TIERING) return null;
    return a.POSITION_TIERING[position] || null;
  }
  function buildTiers(scores, cfg) {
    const a = (typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis))
      .DraftPilot && (typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis)).DraftPilot.analysis;
    if (!a || !a.buildTiersFromScores) return [];
    return a.buildTiersFromScores(scores, cfg);
  }

  /**
   * Choose the best available quality signal for tiering. Fantasy
   * point projections are the ideal input: they're smoothly
   * distributed and reflect true production potential rather than
   * market position. Auction $ is a fallback -- its long flat tail
   * (many $1 backups, elite-heavy top) tends to fragment tiers even
   * with a robust gap detector, and it conflates "market pricing" with
   * "player quality" (Derrick Henry is famously mispriced by markets
   * vs. his projected points, which is exactly the RB12-vs-tier-3
   * problem we're fixing here).
   */
  function qualityScoreOf(p) {
    if (!p) return null;
    if (typeof p.points === 'number' && p.points > 0) return p.points;
    if (typeof p.projectedFantasyPoints === 'number' && p.projectedFantasyPoints > 0) return p.projectedFantasyPoints;
    if (typeof p.projection === 'number' && p.projection > 0) return p.projection;
    return null;
  }

  /**
   * Build tiers from CURRENT-YEAR quality scores for `position`. Runs
   * the shared gap-based algorithm (analysis.buildTiersFromScores) on
   * the sorted-descending quality curve. Returns { tiers, players,
   * scoreSource } where `players` is the sorted list (so rank =
   * index+1) and `scoreSource` names the input field ('points' or
   * 'projection').
   *
   * This is the tier authority for badge rendering. It is independent
   * of the historical dollar tiers used by computeLeagueAdjustedValue.
   */
  function computeLiveTiers(poolPlayers, position) {
    if (!position || !Array.isArray(poolPlayers)) return null;
    const cfg = positionTieringConfig(position);
    if (!cfg) return null;
    const pos = position.toUpperCase();
    const candidates = poolPlayers
      .filter((p) => (p.position || '').toUpperCase() === pos)
      .map((p) => ({ p, s: qualityScoreOf(p) }))
      .filter((x) => x.s != null && x.s > 0);
    // Detect which field we ended up using so callers can display it
    // in the debug view. Prefer 'points' if ANY player carried it.
    const usedPoints = candidates.some((x) => typeof x.p.points === 'number' && x.p.points > 0)
      || candidates.some((x) => typeof x.p.projectedFantasyPoints === 'number' && x.p.projectedFantasyPoints > 0);
    const scoreSource = usedPoints ? 'points' : 'projection';
    const players = candidates
      .sort((a, b) => b.s - a.s)
      .map((x) => x.p);
    if (!players.length) return { tiers: [], players: [], scoreSource };
    const scores = candidates
      .sort((a, b) => b.s - a.s)
      .map((x) => x.s);
    const tiers = buildTiers(scores, cfg);
    return { tiers, players, scoreSource, scores };
  }

  /**
   * Diagnostic output: returns an ASCII table showing each player's
   * rank, projected score, gap-to-next, and which tier boundary (if
   * any) was placed after them. Invoke from devtools:
   *
   *   DraftPilot.liveDraft.describeTierComputation(pool, 'WR')
   *
   * Verifies that boundaries land at real quality cliffs rather than
   * arbitrary rank intervals.
   */
  function describeTierComputation(pool, position) {
    if (!pool || !Array.isArray(pool.players)) return `no pool`;
    const live = computeLiveTiers(pool.players, position);
    if (!live) return `no config for ${position}`;
    const { tiers, players, scoreSource, scores } = live;
    // Map rank -> tier index for the annotation column.
    const tierOfRank = new Array(players.length + 1);
    for (const t of tiers) {
      for (let r = t.startRank; r <= t.endRank; r++) tierOfRank[r] = t.tierIndex;
    }
    const breakRanks = new Set();
    for (let i = 0; i < tiers.length - 1; i++) breakRanks.add(tiers[i].endRank);
    const lines = [
      `${position}  (${tiers.length} tiers from ${players.length} players; score = ${scoreSource})`,
      `Tier Rank Player                    Score   Gap  Note`,
    ];
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const s = scores[i];
      const nextScore = scores[i + 1];
      const gap = nextScore != null ? s - nextScore : null;
      const gapStr = gap != null ? String(Math.round(gap * 10) / 10).padStart(5) : '     ';
      const note = breakRanks.has(i + 1) ? '  <- TIER BREAK' : '';
      const rank = String(i + 1).padStart(4);
      const tierStr = 'T' + String((tierOfRank[i + 1] ?? 0) + 1).padStart(2, ' ');
      const nameShort = (p.name || '').slice(0, 24).padEnd(24);
      const scoreStr = String(Math.round(s * 10) / 10).padStart(6);
      lines.push(`${tierStr}  ${rank} ${nameShort}${scoreStr}   ${gapStr}${note}`);
    }
    lines.push('');
    lines.push('Tier boundaries:');
    for (const t of tiers) {
      const gapPrev = t.gapToPrev != null ? `  prev gap ${Math.round(t.gapToPrev * 10) / 10}` : '';
      const gapNext = t.gapToNext != null ? `  next gap ${Math.round(t.gapToNext * 10) / 10}` : '';
      lines.push(
        `  T${t.tierIndex + 1}: ranks ${t.startRank}-${t.endRank}  ` +
        `n=${t.playerCount}  ` +
        `range ${Math.round(t.min * 10) / 10}-${Math.round(t.max * 10) / 10}  ` +
        `median ${Math.round(t.median * 10) / 10}` +
        gapPrev + gapNext
      );
    }
    return lines.join('\n');
  }

  /**
   * Find which tier the nominated player belongs to. Uses CURRENT-YEAR
   * projections from the pool as the quality-score input; tiers are
   * built by gap detection, not by rank division. Rank is used only
   * to look up which score-derived tier a player belongs to.
   *
   * Returns { tierIndex, totalTiers, rank, median, source } where
   * source is 'projection-gap' (preferred, from live pool) or
   * 'historical-median' (fallback when no pool loaded).
   */
  function findTier({ position, sleeperProjection, tierAggregates, playerPool, playerName }) {
    if (!position) return null;

    // Preferred: build tiers from current-year quality scores in the
    // pool. Tiers are quality-gap groups, NOT rank divisions. Rank is
    // used only to look up which tier the player falls into.
    if (playerPool && Array.isArray(playerPool.players) && playerPool.players.length) {
      const live = computeLiveTiers(playerPool.players, position);
      if (live && live.tiers.length && live.players.length) {
        let rank = null;
        if (playerName) {
          const target = playerName.trim().toLowerCase();
          const idx = live.players.findIndex((p) => (p.name || '').trim().toLowerCase() === target);
          if (idx >= 0) rank = idx + 1;
        }
        // Score-based fallback for the (rare) case where the player
        // isn't in the pool by exact name -- e.g. a mid-draft add.
        // Use the pool's own score (points if it has them, else
        // projection); do NOT mix auction $ with a points-sorted list.
        if (rank == null) {
          const scoreSource = live.scoreSource;
          const anchor = scoreSource === 'points'
            ? null // caller doesn't pass fantasy points; skip
            : (sleeperProjection != null && sleeperProjection > 0 ? sleeperProjection : null);
          if (anchor != null) {
            const idx = live.players.findIndex((p, i) => live.scores[i] <= anchor);
            rank = idx >= 0 ? idx + 1 : live.players.length + 1;
          }
        }
        if (rank != null) {
          for (let i = 0; i < live.tiers.length; i++) {
            const t = live.tiers[i];
            if (rank >= t.startRank && rank <= t.endRank) {
              return {
                tierIndex: i,
                totalTiers: live.tiers.length,
                rank,
                median: t.median,
                scoreSource: live.scoreSource,
                source: 'projection-gap',
              };
            }
          }
          // Beyond the last tier -- extreme depth. Attribute to bottom.
          const last = live.tiers[live.tiers.length - 1];
          return {
            tierIndex: live.tiers.length - 1,
            totalTiers: live.tiers.length,
            rank,
            median: last.median,
            scoreSource: live.scoreSource,
            source: 'projection-gap',
          };
        }
      }
    }

    // Fallback: no pool loaded. Use historical tiers with closest-median
    // lookup so the pill still renders (degraded accuracy). This path
    // is why we surface a "Load full player pool" prompt in Live Mode.
    const tiers = tierAggregates && tierAggregates[position];
    if (!tiers || !tiers.length) return null;
    if (sleeperProjection == null || sleeperProjection <= 0) return null;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < tiers.length; i++) {
      if (tiers[i] == null || tiers[i].median == null) continue;
      const d = Math.abs(tiers[i].median - sleeperProjection);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    return {
      tierIndex: bestIdx,
      totalTiers: tiers.length,
      median: tiers[bestIdx].median,
      source: 'historical-median',
    };
  }

  /**
   * Rank of a player within their position by descending projection.
   * Uses the player pool snapshot (all players with projections). Ties
   * are broken by dense ranking (equal-projection players share a rank).
   *
   * Matches by name first (canonical), then falls back to projection
   * bucketing when the exact name isn't in the pool (mid-draft player
   * additions, spelling drift). Returns null if we can't place them.
   */
  function positionalRank(poolPlayers, position, playerName, sleeperProjection) {
    const pos = position.toUpperCase();
    const same = poolPlayers.filter((p) => (p.position || '').toUpperCase() === pos && p.projection != null && p.projection > 0);
    if (!same.length) return null;
    same.sort((a, b) => (b.projection || 0) - (a.projection || 0));

    if (playerName) {
      const target = playerName.trim().toLowerCase();
      const idx = same.findIndex((p) => (p.name || '').trim().toLowerCase() === target);
      if (idx >= 0) return idx + 1;
    }
    // Fallback: find where this projection would sit in the sorted list.
    if (sleeperProjection == null) return null;
    for (let i = 0; i < same.length; i++) {
      if (same[i].projection <= sleeperProjection) return i + 1;
    }
    return same.length + 1;
  }

  /** Count completed picks grouped by position. */
  function countPicksByPosition(picks) {
    const counts = {};
    for (const p of picks || []) {
      const pos = p && p.metadata && p.metadata.position;
      if (!pos) continue;
      counts[pos] = (counts[pos] || 0) + 1;
    }
    return counts;
  }

  /**
   * Positional scarcity for the nominated player.
   *
   * The heavy lifting lives in analysis.computePositionalScarcity() so
   * the same engine backs bid recommendation, alternative-player score,
   * opportunity cost, and any future strategy feature. This adapter
   * assembles live-draft inputs (pool, picks, teams, format) into the
   * engine's shape and preserves a couple of legacy fields
   * (atOrAboveRemaining, isTierBreak, isLastInTier) that existing
   * downstream code (bid recommendation, tier-break UI alert) already
   * reads. New callers should prefer .score / .level / .reason.
   *
   * Inputs the engine actually needs:
   *   - position + optional anchorProjection (nominated player's proj.)
   *   - pool: { players: [{name, position, projection, isDrafted}] } --
   *     the loaded static pool; combined with picksByPosition to
   *     approximate "undrafted at this position."
   *   - picks: raw Sleeper picks (drives picksByPosition and drafted-set)
   *   - teams: DOM-scraped teams array (for teamsStillNeeding via
   *     bidderProfile). Optional -- falls back to format math.
   *   - format: { teamCount, rosterSlots, isSuperflex }. Optional.
   *   - league: for position caps when computing teamsStillNeeding.
   *
   * Also accepts the OLD signature { position, tierIndex, totalTiers,
   * picksByPosition } for the (now-legacy) tier-break alert. In that
   * mode we compute only the legacy fields and skip the engine.
   */
  function computeScarcity(opts) {
    const o = opts || {};
    if (!o.position) {
      return {
        atOrAboveRemaining: null, isLastInTier: false, isTierBreak: false,
        score: null, level: null, reason: null,
      };
    }
    const position = String(o.position).toUpperCase();

    // Legacy fields -- kept for the existing "elite RB left" alert copy
    // and for computeBidRecommendation's scarcityHigh gate.
    let atOrAboveRemaining = null;
    let isLastInTier = false;
    let isTierBreak = false;
    if (o.tierIndex != null && o.totalTiers) {
      const drafted = (o.picksByPosition && o.picksByPosition[position]) || 0;
      const consumedAtOrAbove = Math.min(drafted, o.tierIndex + 1);
      atOrAboveRemaining = Math.max(0, o.tierIndex + 1 - consumedAtOrAbove);
      isLastInTier = atOrAboveRemaining === 0;
      isTierBreak = o.tierIndex <= 2 && atOrAboveRemaining <= 1;
    }

    // Build the drafted-set from both the pool snapshot's flag AND the
    // picks API (pool may be stale; picks are always fresh). Same
    // pattern as suggestNominations().
    const drafted = new Set();
    if (o.pool && Array.isArray(o.pool.players)) {
      for (const p of o.pool.players) {
        if (p.isDrafted) drafted.add(poolKey(p.name, p.position));
      }
    }
    for (const pick of o.picks || []) {
      const md = pick && pick.metadata;
      if (!md) continue;
      const name = `${md.first_name || ''} ${md.last_name || ''}`.trim();
      if (name && md.position) drafted.add(poolKey(name, md.position));
    }

    // Available projections at this position (descending).
    let availableProjections = [];
    if (o.pool && Array.isArray(o.pool.players)) {
      availableProjections = o.pool.players
        .filter((p) =>
          (p.position || '').toUpperCase() === position
          && p.projection != null && p.projection > 0
          && !drafted.has(poolKey(p.name, p.position))
        )
        .map((p) => p.projection);
    }

    // Teams still needing this position. Preferred path: iterate the
    // scraped teams array and count who has a legitimate starter need
    // AND can afford at least a token bid. Matches computeBidRecommendation's
    // "seriousBidders" definition so scarcity and competition read
    // consistently in the UI.
    let teamsStillNeeding = null;
    if (Array.isArray(o.teams) && o.teams.length) {
      let n = 0;
      for (const t of o.teams) {
        const profile = bidderProfile(t, position, o.anchorProjection || 1, {
          league: o.league || null,
        });
        if (profile.need === 'starter' && profile.canAfford) n++;
      }
      teamsStillNeeding = n;
    }

    // Draft the format block for the analysis engine (fallback path
    // when teams weren't supplied, or as auxiliary context).
    let format = null;
    if (o.format) {
      format = o.format;
    } else if (o.session && o.session.league) {
      // Derive from session if the caller passed the whole session.
      // (Kept simple; the popup passes format directly.)
      format = null;
    }

    // Draft-count fallback for teamsStillNeeding when we don't have
    // teams.
    const draftedAtPosition = (o.picksByPosition && o.picksByPosition[position])
      || Array.from(drafted).filter((k) => k.endsWith(`|${position}`)).length
      || 0;

    // Fire the shared engine. Any missing pieces return null there and
    // we fall back to just the legacy fields (empty scarcity block).
    const analysis = (typeof window !== 'undefined' ? window
      : (typeof self !== 'undefined' ? self : globalThis))
      .DraftPilot && (typeof window !== 'undefined' ? window
      : (typeof self !== 'undefined' ? self : globalThis)).DraftPilot.analysis;

    let engineResult = null;
    if (analysis && typeof analysis.computePositionalScarcity === 'function') {
      engineResult = analysis.computePositionalScarcity({
        position,
        availableProjections,
        anchorProjection: o.anchorProjection,
        teamsStillNeeding,
        format,
        draftedAtPosition,
      });
    }

    if (!engineResult) {
      return {
        atOrAboveRemaining, isLastInTier, isTierBreak,
        score: null, level: null, reason: null,
        comparableRemaining: null, availableCount: null,
        teamsStillNeeding: teamsStillNeeding != null ? teamsStillNeeding : null,
        dropoffPct: null, signals: null,
      };
    }

    // Merge engine result with legacy fields. If the caller didn't
    // pass tier info, keep the legacy flags in a defensible state:
    // isTierBreak lifts to true when the engine's own reading is
    // CRITICAL, so downstream code (bid rec, alert) stays useful even
    // when the tier lookup was skipped.
    const critical = engineResult.level === 'CRITICAL';
    return Object.assign({}, engineResult, {
      atOrAboveRemaining: atOrAboveRemaining != null
        ? atOrAboveRemaining
        : engineResult.comparableRemaining,
      isLastInTier: isLastInTier || engineResult.comparableRemaining === 0,
      isTierBreak: isTierBreak || critical,
    });
  }

  /**
   * League-adjusted value for a single player during live draft.
   *
   * Uses the same shape of data (`tierAggregates`) that the pre-draft
   * export enrichment uses, but simplified for one-off lookup: pick the
   * tier whose historical median is closest to the player's current
   * Sleeper $ projection, then apply the live inflation factor.
   *
   * Returns null when we lack the inputs (no tiers for that position,
   * or no Sleeper projection to anchor on) -- caller falls back to
   * projection or hides the block.
   */
  function computeLeagueAdjustedValue({ position, sleeperProjection, tierAggregates, inflationFactor }) {
    const range = computeLeagueAdjustedValueRange({ position, sleeperProjection, tierAggregates, inflationFactor });
    return range ? range.center : null;
  }

  /**
   * Range-aware league-adjusted value.
   *
   * Returns `{ low, center, high, samples, sourceTier }` -- the fair-
   * value RANGE for this player, derived from the historical dollar-
   * tier distribution (not a manufactured ±$X band). Consumers that
   * want a single number keep calling `computeLeagueAdjustedValue`,
   * which is a thin wrapper on `.center` here (spec §18: no scalar
   * consumer breaks).
   *
   * How the range is built (spec §3, §5, §19):
   *   1. Find the closest-median tier for this player's Sleeper $
   *      projection -- same anchor as the legacy scalar path.
   *   2. Base range = [tier.min, tier.max] -- REAL distribution of
   *      per-rank medians across the ranks in the tier.
   *   3. Multiply endpoints + center by inflation.
   *   4. Widen for uncertainty:
   *        - Sleeper $ diverges from tier median by >25% -> +10%
   *          each side (the projection disagrees with history).
   *        - tier.samples < 3 -> +10% each side (sparse history).
   *   5. Clamp: low >= 1 ($1 player edge case); low <= center <= high;
   *      integer rounding.
   *
   * Returns null when we lack the inputs (same conditions as the
   * legacy scalar function).
   */
  function computeLeagueAdjustedValueRange({ position, sleeperProjection, tierAggregates, inflationFactor }) {
    if (!position || sleeperProjection == null || sleeperProjection <= 0) return null;
    const tiers = tierAggregates && tierAggregates[position];
    if (!tiers || !tiers.length) return null;

    // Closest-median tier lookup -- identical to the legacy scalar
    // path so center == old value for stable back-compat.
    let bestTier = null;
    let bestDist = Infinity;
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i];
      if (!t || t.median == null) continue;
      const d = Math.abs(t.median - sleeperProjection);
      if (d < bestDist) { bestDist = d; bestTier = t; }
    }
    if (!bestTier) return null;

    const factor = inflationFactor > 0 ? inflationFactor : 1;
    const medianAdj = bestTier.median * factor;

    // Raw range from the tier's actual price distribution. When a tier
    // was built from a single per-rank median (samples=1), min==max==
    // median and the range collapses -- the widening below rescues it.
    let low = (bestTier.min != null ? bestTier.min : bestTier.median) * factor;
    let high = (bestTier.max != null ? bestTier.max : bestTier.median) * factor;

    // Widen for uncertainty. Applied MULTIPLICATIVELY so $1 players
    // widen by cents and $60 players widen by dollars, both feel right.
    let widen = 0;
    // Projection disagrees with historical center.
    if (bestTier.median > 0) {
      const divergence = Math.abs(sleeperProjection - bestTier.median) / bestTier.median;
      if (divergence > 0.25) widen += 0.10;
    }
    // Sparse historical evidence.
    const samples = Number(bestTier.samples) || 0;
    if (samples < 3) widen += 0.10;

    // Also enforce a minimum half-width so a tight-tier player doesn't
    // read as $34-$34 when the real market has some noise. Baseline:
    // ±5% of center, min $1 half-width for anything above ~$4.
    const minHalfWidth = Math.max(1, Math.round(medianAdj * 0.05));

    // Apply widening to the range endpoints, then enforce minimum
    // half-width and the $1 floor.
    if (widen > 0) {
      low = low - medianAdj * widen;
      high = high + medianAdj * widen;
    }
    if (medianAdj - low < minHalfWidth) low = medianAdj - minHalfWidth;
    if (high - medianAdj < minHalfWidth) high = medianAdj + minHalfWidth;

    // Integer dollars + hard floors. low>=1 catches the $1-player case
    // (spec §19: no "-$2-$4"). low<=center<=high keeps the invariant
    // even after rounding.
    const centerR = Math.max(1, Math.round(medianAdj));
    let lowR = Math.max(1, Math.round(low));
    let highR = Math.max(lowR, Math.round(high));
    if (lowR > centerR) lowR = centerR;
    if (highR < centerR) highR = centerR;

    return {
      low: lowR,
      center: centerR,
      high: highR,
      samples,
      sourceTier: bestTier.tierIndex != null ? bestTier.tierIndex : null,
    };
  }

  // Slot-eligibility map. A player at position P is a legal draft into
  // any of these slot labels. BN accepts anything (bench is always
  // eligible), so it's handled separately in slotsAcceptingPosition().
  // Sleeper uses SUPER_FLEX (underscore) in its DOM labels.
  const SLOTS_BY_POSITION = {
    QB:  ['QB', 'SUPER_FLEX'],
    RB:  ['RB', 'FLEX', 'SUPER_FLEX'],
    WR:  ['WR', 'FLEX', 'SUPER_FLEX'],
    TE:  ['TE', 'FLEX', 'SUPER_FLEX'],
    K:   ['K'],
    DEF: ['DEF'],
    DST: ['DEF'],
  };

  /**
   * Returns the number of open slots on `team` that could legally hold
   * a player at `position`, including bench. Bench slots always count
   * because a manager can park anyone there.
   */
  function openSlotsForPosition(team, position) {
    if (!team || !position) return 0;
    const openSlots = team.openSlots || [];
    if (!openSlots.length) return 0;
    const eligible = SLOTS_BY_POSITION[position.toUpperCase()] || [];
    let count = 0;
    for (const s of openSlots) {
      if (s === 'BN' || eligible.includes(s)) count++;
    }
    return count;
  }

  /**
   * Sleeper leagues can cap how many of a position a team may roster
   * (regardless of open bench slots). The cap lives on
   * league.settings.position_limit_{qb,rb,wr,te,k,def}. Many leagues
   * omit these entirely -- returns null in that case, meaning "no cap
   * enforced" and callers should treat it as unlimited.
   */
  function positionCap(league, position) {
    if (!league || !league.settings || !position) return null;
    const key = 'position_limit_' + position.toString().toLowerCase();
    const v = league.settings[key];
    if (typeof v !== 'number' || v <= 0) return null;
    return v;
  }

  /**
   * How many of `position` a team already owns. Used by describeNeed +
   * bidderProfile to decide whether a positional cap would block this
   * pick even though bench slots exist.
   */
  function countRosterAtPosition(team, position) {
    if (!team || !team.roster || !position) return 0;
    const pos = position.toUpperCase();
    return team.roster.filter((r) => r.position === pos).length;
  }

  /**
   * A team is a "likely bidder" on the current nomination when:
   *   - they have at least one open eligible slot (positional need), AND
   *   - they haven't hit the league's per-position cap for that pos, AND
   *   - their max legal bid is within striking distance of the current
   *     league value (defined as >= 60% of it -- lower and the team
   *     can't realistically win the auction even if they wanted to).
   *
   * Pass `league` so we can enforce position caps when the league sets
   * them. Callers that don't have the league object can omit it and
   * we treat caps as absent (fail-open, same as pre-cap behavior).
   *
   * Returns { need: 'starter' | 'bench' | 'none', canAfford: bool }.
   * When the position cap is reached, need collapses to 'none' -- the
   * team simply cannot roster this player.
   */
  function bidderProfile(team, position, targetValue, opts) {
    if (!team || !position) return { need: 'none', canAfford: false };
    const league = (opts && opts.league) || null;

    // Cap check first -- if they're already at their limit, nothing
    // else matters. Bench slots don't rescue them from a hard cap.
    const cap = positionCap(league, position);
    if (cap != null && countRosterAtPosition(team, position) >= cap) {
      return { need: 'none', canAfford: false };
    }

    const eligible = SLOTS_BY_POSITION[position.toUpperCase()] || [];
    const openSlots = team.openSlots || [];
    let starterOpen = 0;
    let benchOpen = 0;
    for (const s of openSlots) {
      if (eligible.includes(s)) starterOpen++;
      else if (s === 'BN') benchOpen++;
    }
    const need = starterOpen > 0 ? 'starter' : benchOpen > 0 ? 'bench' : 'none';
    const canAfford = targetValue == null
      ? true
      : (Number(team.maxBid) || 0) >= Math.max(1, Math.floor(targetValue * 0.6));
    return { need, canAfford };
  }

  /**
   * Plain-speak description of whether a team needs a player at
   * `position` right now, informed by:
   *   - how many at this position they already own (drives the "no WR1
   *     yet" / "no WR2 yet" phrasing)
   *   - what starter slots at this position are still open
   *   - whether FLEX/SUPER_FLEX slots can absorb them
   *   - whether bench slots are available
   *
   * Returns { text, tone } where tone is 'need' | 'optional' | 'locked'
   * so the caller can pick a color without re-parsing the text.
   */
  function describeNeed(team, position, opts) {
    if (!team || !position) return { text: '—', tone: 'locked' };
    const pos = position.toUpperCase();
    const league = (opts && opts.league) || null;
    const openSlots = team.openSlots || [];
    const roster = team.roster || [];
    const currentAtPos = roster.filter((r) => r.position === pos).length;
    const openStarterAtPos = openSlots.filter((s) => s === pos).length;
    const flexOpen = openSlots.some((s) => s === 'FLEX' || s === 'SUPER_FLEX');
    const benchOpen = openSlots.some((s) => s === 'BN');

    // League position cap wins over any slot-availability logic. Even
    // with 5 open BN slots, if the league caps RBs at 5 and the team
    // already has 5, they can't take another one.
    const cap = positionCap(league, position);
    if (cap != null && currentAtPos >= cap) {
      return { text: `No — at ${pos} limit (${cap})`, tone: 'locked' };
    }

    if (openStarterAtPos > 0) {
      // "no WR1 yet" reads more naturally for the first slot than "no
      // starter yet"; the ordinal comes from what they already own.
      const nextOrdinal = currentAtPos + 1;
      return { text: `Yes, no ${pos}${nextOrdinal} yet`, tone: 'need' };
    }
    if (flexOpen) {
      const which = openSlots.includes('FLEX') ? 'flex' : 'super-flex';
      return { text: `Maybe — could take as ${which}`, tone: 'optional' };
    }
    if (benchOpen) {
      // Mention headroom to the cap when there is one -- helps users
      // eyeball whether a stash is realistic vs. the last legal spot.
      const capHint = cap != null ? ` (${cap - currentAtPos} more allowed)` : '';
      return { text: `Only as a bench stash${capHint}`, tone: 'optional' };
    }
    return { text: `No — ${pos} spots are filled`, tone: 'locked' };
  }

  /**
   * Compact per-team STARTER-slot needs summary. Bench (BN) slots are
   * excluded so callers can show them separately -- they're a different
   * kind of information ("real hole in the lineup" vs. "flex bench
   * capacity"). FLEX and SUPER_FLEX are first-class starter needs and
   * are always included; there's no top-N cap because at most ~8 slot
   * types exist without BN, all of which are relevant. Fixed sort
   * order (QB, RB, WR, TE, FLEX, SF, K, DEF) keeps the display stable
   * across polls instead of shuffling by count. Example output:
   * "2 RB, 2 WR, 1 TE, 1 FLEX, 1 SF".
   */
  const STARTER_SORT_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX'];
  const FLEX_SLOTS = new Set(['FLEX', 'SUPER_FLEX']);
  // Excluded from the "Starter needs" surface: BN is separate (its own
  // column). K and DEF are excluded because they're late-round
  // one-and-done picks -- listing "1 K, 1 DEF" on every team's row is
  // pure noise that crowds out the meaningful skill-position needs.
  const NEEDS_EXCLUDE = new Set(['BN', 'K', 'DEF']);
  function summarizeNeeds(team) {
    const counts = new Map();
    for (const s of team && team.openSlots || []) {
      if (NEEDS_EXCLUDE.has(s)) continue;
      counts.set(s, (counts.get(s) || 0) + 1);
    }
    if (!counts.size) return '';
    const rows = Array.from(counts.entries())
      .map(([slot, n]) => ({ slot, n }))
      .sort((a, b) => {
        const ai = STARTER_SORT_ORDER.indexOf(a.slot);
        const bi = STARTER_SORT_ORDER.indexOf(b.slot);
        // Unknown slot types (future league configs) sort to the end
        // in insertion order rather than crashing.
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });
    // Prefix FLEX/SUPER_FLEX entries with "+" so readers see they're
    // multi-position starter slots rather than direct positional needs.
    // "2 RB, 1 WR, +1 FLEX, +1 SF" reads more clearly than the flat list.
    return rows.map((r) => {
      const label = r.slot === 'SUPER_FLEX' ? 'SF' : r.slot;
      const prefix = FLEX_SLOTS.has(r.slot) ? '+' : '';
      return `${prefix}${r.n} ${label}`;
    }).join(', ');
  }

  /** Count of open BN slots on this team. */
  function benchOpenCount(team) {
    if (!team || !team.openSlots) return 0;
    let n = 0;
    for (const s of team.openSlots) if (s === 'BN') n++;
    return n;
  }

  // -------------------------------------------------------------------
  // Draft performance summary (your own team)
  //
  // Aggregates per-pick verdicts (bargain / fair / overpay), spend
  // efficiency, and tier composition into one running scorecard.
  // Verdict logic mirrors the completed-picks overlay: delta of
  // paid-vs-Sleeper-projection, ±15% bands.
  //
  // Returns null when we can't build a defensible summary (no pool
  // loaded, no roster, no team match).
  // -------------------------------------------------------------------
  function computeYourTeamSummary(team, pool, tierAggregates) {
    if (!team || !Array.isArray(team.roster) || !team.roster.length) return null;
    if (!pool || !Array.isArray(pool.players) || !pool.players.length) return null;

    let totalSpent = 0;
    let totalProjected = 0;
    let bargainCount = 0;
    let fairCount = 0;
    let overpayCount = 0;
    // Tier composition. Elite = T1 (index 0); starter-caliber = T2
    // (index 1); role = T3 (index 2); depth = T4+ (index >= 3).
    let t1 = 0, t2 = 0, t3 = 0, depth = 0, unknownTier = 0;

    for (const p of team.roster) {
      const amount = Number(p.amount) || 0;
      totalSpent += amount;
      if (!p.name || !p.position) { unknownTier++; continue; }

      const key = p.name.trim().toLowerCase();
      const poolPlayer = pool.players.find(
        (pp) => (pp.name || '').trim().toLowerCase() === key &&
                (pp.position || '').toUpperCase() === p.position.toUpperCase()
      );
      if (!poolPlayer || poolPlayer.projection == null || poolPlayer.projection <= 0) {
        unknownTier++;
        continue;
      }

      totalProjected += poolPlayer.projection;
      const pct = (amount - poolPlayer.projection) / poolPlayer.projection;
      if (pct <= -0.15) bargainCount++;
      else if (pct >= 0.15) overpayCount++;
      else fairCount++;

      const tier = findTier({
        position: p.position,
        sleeperProjection: poolPlayer.projection,
        tierAggregates,
        playerPool: pool,
        playerName: p.name,
      });
      if (!tier) { unknownTier++; continue; }
      if (tier.tierIndex === 0) t1++;
      else if (tier.tierIndex === 1) t2++;
      else if (tier.tierIndex === 2) t3++;
      else depth++;
    }

    const pickCount = team.roster.length;
    const netValue = Math.round(totalProjected - totalSpent);
    const netPerPick = pickCount > 0 ? netValue / pickCount : 0;

    // Insight line: short human sentence. Prefer signals with the
    // most decisive evidence (many overpays > small net loss).
    let insight;
    if (pickCount < 2) {
      insight = 'Too early to tell.';
    } else if (overpayCount >= bargainCount + 2) {
      insight = 'Too many overpays — slow down on nominations.';
    } else if (bargainCount >= overpayCount + 2) {
      insight = 'Finding value — keep hunting bargains.';
    } else if (netPerPick >= 3) {
      insight = 'Building well.';
    } else if (netPerPick <= -3) {
      insight = 'Paying above value — reset the room.';
    } else {
      insight = 'On pace with the market.';
    }

    return {
      pickCount,
      totalSpent,
      totalProjected: Math.round(totalProjected),
      netValue,
      bargainCount,
      fairCount,
      overpayCount,
      t1,
      t2,
      t3,
      depth,
      unknownTier,
      insight,
    };
  }

  // -------------------------------------------------------------------
  // Nomination suggester
  // -------------------------------------------------------------------

  /** Normalize player name + position into a stable lookup key. */
  function poolKey(name, position) {
    return `${(name || '').toLowerCase().trim()}|${(position || '').toUpperCase().trim()}`;
  }

  /**
   * Rank undrafted players by how much bidding pressure a nomination
   * would put on opponents WITHOUT costing the user themselves.
   *
   * Score components:
   *   burnPotential -- sum, over opponents with real starter need at
   *     this position + affordability, of their max legal bid (capped
   *     at 1.5x the player's Sleeper $ so a single deep-pocket team
   *     can't dominate the ranking).
   *   selfMultiplier -- 0.3 when the USER also has a starter need at
   *     the position (nominating a player you want yourself is bad
   *     tactics -- you may end up paying for them). 1.0 otherwise.
   *   tierBonus -- 1.5 for elite (T1-T3) players since they actually
   *     ignite bidding wars; lesser tiers get ignored (bonus = 1.0).
   *
   * Returns top-N candidates, each with the raw signals so the UI can
   * explain WHY they're being suggested.
   */
  function suggestNominations(opts) {
    const {
      pool,               // { players: [{name,position,team,projection,isDrafted}] }
      completedPicks,     // API picks (metadata carries name+position)
      teams,              // DOM teams array (openSlots, maxBid, roster)
      tierAggregates,     // for tier lookup
      yourManager,        // username to identify your team (legacy string match)
      yourIdentity,       // { userId, username, usersById } — preferred; matches
                          // every known name variant for the synced user
      league,             // for position caps
      limit = 5,
    } = opts || {};

    if (!pool || !pool.players || !pool.players.length) return [];
    if (!teams || !teams.length) return [];

    // Build the drafted-set from both the pool snapshot's own flag AND
    // the picks API (pool may be minutes stale by now; picks are fresh).
    const drafted = new Set();
    for (const p of pool.players) {
      if (p.isDrafted) drafted.add(poolKey(p.name, p.position));
    }
    for (const pick of completedPicks || []) {
      const md = pick && pick.metadata;
      if (!md) continue;
      const name = `${md.first_name || ''} ${md.last_name || ''}`.trim();
      if (name && md.position) drafted.add(poolKey(name, md.position));
    }

    // Structured identity match preferred (resilient to Sleeper's DOM
     // rendering username / team_name / display_name variably). Falls
     // back to the legacy string compare when no identity is supplied.
    let you = null;
    if (yourIdentity && (yourIdentity.userId || yourIdentity.username)) {
      you = resolveYourTeam(teams, yourIdentity);
    } else if (yourManager) {
      const target = yourManager.toLowerCase();
      you = teams.find((t) => t.manager && t.manager.toLowerCase() === target) || null;
    }

    const candidates = [];
    for (const p of pool.players) {
      if (!p.position || p.projection == null || p.projection <= 0) continue;
      if (drafted.has(poolKey(p.name, p.position))) continue;
      // K/DEF nominations are late-round filler, not tactical.
      if (p.position === 'K' || p.position === 'DEF') continue;

      let burnPotential = 0;
      let needyCount = 0;
      for (const t of teams) {
        if (you && t === you) continue;
        const profile = bidderProfile(t, p.position, p.projection, { league });
        if (profile.need === 'starter' && profile.canAfford) {
          needyCount++;
          burnPotential += Math.min(Number(t.maxBid) || 0, p.projection * 1.5);
        }
      }
      if (needyCount === 0) continue; // nobody will bid, pointless nomination

      const selfNeed = you
        ? bidderProfile(you, p.position, p.projection, { league }).need === 'starter'
        : false;
      const selfMultiplier = selfNeed ? 0.3 : 1.0;

      const tier = findTier({
        position: p.position,
        sleeperProjection: p.projection,
        tierAggregates,
        playerPool: pool,
        playerName: p.name,
      });
      const tierBonus = tier && tier.tierIndex <= 2 ? 1.5 : 1.0;

      const score = burnPotential * selfMultiplier * tierBonus;
      if (score <= 0) continue;

      candidates.push({
        name: p.name,
        position: p.position,
        team: p.team,
        projection: p.projection,
        tier,
        needyCount,
        burnPotential: Math.round(burnPotential),
        selfNeed,
        score,
      });
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, limit);
  }

  // -------------------------------------------------------------------
  // Next Nomination: strategic recommendation
  //
  // Where suggestNominations returns a ranked list of "who's a decent
  // burn candidate," this returns a small, strategy-labelled set:
  // one primary recommendation + up to two secondaries, each tagged
  // DRAIN / DISTRACT / TARGET, or a single WAIT recommendation when
  // the best-scoring candidate is one the manager should NOT put up.
  //
  // Reuses bidderProfile, computeLeagueAdjustedValueRange, and findTier
  // — no new valuation math. All copy is derived from live state.
  // -------------------------------------------------------------------

  // Extracts the signal set for every viable nomination candidate.
  // Independent of any strategy — used by both computeStrategyRecommen-
  // dations (per-strategy scoring) and suggestNextNomination (legacy
  // classifier). Returns [] when inputs aren't ready or nobody's
  // eligible.
  function _buildNextNomCandidates(opts) {
    const {
      pool, completedPicks, teams, tierAggregates,
      yourManager, yourIdentity, league, inflationFactor,
    } = opts || {};

    if (!pool || !pool.players || !pool.players.length) return { candidates: [], yourMaxBid: 0 };
    if (!teams || !teams.length) return { candidates: [], yourMaxBid: 0 };

    const drafted = new Set();
    for (const p of pool.players) {
      if (p.isDrafted) drafted.add(poolKey(p.name, p.position));
    }
    for (const pick of completedPicks || []) {
      const md = pick && pick.metadata;
      if (!md) continue;
      const name = `${md.first_name || ''} ${md.last_name || ''}`.trim();
      if (name && md.position) drafted.add(poolKey(name, md.position));
    }

    let you = null;
    if (yourIdentity && (yourIdentity.userId || yourIdentity.username)) {
      you = resolveYourTeam(teams, yourIdentity);
    } else if (yourManager) {
      const target = yourManager.toLowerCase();
      you = teams.find((t) => t.manager && t.manager.toLowerCase() === target) || null;
    }

    const opponentBudgets = [];
    for (const t of teams) {
      if (you && t === you) continue;
      const b = Number(t.maxBid) || 0;
      if (b > 0) opponentBudgets.push(b);
    }
    opponentBudgets.sort((a, b) => a - b);
    const medianOpponentBudget = opponentBudgets.length
      ? opponentBudgets[Math.floor(opponentBudgets.length / 2)]
      : 0;
    const yourMaxBid = you ? (Number(you.maxBid) || 0) : 0;

    const candidates = [];
    for (const p of pool.players) {
      if (!p.position || p.projection == null || p.projection <= 0) continue;
      if (drafted.has(poolKey(p.name, p.position))) continue;
      if (p.position === 'K' || p.position === 'DEF') continue;

      const bidders = [];
      let budgetHeavy = 0;
      let burnPotential = 0;
      for (const t of teams) {
        if (you && t === you) continue;
        const profile = bidderProfile(t, p.position, p.projection, { league });
        if (profile.need !== 'starter' || !profile.canAfford) continue;
        const tMax = Number(t.maxBid) || 0;
        const openSlots = t.openSlots || [];
        const eligible = SLOTS_BY_POSITION[p.position.toUpperCase()] || [];
        let starterOpenAtPos = 0;
        for (const s of openSlots) if (eligible.includes(s)) starterOpenAtPos++;
        const needMultiplier = 1 + Math.max(0, starterOpenAtPos - 1) * 0.35;
        const bidLikelihood = tMax * needMultiplier;
        bidders.push({
          team: t,
          manager: t.manager || '',
          maxBid: tMax,
          starterOpenAtPos,
          bidLikelihood,
        });
        burnPotential += Math.min(tMax, p.projection * 1.5);
        if (medianOpponentBudget > 0 && tMax >= medianOpponentBudget) budgetHeavy++;
      }
      // No filter on bidders.length here — TARGET can (and should) pick
      // a player nobody else needs. Per-strategy scorers gate on
      // bidders >= 2 for DRAIN/DISTRACT/AVOID.
      bidders.sort((a, b) => b.bidLikelihood - a.bidLikelihood);

      const selfProfile = you
        ? bidderProfile(you, p.position, p.projection, { league })
        : { need: 'none', canAfford: false };
      const selfNeed = selfProfile.need === 'starter';
      const selfCanAfford = selfProfile.canAfford;

      const tier = findTier({
        position: p.position,
        sleeperProjection: p.projection,
        tierAggregates,
        playerPool: pool,
        playerName: p.name,
      });
      const tierIndex = tier ? tier.tierIndex : null;
      const isElite = tierIndex != null && tierIndex <= 1;
      const isHighTier = tierIndex != null && tierIndex <= 2;

      const valueRange = computeLeagueAdjustedValueRange({
        position: p.position,
        sleeperProjection: p.projection,
        tierAggregates,
        inflationFactor: inflationFactor > 0 ? inflationFactor : 1,
      });
      const baselineRange = computeLeagueAdjustedValueRange({
        position: p.position,
        sleeperProjection: p.projection,
        tierAggregates,
        inflationFactor: 1,
      });
      let marketDeltaPct = null;
      if (valueRange && baselineRange && baselineRange.center > 0) {
        marketDeltaPct = Math.round(
          ((valueRange.center - baselineRange.center) / baselineRange.center) * 100
        );
      }

      candidates.push({
        name: p.name,
        position: p.position,
        team: p.team,
        projection: p.projection,
        tier,
        tierIndex,
        isElite,
        isHighTier,
        valueRange,
        baselineRange,
        marketDeltaPct,
        bidders,
        topBidders: bidders.slice(0, 3),
        biddersCount: bidders.length,
        budgetHeavyCount: budgetHeavy,
        burnPotential: Math.round(burnPotential),
        selfNeed,
        selfCanAfford,
        yourMaxBid,
      });
    }
    return { candidates, yourMaxBid };
  }

  // Per-strategy scoring. Every strategy has its OWN objective, its own
  // eligibility test, and its own multipliers — so different strategies
  // legitimately pick different players (not the same list re-sorted).
  //   DRAIN    — burn opponents' cap on someone you can pass on
  //   DISTRACT — attract bids that don't threaten your real targets
  //   TARGET   — buy a player who genuinely fits your roster
  //   AVOID    — flag a player you should NOT nominate now
  function _scoreForStrategy(c, strategy) {
    const centerVal = c.valueRange ? c.valueRange.center : (c.projection || 0);

    if (strategy === 'DRAIN') {
      if (c.biddersCount < 2) return 0;
      const tierBoost = c.isElite ? 1.7 : c.isHighTier ? 1.35 : 1.0;
      const budgetBoost = 1 + 0.5 * c.budgetHeavyCount;
      const selfPenalty = c.selfNeed ? 0.35 : 1.0;
      return c.burnPotential * tierBoost * budgetBoost * selfPenalty;
    }
    if (strategy === 'DISTRACT') {
      if (c.biddersCount < 2) return 0;
      // Distract deliberately favors mid-tier attention magnets over
      // elite players — elite talent belongs to DRAIN or TARGET; giving
      // one away as a "distraction" is over-serving your opponents.
      const attractiveness = c.isElite
        ? 0.5
        : c.tierIndex === 1 ? 1.5
        : c.tierIndex === 2 ? 1.35
        : c.tierIndex === 3 ? 1.05
        : c.tierIndex != null && c.tierIndex <= 5 ? 0.8
        : 0.6;
      const selfPenalty = c.selfNeed ? 0.2 : 1.0;
      return c.burnPotential * attractiveness * selfPenalty;
    }
    if (strategy === 'TARGET') {
      // Only players you'd actually want and can win.
      if (!c.selfNeed || !c.selfCanAfford) return 0;
      const scarcityBoost = c.isElite ? 1.5 : c.isHighTier ? 1.25 : 1.0;
      // Reward players you have budget headroom on; penalize the ones
      // you'd have to overpay for. (Center price vs. your remaining bid.)
      const headroom = c.yourMaxBid > 0
        ? Math.max(0.2, Math.min(1.5, c.yourMaxBid / Math.max(1, centerVal)))
        : 0.5;
      // Competition trim — if a lot of budget-heavy rivals also want
      // this player, TARGETing him is riskier, so score bends down.
      const competitionTrim = c.budgetHeavyCount >= 3
        ? 0.75
        : c.budgetHeavyCount >= 2 ? 0.9 : 1.0;
      return centerVal * scarcityBoost * headroom * competitionTrim;
    }
    if (strategy === 'AVOID') {
      // Only meaningful for players you actually WANT. Signal = a real
      // rival is likely to push the price and expose your intent.
      if (!c.selfNeed) return 0;
      if (c.budgetHeavyCount < 1) return 0;
      const tierBoost = c.isElite ? 1.6 : c.isHighTier ? 1.3 : 1.0;
      const topBidderBudget = c.topBidders && c.topBidders[0]
        ? (c.topBidders[0].maxBid || 0) : 0;
      return c.biddersCount * (topBidderBudget + 1) * tierBoost;
    }
    return 0;
  }

  // Weight per strategy for the DEFAULT recommendation choice — used
  // ONLY to pick which tab is preselected when the user hasn't chosen
  // one yet. Does not affect per-strategy rankings.
  const _STRATEGY_DEFAULT_WEIGHTS = {
    TARGET: 1.5,
    DRAIN: 1.3,
    DISTRACT: 1.0,
    AVOID: 0.85,
  };

  function _pickRecommendedStrategy(byStrategy) {
    let best = null;
    let bestScore = -Infinity;
    for (const s of ['TARGET', 'DRAIN', 'DISTRACT', 'AVOID']) {
      const p = byStrategy[s] && byStrategy[s].primary;
      if (!p) continue;
      const weighted = p.score * (_STRATEGY_DEFAULT_WEIGHTS[s] || 1.0);
      if (weighted > bestScore) { bestScore = weighted; best = s; }
    }
    return best;
  }

  // Public: strategy-based recommendation set. Each strategy holds its
  // own ranked list; the manager can flip between them and get truly
  // different top picks driven by different objectives. `recommended`
  // is Draft Pilot's default preselection — the client may honor it or
  // let the user override.
  function computeStrategyRecommendations(opts) {
    const { candidates } = _buildNextNomCandidates(opts);
    const byStrategy = {};
    for (const strategy of ['DRAIN', 'DISTRACT', 'TARGET', 'AVOID']) {
      const scored = [];
      for (const c of candidates) {
        const score = _scoreForStrategy(c, strategy);
        if (score <= 0) continue;
        scored.push({ ...c, strategy, score });
      }
      scored.sort((a, b) => b.score - a.score);
      byStrategy[strategy] = {
        primary: scored[0] || null,
        secondaries: scored.slice(1, 3),
      };
    }
    return { recommended: _pickRecommendedStrategy(byStrategy), byStrategy };
  }

  // Legacy adapter — retained so any pre-refactor callers still get
  // the {primary, secondaries} shape they expected. Returns whatever
  // Draft Pilot's default strategy would recommend.
  function suggestNextNomination(opts) {
    const rec = computeStrategyRecommendations(opts);
    if (!rec || !rec.recommended) return null;
    return rec.byStrategy[rec.recommended];
  }

  // -------------------------------------------------------------------
  // Available Players — live auction market
  //
  // Produces the row model for the Available Players list. Reuses
  // computeLeagueAdjustedValueRange (canonical fair-value engine),
  // bidderProfile (canonical roster fit), and findTier (canonical
  // tier authority). No parallel valuation math.
  //
  // Returns { rows, positions, totalAvailable, byPosition } where
  // rows already reflects search + position filter + sort + limit,
  // and positions is the sorted set of positions present in the
  // remaining pool (drives the position-chip filter dynamically).
  // -------------------------------------------------------------------

  function listAvailablePlayers(opts) {
    const {
      pool,
      completedPicks,
      teams,
      tierAggregates,
      yourManager,
      yourIdentity,
      league,
      inflationFactor,
      search,
      position,          // 'ALL' | 'QB' | 'RB' | ...
      sort,              // 'value' | 'marketUp' | 'marketDown' | 'position' | 'tier'
      limit = 80,
    } = opts || {};

    const empty = { rows: [], positions: [], totalAvailable: 0, byPosition: {}, matched: 0 };
    if (!pool || !pool.players || !pool.players.length) return empty;

    const drafted = new Set();
    for (const p of pool.players) {
      if (p.isDrafted) drafted.add(poolKey(p.name, p.position));
    }
    for (const pick of completedPicks || []) {
      const md = pick && pick.metadata;
      if (!md) continue;
      const name = `${md.first_name || ''} ${md.last_name || ''}`.trim();
      if (name && md.position) drafted.add(poolKey(name, md.position));
    }

    let you = null;
    if (teams && teams.length) {
      if (yourIdentity && (yourIdentity.userId || yourIdentity.username)) {
        you = resolveYourTeam(teams, yourIdentity);
      } else if (yourManager) {
        const target = yourManager.toLowerCase();
        you = teams.find((t) => t.manager && t.manager.toLowerCase() === target) || null;
      }
    }

    const infl = inflationFactor > 0 ? inflationFactor : 1;
    const positionsPresent = new Set();
    const byPosition = {};
    let totalAvailable = 0;

    // Build row model for every undrafted player, then filter/sort/
    // slice. Building all rows first keeps counts (totalAvailable,
    // byPosition) honest regardless of filter — needed by the summary.
    const all = [];
    for (const p of pool.players) {
      if (!p.position || !p.name) continue;
      if (drafted.has(poolKey(p.name, p.position))) continue;

      const pos = p.position.toUpperCase();
      positionsPresent.add(pos);
      byPosition[pos] = (byPosition[pos] || 0) + 1;
      totalAvailable++;

      const valueRange = (p.projection != null && p.projection > 0)
        ? computeLeagueAdjustedValueRange({
            position: p.position,
            sleeperProjection: p.projection,
            tierAggregates,
            inflationFactor: infl,
          })
        : null;
      const baselineRange = (p.projection != null && p.projection > 0)
        ? computeLeagueAdjustedValueRange({
            position: p.position,
            sleeperProjection: p.projection,
            tierAggregates,
            inflationFactor: 1,
          })
        : null;
      let marketDeltaPct = null;
      if (valueRange && baselineRange && baselineRange.center > 0) {
        marketDeltaPct = Math.round(
          ((valueRange.center - baselineRange.center) / baselineRange.center) * 100
        );
      }

      const tier = findTier({
        position: p.position,
        sleeperProjection: p.projection,
        tierAggregates,
        playerPool: pool,
        playerName: p.name,
      });

      let fit = 'none';
      if (you) {
        const prof = bidderProfile(you, p.position, p.projection, { league });
        if (prof.need === 'starter' && prof.canAfford) fit = 'starter';
        else if (prof.need === 'bench') fit = 'bench';
      }

      all.push({
        name: p.name,
        position: pos,
        team: p.team || '',
        projection: p.projection || 0,
        tier,
        valueRange,
        baselineRange,
        marketDeltaPct,
        fit,
      });
    }

    // Filter.
    const q = (search || '').trim().toLowerCase();
    const posFilter = position && position !== 'ALL' ? position.toUpperCase() : null;
    let filtered = all;
    if (posFilter) filtered = filtered.filter((r) => r.position === posFilter);
    if (q) {
      filtered = filtered.filter((r) => {
        return (
          r.name.toLowerCase().includes(q) ||
          (r.team && r.team.toLowerCase().includes(q)) ||
          (r.position && r.position.toLowerCase() === q)
        );
      });
    }

    // Sort.
    const centerOf = (r) => (r.valueRange ? r.valueRange.center : -1);
    const sortKey = sort || 'value';
    switch (sortKey) {
      case 'marketUp':
        filtered.sort((a, b) => (b.marketDeltaPct ?? -Infinity) - (a.marketDeltaPct ?? -Infinity));
        break;
      case 'marketDown':
        filtered.sort((a, b) => (a.marketDeltaPct ?? Infinity) - (b.marketDeltaPct ?? Infinity));
        break;
      case 'position':
        filtered.sort((a, b) => {
          if (a.position !== b.position) return a.position.localeCompare(b.position);
          return centerOf(b) - centerOf(a);
        });
        break;
      case 'tier':
        filtered.sort((a, b) => {
          const at = a.tier ? a.tier.tierIndex : 99;
          const bt = b.tier ? b.tier.tierIndex : 99;
          if (at !== bt) return at - bt;
          return centerOf(b) - centerOf(a);
        });
        break;
      case 'value':
      default:
        filtered.sort((a, b) => centerOf(b) - centerOf(a));
        break;
    }

    const matched = filtered.length;
    const rows = filtered.slice(0, Math.max(1, limit));

    // Preferred position display order: keep familiar fantasy order
    // when present, then whatever else the league had.
    const preferredOrder = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DST'];
    const positions = preferredOrder.filter((p) => positionsPresent.has(p))
      .concat([...positionsPresent].filter((p) => !preferredOrder.includes(p)).sort());

    return { rows, positions, totalAvailable, byPosition, matched };
  }

  // -------------------------------------------------------------------
  // Team identity resolution
  //
  // The draft-room DOM shows ONE string per team column (username,
  // custom team name, or display name — Sleeper decides which, and
  // the choice can vary between browsers / states). Matching that
  // against a single stored username is fragile: whichever browser
  // happens to render the same variant we synced with matches, the
  // other silently doesn't.
  //
  // The Sleeper league_users API gives us every variant Sleeper could
  // possibly render for a given user_id. Comparing the scraped
  // header string against the FULL set for the user we know is the
  // synced identity produces a deterministic match — decoupled from
  // whatever Sleeper's UI currently decided to show.
  // -------------------------------------------------------------------
  function _norm(s) {
    if (s == null) return '';
    return String(s).trim().toLowerCase();
  }

  /**
   * Case- and whitespace-insensitive equality between a scraped
   * manager string and any of the known name variants for the user.
   * Public so the "your bid" check on `nom.topBidder` (a different
   * DOM slot but the same rendering surface) can share the logic.
   */
  function isYouByName(candidate, { usersById, userId, username }) {
    const c = _norm(candidate);
    if (!c) return false;
    const identity = usersById && userId ? usersById[userId] : null;
    if (identity) {
      if (_norm(identity.teamName) === c) return true;
      if (_norm(identity.displayName) === c) return true;
      if (_norm(identity.username) === c) return true;
    }
    // Pre-league-sync fallback (mock drafts, unauthenticated) — the
    // typed-in username is all we have. Better than nothing; matches
    // when the DOM happens to show the plain username.
    if (username && _norm(username) === c) return true;
    return false;
  }

  /**
   * Locate the synced user's team column in a DOM-scraped teams
   * array. Prefers structured identity (usersById + userId), falls
   * back to the raw username for pre-league-sync callers.
   *
   * Returns the team object, or null when nothing matches. Callers
   * that need "you or null" for downstream logic (roster fit, max
   * bid clamp) should use this rather than an inline .find().
   */
  function resolveYourTeam(teams, opts) {
    if (!teams || !teams.length) return null;
    const o = opts || {};
    if (!o.userId && !o.username) return null;
    for (const t of teams) {
      if (isYouByName(t && t.manager, o)) return t;
    }
    return null;
  }

  // -------------------------------------------------------------------
  // bidEngine result -> legacy-shape adapter
  //
  // Preserves every field the popup UI already reads (action, headline,
  // target/comfort/max, fitTone/fitText, competitionSummary,
  // biggestThreat, breakdown, reasons, scarcityLift, fitLift, cliff,
  // scarcityImpact, replacementDepth, passingRisk) so no UI change is
  // needed to ship the new engine behind its flag. Also exposes the
  // richer new fields (fairValue / recommendedMax / recommendation /
  // remainingValue / rosterNeed / opportunityCost / budgetPressure /
  // engine) alongside for the Stage 2 UI redesign.
  // -------------------------------------------------------------------
  function mapEngineResultToLegacyShape(y, ctx) {
    const nom = (ctx && ctx.nom) || {};
    const position = nom.position || '';
    const max = y.recommendedMax;
    const fairValue = y.fairValue;

    // Legacy action string.
    const action = y.recommendation === 'BUY'
      ? 'bid'
      : y.recommendation === 'CAUTION' ? 'conditional' : 'pass';
    let headline;
    if (y.recommendation === 'PASS') headline = 'PASS';
    else if (y.recommendation === 'CAUTION') headline = `BID IF ≤ $${max}`;
    else headline = `BID TO $${max}`;

    // Legacy fitTone -- coarser than the new rosterNeed but consumed by
    // popup styling ('is-pass' / 'is-conditional') and by the "Why?"
    // panel's fitText line.
    const need = (y.rosterNeed && y.rosterNeed.tone) || 'none';
    let fitTone = 'depth';
    if (need === 'high') fitTone = 'strong';
    else if (need === 'moderate') fitTone = 'depth';
    else if (need === 'low') fitTone = 'depth';
    else fitTone = 'low';
    const fitText = y.primaryReason;

    // Legacy comfort -- kept for callers that still show it. Set below
    // max by the ladder cushion so it reads as "safe zone".
    const cushion = Math.max(1, Math.round(max * 0.10));
    const comfort = Math.max(1, max - cushion);

    // Competition summary line.
    const seriousBidders = (y.competition && y.competition.seriousBidders) || 0;
    let competitionSummary;
    if (need === 'none') competitionSummary = 'Not your fight.';
    else if (seriousBidders === 0) competitionSummary = 'No one else realistically bidding.';
    else if (seriousBidders === 1) competitionSummary = 'Only 1 team can seriously compete.';
    else competitionSummary = `${seriousBidders} teams could push the price up.`;

    const biggestThreat = (y.competition && y.competition.biggestThreat)
      && seriousBidders >= 2
      && (y.competition.biggestThreat.maxBid || 0) >= max
      ? y.competition.biggestThreat : null;

    return {
      // ---- Legacy fields (untouched consumers keep working) ---------
      action,
      headline,
      target: fairValue,
      comfort,
      max,
      fitTone,
      fitText,
      reasons: (y.reasons || []).slice(0, 4),
      competitors: (y.competition && y.competition.list) || [],
      biggestThreat,
      competitionSummary,
      seriousBidders,
      breakdown: y.breakdown || [],
      scarcityLift: (y.scarcity && y.scarcity.dollars) || 0,
      fitLift: Math.round(fairValue * (need === 'high' ? 0.18 : need === 'moderate' ? 0.06 : need === 'low' ? -0.05 : -0.30)),
      cliff: (ctx && ctx.cliff) || null,
      scarcityImpact: null,
      replacementDepth: y.replacementDepth || null,
      passingRisk: null,

      // ---- New fields for the Stage 2 UI --------------------------
      engine: 'bidEngine',
      fairValue,
      // Fair Value RANGE. When present, callers should prefer this
      // over the scalar `fairValue` for display -- rendering a range
      // avoids false-precision (spec §2, §20).
      fairValueRange: y.fairValueRange || null,
      recommendedMax: max,
      currentBid: y.currentBid,
      remainingValue: y.remainingValue,
      recommendation: y.recommendation,
      confidence: y.confidence,
      rosterNeed: y.rosterNeed,
      opportunityCost: y.opportunityCost,
      budgetPressure: y.budgetPressure,
      primaryReason: y.primaryReason,
    };
  }

  // -------------------------------------------------------------------
  // Bid recommendation
  //
  // Turns the raw signals already computed for the card (league value,
  // inflation, scarcity, roster fit, opponent budgets) into a single
  // decision surface: BID TO $X / PASS / BID IF ≤ $X.
  //
  // Complex analysis underneath, one number on top. Ranges (target /
  // comfort / max) are exposed as secondary context so the user can
  // sanity-check the max, but the max is the actionable number.
  //
  // Returns null when we can't produce a defensible recommendation
  // (missing league value or unidentified user) — caller falls back.
  // -------------------------------------------------------------------
  function computeBidRecommendation(opts) {
    const {
      nom,               // { position, playerName, topBid }
      leagueValue,       // int, league-adjusted value in dollars
      inflation,         // 1.0 = neutral
      teams,             // DOM teams array
      you,               // resolved user team (may be null)
      tier,              // findTier() result (may be null)
      scarcity,          // computeScarcity() result (may be null)
      league,            // league object for position caps
    } = opts || {};

    if (!nom || !nom.position || leagueValue == null) return null;

    // Roster-aware Max Bid engine (feature-flagged rollout).
    //
    // When enabled and the engine has enough data, it produces a
    // manager-specific Your Max that respects roster slots, opportunity
    // cost, scarcity, and budget legality -- returning the same
    // top-level shape callers already consume, plus the new fields
    // (fairValue / recommendedMax / recommendation / remainingValue /
    // rosterNeed / opportunityCost / budgetPressure). Falls back to the
    // legacy stack below when the engine can't run.
    if (rosterAwareMaxBidEnabled()) {
      const be = getBidEngine();
      if (be && typeof be.computeYourMax === 'function') {
        const draftObj = opts.draft
          || (opts.session && opts.session.draft)
          || (league && { settings: league.settings })
          || null;
        const currentBid = Math.max(0, Math.floor(Number(nom.topBid) || 0));
        const yourMax = be.computeYourMax({
          nom,
          fairValue: leagueValue,
          fairValueRange: opts.fairValueRange || null,
          currentBid,
          inflation,
          you: opts.you,
          teams: opts.teams,
          league,
          draft: draftObj,
          format: opts.format,
          pool: opts.pool,
          scarcity,
          cliff: opts.cliff,
          alternatives: opts.alternatives,
        });
        if (yourMax) {
          return mapEngineResultToLegacyShape(yourMax, { nom, tier, scarcity, cliff: opts.cliff, alternatives: opts.alternatives });
        }
      }
    }

    const position = nom.position;

    // Roster fit — the user's own relationship to this player.
    // Drives whether the recommendation is a BID, a PASS, or capped
    // at value (depth) vs. lifted above (real starter need).
    let fitTone = 'depth';         // 'strong' | 'depth' | 'low'
    let fitText = 'Optional depth at this position';
    let profile = null;
    if (you) {
      profile = bidderProfile(you, position, leagueValue, { league });
      const desc = describeNeed(you, position, { league });
      if (profile.need === 'none') {
        fitTone = 'low';
        fitText = desc.text;
      } else if (profile.need === 'starter') {
        // Distinguish "no starter yet at this exact position" (strong)
        // from "flex slot open" (depth). describeNeed's own tone tracks
        // this: 'need' == direct positional need, 'optional' == flex.
        if (desc.tone === 'need') {
          fitTone = 'strong';
          fitText = desc.text;
        } else {
          fitTone = 'depth';
          fitText = desc.text;
        }
      } else {
        // bench-only need
        fitTone = 'depth';
        fitText = desc.text;
      }
    }

    // Slot-driven optimizer path (parallel wiring behind a flag). When
    // enabled, we compute the marginal starting-lineup value of the nom
    // for the USER's team using the generic engine, and let that drive
    // fitTone. This handles arbitrary league formats (0-flex, 3-RB,
    // multi-flex, heterogeneous flex eligibility, SF, 2QB+SF, etc.)
    // without any position-count heuristics. Old path stays intact when
    // the flag is off OR when data needed to compute the delta isn't
    // available (missing league settings, empty pool, etc.).
    if (you && slotOptimizerEnabled()) {
      const mv = computeUserMarginalValue({ you, nom, league, pool: opts.pool });
      if (mv && typeof mv.delta === 'number' && mv.candidateProjection > 0) {
        // Normalize the delta to a 0..1 "starter improvement ratio":
        // full projection => 1.0 (fills empty slot); zero => 0.
        const ratio = mv.delta / mv.candidateProjection;
        if (ratio >= 0.75) {
          fitTone = 'strong';
          fitText = 'Major upgrade to your optimal starting lineup';
        } else if (ratio >= 0.20) {
          // Meaningful lineup improvement (displaces a weaker starter or
          // partially fills a flex) but not a straight empty-slot fill.
          fitTone = 'depth';
          fitText = 'Improves your optimal lineup as depth / upgrade';
        } else {
          // Marginal value is essentially zero -> bench-only or worse
          // than existing starters at every eligible slot.
          fitTone = 'low';
          fitText = 'No lineup upgrade — bench depth only';
        }
      }
    }

    // Competition — who else on the board could realistically bid.
    const competitors = [];
    for (const t of teams || []) {
      if (you && t === you) continue;
      const p = bidderProfile(t, position, leagueValue, { league });
      if (p.need === 'starter' && p.canAfford) {
        competitors.push({
          manager: t.manager || 'Unknown',
          budgetRemaining: Number(t.budgetRemaining) || 0,
          maxBid: Number(t.maxBid) || 0,
          needText: describeNeed(t, position, { league }).text,
        });
      }
    }
    competitors.sort((a, b) => b.maxBid - a.maxBid);
    const seriousBidders = competitors.length;
    const biggestThreat = competitors[0] || null;

    // Scarcity signal — factors into how far above value we're
    // willing to reach for a strong-fit player.
    // Prefer the shared scarcity engine's classification; fall back to
    // the legacy tier-break flag for pre-engine callers.
    const level = scarcity && scarcity.level;
    const scarcityHigh = level === 'CRITICAL'
      || level === 'HIGH'
      || !!(scarcity && scarcity.isTierBreak);
    const scarcityMedium = !scarcityHigh && (
      level === 'MEDIUM'
      || !!(tier && tier.tierIndex != null && tier.tierIndex <= 3)
    );
    // Pull the pre-computed scarcity impact + cliff off the opts if
    // the caller assembled them (buildNominationInsights does this).
    // Falls back to null; the recommendation still works from the raw
    // scarcity flags above without them.
    const impact = opts.impact || null;
    const cliff = opts.cliff || null;
    const alternatives = opts.alternatives || null;

    // Replacement depth from the Alternative Score engine feeds the
    // "how safely can I pass?" side of the recommendation. Strong
    // depth trims lift (comparable players remain); weak depth doesn't
    // amplify beyond what scarcity already pushes -- we let scarcity
    // and cliff drive the upside so we don't double-count.
    const replacementDepth = alternatives && alternatives.replacementContext
      ? alternatives.replacementContext.replacementDepth : null;
    const passingRisk = alternatives && alternatives.recommendationContext
      ? alternatives.recommendationContext.passingRisk : null;

    // Bid limits, layered:
    //   target  — the league-adjusted value (what the player is worth)
    //   comfort — value + a small opportunity premium
    //   max     — the ceiling justified by need + scarcity + competition
    //
    // The max is what BID TO $X displays. Ranges collapse when there's
    // no room to reach (low fit → comfort==max==target).
    const target = leagueValue;
    // Baseline lift from roster fit + competition (unchanged).
    let baseLift = 0;
    if (fitTone === 'strong') {
      baseLift = 0.06;
      if (seriousBidders >= 3) baseLift += 0.04;
      else if (seriousBidders <= 1) baseLift -= 0.04;
    } else if (fitTone === 'depth') {
      baseLift = -0.05;
    } else {
      baseLift = -0.30;
    }
    // Scarcity contribution -- explicit, bounded, and explainable
    // (spec item 8). Prefer the scarcity-impact layer's dollarLift
    // (already personalized to the manager and clamped) so we don't
    // re-derive the premium here. Falls back to the older scarcityHigh/
    // scarcityMedium heuristic when no impact object was assembled.
    let scarcityLiftPct = 0;
    if (impact && typeof impact.dollarLift === 'number') {
      scarcityLiftPct = impact.dollarLift;
    } else if (fitTone === 'strong') {
      scarcityLiftPct = scarcityHigh ? 0.12 : scarcityMedium ? 0.05 : 0;
    } else if (fitTone === 'depth') {
      scarcityLiftPct = scarcityHigh ? 0.07 : 0;
    }
    // Replacement-depth trim: when the Alternative Score engine is
    // confident the manager has strong fallback options, reduce the
    // premium a touch. Bounded so it never turns a bid into a pass on
    // its own -- it only tempers overreach.
    if (fitTone !== 'low' && replacementDepth === 'strong') {
      scarcityLiftPct = Math.max(-0.05, scarcityLiftPct - 0.03);
    }
    let liftPct = baseLift + scarcityLiftPct;
    // Clamp lift so stacked signals can't push arbitrarily high.
    liftPct = Math.max(-0.30, Math.min(0.25, liftPct));

    let max = Math.max(1, Math.round(target * (1 + liftPct)));
    let comfort = Math.max(1, Math.round(target * (1 + Math.max(0, liftPct - 0.05))));
    if (comfort > max) comfort = max;

    // Apply the user's actual max legal bid as a hard ceiling — no
    // point recommending $54 if they can only spend $28.
    if (you && Number.isFinite(you.maxBid) && you.maxBid > 0) {
      const userMax = Math.floor(you.maxBid);
      if (max > userMax) max = userMax;
      if (comfort > max) comfort = max;
    }

    // Decision. PASS when the recommended max lands below a defensible
    // floor for participating (fit=low, or user can't afford value).
    let action = 'bid'; // 'bid' | 'pass' | 'conditional'
    let headline = `BID TO $${max}`;
    if (fitTone === 'low') {
      action = 'pass';
      headline = 'PASS';
    } else if (max < Math.max(1, Math.floor(target * 0.7))) {
      // User's budget can't get within striking distance of value.
      action = 'conditional';
      headline = `BID IF ≤ $${max}`;
    } else if (fitTone === 'depth' && max < target) {
      action = 'conditional';
      headline = `BID IF ≤ $${max}`;
    }

    // The 2–4 reasons that actually shaped the recommendation. Order
    // by usefulness, not by weight — roster fit first because that's
    // the "why should I care" anchor.
    const reasons = [];
    if (fitTone === 'strong') reasons.push('Strong roster fit');
    else if (fitTone === 'depth') reasons.push('Depth only');
    else reasons.push('Roster is full here');

    if (scarcityHigh) {
      reasons.push(`High ${position} scarcity`);
    } else if (scarcityMedium) {
      reasons.push(`Limited ${position} depth left`);
    }

    if (seriousBidders >= 3) {
      reasons.push(`${seriousBidders} serious bidders`);
    } else if (seriousBidders === 1 && fitTone !== 'low') {
      reasons.push('Only 1 real competitor');
    } else if (seriousBidders === 0 && fitTone !== 'low') {
      reasons.push('No serious competition');
    }

    if (fitTone !== 'low' && replacementDepth === 'strong' && reasons.length < 4) {
      reasons.push('Strong alternatives remain');
    } else if (fitTone !== 'low' && replacementDepth === 'weak' && reasons.length < 4) {
      reasons.push('Few comparable alternatives left');
    }

    const inflationPct = Math.round(((inflation || 1) - 1) * 100);
    if (Math.abs(inflationPct) >= 8 && reasons.length < 4) {
      reasons.push(inflationPct > 0 ? 'Cash-heavy market' : 'Cash-light market');
    }

    // Competition summary line — interprets, not lists.
    let competitionSummary;
    if (fitTone === 'low') {
      competitionSummary = 'Not your fight.';
    } else if (seriousBidders === 0) {
      competitionSummary = 'No one else realistically bidding.';
    } else if (seriousBidders === 1) {
      competitionSummary = 'Only 1 team can seriously compete.';
    } else if (seriousBidders === 2) {
      competitionSummary = '2 teams could push the price up.';
    } else {
      competitionSummary = `${seriousBidders} teams could push the price up.`;
    }

    // Dollar-terms breakdown of the recommendation stack. Exposed so
    // callers (UI, tests) can display "Base value $34 + Scarcity $3 +
    // Fit $1 = $38 max" style explanations (spec item 8).
    const scarcityLiftDollars = Math.round(target * scarcityLiftPct);
    const fitLiftDollars = Math.round(target * (baseLift));
    const competitionLiftDollars = 0; // baked into baseLift already

    // Deep breakdown — populated for the expandable "Why $X?" panel.
    const breakdown = [];
    breakdown.push(['Base value', `$${leagueValue}`]);
    if (inflationPct !== 0) {
      breakdown.push(['Current inflation', `${inflationPct > 0 ? '+' : ''}${inflationPct}%`]);
    }
    if (tier && tier.tierIndex != null) {
      breakdown.push([`${position} tier`, `T${tier.tierIndex + 1} of ${tier.totalTiers}`]);
    }
    if (scarcity && scarcity.comparableRemaining != null) {
      breakdown.push([`Comparable ${position}s left`, String(scarcity.comparableRemaining)]);
    } else if (scarcity && scarcity.atOrAboveRemaining != null) {
      breakdown.push([`Comparable ${position}s left`, String(scarcity.atOrAboveRemaining)]);
    }
    if (cliff && cliff.hasCliff && cliff.dropoffPct != null) {
      breakdown.push(['Next-tier drop-off', `~${Math.round(cliff.dropoffPct * 100)}%`]);
    }
    breakdown.push(['Roster fit', fitText]);
    if (fitLiftDollars) {
      breakdown.push(['Fit adjustment', `${fitLiftDollars >= 0 ? '+' : ''}$${fitLiftDollars}`]);
    }
    if (scarcityLiftDollars) {
      breakdown.push(['Scarcity adjustment', `${scarcityLiftDollars >= 0 ? '+' : ''}$${scarcityLiftDollars}`]);
    }
    breakdown.push(['Serious competitors', String(seriousBidders)]);
    if (you && Number.isFinite(you.maxBid)) {
      breakdown.push(['Your max legal bid', `$${Math.floor(you.maxBid)}`]);
    }
    breakdown.push(['Recommended max', `$${max}`]);

    return {
      action,
      headline,
      target,
      comfort,
      max,
      fitTone,
      fitText,
      reasons: reasons.slice(0, 4),
      competitors: competitors.slice(0, 3),
      biggestThreat: biggestThreat && seriousBidders >= 2 && biggestThreat.maxBid >= max
        ? biggestThreat
        : null,
      competitionSummary,
      seriousBidders,
      breakdown,
      // Dollar-terms contribution of each lift, for UI tooltips + tests.
      scarcityLift: scarcityLiftDollars,
      fitLift: fitLiftDollars,
      // Pass through the layered inputs so callers don't re-compute.
      cliff: cliff || null,
      scarcityImpact: impact || null,
      replacementDepth,
      passingRisk,
    };
  }

  /**
   * Orchestrator: builds every scarcity-related view-model piece the
   * On-the-Block card needs from a single set of inputs, in one pass.
   * This is the memoization boundary (spec item 22) -- callers should
   * cache the result keyed by (nominee playerName, position, pickCount)
   * so repolls don't re-derive everything for identical inputs.
   *
   * Returns:
   *   {
   *     scarcity,            // the canonical scarcity result (or null)
   *     cliff,               // value-cliff result (or null)
   *     marketPressure,      // plain-language wrapper (or null)
   *     passConsequence,     // consequence copy (or null)
   *     scarcityImpact,      // personalized impact (or null)
   *     primaryInsight,      // Insight Priority pick (or null)
   *     rec,                 // computeBidRecommendation result (or null)
   *   }
   *
   * Any field is null when its inputs weren't available -- callers
   * hide the corresponding UI row rather than emit half-answers.
   */
  function buildNominationInsights(opts) {
    const analysis = (typeof window !== 'undefined' ? window
      : (typeof self !== 'undefined' ? self : globalThis))
      .DraftPilot && (typeof window !== 'undefined' ? window
      : (typeof self !== 'undefined' ? self : globalThis)).DraftPilot.analysis;

    const o = opts || {};
    const nom = o.nom || {};
    const teams = o.teams || [];
    const you = o.you || null;
    const scarcity = o.scarcity || null;
    const league = o.league || null;

    // Value cliff -- same anchor + pool as scarcity, no re-derivation
    // of comparability threshold (both read SCARCITY_COMPARABLE_FRACTION).
    let cliff = null;
    if (analysis && o.pool && nom.position) {
      const availableProjections = filterAvailableAtPosition(o.pool, o.picks, nom.position);
      cliff = analysis.computeValueCliff({
        anchorProjection: nom.sleeperProjection,
        availableProjections,
      });
    }

    // Personalized impact: roster need + budget pressure. Depends on
    // scarcity being available; otherwise skipped.
    let scarcityImpact = null;
    let marketPressure = null;
    let passConsequence = null;
    let primaryInsight = null;
    let need = 'none';
    let hasSurplus = false;
    let budgetPressure = 0;
    if (analysis && scarcity) {
      marketPressure = analysis.computeMarketPressure(scarcity);
      passConsequence = analysis.computePassConsequence({
        scarcity, cliff, position: nom.position,
      });
      if (you && nom.position) {
        const profile = bidderProfile(you, nom.position, o.leagueValue || nom.sleeperProjection || 1, { league });
        need = profile.need;
        // Surplus heuristic: at least one player at this position on
        // the roster AND their spend is >= a starter-caliber threshold
        // ($15+ is a defensible fantasy floor for "real starter").
        hasSurplus = !!(you.roster || []).find(
          (r) => r && r.position === nom.position && (Number(r.amount) || 0) >= 15
        );
        // Budget pressure: 1 - (maxBid / a reasonable per-slot budget).
        const perSlot = (Number(you.budgetRemaining) || 0)
          / Math.max(1, (you.openSlots || []).length || 1);
        // Compare to a naive league-average per-slot benchmark: $10 is
        // the median per-slot spend in a $200/15-slot league. Anything
        // below reads as tight.
        budgetPressure = perSlot < 5 ? 0.9 : perSlot < 10 ? 0.5 : 0.1;
      }
      scarcityImpact = analysis.computeScarcityImpact({
        scarcity, cliff, need, hasSurplus, budgetPressure,
      });
      primaryInsight = analysis.computeInsightPriority({
        scarcity, cliff, impact: scarcityImpact,
        fitTone: o.fitTone || (need === 'starter' ? 'strong' : need === 'bench' ? 'depth' : 'low'),
        position: nom.position,
        budgetPressure,
      });
    }

    // Alternatives -- reuses the same pool + picks + scarcity + cliff
    // + you + league that the rest of this pass already assembled. The
    // engine grades each undrafted same-position player relative to
    // the nominee (production, scarcity, consistency, playoff, roster
    // fit) and returns the top 3-5. Auction $ is exposed separately as
    // auctionContext so the DBR can consume it without letting price
    // inflate the score.
    let alternatives = null;
    if (analysis && typeof analysis.computeAlternativeCandidates === 'function'
        && nom && nom.position && nom.sleeperProjection != null && o.pool) {
      const inflationFactor = o.inflation > 0 ? o.inflation : 1;
      const laFn = o.tierAggregates
        ? (candPlayer) => computeLeagueAdjustedValue({
            position: candPlayer.position,
            sleeperProjection: candPlayer.projection,
            tierAggregates: o.tierAggregates,
            inflationFactor,
          })
        : null;
      const format = o.format || null;
      alternatives = analysis.computeAlternativeCandidates({
        nom: {
          name: nom.playerName,
          position: nom.position,
          projection: nom.sleeperProjection,
        },
        pool: o.pool,
        picks: o.picks,
        scarcity,
        cliff,
        format,
        league,
        you,
        nomLeagueValue: o.leagueValue,
        leagueAdjustedValueOf: laFn,
        openSlotsForPosition,
        positionCap,
        countRosterAtPosition,
      });
    }

    // Bid recommendation -- now consumes the impact so the scarcity
    // premium is computed exactly once, in the shared engine.
    // Fair Value RANGE for this player. Same tier-aggregate anchor as
    // the scalar `leagueValue` (so range.center === o.leagueValue), plus
    // the low/high band from the tier's historical distribution. Passed
    // through to the engine + surfaced on the rec so the UI can render
    // "Fair $32-36" instead of a false-precision "Fair $34" (spec §2).
    let fairValueRange = null;
    if (o.tierAggregates && nom && nom.position && nom.sleeperProjection != null) {
      fairValueRange = computeLeagueAdjustedValueRange({
        position: nom.position,
        sleeperProjection: nom.sleeperProjection,
        tierAggregates: o.tierAggregates,
        inflationFactor: o.inflation > 0 ? o.inflation : 1,
      });
    }

    let rec = null;
    if (o.leagueValue != null && nom && nom.position) {
      rec = computeBidRecommendation({
        nom,
        leagueValue: o.leagueValue,
        fairValueRange,
        inflation: o.inflation,
        teams,
        you,
        tier: o.tier,
        scarcity,
        league,
        // The roster-aware bid engine needs draft.settings (Sleeper puts
        // slots_* on the DRAFT object for auctions, not on league) and
        // the derived format + pool. Forward everything we already have.
        draft: o.draft || null,
        format: o.format || null,
        pool: o.pool || null,
        impact: scarcityImpact,
        cliff,
        alternatives,
      });
    }

    return {
      scarcity, cliff, marketPressure, passConsequence,
      scarcityImpact, primaryInsight, rec, alternatives,
    };
  }

  function filterAvailableAtPosition(pool, picks, position) {
    if (!pool || !Array.isArray(pool.players)) return [];
    const pos = String(position).toUpperCase();
    const drafted = new Set();
    for (const p of pool.players) {
      if (p.isDrafted) drafted.add(poolKey(p.name, p.position));
    }
    for (const pick of picks || []) {
      const md = pick && pick.metadata;
      if (!md) continue;
      const name = `${md.first_name || ''} ${md.last_name || ''}`.trim();
      if (name && md.position) drafted.add(poolKey(name, md.position));
    }
    return pool.players
      .filter((p) => (p.position || '').toUpperCase() === pos
        && p.projection != null && p.projection > 0
        && !drafted.has(poolKey(p.name, p.position)))
      .map((p) => p.projection)
      .sort((a, b) => b - a);
  }

  global.DraftPilot = global.DraftPilot || {};
  global.DraftPilot.liveDraft = {
    createSession,
    extractDraftIdFromUrl,
    playerName,
    pickAmount,
    managerLabel,
    rosterSlotsPerTeam,
    computeLiveInflation,
    computeLeagueAdjustedValue,
    computeLeagueAdjustedValueRange,
    SLOTS_BY_POSITION,
    openSlotsForPosition,
    bidderProfile,
    describeNeed,
    summarizeNeeds,
    benchOpenCount,
    positionCap,
    countRosterAtPosition,
    findTier,
    computeLiveTiers,
    describeTierComputation,
    countPicksByPosition,
    computeScarcity,
    suggestNominations,
    suggestNextNomination,
    computeStrategyRecommendations,
    listAvailablePlayers,
    computeYourTeamSummary,
    computeBidRecommendation,
    buildNominationInsights,
    filterAvailableAtPosition,
    resolveYourTeam,
    isYouByName,
    poolKey,
  };
})(typeof window !== 'undefined' ? window : globalThis);
