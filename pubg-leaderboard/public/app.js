const defaultPlacementRules = {
  1: 10,
  2: 6,
  3: 5,
  4: 4,
  5: 3,
  6: 2,
  7: 1,
  8: 1,
  9: 0,
  10: 0,
  11: 0,
  12: 0,
  13: 0,
  14: 0,
  15: 0,
  16: 0
};

const maxRoundCount = 20;
const recentDetailLimit = 16;

const state = {
  platform: "steam",
  playerNames: "",
  recentMatches: [],
  rounds: createRounds(5),
  placementRules: { ...defaultPlacementRules },
  killPoint: 1,
  tournamentTitle: "",
  championHighlight: {
    enabled: true,
    color: "#ffc857"
  },
  highlightRanges: [],
  teamNames: {},
  teamLogos: {},
  hasServerKey: false,
  hasDatabase: false,
  databaseReady: false,
  syncProtected: false
};

const els = {
  apiStatus: document.querySelector("#apiStatus"),
  databaseStatus: document.querySelector("#databaseStatus"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  forgetApiKey: document.querySelector("#forgetApiKey"),
  platformSelect: document.querySelector("#platformSelect"),
  roundCount: document.querySelector("#roundCount"),
  playerNames: document.querySelector("#playerNames"),
  findMatches: document.querySelector("#findMatches"),
  loadMock: document.querySelector("#loadMock"),
  clearSearch: document.querySelector("#clearSearch"),
  roundMinus: document.querySelector("#roundMinus"),
  roundPlus: document.querySelector("#roundPlus"),
  recentMatches: document.querySelector("#recentMatches"),
  tournamentTitle: document.querySelector("#tournamentTitle"),
  syncToken: document.querySelector("#syncToken"),
  forgetSyncToken: document.querySelector("#forgetSyncToken"),
  championHighlightEnabled: document.querySelector("#championHighlightEnabled"),
  championHighlightColor: document.querySelector("#championHighlightColor"),
  addHighlightRange: document.querySelector("#addHighlightRange"),
  highlightRangeList: document.querySelector("#highlightRangeList"),
  placementRules: document.querySelector("#placementRules"),
  killPoint: document.querySelector("#killPoint"),
  resetRules: document.querySelector("#resetRules"),
  resetTeamNames: document.querySelector("#resetTeamNames"),
  teamNamesPaste: document.querySelector("#teamNamesPaste"),
  applyTeamNames: document.querySelector("#applyTeamNames"),
  teamPasteStatus: document.querySelector("#teamPasteStatus"),
  teamSeedList: document.querySelector("#teamSeedList"),
  roundList: document.querySelector("#roundList"),
  fetchAllRounds: document.querySelector("#fetchAllRounds"),
  leaderboardBody: document.querySelector("#leaderboardBody"),
  leaderboardMeta: document.querySelector("#leaderboardMeta"),
  exportCsv: document.querySelector("#exportCsv")
};

const autoFetchTimers = new Map();
let recentHydrateRun = 0;
let overlayPublishTimer = null;
let remoteSaveTimer = null;
let remoteSaveInFlight = false;
let remoteUpdatedAt = null;

init();

async function init() {
  loadState();
  populateRoundOptions();
  els.apiKeyInput.value = sessionStorage.getItem("pubgApiKey") || "";
  els.syncToken.value = sessionStorage.getItem("pubgSyncToken") || "";
  bindEvents();
  await refreshStatus();
  const remoteResult = await pullRemoteState({ initial: true });
  renderAll();
  if (remoteResult === "empty") scheduleRemoteSave(0);
  window.setInterval(() => pullRemoteState(), 3_000);
}

function bindEvents() {
  els.apiKeyInput.addEventListener("input", () => {
    sessionStorage.setItem("pubgApiKey", els.apiKeyInput.value.trim());
    refreshStatus();
  });

  els.forgetApiKey.addEventListener("click", () => {
    els.apiKeyInput.value = "";
    sessionStorage.removeItem("pubgApiKey");
    refreshStatus();
  });

  els.syncToken.addEventListener("input", () => {
    sessionStorage.setItem("pubgSyncToken", els.syncToken.value.trim());
    refreshStatus();
    scheduleRemoteSave();
    publishOverlayState(calculateLeaderboard());
  });

  els.forgetSyncToken.addEventListener("click", () => {
    els.syncToken.value = "";
    sessionStorage.removeItem("pubgSyncToken");
    refreshStatus();
  });

  els.platformSelect.addEventListener("change", () => {
    state.platform = els.platformSelect.value;
    saveState();
  });

  els.roundCount.addEventListener("change", () => {
    resizeRounds(clamp(Number(els.roundCount.value || 5), 1, maxRoundCount));
  });

  els.roundMinus.addEventListener("click", () => {
    resizeRounds(clamp(state.rounds.length - 1, 1, maxRoundCount));
  });

  els.roundPlus.addEventListener("click", () => {
    resizeRounds(clamp(state.rounds.length + 1, 1, maxRoundCount));
  });

  els.playerNames.addEventListener("input", () => {
    state.playerNames = els.playerNames.value;
    saveState();
  });

  els.tournamentTitle.addEventListener("input", () => {
    state.tournamentTitle = els.tournamentTitle.value.trimStart();
    saveState();
    publishOverlayState(calculateLeaderboard());
  });

  els.championHighlightEnabled.addEventListener("change", () => {
    state.championHighlight.enabled = els.championHighlightEnabled.checked;
    renderLeaderboard();
    saveState();
  });

  els.championHighlightColor.addEventListener("input", () => {
    state.championHighlight.color = normalizeHexColor(els.championHighlightColor.value, "#ffc857");
    renderLeaderboard();
    saveState();
  });

  els.addHighlightRange.addEventListener("click", () => {
    state.highlightRanges.push({
      id: crypto.randomUUID(),
      start: 2,
      end: 8,
      color: "#35e3c1"
    });
    renderHighlightSettings();
    renderLeaderboard();
    saveState();
  });

  els.findMatches.addEventListener("click", findRecentMatches);
  els.loadMock.addEventListener("click", loadMockRounds);
  els.clearSearch.addEventListener("click", () => {
    recentHydrateRun += 1;
    state.recentMatches = [];
    renderRecentMatches();
    saveState();
  });

  els.killPoint.addEventListener("input", () => {
    state.killPoint = numberOrZero(els.killPoint.value);
    renderLeaderboard();
    saveState();
  });

  els.resetRules.addEventListener("click", () => {
    state.placementRules = { ...defaultPlacementRules };
    state.killPoint = 1;
    renderRules();
    renderLeaderboard();
    saveState();
  });

  els.resetTeamNames.addEventListener("click", () => {
    state.teamNames = {};
    state.teamLogos = {};
    renderTeamSeeds();
    renderRounds();
    renderLeaderboard();
    saveState();
  });

  els.applyTeamNames.addEventListener("click", applyPastedTeamNames);
  els.fetchAllRounds.addEventListener("click", syncAllRounds);
  els.exportCsv.addEventListener("click", exportLeaderboardCsv);
}

async function refreshStatus() {
  try {
    const result = await fetchJson("/api/status");
    state.hasServerKey = Boolean(result.hasServerKey);
    state.hasDatabase = Boolean(result.hasDatabase);
    state.databaseReady = Boolean(result.databaseReady);
    state.syncProtected = Boolean(result.syncProtected);
    const hasSessionKey = Boolean(getSessionApiKey());

    els.apiStatus.className = `status-pill ${state.hasServerKey || hasSessionKey ? "ok" : "warn"}`;
    els.apiStatus.textContent = state.hasServerKey
      ? "서버 API 키 사용 중"
      : hasSessionKey
        ? "세션 API 키 사용 중"
        : "API 키 필요";

    updateDatabaseStatus();
  } catch {
    els.apiStatus.className = "status-pill warn";
    els.apiStatus.textContent = "서버 연결 필요";
    els.databaseStatus.className = "status-pill warn";
    els.databaseStatus.textContent = "공유 저장소 연결 오류";
  }
}

function updateDatabaseStatus(message = "") {
  if (message) {
    els.databaseStatus.className = "status-pill warn";
    els.databaseStatus.textContent = message;
    return;
  }

  if (!state.hasDatabase) {
    els.databaseStatus.className = "status-pill";
    els.databaseStatus.textContent = "로컬 저장 모드";
    return;
  }

  if (!state.databaseReady) {
    els.databaseStatus.className = "status-pill warn";
    els.databaseStatus.textContent = "Neon 연결 확인 필요";
    return;
  }

  const readOnly = state.syncProtected && !getSessionSyncToken();
  els.databaseStatus.className = `status-pill ${readOnly ? "warn" : "ok"}`;
  els.databaseStatus.textContent = readOnly ? "Neon 읽기 전용" : "Neon 동기화";
}

function populateRoundOptions() {
  els.roundCount.innerHTML = "";

  for (let count = 1; count <= maxRoundCount; count += 1) {
    const option = document.createElement("option");
    option.value = String(count);
    option.textContent = `${count}라운드`;
    els.roundCount.append(option);
  }
}

async function findRecentMatches() {
  const names = state.playerNames
    .split(/[,\n]/)
    .map((name) => name.trim())
    .filter(Boolean);

  if (!names.length) {
    setRecentMessage("플레이어 닉네임을 입력해주세요.");
    return;
  }

  setRecentMessage("최근 매치를 조회 중입니다.");

  try {
    const query = new URLSearchParams({
      platform: state.platform,
      names: names.join(",")
    });
    const result = await fetchJson(`/api/players?${query}`);
    state.recentMatches = (result.matches || []).map((match) => ({
      ...match,
      summaryStatus: "queued",
      summary: match.summary || null,
      detail: match.detail || null,
      summaryError: ""
    }));
    renderRecentMatches();
    saveState();
    await hydrateRecentMatchDetails(names);
  } catch (error) {
    setRecentMessage(error.message);
  }
}

async function hydrateRecentMatchDetails(searchedNames) {
  const runId = ++recentHydrateRun;
  const visibleMatches = state.recentMatches.slice(0, recentDetailLimit);

  for (const match of visibleMatches) {
    if (runId !== recentHydrateRun) return;
    if (match.detail && match.summary) continue;

    match.summaryStatus = "loading";
    renderRecentMatches();

    try {
      const query = new URLSearchParams({ platform: state.platform });
      const detail = await fetchJson(`/api/matches/${encodeURIComponent(match.id)}?${query}`);
      if (runId !== recentHydrateRun) return;
      match.detail = detail;
      match.summary = buildMatchSummary(detail, searchedNames);
      match.summaryStatus = "loaded";
      match.summaryError = "";
    } catch (error) {
      if (runId !== recentHydrateRun) return;
      match.summaryStatus = "error";
      match.summaryError = error.message;
    }

    renderRecentMatches();
    saveState();
  }
}

function renderAll() {
  els.platformSelect.value = state.platform;
  els.playerNames.value = state.playerNames;
  els.tournamentTitle.value = state.tournamentTitle;
  els.roundCount.value = state.rounds.length;
  els.killPoint.value = state.killPoint;
  renderHighlightSettings();
  renderRules();
  renderRecentMatches();
  renderRounds();
  renderTeamSeeds();
  renderLeaderboard();
}

function renderRules() {
  els.placementRules.innerHTML = "";

  for (let rank = 1; rank <= 16; rank += 1) {
    const label = document.createElement("label");
    label.className = "rule-cell";

    const span = document.createElement("span");
    span.textContent = `${rank}위`;

    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.step = "0.5";
    input.value = state.placementRules[rank] ?? 0;
    input.addEventListener("input", () => {
      state.placementRules[rank] = numberOrZero(input.value);
      renderLeaderboard();
      saveState();
    });

    label.append(span, input);
    els.placementRules.append(label);
  }

  els.killPoint.value = state.killPoint;
}

function renderHighlightSettings() {
  els.championHighlightEnabled.checked = state.championHighlight.enabled;
  els.championHighlightColor.value = normalizeHexColor(state.championHighlight.color, "#ffc857");
  els.highlightRangeList.innerHTML = "";

  if (!state.highlightRanges.length) {
    const empty = document.createElement("p");
    empty.className = "highlight-range-empty";
    empty.textContent = "추가된 구간 음영이 없습니다.";
    els.highlightRangeList.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();

  state.highlightRanges.forEach((range, index) => {
    const row = document.createElement("div");
    row.className = "highlight-range-row";

    const label = document.createElement("strong");
    label.textContent = `구간 ${index + 1}`;

    const startField = createRankRangeField("시작", range.start);
    const endField = createRankRangeField("끝", range.end);
    const colorField = document.createElement("label");
    colorField.className = "color-field";
    const colorLabel = document.createElement("span");
    colorLabel.textContent = "색상";
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = normalizeHexColor(range.color, "#35e3c1");
    colorField.append(colorLabel, colorInput);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "highlight-range-remove";
    remove.title = "구간 삭제";
    remove.setAttribute("aria-label", "구간 삭제");
    remove.textContent = "×";

    const updateRange = () => {
      range.start = clamp(Math.round(Number(startField.input.value) || 1), 1, 100);
      range.end = clamp(Math.round(Number(endField.input.value) || range.start), range.start, 100);
      range.color = normalizeHexColor(colorInput.value, "#35e3c1");
      startField.input.value = range.start;
      endField.input.value = range.end;
      renderLeaderboard();
      saveState();
    };

    startField.input.addEventListener("change", updateRange);
    endField.input.addEventListener("change", updateRange);
    colorInput.addEventListener("input", updateRange);
    remove.addEventListener("click", () => {
      state.highlightRanges = state.highlightRanges.filter((item) => item.id !== range.id);
      renderHighlightSettings();
      renderLeaderboard();
      saveState();
    });

    row.append(label, startField.label, endField.label, colorField, remove);
    fragment.append(row);
  });

  els.highlightRangeList.append(fragment);
}

function createRankRangeField(text, value) {
  const label = document.createElement("label");
  label.className = "rank-range-field";
  const span = document.createElement("span");
  span.textContent = text;
  const input = document.createElement("input");
  input.type = "number";
  input.min = "1";
  input.max = "100";
  input.step = "1";
  input.value = value;
  label.append(span, input);
  return { label, input };
}

function renderRecentMatches() {
  els.recentMatches.innerHTML = "";

  if (!state.recentMatches.length) {
    setRecentMessage("조회 결과가 여기에 표시됩니다.");
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const match of state.recentMatches.slice(0, 16)) {
    const item = document.createElement("article");
    item.className = "recent-item";

    const info = document.createElement("div");
    const id = document.createElement("strong");
    id.textContent = match.id;
    id.title = match.id;
    const meta = document.createElement("span");
    meta.textContent = `${match.seenBy?.length || 0}명과 연결됨: ${(match.seenBy || []).join(", ") || "-"}`;
    info.append(id, meta, renderRecentSummary(match));

    const actions = document.createElement("div");
    actions.className = "recent-actions";
    const nextButton = document.createElement("button");
    nextButton.type = "button";
    nextButton.textContent = "빈 라운드";
    nextButton.addEventListener("click", () => assignMatchToRound(match.id));
    actions.append(nextButton);

    state.rounds.forEach((round, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `R${index + 1}`;
      button.addEventListener("click", () => assignMatchToRound(match.id, round.id));
      actions.append(button);
    });

    item.append(info, actions);
    fragment.append(item);
  }

  els.recentMatches.append(fragment);
}

function renderRecentSummary(match) {
  const summaryWrap = document.createElement("div");
  summaryWrap.className = "recent-summary";

  if (match.summaryStatus === "loading") {
    summaryWrap.textContent = "매치 요약 조회 중";
    return summaryWrap;
  }

  if (match.summaryStatus === "error") {
    summaryWrap.textContent = match.summaryError || "매치 요약 조회 실패";
    return summaryWrap;
  }

  if (!match.summary) {
    summaryWrap.textContent = "요약 대기 중";
    return summaryWrap;
  }

  const tags = document.createElement("div");
  tags.className = "recent-tags";
  [match.summary.mapLabel, match.summary.gameModeLabel, match.summary.matchTypeLabel]
    .filter(Boolean)
    .forEach((text) => {
      const tag = document.createElement("span");
      tag.className = "recent-tag";
      tag.textContent = text;
      tags.append(tag);
    });

  const team = document.createElement("div");
  team.textContent = `${match.summary.seedLabel} ${match.summary.rank || "-"}위 · ${match.summary.kills ?? "-"}킬`;

  const teammates = document.createElement("div");
  teammates.textContent = `같이한 팀원: ${match.summary.teammates.length ? match.summary.teammates.join(", ") : "-"}`;

  summaryWrap.append(tags, team, teammates);
  return summaryWrap;
}

function setRecentMessage(message) {
  els.recentMatches.innerHTML = `<div class="round-meta">${escapeHtml(message)}</div>`;
}

function renderRounds() {
  els.roundList.innerHTML = "";
  const fragment = document.createDocumentFragment();

  state.rounds.forEach((round, index) => {
    const card = document.createElement("article");
    card.className = "round-card";

    const head = document.createElement("div");
    head.className = "round-head";
    const title = document.createElement("strong");
    title.textContent = `${index + 1}라운드`;
    const status = document.createElement("span");
    status.className = `round-state ${round.status === "loaded" ? "ok" : round.status === "error" ? "error" : ""}`;
    status.textContent = statusText(round.status);
    head.append(title, status);

    const input = document.createElement("input");
    input.type = "text";
    input.value = round.matchId || "";
    input.placeholder = "match ID";
    input.spellcheck = false;
    input.addEventListener("input", () => {
      round.matchId = input.value.trim();
      round.status = round.matchId ? "dirty" : "empty";
      round.match = null;
      round.error = "";
      renderLeaderboard();
      saveState();
      scheduleRoundFetch(round.id);
    });

    const actions = document.createElement("div");
    actions.className = "round-actions";
    const fetchButton = document.createElement("button");
    fetchButton.type = "button";
    fetchButton.textContent = "동기화";
    fetchButton.addEventListener("click", () => fetchRound(round.id));
    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.textContent = "비우기";
    clearButton.addEventListener("click", () => clearRound(round.id));
    actions.append(fetchButton, clearButton);

    const meta = document.createElement("div");
    meta.className = "round-meta";
    meta.innerHTML = renderRoundMeta(round);

    const top = document.createElement("div");
    top.className = "round-top";
    getRoundTop(round)
      .slice(0, 3)
      .forEach((team) => {
        const line = document.createElement("div");
        line.innerHTML = `<span>${escapeHtml(displayTeamName(team))}</span><strong>${team.rank}위 · ${team.kills}킬</strong>`;
        top.append(line);
      });

    card.append(head, input, actions, meta, top);
    fragment.append(card);
  });

  els.roundList.append(fragment);
}

function renderRoundMeta(round) {
  if (round.status === "error") return escapeHtml(round.error || "조회 실패");
  if (!round.match) return "매치 ID를 입력하면 팀별 등수와 킬이 표시됩니다.";

  const createdAt = round.match.createdAt ? new Date(round.match.createdAt).toLocaleString("ko-KR") : "-";
  const map = round.match.mapLabel || formatMapName(round.match.mapName);
  const mode = round.match.gameModeLabel || formatGameMode(round.match.gameMode);
  const type = round.match.matchTypeLabel || formatMatchType(round.match.matchType);
  return `${escapeHtml(map)} · ${escapeHtml(mode)} · ${escapeHtml(type)}<br>${escapeHtml(createdAt)} · ${round.match.teams.length}팀`;
}

function renderLeaderboard() {
  const rows = calculateLeaderboard();
  els.leaderboardBody.innerHTML = "";

  const fragment = document.createDocumentFragment();
  rows.forEach((row, index) => {
    const tr = document.createElement("tr");
    applyRankHighlight(tr, getRankHighlight(index + 1));

    const rankTd = document.createElement("td");
    rankTd.innerHTML = `<span class="rank-badge">${index + 1}</span>`;

    const teamTd = document.createElement("td");
    const cell = document.createElement("div");
    cell.className = "team-cell";

    const input = document.createElement("input");
    input.className = "team-name-input";
    input.value = displayTeamName(row);
    input.placeholder = representativeName(row) || "대표플레이어 닉네임";
    input.addEventListener("input", () => {
      state.teamNames[row.teamKey] = input.value.trim();
      saveState();
      renderRounds();
      renderTeamSeeds();
      publishOverlayState(calculateLeaderboard());
    });
    cell.append(createTeamLogo(row, "leaderboard-logo"), input);
    teamTd.append(cell);

    const placementTd = scoreCell(row.placementScore);
    const killTd = scoreCell(row.killScore);
    const totalTd = scoreCell(row.totalScore);

    tr.append(rankTd, teamTd, placementTd, killTd, totalTd);
    fragment.append(tr);
  });

  els.leaderboardBody.append(fragment);

  const loaded = state.rounds.filter((round) => round.status === "loaded").length;
  els.leaderboardMeta.textContent = loaded
    ? `${loaded}/${state.rounds.length}라운드 집계 완료 · ${rows.length}개 팀`
    : "라운드 정보가 들어오면 자동 집계됩니다.";

  publishOverlayState(rows);
}

function scoreCell(value) {
  const td = document.createElement("td");
  td.className = "score-number";
  td.textContent = value === undefined ? "-" : formatScore(value);
  return td;
}

function getRankHighlight(rank) {
  if (rank === 1 && state.championHighlight.enabled) {
    return {
      type: "champion",
      color: normalizeHexColor(state.championHighlight.color, "#ffc857")
    };
  }

  const range = state.highlightRanges.find((item) => rank >= item.start && rank <= item.end);
  return range
    ? { type: "range", color: normalizeHexColor(range.color, "#35e3c1") }
    : null;
}

function applyRankHighlight(element, highlight) {
  if (!highlight) return;
  element.classList.add("is-rank-highlighted", `is-${highlight.type}-highlight`);
  element.style.setProperty("--highlight-rgb", hexToRgb(highlight.color));
}

function calculateLeaderboard() {
  const teams = new Map();

  for (const round of state.rounds) {
    if (!round.match?.teams?.length) continue;

    for (const team of round.match.teams) {
      const teamKey = String(team.teamKey || team.teamId || team.rosterId);
      const placementScore = numberOrZero(state.placementRules[team.rank]);
      const killScore = numberOrZero(team.kills) * state.killPoint;
      const current = teams.get(teamKey) || {
        teamKey,
        teamId: team.teamId,
        seedLabel: team.seedLabel,
        suggestedName: team.suggestedName,
        representativeName: representativeName(team),
        playerNames: team.playerNames || [],
        placementScore: 0,
        killScore: 0,
        totalScore: 0,
        rounds: []
      };

      current.suggestedName = current.suggestedName || team.suggestedName;
      current.seedLabel = current.seedLabel || team.seedLabel;
      current.representativeName = current.representativeName || representativeName(team);
      current.playerNames = current.playerNames?.length ? current.playerNames : team.playerNames || [];
      current.placementScore += placementScore;
      current.killScore += killScore;
      current.totalScore += placementScore + killScore;
      current.rounds.push({
        matchId: round.matchId,
        rank: team.rank,
        kills: team.kills,
        placementScore,
        killScore
      });
      teams.set(teamKey, current);
    }
  }

  return Array.from(teams.values()).sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if (b.placementScore !== a.placementScore) return b.placementScore - a.placementScore;
    if (b.killScore !== a.killScore) return b.killScore - a.killScore;
    return displayTeamName(a).localeCompare(displayTeamName(b), "ko");
  });
}

