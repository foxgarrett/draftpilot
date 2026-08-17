// Slot-driven roster optimizer tests.
// Run: node --test test/rosterOptimizer.test.js
//
// Verifies the test matrix from the spec:
//   1. Standard, no Flex
//   2. Standard + Flex (RB/WR/TE)
//   3. Superflex
//   4. Superflex + Flex
//   5. 1 RB league
//   6. 3 RB league
//   7. Multiple Flex slots
//   8. 2 QB + Superflex
//   9. No Flex / No Superflex (no invented slots)
//  10. Minimal roster (nearly empty)
//  11. Nearly full roster
//
// Plus:
//   - eligibility from allowedPositions only (no hardcoded position rules)
//   - marginalValue reflects lineup improvement, not position counts
//   - Sleeper adapter emits the right slots from settings.slots_*

const test = require('node:test');
const assert = require('node:assert/strict');

const opt = require('../utils/rosterOptimizer.js');
const adapter = require('../utils/sleeperSlotAdapter.js');

// --- Helpers -------------------------------------------------------------

let nextId = 1;
function P(position, projection, extra) {
  return Object.assign({ id: 'p' + (nextId++), position, projection }, extra || {});
}

// Common eligibility maps used in slot construction below.
const ELIG = {
  QB:         ['QB'],
  RB:         ['RB'],
  WR:         ['WR'],
  TE:         ['TE'],
  FLEX_RWT:   ['RB', 'WR', 'TE'],
  FLEX_WT:    ['WR', 'TE'],
  FLEX_RW:    ['RB', 'WR'],
  SF_QRWT:    ['QB', 'RB', 'WR', 'TE'],
  QB_FLEX:    ['QB'],
};

function slot(id, allowed) { return { id, allowedPositions: allowed }; }

// Standard sample pool used across several tests.
function samplePool() {
  return [
    P('QB', 25), P('QB', 22), P('QB', 18), P('QB', 15),
    P('RB', 20), P('RB', 18), P('RB', 15), P('RB', 12), P('RB', 8),
    P('WR', 19), P('WR', 17), P('WR', 14), P('WR', 11), P('WR', 9), P('WR', 7),
    P('TE', 13), P('TE', 10), P('TE', 6),
  ];
}

// --- Test 1: Standard, no Flex -----------------------------------------

test('Test 1 — Standard no Flex: eligibility is strict, no invented flex', () => {
  const slots = [
    slot('QB', ELIG.QB),
    slot('RB', ELIG.RB), slot('RB', ELIG.RB),
    slot('WR', ELIG.WR), slot('WR', ELIG.WR),
    slot('TE', ELIG.TE),
  ];
  const players = [
    P('QB', 25),
    P('RB', 20), P('RB', 18),
    P('WR', 19), P('WR', 17),
    P('TE', 13),
    P('RB', 15),           // extra RB — must go to bench, not a flex
    P('WR', 14),           // extra WR — bench, not a flex
  ];
  const r = opt.computeOptimalLineup(slots, players);
  assert.equal(r.unfilledSlots, 0);
  assert.equal(r.totalProjection, 25 + 20 + 18 + 19 + 17 + 13);
  assert.equal(r.bench.length, 2);
  const benchProjs = r.bench.map(p => p.projection).sort((a, b) => b - a);
  assert.deepEqual(benchProjs, [15, 14]);
});

// --- Test 2: Standard + Flex ------------------------------------------

test('Test 2 — Standard + Flex (RB/WR/TE): best remaining skill goes to flex', () => {
  const slots = [
    slot('QB', ELIG.QB),
    slot('RB', ELIG.RB), slot('RB', ELIG.RB),
    slot('WR', ELIG.WR), slot('WR', ELIG.WR), slot('WR', ELIG.WR),
    slot('TE', ELIG.TE),
    slot('FLEX', ELIG.FLEX_RWT),
  ];
  const r = opt.computeOptimalLineup(slots, samplePool());
  // Optimal: QB25, RB20+18, WR19+17+14, TE13, FLEX=WR11 (best remaining
  // eligible skill among RB15, WR11, TE10) => FLEX picks RB15 actually
  // since 15 > 11 > 10. Let's compute the true optimum:
  // Start best-fill: QB25; RB slots take 20,18; WR slots take 19,17,14;
  // TE takes 13. Remaining skill: RB15, RB12, RB8, WR11, WR9, WR7, TE10, TE6.
  // FLEX picks best of these = RB15.
  assert.equal(r.totalProjection, 25 + 20 + 18 + 19 + 17 + 14 + 13 + 15);
  const flexAssign = r.assignments.find(a => a.slot.id === 'FLEX');
  assert.equal(flexAssign.player.position, 'RB');
  assert.equal(flexAssign.player.projection, 15);
});

