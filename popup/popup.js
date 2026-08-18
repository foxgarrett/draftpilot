(function () {
  const DRAFT_URL_PATTERN = /^https:\/\/([\w-]+\.)?sleeper\.(com|app)\/draft\//;
  const PAST_SEASON_COUNT = 5;
  const SEASONS = Array.from({ length: PAST_SEASON_COUNT }, (_, i) =>
    String(new Date().getFullYear() - 1 - i)
  );

  const { sleeperApi, storage, pastDrafts, liveDraft, featureFlags } = window.DraftPilot;

  // ---------- element refs ---------------------------------------------------
  const themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const settingsBtn = document.getElementById('settings-btn');
  const settingsMenu = document.getElementById('settings-menu');

  const userBar = document.getElementById('user-bar');
  const usernameDisplay = document.getElementById('username-display');
  const changeUserBtn = document.getElementById('change-user-btn');

  const welcomeView = document.getElementById('welcome-view');
  const syncedView = document.getElementById('synced-view');
  const liveDraftView = document.getElementById('live-draft-view');
  const backToAnalysisBtn = document.getElementById('back-to-analysis-btn');
  const liveExportBtn = document.getElementById('live-export-btn');
  const liveExportStatus = document.getElementById('live-export-status');
  const enterLiveModeBtn = document.getElementById('enter-live-mode-btn');

  // Live draft mode: mutually-exclusive sub-sections + their inner refs.
  const liveNoDraft = document.getElementById('live-no-draft');
  const liveNoDraftBody = document.getElementById('live-no-draft-body');
  const liveDraftPicker = document.getElementById('live-draft-picker');
  const liveConnecting = document.getElementById('live-connecting');
  const liveError = document.getElementById('live-error');
  const liveErrorMsg = document.getElementById('live-error-msg');
  const liveRetryBtn = document.getElementById('live-retry-btn');
  const liveActive = document.getElementById('live-active');
  const liveLeagueName = document.getElementById('live-league-name');
  const liveFormatLine = document.getElementById('live-format-line');
  const liveStatusBadge = document.getElementById('live-status-badge');
  const liveSnakeNotice = document.getElementById('live-snake-notice');
  const livePickLogCard = document.getElementById('live-pick-log-card');
  const livePickLog = document.getElementById('live-pick-log');
  const livePickEmpty = document.getElementById('live-pick-empty');
  const liveLastUpdated = document.getElementById('live-last-updated');

  // Live nomination + team budgets (fed by content/liveObserver.js).
  const liveNominationCard = document.getElementById('live-nomination-card');
  // Draft status pill was removed from the On the Block card (it's already
  // shown near the Live Draft Mode header). The variable stays as null so
  // any lingering guarded reads no-op instead of throwing.
  const liveNominationStatus = null;
  const liveNominationName = document.getElementById('live-nomination-name');
  const liveNominationMeta = document.getElementById('live-nomination-meta');
  const liveNominationTier = document.getElementById('live-nomination-tier');
  const liveNominationScarcity = document.getElementById('live-nomination-scarcity');
  const liveScarcityRow = document.getElementById('live-nomination-scarcity-row');
  const liveScarcityLevel = document.getElementById('live-scarcity-level');
  const liveScarcityReason = document.getElementById('live-scarcity-reason');
  const liveScarcityInfoBtn = document.getElementById('live-scarcity-info-btn');
  const liveScarcityInfoPopover = document.getElementById('live-scarcity-info-popover');
  const liveScarcityInfoDetail = document.getElementById('live-scarcity-info-detail');
  const liveScarcityInfoContext = document.getElementById('live-scarcity-info-context');
  const livePrimaryInsight = document.getElementById('live-primary-insight');
  const livePrimaryInsightHeadline = document.getElementById('live-primary-insight-headline');
  const livePrimaryInsightExplanation = document.getElementById('live-primary-insight-explanation');
  const liveValueCliff = document.getElementById('live-value-cliff');
  const liveValueCliffText = document.getElementById('live-value-cliff-text');
  const livePassConsequence = document.getElementById('live-pass-consequence');
  const livePassConsequenceHeadline = document.getElementById('live-pass-consequence-headline');
  const livePassConsequenceBlurb = document.getElementById('live-pass-consequence-blurb');
  const liveAlternatives = document.getElementById('live-nomination-alternatives');
  const liveAlternativesList = document.getElementById('live-alternatives-list');
  const liveAlternativesDepth = document.getElementById('live-alternatives-depth');
  const liveAlternativesEmpty = document.getElementById('live-alternatives-empty');
  const liveAlternativesInfoBtn = document.getElementById('live-alternatives-info-btn');
  const liveAlternativesInfoPopover = document.getElementById('live-alternatives-info-popover');
  const liveAlternativesInfoDetail = document.getElementById('live-alternatives-info-detail');
  const liveMarketSnapshotCard = document.getElementById('live-market-snapshot-card');
  const liveMarketSnapshotBody = document.getElementById('live-market-snapshot-body');
  const liveMarketSnapshotToggle = document.getElementById('live-market-snapshot-toggle');
  // Positional Market view mode. During a nomination the card renders
  // only the nominated position's row; the toggle expands to the full
  // 4-position board. State is session-scoped, no persistence.
  let marketSnapshotExpanded = false;
  // Last-rendered inputs; the toggle needs them to rerender without
  // waiting for the next live tick.
  let lastMarketSnapshotArgs = null;
  if (liveMarketSnapshotToggle) {
    liveMarketSnapshotToggle.addEventListener('click', () => {
      marketSnapshotExpanded = !marketSnapshotExpanded;
      if (lastMarketSnapshotArgs) {
        try { renderMarketSnapshotFromState(...lastMarketSnapshotArgs); }
        catch (err) { console.error('[DraftPilot] rerender market snapshot failed:', err); }
      }
    });
  }
  const liveNominationNominator = document.getElementById('live-nomination-nominator');
  const liveNominationValueBlock = document.getElementById('live-nomination-value-block');
  const liveNominationLeagueVal = document.getElementById('live-nomination-league-val');
  const liveNominationValueSource = document.getElementById('live-nomination-value-source');
  const liveNominationVerdict = document.getElementById('live-nomination-verdict');
  const liveNominationStale = document.getElementById('live-nomination-stale');
  const liveBudgetsCard = document.getElementById('live-budgets-card');
  const liveBudgetsTbody = document.getElementById('live-budgets-tbody');
  const liveBudgetsHint = document.getElementById('live-budgets-hint');
  const liveNominationYou = document.getElementById('live-nomination-you');
  const liveNomYouNeed = document.getElementById('live-nom-you-need');
  // Recommendation surface (new hierarchy: rec headline → fit/why → competition).
  const liveNominationRec = document.getElementById('live-nomination-rec');
  const liveNominationRecHeadline = document.getElementById('live-nomination-rec-headline');
  const liveNominationRecRange = document.getElementById('live-nomination-rec-range');
  const liveNominationFit = document.getElementById('live-nomination-fit');
  const liveNominationFitText = document.getElementById('live-nomination-fit-text');
  const liveNominationWhy = document.getElementById('live-nomination-why');
  const liveNominationWhyText = document.getElementById('live-nomination-why-text');
  const liveNominationComp = document.getElementById('live-nomination-comp');
  const liveNominationCompSummary = document.getElementById('live-nomination-comp-summary');
  const liveNominationCompList = document.getElementById('live-nomination-comp-list');
  const liveNominationThreat = document.getElementById('live-nomination-threat');
  const liveNominationThreatText = document.getElementById('live-nomination-threat-text');
  const liveNominationDetails = document.getElementById('live-nomination-details');
  const liveNominationDetailsSummary = document.getElementById('live-nomination-details-summary');
  const liveNominationDetailsList = document.getElementById('live-nomination-details-list'); // may be null in simplified DOM
  const liveDetailsBody = document.getElementById('live-details-body');
  // Simplified Live Mode surfaces: composed Tier-2 context sentence and
  // Tier-3 competition sentence. These replace the previous stack of
  // fit chip, why line, tier-break alert, primary insight, value cliff,
  // pass consequence, scarcity row, competition summary, and biggest-
  // threat callout — all overlapping representations of the same
  // underlying analytical signals.
  const liveContext = document.getElementById('live-context');
  const liveContextText = document.getElementById('live-context-text');
  const liveCompetition = document.getElementById('live-competition');
  const liveCompetitionText = document.getElementById('live-competition-text');
  // Collapse toggles + their bodies. Collapsed state is session-scoped
  // (module vars below); no persistence yet.
  const liveBudgetsToggle = document.getElementById('live-budgets-toggle');
  const liveBudgetsBody = document.getElementById('live-budgets-body');
  const livePicksToggle = document.getElementById('live-picks-toggle');
  const livePicksBody = document.getElementById('live-picks-body');
  const liveSuggesterToggle = document.getElementById('live-suggester-toggle');
  const liveSuggesterBody = document.getElementById('live-suggester-body');
  const liveFirstRunTip = document.getElementById('live-first-run-tip');
  const liveFirstRunTipDismiss = document.getElementById('live-first-run-tip-dismiss');
  const liveYourTeamCard = document.getElementById('live-your-team-card');
  const liveYourTeamToggle = document.getElementById('live-your-team-toggle');
  const liveYourTeamBody = document.getElementById('live-your-team-body');
  const liveYtInsight = document.getElementById('live-yt-insight');
  const liveYtNet = document.getElementById('live-yt-net');
  const liveYtNetDetail = document.getElementById('live-yt-net-detail');
  const liveYtVerdicts = document.getElementById('live-yt-verdicts');
  const liveYtVerdictsDetail = document.getElementById('live-yt-verdicts-detail');
  const liveYtElite = document.getElementById('live-yt-elite');
  const liveYtEliteDetail = document.getElementById('live-yt-elite-detail');
  const liveInflationCard = document.getElementById('live-inflation-card');
  const liveInflationToggle = document.getElementById('live-inflation-toggle');
  const liveInflationBody = document.getElementById('live-inflation-body');
  const liveInflFactor = document.getElementById('live-infl-factor');
  const liveInflWord = document.getElementById('live-infl-word');
  const liveInflArrow = document.getElementById('live-infl-arrow');
  const liveInflInterp = document.getElementById('live-infl-interp');
  const liveInflSummary = document.getElementById('live-infl-summary');
  const liveInflAdvice = document.getElementById('live-infl-advice');
  const liveInflSupport = document.getElementById('live-infl-support');
  const liveInflFreshness = document.getElementById('live-infl-freshness');
  const liveSuggesterCard = document.getElementById('live-suggester-card');
  const liveSuggesterLoadBtn = document.getElementById('live-suggester-load-btn');
  const liveSuggesterStatus = document.getElementById('live-suggester-status');
  const liveSuggesterHint = document.getElementById('live-suggester-hint');
  const liveSuggesterFootnote = document.getElementById('live-suggester-footnote');
  const nextNomStrategyBar = document.getElementById('next-nom-strategy-bar');
  const nextNomTabs = nextNomStrategyBar
    ? Array.from(nextNomStrategyBar.querySelectorAll('.next-nom-tab'))
    : [];
  const nextNomRecommends = document.getElementById('next-nom-recommends');
  const nextNomRecommendsValue = document.getElementById('next-nom-recommends-value');
  const nextNomAvoidToggle = document.getElementById('next-nom-avoid-toggle');
  const nextNomPrimary = document.getElementById('next-nom-primary');
  const nextNomStrategy = document.getElementById('next-nom-strategy');
  const nextNomName = document.getElementById('next-nom-name');
  const nextNomMeta = document.getElementById('next-nom-meta');
  const nextNomValue = document.getElementById('next-nom-value');
  const nextNomMarket = document.getElementById('next-nom-market');
  const nextNomBidders = document.getElementById('next-nom-bidders');
  const nextNomBiddersList = document.getElementById('next-nom-bidders-list');
  const nextNomReason = document.getElementById('next-nom-reason');
  const nextNomAction = document.getElementById('next-nom-action');
  const nextNomOthers = document.getElementById('next-nom-others');
  const nextNomOthersList = document.getElementById('next-nom-others-list');
  const nextNomEmpty = document.getElementById('next-nom-empty');

  const usernameInput = document.getElementById('username-input');
  const syncBtn = document.getElementById('sync-btn');
  const syncStatus = document.getElementById('sync-status');

  const draftDayCard = document.getElementById('draft-day-card');
  const draftDayTitle = document.getElementById('draft-day-title');
  const draftDayBody = document.getElementById('draft-day-body');
  const draftDayBtn = document.getElementById('draft-day-btn');

  const syncCelebration = document.getElementById('sync-celebration');
  const syncedSummary = document.getElementById('synced-summary');
  const syncStatusBar = document.getElementById('sync-status-bar');
  const syncStatusValue = document.getElementById('sync-status-value');
  const resyncBtn = document.getElementById('resync-btn');
  const draftValuesTitle = document.getElementById('draft-values-title');
  const exportCurrentBtn = document.getElementById('export-current-btn');
  const exportStatus = document.getElementById('export-status');

  const exportAllXlsxBtn = document.getElementById('export-all-xlsx-btn');
  const exportAllCsvBtn = document.getElementById('export-all-csv-btn');
  const pastStatus = document.getElementById('past-status');

  const draftList = document.getElementById('draft-list');

  // Populated by sync (or restored from storage on load); reused by all
  // three "Export All" buttons so they don't re-fetch the league list.
  let loadedLeagues = [];

  // Session-scoped: true only while the user is looking at the immediate
  // result of a Sync click. Resets when the panel is closed, so returning
  // sessions get the condensed status row instead of the celebration.
  let justSyncedInSession = false;

  // ---------- helpers --------------------------------------------------------
  // Sleeper's league.roster_positions is an array like
  // ['QB','RB','RB','WR','WR','TE','FLEX','SUPER_FLEX','BN',...].
  // Rolling count gives us the {QB,RB,WR,TE,FLEX,SUPER_FLEX,K,DEF,BN}
  // shape the scarcity engine expects.
  function countRosterSlots(rosterPositions) {
    const out = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPER_FLEX: 0, K: 0, DEF: 0, BN: 0 };
    for (const slot of rosterPositions || []) {
      if (slot in out) out[slot]++;
    }
    return out;
  }

  function setStatus(el, text, kind) {
    el.textContent = text || '';
    el.className = 'status' + (kind ? ` ${kind}` : '');
  }

  function friendlyErrorMessage(err) {
    if (!err) return 'Something went wrong.';
    return err.userMessage || err.message || String(err);
  }

  function relativeTime(ts) {
    const seconds = Math.round((Date.now() - ts) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  }

  function getActiveTab() {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve(tabs[0]);
      });
    });
  }

  function sendExportMessage(tabId) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { type: 'DRAFTPILOT_EXPORT' }, (response) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve(response);
      });
    });
  }

  // ---------- theme ----------------------------------------------------------
  const THEME_KEY = 'themePreference'; // 'system' | 'light' | 'dark'

  function applyTheme(preference) {
    const root = document.documentElement;
    if (preference === 'light' || preference === 'dark') {
      root.setAttribute('data-theme', preference);
    } else {
      // "system": remove the override attribute so prefers-color-scheme wins.
      root.removeAttribute('data-theme');
    }
    // Reflect the current selection in the menu for aria + checkmark.
    for (const item of settingsMenu.querySelectorAll('.settings-menu-item')) {
      const v = item.dataset.themeValue;
      const selected = (preference || 'system') === v;
      item.setAttribute('aria-checked', String(selected));
    }
  }

  async function loadTheme() {
    let preference = 'system';
    try {
      const stored = await storage.get(THEME_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        preference = stored;
      }
    } catch (err) {
      // storage read fail is non-fatal -- fall through to system default.
    }
    applyTheme(preference);
  }

  async function setThemePreference(preference) {
    applyTheme(preference);
    try {
      await storage.set(THEME_KEY, preference);
    } catch (err) {
      // Non-critical.
    }
  }

  // System-preference change should propagate immediately when the user's
  // choice is "system"; the OS switching light/dark shouldn't require a
  // popup reopen. When they've explicitly picked light or dark, we ignore.
  themeMediaQuery.addEventListener('change', async () => {
    const stored = await storage.get(THEME_KEY).catch(() => null);
    if (stored !== 'light' && stored !== 'dark') applyTheme('system');
  });

  // ---------- settings menu open/close --------------------------------------
  function openSettingsMenu() {
    settingsMenu.hidden = false;
    settingsBtn.setAttribute('aria-expanded', 'true');
  }
  function closeSettingsMenu() {
    settingsMenu.hidden = true;
    settingsBtn.setAttribute('aria-expanded', 'false');
  }
  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsMenu.hidden ? openSettingsMenu() : closeSettingsMenu();
  });
  document.addEventListener('click', (e) => {
    if (!settingsMenu.hidden && !settingsMenu.contains(e.target) && e.target !== settingsBtn) {
      closeSettingsMenu();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !settingsMenu.hidden) closeSettingsMenu();
  });
  // Theme choices apply-and-close. Non-theme items (Send feedback, Privacy
  // policy) still close the menu on click but keep their native <a>
  // navigation intact.
  for (const item of settingsMenu.querySelectorAll('.settings-menu-item')) {
    item.addEventListener('click', () => {
      if (item.dataset.themeValue) setThemePreference(item.dataset.themeValue);
      closeSettingsMenu();
    });
  }

  // ---------- view swap: welcome vs synced -----------------------------------
  function showWelcomeView() {
    welcomeView.hidden = false;
    syncedView.hidden = true;
    liveDraftView.hidden = true;
    userBar.hidden = true;
  }

  function showLiveDraftView() {
    welcomeView.hidden = true;
    syncedView.hidden = true;
    liveDraftView.hidden = false;
    userBar.hidden = false;
    // Kick off session bootstrap. Kept out of the view-swap helper so
    // that view-swap stays cheap and side-effect-free where possible.
    enterLiveDraftMode();
  }
  function showSyncedView(cache, savedUsername) {
    welcomeView.hidden = true;
    syncedView.hidden = false;
    liveDraftView.hidden = true;
    userBar.hidden = false;
    usernameDisplay.textContent = savedUsername || '';
    // Two mutually-exclusive sync affordances: the full celebration only
    // right after the user clicks Sync, or the condensed status bar on
    // every subsequent panel open.
    if (justSyncedInSession) {
      syncCelebration.hidden = false;
      syncStatusBar.hidden = true;
      renderSyncedSummary(cache);
    } else {
      syncCelebration.hidden = true;
      syncStatusBar.hidden = false;
      renderSyncStatusBar(cache);
    }
    renderDraftValuesTitle();
    renderDraftList(cache.leagues || []);
  }

  function formatSyncedAt(ts) {
    if (!ts) return 'Synced';
    const d = new Date(ts);
    const today = new Date();
    const sameDay =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate();
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (sameDay) return `Synced today at ${time}`;
    const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `Synced ${date} at ${time}`;
  }

  function renderSyncStatusBar(cache) {
    syncStatusValue.textContent = formatSyncedAt(cache && cache.cachedAt);
    syncStatusValue.className = 'sync-status-value';
  }

  changeUserBtn.addEventListener('click', () => {
    // Return to welcome view so the user can enter a new username.
    // We deliberately don't wipe the cache -- a bad username entry
    // shouldn't destroy their existing synced data. The next successful
    // sync overwrites it.
    showWelcomeView();
    setStatus(syncStatus, '');
  });

  // Refresh icon in the status bar: silent in-place re-sync that doesn't
  // swap back to the welcome view. Uses the already-stored username so
  // the user doesn't have to re-enter it.
  resyncBtn.addEventListener('click', async () => {
    const username = (await storage.get('sleeperUsername').catch(() => null)) || '';
    if (!username) return;
    resyncBtn.disabled = true;
    resyncBtn.classList.add('is-spinning');
    syncStatusValue.textContent = 'Syncing…';
    syncStatusValue.className = 'sync-status-value is-loading';
    try {
      const user = await sleeperApi.getUserByUsername(username);
      if (!user) throw new Error(`No Sleeper user "${username}".`);
      const leagues = await pastDrafts.fetchLeagues(user.user_id, SEASONS);
      if (!leagues.length) throw new Error('No past drafts found for that account.');
      const cache = await pastDrafts.cacheLeagueAnalysis(leagues, {
        userId: user.user_id,
      });
      if (!cache || !cache.seasonsAnalyzed) throw new Error("Sync couldn't complete.");
      renderSyncStatusBar(cache);
      renderDraftList(cache.leagues || []);
      await updateDraftDayVisibility();
    } catch (err) {
      syncStatusValue.textContent = `Sync failed — ${friendlyErrorMessage(err)}`;
      syncStatusValue.className = 'sync-status-value is-error';
    } finally {
      resyncBtn.disabled = false;
      resyncBtn.classList.remove('is-spinning');
    }
  });

  // ---------- synced summary + draft values title ---------------------------
  function renderSyncedSummary(cache) {
    syncedSummary.innerHTML = '';
    if (!cache) return;
    const items = [];
    if (cache.seasonsAnalyzed) {
      items.push(
        `${cache.seasonsAnalyzed} past draft${cache.seasonsAnalyzed === 1 ? '' : 's'}`
      );
    }
    // The formatLabel is a human string like "Superflex · Half-PPR · 12
    // teams · $200 budget"; split it back into bullets for readability.
    if (cache.formatLabel) {
      for (const part of cache.formatLabel.split(' · ')) items.push(part);
    }
    for (const text of items) {
      const li = document.createElement('li');
      li.textContent = text;
      syncedSummary.appendChild(li);
    }
  }

  function renderDraftValuesTitle() {
    // Card title uses the current year automatically -- rolls over on
    // Jan 1 so it always reads as "this year's draft values".
    draftValuesTitle.textContent = `${new Date().getFullYear()} Draft Values`;
    exportCurrentBtn.textContent = `Export ${new Date().getFullYear()} Values`;
  }

  // ---------- individual drafts list ----------------------------------------
  function renderDraftList(leagues) {
    draftList.innerHTML = '';
    if (!leagues || !leagues.length) return;
    loadedLeagues = leagues;
    leagues
      .slice()
      .sort(
        (a, b) => b.season.localeCompare(a.season) || a.leagueName.localeCompare(b.leagueName)
      )
      .forEach((league) => {
        const li = document.createElement('li');
        li.className = 'draft-list-item';

        const info = document.createElement('div');
        info.className = 'draft-info';
        const name = document.createElement('div');
        name.className = 'draft-name';
        name.textContent = league.leagueName;
        const meta = document.createElement('div');
        meta.className = 'draft-meta';
        meta.textContent = `${league.season} · ${league.status || 'complete'}`;
        info.appendChild(name);
        info.appendChild(meta);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-secondary btn-tiny';
        btn.textContent = 'Export';
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          btn.textContent = 'Exporting…';
          try {
            const result = await pastDrafts.exportDraft(league);
            btn.textContent = 'Done ✓';
            setStatus(
              pastStatus,
              `Exported ${result.pickCount} picks from ${league.leagueName} (${league.season}) ✓`,
              'success'
            );
          } catch (err) {
            btn.disabled = false;
            btn.textContent = 'Retry';
            setStatus(pastStatus, `Export failed: ${friendlyErrorMessage(err)}`, 'error');
          }
        });

        li.appendChild(info);
        li.appendChild(btn);
        draftList.appendChild(li);
      });
  }

  // ---------- Draft Day card ------------------------------------------------
  // Shown only on the day one of the user's leagues has a scheduled draft.
  // Data comes from cache.upcomingDrafts (populated during sync from
  // current-year league draft metadata).

  function isSameLocalDay(unixMs) {
    const d = new Date(unixMs);
    const now = new Date();
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  }

  function formatDraftTime(unixMs) {
    return new Date(unixMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  async function updateDraftDayVisibility() {
    if (syncedView.hidden) {
      draftDayCard.hidden = true;
      return;
    }
    const cache = await storage.get('leagueTierAggregates').catch(() => null);
    const upcoming = (cache && cache.upcomingDrafts) || [];
    const todaysDraft = upcoming.find((d) => d.startTime && isSameLocalDay(d.startTime));
    if (!todaysDraft) {
      draftDayCard.hidden = true;
      return;
    }
    draftDayTitle.textContent = `It's Draft Day for ${todaysDraft.leagueName}!`;
    draftDayBody.textContent = `Draft starts at ${formatDraftTime(todaysDraft.startTime)}. Open the draft room, then export it here to guide your picks.`;
    draftDayCard.hidden = false;
  }

  // ---------- current-draft export (shared by both buttons) -----------------
  async function runCurrentDraftExport(btn, statusEl) {
    const originalLabel = btn.textContent;
    btn.disabled = true;
    setStatus(statusEl, 'Checking page…');
    try {
      const tab = await getActiveTab();
      if (!tab || !tab.url || !DRAFT_URL_PATTERN.test(tab.url)) {
        setStatus(statusEl, 'Open a Sleeper draft room in another tab to export.', 'error');
        return;
      }
      setStatus(statusEl, 'Exporting…');
      const response = await sendExportMessage(tab.id);
      if (response && response.success) {
        setStatus(statusEl, `Exported ${response.count} players ✓`, 'success');
      } else {
        setStatus(statusEl, (response && response.error) || 'Export failed.', 'error');
      }
    } catch (err) {
      const raw = err && err.message ? err.message : '';
      if (/Receiving end does not exist|Could not establish connection/i.test(raw)) {
        setStatus(
          statusEl,
          "Draft Pilot isn't running on that tab yet. Reload the draft page and try again.",
          'error'
        );
      } else {
        setStatus(statusEl, `Export failed: ${friendlyErrorMessage(err)}`, 'error');
      }
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }
  exportCurrentBtn.addEventListener('click', () =>
    runCurrentDraftExport(exportCurrentBtn, exportStatus)
  );
  // Draft Day card CTA and settings menu entry both route into live mode.
  // Live mode is a placeholder for now; its export button reuses the same
  // current-draft-room export flow.
  draftDayBtn.addEventListener('click', showLiveDraftView);
  enterLiveModeBtn.addEventListener('click', showLiveDraftView);
  liveExportBtn.addEventListener('click', () =>
    runCurrentDraftExport(liveExportBtn, liveExportStatus)
  );
  // Back button returns to pre-draft analysis without triggering a
  // celebration or refetch -- the cache is still valid.
  backToAnalysisBtn.addEventListener('click', async () => {
    stopLiveSession();
    const [savedUsername, cache] = await Promise.all([
      storage.get('sleeperUsername').catch(() => null),
      storage.get('leagueTierAggregates').catch(() => null),
    ]);
    if (cache && cache.cachedAt && cache.seasonsAnalyzed) {
      showSyncedView(cache, savedUsername || '');
      await updateDraftDayVisibility();
    } else {
      showWelcomeView();
    }
  });

  // ---------- live draft mode -----------------------------------------------
  // Session lifecycle: showLiveDraftView -> enterLiveDraftMode picks a
  // draftId (from active tab or user picker) -> startLiveSession creates
  // a poller (utils/liveDraft.js) -> renderLiveState paints on every
  // state update. stopLiveSession tears the poller down.

  let activeLiveSession = null;
  let liveUnsubscribe = null;
  let renderedPickNos = new Set();
  let lastUpdatedTicker = null;

  // Latest state pushed from the content-script scraper. Kept separate
  // from the API session state because it updates on a different
  // cadence (DOM mutations vs. 5s picks-poll).
  let latestLiveDomState = null; // { nomination, teams, timestamp }
  let liveStaleTicker = null;
  // Inflation trajectory: rolling samples of (picksMade, factor) so we
  // can show a trend indicator ("+12% now, +4% ten picks ago"). Cleared
  // when the live session ends. Capped so it doesn't grow forever
  // during a 200-pick draft.
  const inflationSamples = []; // sorted by picksMade ascending
  const INFLATION_SAMPLE_CAP = 60;
  // Lookback window: compare current factor against the OLDEST sample
  // that's at least this many picks in the past. 5 picks = fresh
  // enough to be relevant, old enough to have moved.
  const INFLATION_TREND_LOOKBACK_PICKS = 5;
  // Nominator map keyed by normalized player name -- populated as we
  // observe live nominations (the opening bidder in the bid stack is
  // the nominator). Picks that landed BEFORE Live Mode was opened
  // won't have an entry; we silently omit "Nominated by" there.
  const nominatorsByPlayer = new Map(); // key: normPlayerKey, val: nominator
  function normPlayerKey(name, position) {
    if (!name) return '';
    return `${String(name).trim().toLowerCase()}|${String(position || '').toLowerCase()}`;
  }
  const LIVE_DOM_STALE_MS = 12000;
  // Bundle every identity signal we have (user_id + all known name
  // variants from the league, plus the typed-in username as fallback)
  // into a single object for liveDraft.resolveYourTeam / isYouByName.
  // Recomputed per render so a mid-panel sync picks up new state.
  function currentIdentity(session) {
    return {
      userId: cachedUserId || null,
      username: cachedUsername || null,
      usersById: (session && session.usersById) || null,
    };
  }
  const YOUR_USERNAME_KEY = 'sleeperUsername';
  // Stable Sleeper user_id resolved from the username at sync time.
  // Used as the anchor for identity matching against the DOM-scraped
  // team columns — see liveDraft.resolveYourTeam. The username alone
  // is fragile because Sleeper's UI may render display_name or
  // team_name in the header depending on browser / state.
  const YOUR_USER_ID_KEY = 'sleeperUserId';
  let cachedUsername = '';
  let cachedUserId = '';
  // Cached tier data drives the league-value calc for the nominated
  // player. Loaded once at popup init and refreshed on each sync -- the
  // aggregates change slowly (only after a sync recomputes them), so a
  // stale copy while the panel is open is fine.
  let cachedTierAggregates = null;
  storage.get(YOUR_USERNAME_KEY).then((v) => { cachedUsername = v || ''; }).catch(() => {});
  storage.get(YOUR_USER_ID_KEY).then(async (v) => {
    cachedUserId = v || '';
    // Backfill for users who synced before user_id was stored. Cheap
    // one-time lookup; silent on failure (they'll fall back to the
    // pre-league-sync username-only match path, same as before).
    if (!cachedUserId && cachedUsername) {
      try {
        const user = await sleeperApi.getUserByUsername(cachedUsername);
        if (user && user.user_id) {
          cachedUserId = user.user_id;
          await storage.set(YOUR_USER_ID_KEY, user.user_id);
        }
      } catch (_) { /* offline / rate-limited — retry on next popup open */ }
    }
  }).catch(() => {});
  storage.get('leagueTierAggregates').then((c) => {
    if (c && c.tierAggregates) cachedTierAggregates = c.tierAggregates;
  }).catch(() => {});

  function hideLiveSubsections() {
    liveNoDraft.hidden = true;
    liveConnecting.hidden = true;
    liveError.hidden = true;
    liveActive.hidden = true;
    // Clear the live-DOM-fed cards so they don't flash stale content
    // when returning to the view.
    liveNominationCard.hidden = true;
    liveBudgetsCard.hidden = true;
    liveInflationCard.hidden = true;
    if (liveAvailableCard) liveAvailableCard.hidden = true;
    const proto = document.getElementById('live-nomination-prototype-card');
    if (proto) proto.hidden = true;
  }

  function stopLiveSession() {
    if (liveUnsubscribe) { try { liveUnsubscribe(); } catch (_) {} liveUnsubscribe = null; }
    if (activeLiveSession) { try { activeLiveSession.stop(); } catch (_) {} activeLiveSession = null; }
    if (lastUpdatedTicker) { clearInterval(lastUpdatedTicker); lastUpdatedTicker = null; }
    if (liveStaleTicker) { clearInterval(liveStaleTicker); liveStaleTicker = null; }
    latestLiveDomState = null;
    renderedPickNos = new Set();
    nominatorsByPlayer.clear();
    inflationSamples.length = 0;
    _suggesterDefaultApplied = false;
    nextNomState.userChoice = null;
    nextNomState.showingAvoid = false;
  }

  // Collapsible card headers -- session-scoped state, no persistence.
  // Two cards get the treatment (team budgets + completed picks); their
  // header buttons already carry aria-expanded so we drive both the
  // hidden body and the button state from one small helper.
  function wireCollapse(toggleEl, bodyEl) {
    if (!toggleEl || !bodyEl) return;
    toggleEl.addEventListener('click', () => {
      const expanded = toggleEl.getAttribute('aria-expanded') !== 'false';
      const next = !expanded;
      toggleEl.setAttribute('aria-expanded', String(next));
      bodyEl.hidden = !next;
    });
  }
  wireCollapse(liveBudgetsToggle, liveBudgetsBody);
  wireCollapse(livePicksToggle, livePicksBody);
  wireCollapse(liveSuggesterToggle, liveSuggesterBody);
  wireCollapse(liveYourTeamToggle, liveYourTeamBody);
  wireCollapse(liveInflationToggle, liveInflationBody);

  // Nomination suggester: pool snapshot lives in chrome.storage.local
  // (written by the content script on either "Export My Draft Room" or
  // an explicit capture). Popup subscribes to storage changes so a
  // capture triggered mid-Live-Mode reflects immediately.
  let cachedPlayerPool = null;
  let _suggesterDefaultApplied = false;
  // Next Nomination strategy state — session-scoped. userChoice is null
  // until the manager clicks a tab; the render uses the engine's
  // `recommended` strategy in that case. Manual selections persist
  // across draft events (see renderSuggester + stopLiveSession).
  const nextNomState = { userChoice: null, showingAvoid: false };
  const POOL_STORAGE_KEY = 'playerPool';
  const POOL_MAX_AGE_MS = 60 * 60 * 1000; // 1h -- projections don't shift in-draft

  async function hydratePlayerPool() {
    const stored = await storage.get(POOL_STORAGE_KEY).catch(() => null);
    if (!stored || !stored.players || !stored.capturedAt) {
      cachedPlayerPool = null;
      return;
    }
    if (Date.now() - stored.capturedAt > POOL_MAX_AGE_MS) {
      cachedPlayerPool = null;
      return;
    }
    cachedPlayerPool = stored;
  }

  // React to background/content writes to the pool. Keeps the popup
  // in sync when the user triggers "Export My Draft Room" from the
  // pre-draft view and then flips over to Live Mode.
  if (chrome && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      const change = changes[`draftpilot:${POOL_STORAGE_KEY}`];
      if (!change) return;
      const val = change.newValue;
      if (val && val.players && val.capturedAt && Date.now() - val.capturedAt <= POOL_MAX_AGE_MS) {
        cachedPlayerPool = val;
      } else {
        cachedPlayerPool = null;
      }
      if (!liveDraftView.hidden) {
        renderSuggester();
        renderAvailablePlayers();
        maybeShowFirstRunTip();
      }
    });
  }

  liveSuggesterLoadBtn.addEventListener('click', async () => {
    liveSuggesterLoadBtn.disabled = true;
    setStatus(liveSuggesterStatus, 'Capturing player pool from the draft board…');
    try {
      const tab = await getActiveTab();
      if (!tab || !tab.url || !DRAFT_URL_PATTERN.test(tab.url)) {
        setStatus(liveSuggesterStatus, 'Open the Sleeper draft room in another tab first.', 'error');
        return;
      }
      const resp = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tab.id, { type: 'DRAFTPILOT_CAPTURE_POOL' }, (r) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          resolve(r);
        });
      });
      if (!resp || !resp.success) {
        setStatus(liveSuggesterStatus, (resp && resp.error) || 'Capture failed.', 'error');
        return;
      }
      setStatus(liveSuggesterStatus, `Captured ${resp.count} players ✓`, 'success');
      // storage.onChanged will hydrate + trigger a suggester re-render.
    } catch (err) {
      const raw = err && err.message ? err.message : '';
      const msg = /Receiving end does not exist|Could not establish connection/i.test(raw)
        ? "Draft Pilot isn't running on that tab yet. Reload the draft page and try again."
        : `Capture failed: ${friendlyErrorMessage(err)}`;
      setStatus(liveSuggesterStatus, msg, 'error');
    } finally {
      liveSuggesterLoadBtn.disabled = false;
    }
  });

  // First-run tip: shown once per user account (persisted via storage)
  // when Live Mode is opened without a pool loaded. Silently no-ops
  // when either condition doesn't apply.
  const FIRST_RUN_TIP_KEY = 'liveFirstRunTipDismissed';
  let firstRunTipDismissed = false;
  storage.get(FIRST_RUN_TIP_KEY).then((v) => {
    firstRunTipDismissed = v === true;
  }).catch(() => {});

  function maybeShowFirstRunTip() {
    if (firstRunTipDismissed) { liveFirstRunTip.hidden = true; return; }
    if (cachedPlayerPool) { liveFirstRunTip.hidden = true; return; }
    if (liveDraftView.hidden) { liveFirstRunTip.hidden = true; return; }
    // Auction-only: the tip references the Suggested nominations card
    // which doesn't render for snake drafts.
    const session = activeLiveSession && activeLiveSession.getState();
    if (!session || !session.isAuction) { liveFirstRunTip.hidden = true; return; }
    liveFirstRunTip.hidden = false;
  }

  liveFirstRunTipDismiss.addEventListener('click', () => {
    firstRunTipDismissed = true;
    liveFirstRunTip.hidden = true;
    storage.set(FIRST_RUN_TIP_KEY, true).catch(() => {});
  });

  function renderSuggester() {
    // Only meaningful for auction drafts. Feature-flag gated: this is
    // recommendation surface, not raw data.
    const session = activeLiveSession && activeLiveSession.getState();
    if (!session || !session.isAuction || session.status !== 'active') {
      liveSuggesterCard.hidden = true;
      return;
    }
    if (!featureFlags.isEnabled('bidRecommendations')) {
      liveSuggesterCard.hidden = true;
      return;
    }
    liveSuggesterCard.hidden = false;

    // Reset render slots — one branch below sets what should show.
    nextNomPrimary.hidden = true;
    nextNomOthers.hidden = true;
    nextNomEmpty.hidden = true;

    // No pool yet — show the load button; nothing else to render.
    if (!cachedPlayerPool) {
      liveSuggesterLoadBtn.hidden = false;
      liveSuggesterLoadBtn.textContent = 'Load full player pool';
      if (liveSuggesterHint) liveSuggesterHint.hidden = false;
      liveSuggesterFootnote.hidden = true;
      return;
    }
    if (liveSuggesterHint) liveSuggesterHint.hidden = true;

    liveSuggesterLoadBtn.hidden = false;
    liveSuggesterLoadBtn.textContent = 'Refresh player pool';

    const teams = (latestLiveDomState && latestLiveDomState.teams) || [];

    // Reuse the live inflation factor already computed for the
    // nomination card so the value ranges here match what the manager
    // sees on the current-nomination card.
    let inflationFactor = 1;
    if (teams.length && session.draft) {
      const slotsPerTeam = liveDraft.rosterSlotsPerTeam(session.draft);
      const startingBudgetPerTeam =
        (session.draft && session.draft.settings && session.draft.settings.budget) || 200;
      inflationFactor = liveDraft.computeLiveInflation({
        teams,
        startingBudgetPerTeam,
        slotsPerTeam,
      });
    }

    const strategyRec = liveDraft.computeStrategyRecommendations({
      pool: cachedPlayerPool,
      completedPicks: session.picks || [],
      teams,
      tierAggregates: cachedTierAggregates,
      yourManager: cachedUsername,
      yourIdentity: currentIdentity(session),
      league: session.league,
      inflationFactor,
    });

    // Active tab: AVOID overlay > user's explicit choice > engine default.
    // If the user's chosen tab has no candidates right now, we still
    // honor their choice (the empty state explains what happened) —
    // silently switching them back to "recommended" would erase their
    // override without telling them.
    let active = 'DRAIN';
    if (nextNomState.showingAvoid) {
      active = 'AVOID';
    } else if (nextNomState.userChoice) {
      active = nextNomState.userChoice;
    } else if (strategyRec && strategyRec.recommended) {
      active = strategyRec.recommended === 'AVOID'
        ? 'DRAIN' // if the engine's default is AVOID, seed a primary
        : strategyRec.recommended;
    }

    renderNextNomTabs(active, strategyRec ? strategyRec.recommended : null);

    // Show the AVOID toggle whenever an AVOID candidate exists, so the
    // manager knows the option is available — even if the current tab
    // is one of the primary three.
    const avoidBundle = strategyRec && strategyRec.byStrategy && strategyRec.byStrategy.AVOID;
    const hasAvoid = !!(avoidBundle && avoidBundle.primary);
    nextNomAvoidToggle.hidden = !hasAvoid && !nextNomState.showingAvoid;
    if (nextNomState.showingAvoid) {
      nextNomAvoidToggle.textContent = 'Back to strategies';
      nextNomAvoidToggle.classList.add('is-avoiding');
    } else {
      nextNomAvoidToggle.textContent = 'Show players to avoid';
      nextNomAvoidToggle.classList.remove('is-avoiding');
    }

    const rec = strategyRec && strategyRec.byStrategy
      ? strategyRec.byStrategy[active]
      : null;

    // Default expand/collapse — apply once per session, then leave the
    // user's manual choice alone. Late in the draft or while a player
    // is on the block, the section starts collapsed.
    if (!_suggesterDefaultApplied && liveSuggesterToggle && liveSuggesterBody) {
      const slotsPerTeam = liveDraft.rosterSlotsPerTeam(session.draft);
      const totalSlots = slotsPerTeam * (teams.length || 0);
      let totalDrafted = 0;
      for (const t of teams) totalDrafted += Number(t.rosterCount) || 0;
      const progress = totalSlots > 0 ? totalDrafted / totalSlots : 0;
      const nomActive = latestLiveDomState
        && latestLiveDomState.nomination
        && latestLiveDomState.nomination.playerName;
      const shouldCollapse = progress >= 0.7 || !!nomActive;
      liveSuggesterToggle.setAttribute('aria-expanded', shouldCollapse ? 'false' : 'true');
      liveSuggesterBody.hidden = shouldCollapse;
      _suggesterDefaultApplied = true;
    }

    if (!rec || !rec.primary) {
      // Strategy-specific empty copy so the manager understands why the
      // list is blank on the tab they chose — not just "no clear nom."
      const emptyLabel = nextNomEmpty.querySelector('.next-nom-strategy');
      const emptyReason = nextNomEmpty.querySelector('.next-nom-reason');
      if (emptyLabel && emptyReason) {
        if (active === 'TARGET') {
          emptyLabel.textContent = 'No TARGET available';
          emptyReason.textContent = 'Nothing available fits your roster and budget right now. Try Drain or Distract, or wait for the pool to shift.';
        } else if (active === 'DRAIN') {
          emptyLabel.textContent = 'No DRAIN available';
          emptyReason.textContent = 'No player would meaningfully burn a rival budget right now.';
        } else if (active === 'DISTRACT') {
          emptyLabel.textContent = 'No DISTRACT available';
          emptyReason.textContent = 'No attention-magnet player without pulling attention onto your own targets.';
        } else if (active === 'AVOID') {
          emptyLabel.textContent = 'Nothing to avoid';
          emptyReason.textContent = 'No player poses a "do not nominate" risk right now.';
        } else {
          emptyLabel.textContent = 'No clear nomination';
          emptyReason.textContent = 'Hold off until the next player changes the room.';
        }
      }
      nextNomEmpty.hidden = false;
      liveSuggesterFootnote.hidden = false;
      liveSuggesterFootnote.textContent = teams.length
        ? `Updated ${relativeTime(cachedPlayerPool.capturedAt)}`
        : 'Recommendations activate once the draft-room DOM feed connects.';
      return;
    }

    renderNextNomPrimary(rec.primary);
    renderNextNomOthers(rec.secondaries || []);

    liveSuggesterFootnote.hidden = false;
    liveSuggesterFootnote.textContent = `Updated ${relativeTime(cachedPlayerPool.capturedAt)}`;
  }

  function strategyLabel(s) {
    if (s === 'DRAIN') return 'Drain budgets';
    if (s === 'DISTRACT') return 'Distract';
    if (s === 'TARGET') return 'Target';
    if (s === 'AVOID') return 'Avoid nominating';
    if (s === 'WAIT') return 'Wait';
    return '';
  }

  function strategyClass(s) {
    if (s === 'DRAIN') return 'is-drain';
    if (s === 'DISTRACT') return 'is-distract';
    if (s === 'TARGET') return 'is-target';
    if (s === 'AVOID') return 'is-wait';
    if (s === 'WAIT') return 'is-wait';
    return '';
  }

  function formatValueRange(range) {
    if (!range) return '';
    if (range.low === range.high) return `Est. $${range.low}`;
    return `Est. $${range.low}–${range.high}`;
  }

  function metaLine(c) {
    const parts = [];
    if (c.position) parts.push(c.position);
    if (c.team) parts.push(c.team);
    if (c.tier && c.tier.tierIndex != null) parts.push(`Tier ${c.tier.tierIndex + 1}`);
    return parts.join(' · ');
  }

  function reasonFor(c) {
    if (!c) return '';
    // Reason no longer names bidders — the Likely bidders block does.
    // Keeping reason as the strategic why avoids duplicating the same
    // manager names twice in the same card.
    if (c.strategy === 'DRAIN') {
      const budgetHint = c.budgetHeavyCount >= 2
        ? 'have big budgets to burn'
        : 'have budget to spend';
      return `Multiple ${c.position}-needy teams ${budgetHint} on this tier.`;
    }
    if (c.strategy === 'DISTRACT') {
      return `Likely to attract bids from rival teams — money you'd rather see spent here than on your targets.`;
    }
    if (c.strategy === 'TARGET') {
      return `Fits your roster and you have the budget${c.yourMaxBid ? ` ($${c.yourMaxBid} left)` : ''}. Buy now before scarcity lifts the price.`;
    }
    if (c.strategy === 'WAIT' || c.strategy === 'AVOID') {
      const topName = c.topBidders && c.topBidders[0] && c.topBidders[0].manager;
      const rival = topName ? topName : 'A rival';
      const budget = c.topBidders && c.topBidders[0] && c.topBidders[0].maxBid
        ? ` ($${c.topBidders[0].maxBid} left)` : '';
      return `${rival}${budget} is likely to bid aggressively and expose your need at ${c.position}. Wait for their budget to shrink.`;
    }
    return '';
  }

  function renderMarketDelta(deltaPct) {
    if (deltaPct == null || Math.abs(deltaPct) < 8) {
      nextNomMarket.hidden = true;
      nextNomMarket.className = 'next-nom-market';
      nextNomMarket.textContent = '';
      return;
    }
    const up = deltaPct > 0;
    nextNomMarket.hidden = false;
    nextNomMarket.className = 'next-nom-market ' + (up ? 'is-up' : 'is-down');
    nextNomMarket.textContent = `Market ${up ? '+' : ''}${deltaPct}%`;
  }

  function renderBidders(topBidders) {
    nextNomBiddersList.innerHTML = '';
    if (!topBidders || !topBidders.length) {
      nextNomBidders.hidden = true;
      return;
    }
    nextNomBidders.hidden = false;
    for (const b of topBidders) {
      const li = document.createElement('li');
      li.className = 'next-nom-bidder';
      const name = document.createElement('span');
      name.className = 'next-nom-bidder-name';
      name.textContent = b.manager || 'Unknown';
      const budget = document.createElement('span');
      budget.className = 'next-nom-bidder-budget';
      budget.textContent = `$${b.maxBid || 0}`;
      li.appendChild(name);
      li.appendChild(budget);
      nextNomBiddersList.appendChild(li);
    }
  }

  function renderNextNomTabs(active, recommended) {
    // Bar is only meaningful once we have a session; leave hidden if
    // the caller passes nothing meaningful.
    nextNomStrategyBar.hidden = false;
    // AVOID mode grays the tab bar (no tab is "active" among the three
    // primary strategies while the manager is inspecting AVOID).
    const barActive = nextNomState.showingAvoid ? null : active;
    for (const tab of nextNomTabs) {
      const s = tab.dataset.strategy;
      const isActive = s === barActive;
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      tab.tabIndex = isActive ? 0 : -1;
    }
    // Focus fallback — if no tab is selectable, make the first tab
    // keyboard-reachable so users can still tab into the control.
    if (!barActive && nextNomTabs.length) nextNomTabs[0].tabIndex = 0;

    // "Draft Pilot recommends" — only when the user hasn't overridden
    // and only when the engine has a recommendation to share.
    if (!nextNomState.userChoice && !nextNomState.showingAvoid && recommended) {
      nextNomRecommends.hidden = false;
      // Short form (single word) to keep the line one row on narrow
      // extension widths.
      nextNomRecommendsValue.textContent = recommended;
    } else {
      nextNomRecommends.hidden = true;
    }
  }

  // Tab wiring — click sets user's choice; ArrowLeft/ArrowRight cycles.
  for (const tab of nextNomTabs) {
    tab.addEventListener('click', () => {
      const s = tab.dataset.strategy;
      if (!s) return;
      nextNomState.userChoice = s;
      nextNomState.showingAvoid = false;
      renderSuggester();
    });
    tab.addEventListener('keydown', (evt) => {
      if (evt.key !== 'ArrowLeft' && evt.key !== 'ArrowRight') return;
      const idx = nextNomTabs.indexOf(tab);
      if (idx < 0) return;
      const next = evt.key === 'ArrowRight'
        ? nextNomTabs[(idx + 1) % nextNomTabs.length]
        : nextNomTabs[(idx - 1 + nextNomTabs.length) % nextNomTabs.length];
      if (next) {
        next.focus();
        next.click();
      }
      evt.preventDefault();
    });
  }

  if (nextNomAvoidToggle) {
    nextNomAvoidToggle.addEventListener('click', () => {
      nextNomState.showingAvoid = !nextNomState.showingAvoid;
      renderSuggester();
    });
  }

  function renderNextNomPrimary(c) {
    nextNomPrimary.hidden = false;
    nextNomStrategy.textContent = strategyLabel(c.strategy);
    nextNomStrategy.className = `next-nom-strategy ${strategyClass(c.strategy)}`;
    nextNomName.textContent = c.name;
    nextNomMeta.textContent = metaLine(c);
    const range = formatValueRange(c.valueRange);
    nextNomValue.textContent = range;
    nextNomValue.hidden = !range;
    renderMarketDelta(c.marketDeltaPct);
    nextNomReason.textContent = reasonFor(c);
    // Bidders block also covers the WAIT case: seeing WHO would push
    // the price is exactly the information a WAIT recommendation is
    // built on.
    renderBidders(c.topBidders);

    // WAIT / AVOID: no nominate action — the whole point is "don't
    // nominate this player right now."
    if (c.strategy === 'WAIT' || c.strategy === 'AVOID') {
      nextNomAction.hidden = true;
    } else {
      nextNomAction.hidden = false;
      nextNomAction.dataset.player = c.name;
      nextNomAction.classList.remove('is-copied');
      nextNomAction.textContent = 'Nominate';
    }
  }

  function renderNextNomOthers(secondaries) {
    nextNomOthersList.innerHTML = '';
    if (!secondaries.length) {
      nextNomOthers.hidden = true;
      return;
    }
    nextNomOthers.hidden = false;
    for (const c of secondaries) {
      const li = document.createElement('li');
      li.className = 'next-nom-other';

      const name = document.createElement('span');
      name.className = 'next-nom-other-name';
      name.textContent = c.name;
      li.appendChild(name);

      const value = document.createElement('span');
      value.className = 'next-nom-other-value';
      value.textContent = formatValueRange(c.valueRange) || '';
      li.appendChild(value);

      // Position + tier — more useful than a redundant strategy chip
      // (every secondary here shares the active strategy).
      const meta = document.createElement('span');
      meta.className = 'next-nom-other-strategy';
      const bits = [c.position];
      if (c.tier && c.tier.tierIndex != null) bits.push(`T${c.tier.tierIndex + 1}`);
      meta.textContent = bits.join(' · ');
      li.appendChild(meta);

      nextNomOthersList.appendChild(li);
    }
  }

  // "Nominate" here is a convenience: the extension can't drive the
  // Sleeper nomination input, so we copy the player name to clipboard
  // and briefly confirm. The manager pastes into the Sleeper box.
  if (nextNomAction) {
    nextNomAction.addEventListener('click', async () => {
      const name = nextNomAction.dataset.player || '';
      if (!name) return;
      try {
        await navigator.clipboard.writeText(name);
        nextNomAction.textContent = 'Copied — paste in Sleeper';
        nextNomAction.classList.add('is-copied');
        setTimeout(() => {
          nextNomAction.textContent = 'Nominate';
          nextNomAction.classList.remove('is-copied');
        }, 2200);
      } catch (_) {
        // Clipboard denied — leave the button state alone.
      }
    });
  }

  // ---------- Available Players -------------------------------------
  // Complementary to Next Nomination: exploratory live market. State
  // is session-scoped (search text, active position chip, sort). Rows
  // are computed by liveDraft.listAvailablePlayers so no valuation is
  // duplicated here.
  const liveAvailableCard = document.getElementById('live-available-card');
  const liveAvailableToggle = document.getElementById('live-available-toggle');
  const liveAvailableBody = document.getElementById('live-available-body');
  const availSummary = document.getElementById('avail-summary');
  const availSearch = document.getElementById('avail-search');
  const availPositionChips = document.getElementById('avail-position-chips');
  const availSort = document.getElementById('avail-sort');
  const availList = document.getElementById('avail-list');
  const availEmpty = document.getElementById('avail-empty');
  const availPagination = document.getElementById('avail-pagination');
  const availPrevBtn = document.getElementById('avail-prev');
  const availNextBtn = document.getElementById('avail-next');
  const availPageStatus = document.getElementById('avail-page-status');

  wireCollapse(liveAvailableToggle, liveAvailableBody);

  const AVAIL_PAGE_SIZE = 8;
  const availState = { search: '', position: 'ALL', sort: 'value', page: 1 };
  let _availChipsSignature = '';

  function resetAvailPage() { availState.page = 1; }

  if (availSearch) {
    availSearch.addEventListener('input', () => {
      availState.search = availSearch.value || '';
      resetAvailPage();
      renderAvailablePlayers();
    });
  }
  if (availSort) {
    availSort.addEventListener('change', () => {
      availState.sort = availSort.value || 'value';
      resetAvailPage();
      renderAvailablePlayers();
    });
  }
  if (availPrevBtn) {
    availPrevBtn.addEventListener('click', () => {
      if (availState.page > 1) {
        availState.page -= 1;
        renderAvailablePlayers();
      }
    });
  }
  if (availNextBtn) {
    availNextBtn.addEventListener('click', () => {
      availState.page += 1;
      renderAvailablePlayers();
      // Guard: if we overshot (state changed mid-click), renderAvailablePlayers
      // clamps back down so the button never leaves the user on an empty page.
    });
  }

  function renderPositionChips(positions) {
    // Keep ALL first, then the positions the pool actually contains.
    const chips = ['ALL', ...positions];
    const signature = chips.join('|');
    if (signature === _availChipsSignature) {
      // Only update the active state.
      for (const btn of availPositionChips.querySelectorAll('.avail-chip')) {
        const pos = btn.dataset.position;
        btn.classList.toggle('is-active', pos === availState.position);
      }
      return;
    }
    _availChipsSignature = signature;
    availPositionChips.innerHTML = '';
    for (const pos of chips) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'avail-chip';
      if (pos === availState.position) btn.classList.add('is-active');
      btn.dataset.position = pos;
      btn.textContent = pos;
      btn.addEventListener('click', () => {
        availState.position = pos;
        resetAvailPage();
        for (const b of availPositionChips.querySelectorAll('.avail-chip')) {
          b.classList.toggle('is-active', b.dataset.position === pos);
        }
        renderAvailablePlayers();
      });
      availPositionChips.appendChild(btn);
    }
  }

  function formatAvailValueRange(range) {
    if (!range) return '—';
    if (range.low === range.high) return `$${range.low}`;
    return `$${range.low}–${range.high}`;
  }

  function renderAvailablePlayers() {
    const session = activeLiveSession && activeLiveSession.getState();
    if (!session || !session.isAuction || session.status !== 'active') {
      liveAvailableCard.hidden = true;
      return;
    }
    if (!featureFlags.isEnabled('bidRecommendations')) {
      liveAvailableCard.hidden = true;
      return;
    }
    // No pool -> the Next Nomination card already prompts to load the
    // pool; don't stack a second empty card in the same view.
    if (!cachedPlayerPool) {
      liveAvailableCard.hidden = true;
      return;
    }
    liveAvailableCard.hidden = false;

    const teams = (latestLiveDomState && latestLiveDomState.teams) || [];
    let inflationFactor = 1;
    if (teams.length && session.draft) {
      const slotsPerTeam = liveDraft.rosterSlotsPerTeam(session.draft);
      const startingBudgetPerTeam =
        (session.draft && session.draft.settings && session.draft.settings.budget) || 200;
      inflationFactor = liveDraft.computeLiveInflation({
        teams,
        startingBudgetPerTeam,
        slotsPerTeam,
      });
    }

    // Request the full filtered/sorted set; pagination happens
    // client-side so page controls can page through without re-hitting
    // the engine. Cap is generous — an auction pool won't exceed it.
    const result = liveDraft.listAvailablePlayers({
      pool: cachedPlayerPool,
      completedPicks: session.picks || [],
      teams,
      tierAggregates: cachedTierAggregates,
      yourManager: cachedUsername,
      yourIdentity: currentIdentity(session),
      league: session.league,
      inflationFactor,
      search: availState.search,
      position: availState.position,
      sort: availState.sort,
      limit: 1000,
    });

    // Position chips reflect the live pool composition.
    renderPositionChips(result.positions || []);

    // Summary line: total available + counts for common positions.
    if (result.totalAvailable > 0) {
      const bp = result.byPosition || {};
      const parts = [];
      for (const p of ['QB', 'RB', 'WR', 'TE']) {
        if (bp[p]) parts.push(`${p} ${bp[p]}`);
      }
      const detail = parts.length ? ` · ${parts.join(' · ')}` : '';
      availSummary.hidden = false;
      availSummary.textContent = `${result.totalAvailable} available${detail}`;
    } else {
      availSummary.hidden = true;
    }

    availList.innerHTML = '';
    if (!result.rows.length) {
      availEmpty.hidden = false;
      availEmpty.textContent = result.totalAvailable === 0
        ? 'No players remain in the pool.'
        : 'No players found. Try another search or filter.';
      availPagination.hidden = true;
      return;
    }
    availEmpty.hidden = true;

    // Client-side pagination — 8 rows per page. Clamp page in case a
    // filter change or a mid-draft pool refresh shrank the result set
    // below where the user had paged to.
    const totalPages = Math.max(1, Math.ceil(result.rows.length / AVAIL_PAGE_SIZE));
    if (availState.page > totalPages) availState.page = totalPages;
    if (availState.page < 1) availState.page = 1;
    const start = (availState.page - 1) * AVAIL_PAGE_SIZE;
    const pageRows = result.rows.slice(start, start + AVAIL_PAGE_SIZE);

    for (const r of pageRows) {
      const li = document.createElement('li');
      li.className = 'avail-row';

      const name = document.createElement('div');
      name.className = 'avail-name';
      name.textContent = r.name;
      li.appendChild(name);

      const value = document.createElement('div');
      value.className = 'avail-value';
      value.textContent = formatAvailValueRange(r.valueRange);
      li.appendChild(value);

      const meta = document.createElement('div');
      meta.className = 'avail-meta';
      const metaBits = [r.position];
      if (r.team) metaBits.push(r.team);
      if (r.tier && r.tier.tierIndex != null) metaBits.push(`Tier ${r.tier.tierIndex + 1}`);
      meta.textContent = metaBits.join(' · ');
      if (r.fit === 'starter') {
        const fit = document.createElement('span');
        fit.className = 'avail-fit';
        fit.textContent = 'Fits';
        meta.appendChild(fit);
      }
      li.appendChild(meta);

      const market = document.createElement('div');
      market.className = 'avail-market';
      if (r.marketDeltaPct != null && Math.abs(r.marketDeltaPct) >= 8) {
        const up = r.marketDeltaPct > 0;
        market.classList.add(up ? 'is-up' : 'is-down');
        market.textContent = `Market ${up ? '+' : ''}${r.marketDeltaPct}%`;
      }
      li.appendChild(market);

      availList.appendChild(li);
    }

    if (totalPages > 1) {
      availPagination.hidden = false;
      availPrevBtn.disabled = availState.page <= 1;
      availNextBtn.disabled = availState.page >= totalPages;
      const rangeStart = start + 1;
      const rangeEnd = start + pageRows.length;
      availPageStatus.textContent = `${rangeStart}–${rangeEnd} of ${result.rows.length}`;
    } else {
      availPagination.hidden = true;
    }
  }

  // Content script pushes DOM-scraped nomination + budgets. We filter by
  // draftId so multiple open drafts don't cross-contaminate.
  if (chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.type !== 'DRAFTPILOT_LIVE_STATE') return;
      const s = activeLiveSession && activeLiveSession.getState();
      if (!s || s.draftId !== msg.draftId) return;
      latestLiveDomState = msg.payload;
      renderLiveDomState();
    });
  }

  async function enterLiveDraftMode() {
    stopLiveSession();
    hideLiveSubsections();

    // Remote kill switch. When Live Draft Mode is disabled by the
    // feature-flag server, we surface a neutral "temporarily
    // unavailable" state and do NOT start polling, DOM scraping, or
    // any evaluation work. No internal reasons exposed to the user.
    if (!featureFlags.isEnabled('liveBidAnalysis')) {
      liveConnecting.hidden = true;
      liveError.hidden = false;
      liveErrorMsg.textContent = 'This feature is temporarily unavailable.';
      liveRetryBtn.hidden = true;
      return;
    }
    liveRetryBtn.hidden = false;
    liveConnecting.hidden = false;

    // Refresh cached aggregates so a mid-session sync propagates into
    // the live value calc without a panel reopen.
    storage.get('leagueTierAggregates').then((c) => {
      if (c && c.tierAggregates) cachedTierAggregates = c.tierAggregates;
    }).catch(() => {});

    // Try to hydrate a pre-existing player pool snapshot so the
    // suggester's live if the user already exported this session.
    hydratePlayerPool().then(() => maybeShowFirstRunTip()).catch(() => {});

    // Auto-detect from the active tab; fall back to a picker of the
    // user's current-year drafts.
    let draftId = null;
    try {
      const tab = await getActiveTab();
      draftId = liveDraft.extractDraftIdFromUrl(tab && tab.url);
    } catch (_) { /* tab query can fail on non-Chrome; not fatal */ }

    if (draftId) {
      startLiveSession(draftId);
      return;
    }
    await renderDraftPicker();
  }

  async function renderDraftPicker() {
    hideLiveSubsections();
    liveNoDraft.hidden = false;
    liveDraftPicker.innerHTML = '';

    const cache = await storage.get('leagueTierAggregates').catch(() => null);
    const upcoming = (cache && cache.upcomingDrafts) || [];

    if (!upcoming.length) {
      liveNoDraftBody.textContent =
        "Open a Sleeper draft room in another tab, then reopen this side panel. We don't see any scheduled drafts for your account yet.";
      return;
    }
    liveNoDraftBody.textContent =
      'Open the Sleeper draft room in another tab, or pick one below to start watching.';

    upcoming
      .slice()
      .sort((a, b) => (a.startTime || Infinity) - (b.startTime || Infinity))
      .forEach((d) => {
        const li = document.createElement('li');
        li.className = 'draft-list-item';

        const info = document.createElement('div');
        info.className = 'draft-info';
        const name = document.createElement('div');
        name.className = 'draft-name';
        name.textContent = d.leagueName || 'Draft';
        const meta = document.createElement('div');
        meta.className = 'draft-meta';
        const when = d.startTime
          ? new Date(d.startTime).toLocaleString([], {
              month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
            })
          : 'Time TBD';
        meta.textContent = `${when} · ${d.status || 'scheduled'}`;
        info.appendChild(name);
        info.appendChild(meta);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-secondary btn-tiny';
        btn.textContent = 'Follow';
        btn.addEventListener('click', () => startLiveSession(d.draftId));

        li.appendChild(info);
        li.appendChild(btn);
        liveDraftPicker.appendChild(li);
      });
  }

  function startLiveSession(draftId) {
    stopLiveSession();
    hideLiveSubsections();
    liveConnecting.hidden = false;
    renderedPickNos = new Set();

    activeLiveSession = liveDraft.createSession({ draftId });
    liveUnsubscribe = activeLiveSession.subscribe(renderLiveState);

    // Refresh the "just now / 12s ago" line between polls so it doesn't
    // look frozen even when nothing has changed.
    if (lastUpdatedTicker) clearInterval(lastUpdatedTicker);
    lastUpdatedTicker = setInterval(refreshLastUpdated, 10000);

    // Watch for the DOM feed going stale (user closed the draft tab or
    // switched browsers). Warn in-card without tearing the session down.
    if (liveStaleTicker) clearInterval(liveStaleTicker);
    liveStaleTicker = setInterval(checkLiveDomStale, 3000);
  }

  function checkLiveDomStale() {
    if (!latestLiveDomState) return;
    const age = Date.now() - (latestLiveDomState.timestamp || 0);
    liveNominationStale.hidden = age < LIVE_DOM_STALE_MS;
  }

  liveRetryBtn.addEventListener('click', () => {
    const draftId = activeLiveSession && activeLiveSession.getState().draftId;
    if (draftId) startLiveSession(draftId);
  });

  function statusBadgeConfig(status) {
    if (status === 'drafting') return { text: 'Live', cls: 'is-live' };
    if (status === 'pre_draft') return { text: 'Pre-draft', cls: 'is-pre' };
    if (status === 'complete') return { text: 'Complete', cls: 'is-done' };
    return { text: status || 'Unknown', cls: '' };
  }

  function formatLine(state) {
    const parts = [];
    parts.push(state.isAuction ? 'Auction' : 'Snake');
    if (state.isAuction && state.budget) parts.push(`$${state.budget}`);
    if (state.teamCount) parts.push(`${state.teamCount} teams`);
    return parts.join(' · ');
  }

  function refreshLastUpdated() {
    if (!activeLiveSession) return;
    const s = activeLiveSession.getState();
    if (!s.lastUpdated) return;
    liveLastUpdated.textContent = s.lastError
      ? `${s.lastError} (last update ${relativeTime(s.lastUpdated)})`
      : `Updated ${relativeTime(s.lastUpdated)}`;
    liveLastUpdated.className = 'live-last-updated' + (s.lastError ? ' is-error' : '');
  }

  function renderLiveState(state) {
    // Status badge lives in the persistent mode-crumb now, so it must
    // be cleared whenever we leave the active state -- otherwise a
    // stale LIVE pill lingers over "connecting" / error screens.
    const clearStatusBadge = () => {
      if (liveStatusBadge) {
        liveStatusBadge.textContent = '';
        liveStatusBadge.className = 'live-status-badge';
      }
    };
    if (state.status === 'loading') {
      hideLiveSubsections();
      clearStatusBadge();
      liveConnecting.hidden = false;
      return;
    }
    if (state.status === 'error') {
      hideLiveSubsections();
      clearStatusBadge();
      liveError.hidden = false;
      liveErrorMsg.textContent = state.lastError || 'Something went wrong.';
      return;
    }
    if (state.status === 'stopped') {
      clearStatusBadge();
      return; // view is being swapped away; nothing to paint
    }

    // status === 'active'
    hideLiveSubsections();
    liveActive.hidden = false;

    liveLeagueName.textContent = state.leagueName || 'Draft';
    liveFormatLine.textContent = formatLine(state);
    const badge = statusBadgeConfig(state.draftStatus);
    liveStatusBadge.textContent = badge.text;
    liveStatusBadge.className = 'live-status-badge ' + badge.cls;

    if (!state.isAuction) {
      liveSnakeNotice.hidden = false;
      livePickLogCard.hidden = true;
      refreshLastUpdated();
      return;
    }

    liveSnakeNotice.hidden = true;
    livePickLogCard.hidden = false;
    renderPickLog(state);

    refreshLastUpdated();
    // Suggester card shows the load button early so users can prep the
    // pool before the DOM feed arrives; it re-renders with real data
    // as soon as latestLiveDomState comes in.
    renderSuggester();
    renderAvailablePlayers();
    // If a DOM payload already landed during bootstrap, paint it now.
    if (latestLiveDomState) renderLiveDomState();
  }

  // Render nomination + team-budgets cards from the DOM-scraped payload.
  // Only meaningful for auction drafts; snake gets the Phase-2 notice.
  // Context (leagueValue + inflation) is computed once and shared so the
  // budgets table's "likely bidder" highlight uses the same anchor value
  // the nomination card is showing.
  function renderLiveDomState() {
    const s = activeLiveSession && activeLiveSession.getState();
    if (!s || !s.isAuction || s.status !== 'active') return;
    if (!latestLiveDomState) return;

    let { nomination, teams } = latestLiveDomState;

    // Backfill sleeperProjection from the loaded player pool when the
    // Sleeper DOM scrape didn't capture one (rookies, defenses, and
    // certain kicker rows are the common offenders). Without a
    // projection, leagueValue collapses to null and the Rec + Alts +
    // Fit + Why + Comp all get hidden by the early-return below --
    // which is why Caleb Williams-style nominations previously showed
    // "On the block" with no recommendation. Pool has projections for
    // every player Sleeper listed at export time, so this rescues the
    // common case without changing the DOM-scrape path.
    if (nomination
        && (nomination.sleeperProjection == null || nomination.sleeperProjection <= 0)
        && nomination.playerName && nomination.position
        && cachedPlayerPool && Array.isArray(cachedPlayerPool.players)) {
      const targetKey = liveDraft.poolKey(nomination.playerName, nomination.position);
      const match = cachedPlayerPool.players.find(
        (p) => liveDraft.poolKey(p.name, p.position) === targetKey
      );
      if (match && typeof match.projection === 'number' && match.projection > 0) {
        // Copy so we don't mutate the observer's payload.
        nomination = Object.assign({}, nomination, {
          sleeperProjection: match.projection,
          projectionSource: 'pool-backfill',
        });
      }
    }

    // Sample the current inflation factor, tagged by how many picks
    // have completed. Enables the trend indicator downstream. Dedup
    // by pick count so we don't fill the array on quiet DOM-only
    // updates (budget tweaks without new picks).
    const picksMadeNow = (s && s.picks && s.picks.length) || 0;

    // Record who threw this player out. Written once per player --
    // subsequent DOM ticks for the same nomination no-op. When the
    // pick lands via the API poller, renderPickLog looks up the same
    // key to annotate the completed row.
    if (nomination && nomination.openingBidder && nomination.playerName) {
      const key = normPlayerKey(nomination.playerName, nomination.position);
      if (!nominatorsByPlayer.has(key)) {
        nominatorsByPlayer.set(key, nomination.openingBidder);
      }
    }

    const inflation = liveDraft.computeLiveInflation({
      teams,
      startingBudgetPerTeam: s.budget,
      slotsPerTeam: liveDraft.rosterSlotsPerTeam(s.draft),
    });

    // Push a trajectory sample. Skip if the last sample was at the
    // same pick count and factor -- avoids polluting the series with
    // frequent DOM-only updates that don't reflect draft progress.
    const lastSample = inflationSamples[inflationSamples.length - 1];
    const factorChanged = !lastSample || Math.abs(lastSample.factor - inflation) > 0.005;
    if (!lastSample || lastSample.picksMade !== picksMadeNow || factorChanged) {
      inflationSamples.push({ picksMade: picksMadeNow, factor: inflation });
      if (inflationSamples.length > INFLATION_SAMPLE_CAP) inflationSamples.shift();
    }

    // Compute trend against the oldest sample >=5 picks in the past.
    // Null when we don't have enough history yet (early draft).
    let inflationTrend = null;
    for (const sample of inflationSamples) {
      if (picksMadeNow - sample.picksMade >= INFLATION_TREND_LOOKBACK_PICKS) {
        const delta = inflation - sample.factor;
        inflationTrend = {
          delta,
          picksSince: picksMadeNow - sample.picksMade,
          baseline: sample.factor,
        };
        break; // oldest qualifying sample wins
      }
    }
    let leagueValue = null;
    let valueSource = 'none'; // 'tier' | 'sleeper' | 'none'
    if (nomination && cachedTierAggregates && nomination.position && nomination.sleeperProjection != null) {
      leagueValue = liveDraft.computeLeagueAdjustedValue({
        position: nomination.position,
        sleeperProjection: nomination.sleeperProjection,
        tierAggregates: cachedTierAggregates,
        inflationFactor: inflation,
      });
      if (leagueValue != null) valueSource = 'tier';
    }
    if (leagueValue == null && nomination && nomination.sleeperProjection != null) {
      leagueValue = nomination.sleeperProjection;
      valueSource = 'sleeper';
    }

    // Tier lookup + scarcity for the nominated player. Requires cached
    // tier aggregates -- without them we simply skip the badge/alert
    // (no crash, no misleading placeholder). Prefers rank-based tier
    // lookup using the loaded pool; falls back to closest-median.
    let tier = null;
    let scarcity = null;
    if (nomination && cachedTierAggregates && nomination.position) {
      tier = liveDraft.findTier({
        position: nomination.position,
        sleeperProjection: nomination.sleeperProjection,
        tierAggregates: cachedTierAggregates,
        playerPool: cachedPlayerPool,
        playerName: nomination.playerName,
      });
      if (tier) {
        const picksByPos = liveDraft.countPicksByPosition(s.picks || []);
        // Build a compact `format` block for the shared scarcity
        // engine. Pulls roster slot config off the live league object;
        // falls back to what we have on session for isSuperflex.
        const leagueSettings = s.league && s.league.roster_positions
          ? s.league.roster_positions
          : null;
        const rosterSlots = leagueSettings
          ? countRosterSlots(leagueSettings)
          : null;
        const format = {
          teamCount: s.teamCount || (teams && teams.length) || 0,
          rosterSlots,
          isSuperflex: !!(rosterSlots && rosterSlots.SUPER_FLEX > 0),
        };
        scarcity = liveDraft.computeScarcity({
          position: nomination.position,
          anchorProjection: nomination.sleeperProjection,
          pool: cachedPlayerPool,
          picks: s.picks || [],
          picksByPosition: picksByPos,
          teams,
          league: s.league || null,
          format,
          // Legacy tier inputs preserved so the "elite RB left" alert
          // still fires exactly as before for tier-break moments.
          tierIndex: tier.tierIndex,
          totalTiers: tier.totalTiers,
        });
      }
    }

    renderInflationPanel({ inflation, inflationTrend, teams, session: s });
    renderNomination(nomination, { leagueValue, valueSource, inflation, inflationTrend, teams, tier, scarcity });
    renderMarketSnapshotFromState(s, teams, cachedPlayerPool, nomination);
    renderTeamBudgets(teams, { nomination, leagueValue });
    renderYourTeam(teams);
    renderSuggester();
    renderAvailablePlayers();
    maybeShowFirstRunTip();
    checkLiveDomStale();
  }

  /**
   * Auction inflation card. Designed for one-second reads: one big
   * inflation number, one plain-language interpretation, one line of
   * advice, one compact supporting stat row.
   *
   * Copy semantics (standard auction convention, matching liveDraft.js):
   *   factor > 1 → teams have been CONSERVATIVE → surplus cash → remaining
   *                 players will trade ABOVE their Sleeper $. User advice:
   *                 be ready to spend more on must-haves.
   *   factor < 1 → teams have been AGGRESSIVE → cash is scarce → remaining
   *                 players will trade BELOW their Sleeper $. User advice:
   *                 stay patient, bargains are coming.
   *
   * Complex calc → simple conclusion → optional supporting detail. Never
   * exposes the raw factor math or forces the user to interpret a chart.
   */
  function renderInflationPanel(ctx) {
    const session = (ctx && ctx.session) || null;
    if (!session || !session.isAuction || session.status !== 'active') {
      liveInflationCard.hidden = true;
      return;
    }
    const teams = (ctx && ctx.teams) || [];
    if (!teams.length) {
      liveInflationCard.hidden = true;
      return;
    }
    liveInflationCard.hidden = false;

    const inflation = ctx.inflation != null ? ctx.inflation : 1;
    const pct = Math.round((inflation - 1) * 100);
    const absPct = Math.abs(pct);
    const tone = pct >= 3 ? 'is-positive' : pct <= -3 ? 'is-negative' : '';

    // Trend read. Kept subtle: only nudges the copy near neutral where
    // the level alone doesn't communicate momentum.
    let trendDir = 'flat';
    let trendMagnitude = 'mild';
    if (ctx.inflationTrend) {
      const dPct = Math.round(ctx.inflationTrend.delta * 100);
      if (dPct >= 3) { trendDir = 'up'; trendMagnitude = dPct >= 8 ? 'strong' : 'mild'; }
      else if (dPct <= -3) { trendDir = 'down'; trendMagnitude = dPct <= -8 ? 'strong' : 'mild'; }
    }
    if (trendDir === 'up') {
      liveInflArrow.hidden = false;
      liveInflArrow.textContent = trendMagnitude === 'strong' ? '⇈' : '↑';
      liveInflArrow.className = 'live-infl-arrow is-positive';
    } else if (trendDir === 'down') {
      liveInflArrow.hidden = false;
      liveInflArrow.textContent = trendMagnitude === 'strong' ? '⇊' : '↓';
      liveInflArrow.className = 'live-infl-arrow is-negative';
    } else {
      liveInflArrow.hidden = true;
      liveInflArrow.textContent = '';
      liveInflArrow.className = 'live-infl-arrow';
    }

    // Primary plain-language summary. Percentage is preserved but read
    // as a phrase, not a chip. Sits in the always-visible header row.
    let summary;
    if (absPct < 3) {
      summary = 'Prices near expected';
    } else if (pct > 0) {
      summary = `Prices ${absPct}% above expected`;
    } else {
      summary = `Prices ${absPct}% below expected`;
    }
    // Near-neutral level but strong momentum -- surface the direction so
    // the manager isn't lulled by the flat headline.
    if (absPct < 5 && trendDir === 'up' && trendMagnitude === 'strong') {
      summary = 'Prices climbing quickly';
    } else if (absPct < 5 && trendDir === 'down' && trendMagnitude === 'strong') {
      summary = 'Spending accelerating';
    }
    if (liveInflSummary) {
      liveInflSummary.textContent = summary;
      liveInflSummary.className = 'live-infl-summary' + (tone ? ' ' + tone : '');
    }

    // Manager-facing advice. Bucketed on ±5% / ±15% -- meaningful
    // thresholds, not per-tick jitter. Trend overrides for the
    // near-neutral cases where momentum tells a different story.
    let advice;
    if (pct >= 15) {
      advice = 'Players are getting expensive. Be aggressive on must-haves.';
    } else if (pct >= 5) {
      advice = 'Prices are rising. Add a little to your targets.';
    } else if (pct <= -15) {
      advice = 'Bargains may be coming. Stay patient.';
    } else if (pct <= -5) {
      advice = 'Value is showing up. Hunt for it on your next few nominations.';
    } else {
      advice = 'Spending is tracking normally.';
    }
    if (absPct < 5 && trendDir === 'up' && trendMagnitude === 'strong') {
      advice = 'Room just got cautious. Next players may go for more.';
    } else if (absPct < 5 && trendDir === 'down' && trendMagnitude === 'strong') {
      advice = 'Money is leaving the room. Wait for the drop-off.';
    }
    liveInflAdvice.textContent = advice;

    // Legacy interp element -- kept in the DOM (hidden) so other
    // consumers don't null-deref; content mirrors the summary phrase.
    if (liveInflInterp) {
      liveInflInterp.textContent = summary;
      liveInflInterp.className = 'live-infl-interp' + (tone ? ' ' + tone : '');
    }
    // Legacy chip nodes (factor / word) stay hidden but populated so
    // any downstream reader (tests, exports) still sees a value.
    if (liveInflFactor) {
      liveInflFactor.textContent = pct === 0
        ? '0%'
        : `${pct > 0 ? '+' : ''}${pct}%`;
    }
    if (liveInflWord) liveInflWord.textContent = '';

    // Compact supporting row -- underlying $ math, kept secondary.
    const slotsPerTeam = liveDraft.rosterSlotsPerTeam(session.draft);
    const totalSlots = slotsPerTeam * teams.length;
    let totalRemaining = 0;
    let totalDrafted = 0;
    for (const t of teams) {
      totalRemaining += Number(t.budgetRemaining) || 0;
      totalDrafted += Number(t.rosterCount) || 0;
    }
    const remainingSlots = Math.max(1, totalSlots - totalDrafted);
    const perSlot = totalRemaining / remainingSlots;
    const perSlotStr = perSlot >= 10
      ? `$${Math.round(perSlot)}`
      : `$${perSlot.toFixed(2)}`;
    const signedPct = pct === 0 ? '0%' : `${pct > 0 ? '+' : ''}${pct}%`;
    liveInflSupport.textContent =
      `$${totalRemaining.toLocaleString()} remaining · ${perSlotStr} / open spot · ${signedPct} inflation`;

    // Freshness line -- explicit "based on N picks" phrasing so a
    // stale sample never reads as urgency ("FROZEN" language removed).
    if (liveInflFreshness) {
      const picks = totalDrafted;
      liveInflFreshness.textContent = picks > 0
        ? `Based on ${picks} pick${picks === 1 ? '' : 's'} so far`
        : 'Based on current draft data';
    }
  }

  /**
   * "Your draft performance" scorecard. Match the synced username to
   * a team column, then hand the roster + pool to the summary helper.
   * Hidden gracefully when we can't identify the user, when the pool
   * isn't loaded, or before the user has drafted anyone.
   */
  function renderYourTeam(teams) {
    // Hidden during-draft: the scorecard doesn't help while picking. Keep
    // the render logic below intact for a future post-draft recap view.
    liveYourTeamCard.hidden = true;
    return;
    // eslint-disable-next-line no-unreachable
    const session = activeLiveSession && activeLiveSession.getState();
    if (!session || !session.isAuction) {
      liveYourTeamCard.hidden = true;
      return;
    }
    if ((!cachedUsername && !cachedUserId) || !teams || !teams.length) {
      liveYourTeamCard.hidden = true;
      return;
    }
    const you = liveDraft.resolveYourTeam(teams, currentIdentity(session));
    if (!you) {
      liveYourTeamCard.hidden = true;
      return;
    }
    const summary = liveDraft.computeYourTeamSummary(you, cachedPlayerPool, cachedTierAggregates);
    if (!summary) {
      liveYourTeamCard.hidden = true;
      return;
    }
    liveYourTeamCard.hidden = false;

    // Insight tone follows the message content -- positive when
    // building well / finding value, negative when the pace is off.
    liveYtInsight.textContent = summary.insight;
    const positiveMarks = ['Building well', 'Finding value'];
    const negativeMarks = ['Too many overpays', 'Paying above value'];
    let insightTone = '';
    if (positiveMarks.some((m) => summary.insight.startsWith(m))) insightTone = ' is-positive';
    else if (negativeMarks.some((m) => summary.insight.startsWith(m))) insightTone = ' is-negative';
    liveYtInsight.className = 'live-yt-insight' + insightTone;

    // Value net: $ over/under projection for everything drafted so far.
    const net = summary.netValue;
    liveYtNet.textContent = net === 0 ? '$0' : (net > 0 ? `+$${net}` : `-$${Math.abs(net)}`);
    liveYtNet.className = 'live-yt-stat-value' +
      (net > 5 ? ' is-positive' : net < -5 ? ' is-negative' : '');
    liveYtNetDetail.textContent = `$${summary.totalSpent} spent · $${summary.totalProjected} projected`;

    // Verdicts breakdown: "3B / 2F / 1O" style.
    liveYtVerdicts.textContent = `${summary.bargainCount}B · ${summary.fairCount}F · ${summary.overpayCount}O`;
    liveYtVerdicts.className = 'live-yt-stat-value';
    liveYtVerdictsDetail.textContent = `${summary.pickCount} pick${summary.pickCount === 1 ? '' : 's'} evaluated`;

    // Elite starters = T1 + T2 tier drafted players. T3 shown as detail.
    const elite = summary.t1 + summary.t2;
    liveYtElite.textContent = String(elite);
    liveYtElite.className = 'live-yt-stat-value' + (elite >= 3 ? ' is-positive' : '');
    const detailParts = [];
    if (summary.t1) detailParts.push(`${summary.t1} T1`);
    if (summary.t2) detailParts.push(`${summary.t2} T2`);
    if (summary.t3) detailParts.push(`${summary.t3} T3`);
    if (summary.depth) detailParts.push(`${summary.depth} depth`);
    liveYtEliteDetail.textContent = detailParts.length
      ? detailParts.join(' · ')
      : 'no ranked picks yet';
  }

  function renderNomination(nom, ctx) {
    ctx = ctx || {};
    if (!nom) {
      liveNominationCard.hidden = true;
      const proto = document.getElementById('live-nomination-prototype-card');
      if (proto) proto.hidden = true;
      return;
    }
    liveNominationCard.hidden = false;

    liveNominationName.textContent = nom.playerName || 'Unknown player';
    const metaParts = [];
    if (nom.position) metaParts.push(nom.position);
    if (nom.team) metaParts.push(nom.team);
    // Joined with a space (not " · ") so the chip styling on this
    // element reads as a single "RB IND" tag rather than a bullet list.
    liveNominationMeta.textContent = metaParts.join(' ');

    // Tier badge: "RB Tier 1" / "WR Tier 3" pill next to position.
    // Neutralized — no more elite-green accent. Color is reserved for
    // the composed context line's severity treatment; the tier badge
    // is factual identification, not urgency.
    if (ctx.tier && nom.position) {
      const t = ctx.tier.tierIndex;
      liveNominationTier.hidden = false;
      liveNominationTier.textContent = `${nom.position} Tier ${t + 1}`;
      liveNominationTier.className = 'live-nomination-tier';
    } else {
      liveNominationTier.hidden = true;
    }

    // Nominator line: "Nominated by Team 3". Opening bid is
    // deliberately omitted -- opening at $1 is standard and the amount
    // is misleading (it's the nominator's minimum, not their max).
    // When the panel opens mid-nomination and we never see the opener,
    // this stays hidden rather than showing partial info.
    if (nom.openingBidder) {
      liveNominationNominator.hidden = false;
      liveNominationNominator.innerHTML =
        '<svg class="live-nomination-nominator-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        + '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>'
        + '<circle cx="12" cy="7" r="4"/>'
        + '</svg>';
      liveNominationNominator.appendChild(document.createTextNode('Nominated by '));
      const who = document.createElement('strong');
      who.textContent = nom.openingBidder;
      liveNominationNominator.appendChild(who);
    } else {
      liveNominationNominator.hidden = true;
    }

    // Legacy standalone signals (scarcity tier-break alert, scarcity
    // row) are subsumed by the composed context sentence below. Keep
    // their DOM nodes force-hidden so any late render path (feature
    // flag off, fallback branch) doesn't briefly flash them.
    liveNominationScarcity.hidden = true;
    if (liveScarcityRow) liveScarcityRow.hidden = true;

    // Status pill in the top-right of the nomination card. Three
    // states, in order of precedence:
    //   1. YOUR BID -- when the synced user holds the current top bid.
    //   2. PAUSED (or the Sleeper-supplied status) -- when auction
    //      isn't active.
    //   3. LIVE -- default active state.
    // Match against topBidder case-insensitively; skips silently if
    // no username synced (mock draft, unauthenticated) since we'd
    // otherwise misattribute every bid to "someone."
    // Identity is resolved against every known name variant for the
    // user_id, not just cachedUsername — Sleeper renders `nom.topBidder`
    // as team_name / display_name / username inconsistently across
    // browsers, and a single-string compare misses whenever the DOM
    // picked a variant other than what was synced.
    const iAmTopBidder = liveDraft.isYouByName(
      nom.topBidder,
      currentIdentity(activeLiveSession && activeLiveSession.getState())
    );
    // (The top-of-card status pill was removed -- draft LIVE/PAUSED state
    // is shown near the Live Draft Mode header, and ownership -- YOUR BID
    // -- is surfaced inside the decision block below.)

    // Ownership badge inside the decision block. Shown only when the
    // user is the current top bidder.
    const _recBadge = document.getElementById('live-nomination-rec-badge');
    if (_recBadge) _recBadge.hidden = !iAmTopBidder;

    // (Top-bid tile removed -- the current top bid is still used
    // internally to render the verdict text below, but no longer shown
    // as its own number.)

    // Remote kill switch for the league-value tile. When off, we hide
    // the recommendation stack entirely; the legacy value block takes
    // over so the card still communicates *something*.
    if (!featureFlags.isEnabled('playerValues')) {
      liveNominationRec.hidden = true;
      liveNominationFit.hidden = true;
      liveNominationWhy.hidden = true;
      liveNominationComp.hidden = true;
      liveNominationDetails.hidden = true;
      liveNominationValueBlock.hidden = false;
      liveNominationLeagueVal.textContent = '—';
      liveNominationValueSource.textContent = '';
      liveNominationVerdict.textContent = 'This feature is temporarily unavailable.';
      liveNominationVerdict.className = 'live-nomination-verdict';
      if (liveAlternatives) liveAlternatives.hidden = true;
      return;
    }

    // League-adjusted value + live inflation come pre-computed from
    // renderLiveDomState so the budgets table can highlight against the
    // exact same anchor value. Falls back to raw Sleeper projection
    // when the cache isn't synced yet.
    const inflation = ctx.inflation != null ? ctx.inflation : 1;
    const teams = ctx.teams || [];
    const leagueValue = ctx.leagueValue != null ? ctx.leagueValue : null;
    let source = '';
    if (ctx.valueSource === 'tier') {
      const inflationPct = Math.round((inflation - 1) * 100);
      const nowPart = inflationPct === 0
        ? 'neutral market'
        : inflationPct > 0
          ? `+${inflationPct}% market`
          : `${inflationPct}% market`;
      // Trend suffix: added only when we have >=5 picks of history so
      // early-draft noise doesn't show a fake "trend". Direction glyph
      // + delta in percentage points ("↑ rising +4% in last 8 picks").
      let trendPart = '';
      if (ctx.inflationTrend) {
        const deltaPct = Math.round(ctx.inflationTrend.delta * 100);
        const dir = deltaPct >= 3 ? '↑ rising' : deltaPct <= -3 ? '↓ cooling' : '→ steady';
        const magnitude = deltaPct === 0
          ? ''
          : ` ${deltaPct > 0 ? '+' : ''}${deltaPct}%`;
        trendPart = ` · ${dir}${magnitude} over ${ctx.inflationTrend.picksSince} picks`;
      }
      source = `(${nowPart}${trendPart})`;
    } else if (ctx.valueSource === 'sleeper') {
      source = '(Sleeper only — sync a league for adjusted values)';
    }

    if (leagueValue == null) {
      // No projection anywhere (DOM scrape missed it AND the pool
      // doesn't contain the player). Rather than fully hide the card
      // -- which is what caused the "Caleb Williams shows On the Block
      // with no recommendation" bug -- surface a plain-language
      // degraded state so the manager knows why the number is missing
      // and can still see who's on the block (spec §9: never hide the
      // Rec surface itself; §25: gracefully degrade when data missing).
      liveNominationRec.hidden = false;
      liveNominationRec.className = 'live-nomination-rec';
      liveNominationRecHeadline.textContent = 'NO VALUE DATA';
      liveNominationRecRange.hidden = false;
      liveNominationRecRange.innerHTML = 'Load the player pool (Export My Draft Room) to see recommendations for this player.';
      const _reasonEl = document.getElementById('live-nomination-rec-reason');
      const _metricsEl = document.getElementById('live-nomination-rec-metrics');
      if (_reasonEl) { _reasonEl.hidden = true; _reasonEl.textContent = ''; }
      if (_metricsEl) { _metricsEl.hidden = true; }
      liveNominationFit.hidden = true;
      liveNominationWhy.hidden = true;
      liveNominationComp.hidden = true;
      liveNominationDetails.hidden = true;
      liveNominationValueBlock.hidden = true;
      if (liveAlternatives) liveAlternatives.hidden = true;
      renderYourTeamStrip(nom, teams);
      return;
    }

    // Legacy value block is kept in the DOM but stays hidden in the
    // new hierarchy — the recommendation surface below carries the
    // value alongside the max in one place.
    liveNominationValueBlock.hidden = true;
    liveNominationLeagueVal.textContent = `$${leagueValue}`;
    liveNominationValueSource.textContent = source;

    // Kill switch: recommendations off (playerValues still on). Show
    // the plain value tile so the card doesn't go blank on users who
    // still have access to raw values.
    if (!featureFlags.isEnabled('bidRecommendations')) {
      liveNominationRec.hidden = true;
      liveNominationFit.hidden = true;
      liveNominationWhy.hidden = true;
      liveNominationComp.hidden = true;
      liveNominationDetails.hidden = true;
      liveNominationValueBlock.hidden = false;
      liveNominationVerdict.textContent = `Suggested max ~$${leagueValue}`;
      liveNominationVerdict.className = 'live-nomination-verdict';
      if (liveAlternatives) liveAlternatives.hidden = true;
      renderYourTeamStrip(nom, teams);
      return;
    }

    // Resolve the user's team (may be null in mock drafts / no sync).
    // Uses the full identity name-set for the synced user_id, not a
    // single fragile username compare — see liveDraft.resolveYourTeam.
    // The recommendation still runs without a matched user (max just
    // isn't clamped by user budget), so pre-sync users still get a
    // defensible number.
    const session = activeLiveSession && activeLiveSession.getState();
    const you = liveDraft.resolveYourTeam(teams, currentIdentity(session));

    // ONE call assembles: scarcity (already computed), value cliff,
    // scarcity impact, market pressure, pass consequence, primary
    // insight, alternatives, and the bid recommendation. Everything
    // the card renders reads from this object -- no duplicate scarcity
    // math. Wrapped so a failure in any additive layer can never take
    // down the bid recommendation itself (spec: Alternatives must be
    // ADDITIVE; the Rec must not regress).
    let insights = null;
    try {
      insights = liveDraft.buildNominationInsights({
        nom,
        teams,
        you,
        tier: ctx.tier,
        scarcity: ctx.scarcity,
        pool: cachedPlayerPool,
        picks: session ? session.picks : [],
        leagueValue,
        inflation,
        league: session ? session.league : null,
        draft: session ? session.draft : null,
        tierAggregates: cachedTierAggregates,
        format: session ? session.format : null,
      });
    } catch (err) {
      console.error('[DraftPilot] buildNominationInsights failed:', err);
      insights = null;
    }

    // Fallback -- if the orchestrator threw, compute the Rec directly
    // so the manager still sees BID TO $X. The Alternatives layer is
    // additive; losing it must never mask the recommendation (spec §1).
    let rec = insights && insights.rec;
    if (!rec) {
      try {
        rec = liveDraft.computeBidRecommendation({
          nom,
          leagueValue,
          inflation,
          teams,
          you,
          tier: ctx.tier,
          scarcity: ctx.scarcity,
          league: session ? session.league : null,
        });
      } catch (err) {
        console.error('[DraftPilot] computeBidRecommendation fallback failed:', err);
        rec = null;
      }
    }

    // Paint the Rec FIRST. It is Level 1 (spec §9 -- must be directly
    // visible in the primary nominated-player view). Additive layers
    // render after and are each try/wrapped so no single failure can
    // regress the bid recommendation.
    if (rec) {
      try { renderRecommendation(rec, { source, nomKey: nom && (nom.playerId || nom.playerName) }); }
      catch (err) { console.error('[DraftPilot] renderRecommendation failed:', err); }
    } else {
      liveNominationRec.hidden = true;
      liveNominationFit.hidden = true;
      liveNominationWhy.hidden = true;
      liveNominationComp.hidden = true;
      liveNominationDetails.hidden = true;
    }

    // Tier 2 — composed primary context. One sentence, chosen by the
    // Insight Priority engine (which was designed to pick THE dominant
    // reason). This replaces the previous stack of primary-insight,
    // cliff, pass-consequence, scarcity-row, and the fit/why lines.
    try { renderComposedContext(insights, rec, nom.position); }
    catch (err) { console.error('[DraftPilot] renderComposedContext failed:', err); }

    // Tier 3 — composed competition sentence. Combines the summary
    // ("6 teams can afford") with the biggest-threat callout.
    try { renderComposedCompetition(rec); }
    catch (err) { console.error('[DraftPilot] renderComposedCompetition failed:', err); }

    // Alternatives — compact top-2 view. Full list, methodology, and
    // per-component scores live inside the Details panel below.
    if (insights) {
      try { renderAlternatives(insights.alternatives, nom, { leagueValue }); }
      catch (err) { console.error('[DraftPilot] renderAlternatives failed:', err); }
    }

    // Progressive disclosure — assemble the ONE Details panel that
    // exposes everything below Tier-2/3: fit, scarcity, cliff, pass
    // consequence, full alternatives, per-lift dollar contributions,
    // methodology. Nothing here is required to make the decision.
    try { renderDetailsPanel({ rec, insights, position: nom.position }); }
    catch (err) { console.error('[DraftPilot] renderDetailsPanel failed:', err); }

    // Price-visualization card is the LIVE On-the-Block card. It
    // reads the exact same rec/nom objects the (now-hidden) production
    // card just populated -- the production DOM stays in the page so
    // `mirrorProductionIntoPrototype` can source its context /
    // competition / alternatives / details from the already-rendered
    // sub-nodes without duplicating any engine logic.
    //
    // Fall-through: if the prototype cannot render (legacy path with
    // no fairValueRange, or `bidEngine` disabled), it leaves its own
    // card hidden and we let the production card stay visible so the
    // user still gets a recommendation surface.
    try { renderPricePrototype(nom, rec); }
    catch (err) { console.error('[DraftPilot] renderPricePrototype failed:', err); }

    const _protoCard = document.getElementById('live-nomination-prototype-card');
    if (_protoCard && !_protoCard.hidden) {
      liveNominationCard.hidden = true;
    }

    renderYourTeamStrip(nom, teams);
  }

  /**
   * PROTOTYPE -- Price visualization variant of On-the-Block.
   * Renders below the production card using the exact same data:
   * every $ value comes from the bidEngine's rec object; no new
   * math, no fresh calculations.
   *
   * Layout:
   *   Player identity
   *   BID TO $X / PASS
   *   Roster context (rec.primaryReason)
   *   Horizontal price meter [Value | Fair | Stretch | Too high]
   *   Markers for current bid + max bid
   */
  function renderPricePrototype(nom, rec) {
    const card = document.getElementById('live-nomination-prototype-card');
    if (!card) return;

    // Only render for the bidEngine path -- legacy fallback doesn't
    // carry a fairValueRange we can trust.
    if (!nom || !rec || rec.engine !== 'bidEngine') {
      card.hidden = true;
      return;
    }

    const yourMax = Math.max(1, Math.round(rec.recommendedMax));
    const currentBid = Math.max(0, Math.round(rec.currentBid || 0));
    const fvr = rec.fairValueRange || {};
    let fvLow = fvr.low != null ? fvr.low : (rec.fairValue != null ? rec.fairValue : null);
    let fvHigh = fvr.high != null ? fvr.high : (rec.fairValue != null ? rec.fairValue : null);
    if (fvLow == null || fvHigh == null) {
      card.hidden = true;
      return;
    }
    if (fvLow > fvHigh) { const t = fvLow; fvLow = fvHigh; fvHigh = t; }

    card.hidden = false;

    // --- Header: mirror production so the position/team chip and
    // tier badge stay in lockstep with whatever renderNomination
    // wrote (tier lives on ctx, not nom, so re-deriving from nom
    // would silently drop the badge). ---
    document.getElementById('live-prototype-name').textContent =
      nom.playerName || 'Unknown player';

    const srcMeta = document.getElementById('live-nomination-meta');
    const dstMeta = document.getElementById('live-prototype-meta');
    if (srcMeta && dstMeta) {
      dstMeta.textContent = srcMeta.textContent;
    }

    const srcTier = document.getElementById('live-nomination-tier');
    const dstTier = document.getElementById('live-prototype-tier');
    if (srcTier && dstTier) {
      dstTier.hidden = srcTier.hidden;
      dstTier.textContent = srcTier.textContent;
      // Mirror any state class (is-elite etc.) so the tier styling
      // stays consistent with whatever production decided.
      dstTier.className = srcTier.className;
    }

    // --- Recommendation headline: same three-state grammar as the
    // production component, so the A/B compare only tests the meter. ---
    const recEl = document.getElementById('live-prototype-rec');
    const headlineEl = document.getElementById('live-prototype-headline');
    const cls = rec.recommendation === 'BUY' ? 'is-buy'
      : rec.recommendation === 'CAUTION' ? 'is-caution' : 'is-pass';
    recEl.className = 'live-nomination-rec has-yourmax ' + cls;
    headlineEl.textContent = '';
    const verbSpan = document.createElement('span');
    verbSpan.className = 'live-nomination-rec-verb';
    if (rec.recommendation === 'PASS') {
      verbSpan.textContent = 'PASS';
      headlineEl.appendChild(verbSpan);
    } else {
      verbSpan.textContent = 'BID TO';
      const amountSpan = document.createElement('span');
      amountSpan.className = 'live-nomination-rec-amount';
      amountSpan.textContent = `$${yourMax}`;
      headlineEl.appendChild(verbSpan);
      headlineEl.appendChild(document.createTextNode(' '));
      headlineEl.appendChild(amountSpan);
    }

    // --- Sub-status (same tri-state grammar production uses). ---
    const subStatusEl = document.getElementById('live-prototype-substatus');
    if (subStatusEl) {
      if (rec.recommendation === 'PASS') {
        subStatusEl.hidden = false;
        subStatusEl.textContent =
          `Current bid $${currentBid} · above Draft Pilot's $${yourMax} maximum.`;
      } else if (rec.recommendation === 'CAUTION') {
        const room = Math.max(0, rec.recommendedMax - currentBid);
        subStatusEl.hidden = false;
        subStatusEl.textContent = room === 0
          ? `Current bid $${currentBid} · at Draft Pilot's $${yourMax} maximum.`
          : `Current bid $${currentBid} · $${room} of bidding room remaining.`;
      } else {
        subStatusEl.hidden = true;
        subStatusEl.textContent = '';
      }
    }

    // --- Roster context (moved directly under BID TO $X per spec). ---
    const reasonEl = document.getElementById('live-prototype-reason');
    if (rec.primaryReason) {
      reasonEl.hidden = false;
      reasonEl.textContent = rec.primaryReason;
    } else {
      reasonEl.hidden = true;
      reasonEl.textContent = '';
    }

    // --- Mirror production sub-sections. These read the DOM state
    // that renderComposedContext / renderComposedCompetition /
    // renderAlternatives / renderDetailsPanel already produced --
    // so the prototype shows THE SAME dynamic values with zero
    // duplicated calculation logic. ---
    mirrorProductionIntoPrototype(nom);

    // --- Price meter. Four VISUAL zones are always exactly 25% wide
    // (VALUE / FAIR / STRETCH / TOO HIGH). The current-bid marker
    // interpolates WITHIN the correct zone based on the actual dollar
    // relationship; the max-bid marker always sits at 75%, the
    // stretch / too-high boundary. This gives every player the same
    // "price thermometer" while the markers speak the real numbers. ---
    const meterEl = document.getElementById('live-prototype-meter');
    const trackEl = document.getElementById('live-prototype-track');

    // Canonical classifier -- the ONLY place price → zone is decided.
    // Deterministic boundary convention: lower bound inclusive, upper
    // bound exclusive, so a single price maps to exactly one zone.
    //
    //   price < fvLow                       -> value    (GREAT)
    //   fvLow  <= price < fvHigh            -> fair     (GOOD)
    //   fvHigh <= price < yourMax           -> stretch  (FAIR)
    //   price >= yourMax                    -> toohigh  (POOR)
    //
    // Consequences that make the boundaries unambiguous:
    //   $fvLow    -> GOOD (never GREAT)
    //   $fvHigh   -> FAIR (never GOOD)
    //   $yourMax  -> POOR (never FAIR)
    //
    // Both the marker tint and the marker position derive from this
    // function so they can never disagree about which zone a price
    // belongs to.
    function classify(v) {
      if (v >= yourMax) return 'toohigh';
      if (v >= fvHigh)  return 'stretch';
      if (v >= fvLow)   return 'fair';
      return 'value';
    }

    // Piecewise interpolation from a dollar value to a 0-100 position
    // across the fixed four-zone meter. Uses the SAME boundary
    // convention as classify() so a boundary value's marker lands at
    // the boundary line AND is tinted by its owning (upper) zone.
    function markerPct(v) {
      if (v <= 0) return 0;
      const cat = classify(v);
      if (cat === 'toohigh') {
        // Overshoot cap = the size of the roster-adjusted stretch
        // band, so a small overpay reads as a small step into red
        // rather than pinning to the edge. At v == yourMax the
        // marker sits exactly on the 75% boundary line, tinted POOR.
        const stretchSpan = Math.max(1, yourMax - fvHigh);
        const overshootCap = Math.max(stretchSpan, Math.round(yourMax * 0.15));
        const over = Math.min(1, (v - yourMax) / overshootCap);
        return 75 + over * 25;
      }
      if (cat === 'stretch') {
        const span = Math.max(1, yourMax - fvHigh);
        return 50 + ((v - fvHigh) / span) * 25;
      }
      if (cat === 'fair') {
        const span = Math.max(1, fvHigh - fvLow);
        return 25 + ((v - fvLow) / span) * 25;
      }
      // 'value' -- bid below fair-low. Interp from $0 to fvLow.
      return Math.max(0, (v / Math.max(1, fvLow)) * 25);
    }

    const currentPct = Math.max(0, Math.min(100, markerPct(currentBid)));
    // Max-bid marker is the STRETCH/TOO-HIGH boundary by definition
    // in this fixed layout -- always 75%.
    const maxPct = 75;
    trackEl.style.setProperty('--current-pos', currentPct + '%');
    trackEl.style.setProperty('--max-pos', maxPct + '%');

    // Current-bid marker tone and the aria label both read the SAME
    // canonical classification -- no local re-derivation.
    const zone = classify(currentBid);
    trackEl.dataset.currentZone = zone;
    // Max-bid marker is $yourMax, which by the classifier is 'toohigh'
    // (POOR). Expose it so any styling that wants to tint the max
    // marker or its threshold label reads from the same source.
    trackEl.dataset.maxZone = 'toohigh';

    // Threshold labels beneath the internal zone boundaries at fixed
    // 25% / 50% / 75% positions -- annotations, not an x-axis. Values
    // come straight from the recommendation engine (fvLow, fvHigh,
    // yourMax); no zone label sits at 0% or 100% by design.
    const lowLabel = document.getElementById('live-prototype-threshold-low');
    const highLabel = document.getElementById('live-prototype-threshold-high');
    const maxLabelEl = document.getElementById('live-prototype-threshold-max');
    if (lowLabel) lowLabel.textContent = `$${fvLow}`;
    if (highLabel) highLabel.textContent = `$${fvHigh}`;
    if (maxLabelEl) maxLabelEl.textContent = `$${yourMax}`;

    const curLabel = document.getElementById('live-prototype-label-current');
    curLabel.innerHTML = `<span class="live-prototype-label-kicker">Current</span><span class="live-prototype-label-value">$${currentBid}</span>`;
    // Clamp label so the translateX(-50%) center never slides past
    // the meter edges even when the marker pins at 0% or 100%.
    const labelClamp = Math.max(4, Math.min(96, currentPct));
    curLabel.style.setProperty('--label-pos', labelClamp + '%');
    curLabel.dataset.zone = zone;

    // Sensible ARIA text so the meter reads coherently to a screen reader.
    trackEl.setAttribute('aria-label',
      `Current bid $${currentBid}. Fair value $${fvLow} to $${fvHigh}. Max bid $${yourMax}. Zone: ${zone}.`
    );

    meterEl.hidden = false;
  }

  /**
   * PROTOTYPE mirror. Copies the rendered state of the production
   * card's sub-sections into the prototype so both cards show the
   * same nominator / context / competition / alternatives / details.
   * No engine calls; no copy generation; just DOM mirroring.
   */
  function mirrorProductionIntoPrototype(nom) {
    // --- Nominator line ("Nominated by X"). Rebuild from source
    // (nom.openingBidder) rather than cloning DOM so cloned IDs
    // don't collide with production. ---
    const protoNom = document.getElementById('live-prototype-nominator');
    if (protoNom) {
      protoNom.innerHTML = '';
      if (nom && nom.openingBidder) {
        protoNom.hidden = false;
        protoNom.innerHTML =
          '<svg class="live-nomination-nominator-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
          + '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>'
          + '<circle cx="12" cy="7" r="4"/>'
          + '</svg>';
        protoNom.appendChild(document.createTextNode('Nominated by '));
        const who = document.createElement('strong');
        who.textContent = nom.openingBidder;
        protoNom.appendChild(who);
      } else {
        protoNom.hidden = true;
      }
    }

    // --- Composed context sentence. Mirror text + severity class
    // that renderComposedContext already wrote onto the production
    // node just moments ago in the same tick. ---
    const srcContext = document.getElementById('live-context');
    const dstContext = document.getElementById('live-prototype-context');
    const dstContextText = document.getElementById('live-prototype-context-text');
    if (srcContext && dstContext && dstContextText) {
      dstContext.hidden = srcContext.hidden;
      // Copy severity classes (is-calm / is-warn / is-alert).
      const toneClass = ['is-calm', 'is-warn', 'is-alert']
        .find((c) => srcContext.classList.contains(c)) || '';
      dstContext.className = 'live-context' + (toneClass ? ' ' + toneClass : '');
      const srcText = document.getElementById('live-context-text');
      dstContextText.textContent = srcText ? srcText.textContent : '';
    }

    // --- Composed competition sentence (with biggest-threat clause). ---
    const srcComp = document.getElementById('live-competition');
    const dstComp = document.getElementById('live-prototype-competition');
    const dstCompText = document.getElementById('live-prototype-competition-text');
    if (srcComp && dstComp && dstCompText) {
      dstComp.hidden = srcComp.hidden;
      const srcCompText = document.getElementById('live-competition-text');
      dstCompText.textContent = srcCompText ? srcCompText.textContent : '';
    }

    // --- Alternatives ("If you pass"). Clone the fully-rendered
    // block from production; wire the cloned "See all" button to
    // forward its click into the production button (which owns the
    // toggle state) then re-clone so the prototype re-renders in
    // sync. Zero duplicated toggle logic.
    syncAlternativesClone();

    // --- Why this recommendation? (native <details> element -- its
    // expand/collapse works standalone once cloned, no JS wiring). ---
    const srcDetails = document.getElementById('live-nomination-details');
    const dstDetailsMount = document.getElementById('live-prototype-details-mount');
    if (srcDetails && dstDetailsMount) {
      dstDetailsMount.innerHTML = '';
      if (!srcDetails.hidden) {
        const clone = srcDetails.cloneNode(true);
        stripIds(clone);
        clone.open = false;
        dstDetailsMount.appendChild(clone);
      }
    }
  }

  /**
   * Recursively remove `id` attributes so a cloned DOM subtree
   * can be inserted into the same document without duplicating IDs.
   */
  function stripIds(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.hasAttribute && root.hasAttribute('id')) root.removeAttribute('id');
    for (let i = 0; i < root.children.length; i++) stripIds(root.children[i]);
  }

  /**
   * Re-clone the production alternatives block into the prototype
   * mount and wire the cloned "See all / Show less" button to
   * forward its click into the production button. The production
   * click handler owns the toggle state (`_alternativesExpanded`)
   * and calls `renderAlternatives`, which repaints production DOM.
   * We then re-run this same helper to pick up the new state so
   * the prototype stays in sync in the same tick.
   */
  function syncAlternativesClone() {
    const srcAlts = document.getElementById('live-nomination-alternatives');
    const dstAltsMount = document.getElementById('live-prototype-alternatives-mount');
    if (!srcAlts || !dstAltsMount) return;
    dstAltsMount.innerHTML = '';
    if (srcAlts.hidden) return;
    const clone = srcAlts.cloneNode(true);
    stripIds(clone);
    const srcSeeAll = document.getElementById('live-alternatives-see-all');
    const clonedSeeAll = clone.querySelector('.live-alternatives-see-all');
    if (clonedSeeAll && srcSeeAll && !srcSeeAll.hidden) {
      clonedSeeAll.addEventListener('click', (e) => {
        e.preventDefault();
        srcSeeAll.click(); // production toggle owns the state
        syncAlternativesClone(); // repaint prototype from fresh DOM
      });
    } else if (clonedSeeAll) {
      clonedSeeAll.hidden = true;
    }
    dstAltsMount.appendChild(clone);
  }

  /**
   * Tier 2 — one composed sentence that answers "why this
   * recommendation?" in a single line. Sources the Insight Priority
   * engine's headline (which is already the canonical prioritized
   * output); optionally appends a short cliff clause when the primary
   * insight is not itself scarcity-flavored. Severity is expressed
   * with ONE tri-step system (calm / warn / alert).
   */
  function renderComposedContext(insights, rec, position) {
    if (!liveContext || !liveContextText) return;
    const insight = insights && insights.primaryInsight;
    if (!insight || !insight.headline) {
      liveContext.hidden = true;
      liveContextText.textContent = '';
      liveContext.className = 'live-context';
      return;
    }
    let sentence = insight.headline;
    // Concatenate the short explanation only when it's a distinct
    // clause — avoids "Locked into RB · Locked into RB by roster".
    const expl = insight.explanation && insight.explanation.trim();
    if (expl && !sentence.toLowerCase().includes(expl.toLowerCase().slice(0, 20))) {
      sentence += `. ${expl}`;
    }
    // Optional cliff clause when the insight didn't already cover it.
    const cliff = insights.cliff;
    const alreadyMentionsCliff = /cliff|drop|thin|scarce|last|only/i.test(sentence);
    if (cliff && cliff.hasCliff && cliff.isSevere && !alreadyMentionsCliff && position) {
      sentence += ` Big production drop after the next comparable ${position}.`;
    }
    liveContext.hidden = false;
    liveContextText.textContent = sentence.replace(/\s+/g, ' ').trim();
    // Severity: map insight tone (critical/high/medium/low/muted) to
    // the unified tri-step (alert/warn/calm). Pass recommendations get
    // 'alert', conditionals get 'warn', anything else follows insight.
    let tone = 'calm';
    if (rec && rec.action === 'pass') tone = 'alert';
    else if (rec && rec.action === 'conditional') tone = 'warn';
    else if (insight.tone === 'critical' || insight.tone === 'high') tone = 'alert';
    else if (insight.tone === 'medium') tone = 'warn';
    liveContext.className = 'live-context is-' + tone;
  }

  /**
   * Tier 3 — one composed competition sentence combining the summary
   * and biggest-threat callout. Silent when there's no competition
   * (nobody can afford, no starter need elsewhere) and no threat.
   */
  function renderComposedCompetition(rec) {
    if (!liveCompetition || !liveCompetitionText) return;
    if (!rec || (rec.action === 'pass' && !rec.biggestThreat)) {
      liveCompetition.hidden = true;
      liveCompetitionText.textContent = '';
      return;
    }
    const parts = [];
    if (rec.competitionSummary) parts.push(rec.competitionSummary);
    if (rec.biggestThreat) {
      const t = rec.biggestThreat;
      parts.push(`Biggest threat: ${t.manager} ($${t.budgetRemaining})`);
    }
    if (!parts.length) {
      liveCompetition.hidden = true;
      liveCompetitionText.textContent = '';
      return;
    }
    liveCompetition.hidden = false;
    liveCompetitionText.textContent = parts.join(' · ');
  }

  /**
   * Assemble the single Details panel — the one place a curious
   * manager can see the analytical layers the composed sentences
   * summarize: fit, scarcity, cliff, pass consequence, full
   * alternatives, per-lift dollar contributions.
   */
  function renderMaxBidDetails(rec, insights, position) {
    liveDetailsBody.innerHTML = '';

    const pos = (position || '').toUpperCase() || null;
    const yourMax = Math.max(1, Math.round(rec.recommendedMax));
    const currentBid = Math.max(0, Math.round(rec.currentBid || 0));

    // Dynamic H4 lead -- restates the action so the panel reads
    // standalone. "Why bid to $45?" / "Why bid up to $32?" / "Why pass?"
    const lead = document.createElement('p');
    lead.className = 'live-details-lead live-details-why-heading';
    if (rec.recommendation === 'PASS') {
      lead.textContent = 'Why pass?';
    } else if (rec.recommendation === 'CAUTION') {
      lead.textContent = `Why bid up to $${yourMax}?`;
    } else {
      lead.textContent = `Why bid to $${yourMax}?`;
    }
    liveDetailsBody.appendChild(lead);

    // Rank plain-language reasons by contribution (dollar magnitude
    // when the engine exposes one; heuristic weight otherwise).
    const reasons = buildWhyReasons(rec, insights, pos, yourMax, currentBid);
    if (reasons.length) {
      const ul = document.createElement('ul');
      ul.className = 'live-details-why-list';
      reasons.slice(0, 5).forEach((r) => {
        const li = document.createElement('li');
        li.textContent = r.text;
        ul.appendChild(li);
      });
      liveDetailsBody.appendChild(ul);
    }

    // Confidence footnote -- only shown when operating on partial data.
    if (rec.confidence && rec.confidence !== 'high') {
      const note = document.createElement('p');
      note.className = 'live-details-lead';
      note.style.opacity = '0.75';
      note.textContent = rec.confidence === 'low'
        ? 'Confidence: low. Export your draft room for a full-strength recommendation.'
        : 'Confidence: medium. Some signals are missing (scarcity or alternatives).';
      liveDetailsBody.appendChild(note);
    }

    liveNominationDetails.hidden = false;
    if (liveNominationDetailsSummary) {
      const _txt = document.getElementById('live-nomination-details-summary-text');
      if (_txt) _txt.textContent = 'Why this recommendation?';
    }
  }

  /**
   * Compose the ranked "why" bullet list from the same signals that
   * drove the recommendation. Each reason carries a weight so the top
   * 3-5 contributors bubble up; the rest are dropped. Copy stays in
   * plain language -- no jargon, no percentages, no raw component names.
   */
  function buildWhyReasons(rec, insights, pos, yourMax, currentBid) {
    const out = [];
    const posLabel = pos || 'player';
    const isPass = rec.recommendation === 'PASS';

    // --- Roster need. Slot fill dominates when we have it. ---
    const need = rec.rosterNeed || {};
    const slot = need.fillsSlot && need.fillsSlot !== 'BN'
      ? String(need.fillsSlot).replace(/_/g, ' ')
      : null;
    if (need.tone === 'high') {
      out.push({
        weight: 100,
        text: slot
          ? `You need a starting ${slot}.`
          : `You need another starter at ${posLabel}.`,
      });
    } else if (need.tone === 'moderate') {
      out.push({
        weight: 55,
        text: slot
          ? `This would upgrade your ${slot}.`
          : `This upgrades your ${posLabel} lineup.`,
      });
    } else if (need.tone === 'low') {
      out.push({
        weight: 30,
        text: `You already have starters at ${posLabel} — this is depth.`,
      });
    } else if (need.tone === 'none') {
      out.push({
        weight: 25,
        text: `No lineup upgrade at ${posLabel} — bench only.`,
      });
    }

    // --- Positional scarcity. Prefer the concrete "N comparable
    // remain" count from insights; fall back to the qualitative level. ---
    const scar = (insights && insights.scarcity) || {};
    const scarDollars = Math.abs((rec.scarcity && rec.scarcity.dollars) || 0);
    const compLeft = scar.comparableRemaining != null
      ? scar.comparableRemaining
      : (scar.atOrAboveRemaining != null ? scar.atOrAboveRemaining : null);
    if (compLeft != null) {
      if (compLeft === 0) {
        out.push({ weight: 90, text: `No comparable ${posLabel}s left after this player.` });
      } else if (compLeft <= 5) {
        out.push({ weight: 70 + scarDollars, text: `Only ${compLeft} comparable ${posLabel}s remain.` });
      } else if (compLeft <= 12) {
        out.push({ weight: 30 + scarDollars, text: `${compLeft} comparable ${posLabel}s remain.` });
      } else {
        out.push({ weight: 10, text: `Plenty of comparable ${posLabel}s still on the board.` });
      }
    } else if (rec.scarcity && rec.scarcity.level) {
      const lv = rec.scarcity.level;
      if (lv === 'CRITICAL' || lv === 'HIGH') {
        out.push({ weight: 65, text: `Few ${posLabel}s of this caliber left.` });
      } else if (lv === 'MEDIUM') {
        out.push({ weight: 25, text: `${posLabel} depth is thinning.` });
      }
    }

    // --- Value cliff -- only when severe and not already implied by
    // the scarcity line. ---
    const cliff = (insights && insights.cliff) || {};
    if (cliff.hasCliff && cliff.isSevere && cliff.dropoffPct != null) {
      const pct = Math.round(cliff.dropoffPct * 100);
      out.push({
        weight: 55 + pct,
        text: cliff.nextComparableProjection == null
          ? `No comparable ${posLabel} left after this one.`
          : `Big production drop after this ${posLabel} — next best is ~${pct}% worse.`,
      });
    }

    // --- Competition -- rival demand for the same position. ---
    const comp = rec.competition || {};
    if (comp.seriousBidders >= 3) {
      out.push({
        weight: 20 + comp.seriousBidders * 5,
        text: `${comp.seriousBidders} teams still need ${posLabel} help and can afford this.`,
      });
    } else if (comp.seriousBidders === 0 && !isPass) {
      out.push({ weight: 20, text: `No other team is set up to push the price.` });
    }

    // --- Alternatives -- price range of realistic backups. Skip when
    // we only have one comparable to quote (a single price isn't a range). ---
    const altCandidates = (insights && insights.alternatives && insights.alternatives.candidates) || [];
    const altValues = altCandidates
      .map((c) => c.auctionContext && c.auctionContext.alternativeValue)
      .filter((v) => typeof v === 'number' && v > 0);
    if (altValues.length >= 2) {
      const lo = Math.min(...altValues);
      const hi = Math.max(...altValues);
      out.push({
        weight: 40,
        text: lo === hi
          ? `Your strongest alternatives are around $${lo}.`
          : `Your strongest alternatives are $${lo}–$${hi}.`,
      });
    } else if (rec.replacementDepth === 'weak') {
      out.push({ weight: 45, text: `Few realistic alternatives remain at ${posLabel}.` });
    }

    // --- Budget pressure / opportunity cost. Only surface when it
    // materially shaped the max (dollarsCut > 0 or high tone). ---
    const opp = rec.opportunityCost || {};
    const budget = rec.budgetPressure || {};
    const oppCut = Math.abs(opp.dollarsCut || 0);
    if (opp.tone === 'high' || oppCut >= 3) {
      out.push({
        weight: 25 + oppCut,
        text: `Spending here squeezes your other open slots.`,
      });
    } else if (budget.remainingBudget != null && budget.openSlots > 0 && !isPass) {
      const leftAfter = budget.remainingBudget - yourMax;
      if (leftAfter >= 0 && leftAfter <= budget.openSlots * 2 + 2) {
        out.push({
          weight: 22,
          text: `That leaves roughly $${Math.max(0, leftAfter)} for your remaining ${budget.openSlots} slots.`,
        });
      }
    }

    // --- Max vs fair-value framing. Not a driver on its own, but a
    // useful last line so the manager understands the number. ---
    const fvr = rec.fairValueRange || {};
    if (fvr.low != null && fvr.high != null) {
      if (isPass) {
        const over = Math.max(1, currentBid - yourMax);
        out.push({
          weight: 95,
          text: `$${currentBid} is $${over} over your recommended max of $${yourMax}.`,
        });
      } else if (yourMax > fvr.high) {
        out.push({
          weight: 15,
          text: `$${yourMax} is above fair value ($${fvr.low}–$${fvr.high}), but reasonable for your roster.`,
        });
      } else if (yourMax < fvr.low) {
        out.push({
          weight: 15,
          text: `$${yourMax} sits below fair value ($${fvr.low}–$${fvr.high}) — no need to overpay.`,
        });
      } else {
        out.push({
          weight: 10,
          text: `$${yourMax} sits inside fair value ($${fvr.low}–$${fvr.high}).`,
        });
      }
    }

    // Rank by contribution (highest first) and de-dup on exact copy.
    out.sort((a, b) => b.weight - a.weight);
    const seen = new Set();
    return out.filter((r) => {
      if (seen.has(r.text)) return false;
      seen.add(r.text);
      return true;
    });
  }

  function renderDetailsPanel(ctx) {
    if (!liveDetailsBody || !liveNominationDetails) return;
    const { rec, insights, position } = ctx || {};

    // Roster-aware engine path: the engine already curates a plain-
    // language breakdown that covers Fair value / Roster need /
    // Scarcity / Alternatives / Budget pressure / Opportunity cost /
    // Competition / Your max. Rendering the same signals through the
    // legacy sections below would double up. Alternatives stay as the
    // one extra list because they're a distinct list-shaped view.
    if (rec && rec.engine === 'bidEngine') {
      renderMaxBidDetails(rec, insights, position);
      return;
    }

    liveDetailsBody.innerHTML = '';

    const addSection = (label, value) => {
      if (value == null || value === '') return;
      const row = document.createElement('div');
      row.className = 'live-details-row';
      const dt = document.createElement('div');
      dt.className = 'live-details-label';
      dt.textContent = label;
      const dd = document.createElement('div');
      dd.className = 'live-details-value';
      dd.textContent = value;
      row.appendChild(dt);
      row.appendChild(dd);
      liveDetailsBody.appendChild(row);
    };

    let hasAny = false;

    if (rec && rec.fitText) {
      addSection('Roster fit', rec.fitText);
      hasAny = true;
    }

    const scarcity = insights && insights.scarcity;
    if (scarcity && scarcity.score != null && position) {
      const analysis = window.DraftPilot && window.DraftPilot.analysis;
      const pressure = analysis && analysis.computeMarketPressure
        ? analysis.computeMarketPressure(scarcity)
        : null;
      const label = pressure ? pressure.level : String(scarcity.level || 'LOW');
      addSection('Positional scarcity',
        `${label} — ${scarcity.reason || (pressure && pressure.blurb) || ''}`.trim());
      hasAny = true;
    }

    const cliff = insights && insights.cliff;
    if (cliff && cliff.hasCliff && cliff.dropoffPct != null && position) {
      const pct = Math.round(cliff.dropoffPct * 100);
      const posLabel = position === 'DEF' ? 'DEF' : position;
      let text;
      if (cliff.nextComparableProjection == null) {
        text = `No comparable ${posLabel} left after this player.`;
      } else if (cliff.isSevere) {
        text = `Big production drop after the next comparable ${posLabel} (~${pct}% worse).`;
      } else {
        text = `Next comparable ${posLabel} is ~${pct}% worse.`;
      }
      addSection('Value cliff', text);
      hasAny = true;
    }

    const pc = insights && insights.passConsequence;
    if (pc && pc.headline) {
      addSection('If you pass', pc.blurb ? `${pc.headline} — ${pc.blurb}` : pc.headline);
      hasAny = true;
    }

    // Full alternatives list with scores + deltas (compact view up top
    // only shows top 2).
    const altList = insights && insights.alternatives && insights.alternatives.candidates;
    if (altList && altList.length) {
      const wrap = document.createElement('div');
      wrap.className = 'live-details-row live-details-row-block';
      const dt = document.createElement('div');
      dt.className = 'live-details-label';
      dt.textContent = 'All alternatives';
      wrap.appendChild(dt);
      const ul = document.createElement('ul');
      ul.className = 'live-details-alt-list';
      altList.forEach((c) => {
        const li = document.createElement('li');
        const av = c.auctionContext && c.auctionContext.alternativeValue;
        const bits = [c.name];
        if (av != null) bits.push(`$${av}`);
        if (c.alternativeScore != null) bits.push(`${c.alternativeScore}%`);
        li.textContent = bits.join(' · ');
        ul.appendChild(li);
      });
      wrap.appendChild(ul);
      liveDetailsBody.appendChild(wrap);
      hasAny = true;
    }

    // Per-lift dollar breakdown from the recommendation engine.
    if (rec && Array.isArray(rec.breakdown) && rec.breakdown.length) {
      const wrap = document.createElement('div');
      wrap.className = 'live-details-row live-details-row-block';
      const dt = document.createElement('div');
      dt.className = 'live-details-label';
      dt.textContent = 'Recommendation breakdown';
      wrap.appendChild(dt);
      const dl = document.createElement('dl');
      dl.className = 'live-details-breakdown';
      for (const [label, value] of rec.breakdown) {
        const rowDt = document.createElement('dt');
        rowDt.textContent = label;
        const rowDd = document.createElement('dd');
        rowDd.textContent = value;
        dl.appendChild(rowDt);
        dl.appendChild(rowDd);
      }
      wrap.appendChild(dl);
      liveDetailsBody.appendChild(wrap);
      hasAny = true;
    }

    liveNominationDetails.hidden = !hasAny;
    if (liveNominationDetailsSummary) {
      const _txt2 = document.getElementById('live-nomination-details-summary-text');
      if (_txt2) _txt2.textContent = 'Why this recommendation?';
    }
  }

  /**
   * Paint the recommendation stack from a computeBidRecommendation()
   * result. Three levels of hierarchy, in order of visual weight:
   *
   *   1. Headline — BID TO $X / PASS / BID IF ≤ $X. Big. Colored to
   *      match the action (green bid / red pass / amber conditional).
   *   2. Sub-range + fit chip + why line. Grounds the max.
   *   3. Competition summary + up to three team chips + optional
   *      "biggest threat" callout. Interpreted, not enumerated.
   *
   * Deep breakdown lives in the collapsible <details> so the default
   * card stays scannable.
   */
  /**
   * Paint the compact positional-scarcity row. Hides itself when the
   * shared scarcity engine couldn't produce a defensible score
   * (missing pool data, unknown position, etc.). The row is always the
   * primary surface for scarcity now; the older "elite RB left" alert
   * still fires above it for tier-break moments.
   */
  function renderScarcityRow(scarcity, position) {
    // Simplified Live Mode: the standalone scarcity readout has been
    // subsumed into the Tier-2 composed context sentence. This function
    // is kept as a no-op so any residual caller (fallback branches,
    // future re-enable) doesn't null-deref against removed DOM nodes.
    if (!liveScarcityRow) return;
    liveScarcityRow.hidden = true;
    void scarcity; void position;
    return;
    // eslint-disable-next-line no-unreachable
    if (!scarcity || scarcity.score == null || !position) {
      liveScarcityRow.hidden = true;
      return;
    }
    liveScarcityRow.hidden = false;
    // Front the plain-language Market Pressure label (spec item 2)
    // instead of the raw HIGH/CRITICAL enum; the raw enum stays in
    // the info popover for power users who open the details.
    const analysis = window.DraftPilot && window.DraftPilot.analysis;
    const pressure = analysis && analysis.computeMarketPressure
      ? analysis.computeMarketPressure(scarcity)
      : null;
    const displayLabel = pressure ? pressure.level : String(scarcity.level || 'LOW');
    const tone = pressure ? pressure.tone : String(scarcity.level || 'LOW').toLowerCase();
    liveScarcityLevel.textContent = displayLabel;
    liveScarcityLevel.className = 'live-scarcity-level is-' + tone;
    liveScarcityReason.textContent = scarcity.reason || (pressure && pressure.blurb) || '';

    // Contextual "Why this matters" copy for the info popover. Mirrors
    // the reason but framed as a valuation implication.
    if (liveScarcityInfoContext) {
      const posLabel = position === 'DEF' ? 'DEFs' : `${position}s`;
      const parts = [`${scarcity.comparableRemaining || 0} comparable ${posLabel} remain`];
      if (scarcity.dropoffPct != null && scarcity.dropoffPct >= 0.15) {
        parts.push(`and the next tier represents a ~${Math.round(scarcity.dropoffPct * 100)}% production drop`);
      }
      const tailNote = (scarcity.level === 'HIGH' || scarcity.level === 'CRITICAL')
        ? '. That makes this player more valuable than his normal auction value.'
        : (scarcity.level === 'MEDIUM'
          ? '. Market pressure is building — good options are thinning out.'
          : '. You can trust the market and stick to value.');
      liveScarcityInfoContext.textContent = parts.join(' ') + tailNote;
    }

    // Populate the info popover's detail dl fresh each render so the
    // numbers stay current when the user re-opens it.
    if (liveScarcityInfoDetail) {
      liveScarcityInfoDetail.innerHTML = '';
      const rows = [
        ['Position', position],
        ['Score', `${scarcity.score} / 100`],
        ['Level', displayLabel],
      ];
      if (scarcity.comparableRemaining != null) {
        rows.push(['Comparable remaining', String(scarcity.comparableRemaining)]);
      }
      if (scarcity.availableCount != null) {
        rows.push(['Total available', String(scarcity.availableCount)]);
      }
      if (scarcity.teamsStillNeeding != null) {
        rows.push(['Teams still needing', String(scarcity.teamsStillNeeding)]);
      }
      if (scarcity.dropoffPct != null) {
        rows.push(['Drop-off to next', `${Math.round(scarcity.dropoffPct * 100)}%`]);
      }
      for (const [label, value] of rows) {
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.textContent = value;
        liveScarcityInfoDetail.appendChild(dt);
        liveScarcityInfoDetail.appendChild(dd);
      }
    }
  }

  /**
   * Primary Insight -- the ONE dominant reason behind the current
   * recommendation. Set by the Insight Priority engine so we never
   * show three competing explanations (spec item 18).
   */
  function renderPrimaryInsight(insight) {
    // No-op — the composed Tier-2 context sentence has replaced this.
    if (livePrimaryInsight) livePrimaryInsight.hidden = true;
    void insight;
    return;
    // eslint-disable-next-line no-unreachable
    if (!insight) { livePrimaryInsight.hidden = true; return; }
    livePrimaryInsight.hidden = false;
    livePrimaryInsight.className = 'live-primary-insight is-' + (insight.tone || 'muted');
    // Prepend an emoji cue when the tone warrants it. Small, scannable.
    let prefix = '';
    if (insight.tone === 'critical' || insight.tone === 'high') prefix = '🔥 ';
    else if (insight.tone === 'medium' && insight.type !== 'FIT_LOCKED') prefix = '🎯 ';
    else if (insight.type === 'BUDGET') prefix = '💰 ';
    else if (insight.type === 'FIT_LOCKED') prefix = '🚫 ';
    livePrimaryInsightHeadline.textContent = prefix + insight.headline;
    if (insight.explanation) {
      livePrimaryInsightExplanation.hidden = false;
      livePrimaryInsightExplanation.textContent = insight.consequence
        ? `${insight.explanation} ${insight.consequence}`
        : insight.explanation;
    } else {
      livePrimaryInsightExplanation.hidden = true;
      livePrimaryInsightExplanation.textContent = '';
    }
  }

  /**
   * Value Cliff line -- surfaces the concrete production drop after
   * this player's comparable alternatives. Silent when no cliff. Copy
   * skews concrete over precise ("$8 less" beats "22.3% dropoff").
   */
  function renderValueCliff(cliff, position) {
    // No-op — value cliff is now surfaced only inside the Details panel
    // and (when severe) as an appended clause on the Tier-2 sentence.
    if (liveValueCliff) liveValueCliff.hidden = true;
    void cliff; void position;
    return;
    // eslint-disable-next-line no-unreachable
    if (!cliff || !cliff.hasCliff || cliff.dropoffPct == null || !position) {
      liveValueCliff.hidden = true;
      return;
    }
    liveValueCliff.hidden = false;
    const pct = Math.round(cliff.dropoffPct * 100);
    const posLabel = position === 'DEF' ? 'DEF' : position;
    if (cliff.nextComparableProjection == null) {
      liveValueCliffText.textContent = `No comparable ${posLabel} left after this player.`;
    } else if (cliff.isSevere) {
      liveValueCliffText.textContent = `Big production drop after the next comparable ${posLabel} (~${pct}% worse).`;
    } else {
      liveValueCliffText.textContent = `Next comparable ${posLabel} is ~${pct}% worse.`;
    }
  }

  /**
   * Pass Consequence row -- what happens if you skip THIS player.
   * Severity buckets: none / moderate / significant / severe. Silent
   * when the engine returns null.
   */
  function renderPassConsequence(pc) {
    // No-op — pass consequence lives inside the Details panel now.
    if (livePassConsequence) livePassConsequence.hidden = true;
    void pc;
    return;
    // eslint-disable-next-line no-unreachable
    if (!pc) { livePassConsequence.hidden = true; return; }
    livePassConsequence.hidden = false;
    livePassConsequence.className = 'live-pass-consequence is-' + pc.severity;
    livePassConsequenceHeadline.textContent = pc.headline;
    livePassConsequenceBlurb.textContent = pc.blurb || '';
  }

  /**
   * Two-clause context sentence under each "If you pass" row. Reads
   * from fields already computed by the Alternative Score engine
   * (componentScores.production, auctionContext.priceAdvantage /
   * valueDifference) -- no additional math, no changes to the
   * underlying score.
   *
   *   Clause 1 -- production relation ("Similar production" /
   *               "Small production drop" / "Larger production drop").
   *   Clause 2 -- cost relation vs. the nominee ("Strong fallback"
   *               when parity or nearly so, otherwise cheaper/pricier).
   */
  function buildAlternativeContext(c) {
    if (!c) return '';
    const cs = (c.componentScores) || {};
    const auction = c.auctionContext || {};
    const prodScore = typeof cs.production === 'number' ? cs.production : null;
    const altScore = typeof c.alternativeScore === 'number' ? c.alternativeScore : null;

    // Production relation clause.
    let prodClause;
    if (prodScore == null) {
      prodClause = altScore != null && altScore >= 80
        ? 'Comparable value'
        : 'Reasonable fallback';
    } else if (prodScore >= 92) {
      prodClause = 'Similar production';
    } else if (prodScore >= 78) {
      prodClause = 'Small production drop';
    } else if (prodScore >= 60) {
      prodClause = 'Noticeable production drop';
    } else {
      prodClause = 'Larger production drop';
    }

    // Cost / usefulness clause. Uses priceAdvantage when available,
    // otherwise falls back to a strength verdict from alternativeScore.
    let costClause = '';
    const adv = auction.priceAdvantage;
    const diff = auction.valueDifference;
    if (adv === 'cheaper' && typeof diff === 'number' && diff > 1) {
      costClause = `Cheaper by $${Math.round(diff)}`;
    } else if (adv === 'more_expensive' && typeof diff === 'number' && diff < -1) {
      costClause = `Costs $${Math.abs(Math.round(diff))} more`;
    } else if (adv === 'even' || adv === 'cheaper' || adv === 'more_expensive') {
      costClause = 'Similar cost';
    } else if (altScore != null) {
      costClause = altScore >= 80 ? 'Strong fallback'
        : altScore >= 60 ? 'Reasonable fallback'
        : 'Weaker fallback';
    }

    return costClause ? `${prodClause} · ${costClause}` : prodClause;
  }

  /**
   * "If you pass" section: top realistic replacement paths for the
   * nominated player, ranked by Alternative Score (production-dominant,
   * scarcity / consistency / playoff / rosterFit as configured). Auction
   * price is surfaced as the prominent right-side value so the trade-off
   * (production drop vs. cost saving) is obvious in one read.
   *
   * Reads only from insights.alternatives; no math here (spec §20).
   */
  function renderAlternatives(alt, nom, ctx) {
    if (!liveAlternatives) return;
    ctx = ctx || {};

    // Reset the expand/collapse state whenever the nominated player
    // changes -- "See all" on the previous player should not carry
    // over to a fresh nomination.
    const nomKey = (nom && (nom.playerId || nom.playerKey || nom.playerName)) || '';
    if (nomKey !== _alternativesNomKey) {
      _alternativesExpanded = false;
      _alternativesNomKey = nomKey;
    }

    // Cache inputs so the button's click handler can re-render with
    // the same data on toggle without needing another poll tick.
    _lastAlternatives = alt;
    _lastAlternativesCtx = { nom: nom, ctx: ctx };

    if (!alt) { liveAlternatives.hidden = true; return; }
    const hasCandidates = Array.isArray(alt.candidates) && alt.candidates.length > 0;
    liveAlternatives.hidden = false;

    // Depth chip removed from the default view — the Tier-2 context
    // sentence covers "how thin is the position" already; alternatives
    // here just answer "who else can I get."
    if (liveAlternativesDepth) liveAlternativesDepth.hidden = true;

    if (!liveAlternativesList) return;
    liveAlternativesList.innerHTML = '';

    if (!hasCandidates) {
      if (liveAlternativesEmpty) {
        liveAlternativesEmpty.textContent = 'No strong alternatives remaining.';
        liveAlternativesEmpty.hidden = false;
      }
      return;
    }
    if (liveAlternativesEmpty) liveAlternativesEmpty.hidden = true;

    // Compact default view: top 2 candidates only. Each row is
    // "Name — $value · <short label>". No percentages, no deltas,
    // no methodology — those live inside the Details panel below.
    // Expanded view (after "See all" is clicked) renders every
    // candidate inline; collapsing goes back to the top 2.
    const TOP_N = 2;
    const isExpanded = !!_alternativesExpanded;

    const paintRow = (c) => {
      const li = document.createElement('li');
      li.className = 'live-alternatives-row';

      const top = document.createElement('div');
      top.className = 'live-alternatives-row-top';
      const name = document.createElement('span');
      name.className = 'live-alternatives-name';
      name.textContent = c.name;
      top.appendChild(name);

      const av = c.auctionContext && c.auctionContext.alternativeValue;
      if (av != null) {
        const valEl = document.createElement('span');
        valEl.className = 'live-alternatives-value';
        valEl.textContent = `$${av}`;
        top.appendChild(valEl);
      }
      li.appendChild(top);

      const ctxText = buildAlternativeContext(c);
      if (ctxText) {
        const sub = document.createElement('div');
        sub.className = 'live-alternatives-context';
        sub.textContent = ctxText;
        li.appendChild(sub);
      }

      liveAlternativesList.appendChild(li);
    };

    const rowsToShow = isExpanded ? alt.candidates : alt.candidates.slice(0, TOP_N);
    rowsToShow.forEach(paintRow);

    // "See all N" (collapsed) <-> "Show less" (expanded) toggle in the
    // header. Cached candidates + expanded flag let re-renders (poll
    // ticks) preserve the user's choice until the nomination changes.
    const seeAllBtn = document.getElementById('live-alternatives-see-all');
    const seeAllTxt = document.getElementById('live-alternatives-see-all-text');
    if (seeAllBtn && seeAllTxt) {
      if (alt.candidates.length > TOP_N) {
        seeAllTxt.textContent = isExpanded
          ? 'Show less'
          : `See all ${alt.candidates.length}`;
        seeAllBtn.hidden = false;
        if (!seeAllBtn._draftpilotBound) {
          seeAllBtn.addEventListener('click', () => {
            _alternativesExpanded = !_alternativesExpanded;
            if (_lastAlternatives && _lastAlternativesCtx) {
              renderAlternatives(
                _lastAlternatives,
                _lastAlternativesCtx.nom,
                _lastAlternativesCtx.ctx
              );
            }
          });
          seeAllBtn._draftpilotBound = true;
        }
      } else {
        seeAllBtn.hidden = true;
      }
    }
  }

  // Alternatives info popover toggle -- mirrors the scarcity popover.
  if (liveAlternativesInfoBtn && liveAlternativesInfoPopover) {
    liveAlternativesInfoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !liveAlternativesInfoPopover.hidden;
      liveAlternativesInfoPopover.hidden = isOpen;
      liveAlternativesInfoBtn.setAttribute('aria-expanded', String(!isOpen));
    });
    document.addEventListener('click', (e) => {
      if (liveAlternativesInfoPopover.hidden) return;
      if (liveAlternativesInfoPopover.contains(e.target)) return;
      if (e.target === liveAlternativesInfoBtn) return;
      liveAlternativesInfoPopover.hidden = true;
      liveAlternativesInfoBtn.setAttribute('aria-expanded', 'false');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !liveAlternativesInfoPopover.hidden) {
        liveAlternativesInfoPopover.hidden = true;
        liveAlternativesInfoBtn.setAttribute('aria-expanded', 'false');
        liveAlternativesInfoBtn.focus();
      }
    });
  }

  /**
   * Positional Market Snapshot card -- one row per position summarizing
   * league-wide pressure. Reads the same scarcity engine as the
   * On-the-Block card so numbers agree.
   */
  /**
   * Assemble per-position pool + demand inputs from live state and
   * fire the shared computePositionalMarketSnapshot. Hides the card
   * when the player pool isn't loaded (no defensible snapshot).
   */
  const MARKET_SNAPSHOT_POSITIONS = ['QB', 'RB', 'WR', 'TE'];
  function renderMarketSnapshotFromState(s, teams, pool, nomination) {
    // Cache the inputs so the "See positional market" toggle can
    // rerender without waiting for the next live tick.
    lastMarketSnapshotArgs = [s, teams, pool, nomination];
    const analysis = window.DraftPilot && window.DraftPilot.analysis;
    if (!analysis || !analysis.computePositionalMarketSnapshot
        || !pool || !Array.isArray(pool.players) || !pool.players.length) {
      liveMarketSnapshotCard.hidden = true;
      return;
    }
    // Build per-position undrafted projection lists in one pass.
    const drafted = new Set();
    for (const p of pool.players) {
      if (p.isDrafted) drafted.add(liveDraft.poolKey(p.name, p.position));
    }
    for (const pick of (s && s.picks) || []) {
      const md = pick && pick.metadata;
      if (!md) continue;
      const name = `${md.first_name || ''} ${md.last_name || ''}`.trim();
      if (name && md.position) drafted.add(liveDraft.poolKey(name, md.position));
    }
    const poolByPosition = {};
    const draftedByPosition = {};
    for (const pos of MARKET_SNAPSHOT_POSITIONS) {
      poolByPosition[pos] = [];
      draftedByPosition[pos] = 0;
    }
    for (const p of pool.players) {
      const pos = (p.position || '').toUpperCase();
      if (!MARKET_SNAPSHOT_POSITIONS.includes(pos)) continue;
      if (drafted.has(liveDraft.poolKey(p.name, p.position))) {
        draftedByPosition[pos]++;
      } else if (p.projection != null && p.projection > 0) {
        poolByPosition[pos].push(p.projection);
      }
    }
    for (const pos of MARKET_SNAPSHOT_POSITIONS) {
      poolByPosition[pos].sort((a, b) => b - a);
    }
    // Teams-still-needing count per position, from the live team scrape.
    const teamsStillNeedingByPosition = {};
    if (teams && teams.length) {
      for (const pos of MARKET_SNAPSHOT_POSITIONS) {
        let n = 0;
        for (const t of teams) {
          const profile = liveDraft.bidderProfile(t, pos, 1, {
            league: s && s.league,
          });
          if (profile.need === 'starter' && profile.canAfford) n++;
        }
        teamsStillNeedingByPosition[pos] = n;
      }
    }
    const rosterSlots = s && s.league && s.league.roster_positions
      ? countRosterSlots(s.league.roster_positions) : null;
    const format = rosterSlots ? {
      teamCount: s.teamCount || (teams && teams.length) || 0,
      rosterSlots,
      isSuperflex: rosterSlots.SUPER_FLEX > 0,
    } : null;
    const rows = analysis.computePositionalMarketSnapshot({
      poolByPosition, teamsStillNeedingByPosition, format, draftedByPosition,
    });
    // Filter to the four skill positions; then, unless the user has
    // expanded the card, drop to just the nominated position's row.
    const skillRows = rows.filter((r) => MARKET_SNAPSHOT_POSITIONS.includes(r.position));
    const nomPos = nomination && nomination.position
      ? String(nomination.position).toUpperCase() : null;
    const collapsed = !marketSnapshotExpanded && nomPos
      && MARKET_SNAPSHOT_POSITIONS.includes(nomPos);
    const shown = collapsed ? skillRows.filter((r) => r.position === nomPos) : skillRows;
    renderMarketSnapshot(shown);
    if (liveMarketSnapshotToggle) {
      liveMarketSnapshotToggle.hidden = !nomPos
        || !MARKET_SNAPSHOT_POSITIONS.includes(nomPos)
        || skillRows.length <= 1;
      liveMarketSnapshotToggle.textContent = marketSnapshotExpanded
        ? 'Show only nominated position'
        : 'See positional market';
    }
  }

  function renderMarketSnapshot(rows) {
    if (!rows || !rows.length) {
      liveMarketSnapshotCard.hidden = true;
      return;
    }
    liveMarketSnapshotCard.hidden = false;
    liveMarketSnapshotBody.innerHTML = '';
    for (const row of rows) {
      const el = document.createElement('div');
      el.className = 'live-market-row';
      const pos = document.createElement('span');
      pos.className = 'live-market-pos';
      pos.textContent = row.position;
      const dot = document.createElement('span');
      const tone = (row.pressure && row.pressure.tone) || 'low';
      dot.className = 'live-market-dot is-' + tone;
      const copy = document.createElement('span');
      copy.className = 'live-market-copy';
      const h = document.createElement('span');
      h.className = 'live-market-headline';
      h.textContent = row.headline;
      const b = document.createElement('span');
      b.className = 'live-market-blurb';
      b.textContent = row.blurb;
      copy.appendChild(h);
      copy.appendChild(b);
      el.appendChild(pos);
      el.appendChild(dot);
      el.appendChild(copy);
      liveMarketSnapshotBody.appendChild(el);
    }
  }

  // Info popover open/close. Click the "?" to toggle; click outside or
  // hit Escape to close. Kept tiny -- no framework, no aria-live noise.
  if (liveScarcityInfoBtn && liveScarcityInfoPopover) {
    liveScarcityInfoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !liveScarcityInfoPopover.hidden;
      liveScarcityInfoPopover.hidden = isOpen;
      liveScarcityInfoBtn.setAttribute('aria-expanded', String(!isOpen));
    });
    document.addEventListener('click', (e) => {
      if (liveScarcityInfoPopover.hidden) return;
      if (liveScarcityInfoPopover.contains(e.target)) return;
      if (e.target === liveScarcityInfoBtn) return;
      liveScarcityInfoPopover.hidden = true;
      liveScarcityInfoBtn.setAttribute('aria-expanded', 'false');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !liveScarcityInfoPopover.hidden) {
        liveScarcityInfoPopover.hidden = true;
        liveScarcityInfoBtn.setAttribute('aria-expanded', 'false');
        liveScarcityInfoBtn.focus();
      }
    });
  }

  // Cross-poll smoothing state for the roster-aware max bid card.
  // Spec §18: yourMax must not jump by tiny amounts between polls (the
  // engine can flicker $37 <-> $38 as pool signals wobble). We hold the
  // last max per nominated player and snap to it when the new max is
  // within $2, so the number reads as stable to a manager glancing at
  // it during a live auction. Meaningful moves ($3+, or a player
  // change) always show through.
  const _maxBidSmoothing = { key: null, lastMax: null };

  // Alternatives expand/collapse state. Preserved across poll-driven
  // re-renders so the "See all" toggle sticks until the nomination
  // changes; reset in renderAlternatives when nomKey flips.
  let _alternativesExpanded = false;
  let _alternativesNomKey = '';
  let _lastAlternatives = null;
  let _lastAlternativesCtx = null;
  function smoothMax(key, newMax) {
    if (_maxBidSmoothing.key !== key) {
      _maxBidSmoothing.key = key;
      _maxBidSmoothing.lastMax = newMax;
      return newMax;
    }
    const prev = _maxBidSmoothing.lastMax;
    if (prev == null) { _maxBidSmoothing.lastMax = newMax; return newMax; }
    const diff = Math.abs(newMax - prev);
    if (diff <= 2) return prev;
    _maxBidSmoothing.lastMax = newMax;
    return newMax;
  }

  function renderMaxBidRecommendation(rec, ctx) {
    const rawMax = Math.max(1, Math.round(rec.recommendedMax));
    // Smoothing key = the nominated player. Switching players resets
    // the buffer; small poll-to-poll wobble on the same player snaps
    // to the previous value.
    const smoothingKey = (ctx && ctx.nomKey) ? String(ctx.nomKey) : ('fv' + rec.fairValue);
    const yourMax = smoothMax(smoothingKey, rawMax);
    const currentBid = Math.max(0, Math.round(rec.currentBid || 0));
    const remaining = yourMax - currentBid;

    liveNominationRec.hidden = false;
    const cls = rec.recommendation === 'BUY' ? 'is-buy'
      : rec.recommendation === 'CAUTION' ? 'is-caution' : 'is-pass';
    liveNominationRec.className = 'live-nomination-rec has-yourmax ' + cls;

    // Headline: one component, three semantic states, all built from
    // the same verb + amount pair so the scan pattern is consistent:
    //
    //   BUY      -> "BID TO $45"      (comfortable ceiling)
    //   CAUTION  -> "BID TO $40"      (approaching ceiling; sub-status
    //                                  flags the urgency)
    //   PASS     -> "PASS"            (no amount; sub-status explains
    //                                  why bidding further is off)
    //
    // The tri-state color coding (is-buy/caution/pass) plus the
    // sub-status line carry the "keep going / slow down / stop"
    // distinction -- never color alone.
    liveNominationRecHeadline.textContent = '';
    const verbEl = document.createElement('span');
    verbEl.className = 'live-nomination-rec-verb';
    if (rec.recommendation === 'PASS') {
      verbEl.textContent = 'PASS';
      liveNominationRecHeadline.appendChild(verbEl);
    } else {
      verbEl.textContent = 'BID TO';
      const amountEl = document.createElement('span');
      amountEl.className = 'live-nomination-rec-amount';
      amountEl.textContent = `$${yourMax}`;
      liveNominationRecHeadline.appendChild(verbEl);
      liveNominationRecHeadline.appendChild(document.createTextNode(' '));
      liveNominationRecHeadline.appendChild(amountEl);
    }

    // State-aware sub-status. Surfaces ONLY when there's urgency to
    // communicate -- keeps the BUY state clean and lets CAUTION/PASS
    // speak the "why the action changed" beat in plain language.
    let subStatus = document.getElementById('live-nomination-rec-substatus');
    if (!subStatus) {
      subStatus = document.createElement('p');
      subStatus.id = 'live-nomination-rec-substatus';
      subStatus.className = 'live-nomination-rec-substatus';
      liveNominationRecHeadline.parentNode.insertBefore(
        subStatus, liveNominationRecHeadline.nextSibling
      );
    }
    if (rec.recommendation === 'PASS') {
      subStatus.hidden = false;
      subStatus.textContent =
        `Current bid $${currentBid} · above Draft Pilot's $${yourMax} maximum.`;
    } else if (rec.recommendation === 'CAUTION') {
      const room = Math.max(0, remaining);
      subStatus.hidden = false;
      subStatus.textContent = room === 0
        ? `Current bid $${currentBid} · at Draft Pilot's $${yourMax} maximum.`
        : `Current bid $${currentBid} · $${room} of bidding room remaining.`;
    } else {
      subStatus.hidden = true;
      subStatus.textContent = '';
    }

    // Plain-language reason as its own line under the headline, then a
    // 3-column mini-grid summarising the numbers. Grid replaces the
    // older prose "Fair $X · Bid $Y · $Z room" strip so the values are
    // scannable at a glance. The legacy prose range is hidden.
    const reasonEl = document.getElementById('live-nomination-rec-reason');
    if (reasonEl) {
      if (rec.primaryReason) {
        reasonEl.hidden = false;
        reasonEl.textContent = rec.primaryReason;
      } else {
        reasonEl.hidden = true;
        reasonEl.textContent = '';
      }
    }

    const metricsEl = document.getElementById('live-nomination-rec-metrics');
    const fairEl = document.getElementById('live-nomination-metric-fair');
    const bidEl = document.getElementById('live-nomination-metric-bid');
    const roomEl = document.getElementById('live-nomination-metric-room');
    if (metricsEl && fairEl && bidEl && roomEl) {
      metricsEl.hidden = false;
      // Render the fair-value RANGE ("$32–36") rather than a false-
      // precision scalar ("$34"). Collapses to the scalar when the
      // range degenerated to a single point (no tierAggregates path).
      fairEl.textContent = formatFairValue(rec);
      bidEl.textContent = `$${currentBid}`;
      if (rec.recommendation === 'PASS') {
        roomEl.textContent = `-$${Math.abs(remaining)}`;
        roomEl.className = 'live-nomination-metric-value is-negative';
      } else {
        roomEl.textContent = `+$${Math.max(0, remaining)}`;
        roomEl.className = 'live-nomination-metric-value'
          + (remaining > 0 ? ' is-positive' : '');
      }
    }

    liveNominationRecRange.hidden = true;
    liveNominationRecRange.innerHTML = '';

    // Legacy standalone fit / why / competition nodes stay hidden.
    if (liveNominationFit) liveNominationFit.hidden = true;
    if (liveNominationWhy) liveNominationWhy.hidden = true;
    if (liveNominationComp) liveNominationComp.hidden = true;
    if (liveNominationCompList) liveNominationCompList.innerHTML = '';
    if (liveNominationThreat) liveNominationThreat.hidden = true;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Fair value renders as a RANGE (spec §2, §20). Falls back to the
  // scalar when the range degenerated to a single point (typically
  // when tierAggregates wasn't available in the pipeline). The
  // "en-dash" separator (–) is intentional -- typographically
  // correct for numeric ranges.
  function formatFairValue(rec) {
    const r = rec && rec.fairValueRange;
    if (r && r.low != null && r.high != null && r.low !== r.high) {
      return `$${r.low}–${r.high}`;
    }
    const scalar = (r && r.center != null) ? r.center : (rec && rec.fairValue);
    return `$${scalar != null ? scalar : '?'}`;
  }

  function renderRecommendation(rec, ctx) {
    ctx = ctx || {};

    // Roster-aware engine path (spec §17, §26, §27, §29): a manager
    // should be able to read the card in ~one second. Priority order:
    //   1. BUY / CAUTION / PASS decision
    //   2. Your Max (the strategic ceiling)
    //   3. Current bid + remaining room
    //   4. One plain-language reason
    // Everything else is Details.
    if (rec && rec.engine === 'bidEngine') {
      renderMaxBidRecommendation(rec, ctx);
      return;
    }

    // Legacy path (feature flag off, or engine returned null).
    liveNominationRec.hidden = false;
    liveNominationRec.className = 'live-nomination-rec' +
      (rec.action === 'pass' ? ' is-pass' :
       rec.action === 'conditional' ? ' is-conditional' : '');
    liveNominationRecHeadline.textContent = rec.headline;

    // The bidEngine mini-grid / reason line don't apply to the legacy
    // path — hide them so they don't leak in from a prior render.
    const _reasonElL = document.getElementById('live-nomination-rec-reason');
    const _metricsElL = document.getElementById('live-nomination-rec-metrics');
    if (_reasonElL) { _reasonElL.hidden = true; _reasonElL.textContent = ''; }
    if (_metricsElL) { _metricsElL.hidden = true; }

    if (rec.action === 'pass') {
      liveNominationRecRange.hidden = true;
      liveNominationRecRange.textContent = '';
    } else {
      const parts = [];
      parts.push(`Value <b>$${rec.target}</b>`);
      if (rec.comfort !== rec.target) parts.push(`Comfort <b>$${rec.comfort}</b>`);
      if (rec.max !== rec.target && rec.max !== rec.comfort) {
        parts.push(`Max <b>$${rec.max}</b>`);
      }
      liveNominationRecRange.hidden = false;
      liveNominationRecRange.innerHTML = parts.join(' · ');
    }

    // Legacy standalone fit / why / competition surfaces are now
    // composed into the Tier-2 context sentence and Tier-3 competition
    // sentence (rendered by renderComposedContext / renderComposedCompetition).
    // Keep the DOM nodes force-hidden so nothing flashes from a stale
    // render.
    if (liveNominationFit) liveNominationFit.hidden = true;
    if (liveNominationWhy) liveNominationWhy.hidden = true;
    if (liveNominationComp) liveNominationComp.hidden = true;
    if (liveNominationCompList) liveNominationCompList.innerHTML = '';
    if (liveNominationThreat) liveNominationThreat.hidden = true;

    // The full analytical breakdown is assembled in one place —
    // renderDetailsPanel — after this function returns. Don't touch
    // liveNominationDetails visibility here; the panel builder owns it.
    void liveNominationDetailsList;
  }

  // Legacy "Do you need this?" strip. Superseded by the fit chip in
  // the recommendation stack (which conveys the same "how badly do I
  // need this?" signal in-line with the decision). Kept as a no-op
  // so callers don't have to change and the DOM element stays in
  // place for the disabled-features fallback path.
  function renderYourTeamStrip(_nom, _teams) {
    liveNominationYou.hidden = true;
  }

  function renderTeamBudgets(teams, ctx) {
    ctx = ctx || {};
    // Card hidden for now — kept wired up so we can re-enable later.
    liveBudgetsCard.hidden = true;
    return;
    if (!teams || !teams.length) {
      liveBudgetsCard.hidden = true;
      return;
    }
    liveBudgetsCard.hidden = false;
    liveBudgetsTbody.innerHTML = '';

    const nomPosition = ctx.nomination ? ctx.nomination.position : null;
    const targetValue = ctx.leagueValue != null ? ctx.leagueValue : null;
    // Hint only makes sense when we can actually run the filter; keeps
    // the card clean pre-nomination.
    liveBudgetsHint.hidden = !nomPosition;

    // Sort by budget remaining desc so biggest wallets float to top.
    const sorted = teams.slice().sort(
      (a, b) => (b.budgetRemaining || 0) - (a.budgetRemaining || 0)
    );
    const identityForRows = currentIdentity(activeLiveSession && activeLiveSession.getState());
    for (const t of sorted) {
      const tr = document.createElement('tr');
      if (liveDraft.isYouByName(t.manager, identityForRows)) {
        tr.classList.add('is-you');
      }
      if ((t.maxBid || 0) <= 1) tr.classList.add('is-broke');

      // Bidder relevance for the current nomination. Two-tier flag:
      // green tint when they have need AND can compete; faded when
      // they either have no eligible slot or can't afford. The visible
      // "Needs" column shows the raw slot inventory so users can see
      // WHY a row was highlighted or dimmed.
      if (nomPosition) {
        const s = activeLiveSession && activeLiveSession.getState();
        const profile = liveDraft.bidderProfile(t, nomPosition, targetValue, {
          league: s ? s.league : null,
        });
        // Green highlight: real starter-slot need AND affordable.
        // Dimmed: no eligible slot at all, OR just can't afford.
        // (Position cap makes need='none' automatically, so capped
        // teams fall into the dimmed bucket without a special case.)
        // Bench-only + affordable stays default -- they're a wild-card
        // stash bidder, neither favored nor eliminated.
        if (profile.need === 'starter' && profile.canAfford) {
          tr.classList.add('is-likely-bidder');
        } else if (profile.need === 'none' || !profile.canAfford) {
          tr.classList.add('is-out-of-race');
        }
      }

      const mgr = document.createElement('td');
      mgr.className = 'live-budgets-mgr';
      mgr.textContent = t.manager || '—';
      const needs = document.createElement('td');
      needs.className = 'live-budgets-needs';
      needs.textContent = liveDraft.summarizeNeeds(t) || '—';
      needs.title = (t.openSlots || []).join(', '); // hover shows all slots
      const bench = document.createElement('td');
      const benchN = liveDraft.benchOpenCount(t);
      bench.className = 'live-budgets-bench' + (benchN === 0 ? ' is-zero' : '');
      bench.textContent = String(benchN);

      tr.appendChild(mgr);
      tr.appendChild(needs);
      tr.appendChild(bench);
      liveBudgetsTbody.appendChild(tr);
    }
  }

  // Post-pick verdict: look up the drafted player in the pool, resolve
  // their positional tier (rank-based, from the pool's current-year
  // projections), and compare paid amount to the tier's median
  // projection. Returns { text, tone } or null when we lack the inputs
  // to say something honest.
  function buildPickVerdict(pick, amount, position) {
    if (!cachedPlayerPool || !cachedPlayerPool.players) return null;
    const name = liveDraft.playerName(pick);
    if (!name) return null;
    const key = name.trim().toLowerCase();
    const player = cachedPlayerPool.players.find(
      (pp) => (pp.name || '').trim().toLowerCase() === key &&
              (pp.position || '').toUpperCase() === position.toUpperCase()
    );
    // No projection == no defensible verdict (rookies late in the pool,
    // out-of-band players). Skip rather than fabricate.
    if (!player || player.projection == null || player.projection <= 0) return null;

    const tier = liveDraft.findTier({
      position,
      sleeperProjection: player.projection,
      tierAggregates: cachedTierAggregates,
      playerPool: cachedPlayerPool,
      playerName: name,
    });
    if (!tier) return null;

    // Anchor the delta to the player's OWN projection (not tier median)
    // -- a T1 WR at the low end of the tier shouldn't be flagged as
    // "overpay" just because they cost more than the tier average.
    const delta = amount - player.projection;
    const pct = player.projection > 0 ? delta / player.projection : 0;
    const tierLabel = `${position} T${tier.tierIndex + 1}`;
    const deltaLabel = delta === 0
      ? 'at value'
      : delta > 0 ? `+$${delta}` : `-$${Math.abs(delta)}`;
    let tone = 'fair';
    if (pct <= -0.15) tone = 'bargain';
    else if (pct >= 0.15) tone = 'overpay';
    return { text: `${tierLabel} · ${deltaLabel}`, tone };
  }

  function renderPickLog(state) {
    const picks = state.picks || [];
    if (!picks.length) {
      livePickLog.innerHTML = '';
      livePickEmpty.hidden = false;
      return;
    }
    livePickEmpty.hidden = true;

    // Newest first, capped at 30 to keep DOM small.
    const shown = picks.slice(-30).reverse();
    const seenBefore = renderedPickNos;
    const nextSeen = new Set();

    // Rebuild list rather than diff -- 30 items, cheap and predictable.
    livePickLog.innerHTML = '';
    for (const p of shown) {
      const li = document.createElement('li');
      const pickNo = p.pick_no;
      nextSeen.add(pickNo);
      if (seenBefore.size && !seenBefore.has(pickNo)) li.classList.add('is-new');

      const num = document.createElement('span');
      num.className = 'live-pick-no';
      num.textContent = pickNo ? `#${pickNo}` : '';

      const main = document.createElement('span');
      main.className = 'live-pick-main';
      const player = document.createElement('span');
      player.className = 'live-pick-player';
      player.textContent = liveDraft.playerName(p);
      main.appendChild(player);
      const pos = (p.metadata && p.metadata.position) || '';
      const team = (p.metadata && p.metadata.team) || '';
      if (pos || team) {
        const meta = document.createElement('span');
        meta.className = 'live-pick-pos';
        meta.textContent = [pos, team].filter(Boolean).join(' · ');
        main.appendChild(meta);
      }
      const mgr = document.createElement('span');
      mgr.className = 'live-pick-mgr';
      mgr.textContent = liveDraft.managerLabel(p, state.managerNames);
      main.appendChild(mgr);

      // "Nominated by X" -- only present if we observed the nomination
      // live and captured the opener. Silently skipped for picks that
      // completed before Live Mode was opened.
      const nominator = nominatorsByPlayer.get(
        normPlayerKey(liveDraft.playerName(p), (p.metadata && p.metadata.position) || '')
      );
      if (nominator && nominator !== liveDraft.managerLabel(p, state.managerNames)) {
        const nom = document.createElement('span');
        nom.className = 'live-pick-nominator';
        nom.textContent = `Nominated by ${nominator}`;
        main.appendChild(nom);
      }

      // Post-pick verdict: tier + delta vs projection. Requires a
      // loaded pool (for tier + projection). When the pool isn't
      // loaded, we skip the badge silently rather than fake a signal.
      const amount = liveDraft.pickAmount(p);
      if (amount != null && cachedPlayerPool && pos && state.isAuction) {
        const verdict = buildPickVerdict(p, amount, pos);
        if (verdict) {
          const badge = document.createElement('span');
          badge.className = `live-pick-verdict is-${verdict.tone}`;
          badge.textContent = verdict.text;
          main.appendChild(badge);
        }
      }

      const amt = document.createElement('span');
      if (amount != null) {
        amt.className = 'live-pick-amt';
        amt.textContent = `$${amount}`;
      } else if (p.is_keeper) {
        amt.className = 'live-pick-amt is-keeper';
        amt.textContent = 'Keeper';
      } else {
        amt.className = 'live-pick-amt';
        amt.textContent = '';
      }

      li.appendChild(num);
      li.appendChild(main);
      li.appendChild(amt);
      livePickLog.appendChild(li);
    }
    renderedPickNos = nextSeen;
  }

  // ---------- sync flow ------------------------------------------------------
  syncBtn.addEventListener('click', async () => {
    const username = usernameInput.value.trim();
    if (!username) {
      setStatus(syncStatus, 'Enter your Sleeper username first.', 'error');
      return;
    }
    syncBtn.disabled = true;
    const originalLabel = syncBtn.textContent;
    setStatus(syncStatus, 'Looking up your account…');

    try {
      const user = await sleeperApi.getUserByUsername(username);
      if (!user) {
        setStatus(syncStatus, `No Sleeper user "${username}".`, 'error');
        return;
      }
      await storage.set('sleeperUsername', username);
      // Persist the resolved user_id alongside the username. Live
      // Mode uses it to identify the user's team column deterministically
      // against every name variant Sleeper might render (username /
      // display_name / team_name) instead of a single fragile string.
      await storage.set(YOUR_USER_ID_KEY, user.user_id);
      cachedUserId = user.user_id;

      setStatus(syncStatus, 'Fetching your leagues…');
      const leagues = await pastDrafts.fetchLeagues(user.user_id, SEASONS);

      if (!leagues.length) {
        setStatus(syncStatus, 'No past drafts found for that account.', 'error');
        return;
      }

      setStatus(syncStatus, `Analyzing ${leagues.length} draft(s)…`);
      const cache = await pastDrafts.cacheLeagueAnalysis(leagues, {
        userId: user.user_id,
        onProgress: ({ done, total, leagueName }) => {
          setStatus(
            syncStatus,
            leagueName
              ? `Analyzing ${leagueName} (${done + 1}/${total})…`
              : `Analyzing (${done}/${total})…`
          );
          syncBtn.textContent = `Syncing… ${done}/${total}`;
        },
      });

      if (!cache || !cache.seasonsAnalyzed) {
        const failures = (cache && cache.failures) || [];
        const detail = failures.length
          ? ` (first error: ${failures[0].message})`
          : '';
        setStatus(syncStatus, `Sync couldn't complete${detail}`, 'error');
        return;
      }

      // Flag the celebration for THIS session only. Closing and
      // reopening the panel will fall back to the condensed status bar.
      justSyncedInSession = true;
      showSyncedView(cache, username);
      setStatus(syncStatus, '');
      await updateDraftDayVisibility();

      if (cache.failures && cache.failures.length) {
        const failedNames = cache.failures
          .map((f) => `${f.season} · ${f.leagueName}`)
          .join(', ');
        setStatus(
          pastStatus,
          `Synced with warnings — couldn't load: ${failedNames}.`,
          'error'
        );
      }
    } catch (err) {
      setStatus(syncStatus, `Sync failed: ${friendlyErrorMessage(err)}`, 'error');
    } finally {
      syncBtn.disabled = false;
      syncBtn.textContent = originalLabel;
    }
  });

  // ---------- past-drafts export-all buttons --------------------------------
  exportAllCsvBtn.addEventListener('click', async () => {
    if (!loadedLeagues.length) return;
    exportAllCsvBtn.disabled = true;
    const originalLabel = exportAllCsvBtn.textContent;
    setStatus(pastStatus, 'Starting combined CSV export…');
    try {
      const result = await pastDrafts.exportAllDraftsAsCombinedCsv(loadedLeagues, {
        onProgress: ({ done, total, leagueName }) => {
          setStatus(
            pastStatus,
            leagueName ? `Fetching ${leagueName} (${done + 1}/${total})…` : `Fetching (${done}/${total})…`
          );
          exportAllCsvBtn.textContent = `Exporting… ${done}/${total}`;
        },
      });
      const failNote = result.failures.length ? ` (${result.failures.length} failed)` : '';
      setStatus(
        pastStatus,
        `Exported ${result.rowCount} picks from ${result.draftCount} draft(s) ✓${failNote}`,
        'success'
      );
    } catch (err) {
      setStatus(pastStatus, `Combined CSV export failed: ${friendlyErrorMessage(err)}`, 'error');
    } finally {
      exportAllCsvBtn.disabled = false;
      exportAllCsvBtn.textContent = originalLabel;
    }
  });

  // Applies the current auctionInsights flag state to the XLSX button.
  // Called at init, on subsequent renders, and when a flag flip lands
  // via chrome.storage.onChanged.
  function applyInsightsFlagToUI() {
    const allowed = featureFlags.isEnabled('auctionInsights');
    exportAllXlsxBtn.disabled = !allowed;
    if (!allowed) {
      exportAllXlsxBtn.textContent = 'Insights temporarily unavailable';
      exportAllXlsxBtn.classList.add('is-disabled-remote');
    } else {
      // Restore label without clobbering an in-progress "Exporting…"
      // state written by the click handler.
      if (!exportAllXlsxBtn.classList.contains('is-exporting')) {
        exportAllXlsxBtn.textContent = 'Export with insights (.xlsx)';
      }
      exportAllXlsxBtn.classList.remove('is-disabled-remote');
    }
  }

  // Re-run the visible parts that read flags. Cheap; called only when
  // the config actually changes.
  function rerenderForFlagChange() {
    applyInsightsFlagToUI();
    if (!liveDraftView.hidden && latestLiveDomState) renderLiveDomState();
  }

  exportAllXlsxBtn.addEventListener('click', async () => {
    if (!featureFlags.isEnabled('auctionInsights')) return;
    if (!loadedLeagues.length) return;
    exportAllXlsxBtn.disabled = true;
    const originalLabel = exportAllXlsxBtn.textContent;
    setStatus(pastStatus, 'Starting combined export…');
    try {
      const result = await pastDrafts.exportAllDrafts(loadedLeagues, {
        onProgress: ({ done, total, leagueName }) => {
          setStatus(
            pastStatus,
            leagueName
              ? `Fetching ${leagueName} (${done + 1}/${total})…`
              : `Fetching drafts (${done}/${total})…`
          );
          exportAllXlsxBtn.textContent = `Exporting… ${done}/${total}`;
        },
      });
      const failNote = result.failures.length ? ` (${result.failures.length} failed)` : '';
      const scopeNote =
        result.formatState && result.formatState.hasChanges
          ? ` · insights: latest ${result.analyzedDraftCount}/${result.draftCount} (format changed)`
          : '';
      setStatus(
        pastStatus,
        `Exported ${result.rowCount} picks from ${result.draftCount} draft(s) ✓${failNote}${scopeNote}`,
        'success'
      );
    } catch (err) {
      setStatus(pastStatus, `Combined export failed: ${friendlyErrorMessage(err)}`, 'error');
    } finally {
      exportAllXlsxBtn.disabled = false;
      exportAllXlsxBtn.textContent = originalLabel;
    }
  });

  // ---------- initial load ---------------------------------------------------
  async function init() {
    await loadTheme();
    // Hydrate feature flags from cache so isEnabled() is synchronous
    // for the render calls below. Background worker owns the fetch.
    // Also subscribe to live storage updates so an emergency-disable
    // pushed from the server takes effect without a panel reopen.
    try {
      await featureFlags.hydrateFromStorage(storage);
      featureFlags.subscribeToStorageChanges(chrome.storage, `draftpilot:${featureFlags.STORAGE_KEY}`);
      featureFlags.subscribe(() => rerenderForFlagChange());
      applyInsightsFlagToUI();
    } catch (_) { /* non-fatal; defaults apply */ }
    try {
      const [savedUsername, cache] = await Promise.all([
        storage.get('sleeperUsername'),
        storage.get('leagueTierAggregates'),
      ]);
      if (savedUsername) usernameInput.value = savedUsername;
      if (cache && cache.cachedAt && cache.seasonsAnalyzed) {
        showSyncedView(cache, savedUsername);
        await updateDraftDayVisibility();
      } else {
        showWelcomeView();
      }
    } catch (err) {
      showWelcomeView();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
