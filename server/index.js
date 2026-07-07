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
app.listen(port, () => {
  console.log(`mymind proxy listening on http://localhost:${port}`);
  if (!process.env.MYMIND_KID || !process.env.MYMIND_SECRET) {
    console.warn(
      "MYMIND_KID / MYMIND_SECRET are not set in .env — requests to /api/mymind/* will fail until they are."
    );
  }
});
