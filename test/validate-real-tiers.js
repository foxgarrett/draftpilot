/**
 * Human-readable validation of the tier engine against realistic
 * 2025 projected-points curves. Not a unit test -- prints a diagnostic
 * table per position for eyeball review, plus assertions for the
 * specific claim that started this: "Derrick Henry shouldn't be RB
 * Tier 12".
 *
 * Run: node test/validate-real-tiers.js
 */

const analysis = require('../utils/analysis.js');
global.DraftPilot = { analysis, sleeperApi: {} };
require('../utils/liveDraft.js');
const liveDraft = global.DraftPilot.liveDraft;

// Approximate 2025 half-PPR/PPR projections. Rough values calibrated
// against several public consensus ranker outputs -- not meant to be
// authoritative, just representative of the *shape* of the curve.
const POOLS = {
  QB: [
    { name: 'Josh Allen',        points: 405 },
    { name: 'Lamar Jackson',     points: 395 },
    { name: 'Jayden Daniels',    points: 372 },
    { name: 'Jalen Hurts',       points: 358 },
    { name: 'Patrick Mahomes',   points: 340 },
    { name: 'Joe Burrow',        points: 332 },
    { name: 'Baker Mayfield',    points: 320 },
    { name: 'Bo Nix',            points: 312 },
    { name: 'Kyler Murray',      points: 305 },
    { name: 'Justin Herbert',    points: 298 },
    { name: 'Caleb Williams',    points: 290 },
    { name: 'Brock Purdy',       points: 282 },
    { name: 'Dak Prescott',      points: 275 },
    { name: 'CJ Stroud',         points: 268 },
    { name: 'Drake Maye',        points: 260 },
    { name: 'Trevor Lawrence',   points: 252 },
    { name: 'Michael Penix Jr',  points: 244 },
    { name: 'Tua Tagovailoa',    points: 236 },
    { name: 'Justin Fields',     points: 228 },
    { name: 'Geno Smith',        points: 220 },
  ],
  RB: [
    { name: 'Bijan Robinson',      points: 305 },
    { name: 'Saquon Barkley',      points: 292 },
    { name: 'Christian McCaffrey', points: 285 },
    { name: 'Jahmyr Gibbs',        points: 278 },
    { name: 'Ashton Jeanty',       points: 260 },
    { name: "De'Von Achane",       points: 254 },
    { name: 'Josh Jacobs',         points: 248 },
    { name: 'Derrick Henry',       points: 242 },
    { name: 'Bucky Irving',        points: 235 },
    { name: 'Kyren Williams',      points: 222 },
    { name: 'Chase Brown',         points: 217 },
    { name: 'James Cook',          points: 213 },
    { name: 'Kenneth Walker',      points: 208 },
    { name: 'Alvin Kamara',        points: 195 },
    { name: 'Chuba Hubbard',       points: 191 },
    { name: 'Breece Hall',         points: 187 },
    { name: 'Omarion Hampton',     points: 183 },
    { name: 'James Conner',        points: 179 },
    { name: 'David Montgomery',    points: 168 },
    { name: 'Joe Mixon',           points: 164 },
    { name: 'Isiah Pacheco',       points: 160 },
    { name: 'Jaylen Warren',       points: 156 },
    { name: 'Aaron Jones',         points: 152 },
    { name: 'TreVeyon Henderson',  points: 148 },
    { name: 'D\'Andre Swift',      points: 135 },
    { name: 'RJ Harvey',           points: 132 },
    { name: 'Rhamondre Stevenson', points: 128 },
    { name: 'Tony Pollard',        points: 124 },
    { name: 'Najee Harris',        points: 120 },
    { name: 'Jaylen Wright',       points: 108 },
    { name: 'Tyrone Tracy',        points: 104 },
    { name: 'Zach Charbonnet',     points: 100 },
    { name: 'Bhayshul Tuten',      points: 96  },
    { name: 'Jerome Ford',         points: 92  },
    { name: 'MarShawn Lloyd',      points: 88  },
    { name: 'Tyler Allgeier',      points: 84  },
    { name: 'Ray Davis',           points: 80  },
    { name: 'Kimani Vidal',        points: 76  },
    { name: 'Roschon Johnson',     points: 72  },
    { name: 'Kareem Hunt',         points: 68  },
  ],
  WR: [
    { name: "Ja'Marr Chase",       points: 320 },
    { name: 'CeeDee Lamb',         points: 305 },
    { name: 'Justin Jefferson',    points: 298 },
    { name: 'Puka Nacua',          points: 285 },
    { name: 'Malik Nabers',        points: 272 },
    { name: 'Amon-Ra St. Brown',   points: 265 },
    { name: 'Nico Collins',        points: 254 },
    { name: 'Brian Thomas Jr',     points: 247 },
    { name: 'A.J. Brown',          points: 240 },
    { name: 'Drake London',        points: 232 },
    { name: 'Ladd McConkey',       points: 225 },
    { name: 'Tyreek Hill',         points: 220 },
    { name: 'Terry McLaurin',      points: 214 },
    { name: 'Marvin Harrison Jr',  points: 208 },
    { name: 'Garrett Wilson',      points: 202 },
    { name: 'DK Metcalf',          points: 195 },
    { name: 'Jaxon Smith-Njigba',  points: 189 },
    { name: 'Rashee Rice',         points: 182 },
    { name: 'Davante Adams',       points: 176 },
    { name: 'Mike Evans',          points: 170 },
    { name: 'DJ Moore',            points: 164 },
    { name: 'Zay Flowers',         points: 158 },
    { name: 'Tee Higgins',         points: 152 },
    { name: 'DeVonta Smith',       points: 146 },
    { name: 'Chris Olave',         points: 140 },
    { name: 'Courtland Sutton',    points: 134 },
    { name: 'Jameson Williams',    points: 128 },
    { name: 'Jaylen Waddle',       points: 122 },
    { name: 'Jerry Jeudy',         points: 116 },
    { name: 'Cooper Kupp',         points: 110 },
    { name: 'Calvin Ridley',       points: 104 },
    { name: 'Rome Odunze',         points: 98  },
    { name: 'Tetairoa McMillan',   points: 92  },
    { name: 'Xavier Worthy',       points: 86  },
    { name: 'Deebo Samuel',        points: 82  },
    { name: 'Khalil Shakir',       points: 78  },
    { name: 'Jordan Addison',      points: 74  },
    { name: 'Keon Coleman',        points: 70  },
    { name: 'Ricky Pearsall',      points: 66  },
    { name: 'Josh Downs',          points: 62  },
  ],
  TE: [
    { name: 'Brock Bowers',       points: 265 },
    { name: 'Trey McBride',       points: 232 },
    { name: 'George Kittle',      points: 218 },
    { name: 'Sam LaPorta',        points: 175 },
    { name: 'Travis Kelce',       points: 168 },
    { name: 'T.J. Hockenson',     points: 156 },
    { name: 'Mark Andrews',       points: 148 },
    { name: 'David Njoku',        points: 140 },
    { name: 'Evan Engram',        points: 128 },
    { name: 'Tucker Kraft',       points: 120 },
    { name: 'Jonnu Smith',        points: 112 },
    { name: 'Dallas Goedert',     points: 104 },
    { name: 'Colston Loveland',   points: 92  },
    { name: 'Dalton Kincaid',     points: 86  },
    { name: 'Hunter Henry',       points: 80  },
    { name: 'Kyle Pitts',         points: 74  },
    { name: 'Tyler Warren',       points: 68  },
    { name: 'Chig Okonkwo',       points: 62  },
    { name: 'Cade Otton',         points: 56  },
    { name: 'Isaiah Likely',      points: 50  },
  ],
};

