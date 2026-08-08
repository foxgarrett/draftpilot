#!/usr/bin/env node
/**
 * DraftPilot analysis prototype runner.
 *
 *   node prototype/analyze.js [sleeper-username]
 *
 * Fetches the user's completed past-season drafts from the Sleeper API,
 * runs every analyzer, prints a human-readable TL;DR to stdout, and
 * writes the full derived object to prototype/out/<username>.json.
 */

const fs = require('fs');
const path = require('path');
const {
  getUserByUsername,
  getUserLeagues,
  getDraft,
  getDraftPicks,
  getLeagueUsers,
  getLeague,
} = require('./sleeperClient');
const {
  perManagerSpending,
  leaguePositionalTrends,
  budgetPlanner,
  positionOverpayVsLeague,
  spendingTiming,
  tierBreaks,
  rivalScoutingProfiles,
  keeperRadar,
  summarizeInsights,
  extractFormat,
  detectFormatChanges,
} = require('./analyzers');

const PAST_SEASON_COUNT = 5;

function pastSeasons() {
  const currentYear = new Date().getFullYear();
  return Array.from({ length: PAST_SEASON_COUNT }, (_, i) => String(currentYear - 1 - i));
}

function buildUsersById(users) {
  const map = new Map();
  for (const u of users || []) {
    map.set(u.user_id, {
      displayName: u.display_name,
      teamName: (u.metadata && u.metadata.team_name) || null,
    });
  }
  return map;
}

function normalizePick(pick, usersById) {
  const md = pick.metadata || {};
  const drafter = usersById.get(pick.picked_by) || {};
  return {
    pickNo: pick.pick_no,
    round: pick.round,
    draftSlot: pick.draft_slot,
    userId: pick.picked_by,
    displayName: drafter.displayName || null,
    teamName: drafter.teamName || null,
    playerName: [md.first_name, md.last_name].filter(Boolean).join(' ') || null,
    position: md.position || null,
    team: md.team || null,
    yearsExp: md.years_exp != null ? Number(md.years_exp) : null,
    playerId: md.player_id || null,
    amount: md.amount != null ? Number(md.amount) : null,
    isKeeper: !!pick.is_keeper,
  };
}

async function loadDraftSummary(league, season) {
  const [draft, picks, users, leagueDetail] = await Promise.all([
    getDraft(league.draft_id),
    getDraftPicks(league.draft_id),
    getLeagueUsers(league.league_id),
    getLeague(league.league_id),
  ]);
  if (!draft || !Array.isArray(picks)) return null;

  const usersById = buildUsersById(users);
  const format = extractFormat(draft, leagueDetail);
  return {
    season,
    leagueId: league.league_id,
    leagueName: league.name,
    draftId: league.draft_id,
    type: draft.type === 'auction' ? 'auction' : 'snake',
    budget: format.budget,
    teams: format.teams,
    format,
    picks: picks.map((p) => normalizePick(p, usersById)),
  };
}

function parseArgs(argv) {
  const args = { username: 'foxgarrett84', latestFormatOnly: false };
  for (const raw of argv) {
    if (raw === '--latest-format-only') args.latestFormatOnly = true;
    else if (!raw.startsWith('--')) args.username = raw;
  }
  return args;
}

