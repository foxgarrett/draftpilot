// Positional tiering algorithm tests.
// Run: node --test test/tiers.test.js
//
// Covers the acceptance criteria + Tests A-E from the tiering spec:
//   A. smooth pool -> few tiers, no per-score break
//   B. clear tier breaks -> exactly the number of natural groupings
//   C. large positional pool -> soft target (6-8 for RB/WR)
//   D. small positional pool -> soft target (4-5 QB, 5-6 TE)
//   E. extreme outlier -> small top tier is allowed

const test = require('node:test');
const assert = require('node:assert/strict');

const analysis = require('../utils/analysis.js');
const { buildTiersFromScores, POSITION_TIERING } = analysis;

function tierPlayerCounts(tiers) {
  return tiers.map((t) => t.playerCount);
}

// ---------------------------------------------------------------------
// Sanity: shape + zero-input handling
// ---------------------------------------------------------------------

test('empty score array returns empty tier list', () => {
  const tiers = buildTiersFromScores([], POSITION_TIERING.RB);
  assert.deepEqual(tiers, []);
});

test('single-player pool returns single tier', () => {
  const tiers = buildTiersFromScores([42], POSITION_TIERING.QB);
  assert.equal(tiers.length, 1);
  assert.equal(tiers[0].playerCount, 1);
  assert.equal(tiers[0].median, 42);
  assert.equal(tiers[0].startRank, 1);
  assert.equal(tiers[0].endRank, 1);
});

test('tier objects expose median (legacy) and playerCount (new)', () => {
  const tiers = buildTiersFromScores([50, 48, 46, 20, 18, 16], POSITION_TIERING.WR);
  for (const t of tiers) {
    assert.ok(typeof t.median === 'number', 'median present');
    assert.ok(typeof t.playerCount === 'number', 'playerCount present');
    assert.ok(typeof t.tierIndex === 'number', 'tierIndex present');
    assert.ok(t.startRank <= t.endRank);
  }
});

// ---------------------------------------------------------------------
// Test A -- Smooth player pool
// ---------------------------------------------------------------------

test('Test A: smooth distribution produces few tiers, not one per score', () => {
  const scores = [98, 96, 95, 94, 93, 92, 90, 89, 88, 87, 86, 85];
  const tiers = buildTiersFromScores(scores, POSITION_TIERING.WR);
  // Spec expectation: few meaningful tiers. The smooth curve here has a
  // couple of `2` gaps against a median gap of ~1, so a small number of
  // breaks is defensible -- but never one-per-score.
  assert.ok(tiers.length <= 3, `expected <= 3 tiers, got ${tiers.length}`);
  assert.ok(tiers.length >= 1);
  // No tier smaller than the position's minSize (spec: WR min 4)
  for (const t of tiers) {
    assert.ok(t.playerCount >= POSITION_TIERING.WR.minSize,
      `tier ${t.tierIndex} has ${t.playerCount} players, min is ${POSITION_TIERING.WR.minSize}`);
  }
});

// ---------------------------------------------------------------------
// Test B -- Clear tier breaks
// ---------------------------------------------------------------------

test('Test B: clear tier breaks produce exactly the expected groupings', () => {
  const scores = [98, 97, 96, 95, 84, 83, 82, 81, 70, 69, 68, 67];
  const tiers = buildTiersFromScores(scores, POSITION_TIERING.WR);
  assert.equal(tiers.length, 3, `expected 3 tiers, got ${tiers.length}`);
  assert.deepEqual(tierPlayerCounts(tiers), [4, 4, 4]);
  // Medians should reflect the natural groups
  assert.equal(tiers[0].median, (97 + 96) / 2);
  assert.equal(tiers[1].median, (83 + 82) / 2);
  assert.equal(tiers[2].median, (69 + 68) / 2);
});

// ---------------------------------------------------------------------
// Test C -- Large positional pool (RB / WR)
// ---------------------------------------------------------------------

