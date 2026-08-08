(function (global) {
  const BASE = 'https://api.sleeper.app/v1';

  // Sleeper's public API returns HTTP 200 + `null` body for unknown users
  // and unknown leagues, rather than 404. Callers get null in both cases so
  // they can decide what "not found" means in context.
  async function getJson(path) {
    const response = await fetch(`${BASE}${path}`);
    if (!response.ok) {
      throw new Error(`Sleeper API ${response.status}: ${path}`);
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