// --- Test 3: Superflex --------------------------------------------------

test('Test 3 — Superflex: SF slot picks best QB when available', () => {
  const slots = [
    slot('QB', ELIG.QB),
    slot('RB', ELIG.RB), slot('RB', ELIG.RB),
    slot('WR', ELIG.WR), slot('WR', ELIG.WR), slot('WR', ELIG.WR),
    slot('TE', ELIG.TE),
    slot('SUPER_FLEX', ELIG.SF_QRWT),
  ];
  const r = opt.computeOptimalLineup(slots, samplePool());
  // Best QB left after QB slot takes 25 = QB22 (>= RB15, WR14, TE13 next).
  const sf = r.assignments.find(a => a.slot.id === 'SUPER_FLEX');
  assert.equal(sf.player.position, 'QB');
  assert.equal(sf.player.projection, 22);
});

// --- Test 4: Superflex + Flex ------------------------------------------

test('Test 4 — Superflex + Flex: both flex slots resolve without conflict', () => {
  const slots = [
    slot('QB', ELIG.QB),
    slot('RB', ELIG.RB), slot('RB', ELIG.RB),
    slot('WR', ELIG.WR), slot('WR', ELIG.WR), slot('WR', ELIG.WR),
    slot('TE', ELIG.TE),
    slot('FLEX', ELIG.FLEX_RWT),
    slot('SUPER_FLEX', ELIG.SF_QRWT),
  ];
  const r = opt.computeOptimalLineup(slots, samplePool());
  assert.equal(r.unfilledSlots, 0);
  // QB25 to QB, QB22 to SF (still best SF pick), FLEX to RB15 (best skill).
  const sf = r.assignments.find(a => a.slot.id === 'SUPER_FLEX');
  const fx = r.assignments.find(a => a.slot.id === 'FLEX');
  assert.equal(sf.player.projection, 22);
  assert.equal(fx.player.projection, 15);
  assert.equal(fx.player.position, 'RB');
});

// --- Test 5: 1 RB league ------------------------------------------------

test('Test 5 — 1 RB league: only one RB starts, rest bench or flex', () => {
  const slots = [
    slot('QB', ELIG.QB),
    slot('RB', ELIG.RB),
    slot('WR', ELIG.WR), slot('WR', ELIG.WR), slot('WR', ELIG.WR),
    slot('TE', ELIG.TE),
    slot('FLEX', ELIG.FLEX_RWT),
  ];
  const r = opt.computeOptimalLineup(slots, samplePool());
  const rbStarters = r.assignments.filter(a => a.slot.id === 'RB' && a.player);
  assert.equal(rbStarters.length, 1);
  assert.equal(rbStarters[0].player.projection, 20);
  // FLEX takes best remaining skill = RB18.
  const fx = r.assignments.find(a => a.slot.id === 'FLEX');
  assert.equal(fx.player.position, 'RB');
  assert.equal(fx.player.projection, 18);
});

// --- Test 6: 3 RB league ------------------------------------------------

test('Test 6 — 3 RB league: three RB slots all use RBs', () => {
  const slots = [
    slot('QB', ELIG.QB),
    slot('RB', ELIG.RB), slot('RB', ELIG.RB), slot('RB', ELIG.RB),
    slot('WR', ELIG.WR), slot('WR', ELIG.WR),
    slot('TE', ELIG.TE),
    slot('FLEX', ELIG.FLEX_RWT),
  ];
  const r = opt.computeOptimalLineup(slots, samplePool());
  const rbStarters = r.assignments.filter(a => a.slot.id === 'RB' && a.player);
  assert.equal(rbStarters.length, 3);
  const rbProjs = rbStarters.map(a => a.player.projection).sort((a, b) => b - a);
  assert.deepEqual(rbProjs, [20, 18, 15]);
});

