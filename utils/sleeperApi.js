(function (global) {
  const BASE = 'https://api.sleeper.app/v1';

  /**
   * Wraps a raw network/HTTP error with a plain-English `userMessage` so
   * callers can surface something actionable without needing to read the
   * raw fetch error. Also preserves the technical details (path, status)
   * for debugging via logger.
   */
  function apiError(userMessage, cause) {
    const err = new Error(userMessage);
    err.userMessage = userMessage;
    if (cause) {
      err.cause = cause;
      err.status = cause.status;
      err.path = cause.path;
    }
    return err;
  }

  // Sleeper's public API returns HTTP 200 + `null` body for unknown users
  // and unknown leagues, rather than 404. Callers get null in both cases so
  // they can decide what "not found" means in context.
  async function getJson(path) {
    let response;
    try {
      response = await fetch(`${BASE}${path}`);
    } catch (err) {
      // fetch() throws TypeError only when the network layer failed --
      // DNS, offline, CORS, aborted. Treat all of these as "offline" for
      // the user; technical detail goes to the logger.
      throw apiError("Can't reach Sleeper. Check your internet connection and try again.", {
        path,
        original: err,
      });
    }
    if (!response.ok) {
      const status = response.status;
      let userMessage;
      if (status === 429) {
        userMessage = "Sleeper's API is throttling requests. Wait a minute and try again.";
      } else if (status >= 500) {
        userMessage = "Sleeper's servers returned an error. Try again in a moment.";
      } else if (status === 404) {
        // Rare -- Sleeper usually returns 200 + null for not-found. Kept
        // for endpoints that legitimately 404 (some draft IDs).
        userMessage = "That Sleeper resource wasn't found. Double-check the ID or URL.";
      } else {
        userMessage = `Sleeper's API returned an error (${status}). Please try again.`;
      }
      throw apiError(userMessage, { path, status });
    }
    return response.json();
  }

  function getUserByUsername(username) {
    return getJson(`/user/${encodeURIComponent(username)}`);
  }

  function getUserLeagues(userId, season) {
    return getJson(`/user/${userId}/leagues/nfl/${season}`);
  }

  function getDraft(draftId) {
    return getJson(`/draft/${draftId}`);
  }

  function getDraftPicks(draftId) {
    return getJson(`/draft/${draftId}/picks`);
  }

  function getLeagueUsers(leagueId) {
    return getJson(`/league/${leagueId}/users`);
  }

  function getLeague(leagueId) {
    return getJson(`/league/${leagueId}`);
  }

  global.DraftPilot = global.DraftPilot || {};
  global.DraftPilot.sleeperApi = {
    getUserByUsername,
    getUserLeagues,
    getDraft,
    getDraftPicks,
    getLeagueUsers,
    getLeague,
  };
})(typeof window !== 'undefined' ? window : globalThis);
