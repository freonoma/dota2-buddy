import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "node:http";
import {
  getHeroes,
  getMatchups,
  getHeroMeta,
  getDataStatus,
  reloadDynamicData,
} from "./data/loader.js";
import { recommend } from "./engine/recommendation.js";
import { explainPick } from "./engine/reasoning.js";
import { suggestBans } from "./engine/bans.js";
import { getProfile, saveProfile, mergeImport } from "./profile/manager.js";
import { extractFromScreenshot } from "./profile/screenshot.js";
import { detectMode, detectCliBinary } from "./lib/claude.js";
import {
  parseDraftState,
  parseExplainRequest,
  parseImportRows,
  parsePlayerProfile,
  parseScreenshotRequest,
} from "./lib/validate.js";
import type {
  ClientToServerMessage,
  DraftState,
  ServerToClientMessage,
} from "./types.js";

const PORT = Number(process.env.PORT ?? 3001);

// Writes to disk and can spawn the Claude CLI, so it stays on loopback.
const HOST = process.env.HOST ?? "127.0.0.1";

const BODY_LIMIT_MB = 25;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const HEARTBEAT_MS = 30_000;

const app = express();

// Only a browser tab served from localhost has any business calling this.
app.use(
  cors({
    origin: [/^https?:\/\/localhost(:\d+)?$/, /^https?:\/\/127\.0\.0\.1(:\d+)?$/],
  })
);
app.use(express.json({ limit: `${BODY_LIMIT_MB}mb` }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    extractionMode: detectMode(),
    cliBinary: detectCliBinary(),
    ...getDataStatus(),
  });
});

app.get("/api/heroes", (_req, res) => {
  res.json(getHeroes());
});

app.get("/api/profile", (_req, res) => {
  res.json(getProfile());
});