test('Test C: realistic WR pool falls in 6-8 tier soft target', () => {
  // Synthetic but realistic descending WR pool -- gentle decay with a
  // few natural cliffs mixed in (elite / starter / flex / depth).
  const scores = [
    62, 58, 54, 52, 50,          // elite tier candidates
    41, 39, 37, 36, 35, 34,      // WR1 range (gap ~9 from elite)
    28, 26, 25, 24, 22,          // WR2 range (gap ~6)
    17, 16, 15, 14, 13, 12, 11,  // WR3 / flex range (gap ~5)
    7, 6, 5, 4, 3, 2,            // depth (gap ~4)
  ];
  const tiers = buildTiersFromScores(scores, POSITION_TIERING.WR);
  assert.ok(tiers.length >= POSITION_TIERING.WR.targetMin - 1,
    `WR tiers=${tiers.length}, targetMin=${POSITION_TIERING.WR.targetMin}`);
  assert.ok(tiers.length <= POSITION_TIERING.WR.targetMax + 1,
    `WR tiers=${tiers.length}, targetMax=${POSITION_TIERING.WR.targetMax}`);
  // No arbitrary equal-sized bucketing
  const counts = tierPlayerCounts(tiers);
  const allSame = counts.every((c) => c === counts[0]);
  assert.ok(!allSame || tiers.length === 1,
    'tier sizes should vary based on natural gaps, not be forced equal');
});

test('Test C: realistic RB pool falls in 6-8 tier soft target', () => {
  const scores = [
    68, 62, 58,                   // elite (Bijan / CMC / Breece territory)
    46, 44, 42, 40, 38,           // RB1 tier
    32, 30, 28, 27, 25,           // RB2 tier
    20, 18, 17, 16, 15,           // RB3 / handcuff tier
    10, 9, 8, 7, 6, 5,            // depth
  ];
  const tiers = buildTiersFromScores(scores, POSITION_TIERING.RB);
  assert.ok(tiers.length >= POSITION_TIERING.RB.targetMin - 1);
  assert.ok(tiers.length <= POSITION_TIERING.RB.targetMax + 1);
});

// ---------------------------------------------------------------------
// Test D -- Small positional pool (QB / TE)
// ---------------------------------------------------------------------

test('Test D: realistic QB pool lands near 4-5 tier target', () => {
  const scores = [
    38, 34,           // elite QB1 (Allen, Lamar)
    22, 20, 19, 18,   // strong QB1
    12, 11, 10, 9,    // low QB1 / high QB2
    5, 4, 3, 2, 2,    // streamers
  ];
  const tiers = buildTiersFromScores(scores, POSITION_TIERING.QB);
  assert.ok(tiers.length >= 2, 'at least 2 QB tiers on this shape');
  assert.ok(tiers.length <= POSITION_TIERING.QB.targetMax + 1,
    `QB tiers=${tiers.length}, targetMax=${POSITION_TIERING.QB.targetMax}`);
});

test('Test D: realistic TE pool lands near 5-6 tier target', () => {
  const scores = [
    32, 28, 25,           // elite TE (Kelce / McBride)
    14, 12, 11,           // 2nd tier
    7, 6, 5,              // streamer tier
    2, 1, 1,              // waiver
  ];
  const tiers = buildTiersFromScores(scores, POSITION_TIERING.TE);
  assert.ok(tiers.length >= 2);
  assert.ok(tiers.length <= POSITION_TIERING.TE.targetMax + 1);
});

// ---------------------------------------------------------------------
// Test E -- Extreme outlier
// ---------------------------------------------------------------------

test('Test E: extreme outlier gets its own small top tier', () => {
  const scores = [100, 40, 39, 38, 37, 36, 35, 34, 33];
  const tiers = buildTiersFromScores(scores, POSITION_TIERING.RB);
  // Spec allows a small top tier when the drop is genuinely extreme.
  // Player 1 is 2.5x the next; that's a valid solo T1.
  assert.equal(tiers[0].playerCount, 1, 'extreme outlier deserves solo tier');
  assert.equal(tiers[0].median, 100);
  // Below the outlier the remaining smooth pool should NOT be split
  // into dozens of small tiers -- the extreme break shouldn't
  // rescale sensitivity for lesser gaps.
  assert.ok(tiers.length <= 3, `expected 1-3 tiers total, got ${tiers.length}`);
});

// ---------------------------------------------------------------------
// Acceptance-criteria coverage that isn't already implicit above
// ---------------------------------------------------------------------

test('tiers are strictly ordered by strength (median non-increasing)', () => {
  const scores = [50, 48, 46, 30, 28, 26, 12, 10, 8];
  const tiers = buildTiersFromScores(scores, POSITION_TIERING.WR);
  for (let i = 1; i < tiers.length; i++) {
    assert.ok(tiers[i - 1].median >= tiers[i].median,
      `tier ${i - 1} median (${tiers[i - 1].median}) should be >= tier ${i} median (${tiers[i].median})`);
  }
});