// --- Test 7: Multiple Flex slots --------------------------------------

test('Test 7 — Multiple Flex slots: independent eligibility, both filled', () => {
  const slots = [
    slot('QB', ELIG.QB),
    slot('RB', ELIG.RB), slot('RB', ELIG.RB),
    slot('WR', ELIG.WR), slot('WR', ELIG.WR),
    slot('TE', ELIG.TE),
    slot('FLEX', ELIG.FLEX_RWT),
    slot('FLEX', ELIG.FLEX_RWT),
  ];
  const r = opt.computeOptimalLineup(slots, samplePool());
  const flexes = r.assignments.filter(a => a.slot.id === 'FLEX' && a.player);
  assert.equal(flexes.length, 2);
  // Best remaining after mandatory positions: RB15, WR14 (top skill left).
  const flexProjs = flexes.map(a => a.player.projection).sort((a, b) => b - a);
  assert.deepEqual(flexProjs, [15, 14]);
});

// --- Test 7b: heterogeneous flex eligibility --------------------------

test('Test 7b — Flex slots with different eligibility rules', () => {
  const slots = [
    slot('QB', ELIG.QB),
    slot('RB', ELIG.RB),
    slot('WR', ELIG.WR),
    slot('WR_TE_FLEX', ELIG.FLEX_WT), // no RBs allowed here
    slot('WR_RB_FLEX', ELIG.FLEX_RW), // no TEs allowed here
  ];
  const players = [
    P('QB', 25),
    P('RB', 20), P('RB', 18),
    P('WR', 19), P('WR', 17), P('WR', 11),
    P('TE', 30),                       // very good TE — but only fits WR_TE
  ];
  const r = opt.computeOptimalLineup(slots, players);
  const wt = r.assignments.find(a => a.slot.id === 'WR_TE_FLEX');
  const rw = r.assignments.find(a => a.slot.id === 'WR_RB_FLEX');
  assert.equal(wt.player.position, 'TE');
  assert.equal(wt.player.projection, 30);
  // WR_RB flex takes the best remaining RB/WR that isn't already starting:
  // WR slot takes WR19; RB slot takes RB20; remaining RB18, WR17, WR11.
  // Best = RB18.
  assert.equal(rw.player.projection, 18);
});

// --- Test 8: 2 QB + Superflex ------------------------------------------

test('Test 8 — 2 QB + Superflex: three QBs can start', () => {
  const slots = [
    slot('QB', ELIG.QB), slot('QB', ELIG.QB),
    slot('RB', ELIG.RB), slot('RB', ELIG.RB),
    slot('WR', ELIG.WR), slot('WR', ELIG.WR), slot('WR', ELIG.WR),
    slot('TE', ELIG.TE),
    slot('SUPER_FLEX', ELIG.SF_QRWT),
  ];
  const r = opt.computeOptimalLineup(slots, samplePool());
  const qbStarters = r.assignments.filter(a => a.player && a.player.position === 'QB');
  assert.equal(qbStarters.length, 3); // 2 QB slots + SF takes best remaining (QB18 > RB15)
  const qbProjs = qbStarters.map(a => a.player.projection).sort((a, b) => b - a);
  assert.deepEqual(qbProjs, [25, 22, 18]);
});

// --- Test 9: No Flex / No Superflex ------------------------------------

test('Test 9 — No Flex / No SF: engine does NOT invent starting opportunities', () => {
  const slots = [
    slot('QB', ELIG.QB),
    slot('RB', ELIG.RB), slot('RB', ELIG.RB),
    slot('WR', ELIG.WR), slot('WR', ELIG.WR),
    slot('TE', ELIG.TE),
  ];
  // Load up extra RBs — a broken engine would start 3+ of them.
  const players = [
    P('QB', 25),
    P('RB', 20), P('RB', 18), P('RB', 15), P('RB', 12),
    P('WR', 19), P('WR', 17),
    P('TE', 13),
  ];
  const r = opt.computeOptimalLineup(slots, players);
  assert.equal(r.assignments.length, 6);
  assert.equal(r.assignments.filter(a => a.player).length, 6);
  const rbStarters = r.assignments.filter(a => a.slot.id === 'RB');
  assert.equal(rbStarters.length, 2);
  // Two extra RBs must be on the bench.
  const benchRB = r.bench.filter(p => p.position === 'RB');
  assert.equal(benchRB.length, 2);
});

