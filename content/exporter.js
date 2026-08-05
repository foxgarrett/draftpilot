(function (global) {
  // `key` looks up each value on a normalized player object; `label` is what
  // actually gets written as the CSV header. csv.js stays schema-agnostic --
  // it just writes whatever headers and rows it's given -- so the mapping
  // between the two lives here instead.
  //
  // `draftTypes` restricts a field to specific draft types; omitted means
  // the field appears in every export. Sleeper reuses the same DOM column
  // for two different stats depending on draft type (dollar values in
  // auction drafts, average draft position elsewhere), so we only emit the
  // one that actually has data.
  const FIELDS = [
    { key: 'rank', label: 'Rank' },
    { key: 'playerName', label: 'Player Name' },
    { key: 'position', label: 'Position' },
    { key: 'team', label: 'Team' },
    { key: 'bye', label: 'Bye' },
    {
      key: 'projectedAuctionValue',
      label: 'Projected Auction Value',
      draftTypes: ['auction'],
      // Format at export only; the underlying player object keeps the raw
      // number so future features (inflation calc, etc.) can do math on it.
      format: (v) => (v == null ? null : `$${v}`),
    },
    { key: 'averageDraftPosition', label: 'Average Draft Position', draftTypes: ['snake'] },
    { key: 'projectedFantasyPoints', label: 'Projected Fantasy Points' },
    { key: 'averageFantasyPoints', label: 'Average Fantasy Points' },
    { key: 'passingAttempts', label: 'Passing Attempts' },
    { key: 'passingYards', label: 'Passing Yards' },
    { key: 'passingTD', label: 'Passing TD' },
    { key: 'rushingAttempts', label: 'Rushing Attempts' },
    { key: 'rushingYards', label: 'Rushing Yards' },
    { key: 'rushingTD', label: 'Rushing TD' },
    { key: 'receptions', label: 'Receptions' },
    { key: 'receivingYards', label: 'Receiving Yards' },
    { key: 'receivingTD', label: 'Receiving TD' },
  ];

  function fieldsFor(draftType) {
    return FIELDS.filter((f) => !f.draftTypes || f.draftTypes.includes(draftType));
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function buildFilename(date = new Date()) {
    const y = date.getFullYear();
    const m = pad(date.getMonth() + 1);
    const d = pad(date.getDate());
    const hh = pad(date.getHours());
    const mm = pad(date.getMinutes());
    return `SleeperDraft_${y}-${m}-${d}_${hh}-${mm}.csv`;
  }

  /** Builds an RFC 4180 CSV and triggers a browser download -- no chrome.downloads
   * permission needed, since a clicked <a download> anchor is enough. */
  function downloadCSV(players, { filename, draftType = 'auction' } = {}) {
    const fields = fieldsFor(draftType);
    const headers = fields.map((field) => field.label);
    const rows = players.map((player) => {
      const row = {};
      for (const { key, label, format } of fields) {
        row[label] = format ? format(player[key]) : player[key];
      }
      return row;
    });
    const csv = global.DraftPilot.csv.toCSV(rows, headers);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename || buildFilename();
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  global.DraftPilot = global.DraftPilot || {};
  global.DraftPilot.exporter = { downloadCSV, buildFilename, FIELDS, fieldsFor };
})(typeof window !== 'undefined' ? window : globalThis);
