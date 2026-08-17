// Background service worker (Chrome) / background script (Firefox).
//
// Responsibilities:
//   1. Toolbar-icon behavior (differs per browser -- see below).
//   2. Feature-flag refresh: fetches the remote config on install/
//      startup and on a chrome.alarms schedule. All other extension
//      contexts (popup, content scripts) read the cached value from
//      chrome.storage.local; when this worker writes an update, the
//      built-in chrome.storage.onChanged event notifies them.

// ---------------------------------------------------------------------
// Toolbar behavior
// ---------------------------------------------------------------------

// Chrome branch. Wrapped in feature detection so Firefox (which lacks
// chrome.sidePanel) silently skips this instead of throwing.
if (typeof chrome !== 'undefined' && chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error('[Draft Pilot] setPanelBehavior failed:', err));
}

// Firefox branch. browser.sidebarAction only exists in Firefox; guard so
// Chrome doesn't try to wire an onClicked handler that would race with
// its own side-panel behavior above.
if (typeof browser !== 'undefined' && browser.sidebarAction && browser.action) {
  browser.action.onClicked.addListener(() => {
    browser.sidebarAction.toggle();
  });
}

// ---------------------------------------------------------------------
// Feature flags
//
// MV3 service workers can import classic scripts synchronously via
// importScripts(). Load logger + storage + featureFlags so the module
// finds its dependencies on `self.DraftPilot`.
// ---------------------------------------------------------------------

try {
  importScripts('utils/logger.js', 'utils/storage.js', 'utils/featureFlags.js');
} catch (err) {
  // Firefox background scripts are declared in `background.scripts` in
  // the manifest and are loaded independently -- importScripts here
  // will throw. That's fine; the manifest already lists the same three
  // files (see background.scripts). Chrome uses this importScripts path.
  console.info('[Draft Pilot] importScripts skipped (likely Firefox):', err && err.message);
}

const ALARM_NAME = 'draftpilot-feature-flags-refresh';

function getFlagsApi() {
  return (self.DraftPilot && self.DraftPilot.featureFlags) || null;
}
function getStorageApi() {
  return (self.DraftPilot && self.DraftPilot.storage) || null;
}

async function refreshFlags(reason) {
  const flags = getFlagsApi();
  const storage = getStorageApi();
  if (!flags || !storage) return;
  try {
    const result = await flags.refresh({ storage });
    console.info(
      `[Draft Pilot] feature-flags refresh (${reason}): source=${result.source}`,
      `emergency=${result.config.emergencyDisabled}`
    );
  } catch (err) {
    console.warn('[Draft Pilot] feature-flags refresh error:', err && err.message);
  }
}

function scheduleAlarm() {
  const flags = getFlagsApi();
  if (!flags || typeof chrome === 'undefined' || !chrome.alarms) return;
  // Idempotent: create() replaces any existing alarm with the same name.
  chrome.alarms.create(ALARM_NAME, {
    // periodInMinutes -- chrome fires at least this often when the
    // browser is running. Service worker will spin up to handle it.
    periodInMinutes: flags.REFRESH_INTERVAL_MINUTES,
    // delayInMinutes 1 so the alarm doesn't collide with the immediate
    // install/startup refresh below.
    delayInMinutes: flags.REFRESH_INTERVAL_MINUTES,
  });
}

if (typeof chrome !== 'undefined' && chrome.alarms) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm && alarm.name === ALARM_NAME) refreshFlags('alarm');
  });
}

if (typeof chrome !== 'undefined' && chrome.runtime) {
  // Fires on install, update, and browser startup. First run also
  // covers "user just installed" -- we schedule + fetch immediately.
  if (chrome.runtime.onInstalled) {
    chrome.runtime.onInstalled.addListener(() => {
      scheduleAlarm();
      refreshFlags('onInstalled');
    });
  }
  if (chrome.runtime.onStartup) {
    chrome.runtime.onStartup.addListener(() => {
      scheduleAlarm();
      refreshFlags('onStartup');
    });
  }
}

// Also run once at script parse time. Handles the case where a service
// worker was terminated and just spun back up: onInstalled/onStartup
// won't re-fire, but the worker still needs current flags before it
// serves anything to other contexts.
refreshFlags('worker-start');
scheduleAlarm();
