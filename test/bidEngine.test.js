// Roster-aware Maximum Bid Engine tests.
// Run: node --test test/bidEngine.test.js
//
// Covers the requirements from the spec:
//   - Fair value vs Your Max distinction (§2)
//   - Roster-slot-aware need, NOT positional ownership (§4, §21 Henry problem)
//   - Superflex opens QB / RB / WR / TE (§5, §20)
//   - Opportunity cost changes the max even at same fair value (§7, §22, §23)
//   - Scarcity influences max only when the player fits (§10)
//   - Alternatives (strong / weak replacement depth) shift max (§9)
//   - Competition modestly influences but doesn't force overpays (§11)
//   - Budget capacity respected; never recommend > legal ceiling (§8, §15)
//   - Current bid drives BUY / CAUTION / PASS ladder (§16)
//   - Various league formats work without hard-coded assumptions (§20)
//   - Edge cases per §30

const test = require('node:test');
const assert = require('node:assert/strict');

const engine = require('../utils/bidEngine.js');

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

function stdSettings() {
  // 1QB, 2RB, 2WR, 1TE, 1FLEX (RB/WR/TE), 6 BN. 12 teams.
  return { slots_qb: 1, slots_rb: 2, slots_wr: 2, slots_te: 1, slots_flex: 1, slots_bn: 6 };
}

function sfSettings() {
  // Superflex: 1QB, 2RB, 2WR, 1TE, 1FLEX, 1SUPER_FLEX, 6 BN.
  return { slots_qb: 1, slots_rb: 2, slots_wr: 2, slots_te: 1, slots_flex: 1, slots_super_flex: 1, slots_bn: 6 };
}

function noFlexSettings() {
  // No FLEX, no SUPER_FLEX: 1QB, 2RB, 2WR, 1TE, 6 BN.
  return { slots_qb: 1, slots_rb: 2, slots_wr: 2, slots_te: 1, slots_bn: 6 };
}

// A large-ish pool that gives requiredFuture something to chew on.
function stdPool() {
  const players = [];
  let id = 0;
  const push = (name, position, projection) => {
    players.push({ name, position, projection, isDrafted: false, id: id++ });
  };
  // QBs
  for (let i = 0; i < 20; i++) push(`QB${i}`, 'QB', 30 - i);
  // RBs
  for (let i = 0; i < 40; i++) push(`RB${i}`, 'RB', 45 - i);
  // WRs
  for (let i = 0; i < 40; i++) push(`WR${i}`, 'WR', 40 - i);
  // TEs
  for (let i = 0; i < 20; i++) push(`TE${i}`, 'TE', 22 - i);
  // Ks, DEFs
  for (let i = 0; i < 10; i++) push(`K${i}`, 'K', 3);
  for (let i = 0; i < 10; i++) push(`DEF${i}`, 'DEF', 3);
  return { players };
}

function team(overrides) {
  return Object.assign({
    manager: 'Test',
    maxBid: 100,
    budgetRemaining: 100,
    rosterCount: 0,
    roster: [],
    openSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
  }, overrides || {});
}

function nom(position, name, projection) {
  return {
    position,
    playerName: name,
    sleeperProjection: projection,
    topBid: 1,
  };
}

// Baseline `you` with a fresh roster in standard format.
function freshYou(overrides) { return team(overrides); }

// ---------------------------------------------------------------------
// Sanity: computeYourMax returns null when inputs are missing
// ---------------------------------------------------------------------

test('returns null without nom', () => {
  const r = engine.computeYourMax({ fairValue: 30, you: freshYou(), draft: { settings: stdSettings() } });
  assert.equal(r, null);
});

test('returns null without you (unidentified user)', () => {
  const r = engine.computeYourMax({
    nom: nom('RB', 'X', 30), fairValue: 30, draft: { settings: stdSettings() },
  });
  assert.equal(r, null);
});

test('returns null without startingSlots derivable', () => {
  const r = engine.computeYourMax({
    nom: nom('RB', 'X', 30), fairValue: 30, you: freshYou(),
  });
  assert.equal(r, null);
});

test('returns null with non-positive fairValue', () => {
  const r = engine.computeYourMax({
    nom: nom('RB', 'X', 30), fairValue: 0, you: freshYou(), draft: { settings: stdSettings() },
  });
  assert.equal(r, null);
});

