// Straight from mymind's documented "Supported attachment formats" list —
// this is what an uploaded blob's `type` can actually be, not a guess.
const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/heif": "heif",
  "image/heic": "heic",
  "image/jxl": "jxl",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "image/vnd.adobe.photoshop": "psd",
  "image/svg+xml": "svg",
  "text/plain": "txt",
  "text/markdown": "md",
  "application/pdf": "pdf",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-msvideo": "avi",
  "video/x-matroska": "mkv",
};

/** A safe-ish filename from an object's title — strips path separators and
 * other characters that'd trip up a save dialog or a filesystem, and falls
 * back to a generic name if the title turns out to be empty/whitespace
 * after stripping (e.g. a title that's just emoji or punctuation). */
function sanitizeForFilename(title: string): string {
  const cleaned = title
    .replace(/[/\\?%*:|"<>]/g, "")
    .trim()
    .slice(0, 120);
  return cleaned || "download";
}

/** Builds a download filename for an object's original blob from its title
 * and mymind-reported MIME type. No extension is appended when the type
 * isn't in the known list — better an extension-less file than a wrong one. */
export function buildDownloadFilename(title: string, mimeType?: string): string {
  const base = sanitizeForFilename(title);
  const ext = mimeType ? MIME_EXTENSIONS[mimeType] : undefined;
  return ext ? `${base}.${ext}` : base;
}
