const body = document.querySelector("#overlayBody");
const meta = document.querySelector("#overlayMeta");
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
    meta.textContent = "연결 대기";
  }
}

function render(payload) {
  const sourceRows = Array.isArray(payload.rows) ? payload.rows : [];
  const rows = limit ? sourceRows.slice(0, limit) : sourceRows;
  body.innerHTML = "";

  rows.forEach((row, index) => {
    const tr = document.createElement("tr");
    if (!row) tr.className = "empty-row";
    const teamName = row ? cleanTeamDisplayName(row.teamName || row.seedLabel || "-") : "-";

    tr.innerHTML = row
      ? `
        <td><span class="overlay-rank">${index + 1}</span></td>
        <td><div class="overlay-team">${escapeHtml(teamName)}</div></td>
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
    ? `${payload.loadedRounds || 0}/${payload.roundCount} 라운드`
    : "메인 화면 대기";
}

function formatScore(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function cleanTeamDisplayName(value) {
  return String(value || "").replace(/^\[[^\]]+\]\s*/, "").trim() || "-";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
