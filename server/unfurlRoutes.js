import express from "express";
import dns from "node:dns/promises";

export const unfurlRouter = express.Router();

/**
 * POST /api/unfurl — read a pasted link's own metadata (title, image,
 * description) so an added link arrives as something you can recognise
 * rather than a bare hostname (Samuel, 2026-07-21).
 *
 * Server-side because the browser can't: cross-origin HTML isn't readable
 * from the page, and routing it through the proxy is the same shape as
 * every other outbound call here.
 *
 * This is the first route in the project that fetches an arbitrary,
 * user-supplied host, which makes it the first with a real SSRF surface —
 * the proxy sits on localhost beside a mymind-credentialled server and
 * whatever else is on this machine. So the guard below is not boilerplate:
 * without it, pasting http://localhost:8787/api/mymind/... or a link that
 * redirects to 169.254.169.254 turns "add a link" into "read anything this
 * machine can reach". Public hosts only, checked after DNS resolution and
 * again on every redirect hop.
 */

const TIMEOUT_MS = 8000;
/** Enough for any sane <head>; a 200MB video must not be pulled into RAM
 * to find a title that lives in the first few KB. */
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;

/** Private, loopback, link-local and carrier-grade-NAT ranges. Anything
 * that isn't plainly public is refused — the failure mode of being too
 * strict is "that link didn't unfurl", which is survivable. */
function isPrivateAddress(address, family) {
  if (family === 6) {
    const v6 = address.toLowerCase();
    if (v6 === "::1" || v6 === "::") return true;
    // Unique-local (fc00::/7) and link-local (fe80::/10).
    if (/^f[cd]/.test(v6) || /^fe[89ab]/.test(v6)) return true;
    // IPv4-mapped (::ffff:10.0.0.1) — unwrap and check as v4.
    const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1], 4);
    return false;
  }
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

async function assertPublicHost(hostname) {
  let records;
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error("That host doesn't resolve.");
  }
  if (records.length === 0) throw new Error("That host doesn't resolve.");
  for (const { address, family } of records) {
    if (isPrivateAddress(address, family)) {
      throw new Error("That address is on this network — refusing to fetch it.");
    }
  }
}

/** Follows redirects by hand so every hop is re-checked. `redirect:
 * "follow"` would let a public URL bounce to a private one behind our back,
 * which is the classic way this guard gets bypassed. */
async function fetchPage(startUrl) {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Only http and https links can be read.");
    }
    await assertPublicHost(url.hostname);

    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        // Plain and honest. Some sites serve a different <head> to unknown
        // agents; none of them are owed a disguise.
        "User-Agent": "TheOrganizer/1.0 (personal archive; link preview)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error(`That link redirected nowhere (${res.status}).`);
      url = new URL(location, url);
      continue;
    }
    if (!res.ok) throw new Error(`That link answered ${res.status}.`);

    const type = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml/i.test(type)) {
      // Not a page — a direct image or PDF link is still a fine thing to
      // save, it just has no <head> to read.
      return { html: "", finalUrl: url, contentType: type };
    }

    // Bounded read: stop as soon as we have enough for the head.
    const reader = res.body?.getReader();
    if (!reader) return { html: "", finalUrl: url, contentType: type };
    const chunks = [];
    let total = 0;
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    reader.cancel().catch(() => {});
    return {
      html: Buffer.concat(chunks).toString("utf8"),
      finalUrl: url,
      contentType: type,
    };
  }
  throw new Error("That link redirects too many times.");
}

function decodeEntities(text) {
  return text
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, code) => {
      if (code[0] === "#") {
        const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
      }
      const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
      return named[code.toLowerCase()] ?? whole;
    })
    .trim();
}

/** Meta tags, without a DOM. A regex parser is the wrong tool for HTML in
 * general and the right one here: we want four specific attributes out of
 * the first 512KB, not a document model, and a dependency that parses
 * hostile HTML is a bigger surface than this is worth. */
function metaContent(html, names) {
  for (const name of names) {
    const pattern = new RegExp(
      `<meta[^>]+(?:property|name)\\s*=\\s*["']${name}["'][^>]*>`,
      "i"
    );
    const tag = html.match(pattern)?.[0];
    if (!tag) continue;
    const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1];
    if (content?.trim()) return decodeEntities(content);
  }
  return "";
}

unfurlRouter.post("/", async (req, res) => {
  const raw = typeof req.body?.url === "string" ? req.body.url.trim() : "";
  if (!raw) {
    res.status(400).json({ error: "A url is required." });
    return;
  }
  let url;
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    res.status(400).json({ error: "That isn't a link we can read." });
    return;
  }

  try {
    const { html, finalUrl, contentType } = await fetchPage(url);
    const title =
      metaContent(html, ["og:title", "twitter:title"]) ||
      decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
    const description = metaContent(html, [
      "og:description",
      "twitter:description",
      "description",
    ]);
    const rawImage = metaContent(html, ["og:image", "og:image:url", "twitter:image"]);
    let imageUrl = "";
    if (rawImage) {
      try {
        const resolved = new URL(rawImage, finalUrl);
        // The image is rendered by the browser directly, so it must be
        // public too — the same guard, for the same reason.
        if (resolved.protocol === "https:" || resolved.protocol === "http:") {
          await assertPublicHost(resolved.hostname);
          imageUrl = resolved.toString();
        }
      } catch {
        /* an unusable preview image is not a failed unfurl */
      }
    }

    res.json({
      url: finalUrl.toString(),
      title,
      description,
      imageUrl,
      siteName: metaContent(html, ["og:site_name"]),
      contentType,
    });
  } catch (err) {
    res.status(422).json({ error: err.message ?? "Couldn't read that link." });
  }
});
