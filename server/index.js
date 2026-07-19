import "dotenv/config";
import express from "express";
import { router } from "./routes.js";
import { arenaRouter } from "./arenaRoutes.js";
import { clearArenaToken, writeArenaToken, writeCredentials } from "./setup.js";

const app = express();
// Only needed for the one write route (POST tags) — every other route is a
// GET with no body.
app.use(express.json());
app.use("/api/mymind", router);
app.use("/api/arena", arenaRouter);

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    credentialsConfigured: Boolean(process.env.MYMIND_KID && process.env.MYMIND_SECRET),
    // The kid is a public key identifier, not a secret (it's sent in the
    // clear in every request's JWT header) — safe to echo back so the
    // settings UI can show which key is active. The secret itself is never
    // sent back over the wire once saved.
    kid: process.env.MYMIND_KID || null,
    // Are.na's token has no analogous public half to echo back — this is
    // just a connected/not-connected boolean, same spirit as mymind's flag.
    arenaConfigured: Boolean(process.env.ARENA_TOKEN),
  });
});

// POST /api/setup/credentials  { kid: string, secret: string }
// Writes MYMIND_KID/MYMIND_SECRET to .env and applies them immediately —
// local-only config, never touches mymind itself. The access level (read
// only vs full access) is whatever was chosen when the key was created on
// mymind's own Extensions page; this endpoint just stores whichever key
// the user pastes in, it can't change a key's scope after the fact.
app.post("/api/setup/credentials", (req, res) => {
  const kid = typeof req.body?.kid === "string" ? req.body.kid.trim() : "";
  const secret = typeof req.body?.secret === "string" ? req.body.secret.trim() : "";
  if (!kid || !secret) {
    res
      .status(400)
      .json({ type: "BadRequest", status: 400, detail: "Both kid and secret are required." });
    return;
  }
  try {
    writeCredentials(kid, secret);
    res.status(204).end();
  } catch (err) {
    console.error("[mymind proxy] failed to write credentials", err);
    res.status(500).json({ type: "InternalError", status: 500, detail: String(err) });
  }
});

// POST /api/setup/arena-token  { token: string }
// Writes ARENA_TOKEN to .env and applies it immediately — local-only
// config, same treatment as mymind's credential write above. Are.na
// personal access tokens don't expire and carry whatever scope (read /
// read+write) was chosen when the token was created on are.na/settings.
app.post("/api/setup/arena-token", (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (!token) {
    res.status(400).json({ type: "BadRequest", status: 400, detail: "`token` is required." });
    return;
  }
  try {
    writeArenaToken(token);
    res.status(204).end();
  } catch (err) {
    console.error("[are.na proxy] failed to write token", err);
    res.status(500).json({ type: "InternalError", status: 500, detail: String(err) });
  }
});

// POST /api/setup/arena-disconnect — removes ARENA_TOKEN locally.
app.post("/api/setup/arena-disconnect", (_req, res) => {
  try {
    clearArenaToken();
    res.status(204).end();
  } catch (err) {
    console.error("[are.na proxy] failed to clear token", err);
    res.status(500).json({ type: "InternalError", status: 500, detail: String(err) });
  }
});

const port = Number(process.env.PORT) || 8787;
// Bound to loopback only — this proxy holds your mymind credentials (via
// signed requests) and has no auth of its own. Listening on all interfaces
// (the default with no host arg) would expose it, and your whole mymind
// library plus the tag-write endpoint, to anyone else on the same network.
app.listen(port, "127.0.0.1", () => {
  console.log(`mymind proxy listening on http://localhost:${port}`);
  if (!process.env.MYMIND_KID || !process.env.MYMIND_SECRET) {
    console.warn(
      "MYMIND_KID / MYMIND_SECRET are not set in .env — requests to /api/mymind/* will fail until they are."
    );
  }
});
