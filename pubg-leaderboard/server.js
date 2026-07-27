import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const pubgBaseUrl = "https://api.pubg.com";

loadDotEnv(path.join(__dirname, ".env"));

const port = Number(process.env.PORT || 4177);
const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const databaseUrl = process.env.DATABASE_URL || "";
const appSyncToken = process.env.APP_SYNC_TOKEN || "";
const databasePool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      max: 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000
    })
  : null;
const memorySharedStates = new Map([
  ["app", { payload: null, updatedAt: null, hydrated: false }],
  ["overlay", { payload: createEmptyOverlayState(), updatedAt: null, hydrated: false }]
]);
let databaseReady = false;
let databaseInitPromise = null;
let lastDatabaseErrorAt = 0;

databasePool?.on("error", (error) => {
  databaseReady = false;
  databaseInitPromise = null;
  console.error(`Neon background connection error: ${error.message}`);
});
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(res, url.pathname);
  } catch (error) {
    sendJson(res, error.status || 500, {
      error: error.message || "Unexpected server error",
      details: error.details || null
    });
  }
});

server.listen(port, host, () => {
  const displayHost = host === "0.0.0.0" ? "localhost" : host;
  console.log(`PUBG Leaderboard running at http://${displayHost}:${port}`);
  ensureDatabase().catch((error) => {
    console.error(`Neon initialization failed: ${error.message}`);
  });
});

