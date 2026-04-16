import "dotenv/config";
import express from "express";
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
import type {
  ClientToServerMessage,
  DraftState,
  PlayerProfile,
  ScreenshotImportResult,
  ServerToClientMessage,
} from "./types.js";

const PORT = Number(process.env.PORT ?? 3001);

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

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
  const profile = req.body as PlayerProfile;
  res.json(saveProfile(profile));
});

app.post("/api/recommend", (req, res) => {
  const draft = req.body as DraftState;
  const recs = recommend({
    heroes: getHeroes(),
    matchups: getMatchups(),
    meta: getHeroMeta(),
    profile: getProfile(),
    draft,
  });
  res.json(recs);
});

app.post("/api/reload", (_req, res) => {
  reloadDynamicData();
  res.json({ ok: true, ...getDataStatus() });
});

app.get("/api/bans", (_req, res) => {
  const suggestions = suggestBans({
    heroes: getHeroes(),
    matchups: getMatchups(),
    profile: getProfile(),
  });
  res.json({ suggestions });
});

// Step 1 of the import flow: extract heroes from a screenshot. Does NOT
// write anything — the user reviews/edits the result in the UI before
// committing via /api/profile/apply-import.
app.post("/api/profile/extract-screenshot", async (req, res) => {
  const { image, mediaType } = req.body as {
    image?: string;
    mediaType?: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  };
  if (!image || !mediaType) {
    res.status(400).json({ error: "image and mediaType are required" });
    return;
  }
  try {
    const result = await extractFromScreenshot(image, mediaType);
    res.json({ result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[screenshot] extract failed:", msg);
    res.status(500).json({ error: msg });
  }
});

// Returns a 2-3 sentence explanation of why a hero is good (or bad) in
// the current draft. Cached by (hero, allies, enemies, role).
app.post("/api/explain", async (req, res) => {
  const { heroId, allyHeroIds, enemyHeroIds, yourRole } = req.body as {
    heroId?: number;
    allyHeroIds?: number[];
    enemyHeroIds?: number[];
    yourRole?: number;
  };
  if (
    typeof heroId !== "number" ||
    !Array.isArray(allyHeroIds) ||
    !Array.isArray(enemyHeroIds) ||
    typeof yourRole !== "number"
  ) {
    res.status(400).json({
      error: "heroId, allyHeroIds, enemyHeroIds, yourRole are required",
    });
    return;
  }
  try {
    const profile = getProfile();
    const explanation = await explainPick({
      heroId,
      allyHeroIds,
      enemyHeroIds,
      yourRole,
      rankBracket: profile.rankBracket,
    });
    res.json({ explanation });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[explain] failed:", msg);
    res.status(500).json({ error: msg });
  }
});

// Step 2: commit a (possibly edited) list of matched rows to the profile.
app.post("/api/profile/apply-import", (req, res) => {
  const { matched } = req.body as { matched?: ScreenshotImportResult["matched"] };
  if (!Array.isArray(matched)) {
    res.status(400).json({ error: "matched array is required" });
    return;
  }
  const profile = mergeImport({ matched, unmatched: [] });
  broadcast({ type: "profile", payload: profile });
  res.json({ profile });
});

// Endpoint Dota 2's Game State Integration POSTs to. Currently a passthrough
// — the frontend ignores it until a draft-state parser is built.
app.post("/gsi", (req, res) => {
  broadcast({ type: "draft-state", payload: { gsi: req.body } });
  res.sendStatus(200);
});

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

const clients = new Set<WebSocket>();

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

  send(ws, { type: "heroes", payload: getHeroes() });
  send(ws, { type: "profile", payload: getProfile() });
  send(ws, { type: "data-status", payload: getDataStatus() });

  ws.on("message", (raw) => {
    let msg: ClientToServerMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientToServerMessage;
    } catch {
      return;
    }

    switch (msg.type) {
      case "request-recommendations": {
        const draft = msg.payload as DraftState;
        const recs = recommend({
          heroes: getHeroes(),
          matchups: getMatchups(),
          meta: getHeroMeta(),
          profile: getProfile(),
          draft,
        });
        send(ws, { type: "recommendations", payload: recs });
        break;
      }
      case "save-profile": {
        const updated = saveProfile(msg.payload as PlayerProfile);
        send(ws, { type: "profile", payload: updated });
        break;
      }
      default:
        break;
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
  });
});

httpServer.listen(PORT, () => {
  const status = getDataStatus();
  const mode = detectMode();
  console.log(`\n  dota2-buddy backend  →  http://localhost:${PORT}`);
  console.log(`  WebSocket             →  ws://localhost:${PORT}/ws`);
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
    const bin = detectCliBinary(true);
    console.log(
      `  claude binary         →  ${bin && bin !== "claude" ? bin : "⚠ NOT FOUND — will try `claude` from PATH"}`
    );
  }
  if (status.matchupHeroCount === 0) {
    console.log(
      `\n  ⚠  no matchup data — run \`npm run fetch-data\` to populate it.\n`
    );
  } else {
    console.log("");
  }
});