// ---------------------------------------------------------------------
// §21 The Henry Problem: RB1 filled, RB2/FLEX open. Player must still
// register as HIGH need.
// ---------------------------------------------------------------------

test('Henry problem: RB1 filled, RB2/FLEX open -> HIGH need, meaningful lift', () => {
  const pool = stdPool();
  const you = freshYou({
    // RB1 slot filled by a mid-tier RB.
    roster: [{ name: 'RB0', position: 'RB', amount: 30 }],
    openSlots: ['QB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
    budgetRemaining: 170,
    maxBid: 158,
  });
  const r = engine.computeYourMax({
    nom: nom('RB', 'HENRY', 40), // strong RB projection
    fairValue: 35,
    currentBid: 1,
    you,
    teams: [you],
    draft: { settings: stdSettings() },
    pool,
  });
  assert.ok(r, 'result should be produced');
  assert.equal(r.rosterNeed.tone, 'high', 'RB1 filled + RB2/FLEX open should be HIGH need');
  assert.ok(r.recommendedMax > r.fairValue, `expected max ($${r.recommendedMax}) > fairValue ($${r.fairValue})`);
  assert.equal(r.recommendation, 'BUY');
});

// ---------------------------------------------------------------------
// §19 Do NOT auto-pass just because a position is filled.
// ---------------------------------------------------------------------

test('does NOT auto-pass when the primary position slot is filled but FLEX is open', () => {
  const pool = stdPool();
  const you = freshYou({
    // Both RB slots filled; FLEX still open.
    roster: [
      { name: 'RB0', position: 'RB', amount: 30 },
      { name: 'RB1', position: 'RB', amount: 25 },
    ],
    openSlots: ['QB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
    budgetRemaining: 145,
    maxBid: 134,
  });
  const r = engine.computeYourMax({
    nom: nom('RB', 'HENRY', 40),
    fairValue: 35,
    currentBid: 1,
    you,
    teams: [you],
    draft: { settings: stdSettings() },
    pool,
  });
  assert.notEqual(r.recommendation, 'PASS', 'should not PASS when FLEX can absorb this RB');
});

// ---------------------------------------------------------------------
// §5 Superflex: QB gets extra strategic value with SUPER_FLEX open.
// ---------------------------------------------------------------------

test('QB in superflex league with SUPER_FLEX open scores higher than in 1QB league', () => {
  const pool = stdPool();
  const youSf = freshYou({
    // Empty roster; superflex league has SUPER_FLEX slot open.
    openSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
    budgetRemaining: 200, maxBid: 187,
  });
  const rSf = engine.computeYourMax({
    nom: nom('QB', 'ELITE_QB', 35), fairValue: 30, currentBid: 1,
    you: youSf, teams: [youSf], draft: { settings: sfSettings() }, pool,
  });
  const youStd = freshYou({ budgetRemaining: 200, maxBid: 187 });
  const rStd = engine.computeYourMax({
    nom: nom('QB', 'ELITE_QB', 35), fairValue: 30, currentBid: 1,
    you: youStd, teams: [youStd], draft: { settings: stdSettings() }, pool,
  });
  // Both should be BUY, but SF should push a higher max.
  assert.ok(rSf.recommendedMax >= rStd.recommendedMax,
    `SF max ($${rSf.recommendedMax}) should be >= 1QB max ($${rStd.recommendedMax})`);
});

test('QB in 1QB league with QB slot already filled -> LOW/NONE need', () => {
  const pool = stdPool();
  const you = freshYou({
    roster: [{ name: 'QB0', position: 'QB', amount: 20 }],
    openSlots: ['RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
    budgetRemaining: 180, maxBid: 169,
  });
  const r = engine.computeYourMax({
    nom: nom('QB', 'BACKUP_QB', 20), fairValue: 15, currentBid: 1,
    you, teams: [you], draft: { settings: stdSettings() }, pool,
  });
  // Not superflex, QB slot filled -> not a lineup upgrade.
  assert.ok(r.rosterNeed.tone === 'low' || r.rosterNeed.tone === 'none',
    `expected low/none need, got ${r.rosterNeed.tone}`);
  assert.ok(r.recommendedMax < r.fairValue,
    `bench-only QB should max ($${r.recommendedMax}) below fairValue ($${r.fairValue})`);
});

// ---------------------------------------------------------------------
// §7, §22, §23 Opportunity cost — same player, different rosters.
// ---------------------------------------------------------------------

test('opportunity cost cuts max when many starter slots remain vs few', () => {
  const pool = stdPool();
  const fair = 35;
  // Tight: $55 remaining, 5 open slots including QB/RB/WR/FLEX + BN.
  const tightYou = freshYou({
    roster: [
      { name: 'RB0', position: 'RB', amount: 30 },
    ],
    openSlots: ['QB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN'],
    budgetRemaining: 55, maxBid: 49,
  });
  // Loose: $80 remaining, 4 open slots, only WR/FLEX/2 BN.
  const looseYou = freshYou({
    roster: [
      { name: 'QB0', position: 'QB', amount: 20 },
      { name: 'RB0', position: 'RB', amount: 25 },
      { name: 'RB1', position: 'RB', amount: 15 },
      { name: 'WR0', position: 'WR', amount: 20 },
      { name: 'TE0', position: 'TE', amount: 10 },
    ],
    openSlots: ['WR', 'FLEX', 'BN', 'BN'],
    budgetRemaining: 80, maxBid: 77,
  });
  const rTight = engine.computeYourMax({
    nom: nom('RB', 'BIG_RB', 40), fairValue: fair, currentBid: 1,
    you: tightYou, teams: [tightYou], draft: { settings: stdSettings() }, pool,
  });
  const rLoose = engine.computeYourMax({
    nom: nom('RB', 'BIG_RB', 40), fairValue: fair, currentBid: 1,
    you: looseYou, teams: [looseYou], draft: { settings: stdSettings() }, pool,
  });
  assert.ok(rLoose.recommendedMax > rTight.recommendedMax,
    `loose ($${rLoose.recommendedMax}) should exceed tight ($${rTight.recommendedMax}) — opportunity cost`);
  assert.ok(rTight.budgetPressure.tone === 'high' || rTight.budgetPressure.tone === 'moderate',
    `expected elevated pressure for tight roster, got ${rTight.budgetPressure.tone}`);
});

// ---------------------------------------------------------------------
// §10 Scarcity — only lifts max when the player fits.
// ---------------------------------------------------------------------

test('critical scarcity lifts max when need is high but NOT when RB slots already filled', () => {
  const pool = stdPool();
  const fair = 30;
  const scarcity = { level: 'CRITICAL', comparableRemaining: 1, isTierBreak: true };
  // Need: RB2/FLEX open, high need.
  const needy = freshYou({
    roster: [{ name: 'RB0', position: 'RB', amount: 30 }],
    openSlots: ['QB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN'],
    budgetRemaining: 150, maxBid: 143,
  });
  // Full at RB — bench-only role.
  const full = freshYou({
    roster: [
      { name: 'RB0', position: 'RB', amount: 30 },
      { name: 'RB1', position: 'RB', amount: 25 },
      { name: 'WR0', position: 'WR', amount: 20 },
      { name: 'WR1', position: 'WR', amount: 15 },
      { name: 'TE0', position: 'TE', amount: 10 },
      { name: 'QB0', position: 'QB', amount: 15 },
      { name: 'RB2', position: 'RB', amount: 12 }, // fills FLEX
    ],
    openSlots: ['BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
    budgetRemaining: 100, maxBid: 95,
  });
  const rNeedy = engine.computeYourMax({
    nom: nom('RB', 'RARE_RB', 40), fairValue: fair, currentBid: 1,
    you: needy, teams: [needy], draft: { settings: stdSettings() }, pool, scarcity,
  });
  const rFull = engine.computeYourMax({
    nom: nom('RB', 'RARE_RB', 40), fairValue: fair, currentBid: 1,
    you: full, teams: [full], draft: { settings: stdSettings() }, pool, scarcity,
  });
  assert.ok(rNeedy.scarcity.dollars > 0, `needy scarcity dollars should be positive, got ${rNeedy.scarcity.dollars}`);
  // Full team: scarcity should NOT push max above fair value; the player
  // doesn't help start.
  assert.ok(rFull.recommendedMax < rNeedy.recommendedMax,
    `scarcity should not overrule roster reality (full ${rFull.recommendedMax} vs needy ${rNeedy.recommendedMax})`);
});

// ---------------------------------------------------------------------
// §9 Alternatives / replacement depth
// ---------------------------------------------------------------------

test('strong replacement depth trims max; weak lifts it', () => {
  const pool = stdPool();
  const you = freshYou({
    roster: [{ name: 'RB0', position: 'RB', amount: 30 }],
    openSlots: ['QB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN'],
    budgetRemaining: 150, maxBid: 143,
  });
  const base = {
    nom: nom('RB', 'X', 40), fairValue: 30, currentBid: 1,
    you, teams: [you], draft: { settings: stdSettings() }, pool,
  };
  const rStrong = engine.computeYourMax(Object.assign({}, base, {
    alternatives: { replacementContext: { replacementDepth: 'strong' } },
  }));
  const rWeak = engine.computeYourMax(Object.assign({}, base, {
    alternatives: { replacementContext: { replacementDepth: 'weak' } },
  }));
  assert.ok(rWeak.recommendedMax > rStrong.recommendedMax,
    `weak-alt max ($${rWeak.recommendedMax}) should exceed strong-alt max ($${rStrong.recommendedMax})`);
});

// ---------------------------------------------------------------------
// §11 Competition — modest influence, not auto-overpay.
// ---------------------------------------------------------------------

test('competition modestly nudges max but does not force overpay', () => {
  const pool = stdPool();
  const you = freshYou({
    roster: [{ name: 'RB0', position: 'RB', amount: 30 }],
    openSlots: ['QB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN'],
    budgetRemaining: 150, maxBid: 143,
  });
  const rivals = [
    freshYou({ manager: 'A', maxBid: 60, budgetRemaining: 60, openSlots: ['RB', 'FLEX', 'BN'] }),
    freshYou({ manager: 'B', maxBid: 55, budgetRemaining: 55, openSlots: ['RB', 'FLEX', 'BN'] }),
    freshYou({ manager: 'C', maxBid: 50, budgetRemaining: 50, openSlots: ['RB', 'FLEX', 'BN'] }),
  ];
  const rLots = engine.computeYourMax({
    nom: nom('RB', 'X', 40), fairValue: 30, currentBid: 1,
    you, teams: [you].concat(rivals),
    draft: { settings: stdSettings() }, pool,
  });
  const rNone = engine.computeYourMax({
    nom: nom('RB', 'X', 40), fairValue: 30, currentBid: 1,
    you, teams: [you], draft: { settings: stdSettings() }, pool,
  });
  // Competition should lift, but by less than $5 at fairValue $30.
  const diff = rLots.recommendedMax - rNone.recommendedMax;
  assert.ok(diff >= 0 && diff <= 5,
    `competition adjust should be modest, got diff of $${diff}`);
});

// ---------------------------------------------------------------------
// §15, §8 Budget capacity — never exceed maxLegal.
// ---------------------------------------------------------------------

test('never recommends more than remainingBudget - $1 per other open slot', () => {
  const pool = stdPool();
  const you = freshYou({
    roster: [],
    openSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
    budgetRemaining: 20, maxBid: 8, // 12 other slots -> maxLegal ~ 8
  });
  const r = engine.computeYourMax({
    nom: nom('RB', 'X', 40), fairValue: 35, currentBid: 1,
    you, teams: [you], draft: { settings: stdSettings() }, pool,
  });
  assert.ok(r.recommendedMax <= r.budgetPressure.maxLegal,
    `max ($${r.recommendedMax}) must not exceed legal ($${r.budgetPressure.maxLegal})`);
  assert.ok(r.recommendedMax >= 1);
});

// ---------------------------------------------------------------------
// §16 Current-bid ladder: BUY / CAUTION / PASS
// ---------------------------------------------------------------------

test('BUY when currentBid comfortably below max', () => {
  const d = engine._ladder(40, 20);
  assert.equal(d.recommendation, 'BUY');
  assert.equal(d.remainingValue, 20);
});

test('CAUTION when currentBid approaches max but not over', () => {
  const d = engine._ladder(40, 38);
  assert.equal(d.recommendation, 'CAUTION');
  assert.equal(d.remainingValue, 2);
});

test('PASS when currentBid exceeds max', () => {
  const d = engine._ladder(40, 42);
  assert.equal(d.recommendation, 'PASS');
  assert.equal(d.remainingValue, -2);
});

test('end-to-end: recommendation transitions BUY -> CAUTION -> PASS as currentBid climbs', () => {
  const pool = stdPool();
  const you = freshYou({
    roster: [{ name: 'RB0', position: 'RB', amount: 30 }],
    openSlots: ['QB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN'],
    budgetRemaining: 150, maxBid: 143,
  });
  const base = {
    nom: nom('RB', 'X', 40), fairValue: 30,
    you, teams: [you], draft: { settings: stdSettings() }, pool,
  };
  const rLow = engine.computeYourMax(Object.assign({}, base, { currentBid: 5 }));
  const yourMax = rLow.recommendedMax;
  const rMid = engine.computeYourMax(Object.assign({}, base, { currentBid: yourMax }));
  const rOver = engine.computeYourMax(Object.assign({}, base, { currentBid: yourMax + 3 }));
  assert.equal(rLow.recommendation, 'BUY');
  assert.equal(rMid.recommendation, 'CAUTION');
  assert.equal(rOver.recommendation, 'PASS');
  assert.equal(rOver.remainingValue, -3);
});

// ---------------------------------------------------------------------
// §20 League format independence
// ---------------------------------------------------------------------

test('no-flex league still returns valid recommendation', () => {
  const pool = stdPool();
  const you = freshYou({
    openSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
    budgetRemaining: 200, maxBid: 188,
  });
  const r = engine.computeYourMax({
    nom: nom('RB', 'X', 40), fairValue: 30, currentBid: 1,
    you, teams: [you], draft: { settings: noFlexSettings() }, pool,
  });
  assert.ok(r);
  assert.equal(r.rosterNeed.tone, 'high');
});

test('classify boundaries match spec ratio thresholds', () => {
  assert.equal(engine._classifyNeed(0.9), 'high');
  assert.equal(engine._classifyNeed(0.60), 'high');
  assert.equal(engine._classifyNeed(0.30), 'moderate');
  assert.equal(engine._classifyNeed(0.10), 'low');
  assert.equal(engine._classifyNeed(0), 'none');
});

// ---------------------------------------------------------------------
// §30 Edge cases
// ---------------------------------------------------------------------

test('$1 player, currentBid $1: never returns 0 or negative', () => {
  const pool = stdPool();
  const you = freshYou({
    openSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN'],
    budgetRemaining: 10, maxBid: 2,
  });
  const r = engine.computeYourMax({
    nom: nom('K', 'CHEAP', 1), fairValue: 1, currentBid: 1,
    you, teams: [you], draft: { settings: stdSettings() }, pool,
  });
  assert.ok(r.recommendedMax >= 1);
});

test('one remaining roster spot: legality respected', () => {
  const pool = stdPool();
  // Only one open slot -> maxLegal = full remainingBudget.
  const you = freshYou({
    roster: Array.from({ length: 12 }, (_, i) => ({ name: 'F' + i, position: 'RB', amount: 5 })),
    openSlots: ['BN'],
    budgetRemaining: 50, maxBid: 50,
  });
  const r = engine.computeYourMax({
    nom: nom('RB', 'LATE', 20), fairValue: 20, currentBid: 1,
    you, teams: [you], draft: { settings: stdSettings() }, pool,
  });
  assert.ok(r.recommendedMax <= 50);
  assert.ok(r.recommendedMax >= 1);
});

test('missing pool -> lower confidence but still returns a result', () => {
  const you = freshYou({ budgetRemaining: 200, maxBid: 187 });
  const r = engine.computeYourMax({
    nom: nom('RB', 'X', 40), fairValue: 30, currentBid: 1,
    you, teams: [you], draft: { settings: stdSettings() },
    // no pool
  });
  assert.ok(r);
  assert.equal(r.confidence, 'low');
});

test('missing scarcity + alternatives -> medium/low confidence, still produces max', () => {
  const pool = stdPool();
  const you = freshYou({ budgetRemaining: 200, maxBid: 187 });
  const r = engine.computeYourMax({
    nom: nom('RB', 'X', 40), fairValue: 30, currentBid: 1,
    you, teams: [you], draft: { settings: stdSettings() }, pool,
    // no scarcity, no alternatives
  });
  assert.ok(r);
  assert.equal(r.confidence, 'low'); // both missing => >=2 missing => 'low'
  assert.ok(r.recommendedMax > 0);
});

test('multi-position eligibility: RB/WR player fits RB and FLEX', () => {
  const pool = stdPool();
  // Add a dual-eligibility player to the pool for lookup.
  pool.players.push({ name: 'DUAL', position: 'RB', projection: 20, isDrafted: false, eligiblePositions: ['RB', 'WR'] });
  const you = freshYou({
    roster: [{ name: 'RB0', position: 'RB', amount: 30 }, { name: 'RB1', position: 'RB', amount: 25 }],
    openSlots: ['QB', 'WR', 'WR', 'TE', 'FLEX', 'BN'],
    budgetRemaining: 130, maxBid: 125,
  });
  const r = engine.computeYourMax({
    // The nominee itself only registers as RB in the observer; but the
    // pool entry for someone WITH the same name declares dual eligibility.
    // The engine picks up eligibility from the roster-side pool lookup
    // and from the nom's own eligiblePositions[] if present.
    nom: Object.assign(nom('RB', 'DUAL2', 25), { eligiblePositions: ['RB', 'WR'] }),
    fairValue: 20, currentBid: 1,
    you, teams: [you], draft: { settings: stdSettings() }, pool,
  });
  // WR/FLEX open + RB/WR player -> should register as a lineup upgrade.
  assert.ok(r.rosterNeed.tone !== 'none',
    `dual-eligibility player should fill WR/FLEX, got ${r.rosterNeed.tone}`);
});

test('insufficient budget for full-roster: spendable calc keeps max low', () => {
  const pool = stdPool();
  const you = freshYou({
    roster: [],
    openSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
    budgetRemaining: 60, maxBid: 48, // very tight for 13 slots
  });
  const r = engine.computeYourMax({
    nom: nom('RB', 'EXPENSIVE', 45), fairValue: 40, currentBid: 1,
    you, teams: [you], draft: { settings: stdSettings() }, pool,
  });
  // With ~$45+ needed for 6 other starters and 6 benches, spendable is
  // squeezed. Max should be well below fairValue.
  assert.ok(r.recommendedMax < 40,
    `tight budget should keep max ($${r.recommendedMax}) below fairValue ($40)`);
  assert.equal(r.budgetPressure.tone !== 'none', true);
});

// ---------------------------------------------------------------------
// The two invariants that make the whole thing coherent
// ---------------------------------------------------------------------

test('invariant: fairValue is exposed and distinct from recommendedMax', () => {
  const pool = stdPool();
  const you = freshYou({
    roster: [{ name: 'RB0', position: 'RB', amount: 30 }],
    openSlots: ['QB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN'],
    budgetRemaining: 150, maxBid: 143,
  });
  const r = engine.computeYourMax({
    nom: nom('RB', 'X', 40), fairValue: 35, currentBid: 1,
    you, teams: [you], draft: { settings: stdSettings() }, pool,
    scarcity: { level: 'HIGH' },
  });
  assert.equal(r.fairValue, 35);
  assert.notEqual(r.fairValue, r.recommendedMax,
    'a healthy need + scarcity scenario should split fairValue and recommendedMax');
});

test('invariant: recommendedMax responds monotonically to opportunity cost', () => {
  const pool = stdPool();
  const mk = (budget) => freshYou({
    roster: [{ name: 'RB0', position: 'RB', amount: 30 }],
    openSlots: ['QB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN'],
    budgetRemaining: budget, maxBid: budget - 6,
  });
  const rich = engine.computeYourMax({
    nom: nom('RB', 'X', 40), fairValue: 30, currentBid: 1,
    you: mk(150), teams: [mk(150)], draft: { settings: stdSettings() }, pool,
  });
  const poor = engine.computeYourMax({
    nom: nom('RB', 'X', 40), fairValue: 30, currentBid: 1,
    you: mk(50), teams: [mk(50)], draft: { settings: stdSettings() }, pool,
  });
  assert.ok(rich.recommendedMax >= poor.recommendedMax,
    `rich max ($${rich.recommendedMax}) should >= poor max ($${poor.recommendedMax})`);
});
