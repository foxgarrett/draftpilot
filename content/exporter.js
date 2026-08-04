(function (global) {
  const CSV_HEADERS = [
    'rank',
    'playerName',
    'position',
    'team',
    'bye',
    'projectedAuctionValue',
    'projectedFantasyPoints',
    'averageFantasyPoints',
    'passingAttempts',
    'passingYards',
    'passingTD',
    'rushingAttempts',
    'rushingYards',
    'rushingTD',
    'receptions',
    'receivingYards',
    'receivingTD',
  ];

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
  function downloadCSV(players, { filename } = {}) {
    const csv = global.DraftPilot.csv.toCSV(players, CSV_HEADERS);
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
  global.DraftPilot.exporter = { downloadCSV, buildFilename, CSV_HEADERS };
})(typeof window !== 'undefined' ? window : globalThis);
