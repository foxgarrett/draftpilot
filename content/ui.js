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

  async function runExport(onCollected) {
    const grid = parser.findGrid();
    if (!grid) {
      throw observer.createError(
        'GRID_NOT_FOUND',
        'Draft room not detected. Open a Sleeper draft board and try again.'
      );
    }

    showBanner('Draft Pilot: scanning draft board…');

    const draftType = parser.detectDraftType();
    const draftId = extractDraftId();
    logger.debug('Detected', { draftType, draftId });

    // Kick off the picks-API fetch in parallel with the DOM scan so we
    // don't add extra wall-clock time when there are keepers.
    const pickContextPromise = draftId
      ? fetchDraftedContext(draftId)
      : Promise.resolve({ pickMap: new Map(), teams: null, budget: null });

    // Enable "Show Drafted" so keepers appear in the DOM with full stats,
    // then restore whatever state the user had it in when we're done.
    const originalShowDrafted = parser.getShowDraftedState();
    if (originalShowDrafted === false) {
      parser.setShowDrafted(true);
      // Give react-virtualized a beat to re-render before we start scanning.
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

    // Merge in keeper/drafted context from the API before enrichment so
    // the inflation math has status + keeperCost to work with.
    const { pickMap, teams, budget } = await pickContextPromise;
    let keeperCount = 0;
    for (const player of players) {
      if (!player.isDrafted) continue;
      const ctx = pickMap.get(pickKey(player.playerName, player.position));
      if (ctx) {
        player.keeperCost = ctx.keeperCost;
        player.keptBy = ctx.keptBy;
        // Live draft picks (with a valid picked_by/roster_id) get "Drafted";
        // pre-draft/mock keepers get "Keeper" so a user can distinguish
        // "already locked in" from "just happened in the live draft".
        player.status = ctx.isKeeperFlag ? 'Keeper' : 'Drafted';
        keeperCount++;
      } else {
        player.status = 'Kept (unresolved)';
      }
    }
    for (const player of players) {
      if (!player.status) player.status = 'Available';
    }

    // Auction drafts optionally get a League-Adjusted Value column, powered
    // by cached past-drafts analysis. Silent no-op if the cache is empty.
    if (draftType === 'auction') {
      const cached = await storage.get('leagueTierAggregates').catch(() => null);
      if (cached) {
        // First pass -- assign base league-adjusted values to everyone
        // (no inflation) so we can compare keeper costs to expected value.
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

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== 'DRAFTPILOT_EXPORT') return undefined;

    runExport((collected) => {
      chrome.runtime.sendMessage({ type: 'DRAFTPILOT_PROGRESS', collected }).catch(() => {});
    })
      .then((count) => sendResponse({ success: true, count }))
      .catch((err) => {
        logger.error('Export failed', err);
        // Prefer the plain-English message sleeperApi attaches; fall back
        // to the raw error message for anything thrown by our own code.
        const message = err.userMessage || err.message || 'Export failed.';
        showBanner(`Draft Pilot: ${message}`);
        setTimeout(hideBanner, 4000);
        sendResponse({ success: false, error: message, code: err.code });
      });

    return true; // keep the message channel open for the async sendResponse above
  });

  global.DraftPilot = global.DraftPilot || {};
  global.DraftPilot.ui = { runExport, showBanner, hideBanner };
})(typeof window !== 'undefined' ? window : globalThis);