async function handleApi(req, res, url) {
  if (url.pathname === "/api/status") {
    if (databasePool && !databaseReady) {
      await ensureDatabase().catch(() => false);
    }
    sendJson(res, 200, {
      hasServerKey: Boolean(process.env.PUBG_API_KEY),
      hasDatabase: Boolean(databasePool),
      databaseReady,
      syncProtected: Boolean(appSyncToken)
    });
    return;
  }

  if (url.pathname === "/api/app-state") {
    if (req.method === "GET") {
      const stored = await getSharedState("app", null);
      sendJson(res, 200, {
        state: stored.payload,
        updatedAt: stored.updatedAt,
        storage: stored.storage
      });
      return;
    }

    if (req.method === "PUT") {
      requireSyncAuthorization(req);
      const payload = await readJsonBody(req);
      const state = normalizeAppState(payload);
      const stored = await saveSharedState("app", state);
      sendJson(res, 200, {
        updatedAt: stored.updatedAt,
        storage: stored.storage
      });
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  if (url.pathname === "/api/overlay-state") {
    if (req.method === "GET") {
      const stored = await getSharedState("overlay", createEmptyOverlayState());
      sendJson(res, 200, stored.payload);
      return;
    }

    if (req.method === "PUT") {
      requireSyncAuthorization(req);
      const overlayState = normalizeOverlayState(await readJsonBody(req));
      await saveSharedState("overlay", overlayState);
      sendJson(res, 200, overlayState);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  if (url.pathname === "/api/players") {
    const platform = sanitizeShard(url.searchParams.get("platform") || "steam");
    const names = normalizeNames(url.searchParams.get("names") || "");

    if (!names.length) {
      sendJson(res, 400, { error: "플레이어 닉네임을 1개 이상 입력해주세요." });
      return;
    }

    if (names.some((name) => name.toLowerCase() === "mock")) {
      sendJson(res, 200, createMockPlayers(names));
      return;
    }

    const data = await pubgFetch(
      req,
      `/shards/${platform}/players?filter[playerNames]=${encodeURIComponent(names.join(","))}`
    );
    sendJson(res, 200, normalizePlayersResponse(data));
    return;
  }

  const matchRoute = url.pathname.match(/^\/api\/matches\/([^/]+)$/);
  if (matchRoute) {
    const matchId = decodeURIComponent(matchRoute[1]);
    const platform = sanitizeShard(url.searchParams.get("platform") || "steam");

    if (matchId.startsWith("mock-round-")) {
      sendJson(res, 200, createMockMatch(matchId, platform));
      return;
    }

    const data = await pubgFetch(req, `/shards/${platform}/matches/${encodeURIComponent(matchId)}`);
    sendJson(res, 200, normalizeMatchResponse(data, matchId, platform));
    return;
  }

  sendJson(res, 404, { error: "Unknown API route" });
}

async function pubgFetch(req, endpoint) {
  const apiKey = getApiKey(req);
  if (!apiKey) {
    const error = new Error("PUBG API 키가 없습니다. .env에 PUBG_API_KEY를 넣거나 화면에서 세션 키를 입력해주세요.");
    error.status = 401;
    throw error;
  }

  const response = await fetch(`${pubgBaseUrl}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/vnd.api+json",
      "Accept-Encoding": "gzip"
    }
  });

  const text = await response.text();
  const payload = safeJson(text);

  if (!response.ok) {
    const error = new Error(readPubgError(payload) || `PUBG API 요청 실패 (${response.status})`);
    error.status = response.status;
    error.details = payload;
    throw error;
  }

  return payload;
}

function normalizePlayersResponse(payload) {
  const players = Array.isArray(payload.data) ? payload.data : [];
  const matchMap = new Map();
  const normalizedPlayers = players.map((player) => {
    const matches = player.relationships?.matches?.data || [];
    const playerName = player.attributes?.name || player.id;

    matches.forEach((match, index) => {
      const entry = matchMap.get(match.id) || {
        id: match.id,
        type: match.type || "match",
        seenBy: [],
        order: index
      };
      entry.seenBy.push(playerName);
      entry.order = Math.min(entry.order, index);
      matchMap.set(match.id, entry);
    });

    return {
      id: player.id,
      name: playerName,
      shardId: player.attributes?.shardId || null,
      matches: matches.map((match) => ({ id: match.id, type: match.type || "match" }))
    };
  });

  const matches = Array.from(matchMap.values()).sort((a, b) => {
    if (b.seenBy.length !== a.seenBy.length) return b.seenBy.length - a.seenBy.length;
    return a.order - b.order;
  });

  return { players: normalizedPlayers, matches };
}

function normalizeMatchResponse(payload, matchId, platform) {
  const included = Array.isArray(payload.included) ? payload.included : [];
  const participantMap = new Map(
    included
      .filter((item) => item.type === "participant")
      .map((participant) => [participant.id, participant])
  );
  const rosters = included.filter((item) => item.type === "roster");
  const teams = rosters.map((roster) => {
    const participantIds = roster.relationships?.participants?.data?.map((item) => item.id) || [];
    const players = participantIds
      .map((id) => participantMap.get(id))
      .filter(Boolean)
      .map((participant) => {
        const stats = participant.attributes?.stats || {};
        return {
          id: participant.id,
          playerId: stats.playerId || null,
          name: stats.name || stats.playerName || participant.id,
          kills: toNumber(stats.kills),
          winPlace: nullableNumber(stats.winPlace),
          teamId: nullableNumber(stats.teamId)
        };
      });
    const rosterStats = roster.attributes?.stats || {};
    const rank = getTeamRank(rosterStats, players);
    const teamId = nullableNumber(rosterStats.teamId) ?? firstNumber(players.map((player) => player.teamId));
    const kills = players.reduce((sum, player) => sum + player.kills, 0);

    return {
      rosterId: roster.id,
      teamId: teamId ?? roster.id,
      teamKey: teamId ? String(teamId) : roster.id,
      seedLabel: buildSeedLabel(teamId ?? roster.id),
      rank,
      kills,
      playerNames: players.map((player) => player.name).filter(Boolean),
      players,
      representativeName: players[0]?.name || null,
      suggestedName: buildSuggestedTeamName(teamId, players)
    };
  });

  teams.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return String(a.teamId).localeCompare(String(b.teamId), "en", { numeric: true });
  });

  return {
    id: payload.data?.id || matchId,
    platform,
    createdAt: payload.data?.attributes?.createdAt || null,
    duration: payload.data?.attributes?.duration || null,
    gameMode: payload.data?.attributes?.gameMode || null,
    gameModeLabel: formatGameMode(payload.data?.attributes?.gameMode || null),
    mapName: payload.data?.attributes?.mapName || null,
    mapLabel: formatMapName(payload.data?.attributes?.mapName || null),
    matchType: payload.data?.attributes?.matchType || null,
    matchTypeLabel: formatMatchType(payload.data?.attributes?.matchType || null),
    shardId: payload.data?.attributes?.shardId || platform,
    teams
  };
}

function getTeamRank(rosterStats, players) {
  const rank = nullableNumber(rosterStats.rank) ?? nullableNumber(rosterStats.winPlace);
  if (rank) return rank;

  return firstNumber(players.map((player) => player.winPlace)) ?? 999;
}

function buildSuggestedTeamName(teamId, players) {
  const names = players.map((player) => player.name).filter(Boolean);
  if (names.length) return names[0];
  return teamId ? `Team ${teamId}` : "Unknown Team";
}

function buildSeedLabel(seed) {
  const seedText = String(seed || "").trim();
  return /^\d+$/.test(seedText) ? `[${seedText}번팀]` : `[${seedText || "팀"}]`;
}

async function serveStatic(res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(publicDir, safePath));

  if (!filePath.startsWith(publicDir)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  try {
    const file = await readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    res.end(file);
  } catch {
    const fallback = await readFile(path.join(publicDir, "index.html"));
    res.writeHead(200, { "Content-Type": mimeTypes[".html"] });
    res.end(fallback);
  }
}

async function ensureDatabase() {
  if (!databasePool) return false;
  if (databaseReady) return true;

  if (!databaseInitPromise) {
    databaseInitPromise = databasePool.query(`
      CREATE TABLE IF NOT EXISTS public.pubg_leaderboard_state (
        state_key TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).then(() => {
      databaseReady = true;
      console.log("Neon shared state storage ready");
      return true;
    }).catch((error) => {
      databaseReady = false;
      databaseInitPromise = null;
      throw error;
    });
  }

  return databaseInitPromise;
}

async function getSharedState(stateKey, fallbackPayload) {
  const memory = memorySharedStates.get(stateKey) || {
    payload: fallbackPayload,
    updatedAt: null,
    hydrated: false
  };

  if (!databasePool) {
    return { ...memory, storage: "memory" };
  }

  if (memory.hydrated) {
    return {
      ...memory,
      storage: databaseReady ? "neon-cache" : "memory-fallback"
    };
  }

  try {
    await ensureDatabase();
    const result = await databasePool.query(
      `SELECT payload, updated_at
       FROM public.pubg_leaderboard_state
       WHERE state_key = $1`,
      [stateKey]
    );

    if (!result.rows.length) {
      const empty = { ...memory, hydrated: true };
      memorySharedStates.set(stateKey, empty);
      return { ...empty, storage: "neon" };
    }

    const stored = {
      payload: result.rows[0].payload,
      updatedAt: result.rows[0].updated_at?.toISOString?.() || String(result.rows[0].updated_at || ""),
      hydrated: true
    };
    memorySharedStates.set(stateKey, stored);
    return { ...stored, storage: "neon" };
  } catch (error) {
    logDatabaseError(error);
    return { ...memory, storage: "memory-fallback" };
  }
}

async function saveSharedState(stateKey, payload) {
  const memory = {
    payload,
    updatedAt: new Date().toISOString(),
    hydrated: true
  };
  memorySharedStates.set(stateKey, memory);

  if (!databasePool) {
    return { ...memory, storage: "memory" };
  }

  try {
    await ensureDatabase();
    const result = await databasePool.query(
      `INSERT INTO public.pubg_leaderboard_state (state_key, payload, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (state_key)
       DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
       RETURNING updated_at`,
      [stateKey, JSON.stringify(payload)]
    );
    const updatedAt = result.rows[0].updated_at?.toISOString?.() || String(result.rows[0].updated_at || "");
    const stored = { payload, updatedAt, hydrated: true };
    memorySharedStates.set(stateKey, stored);
    return { ...stored, storage: "neon" };
  } catch (error) {
    logDatabaseError(error);
    const databaseError = new Error("Neon 데이터베이스에 저장하지 못했습니다.");
    databaseError.status = 503;
    throw databaseError;
  }
}

function normalizeAppState(payload) {
  const state = payload?.state;
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    const error = new Error("저장할 리더보드 상태가 올바르지 않습니다.");
    error.status = 400;
    throw error;
  }
  return state;
}

function requireSyncAuthorization(req) {
  if (!appSyncToken) return;
  const header = req.headers["x-app-sync-token"];
  const provided = Array.isArray(header) ? header[0] : String(header || "");
  if (safeTokenEquals(provided, appSyncToken)) return;

  const error = new Error("동기화 편집 키가 올바르지 않습니다.");
  error.status = 401;
  throw error;
}

function safeTokenEquals(provided, expected) {
  const left = Buffer.from(String(provided || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length === right.length && timingSafeEqual(left, right);
}

function logDatabaseError(error) {
  databaseReady = false;
  databaseInitPromise = null;
  const now = Date.now();
  if (now - lastDatabaseErrorAt < 30_000) return;
  lastDatabaseErrorAt = now;
  console.error(`Neon shared state error: ${error.message}`);
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4_000_000) {
      const error = new Error("요청 본문이 너무 큽니다.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString("utf8");
  return safeJson(text || "{}");
}

function createEmptyOverlayState() {
  return {
    updatedAt: null,
    tournamentTitle: "",
    championHighlight: {
      enabled: true,
      color: "#ffc857"
    },
    highlightRanges: [],
    loadedRounds: 0,
    roundCount: 0,
    rows: []
  };
}

function normalizeOverlayState(payload) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];

  return {
    updatedAt: new Date().toISOString(),
    tournamentTitle: String(payload?.tournamentTitle || "").trim().slice(0, 60),
    championHighlight: {
      enabled: payload?.championHighlight?.enabled !== false,
      color: sanitizeHexColor(payload?.championHighlight?.color, "#ffc857")
    },
    highlightRanges: normalizeHighlightRanges(payload?.highlightRanges),
    loadedRounds: toNumber(payload?.loadedRounds),
    roundCount: toNumber(payload?.roundCount),
    rows: rows.map((row, index) => ({
      rank: toNumber(row.rank) || index + 1,
      seed: String(row.seed || ""),
      seedLabel: String(row.seedLabel || ""),
      teamName: String(row.teamName || ""),
      logo: sanitizeDataImage(row.logo),
      placementScore: toNumber(row.placementScore),
      killScore: toNumber(row.killScore),
      totalScore: toNumber(row.totalScore)
    }))
  };
}

function normalizeHighlightRanges(value) {
  if (!Array.isArray(value)) return [];

  return value.slice(0, 12).map((range) => {
    const start = Math.max(1, Math.min(100, Math.round(toNumber(range?.start) || 1)));
    const end = Math.max(start, Math.min(100, Math.round(toNumber(range?.end) || start)));
    return {
      start,
      end,
      color: sanitizeHexColor(range?.color, "#35e3c1")
    };
  });
}

function sanitizeHexColor(value, fallback) {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : fallback;
}

function sanitizeDataImage(value) {
  const image = String(value || "");
  return /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(image) ? image : "";
}

function getApiKey(req) {
  const headerKey = req.headers["x-pubg-api-key"];
  return process.env.PUBG_API_KEY || (Array.isArray(headerKey) ? headerKey[0] : headerKey) || "";
}

function loadDotEnv(envPath) {
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function sanitizeShard(value) {
  if (!/^[a-z0-9-]+$/i.test(value)) {
    const error = new Error("잘못된 플랫폼 shard입니다.");
    error.status = 400;
    throw error;
  }
  return value;
}

function normalizeNames(value) {
  return value
    .split(/[,\n]/)
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function readPubgError(payload) {
  if (Array.isArray(payload?.errors) && payload.errors.length) {
    return payload.errors.map((error) => error.title || error.detail || error.message).filter(Boolean).join(", ");
  }
  return payload?.error || payload?.message || null;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toNumber(value) {
  return nullableNumber(value) ?? 0;
}

function firstNumber(values) {
  for (const value of values) {
    if (value !== null && value !== undefined && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
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

function createMockPlayers(names) {
  const matches = Array.from({ length: 5 }, (_, index) => ({
    id: `mock-round-${index + 1}`,
    type: "match",
    seenBy: names,
    order: index
  }));

  return {
    players: names.map((name, index) => ({
      id: `account.mock.${index + 1}`,
      name,
      shardId: "mock",
      matches: matches.map((match) => ({ id: match.id, type: "match" }))
    })),
    matches
  };
}

function createMockMatch(matchId, platform) {
  const round = Number(matchId.match(/\d+$/)?.[0] || 1);
  const teams = Array.from({ length: 16 }, (_, index) => {
    const teamId = index + 1;
    const seed = seededValue(round * 97 + teamId * 13);
    const rank = ((teamId * 5 + round * 3) % 16) + 1;
    const kills = Math.max(0, Math.round(seed * 10 + ((17 - rank) % 4)));
    const players = Array.from({ length: 4 }, (_unused, playerIndex) => ({
      id: `mock-${round}-${teamId}-${playerIndex}`,
      playerId: `account.mock.${teamId}.${playerIndex}`,
      name: `T${String(teamId).padStart(2, "0")}_P${playerIndex + 1}`,
      kills: playerIndex === 0 ? kills : 0,
      winPlace: rank,
      teamId
    }));

    return {
      rosterId: `mock-roster-${teamId}`,
      teamId,
      teamKey: String(teamId),
      seedLabel: buildSeedLabel(teamId),
      rank,
      kills,
      playerNames: players.map((player) => player.name),
      players,
      representativeName: players[0]?.name || null,
      suggestedName: players[0]?.name || `Team ${String(teamId).padStart(2, "0")}`
    };
  }).sort((a, b) => a.rank - b.rank);

  const mapName = ["Erangel_Main", "Desert_Main", "Tiger_Main", "Neon_Main", "Baltic_Main"][(round - 1) % 5];
  const gameMode = "squad-fpp";
  const matchType = "custom";

  return {
    id: matchId,
    platform,
    createdAt: new Date(Date.UTC(2026, 5, 25, 10, round * 8)).toISOString(),
    duration: 1850 + round * 12,
    gameMode,
    gameModeLabel: formatGameMode(gameMode),
    mapName,
    mapLabel: formatMapName(mapName),
    matchType,
    matchTypeLabel: formatMatchType(matchType),
    shardId: platform,
    teams
  };
}

function seededValue(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}