// --- Test 10: Minimal roster -------------------------------------------

test('Test 10 — Minimal roster: unfilled slots reported, no crash', () => {
  const slots = [
    slot('QB', ELIG.QB),
    slot('RB', ELIG.RB), slot('RB', ELIG.RB),
    slot('WR', ELIG.WR), slot('WR', ELIG.WR),
    slot('TE', ELIG.TE),
    slot('FLEX', ELIG.FLEX_RWT),
  ];
  const empty = opt.computeOptimalLineup(slots, []);
  assert.equal(empty.totalProjection, 0);
  assert.equal(empty.unfilledSlots, 7);
  assert.equal(empty.bench.length, 0);
  assert.equal(empty.assignments.every(a => a.player === null), true);

  const one = opt.computeOptimalLineup(slots, [P('QB', 25)]);
  assert.equal(one.totalProjection, 25);
  assert.equal(one.unfilledSlots, 6);
});

// --- Test 11: Nearly full roster ---------------------------------------

test('Test 11 — Nearly full roster: only one slot left to fill', () => {
  const slots = [
    slot('QB', ELIG.QB),
    slot('RB', ELIG.RB), slot('RB', ELIG.RB),
    slot('WR', ELIG.WR), slot('WR', ELIG.WR),
    slot('TE', ELIG.TE),
    slot('FLEX', ELIG.FLEX_RWT),
  ];
  const players = [
    P('QB', 25),
    P('RB', 20), P('RB', 18),
    P('WR', 19), P('WR', 17),
    P('TE', 13),
    // FLEX empty
  ];
  const r = opt.computeOptimalLineup(slots, players);
  assert.equal(r.unfilledSlots, 1);
  const flex = r.assignments.find(a => a.slot.id === 'FLEX');
  assert.equal(flex.player, null);
});

// --- Marginal value ----------------------------------------------------

test('marginalValue: filling an empty slot returns the player projection', () => {
  const slots = [slot('QB', ELIG.QB), slot('RB', ELIG.RB)];
  const roster = [P('QB', 25)];
  const cand = P('RB', 20);
  assert.equal(opt.marginalValue(slots, roster, cand), 20);
});

test('marginalValue: bench-only player returns 0', () => {
  const slots = [slot('QB', ELIG.QB), slot('RB', ELIG.RB)];
  const roster = [P('QB', 25), P('RB', 20)];
  const cand = P('RB', 5); // worse than starter, no flex
  assert.equal(opt.marginalValue(slots, roster, cand), 0);
});

test('marginalValue: better starter displaces weaker one -> returns the delta', () => {
  const slots = [slot('RB', ELIG.RB)];
  const roster = [P('RB', 10)];
  const cand = P('RB', 25);
  assert.equal(opt.marginalValue(slots, roster, cand), 15);
});

test('marginalValue: superflex lets a QB add value even with QB slot filled', () => {
  const slots = [
    slot('QB', ELIG.QB),
    slot('SUPER_FLEX', ELIG.SF_QRWT),
  ];
  const roster = [P('QB', 25), P('RB', 10)]; // SF currently holds RB10
  const cand = P('QB', 20);
  // Optimal after add: QB25 -> QB, QB20 -> SF, RB10 -> bench.  Delta = 20 - 10 = 10.
  assert.equal(opt.marginalValue(slots, roster, cand), 10);
});

test('marginalValue: no-flex league does NOT credit extra RB as starter', () => {
  const slots = [
    slot('QB', ELIG.QB),
    slot('RB', ELIG.RB), slot('RB', ELIG.RB),
    slot('WR', ELIG.WR), slot('WR', ELIG.WR),
    slot('TE', ELIG.TE),
  ];
  const roster = [
    P('QB', 25),
    P('RB', 20), P('RB', 18),
    P('WR', 19), P('WR', 17),
    P('TE', 13),
  ];
  const cand = P('RB', 17); // worse than 18 -> bench only
  assert.equal(opt.marginalValue(slots, roster, cand), 0);
});

