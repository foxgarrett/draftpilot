(function (global) {
  const NAMESPACE = 'draftpilot';

  function key(name) {
    return `${NAMESPACE}:${name}`;
  }

  function get(name) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(key(name), (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(result[key(name)]);
      });
    });
  }

  function set(name, value) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [key(name)]: value }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    });
  }

  function remove(name) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove(key(name), () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    });
  }

  global.DraftPilot = global.DraftPilot || {};
  global.DraftPilot.storage = { get, set, remove };
})(typeof window !== 'undefined' ? window : globalThis);
