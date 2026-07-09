# mymind API

Canonical reference, provided directly by the user (2026-07-08). This is the
full spec — `CLAUDE.md` has the condensed project-specific rules; read this
file when touching anything under `server/mymindClient.js`,
`server/routes.js`, or `src/lib/mymindSync.ts`/`mymindWrite.ts`.

Base URL: `https://api.mymind.com`. All endpoints are versionless and JSON
unless otherwise noted.

## Empirical entityType audit (2026-07-08)

Per-type sampling against the real library (`ENTITY_TYPES_WITHOUT_IMAGE_ACCESS`
in `src/lib/mymindSync.ts`), done while checking whether the Note
content/thumbnail bug (see NOTE_CONTENT_KEY) also affected other text-heavy
types:

| entityType | sample | `content` field | `blob` | `/thumbnail` | Verdict |
|---|---|---|---|---|---|
| Note | 93 total | yes (100%) | no | 404 | Real text in `content`; no image. Fixed. |
| Content | 16 total, 4 tested | yes (100%) | no | 404 (4/4) | Same shape as Note — same fix applied. |
| Document | 48 total, 13 tested | no | yes, `application/pdf` (100%) | 404 (13/13) | Has a real downloadable original (already surfaced via "Download original"), just no working preview thumbnail — different cause, same practical fix (skip the wasted request). |
| Article | 233 total, 4 tested | no | no | 200 (4/4) | Thumbnails work — no gap. |
| Book | 43 total, 4 tested | no | no | 200 (4/4) | Thumbnails work — no gap. |

Not investigated: whether `GET /objects/:id/content` (per-object, not in the
list response) would return real text for Article/Book too — would require
an extra request per object (233 + 43 of them), not a free win like Note/
Content's inline `content` field was. Revisit only if a real gap surfaces.

## Authentication

Every request is authenticated with a fresh HS256 JWT, signed with an access
key created on the user's Extensions page. Each access key has a `kid`
(identifier) and a base64-encoded 128-bit `secret`.

JWT shape:

- Header: `{ "alg": "HS256", "kid": "<key id>" }`
- Claims:
  - `method`: HTTP method, uppercase (`GET`, `POST`, ...).
  - `path`: request path, no query string (e.g. `/objects`).
  - `iat`: issued-at, Unix seconds.
  - `exp`: expiry, Unix seconds. Recommend `iat + 300` (5 minutes). Tokens
    past `exp` are rejected.

Each segment must be **base64url-encoded with no padding**. Sign
`header.payload` with HMAC-SHA256 using the decoded secret.

Send as a Bearer token:

```
Authorization: Bearer <signed-jwt>
User-Agent: <your-app>/<version>
```

`User-Agent` is required on every request — requests without one are
rejected.

Tokens are bound to the specific `method`+`path`, so a stolen token can't be
replayed against a different endpoint. Generate a new token per request.

## Access control

Each access key is scoped along two independent dimensions: an **access
level** (what actions it can perform) and a **content scope** (what it can
see). Choose the narrowest combination that still lets the integration do
its job.

**Access level:**

| Level | Description |
|---|---|
| Read only | Retrieve objects, tags, spaces, and search results. Cannot create, modify, or delete anything. |
| Full access | All read operations, plus create/update/delete. |

> **Important:** a Full access key can permanently delete content. An AI
> agent acting on your behalf can move, modify, or remove anything within
> the key's scope. Issue Full access only when an integration genuinely
> needs to write — this project's own key policy (see `CLAUDE.md`) is
> deliberately narrower than even "Full access" would allow: GET everywhere,
> plus exactly `POST /objects/:id/tags`, `POST`/`PUT /objects/:id/notes[/:id]`,
> and `PUT /objects/:id/content` — never `DELETE`, never bare `PATCH`.

**Content scope** *(not yet enforced — every key currently sees Everything
regardless of the scope assigned to it)*:

| Scope | Description |
|---|---|
| Everything | All content, including anything marked sensitive/NSFW. |
| Non-sensitive | Only content saved from a public URL. Still includes NSFW items from a public source; excludes notes, PDFs, images, and other directly-saved content. |

Keys outside the scope return `403 Forbidden`. List endpoints silently omit
out-of-scope objects; direct `id` lookups against an out-of-scope object
return `404`.