async function assignMatchToRound(matchId, roundId = null) {
  const round = roundId
    ? state.rounds.find((item) => item.id === roundId)
    : state.rounds.find((item) => !item.matchId) || state.rounds[0];

  if (!round) return;
  round.matchId = matchId;
  round.status = "dirty";
  round.error = "";

  const recent = state.recentMatches.find((match) => match.id === matchId);
  if (recent?.detail) {
    round.match = recent.detail;
    round.status = "loaded";
    renderRounds();
    renderTeamSeeds();
    renderLeaderboard();
    saveState();
    return;
  }

  renderRounds();
  renderLeaderboard();
  saveState();
  await fetchRound(round.id);
}

function scheduleRoundFetch(roundId) {
  const round = state.rounds.find((item) => item.id === roundId);
  if (!round) return;

  clearTimeout(autoFetchTimers.get(roundId));
  if (!shouldAutoFetch(round.matchId)) {
    renderRounds();
    return;
  }

  const timer = setTimeout(() => fetchRound(roundId), 800);
  autoFetchTimers.set(roundId, timer);
}

function shouldAutoFetch(matchId) {
  if (!matchId) return false;
  return matchId.startsWith("mock-round-") || matchId.length >= 20;
}

async function fetchRound(roundId) {
  const round = state.rounds.find((item) => item.id === roundId);
  if (!round || !round.matchId) return;

  round.status = "loading";
  round.error = "";
  renderRounds();

  try {
    const query = new URLSearchParams({ platform: state.platform });
    const match = await fetchJson(`/api/matches/${encodeURIComponent(round.matchId)}?${query}`);
    round.match = match;
    round.status = "loaded";
  } catch (error) {
    round.status = "error";
    round.error = error.message;
  }

  renderRounds();
  renderTeamSeeds();
  renderLeaderboard();
  saveState();
}

