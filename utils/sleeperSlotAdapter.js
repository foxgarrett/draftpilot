(function (global) {
  // ---------------------------------------------------------------------
  // Sleeper -> generic startingSlots[] adapter.
  //
  // Reads league.settings.slots_* from the Sleeper API shape and emits
  // the generic slot list consumed by rosterOptimizer:
  //   [ { id: 'QB',         allowedPositions: ['QB'] },
  //     { id: 'RB',         allowedPositions: ['RB'] }, ...
  //     { id: 'FLEX',       allowedPositions: ['RB','WR','TE'] },
  //     { id: 'SUPER_FLEX', allowedPositions: ['QB','RB','WR','TE'] } ]
  //
  // Sleeper does not expose per-slot eligibility overrides in the
  // standard settings blob, so this adapter applies Sleeper's default
  // eligibility rules. Callers with unusual formats (e.g. WR/TE-only
  // flex) can post-process the returned array or bypass the adapter
  // entirely and build startingSlots themselves.
  //
  // Bench (BN), K, DEF/DST, IDP slots (LB, DL, DB, IDP_FLEX) are all
  // supported. Unrecognised slot keys are surfaced as { id, allowedPositions: [id] }
  // so future Sleeper additions don't silently disappear.
  // ---------------------------------------------------------------------

  // Sleeper slot-key -> { id emitted, allowedPositions }. Only the
  // keys listed here get the eligibility treatment; unknown slots_*
  // pass through as passthroughSlot() below.
  const SLEEPER_SLOT_DEFS = {
    slots_qb:         { id: 'QB',         allowed: ['QB'] },
    slots_rb:         { id: 'RB',         allowed: ['RB'] },
    slots_wr:         { id: 'WR',         allowed: ['WR'] },
    slots_te:         { id: 'TE',         allowed: ['TE'] },
    slots_k:          { id: 'K',          allowed: ['K'] },
    slots_def:        { id: 'DEF',        allowed: ['DEF', 'DST'] },
    slots_flex:       { id: 'FLEX',       allowed: ['RB', 'WR', 'TE'] },
    slots_wr_rb_flex: { id: 'WR_RB_FLEX', allowed: ['RB', 'WR'] },
    slots_wr_te_flex: { id: 'WR_TE_FLEX', allowed: ['WR', 'TE'] },
    slots_rb_wr_flex: { id: 'WR_RB_FLEX', allowed: ['RB', 'WR'] },
    slots_super_flex: { id: 'SUPER_FLEX', allowed: ['QB', 'RB', 'WR', 'TE'] },
    slots_idp_flex:   { id: 'IDP_FLEX',   allowed: ['DL', 'LB', 'DB'] },
    slots_dl:         { id: 'DL',         allowed: ['DL'] },
    slots_lb:         { id: 'LB',         allowed: ['LB'] },
    slots_db:         { id: 'DB',         allowed: ['DB'] },
  };

  // BN is intentionally excluded from starting slots: bench isn't part
  // of the starting lineup optimisation, it's roster capacity. Callers
  // that need it (e.g. for total-roster-size calculations) can read
  // settings.slots_bn directly.

  function passthroughSlot(key) {
    // e.g. slots_something_unusual -> id 'SOMETHING_UNUSUAL', allowed
    // = [same]. Best-effort fallback so a novel Sleeper slot isn't
    // silently dropped. Callers can inspect and override.
    const id = key.replace(/^slots_/, '').toUpperCase();
    return { id, allowedPositions: [id] };
  }

  /**
   * Build the generic startingSlots[] from Sleeper league settings.
   *
   * @param {Object} settings  Sleeper league.settings (or draft.settings
   *                           for auction drafts -- same shape).
   * @param {Object} [opts]
   * @param {Object} [opts.eligibilityOverrides]
   *   Map of slotId -> string[] of allowedPositions. Overrides the
   *   default for any emitted slot with that id. Useful when the
   *   league runs a non-standard flex (e.g. FLEX = ['WR','TE']).
   *
   * @returns Array<{ id, allowedPositions }>  Order matches the fixed
   *   canonical order below (QB, RB, WR, TE, then FLEX variants, then
   *   SUPER_FLEX, then K, DEF, IDP). Multiple entries with the same id
   *   for multi-slot leagues (e.g. two RBs => two { id:'RB', ... }).
   */
  function buildStartingSlots(settings, opts) {
    if (!settings || typeof settings !== 'object') return [];
    const overrides = (opts && opts.eligibilityOverrides) || {};

    const ORDER = [
      'slots_qb', 'slots_rb', 'slots_wr', 'slots_te',
      'slots_wr_rb_flex', 'slots_rb_wr_flex', 'slots_wr_te_flex', 'slots_flex',
      'slots_super_flex',
      'slots_k', 'slots_def',
      'slots_dl', 'slots_lb', 'slots_db', 'slots_idp_flex',
    ];

    const emitted = [];
    const seenKeys = new Set();

    for (const key of ORDER) {
      const count = Number(settings[key]) || 0;
      if (count <= 0) continue;
      seenKeys.add(key);
      const def = SLEEPER_SLOT_DEFS[key];
      const spec = def
        ? { id: def.id, allowedPositions: overrides[def.id] || def.allowed.slice() }
        : passthroughSlot(key);
      for (let i = 0; i < count; i++) {
        emitted.push({ id: spec.id, allowedPositions: spec.allowedPositions.slice() });
      }
    }

    // Catch any slots_* key we didn't include in ORDER but that the
    // league has set > 0. Skip BN and any explicit zeros. Preserves
    // forward-compat: a new Sleeper slot type still shows up.
    for (const key of Object.keys(settings)) {
      if (!key.startsWith('slots_')) continue;
      if (key === 'slots_bn') continue;
      if (seenKeys.has(key)) continue;
      const count = Number(settings[key]) || 0;
      if (count <= 0) continue;
      const def = SLEEPER_SLOT_DEFS[key];
      const spec = def
        ? { id: def.id, allowedPositions: overrides[def.id] || def.allowed.slice() }
        : passthroughSlot(key);
      for (let i = 0; i < count; i++) {
        emitted.push({ id: spec.id, allowedPositions: spec.allowedPositions.slice() });
      }
    }

    return emitted;
  }

  const api = {
    buildStartingSlots,
    // Exposed so tests can assert eligibility defaults directly.
    _SLEEPER_SLOT_DEFS: SLEEPER_SLOT_DEFS,
  };

  global.DraftPilot = global.DraftPilot || {};
  global.DraftPilot.sleeperSlotAdapter = api;

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
