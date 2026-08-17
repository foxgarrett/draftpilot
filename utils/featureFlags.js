(function (global) {
  // ---------------------------------------------------------------------
  // Configuration
  //
  // Single source of truth for where the config lives and how often to
  // refresh. Bump SUPPORTED_CONFIG_VERSION only when the schema changes
  // in a breaking way; unknown-but-larger versions are still accepted
  // (only the known-flag subset is honored -- extra fields ignored).
  //
  // Chrome MV3 does not allow remotely hosted CODE. This config is
  // strictly JSON DATA and is validated before being applied.
  // ---------------------------------------------------------------------
  const CONFIG_URL = 'https://foxgarrett.github.io/draftpilot/feature-flags.json';
  const REFRESH_INTERVAL_MINUTES = 30;
  // Cache is trusted for this long since the last fetch. After that we
  // still serve it if fresh fetches keep failing (never leaves the user
  // stranded) but we log a warning.
  const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  const FETCH_TIMEOUT_MS = 10000;
  const STORAGE_KEY = 'featureFlags';
  const SUPPORTED_CONFIG_VERSION = 1;

  // Known feature flags. Adding a flag = adding a name here + adding the
  // isEnabled() check at every code site that shouldn't run when off.
  const KNOWN_FLAGS = [
    'auctionInsights',   // XLSX analytics tabs (Rival Scouting, Overpay, etc.)
    'playerValues',      // league-adjusted values in CSV + live nomination card
    'bidRecommendations',// verdict + suggested-max on the live nomination card
    'liveBidAnalysis',   // whole Live Draft Mode (DOM scraping + session poll)
    'slotDrivenOptimizer', // new marginal-value engine drives fitTone in bid rec
    'rosterAwareMaxBid', // new roster-aware Your Max engine (utils/bidEngine.js)
  ];

  // Flags that default OFF instead of the module-wide safe-default ON.
  // Only for changes gated behind an explicit rollout -- everything else
  // still defaults ON so a missing config file never breaks users. New
  // engines land here first, then move out once verified.
  const DEFAULT_OFF_FLAGS = new Set();

  // Safe defaults: enabled UNLESS listed in DEFAULT_OFF_FLAGS.
  const DEFAULT_CONFIG = Object.freeze({
    version: SUPPORTED_CONFIG_VERSION,
    updatedAt: null,
    emergencyDisabled: false,
    features: Object.freeze(
      KNOWN_FLAGS.reduce((acc, name) => {
        acc[name] = !DEFAULT_OFF_FLAGS.has(name);
        return acc;
      }, {})
    ),
  });

  // Flip to false when packaging a release build so we don't log every
  // fetch to real users. In dev this stays true so we can watch the
  // client work in the service-worker console + side-panel console.
  const DEBUG = true;

  // ---------------------------------------------------------------------
  // Internal state
  // ---------------------------------------------------------------------
  let currentConfig = DEFAULT_CONFIG;
  let currentSource = 'defaults'; // 'defaults' | 'cache' | 'remote'
  const listeners = new Set();

  function getLogger() {
    // Prefer the shared Draft Pilot logger (respects setEnabled). Fall
    // back to console when the logger module isn't loaded yet.
    const dp = global.DraftPilot;
    if (dp && dp.logger) return dp.logger;
    return console;
  }
  function log(...args) {
    if (!DEBUG) return;
    getLogger().info('[featureFlags]', ...args);
  }
  function warn(...args) {
    getLogger().warn('[featureFlags]', ...args);
  }

  // ---------------------------------------------------------------------
  // Schema validation
  //
  // Treats the response as untrusted input. Anything that fails these
  // checks returns null and the caller falls back to cache or defaults.
  // Extra fields on the payload are ignored, not rejected -- that lets
  // us add optional fields server-side later without a client rev.
  // ---------------------------------------------------------------------
  function validateConfig(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

    const version = Number(raw.version);
    if (!Number.isFinite(version) || version < 1) return null;

    if (version > SUPPORTED_CONFIG_VERSION) {
      // Newer than we know how to fully parse. Accept but log so we
      // notice it during dev. Only known-flag subset is honored below.
      warn(`Config version ${version} is newer than supported (${SUPPORTED_CONFIG_VERSION}).`);
    }

    const features = raw.features && typeof raw.features === 'object' && !Array.isArray(raw.features)
      ? raw.features
      : {};

    // Only carry through KNOWN_FLAGS -- ignore unknown feature names.
    // Missing flags fall back to the module-wide default (on unless the
    // flag is in DEFAULT_OFF_FLAGS). A remote value always wins when
    // present, even if it flips the default.
    const cleanFeatures = {};
    for (const name of KNOWN_FLAGS) {
      if (features[name] === false) cleanFeatures[name] = false;
      else if (features[name] === true) cleanFeatures[name] = true;
      else cleanFeatures[name] = !DEFAULT_OFF_FLAGS.has(name);
    }

    return {
      version,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
      emergencyDisabled: raw.emergencyDisabled === true,
      features: cleanFeatures,
    };
  }

  // ---------------------------------------------------------------------
  // Public state API
  // ---------------------------------------------------------------------
  function isEnabled(flagName) {
    if (!KNOWN_FLAGS.includes(flagName)) {
      // Unknown flag -- treat as enabled (fail-open) to avoid silently
      // disabling features when a typo happens.
      warn(`Unknown flag "${flagName}" checked; defaulting to enabled.`);
      return true;
    }
    if (currentConfig.emergencyDisabled) return false;
    const v = currentConfig.features[flagName];
    if (v === true) return true;
    if (v === false) return false;
    // Missing entry -- honor the flag's module-wide default.
    return !DEFAULT_OFF_FLAGS.has(flagName);
  }

  function getState() {
    return {
      config: currentConfig,
      source: currentSource,
    };
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function notifyListeners() {
    for (const fn of Array.from(listeners)) {
      try { fn(currentConfig); } catch (_) { /* subscriber failure not our problem */ }
    }
  }

  function applyConfig(config, source) {
    currentConfig = config;
    currentSource = source;
    log(
      `Applied config from ${source}. version=${config.version}`,
      `emergency=${config.emergencyDisabled}`,
      'features:', config.features
    );
    notifyListeners();
  }

  // ---------------------------------------------------------------------
  // Storage + network
  // ---------------------------------------------------------------------
  async function loadCached(storage) {
    if (!storage) return null;
    try {
      const cached = await storage.get(STORAGE_KEY);
      if (!cached || !cached.config || typeof cached.fetchedAt !== 'number') return null;
      const age = Date.now() - cached.fetchedAt;
      const clean = validateConfig(cached.config);
      if (!clean) return null;
      return { config: clean, fetchedAt: cached.fetchedAt, ageMs: age };
    } catch (_) {
      return null;
    }
  }

  async function saveCache(storage, config) {
    if (!storage) return;
    try {
      await storage.set(STORAGE_KEY, { config, fetchedAt: Date.now() });
    } catch (_) { /* transient; next successful save wins */ }
  }

  async function fetchRemote() {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
    try {
      const resp = await fetch(CONFIG_URL, {
        method: 'GET',
        cache: 'no-cache',
        signal: controller ? controller.signal : undefined,
      });
      if (!resp.ok) {
        warn(`Fetch HTTP ${resp.status}`);
        return null;
      }
      const raw = await resp.json();
      const clean = validateConfig(raw);
      if (!clean) {
        warn('Response failed schema validation; discarding.');
        return null;
      }
      log(`Fetched config version=${clean.version} emergency=${clean.emergencyDisabled}`);
      return clean;
    } catch (err) {
      warn('Fetch failed:', (err && err.message) || err);
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Try remote first, cache next, defaults last. Save whatever we get
   * so downstream contexts (popup, content scripts) can subscribe to
   * chrome.storage.onChanged and rehydrate without duplicating the
   * fetch.
   */
  async function refresh({ storage }) {
    const fresh = await fetchRemote();
    if (fresh) {
      applyConfig(fresh, 'remote');
      await saveCache(storage, fresh);
      return { source: 'remote', config: fresh };
    }
    const cached = await loadCached(storage);
    if (cached) {
      if (cached.ageMs > CACHE_MAX_AGE_MS) {
        warn(`Cache is ${Math.round(cached.ageMs / 3600000)}h old (past ${CACHE_MAX_AGE_MS / 3600000}h TTL). Still serving it since fetch failed.`);
      }
      applyConfig(cached.config, 'cache');
      return { source: 'cache', config: cached.config };
    }
    applyConfig(DEFAULT_CONFIG, 'defaults');
    return { source: 'defaults', config: DEFAULT_CONFIG };
  }

  /**
   * Non-background contexts (popup, content scripts): pull whatever's
   * in storage into in-memory state so isEnabled() is synchronous. No
   * network -- the background service worker owns fetching.
   */
  async function hydrateFromStorage(storage) {
    const cached = await loadCached(storage);
    if (cached) {
      applyConfig(cached.config, 'cache');
      return cached.config;
    }
    applyConfig(DEFAULT_CONFIG, 'defaults');
    return DEFAULT_CONFIG;
  }

  /**
   * Wire chrome.storage.onChanged so updates written by the background
   * worker propagate to every open context (popup, content scripts)
   * without a reload.
   */
  function subscribeToStorageChanges(chromeStorage, storageKeyName) {
    if (!chromeStorage || !chromeStorage.onChanged) return () => {};
    const namespacedKey = storageKeyName; // caller passes the fully-namespaced key
    const handler = (changes, areaName) => {
      if (areaName !== 'local') return;
      const change = changes[namespacedKey];
      if (!change || !change.newValue) return;
      const cfg = change.newValue.config;
      const clean = validateConfig(cfg);
      if (!clean) return;
      applyConfig(clean, 'cache');
    };
    chromeStorage.onChanged.addListener(handler);
    return () => chromeStorage.onChanged.removeListener(handler);
  }

  // ---------------------------------------------------------------------
  // Exports
  // ---------------------------------------------------------------------
  const api = {
    CONFIG_URL,
    REFRESH_INTERVAL_MINUTES,
    CACHE_MAX_AGE_MS,
    STORAGE_KEY,
    KNOWN_FLAGS,
    DEFAULT_OFF_FLAGS,
    DEFAULT_CONFIG,
    SUPPORTED_CONFIG_VERSION,
    isEnabled,
    getState,
    subscribe,
    refresh,
    hydrateFromStorage,
    subscribeToStorageChanges,
    // Exposed for tests:
    _validateConfig: validateConfig,
    _resetForTests: () => {
      currentConfig = DEFAULT_CONFIG;
      currentSource = 'defaults';
      listeners.clear();
    },
  };

  global.DraftPilot = global.DraftPilot || {};
  global.DraftPilot.featureFlags = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined'
  ? window
  : typeof self !== 'undefined'
    ? self
    : typeof global !== 'undefined'
      ? global
      : globalThis);