async function syncAllRounds() {
  for (const round of state.rounds) {
    if (round.matchId) await fetchRound(round.id);
  }
}

function clearRound(roundId) {
  const round = state.rounds.find((item) => item.id === roundId);
  if (!round) return;

  round.matchId = "";
  round.match = null;
  round.status = "empty";
  round.error = "";
  renderRounds();
  renderTeamSeeds();
  renderLeaderboard();
  saveState();
}

async function loadMockRounds() {
  state.playerNames = "mock";
  els.playerNames.value = state.playerNames;
  resizeRounds(5, false);
  state.rounds.forEach((round, index) => {
    round.matchId = `mock-round-${index + 1}`;
    round.status = "dirty";
    round.error = "";
  });
  renderRounds();
  await syncAllRounds();
}

function getRoundTop(round) {
  return round.match?.teams || [];
}

function displayTeamName(team) {
  if (!team) return "-";
  const key = String(team.teamKey || team.teamId || "");
  return cleanTeamDisplayName(state.teamNames[key]) || representativeName(team) || team.suggestedName || "대표플레이어";
}

function cleanTeamDisplayName(value) {
  return String(value || "").replace(/^\[[^\]]+\]\s*/, "").trim();
}

function teamSeedLabel(teamOrKey) {
  const key = typeof teamOrKey === "object"
    ? String(teamOrKey.seedLabel || teamOrKey.teamKey || teamOrKey.teamId || "")
    : String(teamOrKey || "");

  if (key.startsWith("[") && key.endsWith("]")) return key;
  return /^\d+$/.test(key) ? `[${key}번팀]` : `[${key || "팀"}]`;
}

