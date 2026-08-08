const BASE = 'https://api.sleeper.app/v1';
const cache = new Map();

async function getJson(path) {
  if (cache.has(path)) return cache.get(path);
  const response = await fetch(`${BASE}${path}`);
  if (!response.ok) throw new Error(`Sleeper API ${response.status}: ${path}`);
  const data = await response.json();
  cache.set(path, data);
  return data;
}

const getUserByUsername = (u) => getJson(`/user/${encodeURIComponent(u)}`);
const getUserLeagues = (uid, season) => getJson(`/user/${uid}/leagues/nfl/${season}`);
const getDraft = (id) => getJson(`/draft/${id}`);
const getDraftPicks = (id) => getJson(`/draft/${id}/picks`);
const getLeagueUsers = (id) => getJson(`/league/${id}/users`);
const getLeague = (id) => getJson(`/league/${id}`);

module.exports = {
  getUserByUsername,
  getUserLeagues,
  getDraft,
  getDraftPicks,
  getLeagueUsers,
  getLeague,
};
