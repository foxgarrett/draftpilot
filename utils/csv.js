(function (global) {
  function escapeField(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  function toCSV(rows, headers) {
    const lines = [headers.map(escapeField).join(',')];
    for (const row of rows) {
      lines.push(headers.map((header) => escapeField(row[header])).join(','));
    }
    return lines.join('\r\n');
  }

  global.DraftPilot = global.DraftPilot || {};
  global.DraftPilot.csv = { escapeField, toCSV };
})(typeof window !== 'undefined' ? window : globalThis);
