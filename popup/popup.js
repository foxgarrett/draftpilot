(function () {
  const DRAFT_URL_PATTERN = /^https:\/\/([\w-]+\.)?sleeper\.(com|app)\/draft\//;
  const PAST_SEASON_COUNT = 5;
  const SEASONS = Array.from({ length: PAST_SEASON_COUNT }, (_, i) =>
    String(new Date().getFullYear() - 1 - i)
  );

  const { sleeperApi, storage, pastDrafts } = window.DraftPilot;

  const usernameInput = document.getElementById('username-input');
  const syncBtn = document.getElementById('sync-btn');
  const syncStatus = document.getElementById('sync-status');
  const exportBtn = document.getElementById('export-btn');
  const enrichmentStatus = document.getElementById('enrichment-status');
  const status = document.getElementById('status');
  const pastSection = document.getElementById('past-drafts-section');
  const exportAllBtn = document.getElementById('export-all-btn');
  const exportAllCsvBtn = document.getElementById('export-all-csv-btn');
  const pastStatus = document.getElementById('past-status');
  const draftList = document.getElementById('draft-list');

  // Populated by sync or restored from storage on load; the past-drafts
  // export flow reads from this without needing to re-fetch.
  let loadedLeagues = [];

  function setStatus(el, text, kind) {
    el.textContent = text;
    el.className = 'status' + (kind ? ` ${kind}` : '');
  }

  /** Pull the friendliest message from an error thrown anywhere in the
   * stack. sleeperApi.js adds `userMessage`; everything else falls back
   * to the raw `.message`. */
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
    const days = Math.round(hours / 24);
    return `${days}d ago`;
  }

  function getActiveTab() {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(tabs[0]);
      });
    });
  }

  function sendExportMessage(tabId) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { type: 'DRAFTPILOT_EXPORT' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'DRAFTPILOT_PROGRESS') {
      setStatus(status, `Collecting players… (${message.collected})`);
    }
  });

  // ------------------------------------------------------------------
  // Current Draft Room
  // ------------------------------------------------------------------
  exportBtn.addEventListener('click', async () => {
    exportBtn.disabled = true;
    setStatus(status, 'Checking page…');

    try {
      const tab = await getActiveTab();
      if (!tab || !tab.url || !DRAFT_URL_PATTERN.test(tab.url)) {
        setStatus(status, 'Open a Sleeper draft room to export.', 'error');
        return;
      }
      setStatus(status, 'Exporting…');
      const response = await sendExportMessage(tab.id);
      if (response && response.success) {
        setStatus(status, `Exported ${response.count} players ✓`, 'success');
      } else {
        setStatus(status, (response && response.error) || 'Export failed.', 'error');
      }
    } catch (err) {
      // Distinguish "content script never loaded" (extension installed
      // after page loaded, or Sleeper's SPA navigated without a full
      // reload) from an actual export error thrown by our own code.
      const raw = err && err.message ? err.message : '';
      if (/Receiving end does not exist|Could not establish connection/i.test(raw)) {
        setStatus(
          status,
          "Draft Pilot isn't running on this tab yet. Reload the draft page and try again.",
          'error'
        );
      } else {
        setStatus(status, `Export failed: ${friendlyErrorMessage(err)}`, 'error');
      }
    } finally {
      exportBtn.disabled = false;
    }
  });

  // ------------------------------------------------------------------
  // Past Drafts rendering (populated from cache OR fresh sync).
  // ------------------------------------------------------------------
  function renderDraftList(leagues) {
    draftList.innerHTML = '';
    leagues
      .slice()
      .sort((a, b) => b.season.localeCompare(a.season) || a.leagueName.localeCompare(b.leagueName))
      .forEach((league) => {
        const li = document.createElement('li');
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

  function showPastSection(leagues) {
    if (!leagues || !leagues.length) {
      pastSection.hidden = true;
      return;
    }
    loadedLeagues = leagues;
    renderDraftList(leagues);
    pastSection.hidden = false;
  }

  function renderEnrichmentStatus(cache) {
    if (!cache) {
      enrichmentStatus.textContent =
        'Sync your league above to include a League-Adjusted Value column.';
      return;
    }
    enrichmentStatus.textContent = `✓ Includes League-Adjusted Value (from ${cache.seasonsAnalyzed} synced season${cache.seasonsAnalyzed === 1 ? '' : 's'})`;
  }

  function renderSyncStatus(cache) {
    if (!cache || !cache.cachedAt) {
      // First-time state: guide the user toward the action instead of
      // leaving the status line blank.
      setStatus(
        syncStatus,
        "Not synced yet. Enter your username and click Sync to unlock league-specific analysis.",
        'subtle'
      );
      return;
    }
    const formatNote = cache.hasFormatChanges
      ? ` (analyzed latest ${cache.seasonsAnalyzed}/${cache.totalDraftsFound})`
      : '';
    setStatus(
      syncStatus,
      `✓ ${cache.seasonsAnalyzed} past draft${cache.seasonsAnalyzed === 1 ? '' : 's'} · ${cache.formatLabel}${formatNote} · synced ${relativeTime(cache.cachedAt)}`,
      'success'
    );
  }

  // ------------------------------------------------------------------
  // Sync flow -- fetches leagues, runs analysis, caches the result.
  // Single button, one setup step. Anywhere on the web.
  // ------------------------------------------------------------------
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

      setStatus(syncStatus, 'Fetching your leagues…');
      const leagues = await pastDrafts.fetchLeagues(user.user_id, SEASONS);

      if (!leagues.length) {
        setStatus(syncStatus, 'No past drafts found for that account.', 'error');
        showPastSection([]);
        renderEnrichmentStatus(null);
        return;
      }

      setStatus(syncStatus, `Analyzing ${leagues.length} draft(s)…`);
      const cache = await pastDrafts.cacheLeagueAnalysis(leagues, {
        onProgress: ({ done, total, leagueName }) => {
          const label = leagueName
            ? `Analyzing ${leagueName} (${done + 1}/${total})…`
            : `Analyzing (${done}/${total})…`;
          setStatus(syncStatus, label);
          syncBtn.textContent = `Syncing… ${done}/${total}`;
        },
      });

      // Complete failure: nothing loaded. Surface which leagues failed
      // instead of a generic "Sync failed" so the user knows what to try.
      if (!cache || !cache.seasonsAnalyzed) {
        const failures = (cache && cache.failures) || [];
        const detail = failures.length
          ? ` (${failures.length} draft${failures.length === 1 ? '' : 's'} couldn't be loaded — first error: ${failures[0].message})`
          : '';
        setStatus(syncStatus, `Sync couldn't complete${detail}`, 'error');
        return;
      }

      showPastSection(leagues);
      renderEnrichmentStatus(cache);
      renderSyncStatus(cache);

      // Partial failure: some leagues loaded, some didn't. Show a
      // warning-style success so the user knows their analysis is
      // incomplete and can act on it.
      if (cache.failures && cache.failures.length) {
        const failedNames = cache.failures
          .map((f) => `${f.season} · ${f.leagueName}`)
          .join(', ');
        setStatus(
          syncStatus,
          `✓ Synced with warnings — couldn't load: ${failedNames}. Insights based on the ${cache.seasonsAnalyzed} draft${cache.seasonsAnalyzed === 1 ? '' : 's'} that did load.`,
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

  // ------------------------------------------------------------------
  // Past Drafts export-all buttons.
  // ------------------------------------------------------------------
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

  exportAllBtn.addEventListener('click', async () => {
    if (!loadedLeagues.length) return;
    exportAllBtn.disabled = true;
    const originalLabel = exportAllBtn.textContent;
    setStatus(pastStatus, 'Starting combined export…');
    try {
      const result = await pastDrafts.exportAllDrafts(loadedLeagues, {
        onProgress: ({ done, total, leagueName }) => {
          const label = leagueName
            ? `Fetching ${leagueName} (${done + 1}/${total})…`
            : `Fetching drafts (${done}/${total})…`;
          setStatus(pastStatus, label);
          exportAllBtn.textContent = `Exporting… ${done}/${total}`;
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
      exportAllBtn.disabled = false;
      exportAllBtn.textContent = originalLabel;
    }
  });

  // ------------------------------------------------------------------
  // On popup open: restore saved username + cached league data so the
  // user sees a "ready" state without having to re-sync.
  // ------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const [savedUsername, cache, lastExport] = await Promise.all([
        storage.get('sleeperUsername'),
        storage.get('leagueTierAggregates'),
        storage.get('lastExport'),
      ]);
      if (savedUsername) usernameInput.value = savedUsername;
      if (cache) {
        renderSyncStatus(cache);
        renderEnrichmentStatus(cache);
        if (cache.leagues && cache.leagues.length) showPastSection(cache.leagues);
      } else {
        renderSyncStatus(null);
        renderEnrichmentStatus(null);
      }
      if (lastExport && lastExport.timestamp) {
        setStatus(
          status,
          `Last export: ${lastExport.count} players (${relativeTime(lastExport.timestamp)})`
        );
      }
    } catch (err) {
      // Non-critical: popup still works without storage hints.
    }
  });
})();