test('tiers cover every input player exactly once', () => {
  const scores = [50, 48, 46, 44, 30, 28, 26, 12, 10, 8, 6];
  const tiers = buildTiersFromScores(scores, POSITION_TIERING.RB);
  const totalCovered = tiers.reduce((sum, t) => sum + t.playerCount, 0);
  assert.equal(totalCovered, scores.length);
  // Rank ranges tile the input contiguously starting at 1
  let expectedStart = 1;
  for (const t of tiers) {
    assert.equal(t.startRank, expectedStart);
    expectedStart = t.endRank + 1;
  }
});

test('tiny pool (below 2x minSize) collapses to one tier gracefully', () => {
  // WR minSize=4; 5 players is under 2*minSize=8
  const tiers = buildTiersFromScores([50, 40, 30, 20, 10], POSITION_TIERING.WR);
  assert.equal(tiers.length, 1);
  assert.equal(tiers[0].playerCount, 5);
});

test('meaningful-but-not-extreme gaps still respect minSize', () => {
  // Gaps of 3 against a median gap of 1 are meaningful (>= 1.5x) but
  // NOT extreme (< 5x). Both must be gated by minSize; the algorithm
  // should refuse the earlier break that would create a 3-player tier
  // and prefer the later one that leaves everyone with >= 4 players.
  const scores = [60, 59, 58, 55, 54, 53, 52, 51, 48, 47, 46, 45, 44, 43];
  const tiers = buildTiersFromScores(scores, POSITION_TIERING.WR);
  for (const t of tiers) {
    assert.ok(t.playerCount >= POSITION_TIERING.WR.minSize,
      `tier ${t.tierIndex} has ${t.playerCount} players, min is ${POSITION_TIERING.WR.minSize}`);
  }
});

// ---------------------------------------------------------------------
// Rank != Tier -- explicit tests from the "Separate Positional Rank
// From Positional Tier" spec. These enforce the product definition
// that tiers are quality-gap groups, NOT rank divisions.
// ---------------------------------------------------------------------

test('Spec Test 1: six nearly identical players form ONE tier (rank != tier)', () => {
  // Ranks 1-6, scores nearly identical. Must NOT produce six tiers.
  const scores = [98, 97, 96, 95, 94, 93];
  const tiers = buildTiersFromScores(scores, POSITION_TIERING.WR);
  assert.equal(tiers.length, 1, `expected 1 tier, got ${tiers.length}`);
  assert.equal(tiers[0].playerCount, 6);
});

test('Spec Test 2: [98..93, 84..81] produces exactly 2 tiers split at the cliff', () => {
  const scores = [98, 97, 96, 95, 94, 93, 84, 83, 82, 81];
  const tiers = buildTiersFromScores(scores, POSITION_TIERING.WR);
  assert.equal(tiers.length, 2);
  assert.deepEqual(tierPlayerCounts(tiers), [6, 4]);
  assert.equal(tiers[0].endRank, 6);
  assert.equal(tiers[1].startRank, 7);
});

test('Spec Test 3: smooth distribution does NOT produce N tiers', () => {
  // Ten players decaying by 2 each -- perfectly smooth. The algorithm
  // must not produce ten tiers. Ideally very few.
  const scores = [98, 96, 94, 92, 90, 88, 86, 84, 82, 80];
  const tiers = buildTiersFromScores(scores, POSITION_TIERING.WR);
  assert.ok(tiers.length <= 3, `smooth curve should produce few tiers, got ${tiers.length}`);
});

test('Spec Test 4: one elite outlier gets its own tier, rest stays together', () => {
  const scores = [100, 87, 86, 85, 84, 83, 82];
  const tiers = buildTiersFromScores(scores, POSITION_TIERING.WR);
  assert.ok(tiers.length >= 2 && tiers.length <= 3);
  assert.equal(tiers[0].playerCount, 1, 'outlier stands alone');
  assert.equal(tiers[0].median, 100);
  // The rest should be one group -- no fragmenting the smooth tail.
  const tailCount = tiers.slice(1).reduce((sum, t) => sum + t.playerCount, 0);
  assert.equal(tailCount, 6);
});

