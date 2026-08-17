(function () {
  // Sleeper's live-draft state isn't in their public REST API -- only
  // completed picks are. To surface the CURRENT nomination and bids in
  // real time we scrape the auction draft-room DOM, diff-hash it, and
  // push changes to the side panel via chrome.runtime.sendMessage.
  //
  // Runs only on /draft/nfl/{id} pages (matched by manifest). Silently
  // no-ops if the auction panel isn't rendered (snake draft, panel
  // collapsed, page not fully mounted yet).

  const POLL_INTERVAL_MS = 500;
  // Heartbeat send even when nothing changed, so the side panel can tell
  // the tab is still alive vs. stale.
  const HEARTBEAT_MS = 3000;

  function getDraftId() {
    const m = location.pathname.match(/\/draft\/(?:nfl\/)?(\d{10,})/);
    return m ? m[1] : null;
  }

  function parseIntSafe(s) {
    if (s == null) return null;
    const n = parseInt(String(s).replace(/[^\d-]/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  }

  function parseNomination() {
    const container = document.querySelector('.auction-container');
    if (!container) return null;

    const header = container.querySelector('.auction-player-header');
    if (!header) return null;

    const nameEl = header.querySelector('.headerText');
    const playerName = nameEl ? nameEl.textContent.trim() : '';
    if (!playerName) return null;

    // Two .playerInfoText siblings: first is position (e.g. "WR"), second
    // is " - SEA (11)" style team + bye.
    const infoEls = header.querySelectorAll('.playerInfoText');
    let position = '';
    let team = '';
    if (infoEls.length >= 1) position = infoEls[0].textContent.trim();
    if (infoEls.length >= 2) {
      const t = infoEls[1].textContent.match(/([A-Z]{2,3})/);
      if (t) team = t[1];
    }

    // Sleeper projection: two .projection-text children, second is "$43".
    let sleeperProjection = null;
    const projEls = header.querySelectorAll('.projection-text');
    for (const el of projEls) {
      const m = el.textContent.match(/\$(\d+)/);
      if (m) { sleeperProjection = Number(m[1]); break; }
    }

    // Player ID lives in the avatar image URL: /players/thumb/9488.jpg
    let playerId = null;
    const avatar = header.querySelector('.avatar-player');
    if (avatar) {
      const src = avatar.getAttribute('src') || '';
      const m = src.match(/\/(\d+)\.jpg/);
      if (m) playerId = m[1];
    }

    // Current top bid: .bidInfo reads "$43 @Team 3" -- most reliable
    // single source vs. inspecting the bid-container header row.
    let topBid = null;
    let topBidder = null;
    const bidInfoEl = header.querySelector('.bidInfo');
    if (bidInfoEl) {
      const m = bidInfoEl.textContent.trim().match(/\$(\d+)\s*@(.+)/);
      if (m) { topBid = Number(m[1]); topBidder = m[2].trim(); }
    }

    // Running bid history for this nomination (newest first). Sleeper
    // stacks them top=newest so the LAST entry is the opening
    // bid -- i.e., whoever nominated this player. Captured separately
    // so downstream can attribute nominations without re-parsing.
    const recentBids = [];
    const bidItems = header.querySelectorAll('.bid-container .bid-item');
    for (const item of bidItems) {
      const amtEl = item.querySelector('.offer-text');
      const tmEl = item.querySelector('.team-text');
      if (!amtEl || !tmEl) continue;
      const m = amtEl.textContent.match(/\$(\d+)/);
      if (!m) continue;
      recentBids.push({ amount: Number(m[1]), bidder: tmEl.textContent.trim() });
    }
    let openingBidder = null;
    let openingBid = null;
    if (recentBids.length) {
      const first = recentBids[recentBids.length - 1];
      openingBidder = first.bidder;
      openingBid = first.amount;
    }

    // Status text: "BIDDING" / "PAUSED" / etc. Also .disabled classes on
    // .bid-input tell us when interaction is off.
    let status = null;
    const bidTextEl = container.querySelector('.bidText');
    if (bidTextEl) status = bidTextEl.textContent.trim().toUpperCase() || null;

    // Countdown progress (0-100). Ticks constantly; excluded from diff
    // hash below so timer-only changes don't spam the panel.
    let timerPct = null;
    const progressEl = container.querySelector('[role="progressbar"][aria-valuenow]');
    if (progressEl) {
      const v = Number(progressEl.getAttribute('aria-valuenow'));
      if (Number.isFinite(v)) timerPct = v;
    }

    return {
      playerName, playerId, position, team, sleeperProjection,
      topBid, topBidder, recentBids, status, timerPct,
      openingBidder, openingBid,
    };
  }

  function parseTeamColumns() {
    const cols = document.querySelectorAll('.team-column');
    const teams = [];
    for (const col of cols) {
      // Prefer the non-clone header; team-header-container is the real
      // one, team-header-container-clone is a sticky duplicate.
      const header = col.querySelector('.team-header-container') || col;
      const nameEl = header.querySelector('.header-text');
      if (!nameEl) continue;

      const manager = nameEl.textContent.trim();
      const maxBid = parseIntSafe((header.querySelector('.max-number') || {}).textContent);
      const budgetRemaining = parseIntSafe((header.querySelector('.remaining-text') || {}).textContent);
      const rosterCountRaw = (header.querySelector('.roster-number') || {}).textContent;
      const rosterCount = parseIntSafe(rosterCountRaw) || 0;

      const roster = [];
      // Open-slot labels for this team, in draft-order. Distinguishing
      // "3 open BN" from "3 open WR" is what makes need-based bidder
      // filtering possible downstream. Sleeper's cell markup:
      //   drafted:  <div class="cell rb drafted">...
      //   open:     <div class="cell false"> <div class="pick">RB</div>
      // We walk EVERY cell in order and split by the `drafted` class.
      const openSlots = [];
      const allCells = col.querySelectorAll('.cell-container .cell');
      for (const cell of allCells) {
        if (cell.classList.contains('drafted')) {
          const pickEl = cell.querySelector('.pick');
          const pNameEl = cell.querySelector('.player-name');
          const pPosEl = cell.querySelector('.position');
          if (!pickEl || !pNameEl) continue;
          const amtM = pickEl.textContent.match(/\$(\d+)/);
          const posM = pPosEl && pPosEl.textContent.match(/^([A-Z]+)\s*-\s*([A-Z]+)/);
          roster.push({
            name: pNameEl.textContent.trim(),
            amount: amtM ? Number(amtM[1]) : null,
            position: posM ? posM[1] : null,
            team: posM ? posM[2] : null,
          });
        } else {
          const label = (cell.querySelector('.pick') || {}).textContent;
          if (label) openSlots.push(label.trim().toUpperCase());
        }
      }

      teams.push({ manager, maxBid, budgetRemaining, rosterCount, roster, openSlots });
    }
    return teams;
  }

  // Diff hash intentionally omits timerPct and recent-bid ordering
  // details so a ticking countdown doesn't fire messages every 500ms.
  function stateHash(nom, teams) {
    const nomKey = nom
      ? [nom.playerName, nom.position, nom.team, nom.topBid, nom.topBidder, nom.status, nom.recentBids.length, nom.openingBidder].join('|')
      : '';
    const teamsKey = teams
      .map((t) => [
        t.manager, t.maxBid, t.budgetRemaining, t.rosterCount, t.roster.length,
        (t.openSlots || []).join('|'),
      ].join(','))
      .join(';');
    return nomKey + '::' + teamsKey;
  }

  let lastHash = null;
  let lastSentAt = 0;

  function scanAndSend() {
    let nomination = null;
    let teams = [];
    try {
      nomination = parseNomination();
      teams = parseTeamColumns();
    } catch (_) {
      // DOM in a bad state (mid-transition); try again next tick.
      return;
    }
    if (!nomination && !teams.length) return;

    const h = stateHash(nomination, teams);
    const now = Date.now();
    const heartbeatDue = now - lastSentAt >= HEARTBEAT_MS;
    if (h === lastHash && !heartbeatDue) return;
    lastHash = h;
    lastSentAt = now;

    try {
      chrome.runtime.sendMessage({
        type: 'DRAFTPILOT_LIVE_STATE',
        draftId: getDraftId(),
        payload: { nomination, teams, timestamp: now },
      }, () => {
        // Swallow "receiving end does not exist" when side panel isn't
        // open. The lastError is read to keep it from surfacing in
        // devtools as an unhandled promise.
        void chrome.runtime.lastError;
      });
    } catch (_) {
      // sendMessage throws in some odd states; nothing actionable.
    }
  }

  let timer = null;
  function start() {
    if (timer) return;
    timer = setInterval(scanAndSend, POLL_INTERVAL_MS);
    scanAndSend();
  }
  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  // Gate the scanner behind the liveBidAnalysis flag. When the flag is
  // off, we don't touch the DOM, don't send messages, and don't wake
  // the scanner up -- the side panel will just show its own
  // "temporarily unavailable" state instead. Hydrating from storage
  // once + subscribing to changes keeps the gate live even if the
  // server flips the flag while the draft page is open.
  const flags = (window.DraftPilot && window.DraftPilot.featureFlags) || null;
  const storage = (window.DraftPilot && window.DraftPilot.storage) || null;

  function applyFlag() {
    if (!flags || flags.isEnabled('liveBidAnalysis')) start();
    else stop();
  }

  async function boot() {
    if (flags && storage) {
      try { await flags.hydrateFromStorage(storage); } catch (_) {}
      try {
        flags.subscribeToStorageChanges(
          chrome.storage,
          `draftpilot:${flags.STORAGE_KEY}`
        );
        flags.subscribe(applyFlag);
      } catch (_) {}
    }
    applyFlag();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