app.post("/api/profile", (req, res) => {
  const parsed = parsePlayerProfile(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const profile = saveProfile(parsed.value);
  broadcast({ type: "profile", payload: profile });
  res.json(profile);
});

app.post("/api/recommend", (req, res) => {
  const parsed = parseDraftState(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  res.json(buildRecommendations(parsed.value));
});

app.post("/api/reload", (_req, res) => {
  reloadDynamicData();
  const status = getDataStatus();
  broadcast({ type: "data-status", payload: status });
  res.json({ ok: true, ...status });
});

app.get("/api/bans", (_req, res) => {
  const suggestions = suggestBans({
    heroes: getHeroes(),
    matchups: getMatchups(),
    meta: getHeroMeta(),
    profile: getProfile(),
  });
  res.json({ suggestions });
});

// Step 1 of the import flow: extract heroes from a screenshot. Does NOT
// write anything — the user reviews/edits the result in the UI before
// committing via /api/profile/apply-import.
app.post("/api/profile/extract-screenshot", async (req, res) => {
  const parsed = parseScreenshotRequest(req.body, MAX_IMAGE_BYTES);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  try {
    const result = await extractFromScreenshot(
      parsed.value.image,
      parsed.value.mediaType
    );
    res.json({ result });
  } catch (e) {
    fail(res, "screenshot", "Could not read that screenshot.", e);
  }
});

// Step 2: commit a (possibly edited) list of matched rows to the profile.
app.post("/api/profile/apply-import", (req, res) => {
  const parsed = parseImportRows((req.body as { matched?: unknown })?.matched);
  if (!parsed.ok) {
    res.status(400).json({ error: `matched: ${parsed.error}` });
    return;
  }
  const profile = mergeImport({ matched: parsed.value, unmatched: [] });
  broadcast({ type: "profile", payload: profile });
  res.json({ profile });
});

// Returns a 2-3 sentence explanation of why a hero is good (or bad) in
// the current draft. Cached by (hero, allies, enemies, role).
app.post("/api/explain", async (req, res) => {
  const parsed = parseExplainRequest(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  try {
    const explanation = await explainPick({
      ...parsed.value,
      rankBracket: getProfile().rankBracket,
    });
    res.json({ explanation });
  } catch (e) {
    fail(res, "explain", "Could not generate an explanation.", e);
  }
});

// Stub for Dota 2 Game State Integration: the payload is rebroadcast, nothing
// parses it yet. GSI_AUTH_TOKEN, when set, must match the token in your .cfg.
app.post("/gsi", (req, res) => {
  const expected = process.env.GSI_AUTH_TOKEN;
  if (expected) {
    const body = req.body as { auth?: { token?: string } } | undefined;
    if (body?.auth?.token !== expected) {
      res.sendStatus(403);
      return;
    }
  }
  broadcast({ type: "draft-state", payload: { gsi: req.body } });
  res.sendStatus(200);
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status =
    err instanceof Error && "status" in err && typeof err.status === "number"
      ? err.status
      : 500;
  if (status === 413) {
    res.status(413).json({ error: `Request body must be under ${BODY_LIMIT_MB}MB.` });
    return;
  }
  if (status === 400) {
    res.status(400).json({ error: "Malformed request body." });
    return;
  }
  console.error("[server] unhandled error:", err);
  res.status(500).json({ error: "Internal server error." });
});

function buildRecommendations(draft: DraftState) {
  return recommend({
    heroes: getHeroes(),
    matchups: getMatchups(),
    meta: getHeroMeta(),
    profile: getProfile(),
    draft,
  });
}

// Detail to the console; the client never sees paths or upstream errors.
function fail(res: Response, scope: string, message: string, e: unknown) {
  console.error(`[${scope}]`, e instanceof Error ? e.message : e);
  res.status(500).json({ error: message });
}

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

const clients = new Set<WebSocket>();
const alive = new WeakSet<WebSocket>();

function broadcast(msg: ServerToClientMessage) {
  const json = JSON.stringify(msg);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  }
}

function send(ws: WebSocket, msg: ServerToClientMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

wss.on("connection", (ws) => {
  clients.add(ws);
  alive.add(ws);

  send(ws, { type: "heroes", payload: getHeroes() });
  send(ws, { type: "profile", payload: getProfile() });
  send(ws, { type: "data-status", payload: getDataStatus() });

  ws.on("pong", () => alive.add(ws));

  ws.on("message", (raw) => {
    let msg: ClientToServerMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientToServerMessage;
    } catch {
      send(ws, {
        type: "error",
        payload: { request: null, message: "Malformed message." },
      });
      return;
    }

    // An uncaught throw inside a ws listener takes the whole process down.
    try {
      handleMessage(ws, msg);
    } catch (e) {
      console.error("[ws] handler failed:", e);
      send(ws, {
        type: "error",
        payload: { request: msg.type, message: "Request failed." },
      });
    }
  });

  ws.on("error", (e) => {
    console.error("[ws] socket error:", e.message);
    clients.delete(ws);
  });

  ws.on("close", () => {
    clients.delete(ws);
  });
});

function handleMessage(ws: WebSocket, msg: ClientToServerMessage) {
  switch (msg.type) {
    case "request-recommendations": {
      const parsed = parseDraftState(msg.payload);
      if (!parsed.ok) {
        send(ws, {
          type: "error",
          payload: { request: msg.type, message: parsed.error },
        });
        return;
      }
      send(ws, {
        type: "recommendations",
        payload: buildRecommendations(parsed.value),
      });
      return;
    }
    case "save-profile": {
      const parsed = parsePlayerProfile(msg.payload);
      if (!parsed.ok) {
        send(ws, {
          type: "error",
          payload: { request: msg.type, message: parsed.error },
        });
        return;
      }
      broadcast({ type: "profile", payload: saveProfile(parsed.value) });
      return;
    }
    default:
      return;
  }
}

// Sockets dropped without a close frame would sit in `clients` forever.
const heartbeat = setInterval(() => {
  for (const ws of clients) {
    if (!alive.has(ws)) {
      ws.terminate();
      clients.delete(ws);
      continue;
    }
    alive.delete(ws);
    ws.ping();
  }
}, HEARTBEAT_MS);
heartbeat.unref();

// The WebSocket server shares the HTTP server's socket, so it re-emits the
// same listen failures. Those are reported once, below.
const LISTEN_ERRORS = new Set(["EADDRINUSE", "EACCES", "EADDRNOTAVAIL"]);

wss.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code && LISTEN_ERRORS.has(e.code)) return;
  console.error("[ws] server error:", e.message);
});

httpServer.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EADDRINUSE") {
    console.error(
      `\n  Port ${PORT} is already in use — is dota2-buddy already running?`
    );
    console.error(`  Set PORT in backend/.env to use a different one.\n`);
  } else {
    console.error(`[server] ${e.message}`);
  }
  process.exit(1);
});

httpServer.listen(PORT, HOST, () => {
  const status = getDataStatus();
  const mode = detectMode();
  console.log(`\n  dota2-buddy backend  →  http://${HOST}:${PORT}`);
  console.log(`  WebSocket             →  ws://${HOST}:${PORT}/ws`);
  console.log(
    `  heroes loaded         →  ${status.heroCount} (matchups: ${status.matchupHeroCount}, meta: ${status.metaHeroCount})`
  );
  if (mode === "api") {
    console.log(
      `  screenshot extractor  →  Anthropic API (ANTHROPIC_API_KEY detected)`
    );
  } else {
    console.log(
      `  screenshot extractor  →  Claude Code CLI (Pro/Max subscription)`
    );
    const bin = detectCliBinary();
    if (bin && bin !== "claude") {
      console.log(`  claude binary         →  ${bin}`);
    } else {
      console.log(`  claude binary         →  not found, will try \`claude\` from PATH`);
      // Only worth the wall of path probing when it actually failed.
      detectCliBinary(true);
    }
  }
  if (status.matchupHeroCount === 0) {
    console.log(
      `\n  ⚠  no matchup data — run \`npm run fetch-data\` to populate it.\n`
    );
  } else {
    console.log("");
  }
});
