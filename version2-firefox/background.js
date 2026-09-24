const FUTGG_BASE = "https://www.fut.gg";
let teamIndexCache = { expires: 0, teams: [] };

function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}

function cleanText(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ").trim();
}

function absolute(href) {
  try { return new URL(href, FUTGG_BASE).href; } catch { return ""; }
}

function isLeaguePage(url) {
  try { return /^\/fut-gallery\/[^/]+\/?$/.test(new URL(url).pathname); } catch { return false; }
}

function isTeamPage(url) {
  try { return /^\/fut-gallery\/[^/]+\/[^/]+\/?$/.test(new URL(url).pathname); } catch { return false; }
}

function teamLinksFromHtml(html) {
  const found = [];
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorPattern.exec(html))) {
    const url = absolute(match[1]);
    if (!isTeamPage(url)) continue;
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const slug = parts[2];
    const text = cleanText(match[2]);
    const name = text.replace(/\s+FUT Gallery Set.*$/i, "").trim() || slug.replace(/-/g, " ");
    found.push({ name, slug, url });
  }
  return [...new Map(found.map((team) => [team.url, team])).values()];
}

async function getHtml(url) {
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok) throw new Error(`FUT.GG returned HTTP ${response.status}.`);
  return response.text();
}

async function getTeamIndex() {
  if (teamIndexCache.expires > Date.now() && teamIndexCache.teams.length) return teamIndexCache.teams;
  const rootHtml = await getHtml(`${FUTGG_BASE}/fut-gallery/`);
  const rootTeams = teamLinksFromHtml(rootHtml);
  const leagueUrls = new Set([`${FUTGG_BASE}/fut-gallery/`]);
  const leaguePattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = leaguePattern.exec(rootHtml))) {
    const url = absolute(match[1]);
    if (isLeaguePage(url)) leagueUrls.add(url);
  }

  const pages = await Promise.all([...leagueUrls].map(async (url) => {
    try { return teamLinksFromHtml(await getHtml(url)); } catch { return []; }
  }));
  teamIndexCache = { expires: Date.now() + 5 * 60 * 1000, teams: [...new Map([...rootTeams, ...pages.flat()].map((team) => [team.url, team])).values()] };
  return teamIndexCache.teams;
}

async function findTeam(query, slug = "") {
  const requested = normalize(query);
  const requestedSlug = normalize(slug);
  const teams = await getTeamIndex();
  if (requestedSlug) {
    const slugMatch = teams.find((team) => normalize(team.slug) === requestedSlug);
    if (slugMatch) return slugMatch;
  }
  if (!requested) return null;
  return teams.find((team) => [team.name, team.slug].some((value) => normalize(value) === requested))
    || teams.find((team) => [team.name, team.slug].some((value) => normalize(value).includes(requested)));
}

function extractPlayers(html) {
  const found = [];
  const seen = new Set();
  const pattern = /<a\b[^>]*href=["']([^"']*\/players\/[^"']+)["'][^>]*>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    let url;
    try { url = new URL(match[1], FUTGG_BASE); } catch { continue; }
    const playerMatch = url.pathname.match(/\/players\/(\d+)-([^/]+)(?:\/(?:\d+-)?(\d+))?\/?$/);
    if (!playerMatch) continue;
    const id = playerMatch[3] || playerMatch[1];
    if (seen.has(id)) continue;
    seen.add(id);
    found.push({
      id,
      name: decodeURIComponent(playerMatch[2]).replace(/-/g, " ").replace(/\b\p{L}/gu, (letter) => letter.toUpperCase())
    });
  }
  return found;
}

async function extractTeam(query, slug = "") {
  const team = await findTeam(query, slug);
  if (!team) throw new Error(`No FUT.GG gallery team found for “${query}”.`);
  const html = await getHtml(team.url);
  const players = extractPlayers(html);
  if (!players.length) throw new Error(`No players were found for ${team.name} on FUT.GG.`);
  return {
    teamName: team.name,
    teamQuery: query,
    teamUrl: team.url,
    players,
    ids: players.map((player) => player.id),
    idsText: players.map((player) => player.id).join(", "),
    savedAt: Date.now(),
    source: "fut-enhancer-gallery"
  };
}

async function saveResult(result) {
  await chrome.storage.local.set({
    lastState: { 
      teamQuery: result.teamQuery || result.teamName,
      teamName: result.teamName,
      players: result.players,
      idsText: result.idsText,
      galleryInfo: null,
      savedAt: result.savedAt,
      source: result.source
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "galleryTeamClicked") return undefined;
  if (!sender.tab?.id) return false;

  (async () => {
    try {
      const result = await extractTeam(message.teamName, message.teamSlug);
      await saveResult(result);
      let applied;
      try {
        applied = await chrome.tabs.sendMessage(sender.tab.id, {
          type: "applyGalleryTeamIds",
          teamName: result.teamName,
          ids: result.idsText
        });
      } catch {
        await chrome.scripting.executeScript({ target: { tabId: sender.tab.id }, files: ["content.js"] });
        applied = await chrome.tabs.sendMessage(sender.tab.id, {
          type: "applyGalleryTeamIds",
          teamName: result.teamName,
          ids: result.idsText
        });
      }
      // The popup is a separate extension context. Broadcast the completed
      // result to it when it is open; storage remains the source of truth when
      // the popup is closed and is restored on the next open.
      try {
        await chrome.runtime.sendMessage({
          type: "galleryExtractionComplete",
          teamName: result.teamName,
          players: result.players,
          idsText: result.idsText
        });
      } catch {}
      sendResponse({ ok: applied?.ok !== false, teamName: result.teamName, count: result.players.length, reason: applied?.reason });
    } catch (error) {
      sendResponse({ ok: false, reason: error.message || "Could not load the selected FUT.GG team." });
    }
  })();
  return true;
});
