(function (global) {
  const PREFIX = '[Draft Pilot]';
  let enabled = true;

  function setEnabled(value) {
    enabled = Boolean(value);
  }

  function info(...args) {
    if (enabled) console.info(PREFIX, ...args);
  }

  function warn(...args) {
    if (enabled) console.warn(PREFIX, ...args);
  }

  function error(...args) {
    if (enabled) console.error(PREFIX, ...args);
  }

  function debug(...args) {
    if (enabled) console.debug(PREFIX, ...args);
  }

  global.DraftPilot = global.DraftPilot || {};
  global.DraftPilot.logger = { setEnabled, info, warn, error, debug };
})(typeof window !== 'undefined' ? window : globalThis);
