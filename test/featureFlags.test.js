// Node's built-in test runner (`node --test test/featureFlags.test.js`).
// No dependencies. featureFlags.js is UMD so it exports for Node.
//
// Each test resets module state via _resetForTests(), swaps in a fresh
// mock storage + mock fetch, then exercises the specific code path.

const test = require('node:test');
const assert = require('node:assert/strict');

const flags = require('../utils/featureFlags.js');

// -------------------------------------------------------------------
// Mocks
// -------------------------------------------------------------------

function makeMockStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    async get(key) { return store.get(key); },
    async set(key, value) { store.set(key, value); },
    async remove(key) { store.delete(key); },
    _dump() { return Object.fromEntries(store); },
  };
}

function installFetchMock(handler) {
  const original = global.fetch;
  global.fetch = handler;
  return () => { global.fetch = original; };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

function reset() {
  flags._resetForTests();
}

// -------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------

test('successful configuration retrieval applies remote config', async () => {
  reset();
  const storage = makeMockStorage();
  const restoreFetch = installFetchMock(async () => jsonResponse({
    version: 1,
    updatedAt: '2026-08-12T16:00:00Z',
    emergencyDisabled: false,
    features: { auctionInsights: true, playerValues: true, bidRecommendations: true, liveBidAnalysis: true },
  }));
  try {
    const result = await flags.refresh({ storage });
    assert.equal(result.source, 'remote');
    assert.equal(flags.getState().config.updatedAt, '2026-08-12T16:00:00Z');
    assert.equal(flags.isEnabled('auctionInsights'), true);
    // Fresh fetch persisted to cache.
    const cached = await storage.get('featureFlags');
    assert.ok(cached);
    assert.ok(cached.fetchedAt > 0);
  } finally {
    restoreFetch();
  }
});

test('failed retrieval with no cache falls back to defaults (all enabled)', async () => {
  reset();
  const storage = makeMockStorage();
  const restoreFetch = installFetchMock(async () => { throw new Error('network down'); });
  try {
    const result = await flags.refresh({ storage });
    assert.equal(result.source, 'defaults');
    // Known flags default to enabled UNLESS explicitly in DEFAULT_OFF_FLAGS
    // (new gated-rollout engines land there first). Extension core stays
    // functional; only opt-in features start off.
    for (const flag of flags.KNOWN_FLAGS) {
      const expected = !flags.DEFAULT_OFF_FLAGS.has(flag);
      assert.equal(flags.isEnabled(flag), expected, `${flag} should default to ${expected}`);
    }
  } finally {
    restoreFetch();
  }
});

test('failed retrieval with valid cache serves the cached config', async () => {
  reset();
  const storage = makeMockStorage({
    featureFlags: {
      config: {
        version: 1,
        updatedAt: '2026-08-01T00:00:00Z',
        emergencyDisabled: false,
        features: { auctionInsights: false, playerValues: true, bidRecommendations: true, liveBidAnalysis: true },
      },
      fetchedAt: Date.now() - 60_000, // 1 min old, well within TTL
    },
  });
  const restoreFetch = installFetchMock(async () => { throw new Error('offline'); });
  try {
    const result = await flags.refresh({ storage });
    assert.equal(result.source, 'cache');
    assert.equal(flags.isEnabled('auctionInsights'), false, 'cached OFF flag stays OFF');
    assert.equal(flags.isEnabled('playerValues'), true);
  } finally {
    restoreFetch();
  }
});

test('malformed configuration is rejected', async () => {
  reset();
  // Direct schema check (used by both refresh and storage-change flow).
  assert.equal(flags._validateConfig(null), null);
  assert.equal(flags._validateConfig('not-an-object'), null);
  assert.equal(flags._validateConfig({}), null, 'missing version rejected');
  assert.equal(flags._validateConfig({ version: 'one' }), null, 'non-numeric version rejected');
  assert.equal(flags._validateConfig({ version: 0 }), null, 'version < 1 rejected');

  // Fetch flow: bad JSON leads to defaults being applied.
  const storage = makeMockStorage();
  const restoreFetch = installFetchMock(async () => jsonResponse({ nothing: 'useful' }));
  try {
    const result = await flags.refresh({ storage });
    assert.equal(result.source, 'defaults', 'malformed response falls through to defaults');
  } finally {
    restoreFetch();
  }
});

test('individual feature disabled', async () => {
  reset();
  const storage = makeMockStorage();
  const restoreFetch = installFetchMock(async () => jsonResponse({
    version: 1,
    emergencyDisabled: false,
    features: {
      auctionInsights: true,
      playerValues: false,
      bidRecommendations: true,
      liveBidAnalysis: true,
    },
  }));
  try {
    await flags.refresh({ storage });
    assert.equal(flags.isEnabled('playerValues'), false);
    // Peers stay enabled -- kill switch is per-flag.
    assert.equal(flags.isEnabled('auctionInsights'), true);
    assert.equal(flags.isEnabled('bidRecommendations'), true);
    assert.equal(flags.isEnabled('liveBidAnalysis'), true);
  } finally {
    restoreFetch();
  }
});

test('global emergency disable overrides individual flags', async () => {
  reset();
  const storage = makeMockStorage();
  const restoreFetch = installFetchMock(async () => jsonResponse({
    version: 1,
    emergencyDisabled: true,
    // Even with everything set to true, emergencyDisabled wins.
    features: { auctionInsights: true, playerValues: true, bidRecommendations: true, liveBidAnalysis: true },
  }));
  try {
    await flags.refresh({ storage });
    for (const flag of flags.KNOWN_FLAGS) {
      assert.equal(flags.isEnabled(flag), false, `${flag} must be off during emergency`);
    }
  } finally {
    restoreFetch();
  }
});

test('default behavior when no configuration has ever been fetched', () => {
  reset();
  // Without calling refresh() at all, isEnabled uses the frozen defaults.
  // Honors DEFAULT_OFF_FLAGS for gated-rollout features.
  for (const flag of flags.KNOWN_FLAGS) {
    const expected = !flags.DEFAULT_OFF_FLAGS.has(flag);
    assert.equal(flags.isEnabled(flag), expected, `${flag} defaults to ${expected}`);
  }
  assert.equal(flags.getState().source, 'defaults');
});

test('unknown flag name is treated as enabled with a warning', () => {
  reset();
  // Fail-open behavior: unknown names return true so a typo can't
  // silently disable a feature.
  assert.equal(flags.isEnabled('doesNotExist'), true);
});

test('newer schema version accepted; unknown feature keys ignored', async () => {
  reset();
  const storage = makeMockStorage();
  const restoreFetch = installFetchMock(async () => jsonResponse({
    version: 999,
    emergencyDisabled: false,
    features: {
      auctionInsights: false,
      playerValues: true,
      bidRecommendations: true,
      liveBidAnalysis: true,
      futureFlagWeDontKnowYet: true, // ignored
    },
    someNewTopLevelField: 'ignored',
  }));
  try {
    const result = await flags.refresh({ storage });
    assert.equal(result.source, 'remote');
    assert.equal(flags.isEnabled('auctionInsights'), false);
    assert.equal(flags.isEnabled('playerValues'), true);
  } finally {
    restoreFetch();
  }
});

test('hydrateFromStorage without a cached entry applies defaults', async () => {
  reset();
  const storage = makeMockStorage();
  const cfg = await flags.hydrateFromStorage(storage);
  assert.equal(cfg.emergencyDisabled, false);
  assert.equal(flags.getState().source, 'defaults');
});

test('subscribe fires on applyConfig transitions', async () => {
  reset();
  const storage = makeMockStorage();
  const seen = [];
  flags.subscribe((cfg) => seen.push(cfg.emergencyDisabled));
  const restoreFetch = installFetchMock(async () => jsonResponse({
    version: 1,
    emergencyDisabled: true,
    features: { auctionInsights: true, playerValues: true, bidRecommendations: true, liveBidAnalysis: true },
  }));
  try {
    await flags.refresh({ storage });
    assert.deepEqual(seen, [true]);
  } finally {
    restoreFetch();
  }
});
