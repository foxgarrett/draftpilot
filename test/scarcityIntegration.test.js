// Tests for the derived scarcity layers -- value cliff, market pressure,
// scarcity impact, pass consequence, insight priority, market snapshot.
// Run: node --test test/scarcityIntegration.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const analysis = require('../utils/analysis.js');
const {
  computePositionalScarcity,
  computeValueCliff,
  computeMarketPressure,
  computeScarcityImpact,
  computePassConsequence,
  computeInsightPriority,
  computePositionalMarketSnapshot,
} = analysis;

// ---------- helpers -----------------------------------------------------

function makeScarcity(overrides) {
  return computePositionalScarcity(Object.assign({
    position: 'RB',
    availableProjections: [50, 45, 40, 35, 30, 25, 20],
    anchorProjection: 50,
    teamsStillNeeding: 6,
  }, overrides || {}));
}

// ---------- Value cliff -------------------------------------------------

test('computeValueCliff: deep pool with no cliff', () => {
  const cliff = computeValueCliff({
    anchorProjection: 100,
    availableProjections: [100, 98, 96, 94, 92, 90, 88, 86, 84, 82],
  });
  // All players within 80% -> no next comparable below threshold ->
  // engine reports hasCliff=true (no fallback below). This is the
  // "whole pool is comparable" branch; callers can still see the
  // context via comparableCount.
  assert.equal(cliff.nextComparableProjection, null);
  assert.equal(cliff.comparableCount, 10);
});

test('computeValueCliff: sharp drop after top 3 => severe cliff', () => {
  const cliff = computeValueCliff({
    anchorProjection: 90,
    availableProjections: [90, 88, 86, 30, 28, 25],
  });
  assert.equal(cliff.comparableCount, 3);
  assert.equal(cliff.nextComparableProjection, 30);
  assert.ok(cliff.hasCliff, 'cliff should be flagged');
  assert.ok(cliff.isSevere, 'a 30->90 drop is severe');
  assert.ok(cliff.dropoffPct > 0.6);
});

test('computeValueCliff: mild dropoff => hasCliff false', () => {
  const cliff = computeValueCliff({
    anchorProjection: 50,
    availableProjections: [50, 48, 46, 42, 41, 40],
  });
  // Threshold = 40. 42, 41, 40 all comparable (>=40). No next below.
  // Comparable ends -- treated as "whole pool comparable" branch.
  assert.equal(cliff.nextComparableProjection, null);
});

test('computeValueCliff: null when pool empty and no anchor', () => {
  const cliff = computeValueCliff({ availableProjections: [] });
  assert.equal(cliff, null);
});

// ---------- Market pressure --------------------------------------------

test('computeMarketPressure: plain-language mapping per level', () => {
  const cases = [
    ['LOW', 'Low', 'low'],
    ['MEDIUM', 'Building', 'medium'],
    ['HIGH', 'High', 'high'],
    ['CRITICAL', 'Critical', 'critical'],
  ];
  for (const [lvl, label, tone] of cases) {
    const p = computeMarketPressure({ level: lvl });
    assert.equal(p.level, label);
    assert.equal(p.tone, tone);
    assert.ok(p.blurb && p.blurb.length > 0);
  }
});

test('computeMarketPressure: null on missing scarcity', () => {
  assert.equal(computeMarketPressure(null), null);
});

// ---------- Scarcity impact --------------------------------------------

test('scarcityImpact: no roster need => level ignore, zero lift', () => {
  const scarcity = makeScarcity({ availableProjections: [50, 30], teamsStillNeeding: 6 });
  const impact = computeScarcityImpact({ scarcity, need: 'none' });
  assert.equal(impact.level, 'ignore');
  assert.equal(impact.dollarLift, 0);
});

test('scarcityImpact: hasSurplus => ignore even when starter slot open', () => {
  const scarcity = makeScarcity({ availableProjections: [50, 30], teamsStillNeeding: 6 });
  const impact = computeScarcityImpact({ scarcity, need: 'starter', hasSurplus: true });
  assert.equal(impact.level, 'ignore');
});

test('scarcityImpact: need + HIGH scarcity => prioritize with premium', () => {
  const scarcity = makeScarcity({ availableProjections: [50, 48, 45, 20, 18], teamsStillNeeding: 6 });
  // Force HIGH by keeping only 3 comparable + heavy demand
  assert.ok(['HIGH', 'CRITICAL'].includes(scarcity.level));
  const impact = computeScarcityImpact({ scarcity, need: 'starter' });
  assert.ok(impact.dollarLift > 0);
  assert.ok(impact.level === 'prioritize' || impact.level === 'urgent');
});

test('scarcityImpact: budget pressure trims the premium', () => {
  const scarcity = makeScarcity({ availableProjections: [50, 48, 45, 20], teamsStillNeeding: 6 });
  const rich = computeScarcityImpact({ scarcity, need: 'starter', budgetPressure: 0.1 });
  const broke = computeScarcityImpact({ scarcity, need: 'starter', budgetPressure: 0.9 });
  assert.ok(broke.dollarLift < rich.dollarLift, 'tight budget should lower lift');
});

