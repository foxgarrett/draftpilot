(function (global) {
  // Selectors confirmed against the live Sleeper draft board (Aug 2026).
  // Sleeper's draft board uses stable, semantic-ish class names rather than
  // hashed ones, but a redesign can still change these at any time.
  const SELECTORS = {
    grid: '.ReactVirtualized__Grid',
    row: '.player-rank-item2',
    rank: '.rank',
    nameWrapper: '.name-wrapper',
    position: '.position',
    team: '.team',
    // Auction drafts add an "auction" modifier class to this container; snake
    // (and other non-auction) drafts don't. This is the only reliable signal
    // for draft type -- the header text for the .adp column is empty in both
    // cases, so it can't be used to distinguish them.
    auctionIndicator: '.bottom-container.auction',
  };

  // Maps our normalized field names to Sleeper's stat-cell class names.
  const STAT_CELLS = {
    adp: 'adp',
    bye: 'bye',
    projPts: 'proj-pts',
    projAvg: 'proj-avg',
    rushAtt: 'rush-att',
    rushYd: 'rush-yd',
    rushTd: 'rush-td',
    recTgt: 'rec-tgt',
    recYd: 'rec-yd',
    recTd: 'rec-td',
    passAtt: 'pass-att',
    passYd: 'pass-yd',
    passTd: 'pass-td',
  };

  function directText(el) {
    let text = '';
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
    }
    return text.trim();
  }

  function toNumberOrNull(raw) {
    if (raw === undefined || raw === null) return null;
    const cleaned = String(raw).replace(/[$,]/g, '').trim();
    if (cleaned === '' || cleaned === '-') return null;
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : null;
  }

  function readStatCell(row, className) {
    const cell = row.querySelector(`.${className} .value`);
    return cell ? cell.textContent.trim() : null;
  }

  /** Reads a single player row into raw string fields, with no normalization. */
  function extractRawRow(row) {
    const rankText = row.querySelector(SELECTORS.rank)?.textContent.trim() ?? null;
    const nameWrapper = row.querySelector(SELECTORS.nameWrapper);
    const positionEl = row.querySelector(SELECTORS.position);

    const raw = {
      rank: rankText,
      playerName: nameWrapper ? directText(nameWrapper) : null,
      position: positionEl ? directText(positionEl) : null,
      team: row.querySelector(SELECTORS.team)?.textContent.trim() ?? null,
    };

    for (const [field, className] of Object.entries(STAT_CELLS)) {
      raw[field] = readStatCell(row, className);
    }

    return raw;
  }

  /** Detects whether the current draft is an auction or a snake/linear draft. */
  function detectDraftType(root = document) {
    return root.querySelector(SELECTORS.auctionIndicator) ? 'auction' : 'snake';
  }

  /**
   * Normalizes a raw row into the DraftPilot player schema.
   * Every field is present; missing data becomes null rather than throwing.
   *
   * The `.adp` column means different things depending on draft type: a
   * dollar value in auction drafts, average draft position everywhere else.
   * `draftType` decides which normalized field the raw value is routed into,
   * so the other one is always null rather than mislabeled.
   */
  function normalizePlayer(raw, draftType) {
    const adpValue = toNumberOrNull(raw.adp);
    return {
      rank: toNumberOrNull(raw.rank),
      playerName: raw.playerName || null,
      position: raw.position || null,
      team: raw.team || null,
      bye: toNumberOrNull(raw.bye),
      projectedAuctionValue: draftType === 'auction' ? adpValue : null,
      averageDraftPosition: draftType === 'auction' ? null : adpValue,
      projectedFantasyPoints: toNumberOrNull(raw.projPts),
      averageFantasyPoints: toNumberOrNull(raw.projAvg),
      passingAttempts: toNumberOrNull(raw.passAtt),
      passingYards: toNumberOrNull(raw.passYd),
      passingTD: toNumberOrNull(raw.passTd),
      rushingAttempts: toNumberOrNull(raw.rushAtt),
      rushingYards: toNumberOrNull(raw.rushYd),
      rushingTD: toNumberOrNull(raw.rushTd),
      // Sleeper's draft board exposes receiving targets, not receptions/catches.
      // There is no source for this field on this screen, so it is always null.
      receptions: null,
      receivingYards: toNumberOrNull(raw.recYd),
      receivingTD: toNumberOrNull(raw.recTd),
    };
  }

  function parseRow(rowEl, draftType) {
    return normalizePlayer(extractRawRow(rowEl), draftType);
  }

  function findGrid(root = document) {
    return root.querySelector(SELECTORS.grid);
  }

  function findRows(root = document) {
    return Array.from(root.querySelectorAll(SELECTORS.row));
  }

  global.DraftPilot = global.DraftPilot || {};
  global.DraftPilot.parser = { parseRow, findGrid, findRows, detectDraftType, SELECTORS };
})(typeof window !== 'undefined' ? window : globalThis);