function representativeName(team) {
  return team?.representativeName || team?.playerNames?.[0] || team?.suggestedName || "";
}

function renderTeamSeeds() {
  els.teamSeedList.innerHTML = "";
  const fragment = document.createDocumentFragment();

  for (const key of getTeamSeedKeys()) {
    const sample = findTeamByKey(key);
    const row = document.createElement("div");
    row.className = "team-seed-row";

    const seed = document.createElement("span");
    seed.className = "seed-chip";
    seed.textContent = teamSeedLabel(sample || key);

    const logoEditor = document.createElement("div");
    logoEditor.className = "team-logo-editor";

    const uploadLabel = document.createElement("label");
    uploadLabel.className = "team-logo-upload";
    uploadLabel.title = "팀 로고 선택";
    uploadLabel.append(createTeamLogo(sample || { teamKey: key }, "team-logo-preview"));

    const logoInput = document.createElement("input");
    logoInput.type = "file";
    logoInput.accept = "image/png,image/jpeg,image/webp,image/gif";
    logoInput.addEventListener("change", async () => {
      const file = logoInput.files?.[0];
      if (!file) return;
      await updateTeamLogo(key, file);
    });
    uploadLabel.append(logoInput);
    logoEditor.append(uploadLabel);

    if (state.teamLogos[key]) {
      const removeLogo = document.createElement("button");
      removeLogo.type = "button";
      removeLogo.className = "team-logo-remove";
      removeLogo.title = "팀 로고 삭제";
      removeLogo.setAttribute("aria-label", "팀 로고 삭제");
      removeLogo.textContent = "×";
      removeLogo.addEventListener("click", () => {
        delete state.teamLogos[key];
        renderTeamSeeds();
        renderLeaderboard();
        saveState();
      });
      logoEditor.append(removeLogo);
    }

    const stack = document.createElement("div");
    stack.className = "team-input-stack";

    const input = document.createElement("input");
    input.type = "text";
    input.value = cleanTeamDisplayName(state.teamNames[key]);
    input.placeholder = representativeName(sample) || "대표플레이어 닉네임";

    const preview = document.createElement("div");
    preview.className = "team-preview";
    preview.textContent = teamPreviewName(key, sample);

    input.addEventListener("input", () => {
      state.teamNames[key] = input.value.trim();
      preview.textContent = teamPreviewName(key, sample);
      renderRounds();
      renderLeaderboard();
      saveState();
    });

    stack.append(input, preview);
    row.append(seed, logoEditor, stack);
    fragment.append(row);
  }

  els.teamSeedList.append(fragment);
}

