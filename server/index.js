import "dotenv/config";
import express from "express";
import { router } from "./routes.js";

const app = express();
// Only needed for the one write route (POST tags) — every other route is a
// GET with no body.
app.use(express.json());
app.use("/api/mymind", router);

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    credentialsConfigured: Boolean(process.env.MYMIND_KID && process.env.MYMIND_SECRET),
  });
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
