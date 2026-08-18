// Fair Value RANGE tests.
// Run: node --test test/valueRange.test.js
//
// Covers spec §19:
//   - normal player -> sensible range around center
//   - $1 player -> no negative low
//   - high-value player -> range stays sensible
//   - historical data available -> range uses tier distribution
//   - historical data unavailable -> null (no fallback fabrication)
//   - sparse samples -> range widens
//   - projection diverges from tier median -> range widens
//   - inflation applies to both endpoints
//   - low <= center <= high invariant across all inputs
//   - $1 half-width minimum for anything above ~$4
//   - center of range MATCHES the scalar computeLeagueAdjustedValue
//     (so the range engine is a strict superset)

const test = require('node:test');
const assert = require('node:assert/strict');

// The range function lives on the liveDraft browser-module. Node
// test loads it via require after stubbing the sleeperApi dep the
// module reaches for at load time.
global.window = global.window || global;
global.window.DraftPilot = global.window.DraftPilot || {};
global.window.DraftPilot.sleeperApi = global.window.DraftPilot.sleeperApi || {};

// liveDraft.js is a browser-first IIFE that mutates window.DraftPilot.
// It does not export via CommonJS, so we load it for its side effects
// and then read the API off the global namespace.
require('../utils/liveDraft.js');
const { computeLeagueAdjustedValueRange, computeLeagueAdjustedValue } =
  global.window.DraftPilot.liveDraft;

// ---------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------

function tier({ median, min, max, samples, tierIndex }) {
  return {
    median, min: min != null ? min : median, max: max != null ? max : median,
    samples: samples != null ? samples : 5,
    tierIndex: tierIndex != null ? tierIndex : 0,
  };
}

function aggregates(perPosition) {
  return perPosition;
}

// ---------------------------------------------------------------------
// Missing inputs
// ---------------------------------------------------------------------

test('null when tierAggregates missing', () => {
  const r = computeLeagueAdjustedValueRange({
    position: 'RB', sleeperProjection: 30, inflationFactor: 1,
  });
  assert.equal(r, null);
});

test('null when position missing', () => {
  const r = computeLeagueAdjustedValueRange({
    sleeperProjection: 30, tierAggregates: aggregates({ RB: [tier({median:30})] }), inflationFactor: 1,
  });
  assert.equal(r, null);
});

test('null when projection missing or zero', () => {
  const r = computeLeagueAdjustedValueRange({
    position: 'RB', sleeperProjection: 0,
    tierAggregates: aggregates({ RB: [tier({median:30})] }), inflationFactor: 1,
  });
  assert.equal(r, null);
});

test('null when position has no tiers', () => {
  const r = computeLeagueAdjustedValueRange({
    position: 'RB', sleeperProjection: 30,
    tierAggregates: aggregates({ WR: [tier({median:30})] }), inflationFactor: 1,
  });
  assert.equal(r, null);
});

// ---------------------------------------------------------------------
// Normal player -> sensible range
// ---------------------------------------------------------------------

test('normal player: range spans the tier min/max around center', () => {
  // Tier: median 34, prices from $30 to $38, well-sampled (5 ranks).
  const t = tier({ median: 34, min: 30, max: 38, samples: 5 });
  const r = computeLeagueAdjustedValueRange({
    position: 'RB', sleeperProjection: 34,
    tierAggregates: aggregates({ RB: [t] }), inflationFactor: 1,
  });
  assert.equal(r.center, 34);
  assert.ok(r.low <= r.center && r.center <= r.high, 'low <= center <= high');
  assert.equal(r.low, 30);
  assert.equal(r.high, 38);
});

// ---------------------------------------------------------------------
// $1 player edge case
// ---------------------------------------------------------------------

test('$1 player: no negative low, no absurd expansion', () => {
  const t = tier({ median: 1, min: 1, max: 2, samples: 8 });
  const r = computeLeagueAdjustedValueRange({
    position: 'K', sleeperProjection: 1,
    tierAggregates: aggregates({ K: [t] }), inflationFactor: 1,
  });
  assert.ok(r.low >= 1, `low should be >= 1, got ${r.low}`);
  assert.ok(r.center >= 1);
  assert.ok(r.high >= r.center);
});

test('$2 player: still non-negative and low <= center <= high', () => {
  const t = tier({ median: 2, min: 1, max: 3, samples: 2 }); // sparse
  const r = computeLeagueAdjustedValueRange({
    position: 'DEF', sleeperProjection: 2,
    tierAggregates: aggregates({ DEF: [t] }), inflationFactor: 1,
  });
  assert.ok(r.low >= 1);
  assert.ok(r.low <= r.center && r.center <= r.high);
});

// ---------------------------------------------------------------------
// High-value player -> range stays sensible
// ---------------------------------------------------------------------