function createTeamLogo(teamOrKey, className = "") {
  const key = typeof teamOrKey === "object"
    ? String(teamOrKey.teamKey || teamOrKey.teamId || teamOrKey.rosterId || "")
    : String(teamOrKey || "");
  const logo = document.createElement("span");
  logo.className = `team-logo ${className}`.trim();

  if (state.teamLogos[key]) {
    const image = document.createElement("img");
    image.src = state.teamLogos[key];
    image.alt = "";
    logo.append(image);
  } else {
    logo.textContent = /^\d+$/.test(key) ? key : "T";
    logo.classList.add("is-placeholder");
  }

  return logo;
}

async function updateTeamLogo(key, file) {
  try {
    if (!file.type.startsWith("image/")) throw new Error("이미지 파일만 선택할 수 있습니다.");
    if (file.size > 5_000_000) throw new Error("로고 파일은 5MB 이하만 사용할 수 있습니다.");
    state.teamLogos[key] = await resizeLogo(file);
    els.teamPasteStatus.textContent = `${teamSeedLabel(key)} 로고를 저장했습니다.`;
    renderTeamSeeds();
    renderLeaderboard();
    saveState();
  } catch (error) {
    els.teamPasteStatus.textContent = error.message;
  }
}

function resizeLogo(file) {
  return new Promise((resolve, reject) => {
    const sourceUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      const size = 96;
      const padding = 6;
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      canvas.width = size;
      canvas.height = size;

      const scale = Math.min((size - padding * 2) / image.naturalWidth, (size - padding * 2) / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      context.clearRect(0, 0, size, size);
      context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
      URL.revokeObjectURL(sourceUrl);
      resolve(canvas.toDataURL("image/webp", 0.82));
    };

    image.onerror = () => {
      URL.revokeObjectURL(sourceUrl);
      reject(new Error("로고 이미지를 읽을 수 없습니다."));
    };
    image.src = sourceUrl;
  });
}