const CHECKS = [
  { name: 'Derrick Henry', position: 'RB', expectTierRange: [2, 4] },
  { name: 'Bijan Robinson', position: 'RB', expectTierRange: [1, 2] },
  { name: 'Josh Allen', position: 'QB', expectTierRange: [1, 2] },
  { name: 'Brock Bowers', position: 'TE', expectTierRange: [1, 1] },
  { name: "Ja'Marr Chase", position: 'WR', expectTierRange: [1, 2] },
  { name: 'Sam LaPorta', position: 'TE', expectTierRange: [2, 4] },
  { name: 'Mike Evans', position: 'WR', expectTierRange: [3, 5] },
];

let failed = 0;
for (const pos of Object.keys(POOLS)) {
  const players = POOLS[pos].map((p) => ({ ...p, position: pos }));
  const desc = liveDraft.describeTierComputation({ players }, pos);
  console.log('\n' + '='.repeat(70));
  console.log(desc);
}

console.log('\n' + '='.repeat(70));
console.log('SPOT CHECKS  (expected vs. actual tier)');
console.log('='.repeat(70));
for (const c of CHECKS) {
  const players = POOLS[c.position].map((p) => ({ ...p, position: c.position }));
  const tier = liveDraft.findTier({
    position: c.position,
    playerPool: { players },
    playerName: c.name,
  });
  const t = tier ? tier.tierIndex + 1 : null;
  const [lo, hi] = c.expectTierRange;
  const ok = t != null && t >= lo && t <= hi;
  const status = ok ? '✓ pass' : '✗ FAIL';
  console.log(
    `  ${status}  ${c.position.padEnd(3)} ${c.name.padEnd(24)} ` +
    `expect T${lo}${lo === hi ? '' : `-T${hi}`}  got T${t ?? '?'} of ${tier?.totalTiers ?? '?'}  ` +
    `(rank ${tier?.rank ?? '?'})`
  );
  if (!ok) failed++;
}
console.log('');
if (failed) {
  console.error(`FAILED: ${failed} spot check(s) out of range`);
  process.exit(1);
} else {
  console.log('All spot checks passed.');
}
