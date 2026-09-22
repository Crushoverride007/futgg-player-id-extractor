const BASE = "https://www.fut.gg";
const $ = (id) => document.getElementById(id);
const teamInput = $("team");
const status = $("status");
const choices = $("choices");
const results = $("results");
const playersOutput = $("players");
const idsOutput = $("ids");
const copyButton = $("copy");
const applyButton = $("apply");
const syncSellButton = $("sync-sell");
const gradeList = $("grade-list");
const galleryInfo = $("gallery-info");
const teamSummary = $("team-summary");

let currentState = { teamQuery: "", teamName: "", players: [], idsText: "", galleryInfo: null, savedAt: 0, source: "" };

function normalize(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}

function documentFrom(html) {
  return new DOMParser().parseFromString(html, "text/html");
}

async function getHtml(url) {
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok) throw new Error(`FUT.GG returned HTTP ${response.status}.`);
  return response.text();
}

function absolute(href) {
  return new URL(href, BASE).href;
}

function isLeaguePage(url) {
  return /^\/fut-gallery\/[^/]+\/?$/.test(new URL(url).pathname);
}

function isTeamPage(url) {
  return /^\/fut-gallery\/[^/]+\/[^/]+\/?$/.test(new URL(url).pathname);
}

function teamLinksFrom(html) {
  const doc = documentFrom(html);
  const found = [];
  for (const anchor of doc.querySelectorAll("a[href]")) {
    const url = absolute(anchor.getAttribute("href"));
    if (!isTeamPage(url)) continue;
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const slug = parts[2];
    const text = anchor.textContent.replace(/\s+/g, " ").trim();
    const name = text.replace(/\s+FUT Gallery Set.*$/i, "").trim() || slug.replace(/-/g, " ");
    found.push({ name, slug, url });
  }
  return [...new Map(found.map((team) => [team.url, team])).values()];
}

async function findTeams(query) {
  const requested = normalize(query);
  const root = documentFrom(await getHtml(`${BASE}/fut-gallery/`));
  const leagueUrls = new Set([`${BASE}/fut-gallery/`]);
  for (const anchor of root.querySelectorAll("a[href]")) {
    const url = absolute(anchor.getAttribute("href"));
    if (isLeaguePage(url)) leagueUrls.add(url);
  }

  const lists = await Promise.all([...leagueUrls].map(async (url) => {
    try { return teamLinksFrom(await getHtml(url)); } catch { return []; }
  }));
  const teams = [...new Map(lists.flat().map((team) => [team.url, team])).values()];
  const exact = teams.filter((team) => [team.name, team.slug].some((x) => normalize(x) === requested));
  if (exact.length) return exact;
  return teams.filter((team) => [team.name, team.slug].some((x) => normalize(x).includes(requested)));
}

function cleanText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function metricValue(doc, label) {
  const title = [...doc.querySelectorAll("dt")]
    .find((element) => cleanText(element.textContent) === label);
  if (!title) return "Not available";
  const value = title.parentElement?.querySelector("dd");
  return value ? cleanText(value.textContent) : "Not available";
}

function extractGalleryInfo(html) {
  const doc = documentFrom(html);
  const tabs = [...doc.querySelectorAll('button[role="tab"]')];
  const grades = tabs.map((tab) => {
    const title = tab.getAttribute("title") || "";
    const match = title.match(/Grade\s+([A-Z])\s+needs\s+([\d,]+)/i);
    const text = cleanText(tab.textContent);
    const grade = match?.[1] || text.match(/[DCBAS]/)?.[0] || "?";
    const tokens = text.match(/([\d,]+)\s+tokens/i)?.[1] || "—";
    return { grade, threshold: match?.[2] || "—", tokens, selected: tab.getAttribute("aria-selected") === "true" };
  });

  const scoreTitle = doc.querySelector('[title*="grading score"]');
  const scoreText = scoreTitle ? cleanText(scoreTitle.parentElement?.textContent || "") : "";
  const score = scoreText.match(/([\d,]+)\s*\/\s*([\d,]+)/);

  return {
    grades,
    selectedGrade: grades.find((grade) => grade.selected)?.grade || grades.at(-1)?.grade || "—",
    metrics: {
      "Coins needed": metricValue(doc, "Coins needed"),
      "Total price": metricValue(doc, "Total price"),
      "Lost to tax": metricValue(doc, "Lost to tax"),
      "Score": score ? `${score[1]} / ${score[2]}` : metricValue(doc, "Score"),
      "Gallery Tokens": metricValue(doc, "Gallery Tokens"),
      "Items": metricValue(doc, "Items")
    }
  };
}

