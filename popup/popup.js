(function () {
  const DRAFT_URL_PATTERN = /^https:\/\/([\w-]+\.)?sleeper\.(com|app)\/draft\//;

  const button = document.getElementById('export-btn');
  const status = document.getElementById('status');

  function setStatus(text, kind) {
    status.textContent = text;
    status.className = 'status' + (kind ? ` ${kind}` : '');
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
      setStatus(`Collecting players… (${message.collected})`);
    }
  });

  button.addEventListener('click', async () => {
    button.disabled = true;
    setStatus('Checking page…');

    try {
      const tab = await getActiveTab();

      if (!tab || !tab.url || !DRAFT_URL_PATTERN.test(tab.url)) {
        setStatus('Open a Sleeper draft room to export.', 'error');
        return;
      }

      setStatus('Exporting…');
      const response = await sendExportMessage(tab.id);

      if (response && response.success) {
        setStatus(`Exported ${response.count} players ✓`, 'success');
      } else {
        setStatus((response && response.error) || 'Export failed.', 'error');
      }
    } catch (err) {
      setStatus('Could not reach the draft page. Reload it and try again.', 'error');
    } finally {
      button.disabled = false;
    }
  });

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const last = await window.DraftPilot.storage.get('lastExport');
      if (last && last.timestamp) {
        setStatus(`Last export: ${last.count} players (${new Date(last.timestamp).toLocaleString()})`);
      }
    } catch (err) {
      // Non-critical: popup still works without a stored last-export summary.
    }
  });
})();