test('high-value player: range does not explode arbitrarily', () => {
  const t = tier({ median: 60, min: 55, max: 68, samples: 4 });
  const r = computeLeagueAdjustedValueRange({
    position: 'RB', sleeperProjection: 60,
    tierAggregates: aggregates({ RB: [t] }), inflationFactor: 1,
  });
  // Widen should be modest -- projection agrees with tier center, and
  // samples>=3 means no sparse-widening kicks in. Should stay close to
  // the raw tier band.
  assert.equal(r.center, 60);
  assert.ok(r.low >= 50, `low should stay near tier min, got ${r.low}`);
  assert.ok(r.high <= 75, `high should not blow past tier max, got ${r.high}`);
});

// ---------------------------------------------------------------------
// Sparse historical data -> widen
// ---------------------------------------------------------------------

test('sparse samples (< 3) widens the range', () => {
  const wellSampled = tier({ median: 34, min: 32, max: 36, samples: 8 });
  const sparse = tier({ median: 34, min: 32, max: 36, samples: 1 });
  const rWell = computeLeagueAdjustedValueRange({
    position: 'RB', sleeperProjection: 34,
    tierAggregates: aggregates({ RB: [wellSampled] }), inflationFactor: 1,
  });
  const rSparse = computeLeagueAdjustedValueRange({
    position: 'RB', sleeperProjection: 34,
    tierAggregates: aggregates({ RB: [sparse] }), inflationFactor: 1,
  });
  const wellWidth = rWell.high - rWell.low;
  const sparseWidth = rSparse.high - rSparse.low;
  assert.ok(sparseWidth > wellWidth,
    `sparse width (${sparseWidth}) should exceed well-sampled width (${wellWidth})`);
});

// ---------------------------------------------------------------------
// Projection diverges -> widen
// ---------------------------------------------------------------------

test('projection diverges from tier median (>25%) widens the range', () => {
  const t = tier({ median: 20, min: 18, max: 22, samples: 5 });
  // Player is projected at $30 but the closest tier is $20 -- projection
  // strongly disagrees with history.
  const rDiverge = computeLeagueAdjustedValueRange({
    position: 'WR', sleeperProjection: 30,
    tierAggregates: aggregates({ WR: [t] }), inflationFactor: 1,
  });
  const rAgree = computeLeagueAdjustedValueRange({
    position: 'WR', sleeperProjection: 20,
    tierAggregates: aggregates({ WR: [t] }), inflationFactor: 1,
  });
  const wDiv = rDiverge.high - rDiverge.low;
  const wAgree = rAgree.high - rAgree.low;
  assert.ok(wDiv > wAgree,
    `diverging projection should widen range (div=${wDiv} vs agree=${wAgree})`);
});

// ---------------------------------------------------------------------
// Inflation applies to both endpoints
// ---------------------------------------------------------------------

test('inflation lifts both low and high proportionally', () => {
  const t = tier({ median: 30, min: 28, max: 34, samples: 5 });
  const r1 = computeLeagueAdjustedValueRange({
    position: 'WR', sleeperProjection: 30,
    tierAggregates: aggregates({ WR: [t] }), inflationFactor: 1,
  });
  const r2 = computeLeagueAdjustedValueRange({
    position: 'WR', sleeperProjection: 30,
    tierAggregates: aggregates({ WR: [t] }), inflationFactor: 1.2,
  });
  assert.ok(r2.center > r1.center, 'inflation raises center');
  assert.ok(r2.low > r1.low, 'inflation raises low');
  assert.ok(r2.high > r1.high, 'inflation raises high');
});

// ---------------------------------------------------------------------
// Minimum half-width
// ---------------------------------------------------------------------

test('tight tier (min == median == max) still gets a non-degenerate range for non-trivial value', () => {
  const t = tier({ median: 20, min: 20, max: 20, samples: 5 });
  const r = computeLeagueAdjustedValueRange({
    position: 'RB', sleeperProjection: 20,
    tierAggregates: aggregates({ RB: [t] }), inflationFactor: 1,
  });
  assert.ok(r.high > r.low, 'tight tier should still open up a range via min half-width');
  assert.equal(r.center, 20);
});

// ---------------------------------------------------------------------
// Invariant: low <= center <= high across everything
// ---------------------------------------------------------------------

test('low <= center <= high invariant across a random-ish sweep', () => {
  const cases = [
    { median: 1, min: 1, max: 1, samples: 1, proj: 1 },
    { median: 5, min: 4, max: 6, samples: 2, proj: 12 },
    { median: 15, min: 12, max: 18, samples: 4, proj: 15 },
    { median: 40, min: 35, max: 45, samples: 8, proj: 40 },
    { median: 60, min: 55, max: 68, samples: 3, proj: 80 },
  ];
  for (const c of cases) {
    const t = tier({ median: c.median, min: c.min, max: c.max, samples: c.samples });
    const r = computeLeagueAdjustedValueRange({
      position: 'RB', sleeperProjection: c.proj,
      tierAggregates: aggregates({ RB: [t] }), inflationFactor: 1.1,
    });
    assert.ok(r);
    assert.ok(r.low <= r.center, `low (${r.low}) <= center (${r.center}) for ${JSON.stringify(c)}`);
    assert.ok(r.center <= r.high, `center (${r.center}) <= high (${r.high}) for ${JSON.stringify(c)}`);
    assert.ok(r.low >= 1);
  }
});