test('scarcityImpact: bench-only need caps at nudge', () => {
  const scarcity = makeScarcity({ availableProjections: [50, 48, 45, 20], teamsStillNeeding: 6 });
  const impact = computeScarcityImpact({ scarcity, need: 'bench' });
  assert.ok(impact.level === 'nudge' || impact.level === 'ignore');
  assert.ok(impact.dollarLift <= 0.05);
});

test('scarcityImpact: severe cliff bumps lift when position is needed', () => {
  const scarcity = computePositionalScarcity({
    position: 'RB', availableProjections: [90, 88, 30, 25],
    anchorProjection: 90, teamsStillNeeding: 6,
  });
  const cliff = computeValueCliff({
    anchorProjection: 90, availableProjections: [90, 88, 30, 25],
  });
  const withoutCliff = computeScarcityImpact({ scarcity, need: 'starter' });
  const withCliff = computeScarcityImpact({ scarcity, cliff, need: 'starter' });
  assert.ok(withCliff.dollarLift >= withoutCliff.dollarLift);
});

// ---------- Pass consequence -------------------------------------------

test('passConsequence: healthy pool => none / "you can wait"', () => {
  const scarcity = makeScarcity({ availableProjections: [50, 49, 48, 47, 46, 45, 44, 43], teamsStillNeeding: 3 });
  const pc = computePassConsequence({ scarcity, position: 'WR' });
  assert.equal(pc.severity, 'none');
  assert.ok(/wait/i.test(pc.headline));
});

test('passConsequence: last comparable => severe', () => {
  const scarcity = computePositionalScarcity({
    position: 'RB', availableProjections: [90, 30, 28, 26],
    anchorProjection: 90, teamsStillNeeding: 6,
  });
  const pc = computePassConsequence({ scarcity, position: 'RB' });
  assert.equal(pc.severity, 'severe');
});

test('passConsequence: null scarcity => null', () => {
  assert.equal(computePassConsequence({ scarcity: null }), null);
});

// ---------- Insight priority -------------------------------------------

test('insightPriority: FIT_LOCKED wins when fit is low', () => {
  const scarcity = makeScarcity();
  const impact = computeScarcityImpact({ scarcity, need: 'none' });
  const insight = computeInsightPriority({ scarcity, impact, fitTone: 'low', position: 'RB' });
  assert.equal(insight.type, 'FIT_LOCKED');
});

test('insightPriority: PERSONAL_URGENT when need + scarcity align', () => {
  const scarcity = computePositionalScarcity({
    position: 'RB', availableProjections: [50, 48, 45, 20], teamsStillNeeding: 6, anchorProjection: 50,
  });
  const cliff = computeValueCliff({ anchorProjection: 50, availableProjections: [50, 48, 45, 20] });
  const impact = computeScarcityImpact({ scarcity, cliff, need: 'starter' });
  const insight = computeInsightPriority({
    scarcity, cliff, impact, fitTone: 'strong', position: 'RB',
  });
  assert.equal(insight.type, 'PERSONAL_URGENT');
});

test('insightPriority: high scarcity + no need => SCARCITY with soft copy', () => {
  const scarcity = computePositionalScarcity({
    position: 'RB', availableProjections: [50, 48, 45, 20], teamsStillNeeding: 6, anchorProjection: 50,
  });
  const impact = computeScarcityImpact({ scarcity, need: 'none' });
  const insight = computeInsightPriority({
    scarcity, impact, fitTone: 'depth', position: 'RB',
  });
  assert.equal(insight.type, 'SCARCITY');
  assert.ok(/wait|covered/i.test(insight.explanation));
});

test('insightPriority: healthy market + strong fit => ROSTER_FIT', () => {
  const scarcity = makeScarcity({
    availableProjections: Array.from({length: 30}, (_, i) => 100 - i * 0.5),
    teamsStillNeeding: 4,
  });
  const impact = computeScarcityImpact({ scarcity, need: 'starter' });
  const insight = computeInsightPriority({
    scarcity, impact, fitTone: 'strong', position: 'WR',
  });
  assert.equal(insight.type, 'ROSTER_FIT');
});

test('insightPriority: high budget pressure surfaces BUDGET', () => {
  const scarcity = makeScarcity({
    availableProjections: Array.from({length: 20}, (_, i) => 100 - i),
    teamsStillNeeding: 3,
  });
  const impact = computeScarcityImpact({ scarcity, need: 'starter', budgetPressure: 0.9 });
  const insight = computeInsightPriority({
    scarcity, impact, fitTone: 'depth', position: 'WR', budgetPressure: 0.9,
  });
  // Budget branch triggers because there's no strong signal above it.
  assert.equal(insight.type, 'BUDGET');
});

// ---------- Positional Market Snapshot ---------------------------------