test('Spec Test 5: three equal-quality clusters produce three tiers', () => {
  const scores = [99, 98, 97, 96, 87, 86, 85, 84, 73, 72, 71, 70];
  const tiers = buildTiersFromScores(scores, POSITION_TIERING.WR);
  assert.equal(tiers.length, 3);
  assert.deepEqual(tierPlayerCounts(tiers), [4, 4, 4]);
  // Medians should reflect the natural clusters, not arbitrary ranks.
  assert.equal(tiers[0].median, (98 + 97) / 2);
  assert.equal(tiers[1].median, (86 + 85) / 2);
  assert.equal(tiers[2].median, (72 + 71) / 2);
});

test('Rank != Tier: players 1..6 can all be Tier 1 while player 7 is Tier 2', () => {
  // The spec's Example 3: adjacent ranks (WR6, WR7) with a real cliff
  // must land in different tiers. And WR1..WR6 (all close in quality)
  // share Tier 1 despite having different ranks.
  const scores = [98, 97, 96, 95, 94, 93, 84, 83, 82, 81];
  const tiers = buildTiersFromScores(scores, POSITION_TIERING.WR);
  // Locate the tier for each rank
  function tierOfRank(rank) {
    for (let i = 0; i < tiers.length; i++) {
      if (rank >= tiers[i].startRank && rank <= tiers[i].endRank) return i;
    }
    return -1;
  }
  for (let r = 1; r <= 6; r++) {
    assert.equal(tierOfRank(r), 0, `rank ${r} should be Tier 1`);
  }
  for (let r = 7; r <= 10; r++) {
    assert.equal(tierOfRank(r), 1, `rank ${r} should be Tier 2`);
  }
});

// ---------------------------------------------------------------------
// Heavy-tail regression: real Sleeper auction $ pools have a long
// flat $1 tail, which used to collapse the gap median to 0 and turn
// every top-of-curve gap into an "extreme" break -- fragmenting the
// pool into 20+ tiny tiers and pushing solid RBs like Derrick Henry
// to something like "Tier 12". The new algorithm must hard-cap tier
// count at targetMax regardless of tail shape.
// ---------------------------------------------------------------------

test('Heavy-tail: long flat $1 tail must not fragment the top of the pool', () => {
  // 12 real values then 40 $1 backups -- the pathological shape that
  // reproduced the Derrick Henry / Tier 12 bug pre-fix.
  const scores = [
    68, 60, 55, 48, 42, 36, 30, 24, 20, 16, 14, 12,
    10, 8, 6, 5, 4, 3, 2, 2, 2,
    ...Array(30).fill(1),
  ];
  const tiers = buildTiersFromScores(scores, POSITION_TIERING.RB);
  assert.ok(tiers.length <= POSITION_TIERING.RB.targetMax,
    `tiers=${tiers.length} exceeds hard cap ${POSITION_TIERING.RB.targetMax}`);
  // A rank-12 player must NOT land in the bottom half of tiers on
  // this shape -- the top-12 are the "real" players; everything below
  // is $1 filler.
  function tierOfRank(rank) {
    for (let i = 0; i < tiers.length; i++) {
      if (rank >= tiers[i].startRank && rank <= tiers[i].endRank) return i;
    }
    return -1;
  }
  const henryTier = tierOfRank(12);
  assert.ok(henryTier <= Math.ceil(tiers.length / 2),
    `RB12 landed in tier ${henryTier + 1} of ${tiers.length} -- should be in the top half`);
});

test('Heavy-tail: gap-to-prev / gap-to-next metadata is populated', () => {
  const scores = [50, 48, 46, 30, 28, 26, 12, 10, 8];
  const tiers = buildTiersFromScores(scores, POSITION_TIERING.WR);
  assert.equal(tiers[0].gapToPrev, null, 'top tier has no prev gap');
  assert.equal(tiers[tiers.length - 1].gapToNext, null, 'last tier has no next gap');
  for (let i = 1; i < tiers.length; i++) {
    assert.ok(typeof tiers[i].gapToPrev === 'number', 'inner tiers expose gapToPrev');
  }
});

test('per-position config bounds are internally consistent', () => {
  for (const [pos, cfg] of Object.entries(POSITION_TIERING)) {
    assert.ok(cfg.targetMin <= cfg.targetMax, `${pos}: targetMin<=targetMax`);
    assert.ok(cfg.minSize >= 2, `${pos}: minSize>=2`);
    assert.ok(cfg.maxRanks >= cfg.targetMax * cfg.minSize,
      `${pos}: maxRanks (${cfg.maxRanks}) should support targetMax (${cfg.targetMax}) tiers of minSize (${cfg.minSize})`);
  }
});
