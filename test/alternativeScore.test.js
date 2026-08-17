// Alternative Score engine tests.
// Run: node --test test/alternativeScore.test.js
//
// Covers spec §27:
//   - high vs. low similarity
//   - production gap dominates
//   - supply-vs-demand scarcity affects the read
//   - roster fit differences shift scores
//   - playoff / consistency handled by omit-and-renormalize
//   - a cheaper player is NOT automatically preferred
//   - draft-state changes remove drafted candidates
//   - missing data does not break the score
//   - superflex QB scenario
//   - candidate ranking + minimum-score floor
//   - configurable weights produce predictable movement

const test = require('node:test');
const assert = require('node:assert/strict');

const analysis = require('../utils/analysis.js');
const {
  computeAlternativeScore,
  computeAlternativeCandidates,
  computePositionalScarcity,
  computeValueCliff,
  ALTERNATIVE_SCORE_WEIGHTS,
} = analysis;

const scarcityFor = (projs, anchor, teamsStillNeeding) =>
  computePositionalScarcity({
    position: 'RB',
    availableProjections: projs,
    anchorProjection: anchor,
    teamsStillNeeding,
  });

const cliffFor = (projs, anchor) =>
  computeValueCliff({ availableProjections: projs, anchorProjection: anchor });

// ---------------------------------------------------------------------------
// computeAlternativeScore
// ---------------------------------------------------------------------------

test('high similarity: near-identical production scores >= 90', () => {
  const projs = [280, 278, 275, 260, 250];
  const s = scarcityFor(projs, 280, 4);
  const c = cliffFor(projs, 280);
  const r = computeAlternativeScore({
    nom: { position: 'RB', projection: 280 },
    candidate: { position: 'RB', projection: 275 },
    scarcity: s, cliff: c,
  });
  assert.ok(r.alternativeScore >= 90, `expected >=90, got ${r.alternativeScore}`);
  assert.equal(r.componentScores.production, 100); // within peer tolerance
});

test('low similarity: substantially worse production scores low', () => {
  const projs = [280, 240, 200, 170, 150];
  const s = scarcityFor(projs, 280, 4);
  const c = cliffFor(projs, 280);
  const r = computeAlternativeScore({
    nom: { position: 'RB', projection: 280 },
    candidate: { position: 'RB', projection: 170 }, // ~60% of nominee
    scarcity: s, cliff: c,
  });
  assert.ok(r.alternativeScore < 45, `expected <45, got ${r.alternativeScore}`);
});

test('production gap: 10% below >> 25% below', () => {
  const projs = [280, 260, 240, 220, 200];
  const s = scarcityFor(projs, 280, 4);
  const c = cliffFor(projs, 280);
  const small = computeAlternativeScore({
    nom: { position: 'RB', projection: 280 },
    candidate: { position: 'RB', projection: 252 }, // 10% below
    scarcity: s, cliff: c,
  });
  const big = computeAlternativeScore({
    nom: { position: 'RB', projection: 280 },
    candidate: { position: 'RB', projection: 210 }, // 25% below
    scarcity: s, cliff: c,
  });
  assert.ok(small.alternativeScore > big.alternativeScore + 15,
    `small=${small.alternativeScore} big=${big.alternativeScore}`);
});

test('missing consistency + playoff: weights renormalize, score still 0..100', () => {
  const projs = [200, 195, 190, 180];
  const s = scarcityFor(projs, 200, 4);
  const c = cliffFor(projs, 200);
  const r = computeAlternativeScore({
    nom: { position: 'WR', projection: 200 },
    candidate: { position: 'WR', projection: 195 },
    scarcity: s, cliff: c,
  });
  assert.equal(r.componentScores.consistency, null);
  assert.equal(r.componentScores.playoff, null);
  assert.ok(r.alternativeScore > 0 && r.alternativeScore <= 100);
  // Active weights should sum to 1.
  const sum = Object.values(r.activeWeights).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `active weights sum = ${sum}`);
});

test('consistency present: worse consistency lowers score', () => {
  const projs = [200, 195, 190];
  const s = scarcityFor(projs, 200, 4);
  const c = cliffFor(projs, 200);
  const same = computeAlternativeScore({
    nom: { position: 'WR', projection: 200, consistency: 0.8 },
    candidate: { position: 'WR', projection: 195, consistency: 0.8 },
    scarcity: s, cliff: c,
  });
  const worse = computeAlternativeScore({
    nom: { position: 'WR', projection: 200, consistency: 0.8 },
    candidate: { position: 'WR', projection: 195, consistency: 0.4 },
    scarcity: s, cliff: c,
  });
  assert.ok(worse.alternativeScore < same.alternativeScore);
});