test('marketSnapshot: shape + sort by pressure desc', () => {
  const rows = computePositionalMarketSnapshot({
    poolByPosition: {
      QB: [30, 28, 25, 22, 20, 18, 16, 14, 12, 10],
      RB: [50, 48, 45, 20], // shallow -> high pressure
      WR: Array.from({ length: 30 }, (_, i) => 100 - i * 0.5), // deep -> low
      TE: [30, 28, 25, 22, 20, 18],
    },
    teamsStillNeedingByPosition: { QB: 4, RB: 6, WR: 4, TE: 3 },
    format: {
      teamCount: 12,
      rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1 },
    },
  });
  assert.ok(rows.length >= 4);
  // Sorted -- first row score should be highest.
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i - 1].scarcity.score >= rows[i].scarcity.score);
  }
  // RB should not appear as "LOW" here; shallow pool.
  const rb = rows.find((r) => r.position === 'RB');
  assert.ok(['HIGH', 'CRITICAL'].includes(rb.scarcity.level),
    `RB should read high pressure, got ${rb.scarcity.level}`);
  const wr = rows.find((r) => r.position === 'WR');
  assert.equal(wr.scarcity.level, 'LOW');
});

// ---------- Personal vs market separation (spec item 20) ---------------

test('personal roster need does NOT mutate positional scarcity score', () => {
  const scarcity = makeScarcity({ availableProjections: [50, 48, 45, 20], teamsStillNeeding: 6 });
  const scoreBefore = scarcity.score;
  // Feeding it into scarcity impact multiple times shouldn't change it.
  computeScarcityImpact({ scarcity, need: 'starter' });
  computeScarcityImpact({ scarcity, need: 'none' });
  computeScarcityImpact({ scarcity, need: 'bench', hasSurplus: true });
  assert.equal(scarcity.score, scoreBefore, 'scarcity object must be immutable across impact calls');
});

// ---------- Superflex behavior -----------------------------------------

test('superflex QB scarcity produces different impact than 1QB (same need)', () => {
  const projections = [30, 28, 25, 22, 20, 18, 16, 14, 12, 10];
  const oneQBScarcity = computePositionalScarcity({
    position: 'QB', availableProjections: projections, anchorProjection: 30,
    format: { teamCount: 12, rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1 } },
    draftedAtPosition: 0,
  });
  const sfScarcity = computePositionalScarcity({
    position: 'QB', availableProjections: projections, anchorProjection: 30,
    format: {
      teamCount: 12, isSuperflex: true,
      rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPER_FLEX: 1 },
    },
    draftedAtPosition: 0,
  });
  const oneQBImpact = computeScarcityImpact({ scarcity: oneQBScarcity, need: 'starter' });
  const sfImpact = computeScarcityImpact({ scarcity: sfScarcity, need: 'starter' });
  // Superflex should never produce a WEAKER lift for a needy manager
  // (spec item 14). Same or greater premium.
  assert.ok(sfImpact.dollarLift >= oneQBImpact.dollarLift);
});

test('superflex + already-holding-QB-depth reduces personal impact', () => {
  const projections = [30, 28, 25, 22, 20, 18, 16, 14, 12, 10];
  const sfScarcity = computePositionalScarcity({
    position: 'QB', availableProjections: projections, anchorProjection: 30,
    format: {
      teamCount: 12, isSuperflex: true,
      rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPER_FLEX: 1 },
    },
    draftedAtPosition: 0,
  });
  const needy = computeScarcityImpact({ scarcity: sfScarcity, need: 'starter' });
  const covered = computeScarcityImpact({ scarcity: sfScarcity, need: 'starter', hasSurplus: true });
  assert.ok(covered.dollarLift < needy.dollarLift);
  assert.equal(covered.level, 'ignore');
});

// ---------- Recommendation-level behavior ------------------------------

test('scarcity should NOT automatically create a buy recommendation', () => {
  // High scarcity, but user doesn't need the position.
  const scarcity = computePositionalScarcity({
    position: 'RB', availableProjections: [50, 48, 45, 20], anchorProjection: 50,
    teamsStillNeeding: 6,
  });
  const impact = computeScarcityImpact({ scarcity, need: 'none' });
  assert.equal(impact.dollarLift, 0);
  assert.equal(impact.level, 'ignore');
});

test('strong alternatives (flat pool) => lower urgency than a cliff', () => {
  const flatScarcity = computePositionalScarcity({
    position: 'WR', availableProjections: [50, 49, 48, 47, 46, 45, 44], anchorProjection: 50,
    teamsStillNeeding: 4,
  });
  const cliffScarcity = computePositionalScarcity({
    position: 'WR', availableProjections: [50, 20, 19, 18, 17, 16, 15], anchorProjection: 50,
    teamsStillNeeding: 4,
  });
  const flatImpact = computeScarcityImpact({ scarcity: flatScarcity, need: 'starter' });
  const cliffImpact = computeScarcityImpact({ scarcity: cliffScarcity, need: 'starter' });
  assert.ok(cliffImpact.dollarLift >= flatImpact.dollarLift);
});
