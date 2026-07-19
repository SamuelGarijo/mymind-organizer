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
