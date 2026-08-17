(function (global) {
  const { logger, parser, observer, exporter, storage, sleeperApi } = global.DraftPilot;

  const BANNER_ID = 'draftpilot-banner';
  const MAX_PLAYERS = 500;

  /** Pulls the draft ID out of the current page URL. Sleeper's draft
   * URLs are always `/draft/{sport}/{id}` with an optional query string. */
  function extractDraftId() {
    const match = window.location.pathname.match(/\/draft\/[^/]+\/(\d+)/);
    return match ? match[1] : null;
  }

  /** Normalizes a name+position key for matching API picks to DOM rows.
   * Sleeper's picks metadata and its DOM both include the player's full
   * name; position disambiguates the rare same-name case. */
  function pickKey(name, position) {
    return `${(name || '').trim().toLowerCase()}|${(position || '').trim().toUpperCase()}`;
  }

  /** Fetches picks + settings for the current draft in one pass. Returns
   * `{ pickMap, teams, budget }`. `pickMap` is keyed by name+position and
   * contains { keeperCost, keptBy, isKeeperFlag, pickNo }. On any failure
   * returns an empty context so the export still runs (silent no-op). */
  async function fetchDraftedContext(draftId) {
    try {
      const [draft, picks] = await Promise.all([
        sleeperApi.getDraft(draftId),
        sleeperApi.getDraftPicks(draftId),
      ]);

      const settings = (draft && draft.settings) || {};
      const teams = settings.teams || null;
      const budget = settings.budget || null;

      if (!Array.isArray(picks) || !picks.length) {
        return { pickMap: new Map(), teams, budget };
      }

      let usersById = new Map();
      if (draft && draft.league_id) {
        const users = await sleeperApi.getLeagueUsers(draft.league_id).catch(() => []);
        for (const u of users || []) {
          usersById.set(u.user_id, {
            displayName: u.display_name,
            teamName: (u.metadata && u.metadata.team_name) || null,
          });
        }
      }

      const pickMap = new Map();
      for (const pick of picks) {
        const md = pick.metadata || {};
        const name = `${md.first_name || ''} ${md.last_name || ''}`.trim();
        if (!name || !md.position) continue;
        const drafter = usersById.get(pick.picked_by);
        const keptBy = drafter
          ? drafter.teamName || drafter.displayName
          : pick.draft_slot
          ? `Team ${pick.draft_slot}`
          : null;
        pickMap.set(pickKey(name, md.position), {
          keeperCost: md.amount != null ? Number(md.amount) : null,
          keptBy,
          isKeeperFlag: !!pick.is_keeper,
          pickNo: pick.pick_no,
        });
      }
      return { pickMap, teams, budget };
    } catch (err) {
      logger.warn('Could not fetch draft picks context', err);
      return { pickMap: new Map(), teams: null, budget: null };
    }
  }

  /** Computes a single inflation factor for non-keeper players based on
   * how the actual keeper spend compares to what the league would
   * normally pay for those same players. Overpaid keepers → deflation
   * on the rest; bargain keepers → inflation.
   *
   * Formula (standard auction inflation math):
   *   factor = (totalBudget - actualKeeperSpend) / (totalBudget - expectedKeeperValue)
   */
  function computeInflationFactor(players, teams, budget) {
    const kept = players.filter(
      (p) => (p.status === 'Keeper' || p.status === 'Drafted') && p.keeperCost != null
    );
    if (!kept.length || !teams || !budget) return 1;

    const totalBudget = teams * budget;
    const actualKeeperSpend = kept.reduce((sum, p) => sum + (p.keeperCost || 0), 0);
    const expectedKeeperValue = kept.reduce((sum, p) => sum + (p.leagueAdjustedValue || 0), 0);

    const numerator = totalBudget - actualKeeperSpend;
    const denominator = totalBudget - expectedKeeperValue;
    if (numerator <= 0 || denominator <= 0) return 1;
    return numerator / denominator;
  }

  function showBanner(text) {
    let banner = document.getElementById(BANNER_ID);
    if (!banner) {
      banner = document.createElement('div');
      banner.id = BANNER_ID;
      banner.style.cssText = [
        'position:fixed',
        'top:16px',
        'right:16px',
        'z-index:2147483647',
        'background:#1a1a2e',
        'color:#fff',
        'padding:10px 16px',
        'border-radius:8px',
        'font-family:sans-serif',
        'font-size:13px',
        'box-shadow:0 4px 12px rgba(0,0,0,0.3)',
      ].join(';');
      document.body.appendChild(banner);
    }
    banner.textContent = text;
    return banner;
  }

  function hideBanner() {
    const banner = document.getElementById(BANNER_ID);
    if (banner) banner.remove();
  }

  /**
   * Scroll the virtualized player list, collect every row, and merge in
   * keeper/drafted context from the picks API. Returns the enriched
   * player array + draft metadata. Shared by runExport (which then
   * downloads a CSV) and capturePool (which persists to storage for
   * Live Mode's nomination suggester).
   */
  async function collectPool(onCollected) {
    const grid = parser.findGrid();
    if (!grid) {
      throw observer.createError(
        'GRID_NOT_FOUND',
        'Draft room not detected. Open a Sleeper draft board and try again.'
      );
    }
    const draftType = parser.detectDraftType();
    const draftId = extractDraftId();
    logger.debug('Detected', { draftType, draftId });

    const pickContextPromise = draftId
      ? fetchDraftedContext(draftId)
      : Promise.resolve({ pickMap: new Map(), teams: null, budget: null });

    const originalShowDrafted = parser.getShowDraftedState();
    if (originalShowDrafted === false) {
      parser.setShowDrafted(true);
      await new Promise((r) => setTimeout(r, 500));
    }

    let players;
    try {
      players = await observer.autoScrollAndCollect({
        grid,
        findRows: parser.findRows,
        parseRow: (rowEl) => parser.parseRow(rowEl, draftType),
        maxPlayers: MAX_PLAYERS,
        onProgress: ({ collected }) => {
          showBanner(`Draft Pilot: collected ${collected} players…`);
          if (onCollected) onCollected(collected);
        },
      });
    } finally {
      if (originalShowDrafted === false) parser.setShowDrafted(false);
    }

    const { pickMap, teams, budget } = await pickContextPromise;
    for (const player of players) {
      if (!player.isDrafted) continue;
      const ctx = pickMap.get(pickKey(player.playerName, player.position));
      if (ctx) {
        player.keeperCost = ctx.keeperCost;
        player.keptBy = ctx.keptBy;
        player.status = ctx.isKeeperFlag ? 'Keeper' : 'Drafted';
      } else {
        player.status = 'Kept (unresolved)';
      }
    }
    for (const player of players) {
      if (!player.status) player.status = 'Available';
    }

    return { players, draftType, draftId, teams, budget };
  }

  /**
   * Persist a compact pool snapshot for Live Mode's nomination
   * suggester. Only the fields the suggester needs are kept -- projected
   * value, position, team, rookie flag, drafted flag -- so the storage
   * write stays small and cheap to parse on the popup side.
   */
  async function savePool({ draftId, players }) {
    // `points` is the quality signal used by the tier engine (Sleeper's
    // projected fantasy points). It's smoother than auction $, which
    // conflates market pricing with player quality and produces
    // pathological tier fragmentation on heavy-tailed pools. `projection`
    // (auction $) stays for pricing, inflation, and bid recommendations.
    const compact = players.map((p) => ({
      name: p.playerName,
      position: p.position,
      team: p.team,
      projection: p.projectedAuctionValue,
      points: p.projectedFantasyPoints,
      yearsExp: p.yearsExp,
      isDrafted: !!p.isDrafted,
    }));
    await storage.set('playerPool', {
      draftId,
      capturedAt: Date.now(),
      players: compact,
    });
  }

  async function runExport(onCollected) {
    showBanner('Draft Pilot: scanning draft board…');
    const { players, draftType, draftId, teams, budget } = await collectPool(onCollected);
    let keeperCount = players.filter((p) => p.status === 'Keeper' || p.status === 'Drafted').length;

    // Opportunistic reuse: caching the pool here means a user who
    // exports first, then goes to Live Mode, gets the nomination
    // suggester without a separate load step.
    await savePool({ draftId, players }).catch(() => {});

    // Auction drafts optionally get a League-Adjusted Value column, powered
    // by cached past-drafts analysis. Silent no-op if the cache is empty.
    if (draftType === 'auction') {
      const cached = await storage.get('leagueTierAggregates').catch(() => null);
      if (cached) {
        exporter.enrichWithLeagueAdjusted(players, cached);
        const inflationFactor = computeInflationFactor(players, teams, budget);
        if (Math.abs(inflationFactor - 1) > 0.001) {
          exporter.enrichWithLeagueAdjusted(players, cached, { inflationFactor });
          logger.debug('Applied keeper inflation', { inflationFactor, keeperCount });
        }
      }
    }

    exporter.downloadCSV(players, { draftType });
    await storage.set('lastExport', { timestamp: Date.now(), count: players.length, draftType });

    showBanner(`Draft Pilot: exported ${players.length} players ✓`);
    setTimeout(hideBanner, 3000);
    return players.length;
  }

  /**
   * Same scroll+collect as runExport, but no CSV download -- just
   * persists the snapshot for Live Mode. Called from the side panel
   * via DRAFTPILOT_CAPTURE_POOL message.
   */
  async function capturePool() {
    showBanner('Draft Pilot: capturing player pool…');
    const { players, draftId } = await collectPool();
    await savePool({ draftId, players });
    showBanner(`Draft Pilot: captured ${players.length} players ✓`);
    setTimeout(hideBanner, 2000);
    return players.length;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) return undefined;

    if (message.type === 'DRAFTPILOT_EXPORT') {
      runExport((collected) => {
        chrome.runtime.sendMessage({ type: 'DRAFTPILOT_PROGRESS', collected }).catch(() => {});
      })
        .then((count) => sendResponse({ success: true, count }))
        .catch((err) => {
          logger.error('Export failed', err);
          const msg = err.userMessage || err.message || 'Export failed.';
          showBanner(`Draft Pilot: ${msg}`);
          setTimeout(hideBanner, 4000);
          sendResponse({ success: false, error: msg, code: err.code });
        });
      return true;
    }

    if (message.type === 'DRAFTPILOT_CAPTURE_POOL') {
      capturePool()
        .then((count) => sendResponse({ success: true, count }))
        .catch((err) => {
          logger.error('Pool capture failed', err);
          const msg = err.userMessage || err.message || 'Pool capture failed.';
          showBanner(`Draft Pilot: ${msg}`);
          setTimeout(hideBanner, 4000);
          sendResponse({ success: false, error: msg, code: err.code });
        });
      return true;
    }

    return undefined;
  });

  global.DraftPilot = global.DraftPilot || {};
  global.DraftPilot.ui = { runExport, capturePool, showBanner, hideBanner };
})(typeof window !== 'undefined' ? window : globalThis);
