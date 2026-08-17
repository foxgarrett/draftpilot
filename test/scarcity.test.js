// Positional scarcity engine tests.
// Run: node --test test/scarcity.test.js
//
// Verifies the acceptance criteria from the scarcity spec:
//   - deep pool -> LOW scarcity
//   - shallow pool -> HIGH / CRITICAL scarcity
//   - large drop-off after top players -> HIGH even when count is decent
//   - flat distribution -> lower scarcity than a cliff of the same count
//   - superflex boosts QB scarcity vs. 1-QB
//   - starting lineup requirements change teamsStillNeeding

const test = require('node:test');
const assert = require('node:assert/strict');

const analysis = require('../utils/analysis.js');
const { computePositionalScarcity, startersPerTeamAtPosition } = analysis;

// --- Shape / basic guards -------------------------------------------------

test('returns null when position missing', () => {
  assert.equal(computePositionalScarcity({ availableProjections: [10, 8] }), null);
});

test('empty availability + no anchor => CRITICAL', () => {
  const r = computePositionalScarcity({ position: 'RB', availableProjections: [] });
  assert.equal(r.level, 'CRITICAL');
  assert.equal(r.score, 100);
  assert.equal(r.comparableRemaining, 0);
});

test('score is bounded [0,100] and level tracks thresholds', () => {
  const r = computePositionalScarcity({
    position: 'WR',
    availableProjections: Array.from({ length: 40 }, (_, i) => 100 - i * 0.5),
    anchorProjection: 100,
    teamsStillNeeding: 6,
  });
  assert.ok(r.score >= 0 && r.score <= 100);
  assert.ok(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(r.level));
});

// --- Deep pool -> LOW ----------------------------------------------------

test('deep player pool with many comparables => LOW scarcity', () => {
  const projections = Array.from({ length: 30 }, (_, i) => 100 - i * 0.5); // very flat, 30 players
  const r = computePositionalScarcity({
    position: 'WR',
    availableProjections: projections,
    anchorProjection: 100,
    teamsStillNeeding: 4,
  });
  assert.equal(r.level, 'LOW', `expected LOW, got ${r.level} (score ${r.score})`);
  // Every one of the 30 is within 80% of 100 (all >= 80).
  assert.ok(r.comparableRemaining >= 20);
});

// --- Shallow pool -> HIGH / CRITICAL ------------------------------------

test('extremely shallow pool with many needy teams => HIGH or CRITICAL', () => {
  const r = computePositionalScarcity({
    position: 'RB',
    availableProjections: [50, 48],
    anchorProjection: 50,
    teamsStillNeeding: 8,
  });
  assert.ok(r.level === 'HIGH' || r.level === 'CRITICAL',
    `expected HIGH/CRITICAL, got ${r.level} (score ${r.score})`);
});

test('only the nominated player is comparable => scarcity spikes', () => {
  const r = computePositionalScarcity({
    position: 'RB',
    availableProjections: [80, 30, 28, 27, 26], // huge cliff after #1
    anchorProjection: 80,
    teamsStillNeeding: 5,
  });
  assert.ok(r.score >= 50, `expected >=50, got ${r.score}`);
  assert.equal(r.comparableRemaining, 1); // only the 80 clears 0.8 * 80 = 64
});

// --- Large drop-off after top players -----------------------------------

test('big cliff after top-3 => HIGH scarcity even with plenty in the pool', () => {
  // 3 elite + 20 replacement-level. Total count is deep, but comparable
  // count is thin, so scarcity should NOT read as low.
  const scores = [90, 88, 86, ...Array.from({ length: 20 }, (_, i) => 30 - i * 0.5)];
  const r = computePositionalScarcity({
    position: 'WR',
    availableProjections: scores,
    anchorProjection: 90,
    teamsStillNeeding: 6,
  });
  assert.ok(r.level === 'HIGH' || r.level === 'CRITICAL',
    `cliff should register HIGH/CRITICAL, got ${r.level} (score ${r.score})`);
  assert.equal(r.comparableRemaining, 3);
});

// --- Flat distribution --------------------------------------------------

test('flat distribution scores LOWER than the same count of cliff players', () => {
  const flat = computePositionalScarcity({
    position: 'WR',
    availableProjections: [50, 49, 48, 47, 46, 45, 44, 43],
    anchorProjection: 50,
    teamsStillNeeding: 6,
  });
  const cliff = computePositionalScarcity({
    position: 'WR',
    availableProjections: [50, 20, 19, 18, 17, 16, 15, 14],
    anchorProjection: 50,
    teamsStillNeeding: 6,
  });
  assert.ok(flat.score < cliff.score,
    `flat=${flat.score} should be < cliff=${cliff.score}`);
});

// --- Format / lineup requirements ---------------------------------------