function renderGalleryInfo(info, players, teamName) {
  teamSummary.replaceChildren();
  gradeList.replaceChildren();
  galleryInfo.replaceChildren();

  const summaryValues = [
    ["Team", teamName],
    ["Players found", String(players.length)],
    ["Selected grade", info.selectedGrade]
  ];

  for (const [label, value] of summaryValues) {
    const card = document.createElement("div");
    card.className = "summary-card";
    const labelElement = document.createElement("span");
    labelElement.className = "summary-label";
    labelElement.textContent = label;
    const valueElement = document.createElement("span");
    valueElement.className = "summary-value";
    valueElement.textContent = value;
    card.append(labelElement, valueElement);
    teamSummary.appendChild(card);
  }

  for (const grade of info.grades) {
    const card = document.createElement("div");
    card.className = `grade-card${grade.grade === info.selectedGrade ? " selected" : ""}`;
    card.innerHTML = `<span class="grade-label">Grade</span><span class="grade-value">${grade.grade} · ${grade.tokens} tokens</span>`;
    gradeList.appendChild(card);
  }

  for (const [label, value] of Object.entries(info.metrics)) {
    const card = document.createElement("div");
    card.className = "metric";
    card.innerHTML = `<span class="metric-label"></span><span class="metric-value"></span>`;
    card.querySelector(".metric-label").textContent = label;
    card.querySelector(".metric-value").textContent = value;
    galleryInfo.appendChild(card);
  }
}

function extractPlayers(html) {
  const doc = documentFrom(html);
  const found = [];
  const seen = new Set();
  for (const anchor of doc.querySelectorAll('a[href*="/players/"]')) {
    const href = anchor.getAttribute("href") || "";
    const match = href.match(/\/players\/(\d+)-([^/]+)(?:\/(?:\d+-)?(\d+))?\/?$/);
    if (!match) continue;

    // FUT.GG URLs contain two IDs for some current cards. The first one is
    // FUT.GG's base-player record, while the final ID is the current EA/FC
    // item ID required by FUT Enhancer. The data attribute is the best source
    // when available and also covers dynamically rendered gallery entries.
    const galleryId = anchor.closest("[data-gallery-lineup-player]")?.getAttribute("data-gallery-lineup-player");
    const id = galleryId || match[3] || match[1];
    if (seen.has(id)) continue;
    seen.add(id);
    found.push({ id, name: decodeURIComponent(match[2]).replace(/-/g, " ").replace(/\b\p{L}/gu, (c) => c.toUpperCase()) });
  }
  return found;
}

function setStatus(message, error = false) {
  status.textContent = message;
  status.className = error ? "error" : "";
}

function clear() {
  setStatus("");
  choices.replaceChildren();
  choices.style.display = "none";
  results.style.display = "none";
  playersOutput.replaceChildren();
  teamSummary.replaceChildren();
  gradeList.replaceChildren();
  galleryInfo.replaceChildren();
  idsOutput.value = "";
  copyButton.disabled = true;
  applyButton.disabled = true;
  syncSellButton.disabled = true;
}

function setCurrentState(patch) {
  currentState = { ...currentState, ...patch, savedAt: Date.now() };
  chrome.storage.local.set({ lastState: currentState }).catch(() => {});
}

function restoreState(state) {
  if (!state?.players?.length || !state.idsText) return;
  currentState = { ...currentState, ...state };
  teamInput.value = state.teamQuery || state.teamName || "";
  render(state.players, state.galleryInfo, state.teamName || state.teamQuery || "Restored team", false);
  setStatus(`Restored ${state.players.length} players from ${state.teamName || state.teamQuery}.`);
}

function render(players, galleryInfoData, teamName, persist = true) {
  renderGalleryInfo(galleryInfoData || { grades: [], selectedGrade: "—", metrics: {} }, players, teamName);
  playersOutput.replaceChildren();
  for (const player of players) {
    const item = document.createElement("li");
    item.textContent = `${player.name} — ${player.id}`;
    playersOutput.appendChild(item);
  }
  idsOutput.value = players.map((player) => player.id).join(", ");
  copyButton.disabled = false;
  applyButton.disabled = false;
  syncSellButton.disabled = false;
  results.style.display = "block";
  if (persist) setCurrentState({ teamName, teamQuery: teamName, players, idsText: idsOutput.value, galleryInfo: galleryInfoData, source: "manual" });
  setStatus(`${players.length} players found for ${teamName}.`);
}