Two rules of thumb from mymind's own docs: pick Read only unless the
integration demonstrably needs to write; pick Non-sensitive unless it needs
private notes, uploaded files, or other directly-saved content.

## Base Types

Optional fields are marked with `?` throughout this doc.

**Scalars:**

| Type | Description |
|---|---|
| `Uid` | 22 case-sensitive base62 characters (A-Z, a-z, 0-9), e.g. `a1B2c3D4e5F6g7H8i9J0k1`. |
| `Timestamp` | ISO 8601 date-time in UTC, e.g. `2024-03-01T12:00:00Z`. |
| `Url` | Absolute URL, e.g. `https://example.com/page`. |
| `Color` | Any valid CSS color — hex, `rgb()`, `hsl()`, named, e.g. `#ff5924`, `rebeccapurple`. |
| `IsoDuration` | ISO 8601 duration, e.g. `PT3M45S`, `PT1H30M`. |
| `ISBN` | ISBN-13, e.g. `9780141036144`. |
| `IsoDateTimeRange` | A year (`2026`), a month (`2025-02`), or an explicit period (`2026-03-01T04:15:00Z/P7D` — start instant + `IsoDuration`). Used by `created:`/`bumped:`/`published:` search filters. |

**Object types:**

| Type | Shape | Description |
|---|---|---|
| `Palette` | `{ [Color]: number }` | Dominant colors of an image, weighted `0`–`1`, typically summing to `1.0`. |
| `AI` | `{ summary: string }` | AI-generated metadata. Populated asynchronously — may be absent right after creation. |
| `Content` | `{ type: "text/plain" \| "text/markdown" \| "text/html" \| "application/prose+json", body: string \| Prose }` | `body` is a string for the text MIME types, a `Prose` document (see below) for `application/prose+json`. |
| `BlobReference` | `{ path, type, name?, url?, width?, height?, palette? }` | A binary attachment. `path` is under `https://mymind.media`. `name` is the original filename (from the upload's `Content-Disposition`), when provided. `width`/`height`/`palette` present for images. |
| `EntityReference` | `{ id: Uid }` | A reference to another entity by id. |
| `Offer` | `{ price: number, currencyCode: string }` | `currencyCode` is ISO 4217 (`USD`, `EUR`, ...). |

## Errors

Errors follow RFC 9457 (`application/problem+json`):

```json
{ "type": "<PascalCase identifier>", "status": <int>, "detail": "<human readable>" }
```

`type` is a stable PascalCase identifier (e.g. `NotFound`, `Unauthorized`) —
branch on it rather than on `detail`.

Status codes used:

- `200` OK, `201` Created — success.
- `400` BadRequest — malformed or missing required fields.
- `401` Unauthorized — JWT missing, invalid, or signed with the wrong secret.
- `403` Forbidden — key valid but lacks permission for this action or scope.
- `404` NotFound — resource doesn't exist or is outside the key's scope.
- `413` PayloadTooLarge — body exceeds 64 MB attachment cap.
- `415` UnsupportedMediaType — MIME type isn't in the supported formats list.
- `422` Unprocessable — well-formed but failed validation.
- `429` RateLimited — credit quota exceeded; see `RateLimit` header.
- `500` InternalServerError — unexpected server error; safe to retry with
  exponential backoff.
- `503` Unavailable — temporary unavailability (maintenance or overload);
  retry later.

## Rate limits

Usage is metered in credits. Two policies run in parallel — `burst` (a short
window for spikes) and `sustained` (a 30-day allowance). Every response
carries three headers:

```
RateLimit-Policy: "burst";q=10000;w=300, "sustained";q=100000;w=2592000
RateLimit:        "burst";r=9990;t=300, "sustained";r=99641;t=2589945
RateLimit-Cost:   10
```

Each header is a comma-separated list with one entry per policy. The quoted
string is the policy name; the remaining tokens are parameters:

- `RateLimit-Policy` — `q` total credits granted for the window, `w` window
  length in seconds. Reflects the current plan; only changes on upgrade.
- `RateLimit` — `r` credits remaining (`0` means exhausted), `t` seconds
  until the window resets.
- `RateLimit-Cost` — credits charged for this request (final, rounded-up
  value for variable-cost actions).

After a `429`, parse the `RateLimit` header, find every policy with `r=0`,
and sleep until the slowest of those windows resets — the largest `t` among
the exhausted policies. Don't back off against a policy that still has
credits.

## Resource: Objects

An object is anything saved to the user's mind — a URL, note, image,
document.

Object model:

- `id`: Uid
- `title`: string
- `summary`: string — AI generated summary of the object
- `mainEntity?`: Entity — the primary real-world thing the object is about
  (e.g. a recognized Book, Movie, or XPost). Best-effort, discovered during
  analysis, so it may be absent. See Entities below.
- `completed?`: boolean — whether the object is marked done.
- `content?`: Content — **the object's own primary body.** For a Note, this
  is the actual written text (confirmed empirically 2026-07-08: `notes[]` is
  a separate, usually-empty annotation array — see below). Mapped to
  `NOTE_CONTENT_KEY` in `src/lib/mymindSync.ts`.
- `blob?`: BlobReference — `{ path, type, name?, url?, width?, height?,
  palette? }`. Present for objects backed by uploaded media (images, video,
  PDFs). Image blobs include `width`/`height` (see BLOB_ASPECT_KEY) and a
  `palette` (a map of dominant `Color` keys to weight numbers).
- `screenshot?`: BlobReference — screenshot captured at save time (rendered
  view of a saved web page). Bytes also retrievable via
  `GET /objects/:id/screenshot`.
- `spaces?`: ObjectSpace[] — `[{ id: Uid }]`
- `tags`: ObjectTag[] — `[{ id?: Uid, name: string, flags: TagFlag }]` (`id`
  present only after the tag exists; absent when adding by name)
- `notes?`: ObjectNote[] — `[{ id: Uid, content: Content }]`. A *secondary*
  annotation slot attachable to any object — distinct from `content` above.
  Only `notes[0]` is surfaced in mymind's own app.
- `source?`: ObjectSource — `{ url: string }`
- `bumped`: Timestamp (last time the same content was re-saved)
- `created`: Timestamp
- `modified`: Timestamp
- `deleted?`: Timestamp (present only when soft-deleted; recoverable for 30
  days)
- `embeddings?`: ObjectEmbedding[] — only present when requested with
  `?include=embeddings`. Each `{ id: Uid, vector: number[] (32-bit floats,
  up to 3072 dims), modelId: number }`. By default an interleaved
  representation of the object and its attachments; treat the vector as
  opaque rather than depending on a specific encoding.

Endpoints:

- `GET /objects` — list. Query: `q` (search syntax, caps results at 1000),
  `id` (repeatable to fetch many), `spaceId` (Uid, restrict to objects in
  the given space), `similarTo` (Uid, related-object ranking; `Mastermind`
  plan only), `contentAs` (e.g. `text/markdown`), `include` (e.g.
  `embeddings` — adds the `embeddings` array to each object), `limit`
  (default 10000, max 10000; capped at 1000 when `q` is provided).
- `POST /objects` — create from a URL, inline content, or uploaded file.
  Common fields: `title?`, `tags?`, `spaces?`, `notes?` (`[{ content:
  Content }]`, attached at creation). Then exactly one of `url`, `content`,
  or `blob` (combining them returns `400`). For `blob`, send
  `multipart/form-data` with a `metadata` JSON part and a `blob` binary part
  (max 64 MB; returns `413` if larger). If the body resolves to an existing
  object (same URL, content, or byte-identical upload), the API returns the
  existing object with a refreshed `bumped` timestamp and `200 OK` instead
  of `201 Created`.
- `GET /objects/:id` — retrieve. Query: `contentAs`.
- `PATCH /objects/:id` — update metadata. Body: `{ title?, summary?,
  completed? }`.
- `DELETE /objects/:id` — soft-delete (recoverable for 30 days). Idempotent.
- `POST /objects/:id/restore` — un-delete. Idempotent.
- `GET /objects/:id/blob` — original uploaded bytes (no transcoded
  variants). Only for objects with a single uploaded attachment; returns
  `422` otherwise. May return a `302` redirect to a CDN URL — follow
  redirects.
- `GET /objects/:id/content` — text-based objects only. Optional `Accept`
  header chooses the output format (`text/markdown`, `application/prose+json`,
  `text/html`); omit for the native format. Returns `406` for unsupported
  formats, `422` for non-text types.
- `GET /objects/:id/screenshot` — screenshot captured at save time (rendered
  view of a saved web page). Returns `422` for objects without a screenshot.
  May return a `302` redirect to a CDN URL — follow redirects.
- `GET /objects/:id/thumbnail` — preview image for the object. Query: `size`
  as `WxH` (e.g. `100x100`) acts as a containment box (CSS
  `object-fit: contain`); omit for the default, pre-rendered thumbnail. May
  return a `302` redirect to a signed CDN URL valid for ~5 minutes — follow
  redirects.
- `PUT /objects/:id/content` — replace a Note's full content body.
  `Content-Type` must be `text/markdown` or `application/prose+json`.
  Idempotent. `422` for any other object type. **This is the write path for
  real Note content** (as opposed to the `notes[]` annotation endpoints
  below).
- `POST /objects/:id/notes` — append a new note to the object's `notes`
  array. `Content-Type` must be `text/markdown` or `application/prose+json`.
  Returns `{ id }` for the newly created note. Objects support up to 100
  notes via the API, but the mymind app currently only surfaces `notes[0]`
  — additional notes are stored and returned by the API but not visible in
  the UI yet.
- `PUT /objects/:id/notes/:noteId` — replace the body of an existing note.
  `Content-Type` must be `text/markdown` or `application/prose+json`.
  Idempotent. `404` if the note doesn't exist on the object.
- `DELETE /objects/:id/notes/:noteId` — remove a note from the object.
  Idempotent — deleting a note that's already gone is a no-op.
- `POST /objects/:id/pin` — pin to top of mind. Body: `{ position?: number
  }` (zero-based slot; omit to append).
- `DELETE /objects/:id/pin` — unpin. Idempotent.
- `POST /objects/:id/tags` — add tags. Body: a bare array of ObjectTag, e.g.
  `[{ name: "design" }]`. Idempotent.
- `DELETE /objects/:id/tags` — remove tags. Body: array of tag references —
  each entry is `{ name: string }` or `{ id: Uid }` (mix and match). Removing
  a tag that isn't on the object is a no-op. Idempotent.
- `POST /objects/:id/spaces` — add to one or more spaces (max 100 per
  object). Body: `[{ id: Uid }]`. Idempotent.

## Entities (WIP)

Some objects carry a `mainEntity` — the structured real-world thing behind
the object. Entity types follow the Schema.org vocabulary with
JSON-LD-style keys. An Entity is `{ "@type": string | string[], "@id"?:
string, ...type-specific fields }`:

- `@type`: entity kind(s) from Schema.org — a single type name, or an array
  when the entity is several types at once (multi-typed node), e.g. `Book`,
  `Movie`, `Product`, `Repository`, `XPost`, `InstagramReel`, `TVEpisode`,
  `VideoGame` (and many more).
- `@id?`: mymind's internal identifier, present only when the entity is a
  well-known public object (a recognized book, film, product, or social
  post). Not a public or canonical id.

This surface is under active development — most entity types and their
fields may change before launch; treat `mainEntity` as best-effort and
don't rely on a specific shape yet.

Separately, an undocumented plural `entities[]` array has been observed
empirically on social-media-type objects (InstagramPost, XPost, etc.),
containing `attachments[].path` — the same CDN path shape as `blob.path` —
but with no fetchable URL exposed yet. See `docs/mymind-image-access.md`
(if present) or issue #72 for status.

## Resource: Spaces

A space is a named collection of objects.

Space model: `{ id: Uid, name: string, color: Color, created: Timestamp,
objects: SpaceObject[] }` where `SpaceObject` is `{ id: Uid }`.

Endpoints:

- `GET /spaces` — list all spaces.
- `POST /spaces` — create. Body: `{ name (required), color?, objects? }`
  where `objects` is `[{ id: Uid }]` to populate the new space at creation
  (max 10000). Duplicate `name` returns `409`.
- `GET /spaces/:id` — retrieve, including contained objects.
- `PATCH /spaces/:id` — update `name` or `color`.
- `DELETE /spaces/:id` — delete the space (objects survive, just lose
  membership). Idempotent.
- `PUT /spaces/:spaceId/objects/:objectId` — add object to space.
  Idempotent.
- `DELETE /spaces/:spaceId/objects/:objectId` — remove. Idempotent.

## Resource: Tags

Tags are free-form labels attached to objects. They are created implicitly
the first time they're used — there is no separate "create tag" endpoint.
Tags can be applied by the user or inferred automatically by AI. Tags are
identified by their `name` — there is no separate identifier.

Tag model: `{ name: string, count: integer, flags: TagFlag, modified:
Timestamp }`.

| Property | Type | Description |
|---|---|---|
| `name` | string | The tag label, set by the user or inferred by AI. |
| `count` | integer | Number of objects currently tagged. |
| `flags` | TagFlag | Bitmask describing how the tag was applied. |
| `modified` | Timestamp | When the tag was last added to or removed from an object. |

`TagFlag` is a bitmask — a tag may carry multiple flags at once (e.g.
AI-suggested and later confirmed manually) — use bitwise-AND to test for a
specific flag.

| Value | Name | Description |
|---|---|---|
| `0` | None | No flags set. |
| `2` | AI | Applied automatically by AI. |
| `8` | Manual | Applied manually by the user. |

Endpoints:

- `GET /tags` — list user's tags, sorted by most recently used first. Query:
  `limit` (default 1000, max 10000). **5 credits.** Requires an `Accept`
  header: `application/json` (single array) or `application/jsonl`
  (streaming — one tag per line, newline-delimited JSON).

  ```json
  // Accept: application/json
  [
    { "name": "writing", "count": 14, "modified": "2024-04-01T10:30:00Z" },
    { "name": "tools", "count": 8, "modified": "2024-03-28T15:45:00Z" }
  ]
  ```

  ```
  // Accept: application/jsonl
  {"name":"writing","count":14,"modified":"2024-04-01T10:30:00Z"}
  {"name":"tools","count":8,"modified":"2024-03-28T15:45:00Z"}
  ```

Object-level tag writes (`POST`/`DELETE /objects/:id/tags`) are documented
under Objects above.

## Resource: Links

A link connects two objects. Links are either inferred from wiki-style
references in note content or created manually.

Link model: `{ id: Uid, type: LinkType, sourceId: Uid, targetId: Uid,
flags: integer }`.

`LinkType`: `WikiLink` (auto-inferred from a wiki-style reference in note
content) or `Manual` (user-created).

Endpoints:

- `GET /links` — list all links in the user's mind.
- `POST /links` — create a manual link between two objects. Body: `{
  sourceId: Uid, targetId: Uid }`. Returns `{ id: Uid }` — `201 Created` for
  a new link, `200 OK` if an identical link already exists (idempotent).
- `DELETE /links/:id` — remove a link by ID. Only works on `Manual` links —
  `WikiLink` deletes return `422`. To remove a `WikiLink`, edit the source
  note and delete the corresponding `[[…]]` reference. Idempotent.

## Tools: Search

`GET /search` — Lucene-inspired search across every object. **10–250
credits** (variable — semantic/rerank cost more). Query parameters:

| Parameter | Type | Default | Description |
|---|---|---|---|
| `q` | string | — | Required. Query string, URL-encoded (`%26%26` for `&&`, `%3A` for `:`). |
| `limit` | integer | 20 | Max results per page. Capped at 1000. |
| `semantic` | boolean | false | Match by meaning rather than exact terms. |
| `semanticBoost` | number | — | Multiplier on semantic relevance. Only applies with `semantic=true`. |
| `similarTo` (`Mastermind`) | Uid | — | Finds content in the same vibe as the given id. Implies `semantic=true`. |
| `rerank` (`Mastermind`) | boolean | false | Cross-encoder re-score for higher precision. Caps results at 100, implies `semantic=true`. |

Response: `{ "matches": Match[] }`, sorted by descending relevance.

**Match:**

| Property | Type | Description |
|---|---|---|
| `id` | Uid | The matching object's id. |
| `score` | number | Relevance score — higher is stronger. |
| `semanticScore?` | number | Present only when `semantic=true` (or `rerank=true`, which implies it). |

Query syntax (terms case-insensitive; operators uppercase or symbolic):

- `term` — matches title/content/URL.
- `"exact phrase"` — exact match.
- `a && b` (default between terms), `a || b`, `-term` (exclude), `term*`
  (wildcard prefix).
- Fields (use `field:value`; quote multi-word values, e.g. `title:"plain
  text"`):

  | Field | Values | Description |
  |---|---|---|
  | `tag:` | any tag name | Filters by tag. |
  | `type:` | `article`, `image`, `note`, ... | Filters by object type. |
  | `title:` | any string | Matches the title only. |
  | `author:` | any string | Filters by the source content's author. |
  | `domain:` | a domain | Filters to objects saved from that domain. |
  | `action:` | `read`/`watch`/`make`/`purchase` | Filters to objects with an associated action. |
  | `completed:` | `true`/`false` | Whether the action is done — pair with `action:`. |
  | `created:` | IsoDateTimeRange | When the object was saved, e.g. `created:2026`. |
  | `bumped:` | IsoDateTimeRange | When the object was last bumped to top of mind. |
  | `published:` | IsoDateTimeRange | The source content's publication date. |

Combine fields with `&&`: `action:read && completed:false`.

## Tools: Convert

`POST /convert` — convert between text, Markdown, and Prose. **1 credit.**

- Headers: `Content-Type` (input format) and `Accept` (desired output) —
  both required, both one of `text/plain`, `text/markdown`,
  `application/prose+json`. Must differ from each other.
- Body: the content to convert.
- Returns `422` if the source/target combo isn't supported:
  ```json
  { "type": "Unprocessable", "status": 422, "detail": "Cannot convert from the provided Content-Type to the requested Accept format." }
  ```

Examples: `Content-Type: text/plain` + `Accept: application/prose+json`
(plain → Prose); `Content-Type: text/markdown` + `Accept:
application/prose+json` (Markdown → Prose); `Content-Type:
application/prose+json` + `Accept: text/markdown` (Prose → Markdown, the
direction `updateMymindContent`/`createMymindNote` would need if this
project ever writes Prose directly instead of relying on mymind's own
Markdown-to-Prose auto-conversion on `text/markdown` bodies).

## Supported attachment formats

- Images: `image/jpeg .jpg/.jpeg`, `image/png .png`, `image/gif .gif`,
  `image/webp .webp`, `image/avif .avif`, `image/heif .heif/.heic`,
  `image/jxl .jxl`, `image/bmp .bmp`, `image/tiff .tif/.tiff`,
  `image/vnd.adobe.photoshop .psd`, `image/svg+xml .svg`.
- Text: `text/plain .txt`, `text/markdown .md`.
- Documents: `application/pdf .pdf`.
- Video (`Mastermind` plan): `video/mp4 .mp4`, `video/quicktime .mov`,
  `video/webm .webm`, `video/x-msvideo .avi`, `video/x-matroska .mkv`.
- Audio: not yet supported.

Max body size: 64 MB. Exceeding it returns `413`. Unsupported MIME types
return `415`.

## Markdown support

mymind accepts Markdown for notes and any text-based object. Input is
parsed as [CommonMark](https://commonmark.org/), with a small set of
extensions (always enabled). Non-significant whitespace is stripped on
save.

**Page links** — `[[Page Link]]` creates a link to another object in your
mind. The text inside the brackets is matched against object titles.

**Pipe tables** — pipe `|` syntax creates tables with optional header row
and column alignment:

```
| Format | Extension |
| ------ | --------: |
| PNG    |      .png |
| JPEG   |      .jpg |
```

**Task lists** — `- [ ]` and `- [x]` render as interactive task lists:

```
- [x] Draft outline
- [ ] Review with team
- [ ] Publish
```

**About prose** — internally, mymind stores text as *Prose*, based on the
ProseMirror document model. Reading content as Markdown converts on the
fly. Most content round-trips cleanly, but prose-specific features (custom
blocks, rich formatting) have no Markdown equivalent — writing back as
Markdown drops them. To read/write without losing information, use the
`application/prose+json` format directly. Use `POST /convert` to translate
between Markdown and Prose programmatically.

## Prose (WIP)

mymind's internal rich-text format — a JSON tree based on the ProseMirror
document model, served as `application/prose+json`. Any endpoint returning
`Content` may return Prose (check `content.type`); `POST /convert` gets a
lossy plain-Markdown view of the same content instead. **Still being filled
in upstream — round-trip with caution.**

A document is a tree: every node has a `type`, and may have `content` (child
nodes), `text` (leaf string), `attrs` (type-specific), and `marks` (inline
formatting).

```json
{
  "type": "doc",
  "content": [
    {
      "type": "paragraph",
      "content": [
        { "type": "text", "text": "Hello, " },
        { "type": "text", "text": "world", "marks": [{ "type": "bold" }] },
        { "type": "text", "text": "." }
      ]
    }
  ]
}
```

**Node types:**

| Type | Attrs | Description |
|---|---|---|
| `doc` | — | Root of every document. |
| `paragraph` | — | Inline content — text and `hardBreak`s. |
| `heading` | `level` (1–6) | A heading. |
| `bulletList` | — | Unordered list, wraps `listItem`s. |
| `orderedList` | — | Numbered list, wraps `listItem`s. |
| `listItem` | — | One entry in a `bulletList`/`orderedList`. |
| `taskList` | — | Checklist, wraps `taskItem`s. |
| `taskItem` | `checked` | One checkbox entry. |
| `codeBlock` | `language?` | Preformatted monospaced code. |
| `table` | — | Wraps `tableRow`s. |
| `tableRow` | — | Wraps `tableHeader`/`tableCell`s. |
| `tableHeader` / `tableCell` | — | Header/body cell. |
| `html` | — | Raw HTML, preserved verbatim. |
| `wikiLink` | `text`, `target?` | Internal link — `text` is the label, `target` the resolved object. From `[[Page Link]]`. **No `content` array — attrs only.** |
| `image` | `src?`, `alt?`, `title?` | Inline image. **No `content` array — attrs only.** |
| `hardBreak` | — | Forced line break. |
| `horizontalRule` | — | Divider between blocks. |

**Marks** (decorate a text node without splitting it — a node carries an
array under `marks`): `bold`, `italic`, `underline`, `strike`, `code`,
`link` (`href`, `title?`), `highlight`, `ins`, `superscript`, `subscript`.

> **Known gap in this project's own parser:** `src/lib/mymindSync.ts`'s
> `proseToPlainText` (used for both `DESCRIPTION_KEY` and `NOTE_CONTENT_KEY`)
> only recognizes `paragraph`/`heading`/`listItem`/`blockquote`/`codeBlock`
> as text-bearing containers and otherwise just concatenates `content`
> children — it silently drops anything carried purely in `attrs` rather
> than `content`/`text`, namely `wikiLink` (a `[[Page Link]]` reference) and
> `image` (an inline image). Fine for this app's current plain-textarea use
> case (matches "lossy Markdown view" expectations), but worth knowing if a
> note's extracted text ever looks shorter than expected.

## Recommended client shape / SDKs (mymind's own suggestion, not what we built)

mymind's docs suggest organizing a full client as resource namespaces
(`client.objects.*`, `client.spaces.*`, `client.tags.*`) on one top-level
class owning signing/transport/rate-limit backoff, with `search`/`convert`
as top-level tools. **We do not follow this shape** — our proxy
(`server/mymindClient.js` + `server/routes.js`) only implements the small,
explicitly-sanctioned subset of endpoints listed in `CLAUDE.md`. Don't use
this section to justify adding new endpoints; it's included for completeness
of the reference doc only.

Official SDKs are being built in the open at
[`mymindcorp/api`](https://github.com/mymindcorp/api) — not ready yet per
mymind's own docs; the reference snippets are canonical until they are. The
example JS SDK there demonstrates the same three things our own proxy
already does: a required `User-Agent`, a fresh per-request JWT bound to
method+path, and 429 back-off that waits for the slowest exhausted
`RateLimit` policy's window (see `backoffDelayMs` in
`server/mymindClient.js` — same algorithm).

## Conventions

- All requests must send `User-Agent`.
- All bodies are JSON unless explicitly multipart for uploads.
- All timestamps are UTC.
- Endpoints that take an `id` accept the 22-char `Uid`.
- Idempotent endpoints are marked above; calling them twice has the same
  effect as once.
- Objects outside the access key's content scope are silently omitted from
  list endpoints, and return `404` for direct `id` lookups.
- Internally, text content is stored as Prose (a ProseMirror document).
  Markdown conversion is automatic but lossy for prose-specific structures;
  if you save Markdown over an existing Prose document you will lose those
  structures.
