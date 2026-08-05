(function (global) {
  const { logger, parser, observer, exporter, storage } = global.DraftPilot;

  const BANNER_ID = 'draftpilot-banner';
  const MAX_PLAYERS = 500;

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

    showBanner('DraftPilot: scanning draft board…');

    const draftType = parser.detectDraftType();
    logger.debug('Detected draft type', draftType);

    const players = await observer.autoScrollAndCollect({
      grid,
      findRows: parser.findRows,
      parseRow: (rowEl) => parser.parseRow(rowEl, draftType),
      maxPlayers: MAX_PLAYERS,
      onProgress: ({ collected }) => {
        showBanner(`DraftPilot: collected ${collected} players…`);
        if (onCollected) onCollected(collected);
      },
    });

    exporter.downloadCSV(players, { draftType });
    await storage.set('lastExport', { timestamp: Date.now(), count: players.length, draftType });

    showBanner(`DraftPilot: exported ${players.length} players ✓`);
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
        showBanner(`DraftPilot error: ${err.message}`);
        setTimeout(hideBanner, 4000);
        sendResponse({ success: false, error: err.message, code: err.code });
      });

    return true; // keep the message channel open for the async sendResponse above
  });

  global.DraftPilot = global.DraftPilot || {};
  global.DraftPilot.ui = { runExport, showBanner, hideBanner };
})(typeof window !== 'undefined' ? window : globalThis);
