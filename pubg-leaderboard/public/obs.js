const body = document.querySelector("#overlayBody");
const meta = document.querySelector("#overlayMeta");
const title = document.querySelector("#tournamentTitle");
const params = new URLSearchParams(location.search);
const limitValue = Number(params.get("limit") || 0);
const limit = Number.isFinite(limitValue) && limitValue > 0 ? limitValue : null;

render({ rows: [], loadedRounds: 0, roundCount: 0 });
await refresh();
setInterval(refresh, 1000);

async function refresh() {
  try {
    const response = await fetch("/api/overlay-state", { cache: "no-store" });
    const payload = await response.json();
    render(payload);
  } catch {
    meta.textContent = "WAITING";
  }
}

function render(payload) {
  const sourceRows = Array.isArray(payload.rows) ? payload.rows : [];
  const rows = limit ? sourceRows.slice(0, limit) : sourceRows;
  body.innerHTML = "";
  document.documentElement.style.setProperty("--row-count", Math.max(rows.length, 1));
  title.textContent = String(payload.tournamentTitle || "").trim();
  title.hidden = !title.textContent;

  rows.forEach((row, index) => {
    const tr = document.createElement("tr");
    if (!row) tr.className = "empty-row";
    applyRankHighlight(tr, getRankHighlight(payload, row?.rank || index + 1));
    const teamName = row ? cleanTeamDisplayName(row.teamName || row.seedLabel || "-") : "-";
    const teamLogo = row ? sanitizeLogo(row.logo) : "";
    const logoMarkup = teamLogo
      ? `<span class="overlay-logo"><img src="${escapeHtml(teamLogo)}" alt=""></span>`
      : `<span class="overlay-logo is-placeholder">${escapeHtml(String(row?.seed || index + 1))}</span>`;

    tr.innerHTML = row
      ? `
        <td><span class="overlay-rank">${row.rank || index + 1}</span></td>
        <td><div class="overlay-team">${logoMarkup}<span class="overlay-team-name">${escapeHtml(teamName)}</span></div></td>
        <td class="overlay-score">${formatScore(row.placementScore)}</td>
        <td class="overlay-score">${formatScore(row.killScore)}</td>
        <td class="overlay-score">${formatScore(row.totalScore)}</td>
      `
      : `
        <td><span class="overlay-rank">${index + 1}</span></td>
        <td><div class="overlay-team">-</div></td>
        <td>-</td>
        <td>-</td>
        <td>-</td>
      `;

    body.append(tr);
  });

  meta.textContent = payload.roundCount
    ? `${payload.loadedRounds || 0}/${payload.roundCount} ROUNDS`
    : "WAITING";
}

function formatScore(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function cleanTeamDisplayName(value) {
  return String(value || "").replace(/^\[[^\]]+\]\s*/, "").trim() || "-";
}

function sanitizeLogo(value) {
  const logo = String(value || "");
  return /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(logo) ? logo : "";
}

function getRankHighlight(payload, rank) {
  const champion = payload.championHighlight || { enabled: true, color: "#ffc857" };
  if (rank === 1 && champion.enabled !== false) {
    return { type: "champion", color: normalizeHexColor(champion.color, "#ffc857") };
  }

  const ranges = Array.isArray(payload.highlightRanges) ? payload.highlightRanges : [];
  const range = ranges.find((item) => rank >= Number(item.start) && rank <= Number(item.end));
  return range
    ? { type: "range", color: normalizeHexColor(range.color, "#35e3c1") }
    : null;
}

function applyRankHighlight(element, highlight) {
  if (!highlight) return;
  const rgb = hexToRgb(highlight.color);
  element.classList.add("is-rank-highlighted", `is-${highlight.type}-highlight`);
  element.style.setProperty("--highlight-rgb", rgb.join(", "));
  element.style.setProperty("--highlight-text", contrastText(rgb));
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
  ];
}

function contrastText([red, green, blue]) {
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
  return luminance > 150 ? "#11191f" : "#ffffff";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