async function main() {
  const { username, latestFormatOnly } = parseArgs(process.argv.slice(2));
  process.stderr.write(`Looking up user "${username}"…\n`);

  const user = await getUserByUsername(username);
  if (!user) {
    process.stderr.write(`No Sleeper user "${username}".\n`);
    process.exit(1);
  }

  const seasons = pastSeasons();
  process.stderr.write(`Fetching leagues across seasons: ${seasons.join(', ')}\n`);

  const drafts = [];
  for (const season of seasons) {
    const leagues = await getUserLeagues(user.user_id, season).catch(() => []);
    for (const league of leagues || []) {
      if (!league.draft_id) continue;
      const summary = await loadDraftSummary(league, season);
      if (summary) {
        drafts.push(summary);
        process.stderr.write(
          `  loaded ${season} — ${league.name} [${summary.format.shortLabel}] · ${summary.picks.length} picks\n`
        );
      }
    }
  }

  if (!drafts.length) {
    process.stderr.write('No past drafts found.\n');
    process.exit(1);
  }

  const formatState = detectFormatChanges(drafts);
  const effectiveDrafts = latestFormatOnly
    ? drafts.filter((d) => d.format.shortLabel === formatState.latestFormat)
    : drafts;

  process.stderr.write(
    `\nRunning analyzers on ${effectiveDrafts.length} draft(s)` +
      (latestFormatOnly ? ` (filtered to latest format)` : '') +
      `…\n\n`
  );
  printFormatSummary(effectiveDrafts, formatState, { latestFormatOnly });

  const managers = perManagerSpending(effectiveDrafts);
  const trends = leaguePositionalTrends(effectiveDrafts);
  // Use the most recent auction draft's budget as the planning baseline.
  const mostRecentAuction = effectiveDrafts
    .filter((d) => d.type === 'auction')
    .sort((a, b) => b.season.localeCompare(a.season))[0];
  const referenceBudget = mostRecentAuction ? mostRecentAuction.budget : 200;
  const budgetPlan = budgetPlanner(effectiveDrafts, referenceBudget);
  const overpay = positionOverpayVsLeague(managers, referenceBudget);
  const timing = spendingTiming(effectiveDrafts);
  const breaks = tierBreaks(trends, { budget: referenceBudget });
  const rivals = rivalScoutingProfiles(managers, overpay, timing);
  const keepers = keeperRadar(effectiveDrafts);
  const insights = summarizeInsights({ managers, trends, budgetPlan, overpay, timing, breaks });

  printTLDR(insights);
  printRivalNarratives(rivals);

  const outDir = path.join(__dirname, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${username}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        user,
        drafts,
        effectiveDraftIds: effectiveDrafts.map((d) => d.draftId),
        formatState,
        latestFormatOnly,
        managers,
        trends,
        budgetPlan,
        overpay,
        timing,
        breaks,
        rivals,
        keepers,
        insights,
      },
      null,
      2
    )
  );
  process.stderr.write(`\nFull output written to ${path.relative(process.cwd(), outPath)}\n`);
}

function printFormatSummary(effectiveDrafts, formatState, { latestFormatOnly }) {
  console.log('== Analyzing ==');
  const included = new Set(effectiveDrafts.map((d) => d.draftId));

  for (const [label, drafts] of formatState.formats) {
    const isLatest = label === formatState.latestFormat;
    const marker = isLatest ? '(latest)' : '';
    console.log(`  [${label}] ${marker}`.trimEnd());
    for (const d of drafts) {
      const excluded = latestFormatOnly && !included.has(d.draftId);
      const suffix = excluded ? '   ← EXCLUDED (not latest format)' : '';
      console.log(`    ${d.season} · ${d.leagueName}${suffix}`);
    }
  }

  if (formatState.hasChanges) {
    console.log('');
    if (latestFormatOnly) {
      console.log(
        '  ✓ Filtered to seasons matching the latest format. Older seasons excluded.'
      );
    } else {
      console.log(
        '  ⚠ Format changes detected across seasons. Pooling can blend eras (e.g.,'
      );
      console.log(
        '    a Superflex switch inflates QB spend). Re-run with --latest-format-only'
      );
      console.log(
        '    to analyze only seasons matching the most recent format.'
      );
    }
  }
}

function printRivalNarratives(rivals) {
  if (!rivals || !rivals.length) return;
  console.log('\n== Rival scouting profiles ==\n');
  for (const r of rivals) {
    console.log(`* ${r.narrative}`);
    if (r.strategy) console.log(`  Strategy: ${r.strategy}`);
    console.log('');
  }
}

function printTLDR(insights) {
  for (const insight of insights) {
    console.log(`\n== ${insight.title} ==`);
    if (!insight.rows || !insight.rows.length) {
      console.log('  (no data)');
      continue;
    }
    console.table(insight.rows);
  }
}

main().catch((err) => {
  process.stderr.write(`Error: ${err.stack || err.message}\n`);
  process.exit(1);
});
