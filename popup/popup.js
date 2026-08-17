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
  const liveNominationStatus = document.getElementById('live-nomination-status');
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
  const liveInflAdvice = document.getElementById('live-infl-advice');
  const liveInflSupport = document.getElementById('live-infl-support');
  const liveSuggesterCard = document.getElementById('live-suggester-card');
  const liveSuggesterLoadBtn = document.getElementById('live-suggester-load-btn');
  const liveSuggesterStatus = document.getElementById('live-suggester-status');
  const liveSuggesterList = document.getElementById('live-suggester-list');
  const liveSuggesterFootnote = document.getElementById('live-suggester-footnote');

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

    // No pool yet -- show the load button; hide the empty list.
    if (!cachedPlayerPool) {
      liveSuggesterLoadBtn.hidden = false;
      liveSuggesterList.innerHTML = '';
      liveSuggesterFootnote.hidden = true;
      return;
    }

    // Pool present -- hide the load button unless it's stale (>1h).
    liveSuggesterLoadBtn.hidden = false; // always allow re-capture
    liveSuggesterLoadBtn.textContent = 'Refresh player pool';

    const teams = (latestLiveDomState && latestLiveDomState.teams) || [];
    const suggestions = liveDraft.suggestNominations({
      pool: cachedPlayerPool,
      completedPicks: session.picks || [],
      teams,
      tierAggregates: cachedTierAggregates,
      yourManager: cachedUsername,
      yourIdentity: currentIdentity(session),
      league: session.league,
      limit: 5,
    });

    liveSuggesterList.innerHTML = '';
    if (!suggestions.length) {
      liveSuggesterFootnote.hidden = false;
      liveSuggesterFootnote.textContent = teams.length
        ? 'No high-leverage nominations right now. Try refreshing the pool if picks have landed since your last capture.'
        : 'Suggestions activate once the draft-room DOM feed connects.';
      return;
    }

    for (const s of suggestions) {
      const li = document.createElement('li');
      if (s.selfNeed) li.classList.add('is-self-need');

      const player = document.createElement('div');
      player.className = 'live-suggester-player';
      const name = document.createElement('div');
      name.className = 'live-suggester-name';
      name.textContent = s.name;
      player.appendChild(name);

      const meta = document.createElement('div');
      meta.className = 'live-suggester-meta';
      meta.appendChild(document.createTextNode(
        [s.position, s.team].filter(Boolean).join(' · ') || s.position || ''
      ));
      if (s.tier) {
        const pill = document.createElement('span');
        const isElite = s.tier.tierIndex <= 2;
        pill.className = 'live-suggester-tier-pill' + (isElite ? ' is-elite' : '');
        pill.textContent = `${s.position} T${s.tier.tierIndex + 1}`;
        meta.appendChild(pill);
      }
      player.appendChild(meta);

      const reason = document.createElement('div');
      reason.className = 'live-suggester-reason';
      const teamsWord = s.needyCount === 1 ? 'team needs' : 'teams need';
      reason.textContent = s.selfNeed
        ? `${s.needyCount} other ${teamsWord} this position (you do too — risky)`
        : `${s.needyCount} ${teamsWord} this position`;
      player.appendChild(reason);

      // Deliberately not displaying a dollar amount here. burnPotential
      // drives the RANK (bigger = better nomination target) but shown
      // as a $ number it reads like a "nomination price," which is
      // misleading -- users open at $1 regardless.

      li.appendChild(player);
      liveSuggesterList.appendChild(li);
    }

    liveSuggesterFootnote.hidden = false;
    liveSuggesterFootnote.textContent = `Based on projections captured ${relativeTime(cachedPlayerPool.capturedAt)}.`;
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
    if (state.isAuction && state.budget) parts.push(`$${state.budget} budget`);
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
    if (state.status === 'loading') {
      hideLiveSubsections();
      liveConnecting.hidden = false;
      return;
    }
    if (state.status === 'error') {
      hideLiveSubsections();
      liveError.hidden = false;
      liveErrorMsg.textContent = state.lastError || 'Something went wrong.';
      return;
    }
    if (state.status === 'stopped') {
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
    const tone = pct >= 3 ? 'is-positive' : pct <= -3 ? 'is-negative' : '';

    // Primary number. Sign always shown so ± reads unambiguously; 0 gets
    // no sign so it reads as neutral rather than "positive zero."
    liveInflFactor.textContent = pct === 0
      ? '0%'
      : `${pct > 0 ? '+' : ''}${pct}%`;
    liveInflFactor.className = 'live-infl-factor' + (tone ? ' ' + tone : '');

    // Compact status word for the ambient chip. Bucketed on the same
    // ±5% / ±15% thresholds as the interpretation copy.
    if (liveInflWord) {
      let word = 'STEADY';
      if (pct >= 15) word = 'RUNAWAY';
      else if (pct >= 5) word = 'HOT';
      else if (pct <= -15) word = 'FROZEN';
      else if (pct <= -5) word = 'COOL';
      liveInflWord.textContent = word;
      liveInflWord.className = 'live-infl-word' + (tone ? ' ' + tone : '');
    }

    // Trend arrow: subtle nudge, not a chart. Requires the 5-pick
    // lookback samples to have accumulated (see INFLATION_TREND_LOOKBACK_PICKS).
    let trendDir = 'flat'; // 'up' | 'down' | 'flat'
    let trendMagnitude = 'mild'; // 'strong' | 'mild'
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

    // Interpretation + advice. Bucketed on the ±5% / ±15% bands so the
    // wording changes at meaningful thresholds, not on every jitter.
    // Trend nudges the advice when it disagrees with the level.
    let interp, advice;
    if (pct >= 15) {
      interp = 'Teams are hoarding cash.';
      advice = "Prices on the best players left will spike. Don't hesitate on your must-haves.";
    } else if (pct >= 5) {
      interp = 'Teams are holding back.';
      advice = 'Add a few dollars to your targets. Bidding will heat up.';
    } else if (pct <= -15) {
      interp = 'Money is drying up fast.';
      advice = "Stay patient. Bargains are coming — let others burn what they have left.";
    } else if (pct <= -5) {
      interp = 'Room is spending faster than expected.';
      advice = 'Value should show up soon. Hunt for it on your next few nominations.';
    } else {
      interp = 'Market pace looks normal.';
      advice = 'Stick to your values.';
    }
    // Trend override: strong upswing near neutral still deserves a heads-up.
    if (trendDir === 'up' && trendMagnitude === 'strong' && Math.abs(pct) < 5) {
      interp = 'Prices are climbing fast.';
      advice = 'Room just got cautious. Expect the next few players to go for more.';
    } else if (trendDir === 'down' && trendMagnitude === 'strong' && Math.abs(pct) < 5) {
      interp = 'Spending just spiked.';
      advice = 'Money is leaving the room quickly. Wait for the drop-off.';
    }
    liveInflInterp.textContent = interp;
    liveInflInterp.className = 'live-infl-interp' + (tone ? ' ' + tone : '');
    liveInflAdvice.textContent = advice;

    // One compact supporting row. Keeps the underlying math visible for
    // users who want to sanity-check, without a stat grid.
    const startingPerTeam = session.budget || 0;
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
    // Show whole dollars when the per-slot value is >=10 (typical mid/late
    // draft) and a decimal earlier when the room is still cash-rich; keeps
    // the row scannable without losing precision.
    const perSlotStr = perSlot >= 10
      ? `$${Math.round(perSlot)}`
      : `$${perSlot.toFixed(1)}`;
    liveInflSupport.textContent = `$${totalRemaining.toLocaleString()} left · ${perSlotStr} / open spot`;
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
      return;
    }
    liveNominationCard.hidden = false;

    liveNominationName.textContent = nom.playerName || 'Unknown player';
    const metaParts = [];
    if (nom.position) metaParts.push(nom.position);
    if (nom.team) metaParts.push(nom.team);
    liveNominationMeta.textContent = metaParts.join(' · ');

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
      liveNominationNominator.innerHTML = '';
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
    if (iAmTopBidder) {
      liveNominationStatus.textContent = 'YOUR BID';
      liveNominationStatus.className = 'live-nomination-status is-you';
    } else {
      liveNominationStatus.textContent = nom.status || 'LIVE';
      liveNominationStatus.className = 'live-nomination-status' +
        (nom.status && nom.status !== 'BIDDING' ? ' is-paused' : '');
    }

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

    renderYourTeamStrip(nom, teams);
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
  function renderMaxBidDetails(rec, insights) {
    liveDetailsBody.innerHTML = '';

    // Primary reason lead paragraph -- restates the card's one-line
    // reason so the details panel can be understood standalone.
    if (rec.primaryReason) {
      const lead = document.createElement('p');
      lead.className = 'live-details-lead';
      lead.textContent = rec.primaryReason;
      liveDetailsBody.appendChild(lead);
    }

    // The engine's own breakdown -- plain-language rows in dollars.
    if (Array.isArray(rec.breakdown) && rec.breakdown.length) {
      const wrap = document.createElement('div');
      wrap.className = 'live-details-row live-details-row-block';
      const dt = document.createElement('div');
      dt.className = 'live-details-label';
      dt.textContent = 'Breakdown';
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
    }

    // Alternatives -- distinct list-shaped view; keep it in the panel.
    const altList = insights && insights.alternatives && insights.alternatives.candidates;
    if (altList && altList.length) {
      const wrap = document.createElement('div');
      wrap.className = 'live-details-row live-details-row-block';
      const dt = document.createElement('div');
      dt.className = 'live-details-label';
      dt.textContent = 'Comparable players remaining';
      wrap.appendChild(dt);
      const ul = document.createElement('ul');
      ul.className = 'live-details-alt-list';
      altList.forEach((c) => {
        const li = document.createElement('li');
        const av = c.auctionContext && c.auctionContext.alternativeValue;
        const bits = [c.name];
        if (av != null) bits.push(`$${av}`);
        li.textContent = bits.join(' · ');
        ul.appendChild(li);
      });
      wrap.appendChild(ul);
      liveDetailsBody.appendChild(wrap);
    }

    // Confidence footnote -- only shown when we're operating on
    // partial data. Helps a manager know when to trust the number.
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
      liveNominationDetailsSummary.textContent = 'Why?';
    }
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
      renderMaxBidDetails(rec, insights);
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
      liveNominationDetailsSummary.textContent = 'Details';
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
   * Alternatives section: top 3-5 replacement candidates for the
   * nominated player, ranked by Alternative Score (production-dominant,
   * scarcity/consistency/playoff/rosterFit as configured). Auction
   * price is surfaced as a secondary column so the delta is obvious
   * without inflating the score.
   *
   * Reads only from insights.alternatives; no math here (spec §20).
   */
  function renderAlternatives(alt, nom, ctx) {
    if (!liveAlternatives) return;
    ctx = ctx || {};
    void nom; void ctx;

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
    const TOP_N = 2;
    alt.candidates.slice(0, TOP_N).forEach((c) => {
      const li = document.createElement('li');
      li.className = 'live-alternatives-row';

      const name = document.createElement('span');
      name.className = 'live-alternatives-name';
      name.textContent = c.name;
      li.appendChild(name);

      const av = c.auctionContext && c.auctionContext.alternativeValue;
      if (av != null) {
        const valEl = document.createElement('span');
        valEl.className = 'live-alternatives-value';
        valEl.textContent = `$${av}`;
        li.appendChild(valEl);
      }

      const label = document.createElement('span');
      label.className = 'live-alternatives-label-inline';
      // Simple qualitative label instead of a numeric score. Threshold
      // matches the engine's own "strong" cutoff (~70).
      label.textContent = (c.alternativeScore != null && c.alternativeScore >= 70)
        ? 'Strong'
        : 'Similar';
      li.appendChild(label);

      liveAlternativesList.appendChild(li);
    });

    // "See all alternatives" footer — only when there's more to see.
    if (alt.candidates.length > TOP_N) {
      const more = document.createElement('li');
      more.className = 'live-alternatives-more';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'link-btn';
      btn.textContent = `See all ${alt.candidates.length} alternatives`;
      btn.addEventListener('click', () => {
        if (liveNominationDetails) {
          liveNominationDetails.open = true;
          liveNominationDetails.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
      more.appendChild(btn);
      liveAlternativesList.appendChild(more);
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

    // Headline: the decision + your max together. Big number is the
    // strategic ceiling, not "value" -- managers optimise a roster,
    // not a price index.
    let headline;
    if (rec.recommendation === 'PASS') {
      const over = Math.max(1, currentBid - yourMax);
      headline = `PASS · $${over} over`;
    } else if (rec.recommendation === 'CAUTION') {
      headline = `CAUTION · max $${yourMax}`;
    } else {
      headline = `BUY to $${yourMax}`;
    }
    liveNominationRecHeadline.textContent = headline;

    // Sub-line: fair value, current bid, remaining room, then the
    // one-line reason. All plain-language, no percentages.
    const parts = [];
    parts.push(`Fair <b>$${rec.fairValue}</b>`);
    parts.push(`Bid <b>$${currentBid}</b>`);
    if (rec.recommendation === 'PASS') {
      parts.push(`<b>$${Math.abs(remaining)} over</b>`);
    } else if (remaining > 0) {
      parts.push(`<b>$${remaining}</b> room`);
    }
    liveNominationRecRange.hidden = false;
    liveNominationRecRange.innerHTML = parts.join(' · ')
      + (rec.primaryReason ? ` <span class="live-nomination-rec-reason">— ${escapeHtml(rec.primaryReason)}</span>` : '');

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