async function loadTeam(team) {
  try {
    choices.replaceChildren();
    choices.style.display = "none";
    results.style.display = "none";
    setStatus(`Loading ${team.name}...`);
    const teamHtml = await getHtml(team.url);
    const players = extractPlayers(teamHtml);
    if (!players.length) throw new Error("No players were found on that FUT.GG page.");
    render(players, extractGalleryInfo(teamHtml), team.name);
    setStatus(`Players found: ${players.length}. Gallery data loaded for ${team.name}.`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

$("extract").addEventListener("click", async () => {
  clear();
  const query = teamInput.value.trim();
  if (!query) return setStatus("Please enter a team name.", true);
  try {
    setStatus("Finding the team...");
    const matches = await findTeams(query);
    if (!matches.length) throw new Error(`No FUT.GG gallery team found for “${query}”.`);
    if (matches.length === 1) return loadTeam(matches[0]);
    setStatus("Several teams matched. Choose one:");
    choices.style.display = "block";
    for (const team of matches) {
      const button = document.createElement("button");
      button.className = "secondary";
      button.textContent = team.name;
      button.addEventListener("click", () => loadTeam(team));
      choices.appendChild(button);
    }
  } catch (error) {
    setStatus(error.message, true);
  }
});

copyButton.addEventListener("click", async () => {
  if (!idsOutput.value) return;

  try {
    await navigator.clipboard.writeText(idsOutput.value);
    const oldText = copyButton.textContent;
    copyButton.textContent = "Copied to Clipboard!";
    setTimeout(() => { copyButton.textContent = oldText; }, 1200);
  } catch {
    setStatus("Could not copy IDs to the clipboard.", true);
  }
});

applyButton.addEventListener("click", async () => {
  if (!idsOutput.value) return;

  applyButton.disabled = true;
  setStatus("Looking for the EA FC Web App...");

  try {
    const tabs = await chrome.tabs.query({
      url: ["https://ea.com/*", "https://www.ea.com/*", "https://*.ea.com/*", "https://*.easports.com/*"]
    });
    const tab = tabs.find((candidate) => candidate.id && candidate.url?.includes("ea.com/ea-sports-fc/ultimate-team/web-app"));

    if (!tab?.id) {
      throw new Error("Open the EA FC Web App and the FUT Enhancer Buy players modal first.");
    }

    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, {
        type: "applyFutEnhancerIds",
        ids: idsOutput.value
      });
    } catch {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      response = await chrome.tabs.sendMessage(tab.id, {
        type: "applyFutEnhancerIds",
        ids: idsOutput.value
      });
    }

    if (!response?.ok) throw new Error(response?.reason || "FUT Enhancer input was not found.");
    setStatus("IDs applied to FUT Enhancer. Review them before clicking Continue.");
  } catch (error) {
    setStatus(error.message || "Could not apply IDs to FUT Enhancer.", true);
  } finally {
    applyButton.disabled = false;
  }
});

syncSellButton.addEventListener("click", async () => {
  syncSellButton.disabled = true;
  setStatus("Looking for the EA FC Web App...");

  try {
    const tabs = await chrome.tabs.query({
      url: ["https://ea.com/*", "https://www.ea.com/*", "https://*.ea.com/*", "https://*.easports.com/*"]
    });
    const tab = tabs.find((candidate) => candidate.id && candidate.url?.includes("ea.com/ea-sports-fc/ultimate-team/web-app"));
    if (!tab?.id) throw new Error("Open the EA FC Web App and the FUT Enhancer price table first.");

    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { type: "syncSellPrices" });
    } catch {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      response = await chrome.tabs.sendMessage(tab.id, { type: "syncSellPrices" });
    }

    if (!response?.ok) throw new Error(response?.reason || "FUT Enhancer price fields were not found.");
    const pageText = response.pages > 1 ? ` across ${response.pages} pages` : "";
    const failedText = response.failed ? ` ${response.failed} row${response.failed === 1 ? "" : "s"} could not be verified.` : "";
    setStatus(`Sell prices updated: ${response.updated} row${response.updated === 1 ? "" : "s"}${pageText}.${failedText} Review before submitting.`);
  } catch (error) {
    setStatus(error.message || "Could not update sell prices.", true);
  } finally {
    syncSellButton.disabled = false;
  }
});

chrome.storage.local.get("lastState").then(({ lastState }) => restoreState(lastState)).catch(() => {});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "galleryExtractionComplete") return;
  teamInput.value = message.teamName || "";
  render(message.players, null, message.teamName, false);
  currentState = { ...currentState, teamName: message.teamName, teamQuery: message.teamName, players: message.players, idsText: message.idsText, source: "fut-enhancer-gallery", savedAt: Date.now() };
  setStatus(`Players found: ${message.players.length}. IDs applied to FUT Enhancer.`);
});

teamInput.addEventListener("input", () => {
  currentState = { ...currentState, teamQuery: teamInput.value };
  chrome.storage.local.set({ lastState: currentState }).catch(() => {});
});

teamInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") $("extract").click();
});