test('more starters required at position increases scarcity', () => {
  const base = {
    position: 'RB',
    availableProjections: [60, 55, 50, 45, 40, 38, 36, 34, 32, 30],
    anchorProjection: 60,
    format: { teamCount: 12, rosterSlots: { RB: 2, WR: 2, TE: 1, FLEX: 1 } },
    draftedAtPosition: 0,
  };
  const heavyRB = Object.assign({}, base, {
    format: { teamCount: 12, rosterSlots: { RB: 3, WR: 2, TE: 1, FLEX: 1 } },
  });
  const a = computePositionalScarcity(base);
  const b = computePositionalScarcity(heavyRB);
  assert.ok(b.score >= a.score,
    `heavier RB requirement should not lower scarcity (base=${a.score}, heavy=${b.score})`);
});

test('superflex boosts QB scarcity vs. 1-QB (same pool + team count)', () => {
  const projections = [30, 28, 25, 22, 20, 18, 16, 14, 12, 10, 8, 6];
  const oneQB = computePositionalScarcity({
    position: 'QB',
    availableProjections: projections,
    anchorProjection: 30,
    format: { teamCount: 12, rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1 } },
    draftedAtPosition: 0,
  });
  const superflex = computePositionalScarcity({
    position: 'QB',
    availableProjections: projections,
    anchorProjection: 30,
    format: {
      teamCount: 12,
      rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPER_FLEX: 1 },
      isSuperflex: true,
    },
    draftedAtPosition: 0,
  });
  assert.ok(superflex.score > oneQB.score,
    `superflex QB scarcity (${superflex.score}) should exceed 1-QB (${oneQB.score})`);
});

test('startersPerTeamAtPosition splits FLEX and SUPER_FLEX', () => {
  const slots = { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, SUPER_FLEX: 1 };
  const rb = startersPerTeamAtPosition(slots, 'RB');
  const wr = startersPerTeamAtPosition(slots, 'WR');
  const qb = startersPerTeamAtPosition(slots, 'QB');
  // RB: 2 base + 0.4 FLEX + 0.1 SUPER_FLEX = 2.5
  assert.equal(rb, 2.5);
  assert.equal(wr, 3.5);
  // QB gets 70% of SUPER_FLEX.
  assert.ok(Math.abs(qb - 1.7) < 1e-9);
});

// --- Draft progression --------------------------------------------------

test('draftedAtPosition reduces demand, lowering scarcity', () => {
  const scores = [60, 55, 50, 45, 40, 38, 36, 34, 32, 30];
  const early = computePositionalScarcity({
    position: 'RB',
    availableProjections: scores,
    anchorProjection: 60,
    format: { teamCount: 12, rosterSlots: { RB: 2, WR: 2, TE: 1, FLEX: 1 } },
    draftedAtPosition: 0,
  });
  const late = computePositionalScarcity({
    position: 'RB',
    availableProjections: scores,
    anchorProjection: 60,
    format: { teamCount: 12, rosterSlots: { RB: 2, WR: 2, TE: 1, FLEX: 1 } },
    draftedAtPosition: 18, // most starter RBs already gone from demand pool
  });
  assert.ok(late.score <= early.score,
    `later draft with less demand should not increase scarcity (early=${early.score}, late=${late.score})`);
});

// --- Missing / bad inputs -----------------------------------------------

test('gracefully handles null/zero projections in input', () => {
  const r = computePositionalScarcity({
    position: 'WR',
    availableProjections: [80, null, 0, 40, undefined, -5, 30],
    anchorProjection: 80,
    teamsStillNeeding: 4,
  });
  assert.equal(r.availableCount, 3); // only 80, 40, 30 survive
  assert.ok(r.score >= 0 && r.score <= 100);
});

test('missing anchor falls back to top of pool', () => {
  const r = computePositionalScarcity({
    position: 'RB',
    availableProjections: [50, 45, 40, 20, 18, 16],
    teamsStillNeeding: 3,
  });
  // Top = 50, threshold = 40 -> comparable = [50, 45, 40] = 3
  assert.equal(r.comparableRemaining, 3);
});

test('teamsStillNeeding of zero yields low supply pressure', () => {
  const r = computePositionalScarcity({
    position: 'K',
    availableProjections: [10, 9, 8, 7],
    anchorProjection: 10,
    teamsStillNeeding: 0,
  });
  assert.equal(r.signals.supply, 0);
});

// --- Reason text --------------------------------------------------------

test('reason string mentions position and is non-empty', () => {
  const r = computePositionalScarcity({
    position: 'TE',
    availableProjections: [30, 12, 11, 10, 9, 8],
    anchorProjection: 30,
    teamsStillNeeding: 5,
  });
  assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
  assert.ok(r.reason.includes('TE'), `expected reason to mention TE: "${r.reason}"`);
});
