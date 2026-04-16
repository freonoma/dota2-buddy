import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "node:child_process";
import {
  writeFileSync,
  unlinkSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const MODEL = "claude-sonnet-4-5";

export type ClaudeMode = "api" | "cli";

export interface ClaudeOptions {
  prompt: string;
  image?: {
    base64: string;
    mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  };
  maxTokens?: number;
}

export function detectMode(): ClaudeMode {
  return process.env.ANTHROPIC_API_KEY ? "api" : "cli";
}

export function detectCliBinary(verbose = false): string | null {
  if (detectMode() === "api") return null;
  return resolveClaudeBinary(verbose);
}

// Single entry point used by both screenshot extraction and per-hero
// reasoning. Picks API or CLI path based on env, returns the assistant
// response as plain text.
export async function runClaude(opts: ClaudeOptions): Promise<string> {
  const mode = detectMode();
  if (mode === "api") return runViaApi(opts);
  return runViaCli(opts);
}

async function runViaApi(opts: ClaudeOptions): Promise<string> {
  const client = new Anthropic();
  const userContent: Anthropic.MessageParam["content"] = [];
  if (opts.image) {
    userContent.push({
      type: "image",
      source: {
        type: "base64",
        media_type: opts.image.mediaType,
        data: opts.image.base64,
      },
    });
  }
  userContent.push({ type: "text", text: opts.prompt });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 4096,
    messages: [{ role: "user", content: userContent }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text content");
  }
  return textBlock.text;
}

async function runViaCli(opts: ClaudeOptions): Promise<string> {
  // For text-only calls, pass the prompt straight through. For calls
  // with an image, write both prompt and image to temp files and have
  // Claude read them with its Read tool — keeps the CLI argument short.
  if (!opts.image) {
    return runClaudeCliRaw(opts.prompt);
  }

  const ext =
    opts.image.mediaType === "image/png"
      ? ".png"
      : opts.image.mediaType === "image/jpeg"
        ? ".jpg"
        : opts.image.mediaType === "image/webp"
          ? ".webp"
          : ".bin";

  const imagePath = tempPath(ext);
  const promptPath = tempPath(".txt");
  writeFileSync(imagePath, Buffer.from(opts.image.base64, "base64"));
  writeFileSync(promptPath, opts.prompt);

  const cliPrompt =
    `Read the file at ${promptPath} which contains a prompt. ` +
    `Then read the image at ${imagePath} and apply that prompt to it. ` +
    `Follow the prompt's output instructions exactly.`;

  try {
    return await runClaudeCliRaw(cliPrompt);
  } finally {
    safeUnlink(imagePath);
    safeUnlink(promptPath);
  }
}

function runClaudeCliRaw(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const binary = resolveClaudeBinary();
    const isWin = process.platform === "win32";
    const usingFullPath = binary !== "claude";

    console.log(
      `[claude] invoking CLI: ${usingFullPath ? binary : "claude (PATH lookup)"}`
    );

    let child;
    if (usingFullPath) {
      child = spawn(binary, ["-p", prompt, "--allowed-tools", "Read"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
    } else if (isWin) {
      const escaped = `"${prompt.replace(/"/g, '\\"')}"`;
      child = spawn(`claude -p ${escaped} --allowed-tools Read`, {
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } else {
      child = spawn("claude", ["-p", prompt, "--allowed-tools", "Read"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
    }

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("error", (e) => {
      reject(
        new Error(
          `Failed to spawn 'claude' CLI. Is Claude Code installed and on PATH? (${e.message})`
        )
      );
    });

    child.on("close", (code) => {
      if (code !== 0) {
        const bin = usingFullPath ? binary : "claude (from PATH)";
        reject(
          new Error(
            `claude CLI exited with code ${code}. binary=${bin}\nstderr:\n${stderr.slice(0, 500)}\nstdout:\n${stdout.slice(0, 500)}`
          )
        );
        return;
      }
      resolve(stdout);
    });
  });
}

// Find the first balanced { ... } block in a string, skipping braces
// that appear inside double-quoted string literals.
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

function sanitizePath(p: string): string {
  let s = p;
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1);
  }
  s = s.replace(/[\s\r\n]+$/, "");
  s = s.replace(/^[\s]+/, "");
  return s;
}

function probePath(p: string): {
  exists: boolean;
  kind: "file" | "directory" | null;
  error: string | null;
} {
  try {
    const s = statSync(p);
    return {
      exists: true,
      kind: s.isDirectory() ? "directory" : s.isFile() ? "file" : null,
      error: null,
    };
  } catch (e) {
    return {
      exists: false,
      kind: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function resolveClaudeBinary(verbose = false): string {
  const log = (msg: string) => {
    if (verbose) console.log(`[claude:resolve] ${msg}`);
  };

  if (process.env.CLAUDE_CLI_PATH) {
    const raw = process.env.CLAUDE_CLI_PATH;
    const cleaned = sanitizePath(raw);
    log(`CLAUDE_CLI_PATH raw=${JSON.stringify(raw)}`);
    if (raw !== cleaned) {
      log(`CLAUDE_CLI_PATH cleaned=${JSON.stringify(cleaned)}`);
    }
    const probe = probePath(cleaned);
    if (probe.exists && probe.kind === "file") {
      log("  → exists and is a file, using");
      return cleaned;
    }
    log(
      `  → rejected (exists=${probe.exists} kind=${probe.kind} error=${probe.error})`
    );
  }

  if (process.platform === "win32") {
    const candidates: string[] = [];
    const home = homedir();
    log(`homedir()=${JSON.stringify(home)}`);
    candidates.push(join(home, "AppData", "Roaming", "Claude", "claude-code"));

    if (process.env.USERPROFILE && process.env.USERPROFILE !== home) {
      log(`USERPROFILE=${JSON.stringify(process.env.USERPROFILE)}`);
      candidates.push(
        join(
          process.env.USERPROFILE,
          "AppData",
          "Roaming",
          "Claude",
          "claude-code"
        )
      );
    }
    if (process.env.APPDATA) {
      log(`APPDATA=${JSON.stringify(process.env.APPDATA)}`);
      candidates.push(join(process.env.APPDATA, "Claude", "claude-code"));
    }

    // MSIX package virtualization: Claude Desktop installed from the
    // Microsoft Store redirects %APPDATA%\Claude through a reparse point
    // that Node's stat doesn't follow. Probe the real package paths.
    const localAppData =
      process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    const packagesRoot = join(localAppData, "Packages");
    log(`LOCALAPPDATA Packages root: ${packagesRoot}`);
    if (probePath(packagesRoot).exists) {
      try {
        const families = readdirSync(packagesRoot).filter((d) =>
          /^Claude/i.test(d)
        );
        log(`  → Claude_* packages: ${JSON.stringify(families)}`);
        for (const family of families) {
          candidates.push(
            join(
              packagesRoot,
              family,
              "LocalCache",
              "Roaming",
              "Claude",
              "claude-code"
            )
          );
          candidates.push(
            join(
              packagesRoot,
              family,
              "LocalState",
              "Roaming",
              "Claude",
              "claude-code"
            )
          );
          candidates.push(
            join(packagesRoot, family, "Claude", "claude-code")
          );
        }
      } catch (e) {
        log(
          `  → packages readdir error: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    for (const installRoot of candidates) {
      log(`checking install root: ${installRoot}`);
      const rootProbe = probePath(installRoot);
      if (!rootProbe.exists) {
        log(`  → missing (${rootProbe.error})`);
        continue;
      }
      if (rootProbe.kind !== "directory") {
        log(`  → not a directory (kind=${rootProbe.kind})`);
        continue;
      }
      try {
        const entries = readdirSync(installRoot);
        log(`  → entries: ${JSON.stringify(entries)}`);
        const versions = entries
          .filter((d) => {
            try {
              return statSync(join(installRoot, d)).isDirectory();
            } catch {
              return false;
            }
          })
          .sort()
          .reverse();
        for (const v of versions) {
          const exe = join(installRoot, v, "claude.exe");
          log(`  → trying ${exe}`);
          const probe = probePath(exe);
          if (probe.exists && probe.kind === "file") {
            log("    ✓ found");
            return exe;
          }
          log(`    ✗ ${probe.error ?? "not a file"}`);
        }
      } catch (e) {
        log(`  → readdir error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  log("no full path found, falling back to PATH lookup");
  return "claude";
}

function tempPath(ext: string): string {
  return join(
    tmpdir(),
    `dota2-buddy-${randomBytes(8).toString("hex")}${ext}`
  );
}

function safeUnlink(p: string) {
  try {
    if (existsSync(p)) unlinkSync(p);
  } catch {
    /* ignore */
  }
}