function applyPastedTeamNames() {
  const lines = els.teamNamesPaste.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let applied = 0;
  let nextSeed = 1;

  for (const line of lines) {
    const cells = line.split("\t").map((cell) => cell.trim());
    if (looksLikeTeamHeader(cells)) continue;

    let key = String(nextSeed);
    let teamName = cells[0] || "";

    if (cells.length > 1) {
      const explicitKey = parseTeamSeed(cells[0]);
      if (explicitKey) {
        key = explicitKey;
        teamName = cells.slice(1).join(" ").trim();
      }
    }

    nextSeed += 1;
    const cleanedName = cleanTeamDisplayName(teamName);
    if (!cleanedName) continue;
    state.teamNames[key] = cleanedName;
    applied += 1;
  }

  if (!applied) {
    els.teamPasteStatus.textContent = "적용할 팀명을 찾지 못했습니다.";
    return;
  }

  els.teamPasteStatus.textContent = `${applied}개 팀명을 적용했습니다.`;
  renderTeamSeeds();
  renderRounds();
  renderLeaderboard();
  saveState();
}

function parseTeamSeed(value) {
  const match = String(value || "").match(/\d+/);
  return match ? String(Number(match[0])) : "";
}

function looksLikeTeamHeader(cells) {
  const first = String(cells[0] || "").toLowerCase();
  const second = String(cells[1] || "").toLowerCase();
  return /(팀.?번호|seed|team.?no|rank)/i.test(first) && /(팀명|team.?name|name)/i.test(second);
}

function getTeamSeedKeys() {
  const keys = new Set(Array.from({ length: 16 }, (_unused, index) => String(index + 1)));

  for (const round of state.rounds) {
    for (const team of round.match?.teams || []) {
      keys.add(String(team.teamKey || team.teamId || team.rosterId));
    }
  }

  return Array.from(keys).sort((a, b) => {
    const aNum = Number(a);
    const bNum = Number(b);
    if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
    return a.localeCompare(b, "ko", { numeric: true });
  });
}

function findTeamByKey(key) {
  for (const round of state.rounds) {
    const found = (round.match?.teams || []).find((team) => String(team.teamKey || team.teamId || team.rosterId) === String(key));
    if (found) return found;
  }
  return null;
}

function teamPreviewName(key, sample) {
  return cleanTeamDisplayName(state.teamNames[key]) || representativeName(sample) || "대표플레이어 대기";
}

function resizeRounds(count, shouldRender = true) {
  const current = state.rounds.length;
  if (count > current) {
    state.rounds.push(...createRounds(count - current, current));
  } else if (count < current) {
    state.rounds = state.rounds.slice(0, count);
  }

  els.roundCount.value = count;
  if (shouldRender) {
    renderRecentMatches();
    renderRounds();
    renderTeamSeeds();
    renderLeaderboard();
  }
  saveState();
}

