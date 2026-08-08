(function (global) {
  const { sleeperApi, csv, storage, analysis } = global.DraftPilot;

  // ------------------------------------------------------------------
  // Presentation helpers: analyzer output stays code-facing (kebab-case
  // enums, raw ratios); these adapters turn it into spreadsheet-friendly
  // labels at render time only.
  // ------------------------------------------------------------------
  function titleCase(kebab) {
    return String(kebab)
      .split(/[-_]/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
  const humanize = {
    style: (v) => (v ? titleCase(v) : ''),
    timing: (v) => (v ? titleCase(v) : ''),
    consistency: (v) => (v ? titleCase(v) : ''),
  };

  // ------------------------------------------------------------------
  // Styling helpers -- xlsx-js-style accepts a `s` (style) property on
  // each cell. We apply four consistent looks: header row, section
  // sub-header, numeric cell, and default. Column widths and a frozen
  // header row are set at the sheet level.
  // ------------------------------------------------------------------
  const STYLE = {
    header: {
      font: { bold: true, color: { rgb: 'FFFFFFFF' } },
      fill: { fgColor: { rgb: 'FF1F2A44' } },
      alignment: { horizontal: 'left', vertical: 'center' },
      border: {
        bottom: { style: 'thin', color: { rgb: 'FF334166' } },
      },
    },
    zebra: {
      fill: { fgColor: { rgb: 'FFF4F6FB' } },
    },
  };

  /** Applies header styling, autosized-ish column widths, zebra striping,
   * and a frozen header row to a sheet built from an array of objects. */
  function styleSheet(sheet, headers, rowCount) {
    if (!sheet || !headers || !headers.length) return;
    const cols = headers.map((h) => {
      // Rough autosize -- header length OR the max cell value length seen
      // so far, whichever is bigger, clamped.
      let width = String(h).length;
      for (let r = 1; r <= rowCount; r++) {
        const ref = XLSX.utils.encode_cell({ c: headers.indexOf(h), r });
        const cell = sheet[ref];
        const len = cell && cell.v != null ? String(cell.v).length : 0;
        if (len > width) width = len;
      }
      return { wch: Math.min(Math.max(width + 2, 10), 40) };
    });
    sheet['!cols'] = cols;
    sheet['!freeze'] = { xSplit: 0, ySplit: 1 };
    sheet['!views'] = [{ state: 'frozen', ySplit: 1 }];

    // Header row style.
    for (let c = 0; c < headers.length; c++) {
      const ref = XLSX.utils.encode_cell({ c, r: 0 });
      if (sheet[ref]) sheet[ref].s = STYLE.header;
    }
    // Zebra striping on data rows.
    for (let r = 1; r <= rowCount; r++) {
      if (r % 2 === 0) continue;
      for (let c = 0; c < headers.length; c++) {
        const ref = XLSX.utils.encode_cell({ c, r });
        if (sheet[ref]) sheet[ref].s = STYLE.zebra;
      }
    }
  }

  // Fields shared by every draft format. `draftTypes` limits a field to
  // specific formats (same pattern as content/exporter.js).
  const FIELDS = [
    { key: 'pickNo', label: 'Pick #' },
    { key: 'round', label: 'Round' },
    { key: 'draftSlot', label: 'Draft Slot' },
    { key: 'drafter', label: 'Drafter' },
    { key: 'teamName', label: 'Team Name' },
    { key: 'playerName', label: 'Player Name' },
    { key: 'position', label: 'Position' },
    { key: 'team', label: 'Team' },
    // Canonical shape carries boolean; CSV renders as Yes/No so
    // spreadsheets don't misinterpret it as a formula/date.
    { key: 'isKeeper', label: 'Is Keeper', format: (v) => (v ? 'Yes' : 'No') },
    // Snake/linear drafts have no per-pick dollar amount, so this column
    // stays out of the CSV entirely for those formats -- see rationale
    // (auction/snake column parity) in content/exporter.js.
    {
      key: 'amount',
      label: 'Amount',
      draftTypes: ['auction'],
      format: (v) => (v == null ? null : `$${v}`),
    },
    { key: 'yearsExperience', label: 'Years Experience' },
  ];

  function fieldsFor(draftType) {
    return FIELDS.filter((f) => !f.draftTypes || f.draftTypes.includes(draftType));
  }

  // For the "export all" workbook, one sheet per season (season is the tab
  // name, so it's not a column), with League Name leading so multi-league
  // seasons are still readable. Amount is always present since seasons can
  // mix auction and snake drafts; non-auction rows leave it blank.
  const PER_SEASON_FIELDS = [
    { key: 'leagueName', label: 'League Name' },
    ...FIELDS.map((f) => (f.draftTypes ? { ...f, draftTypes: undefined } : f)),
  ];

  // Sleeper's pick shape: /draft/{id}/picks returns one entry per pick with
  // player info nested under `metadata`. `picked_by` is the user id that
  // made the pick; we resolve it to a display name + team name via
  // /league/{id}/users before flattening.
  function normalizePick(pick, usersById) {
    const md = pick.metadata || {};
    const drafter = usersById.get(pick.picked_by) || {};
    return {
      pickNo: pick.pick_no,
      round: pick.round,
      draftSlot: pick.draft_slot,
      userId: pick.picked_by,
      drafter: drafter.display_name || null,
      // Canonical field name is `displayName` for the analyzers; `drafter`
      // stays as an alias for the existing CSV column mapping.
      displayName: drafter.display_name || null,
      teamName: drafter.teamName || null,
      playerName: [md.first_name, md.last_name].filter(Boolean).join(' ') || null,
      position: md.position || null,
      team: md.team || null,
      playerId: md.player_id || null,
      isKeeper: !!pick.is_keeper,
      // Sleeper stores the auction amount as a string; keep the raw number
      // in the object so the analyzers can do math on it.
      amount: md.amount != null ? Number(md.amount) : null,
      yearsExperience: md.years_exp != null ? Number(md.years_exp) : null,
      yearsExp: md.years_exp != null ? Number(md.years_exp) : null,
    };
  }

  function buildUsersById(leagueUsers) {
    const map = new Map();
    for (const u of leagueUsers) {
      map.set(u.user_id, {
        display_name: u.display_name,
        teamName: (u.metadata && u.metadata.team_name) || null,
      });
    }
    return map;
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function safeFilenamePart(str) {
    return String(str).replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  }

  function buildFilename({ leagueName, season }, date = new Date()) {
    const y = date.getFullYear();
    const m = pad(date.getMonth() + 1);
    const d = pad(date.getDate());
    const hh = pad(date.getHours());
    const mm = pad(date.getMinutes());
    return `SleeperDraft_${safeFilenamePart(leagueName)}_${season}_${y}-${m}-${d}_${hh}-${mm}.csv`;
  }

  function triggerDownload(text, filename) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  /** Fetches a user's completed drafts across the given seasons.
   * Returns a flat list, newest season first, of {leagueId, leagueName,
   * season, draftId, status, format}. */
  async function fetchLeagues(userId, seasons) {
    const results = await Promise.all(
      seasons.map((s) => sleeperApi.getUserLeagues(userId, s).catch(() => []))
    );
    const out = [];
    seasons.forEach((season, i) => {
      for (const league of results[i] || []) {
        if (!league.draft_id) continue;
        out.push({
          leagueId: league.league_id,
          leagueName: league.name,
          season,
          draftId: league.draft_id,
          status: league.status,
        });
      }
    });
    return out;
  }

  /** Fetches one draft's picks + league users + league details and returns
   * a fully-normalized draft summary that both the CSV/XLSX exporters and
   * the analysis engine can consume. */
  async function loadDraftPicks({ leagueId, leagueName, season, draftId }) {
    const [draft, picks, leagueUsers, leagueDetail] = await Promise.all([
      sleeperApi.getDraft(draftId),
      sleeperApi.getDraftPicks(draftId),
      sleeperApi.getLeagueUsers(leagueId),
      sleeperApi.getLeague(leagueId),
    ]);

    if (!draft) throw new Error('Draft not found on Sleeper.');
    if (!Array.isArray(picks)) throw new Error('No picks returned for this draft.');

    const draftType = draft.type === 'auction' ? 'auction' : 'snake';
    const usersById = buildUsersById(leagueUsers || []);
    const rows = picks
      .map((p) => normalizePick(p, usersById))
      .sort((a, b) => a.pickNo - b.pickNo);

    const format = analysis.extractFormat(draft, leagueDetail);
    return {
      draftType,
      rows,
      draftSummary: {
        season,
        leagueId,
        leagueName,
        draftId,
        type: draftType,
        budget: format.budget,
        teams: format.teams,
        format,
        picks: rows,
      },
    };
  }

  function pickToRow(pick, fields) {
    const row = {};
    for (const { key, label, format } of fields) {
      row[label] = format ? format(pick[key]) : pick[key];
    }
    return row;
  }

  async function exportDraft({ leagueId, leagueName, season, draftId }) {
    const { draftType, rows: picks } = await loadDraftPicks({ leagueId, draftId });
    const fields = fieldsFor(draftType);
    const csvRows = picks.map((p) => pickToRow(p, fields));
    const headers = fields.map((f) => f.label);
    const text = csv.toCSV(csvRows, headers);
    triggerDownload(text, buildFilename({ leagueName, season }));

    await storage.set('lastPastDraftExport', {
      timestamp: Date.now(),
      leagueName,
      season,
      pickCount: picks.length,
    });

    return { pickCount: picks.length, draftType };
  }

  function buildCombinedFilename(date = new Date()) {
    const y = date.getFullYear();
    const m = pad(date.getMonth() + 1);
    const d = pad(date.getDate());
    const hh = pad(date.getHours());
    const mm = pad(date.getMinutes());
    return `SleeperDrafts_All_${y}-${m}-${d}_${hh}-${mm}.xlsx`;
  }

  /** Fetches every league's draft picks sequentially, runs the analysis
   * engine, and emits one XLSX workbook: insight tabs up front, then one
   * sheet per season with raw picks. Sequential fetch rather than parallel
   * to avoid burst-hammering Sleeper's public API.
   *
   * If format changes are detected across seasons (e.g. single-QB → Superflex),
   * insight tabs analyze only the latest-format subset so pre-draft numbers
   * aren't distorted by era-blending. Raw picks sheets still include every
   * season regardless. */
  async function exportAllDrafts(leagues, { onProgress } = {}) {
    if (typeof XLSX === 'undefined') {
      throw new Error('SheetJS library not loaded.');
    }

    const fields = PER_SEASON_FIELDS;
    const headers = fields.map((f) => f.label);
    const rowsBySeason = new Map();
    const draftSummaries = [];
    const failures = [];

    for (let i = 0; i < leagues.length; i++) {
      const league = leagues[i];
      if (onProgress) {
        onProgress({ done: i, total: leagues.length, leagueName: league.leagueName });
      }
      try {
        const loaded = await loadDraftPicks(league);
        draftSummaries.push(loaded.draftSummary);
        const seasonRows = rowsBySeason.get(league.season) || [];
        for (const pick of loaded.rows) {
          seasonRows.push(pickToRow({ ...pick, leagueName: league.leagueName }, fields));
        }
        rowsBySeason.set(league.season, seasonRows);
      } catch (err) {
        failures.push({
          leagueName: league.leagueName,
          season: league.season,
          error: err.userMessage || err.message,
        });
      }
    }

    if (onProgress) onProgress({ done: leagues.length, total: leagues.length });

    let totalRows = 0;
    for (const rows of rowsBySeason.values()) totalRows += rows.length;
    if (!totalRows) {
      throw new Error(
        failures.length ? `All drafts failed. First error: ${failures[0].error}` : 'No picks found.'
      );
    }

    const workbook = XLSX.utils.book_new();

    // Insight tabs -- analyze only the latest-format subset so era-blending
    // doesn't distort pre-draft numbers.
    const formatState = analysis.detectFormatChanges(draftSummaries);
    const effectiveDrafts = formatState.hasChanges
      ? draftSummaries.filter((d) => d.format.shortLabel === formatState.latestFormat)
      : draftSummaries;
    appendInsightSheets(workbook, effectiveDrafts, formatState);

    // Raw per-season sheets (all seasons, unfiltered) come after insights.
    const seasons = [...rowsBySeason.keys()].sort().reverse();
    for (const season of seasons) {
      const rows = rowsBySeason.get(season);
      addSheet(workbook, season, rows, headers);
    }

    XLSX.writeFile(workbook, buildCombinedFilename());

    return {
      rowCount: totalRows,
      draftCount: leagues.length - failures.length,
      seasonCount: rowsBySeason.size,
      analyzedDraftCount: effectiveDrafts.length,
      formatState,
      failures,
    };
  }

  /** Appends insight-driven sheets to the workbook: overpay, styles,
   * timing, budget plan, positional tiers, keepers, plus a leading
   * "Insights (README)" sheet explaining what each analytic tab means. */
  function appendInsightSheets(workbook, drafts, formatState) {
    const managers = analysis.perManagerSpending(drafts);
    const trends = analysis.leaguePositionalTrends(drafts);
    const mostRecentAuction = drafts
      .filter((d) => d.type === 'auction')
      .sort((a, b) => b.season.localeCompare(a.season))[0];
    const referenceBudget = mostRecentAuction ? mostRecentAuction.budget : 200;
    const budgetPlan = analysis.budgetPlanner(drafts, referenceBudget);
    const overpay = analysis.positionOverpayVsLeague(managers, referenceBudget);
    const timing = analysis.spendingTiming(drafts);
    const keepers = analysis.keeperRadar(drafts);

    const breaks = analysis.tierBreaks(trends, { budget: referenceBudget });
    const rivals = analysis.rivalScoutingProfiles(managers, overpay, timing);

    appendReadmeSheet(workbook, drafts, formatState);
    appendRivalScoutingSheet(workbook, rivals);
    appendOverpaySheet(workbook, overpay);
    appendManagerStylesSheet(workbook, managers);
    appendTimingSheet(workbook, timing);
    appendBudgetPlanSheet(workbook, budgetPlan);
    appendTierCostSheet(workbook, trends);
    appendTierBreaksSheet(workbook, breaks);
    appendKeepersSheet(workbook, keepers);
  }

  function addSheet(workbook, name, rows, headerOrder) {
    if (!rows || !rows.length) return;
    const sheet = XLSX.utils.json_to_sheet(rows, headerOrder ? { header: headerOrder } : undefined);
    const headers = headerOrder || Object.keys(rows[0] || {});
    styleSheet(sheet, headers, rows.length);
    // Excel sheet-name limit is 31 chars, forbids some punctuation.
    const safeName = name.replace(/[\\/?*[\]:]/g, '_').slice(0, 31);
    XLSX.utils.book_append_sheet(workbook, sheet, safeName);
  }

  function appendReadmeSheet(workbook, drafts, formatState) {
    const rows = [
      { 'What': 'Drafts analyzed', 'Details': drafts.length },
      { 'What': 'Your league format', 'Details': formatState.latestFormat || '(unknown)' },
      { 'What': 'Format changes across seasons?', 'Details': formatState.hasChanges ? 'Yes' : 'No' },
      {},
      { 'What': 'Tab', 'Details': 'What this tab shows' },
      { 'What': 'Rival Scouting', 'Details': 'One row per league mate with a plain-English scouting report and a "how to draft against them" strategy hint. Read this on draft day.' },
      { 'What': 'Overpay vs Median', 'Details': 'For each manager and position, how much more (or less) of their budget they spend compared to the league median. Positive numbers = they consistently pay more than typical.' },
      { 'What': 'Manager Styles', 'Details': 'Whether each manager plays "Studs and Duds" (big money on top players) or "Balanced" (spread the budget), and whether they stick to that style year over year.' },
      { 'What': 'Spending Timing', 'Details': 'When each manager spends: aggressive front-loaders empty their wallet early, patient hunters wait for value. Includes what share of budget they spend in each quarter of the draft.' },
      { 'What': 'Budget Plan', 'Details': 'A recommended budget split for your league, derived from what this league has actually spent per position over past drafts. Not generic industry advice.' },
      { 'What': 'Positional Tier Cost', 'Details': 'What each tier of player typically goes for in your league (median, cheapest, most expensive) across past seasons. Top 12 at each position.' },
      { 'What': 'Tier Breaks', 'Details': 'Where each position\'s pricing cliffs happen (e.g. "after RB6 prices drop 40%"). Tells you when to jump on a tier before the run.' },
      { 'What': 'Keepers', 'Details': 'Every keeper pick across seasons, showing who kept whom and at what cost.' },
      { 'What': '<season>', 'Details': "Raw pick history for that season's draft. Includes every season loaded, not just the ones the insight tabs analyzed." },
    ];
    if (formatState.hasChanges) {
      rows.splice(3, 0, {
        'What': 'Heads up',
        'Details': `Insight tabs analyze only the latest format (${formatState.latestFormat}) so eras don't get blended (e.g. a Superflex switch inflates QB spend). Season sheets still include every season.`,
      });
    }
    addSheet(workbook, 'Read Me First', rows, ['What', 'Details']);
  }

  function appendOverpaySheet(workbook, overpay) {
    if (!overpay || !overpay.perManager.length) return;
    const headers = [
      'Manager',
      'Position',
      'Their Share of Budget',
      'League Median Share',
      'Difference (percentage points)',
      'Extra Spend per Draft',
    ];
    // Sort by manager name (alphabetical) initially; users can re-sort in
    // Excel to rank by biggest overpayer if they want.
    const rows = overpay.perManager
      .slice()
      .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''))
      .flatMap((m) =>
        analysis.POSITIONS.map((position) => {
          const d = m.deltasByPosition[position];
          return {
            'Manager': m.displayName,
            'Position': position,
            'Their Share of Budget': (d.share * 100).toFixed(1) + '%',
            'League Median Share': (d.leagueMedianShare * 100).toFixed(1) + '%',
            'Difference (percentage points)': (d.shareDelta * 100).toFixed(1),
            'Extra Spend per Draft': (d.dollarDelta >= 0 ? '+$' : '-$') + Math.abs(d.dollarDelta),
          };
        })
      );
    addSheet(workbook, 'Overpay vs Median', rows, headers);
  }

  function appendManagerStylesSheet(workbook, managers) {
    const headers = [
      'Manager',
      'Team Name',
      'Draft Style',
      'Top-2 Picks (% of Budget)',
      'Season-to-Season Swing',
      'Consistent Year to Year?',
      'Positions Ranked by Spend',
      'Seasons Analyzed',
    ];
    const rows = managers
      .filter((m) => m.aggregate)
      .map((m) => ({
        'Manager': m.displayName,
        'Team Name': m.teamName || '',
        'Draft Style': humanize.style(m.aggregate.dominantStyle),
        'Top-2 Picks (% of Budget)': (m.aggregate.avgConcentration * 100).toFixed(1) + '%',
        'Season-to-Season Swing': (m.aggregate.concentrationStdDev * 100).toFixed(1) + ' pp',
        'Consistent Year to Year?': humanize.consistency(m.aggregate.consistency),
        'Positions Ranked by Spend': m.aggregate.preferredPositions.join(' > '),
        'Seasons Analyzed': m.aggregate.seasonsAnalyzed,
      }));
    addSheet(workbook, 'Manager Styles', rows, headers);
  }

  function appendTimingSheet(workbook, timing) {
    const headers = [
      'Manager',
      'Timing Style',
      'Big Picks Made By (% of Draft)',
      '% Spent in Q1 (Early)',
      '% Spent in Q2',
      '% Spent in Q3',
      '% Spent in Q4 (Late)',
      'Seasons Analyzed',
    ];
    const rows = timing
      .filter((t) => t.aggregate)
      .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''))
      .map((t) => ({
        'Manager': t.displayName,
        'Timing Style': humanize.timing(t.aggregate.timingStyle),
        'Big Picks Made By (% of Draft)': (t.aggregate.avgTopPickTimingRatio * 100).toFixed(1) + '%',
        '% Spent in Q1 (Early)': (t.aggregate.avgBudgetPacing[0] * 100).toFixed(1) + '%',
        '% Spent in Q2': (t.aggregate.avgBudgetPacing[1] * 100).toFixed(1) + '%',
        '% Spent in Q3': (t.aggregate.avgBudgetPacing[2] * 100).toFixed(1) + '%',
        '% Spent in Q4 (Late)': (t.aggregate.avgBudgetPacing[3] * 100).toFixed(1) + '%',
        'Seasons Analyzed': t.aggregate.seasonsAnalyzed,
      }));
    addSheet(workbook, 'Spending Timing', rows, headers);
  }

  function appendBudgetPlanSheet(workbook, budgetPlan) {
    if (!budgetPlan) return;
    const headers = ['Position', 'Recommended Spend', "Your League's Historical Share"];
    const rows = analysis.POSITIONS.map((position) => ({
      'Position': position,
      'Recommended Spend': '$' + budgetPlan.recommendation[position].recommendedSpend,
      "Your League's Historical Share":
        (budgetPlan.recommendation[position].historicalShare * 100).toFixed(1) + '%',
    }));
    rows.push({});
    rows.push({ 'Position': 'Total Budget', 'Recommended Spend': '$' + budgetPlan.budget });
    rows.push({ 'Position': 'Seasons Analyzed', 'Recommended Spend': budgetPlan.seasonsAnalyzed });
    addSheet(workbook, 'Budget Plan', rows, headers);
  }

  function appendTierCostSheet(workbook, trends) {
    if (!trends || !trends.tierAggregates) return;
    const headers = [
      'Position',
      'Tier (e.g. RB1 = 1)',
      'Typical Price (Median)',
      'Cheapest Ever Paid',
      'Most Ever Paid',
      'Seasons in Sample',
    ];
    const rows = [];
    for (const position of analysis.POSITIONS) {
      for (const tier of trends.tierAggregates[position]) {
        rows.push({
          'Position': position,
          'Tier (e.g. RB1 = 1)': tier.rank,
          'Typical Price (Median)': '$' + tier.median,
          'Cheapest Ever Paid': '$' + tier.min,
          'Most Ever Paid': '$' + tier.max,
          'Seasons in Sample': tier.samples,
        });
      }
    }
    addSheet(workbook, 'Positional Tier Cost', rows, headers);
  }

  function appendRivalScoutingSheet(workbook, rivals) {
    if (!rivals || !rivals.length) return;
    const headers = [
      'Manager',
      'Team Name',
      'Scouting Report',
      'How to Draft Against',
      'Draft Style',
      'Timing',
      'Q1 Spend %',
      'Overpays At',
      'Overpay ($/draft)',
      'Underspends At',
      'Underspend ($/draft)',
      'Top Preferred Positions',
    ];
    const rows = rivals.map((r) => ({
      'Manager': r.displayName,
      'Team Name': r.teamName || '',
      'Scouting Report': r.narrative,
      'How to Draft Against': r.strategy,
      'Draft Style': r.style,
      'Timing': r.timing,
      'Q1 Spend %': r.q1SharePct != null ? r.q1SharePct + '%' : '',
      'Overpays At': r.overpay ? r.overpay.position : '',
      'Overpay ($/draft)': r.overpay ? '+$' + r.overpay.dollarDelta : '',
      'Underspends At': r.underpay ? r.underpay.position : '',
      'Underspend ($/draft)': r.underpay ? '-$' + Math.abs(r.underpay.dollarDelta) : '',
      'Top Preferred Positions': r.preferredPositions.join(' > '),
    }));
    addSheet(workbook, 'Rival Scouting', rows, headers);
  }

  function appendTierBreaksSheet(workbook, breaks) {
    if (!breaks) return;
    const headers = [
      'Position',
      'After Tier',
      'Price Falls From',
      'Price Falls To',
      'Drop %',
      'vs. Position Avg Drop',
      'Meaningful Cliff?',
      'Biggest for Position?',
    ];
    const rows = [];
    for (const position of analysis.POSITIONS) {
      const posData = breaks[position];
      if (!posData || !posData.breaks || !posData.breaks.length) continue;
      for (const b of posData.breaks) {
        rows.push({
          'Position': position,
          'After Tier': `${position}${b.fromTier}`,
          'Price Falls From': '$' + Math.round(b.fromPrice),
          'Price Falls To': '$' + Math.round(b.toPrice),
          'Drop %': (b.dropPct * 100).toFixed(0) + '%',
          'vs. Position Avg Drop': (b.severity >= 0 ? '+' : '') + (b.severity * 100).toFixed(0) + 'pp',
          'Meaningful Cliff?': b.isMeaningful ? 'Yes' : 'No',
          'Biggest for Position?': b.isBiggest ? 'Yes' : 'No',
        });
      }
    }
    addSheet(workbook, 'Tier Breaks', rows, headers);
  }

  function appendKeepersSheet(workbook, keepers) {
    const headers = [
      'Season',
      'League',
      'Pick Number',
      'Round',
      'Kept By',
      'Team Name',
      'Player',
      'Position',
      'NFL Team',
      'Keeper Cost',
    ];
    const rows = keepers.map((k) => ({
      'Season': k.season,
      'League': k.leagueName,
      'Pick Number': k.pickNo,
      'Round': k.round,
      'Kept By': k.drafter,
      'Team Name': k.teamName || '',
      'Player': k.playerName,
      'Position': k.position,
      'NFL Team': k.team || '',
      'Keeper Cost': k.amount != null ? '$' + k.amount : '',
    }));
    addSheet(workbook, 'Keepers', rows, headers);
  }

  function buildCombinedCsvFilename(date = new Date()) {
    const y = date.getFullYear();
    const m = pad(date.getMonth() + 1);
    const d = pad(date.getDate());
    const hh = pad(date.getHours());
    const mm = pad(date.getMinutes());
    return `SleeperDrafts_All_${y}-${m}-${d}_${hh}-${mm}.csv`;
  }

  /** CSV alternative to exportAllDrafts: one flat file with every pick from
   * every season, `Season` as the leading column. No analysis, no tabs --
   * strictly raw picks for downstream tools (spreadsheets, Python, LLMs)
   * that prefer a single table. */
  async function exportAllDraftsAsCombinedCsv(leagues, { onProgress } = {}) {
    // Add Season as first column; the rest match PER_SEASON_FIELDS shape.
    const fields = [{ key: 'season', label: 'Season' }, ...PER_SEASON_FIELDS];
    const headers = fields.map((f) => f.label);
    const allRows = [];
    const failures = [];

    for (let i = 0; i < leagues.length; i++) {
      const league = leagues[i];
      if (onProgress) {
        onProgress({ done: i, total: leagues.length, leagueName: league.leagueName });
      }
      try {
        const loaded = await loadDraftPicks(league);
        for (const pick of loaded.rows) {
          allRows.push(
            pickToRow(
              { ...pick, season: league.season, leagueName: league.leagueName },
              fields
            )
          );
        }
      } catch (err) {
        failures.push({
          leagueName: league.leagueName,
          season: league.season,
          error: err.userMessage || err.message,
        });
      }
    }

    if (onProgress) onProgress({ done: leagues.length, total: leagues.length });
    if (!allRows.length) {
      throw new Error(
        failures.length ? `All drafts failed. First error: ${failures[0].error}` : 'No picks found.'
      );
    }

    const text = csv.toCSV(allRows, headers);
    triggerDownload(text, buildCombinedCsvFilename());

    return {
      rowCount: allRows.length,
      draftCount: leagues.length - failures.length,
      failures,
    };
  }

  /** Loads every past-drafts league, runs the analyzer on the latest-format
   * subset, and caches the positional tier aggregates for later use by the
   * current-draft-room exporter (which uses them to compute a
   * league-adjusted-value column). Doesn't download anything -- purely a
   * background analysis pass. */
  async function cacheLeagueAnalysis(leagues, { onProgress } = {}) {
    const draftSummaries = [];
    const failures = [];
    for (let i = 0; i < leagues.length; i++) {
      const league = leagues[i];
      if (onProgress) onProgress({ done: i, total: leagues.length, leagueName: league.leagueName });
      try {
        const loaded = await loadDraftPicks(league);
        draftSummaries.push(loaded.draftSummary);
      } catch (err) {
        // Track per-league failures so the popup can tell the user WHICH
        // leagues didn't load -- not just a silent "N failed" total.
        failures.push({
          leagueName: league.leagueName,
          season: league.season,
          message: err.userMessage || err.message,
        });
      }
    }
    if (onProgress) onProgress({ done: leagues.length, total: leagues.length });

    if (!draftSummaries.length) {
      // Total failure -- return a shape the caller can inspect rather
      // than null (which loses failure context).
      return { failures, cachedAt: null, seasonsAnalyzed: 0 };
    }

    const formatState = analysis.detectFormatChanges(draftSummaries);
    const effectiveDrafts = formatState.hasChanges
      ? draftSummaries.filter((d) => d.format.shortLabel === formatState.latestFormat)
      : draftSummaries;
    const trends = analysis.leaguePositionalTrends(effectiveDrafts);
    const rookieMults = analysis.rookieMultipliers(effectiveDrafts);

    const payload = {
      cachedAt: Date.now(),
      formatLabel: formatState.latestFormat,
      tierAggregates: trends.tierAggregates,
      rookieMultipliers: rookieMults,
      seasonsAnalyzed: effectiveDrafts.length,
      hasFormatChanges: formatState.hasChanges,
      totalDraftsFound: draftSummaries.length,
      failures,
      // The list the popup renders in "Individual drafts" -- cached so the
      // popup can restore this section without re-hitting the API on open.
      leagues: leagues.map((l) => ({
        leagueId: l.leagueId,
        leagueName: l.leagueName,
        season: l.season,
        draftId: l.draftId,
        status: l.status,
      })),
    };
    await storage.set('leagueTierAggregates', payload);
    return payload;
  }

  global.DraftPilot = global.DraftPilot || {};
  global.DraftPilot.pastDrafts = {
    fetchLeagues,
    exportDraft,
    exportAllDrafts,
    exportAllDraftsAsCombinedCsv,
    cacheLeagueAnalysis,
    FIELDS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
