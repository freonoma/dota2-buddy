# dota2-buddy

A local draft assistant for Dota 2 Ranked All Pick. Node backend + React frontend in your browser — no game injection, no overlays. Alt-tab to it between draft rounds, or put it on a second monitor.

## Features

- **Draft board** — click heroes to mark picks (left-click ally, right-click enemy, ctrl-click ban). Radiant/Dire side toggle. Round auto-advances from pick counts.
- **Recommendations** — filtered by your selected role (pos 1–5), scored on:
  - **counter** — winrate vs enemy heroes revealed so far
  - **synergy** — fills gaps in your team composition (e.g. needs initiator, needs disabler)
  - **meta** — current bracket winrate
  - **comfort** — your personal experience on the hero
- **"Why?" button** — click on any recommendation to get a short Claude-generated explanation of why that hero fits (or doesn't) in this specific draft situation.
- **Pre-queue ban suggestions** — analyzes your hero pool's worst matchups and recommends 4 heroes to put in your ban slots before queueing.
- **Player profile** — hero comfort ratings (1–5 stars, manually or via screenshot import). Claude vision reads your in-game Hero Stats page and extracts heroes + stats. You review and confirm before anything is saved.
- **Hero grid** — all heroes searchable and filterable by attribute (STR/AGI/INT/UNI). Greyed-out heroes are already picked or banned.

## Setup

```bash
npm install

# copy the template and fill in your info
cp backend/.env.example backend/.env
# edit backend/.env — set PLAYER_NAME, PLAYER_RANK, optionally STRATZ_API_KEY

# fetch hero stats and matchups (~80s with Stratz, ~3min with OpenDota)
npm run fetch-data

# start backend (3001) + frontend (5173)
npm run dev
```

Open <http://localhost:5173>.

## Data sources

`npm run fetch-data` pulls from one of two APIs depending on your config:

| | Stratz (optional) | OpenDota (default) |
|---|---|---|
| Matchup data | Bracket-filtered (Legend+Ancient) | Global (all brackets) |
| Auth | `STRATZ_API_KEY` in `.env` ([get one free](https://stratz.com/api)) | None needed |
| Speed | ~80 seconds (150 req/min limit) | ~3 minutes (60 req/min limit) |
| Quality | More accurate for your rank | Good enough — counter relationships are similar across brackets |

If `STRATZ_API_KEY` is set, Stratz is used. Otherwise OpenDota. Both write the same JSON format; the rest of the app doesn't know or care which source was used.

Static hero data (names, attributes, abilities) comes from the [`dotaconstants`](https://github.com/odota/dotaconstants) npm package — no network calls, ships with the install.

## Screenshot import

The profile modal lets you import hero stats from in-game screenshots. Two auth options:

| | Anthropic API | Claude Code CLI |
|---|---|---|
| Cost | ~$0.005 per import | Free under Pro/Max subscription |
| Speed | ~2 seconds | ~10 seconds |
| Setup | `ANTHROPIC_API_KEY` in `.env` | Claude Code installed locally |

If neither is set, the import feature is unavailable but everything else works — just rate heroes manually.

## Project layout

```
backend/
  src/
    server.ts                  Express + WebSocket entry point
    types.ts                   Shared TypeScript interfaces
    lib/
      claude.ts                Shared Claude API/CLI dual-auth helper
    data/
      loader.ts                Loads heroes from dotaconstants + cached JSON
      hero_positions.ts        Curated position map (pos 1-5) for all heroes
    engine/
      recommendation.ts        Scoring: counter, synergy, meta, comfort
      reasoning.ts             Per-hero "Why?" explanation via Claude
      bans.ts                  Pre-queue ban suggestions from your hero pool
    profile/
      manager.ts               Player profile read/write, env defaults
      screenshot.ts            Screenshot → hero stats extraction
    scripts/
      fetch-data.ts            Pulls data from Stratz or OpenDota
  data/                        Generated JSON cache (gitignored)

frontend/
  src/
    App.tsx                    Layout shell
    hooks/useDraftStore.ts     WebSocket-backed state + auto-round-advance
    components/
      DraftBoard.tsx           Ally/enemy slots, Radiant/Dire toggle, round indicator
      HeroGrid.tsx             Searchable, attribute-filtered hero pool
      Recommendations.tsx      Top-N picks with score breakdown + Why? button
      ProfileModal.tsx         Profile editor + screenshot import with review step
      BanSuggestionsModal.tsx  Pre-queue ban suggestions
      HeroPortrait.tsx         Hero icon (Steam CDN)
```

## Configuration

All config lives in `backend/.env` (gitignored). See `backend/.env.example` for the template.

| Variable | Required | Description |
|---|---|---|
| `PLAYER_NAME` | Yes | Your display name |
| `PLAYER_RANK` | Yes | `herald` through `immortal` |
| `PLAYER_MMR` | No | Your MMR number |
| `PLAYER_FRIEND_ID` | No | Dota 2 friend ID |
| `PLAYER_PREFERRED_ROLES` | No | Comma-separated, e.g. `2,3` |
| `STRATZ_API_KEY` | No | Enables bracket-filtered matchup data |
| `ANTHROPIC_API_KEY` | No | Enables fast screenshot extraction |
| `CLAUDE_CLI_PATH` | No | Override for Claude Code binary path |
| `PORT` | No | Backend port (default 3001) |

## Tech

| | |
|---|---|
| Backend | Node 22, Express, ws, TypeScript (ESM) |
| Frontend | React 18, Vite 6, Tailwind 3, TypeScript |
| AI | Anthropic Claude (SDK or local CLI) |
| Data | dotaconstants, Stratz GraphQL, OpenDota REST |

## Future

- **GSI integration** — Dota 2 Game State Integration to auto-detect draft phase, reset the board, and pick up your locked hero. The `/gsi` POST handler exists but the parser is a stub.
- **Score overlay on hero grid** — show recommendation scores directly on hero portraits so you can scan all 127 at a glance instead of just the top 8.
- **Draft history** — save past drafts and outcomes to track what works.
- **Sound alerts** — notification when draft phase changes (for alt-tabbers).
- **Electron wrapper** — standalone `.exe` with tray icon and global hotkeys.