function createRounds(count, offset = 0) {
  return Array.from({ length: count }, (_, index) => ({
    id: crypto.randomUUID(),
    label: `R${offset + index + 1}`,
    matchId: "",
    status: "empty",
    error: "",
    match: null
  }));
}

function buildMatchSummary(match, searchedNames = []) {
  const searched = new Set(searchedNames.map((name) => name.toLowerCase()));
  const targetTeam = (match.teams || []).find((team) =>
    (team.playerNames || []).some((name) => searched.has(String(name).toLowerCase()))
  ) || match.teams?.[0] || null;

  return {
    mapLabel: match.mapLabel || formatMapName(match.mapName),
    gameModeLabel: match.gameModeLabel || formatGameMode(match.gameMode),
    matchTypeLabel: match.matchTypeLabel || formatMatchType(match.matchType),
    seedLabel: targetTeam ? teamSeedLabel(targetTeam) : "[팀]",
    rank: targetTeam?.rank || null,
    kills: targetTeam?.kills ?? null,
    teammates: targetTeam?.playerNames || [],
    createdAt: match.createdAt || null
  };
}

function publishOverlayState(rows) {
  if (state.syncProtected && !getSessionSyncToken()) return;
  clearTimeout(overlayPublishTimer);
  overlayPublishTimer = setTimeout(() => {
    fetch("/api/overlay-state", {
      method: "PUT",
      headers: buildSyncHeaders(),
      body: JSON.stringify(buildOverlayState(rows))
    }).then((response) => {
      if (response.status === 401) updateDatabaseStatus("동기화 편집 키 필요");
    }).catch(() => {});
  }, 200);
}

function buildOverlayState(rows) {
  return {
    tournamentTitle: state.tournamentTitle.trim(),
    championHighlight: {
      enabled: state.championHighlight.enabled,
      color: normalizeHexColor(state.championHighlight.color, "#ffc857")
    },
    highlightRanges: state.highlightRanges.map((range) => ({
      start: range.start,
      end: range.end,
      color: normalizeHexColor(range.color, "#35e3c1")
    })),
    loadedRounds: state.rounds.filter((round) => round.status === "loaded").length,
    roundCount: state.rounds.length,
    rows: rows.map((row, index) => ({
      rank: index + 1,
      seed: row.teamKey,
      seedLabel: teamSeedLabel(row),
      teamName: displayTeamName(row),
      logo: state.teamLogos[row.teamKey] || "",
      placementScore: row.placementScore,
      killScore: row.killScore,
      totalScore: row.totalScore
    }))
  };
}

function formatMapName(mapName) {
  const names = {
    Baltic_Main: "Erangel",
    Chimera_Main: "Paramo",
    Desert_Main: "Miramar",
    DihorOtok_Main: "Vikendi",
    Erangel_Main: "Erangel",
    Heaven_Main: "Haven",
    Kiki_Main: "Deston",
    Neon_Main: "Deston",
    Range_Main: "Camp Jackal",
    Savage_Main: "Sanhok",
    Summerland_Main: "Karakin",
    Tiger_Main: "Taego"
  };

  return names[mapName] || mapName || "-";
}

function formatGameMode(gameMode) {
  const modes = {
    solo: "솔로 TPP",
    "solo-fpp": "솔로 FPP",
    duo: "듀오 TPP",
    "duo-fpp": "듀오 FPP",
    squad: "스쿼드 TPP",
    "squad-fpp": "스쿼드 FPP"
  };

  return modes[gameMode] || gameMode || "-";
}

function formatMatchType(matchType) {
  const value = String(matchType || "").toLowerCase();
  if (!value) return "-";
  if (value.includes("custom")) return "커스텀매치";
  if (value.includes("competitive") || value.includes("rank")) return "경쟁전";
  if (value.includes("training")) return "훈련장";
  if (value.includes("official")) return "일반";
  return matchType;
}

async function fetchJson(url) {
  const headers = {};
  const apiKey = getSessionApiKey();
  if (apiKey) headers["x-pubg-api-key"] = apiKey;

  const response = await fetch(url, { headers });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `요청 실패 (${response.status})`);
  }

  return payload;
}

function getSessionApiKey() {
  return sessionStorage.getItem("pubgApiKey") || "";
}

function getSessionSyncToken() {
  return sessionStorage.getItem("pubgSyncToken") || "";
}

function buildSyncHeaders() {
  const headers = { "Content-Type": "application/json" };
  const syncToken = getSessionSyncToken();
  if (syncToken) headers["x-app-sync-token"] = syncToken;
  return headers;
}