// --- Multi-position eligibility ---------------------------------------

test('multi-position eligibility: player fits any of eligiblePositions[]', () => {
  const slots = [slot('WR', ELIG.WR)];
  const p = P('RB', 20, { eligiblePositions: ['RB', 'WR'] });
  const r = opt.computeOptimalLineup(slots, [p]);
  assert.equal(r.totalProjection, 20);
  assert.equal(r.assignments[0].player, p);
});

// --- Custom / novel slot ids -----------------------------------------

test('custom slot ids: engine reasons from allowedPositions only', () => {
  const slots = [
    slot('QB', ELIG.QB),
    slot('SIXTH_MAN', ['QB', 'RB']), // a made-up slot
  ];
  const roster = [P('QB', 25)];
  const cand = P('RB', 18);
  assert.equal(opt.marginalValue(slots, roster, cand), 18);
});

// --- Sleeper adapter --------------------------------------------------

test('adapter: standard 1-QB / 2-RB / 3-WR / 1-TE / 1-FLEX league', () => {
  const settings = {
    slots_qb: 1, slots_rb: 2, slots_wr: 3, slots_te: 1,
    slots_flex: 1, slots_k: 1, slots_def: 1, slots_bn: 6,
  };
  const slots = adapter.buildStartingSlots(settings);
  const ids = slots.map(s => s.id);
  assert.deepEqual(ids, ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF']);
  const flex = slots.find(s => s.id === 'FLEX');
  assert.deepEqual(flex.allowedPositions.sort(), ['RB', 'TE', 'WR']);
});

test('adapter: superflex league emits SUPER_FLEX with QB/RB/WR/TE eligibility', () => {
  const settings = { slots_qb: 1, slots_rb: 2, slots_wr: 3, slots_te: 1, slots_super_flex: 1 };
  const slots = adapter.buildStartingSlots(settings);
  const sf = slots.find(s => s.id === 'SUPER_FLEX');
  assert.deepEqual(sf.allowedPositions.sort(), ['QB', 'RB', 'TE', 'WR']);
});

test('adapter: no flex / no superflex -> no invented slots', () => {
  const settings = { slots_qb: 1, slots_rb: 2, slots_wr: 2, slots_te: 1 };
  const slots = adapter.buildStartingSlots(settings);
  assert.equal(slots.some(s => s.id === 'FLEX'), false);
  assert.equal(slots.some(s => s.id === 'SUPER_FLEX'), false);
});

test('adapter: eligibilityOverrides lets caller reshape a flex', () => {
  const settings = { slots_qb: 1, slots_flex: 1 };
  const slots = adapter.buildStartingSlots(settings, {
    eligibilityOverrides: { FLEX: ['WR', 'TE'] },
  });
  const flex = slots.find(s => s.id === 'FLEX');
  assert.deepEqual(flex.allowedPositions, ['WR', 'TE']);
});

test('adapter: multiple flex slots emitted as separate entries', () => {
  const settings = { slots_qb: 1, slots_rb: 2, slots_wr: 2, slots_te: 1, slots_flex: 2 };
  const slots = adapter.buildStartingSlots(settings);
  const flexes = slots.filter(s => s.id === 'FLEX');
  assert.equal(flexes.length, 2);
});

test('adapter: 2QB + SF league emits both QB slots', () => {
  const settings = { slots_qb: 2, slots_rb: 2, slots_wr: 3, slots_te: 1, slots_super_flex: 1 };
  const slots = adapter.buildStartingSlots(settings);
  assert.equal(slots.filter(s => s.id === 'QB').length, 2);
  assert.equal(slots.filter(s => s.id === 'SUPER_FLEX').length, 1);
});

test('adapter: unknown slots_* keys pass through as their own id', () => {
  const settings = { slots_qb: 1, slots_zombie: 1 };
  const slots = adapter.buildStartingSlots(settings);
  const zombie = slots.find(s => s.id === 'ZOMBIE');
  assert.ok(zombie);
  assert.deepEqual(zombie.allowedPositions, ['ZOMBIE']);
});
