(function (global) {
  const logger = global.DraftPilot.logger;

  function createError(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
  }

  // Sleeper's player list is virtualized (react-virtualized) and does not
  // respond to setting `scrollTop` directly -- the position is tracked in
  // internal component state and gets reset. A synthetic wheel event is the
  // only reliable way to advance it; this was confirmed against a live draft.
  function dispatchWheelStep(grid, deltaY) {
    const rect = grid.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    grid.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
        deltaY,
        deltaMode: 0,
      })
    );
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function resetToTop(grid, { steps = 10, wheelStep = 4000, settleDelayMs = 100 } = {}) {
    for (let i = 0; i < steps; i++) {
      dispatchWheelStep(grid, -wheelStep);
      await wait(settleDelayMs);
    }
  }

  /**
   * Scrolls the virtualized player grid from top to bottom, collecting every
   * unique row (deduped by rank) along the way. `wheelStep` must stay small
   * enough that consecutive render windows overlap, or rows in between will
   * never be rendered and will be silently skipped.
   */
  async function autoScrollAndCollect({
    grid,
    findRows,
    parseRow,
    onProgress,
    wheelStep = 1200,
    settleDelayMs = 150,
    stableThreshold = 3,
    maxIterations = 2000,
    timeoutMs = 120000,
  }) {
    if (!grid) {
      throw createError(
        'GRID_NOT_FOUND',
        'Could not locate the player list. Make sure the draft room has fully loaded.'
      );
    }

    await resetToTop(grid);

    const collected = new Map();
    let lastMaxRank = 0;
    let stableCount = 0;
    const startedAt = Date.now();

    for (let i = 0; i < maxIterations; i++) {
      if (Date.now() - startedAt > timeoutMs) {
        throw createError('SCROLL_TIMEOUT', 'Timed out waiting for the player list to finish loading.');
      }

      for (const rowEl of findRows()) {
        const player = parseRow(rowEl);
        if (player.rank == null) {
          logger.warn('Skipped a malformed row with no rank', player);
          continue;
        }
        if (!collected.has(player.rank)) {
          collected.set(player.rank, player);
        }
      }

      const maxRank = collected.size ? Math.max(...collected.keys()) : 0;
      if (onProgress) onProgress({ collected: collected.size, maxRank });

      if (maxRank > 0 && maxRank === lastMaxRank) {
        stableCount++;
        if (stableCount >= stableThreshold) break;
      } else {
        stableCount = 0;
      }
      lastMaxRank = maxRank;

      dispatchWheelStep(grid, wheelStep);
      await wait(settleDelayMs);
    }

    if (collected.size === 0) {
      throw createError('NO_PLAYERS_FOUND', 'No players were found in the draft board.');
    }

    return Array.from(collected.values()).sort((a, b) => a.rank - b.rank);
  }

  global.DraftPilot = global.DraftPilot || {};
  global.DraftPilot.observer = { autoScrollAndCollect, createError };
})(typeof window !== 'undefined' ? window : globalThis);