function exportLeaderboardCsv() {
  const rows = calculateLeaderboard();
  const csvRows = [["등수", "팀명", "순위점수", "킬점수", "종합점수"]];

  rows.forEach((row, index) => {
    csvRows.push([
      index + 1,
      displayTeamName(row),
      formatScore(row.placementScore),
      formatScore(row.killScore),
      formatScore(row.totalScore)
    ]);
  });

  const csv = csvRows.map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `pubg-leaderboard-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildPersistedState() {
  return {
    platform: state.platform,
    playerNames: state.playerNames,
    recentMatches: state.recentMatches.map((match) => ({
      id: match.id,
      type: match.type,
      seenBy: match.seenBy || [],
      order: match.order,
      summaryStatus: match.summaryStatus === "loaded" ? "loaded" : match.summaryStatus || "queued",
      summary: match.summary || null,
      detail: match.detail || null,
      summaryError: ""
    })),
    rounds: state.rounds.map((round) => ({
      id: round.id,
      label: round.label,
      matchId: round.matchId,
      status: round.status === "loaded" ? "loaded" : round.matchId ? "dirty" : "empty",
      error: "",
      match: round.match
    })),
    placementRules: state.placementRules,
    killPoint: state.killPoint,
    tournamentTitle: state.tournamentTitle,
    championHighlight: state.championHighlight,
    highlightRanges: state.highlightRanges,
    teamNames: state.teamNames,
    teamLogos: state.teamLogos
  };
}

function writeLocalState(persisted) {
  try {
    localStorage.setItem("pubgLeaderboardState", JSON.stringify(persisted));
  } catch {
    updateDatabaseStatus("브라우저 캐시 저장 한도 초과");
  }
}

function scheduleRemoteSave(delay = 500) {
  clearTimeout(remoteSaveTimer);

  if (state.syncProtected && !getSessionSyncToken()) {
    updateDatabaseStatus("동기화 편집 키 필요");
    return;
  }

  remoteSaveTimer = setTimeout(pushRemoteState, delay);
}

async function pushRemoteState() {
  remoteSaveTimer = null;
  if (remoteSaveInFlight) {
    scheduleRemoteSave();
    return;
  }

  remoteSaveInFlight = true;

  try {
    const response = await fetch("/api/app-state", {
      method: "PUT",
      headers: buildSyncHeaders(),
      body: JSON.stringify({ state: buildPersistedState() })
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || `공유 저장 실패 (${response.status})`);
    }

    remoteUpdatedAt = payload.updatedAt || remoteUpdatedAt;
    if (payload.storage === "neon") {
      state.hasDatabase = true;
      state.databaseReady = true;
    }
    updateDatabaseStatus();
  } catch (error) {
    updateDatabaseStatus(error.message);
  } finally {
    remoteSaveInFlight = false;
  }
}

async function pullRemoteState({ initial = false } = {}) {
  if (!initial && (remoteSaveTimer || remoteSaveInFlight)) return "busy";

  try {
    const response = await fetch("/api/app-state", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `공유 상태 조회 실패 (${response.status})`);

    if (!payload.state) return "empty";
    if (!initial && payload.updatedAt && payload.updatedAt === remoteUpdatedAt) return "unchanged";

    applyPersistedState(payload.state);
    writeLocalState(buildPersistedState());
    remoteUpdatedAt = payload.updatedAt || remoteUpdatedAt;

    if (!initial) renderAll();
    if (payload.storage === "neon" || payload.storage === "neon-cache") {
      state.hasDatabase = true;
      state.databaseReady = true;
      updateDatabaseStatus();
    }
    return "loaded";
  } catch (error) {
    updateDatabaseStatus(error.message);
    return "error";
  }
}

function saveState() {
  const persisted = buildPersistedState();
  writeLocalState(persisted);
  scheduleRemoteSave();
}

function loadState() {
  const raw = localStorage.getItem("pubgLeaderboardState");
  if (!raw) return;

  try {
    const persisted = JSON.parse(raw);
    applyPersistedState(persisted);
  } catch {
    localStorage.removeItem("pubgLeaderboardState");
  }
}

function applyPersistedState(persisted) {
  state.platform = persisted.platform || state.platform;
  state.playerNames = persisted.playerNames || "";
  state.recentMatches = Array.isArray(persisted.recentMatches) ? persisted.recentMatches : [];
  state.rounds = Array.isArray(persisted.rounds) && persisted.rounds.length
    ? persisted.rounds.map((round) => ({
        id: round.id || crypto.randomUUID(),
        label: round.label || "",
        matchId: round.matchId || "",
        status: round.status || (round.matchId ? "dirty" : "empty"),
        error: "",
        match: round.match || null
      }))
    : state.rounds;
  state.placementRules = { ...defaultPlacementRules, ...(persisted.placementRules || {}) };
  state.killPoint = Number.isFinite(Number(persisted.killPoint)) ? Number(persisted.killPoint) : 1;
  state.tournamentTitle = String(persisted.tournamentTitle || "");
  state.championHighlight = sanitizeChampionHighlight(persisted.championHighlight);
  state.highlightRanges = sanitizeHighlightRanges(persisted.highlightRanges);
  state.teamNames = sanitizeStoredTeamNames(persisted.teamNames || {});
  state.teamLogos = sanitizeStoredTeamLogos(persisted.teamLogos || {});
}

function sanitizeChampionHighlight(value) {
  return {
    enabled: value?.enabled !== false,
    color: normalizeHexColor(value?.color, "#ffc857")
  };
}

function sanitizeHighlightRanges(value) {
  if (!Array.isArray(value)) return [];

  return value.slice(0, 12).map((range) => {
    const start = clamp(Math.round(Number(range?.start) || 1), 1, 100);
    const end = clamp(Math.round(Number(range?.end) || start), start, 100);
    return {
      id: String(range?.id || crypto.randomUUID()),
      start,
      end,
      color: normalizeHexColor(range?.color, "#35e3c1")
    };
  });
}

function sanitizeStoredTeamLogos(teamLogos) {
  return Object.fromEntries(
    Object.entries(teamLogos)
      .map(([key, value]) => [String(key), String(value || "")])
      .filter(([_key, value]) => /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(value))
  );
}

function sanitizeStoredTeamNames(teamNames) {
  return Object.fromEntries(
    Object.entries(teamNames)
      .map(([key, value]) => [String(key), String(value || "").trim()])
      .filter(([_key, value]) => value && !looksLikeLegacyAutoName(value))
  );
}

function looksLikeLegacyAutoName(value) {
  if (value.includes(",") && value.split(",").filter(Boolean).length >= 3) return true;
  return /^team\s+\d+$/i.test(value);
}

function statusText(status) {
  const map = {
    empty: "대기",
    dirty: "동기화 필요",
    loading: "조회 중",
    loaded: "완료",
    error: "오류"
  };
  return map[status] || "대기";
}

function normalizeHexColor(value, fallback) {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : fallback;
}

function hexToRgb(value) {
  const color = normalizeHexColor(value, "#35e3c1");
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16)
  ].join(", ");
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatScore(value) {
  const number = numberOrZero(value);
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
