import fs from "node:fs";
import path from "node:path";

const ENV_PATH = path.resolve(process.cwd(), ".env");

function readEnvLines() {
  try {
    return fs.readFileSync(ENV_PATH, "utf8").split("\n").filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

/**
 * Rewrites MYMIND_KID / MYMIND_SECRET in .env, leaving every other line
 * untouched, and updates process.env in place so the already-running
 * server (auth.js reads process.env fresh on every signed request) picks
 * up the new credentials immediately — no restart needed.
 */
function setEnvKey(lines, key, value) {
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
  const line = `${key}=${value}`;
  if (idx === -1) lines.push(line);
  else lines[idx] = line;
}

export function writeCredentials(kid, secret) {
  const lines = readEnvLines();
  setEnvKey(lines, "MYMIND_KID", kid);
  setEnvKey(lines, "MYMIND_SECRET", secret);
  fs.writeFileSync(ENV_PATH, lines.join("\n") + "\n", { mode: 0o600 });
  process.env.MYMIND_KID = kid;
  process.env.MYMIND_SECRET = secret;
}

/**
 * Same treatment as writeCredentials above, for Are.na's single personal
 * access token (no separate kid/secret split — v3 auth is a plain Bearer
 * token). A different write scope from mymind entirely: this never
 * touches mymind's own credentials or endpoints.
 */
export function writeArenaToken(token) {
  const lines = readEnvLines();
  setEnvKey(lines, "ARENA_TOKEN", token);
  fs.writeFileSync(ENV_PATH, lines.join("\n") + "\n", { mode: 0o600 });
  process.env.ARENA_TOKEN = token;
}

/** Gemini's API key — the classifier tier (2026-07-21). Same treatment
 * again, and a third separate project scope: it never touches mymind's
 * credentials or endpoints, and mymind's own plan buys none of it (its
 * credits meter requests, and it exposes no inference endpoint at all —
 * verified against live rate-limit headers). */
export function writeGeminiKey(key) {
  const lines = readEnvLines();
  setEnvKey(lines, "GEMINI_API_KEY", key);
  fs.writeFileSync(ENV_PATH, lines.join("\n") + "\n", { mode: 0o600 });
  process.env.GEMINI_API_KEY = key;
}

/** Removes GEMINI_API_KEY from .env and process.env. */
export function clearGeminiKey() {
  const lines = readEnvLines().filter((l) => !l.startsWith("GEMINI_API_KEY="));
  fs.writeFileSync(ENV_PATH, lines.join("\n") + "\n", { mode: 0o600 });
  delete process.env.GEMINI_API_KEY;
}

/** Removes ARENA_TOKEN from .env and process.env (the "Disconnect Are.na"
 * action) — local-only, never touches Are.na or mymind. */
export function clearArenaToken() {
  const lines = readEnvLines().filter((l) => !l.startsWith("ARENA_TOKEN="));
  fs.writeFileSync(ENV_PATH, lines.join("\n") + "\n", { mode: 0o600 });
  delete process.env.ARENA_TOKEN;
}