test('playoff present: better outlook improves score modestly', () => {
  const projs = [200, 195, 190];
  const s = scarcityFor(projs, 200, 4);
  const c = cliffFor(projs, 200);
  const nom = { position: 'WR', projection: 200, playoff: 0.5 };
  const equal = computeAlternativeScore({
    nom, candidate: { position: 'WR', projection: 195, playoff: 0.5 },
    scarcity: s, cliff: c,
  });
  const better = computeAlternativeScore({
    nom, candidate: { position: 'WR', projection: 195, playoff: 0.7 },
    scarcity: s, cliff: c,
  });
  assert.ok(better.alternativeScore >= equal.alternativeScore);
  // But playoff must not overwhelm production: a big production gap
  // with a great playoff outlook still loses to a peer.
  const peerBad = computeAlternativeScore({
    nom, candidate: { position: 'WR', projection: 130, playoff: 0.9 },
    scarcity: s, cliff: c,
  });
  assert.ok(better.alternativeScore > peerBad.alternativeScore + 20);
});

// ---------------------------------------------------------------------------
// Weights are configurable + deterministic
// ---------------------------------------------------------------------------

test('weight config: raising production weight amplifies production penalty', () => {
  const projs = [200, 160, 150];
  const s = scarcityFor(projs, 200, 4);
  const c = cliffFor(projs, 200);
  const nom = { position: 'WR', projection: 200 };
  const cand = { position: 'WR', projection: 160 };
  const base = computeAlternativeScore({ nom, candidate: cand, scarcity: s, cliff: c });
  const heavyProd = computeAlternativeScore({
    nom, candidate: cand, scarcity: s, cliff: c,
    weights: { ...ALTERNATIVE_SCORE_WEIGHTS, production: 0.80 },
  });
  // Production score is < 100 here; heavier weight should drag total DOWN.
  assert.ok(heavyProd.alternativeScore < base.alternativeScore,
    `base=${base.alternativeScore} heavyProd=${heavyProd.alternativeScore}`);
});