// ---------------------------------------------------------------------
// Backward compatibility with the scalar function (spec §18)
// ---------------------------------------------------------------------

test('scalar computeLeagueAdjustedValue returns the same number as range.center', () => {
  const t = tier({ median: 34, min: 30, max: 38, samples: 5 });
  const scalar = computeLeagueAdjustedValue({
    position: 'RB', sleeperProjection: 34,
    tierAggregates: aggregates({ RB: [t] }), inflationFactor: 1.15,
  });
  const range = computeLeagueAdjustedValueRange({
    position: 'RB', sleeperProjection: 34,
    tierAggregates: aggregates({ RB: [t] }), inflationFactor: 1.15,
  });
  assert.equal(scalar, range.center,
    `scalar ${scalar} should match range.center ${range.center}`);
});

// ---------------------------------------------------------------------
// Multi-tier lookup: closest-median tier wins
// ---------------------------------------------------------------------

test('multi-tier: player anchors on the closest-median tier', () => {
  const tiers = [
    tier({ median: 55, min: 50, max: 60, samples: 4, tierIndex: 0 }),
    tier({ median: 32, min: 28, max: 36, samples: 5, tierIndex: 1 }),
    tier({ median: 12, min: 10, max: 15, samples: 6, tierIndex: 2 }),
  ];
  // Projection $34 -> closest to tier index 1 (median 32).
  const r = computeLeagueAdjustedValueRange({
    position: 'RB', sleeperProjection: 34,
    tierAggregates: aggregates({ RB: tiers }), inflationFactor: 1,
  });
  assert.equal(r.center, 32);
  assert.ok(r.low >= 20 && r.low <= 32, `expected mid-tier low, got ${r.low}`);
  assert.equal(r.sourceTier, 1);
});

// ---------------------------------------------------------------------
// Roster-aware engine round-trips the range (spec §17, §8)
// ---------------------------------------------------------------------

test('bidEngine round-trips fairValueRange from input to output', () => {
  const engine = require('../utils/bidEngine.js');
  const pool = { players: [{ name: 'A', position: 'RB', projection: 30, isDrafted: false }] };
  const you = {
    manager: 'me', maxBid: 100, budgetRemaining: 100,
    roster: [], openSlots: ['QB','RB','RB','WR','WR','TE','FLEX','BN','BN'],
  };
  const r = engine.computeYourMax({
    nom: { position: 'RB', playerName: 'HENRY', sleeperProjection: 40 },
    fairValue: 34,
    fairValueRange: { low: 30, center: 34, high: 38 },
    currentBid: 1,
    you, teams: [you],
    draft: { settings: { slots_qb:1, slots_rb:2, slots_wr:2, slots_te:1, slots_flex:1, slots_bn:6 } },
    pool,
  });
  assert.ok(r);
  assert.deepEqual(r.fairValueRange, { low: 30, center: 34, high: 38 });
});

test('bidEngine: Your Max is NOT clamped to top of range (spec §8)', () => {
  const engine = require('../utils/bidEngine.js');
  const pool = { players: [{ name: 'A', position: 'RB', projection: 30, isDrafted: false }] };
  // High need + healthy budget: Your Max should be allowed to exceed the
  // fair-value range's top.
  const you = {
    manager: 'me', maxBid: 180, budgetRemaining: 200,
    roster: [], openSlots: ['QB','RB','RB','WR','WR','TE','FLEX','BN','BN'],
  };
  const r = engine.computeYourMax({
    nom: { position: 'RB', playerName: 'HENRY', sleeperProjection: 40 },
    fairValue: 34,
    fairValueRange: { low: 30, center: 34, high: 38 },
    currentBid: 1,
    you, teams: [you],
    draft: { settings: { slots_qb:1, slots_rb:2, slots_wr:2, slots_te:1, slots_flex:1, slots_bn:6 } },
    pool,
    scarcity: { level: 'HIGH' },
  });
  // Roster +18% + scarcity +10% = ~28% lift on $34 -> ~$43. Well above the
  // range top of $38. Anything even at or above $38 proves the point.
  assert.ok(r.recommendedMax > r.fairValueRange.high,
    `Your Max ${r.recommendedMax} should exceed range top ${r.fairValueRange.high} — the range is context, not a cap`);
});

test('bidEngine synthesizes single-point range when caller omits it', () => {
  const engine = require('../utils/bidEngine.js');
  const pool = { players: [] };
  const you = {
    manager: 'me', maxBid: 100, budgetRemaining: 100,
    roster: [], openSlots: ['QB','RB','RB','WR','WR','TE','FLEX','BN','BN'],
  };
  const r = engine.computeYourMax({
    nom: { position: 'RB', playerName: 'X', sleeperProjection: 30 },
    fairValue: 30, currentBid: 1,
    you, teams: [you],
    draft: { settings: { slots_qb:1, slots_rb:2, slots_wr:2, slots_te:1, slots_flex:1, slots_bn:6 } },
    pool,
  });
  assert.ok(r);
  assert.equal(r.fairValueRange.low, 30);
  assert.equal(r.fairValueRange.center, 30);
  assert.equal(r.fairValueRange.high, 30);
});