test('deterministic: identical inputs -> identical outputs', () => {
  const projs = [200, 190, 180, 175, 160];
  const s = scarcityFor(projs, 200, 4);
  const c = cliffFor(projs, 200);
  const a = computeAlternativeScore({
    nom: { position: 'WR', projection: 200 },
    candidate: { position: 'WR', projection: 190 },
    scarcity: s, cliff: c,
  });
  const b = computeAlternativeScore({
    nom: { position: 'WR', projection: 200 },
    candidate: { position: 'WR', projection: 190 },
    scarcity: s, cliff: c,
  });
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------------------
// computeAlternativeCandidates: ranking + draft state + auction context
// ---------------------------------------------------------------------------

function makePool(players) {
  return { players: players.map((p) => ({ isDrafted: false, ...p })) };
}

test('candidates: ranks by alternativeScore, excludes the nominee and drafted', () => {
  const pool = makePool([
    { name: 'Nominee',       position: 'RB', projection: 280 },
    { name: 'Peer A',        position: 'RB', projection: 275 },
    { name: 'Peer B',        position: 'RB', projection: 268 },
    { name: 'Peer C',        position: 'RB', projection: 260 },
    { name: 'Weak',          position: 'RB', projection: 160 },
    { name: 'DraftedGuy',    position: 'RB', projection: 279, isDrafted: true },
  ]);
  const projs = pool.players.filter((p) => !p.isDrafted && p.name !== 'Nominee').map((p) => p.projection);
  const scarcity = scarcityFor([280, ...projs], 280, 4);
  const cliff = cliffFor([280, ...projs], 280);

  const r = computeAlternativeCandidates({
    nom: { name: 'Nominee', position: 'RB', projection: 280 },
    pool, picks: [], scarcity, cliff,
  });
  const names = r.candidates.map((c) => c.name);
  assert.ok(!names.includes('Nominee'));
  assert.ok(!names.includes('DraftedGuy'));
  // Should be sorted by score desc; the three top peers dominate Weak.
  assert.equal(names[0], 'Peer A');
});

test('candidates: draft-state changes remove drafted alternatives', () => {
  const players = [
    { name: 'Nominee', position: 'RB', projection: 280 },
    { name: 'Peer A',  position: 'RB', projection: 275 },
    { name: 'Peer B',  position: 'RB', projection: 270 },
    { name: 'Peer C',  position: 'RB', projection: 265 },
  ];
  const pool = makePool(players);
  const scarcity = scarcityFor([280, 275, 270, 265], 280, 4);
  const cliff = cliffFor([280, 275, 270, 265], 280);
  const before = computeAlternativeCandidates({
    nom: players[0], pool, picks: [], scarcity, cliff,
  });
  const picks = [{ metadata: { first_name: 'Peer', last_name: 'A', position: 'RB' } }];
  const after = computeAlternativeCandidates({
    nom: players[0], pool, picks, scarcity, cliff,
  });
  assert.ok(before.candidates.some((c) => c.name === 'Peer A'));
  assert.ok(!after.candidates.some((c) => c.name === 'Peer A'));
});

test('cheap does NOT out-score strong: auction $ is context only', () => {
  const players = [
    { name: 'Nominee', position: 'RB', projection: 280, leagueValue: 40 },
    { name: 'Strong',  position: 'RB', projection: 275, leagueValue: 38 },
    { name: 'Cheap',   position: 'RB', projection: 200, leagueValue: 12 },
  ];
  const pool = makePool(players);
  const scarcity = scarcityFor([280, 275, 200], 280, 4);
  const cliff = cliffFor([280, 275, 200], 280);
  const r = computeAlternativeCandidates({
    nom: players[0], pool, picks: [], scarcity, cliff,
    nomLeagueValue: 40,
    leagueAdjustedValueOf: (p) => p.leagueValue,
  });
  const strong = r.candidates.find((c) => c.name === 'Strong');
  const cheap = r.candidates.find((c) => c.name === 'Cheap');
  assert.ok(strong.alternativeScore > cheap.alternativeScore,
    `strong=${strong.alternativeScore} cheap=${cheap.alternativeScore}`);
  // Auction context still exposes the cheaper delta.
  assert.equal(cheap.auctionContext.priceAdvantage, 'cheaper');
  assert.equal(cheap.auctionContext.valueDifference, 28);
});

test('roster fit: no open slots at candidate position -> score cratered', () => {
  const players = [
    { name: 'Nominee', position: 'RB', projection: 280 },
    { name: 'Peer',    position: 'RB', projection: 275 },
  ];
  const pool = makePool(players);
  const scarcity = scarcityFor([280, 275], 280, 4);
  const cliff = cliffFor([280, 275], 280);
  const you = { openSlots: [], roster: [] };
  const openSlotsForPosition = () => 0;
  const r = computeAlternativeCandidates({
    nom: players[0], pool, picks: [], scarcity, cliff,
    you, openSlotsForPosition,
  });
  const peer = r.candidates.find((c) => c.name === 'Peer');
  assert.equal(peer.componentScores.rosterFit, 0);
  // With rosterFit at 0 the composite score still exists but is dragged
  // down vs. the no-you baseline.
  const baseline = computeAlternativeCandidates({
    nom: players[0], pool, picks: [], scarcity, cliff,
  });
  const peerBase = baseline.candidates.find((c) => c.name === 'Peer');
  assert.ok(peer.alternativeScore < peerBase.alternativeScore);
});

test('supply vs. demand: same alt reads different when demand shifts', () => {
  const projs = [280, 270, 260, 250, 240];
  const cliff = cliffFor(projs, 280);
  const lowDemand = scarcityFor(projs, 280, 2);   // 2 teams needing
  const highDemand = scarcityFor(projs, 280, 8);  // 8 teams needing
  const nom = { position: 'RB', projection: 280 };
  const cand = { position: 'RB', projection: 250 };
  const low = computeAlternativeScore({ nom, candidate: cand, scarcity: lowDemand, cliff });
  const hi  = computeAlternativeScore({ nom, candidate: cand, scarcity: highDemand, cliff });
  // Different scarcity read -> different scarcity component. Production
  // is identical, so the composite must differ.
  assert.notEqual(low.componentScores.scarcity, hi.componentScores.scarcity);
});

test('candidate floor: weak-only pool returns short list, not padded false positives', () => {
  const players = [
    { name: 'Nominee', position: 'RB', projection: 300 },
    { name: 'Weak1',   position: 'RB', projection: 155 },
    { name: 'Weak2',   position: 'RB', projection: 150 },
    { name: 'Weak3',   position: 'RB', projection: 145 },
  ];
  const pool = makePool(players);
  const scarcity = scarcityFor([300, 155, 150, 145], 300, 4);
  const cliff = cliffFor([300, 155, 150, 145], 300);
  const r = computeAlternativeCandidates({
    nom: players[0], pool, picks: [], scarcity, cliff,
    minScore: 60, // force the floor
  });
  // All candidates are far below floor; the engine returns the top few
  // for context but they must all be under the floor and none must be
  // synthesized to inflate the count.
  assert.ok(r.candidates.length <= 3);
  r.candidates.forEach((c) => {
    assert.ok(c.alternativeScore < 60, `${c.name} score ${c.alternativeScore} >= floor`);
  });
});

test('replacement depth: strong when several high-quality alts remain', () => {
  const players = [
    { name: 'Nominee', position: 'RB', projection: 280 },
    { name: 'A', position: 'RB', projection: 275 },
    { name: 'B', position: 'RB', projection: 272 },
    { name: 'C', position: 'RB', projection: 268 },
    { name: 'D', position: 'RB', projection: 260 },
  ];
  const pool = makePool(players);
  const projs = players.map((p) => p.projection);
  const scarcity = scarcityFor(projs, 280, 4);
  const cliff = cliffFor(projs, 280);
  const r = computeAlternativeCandidates({
    nom: players[0], pool, picks: [], scarcity, cliff,
  });
  assert.equal(r.replacementContext.replacementDepth, 'strong');
  assert.equal(r.recommendationContext.passingRisk, 'low');
});

test('replacement depth: weak when only one comparable and rest cliff', () => {
  const players = [
    { name: 'Nominee', position: 'RB', projection: 280 },
    { name: 'A', position: 'RB', projection: 260 },
    { name: 'B', position: 'RB', projection: 155 },
    { name: 'C', position: 'RB', projection: 150 },
  ];
  const pool = makePool(players);
  const projs = players.map((p) => p.projection);
  const scarcity = scarcityFor(projs, 280, 6);
  const cliff = cliffFor(projs, 280);
  const r = computeAlternativeCandidates({
    nom: players[0], pool, picks: [], scarcity, cliff,
  });
  assert.notEqual(r.replacementContext.replacementDepth, 'strong');
  assert.ok(['weak', 'moderate'].includes(r.replacementContext.replacementDepth));
});

test('superflex QB stays QB-eligible only (crossPosition guarded)', () => {
  const players = [
    { name: 'Nom QB',  position: 'QB', projection: 400 },
    { name: 'Peer QB', position: 'QB', projection: 390 },
    { name: 'Top RB',  position: 'RB', projection: 300 },
  ];
  const pool = makePool(players);
  const scarcity = scarcityFor([400, 390], 400, 8);
  const cliff = cliffFor([400, 390], 400);
  const r = computeAlternativeCandidates({
    nom: players[0], pool, picks: [], scarcity, cliff,
    crossPosition: true, format: { isSuperflex: true, teamCount: 12 },
  });
  const names = r.candidates.map((c) => c.name);
  assert.ok(names.includes('Peer QB'));
  assert.ok(!names.includes('Top RB'));
});

test('missing pool -> empty candidate list, no crash', () => {
  const r = computeAlternativeCandidates({
    nom: { name: 'X', position: 'RB', projection: 200 },
  });
  assert.deepEqual(r.candidates, []);
  assert.equal(r.recommendationContext.passingRisk, 'high');
});

test('auction context: nominee/alt values present, delta correct sign', () => {
  const players = [
    { name: 'Nominee', position: 'RB', projection: 280, leagueValue: 40 },
    { name: 'Cheaper', position: 'RB', projection: 275, leagueValue: 30 },
    { name: 'Pricier', position: 'RB', projection: 278, leagueValue: 45 },
  ];
  const pool = makePool(players);
  const projs = players.map((p) => p.projection);
  const scarcity = scarcityFor(projs, 280, 4);
  const cliff = cliffFor(projs, 280);
  const r = computeAlternativeCandidates({
    nom: players[0], pool, picks: [], scarcity, cliff,
    nomLeagueValue: 40, leagueAdjustedValueOf: (p) => p.leagueValue,
  });
  const cheaper = r.candidates.find((c) => c.name === 'Cheaper');
  const pricier = r.candidates.find((c) => c.name === 'Pricier');
  assert.equal(cheaper.auctionContext.valueDifference, 10);
  assert.equal(cheaper.auctionContext.priceAdvantage, 'cheaper');
  assert.equal(pricier.auctionContext.valueDifference, -5);
  assert.equal(pricier.auctionContext.priceAdvantage, 'more_expensive');
});
