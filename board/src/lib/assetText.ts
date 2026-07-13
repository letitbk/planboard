// Text loading for the artifact viewer. Live boards fetch /artifact/ routes;
// static/remote/hosted boards embed artifacts as base64 data: URLs
// (board.py build_assets), decoded here without any network. Byte caps run
// BEFORE decoding (codex review: atob/text() must not process unbounded
// input); invalid UTF-8 decodes to replacement chars rather than throwing.

export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

export class AssetTextError extends Error {
  kind: "oversized" | "http" | "malformed";
  constructor(kind: AssetTextError["kind"], message: string) {
    super(message);
    this.kind = kind;
  }
}

const DATA_URL_RE = /^data:[^,]*;base64,([A-Za-z0-9+/=]*)$/;

export async function loadAssetText(url: string, signal?: AbortSignal): Promise<string> {
  if (url.startsWith("data:")) {
    const m = DATA_URL_RE.exec(url);
    if (!m) throw new AssetTextError("malformed", "unsupported data: URL");
    const b64 = m[1];
    if (b64.length * 0.75 > MAX_TEXT_BYTES) {
      throw new AssetTextError("oversized", "artifact exceeds 2 MB");
    }
    let bin: string;
    try {
      bin = atob(b64);
    } catch {
      throw new AssetTextError("malformed", "invalid base64 payload");
    }
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
  const res = await fetch(url, { signal });
  if (!res.ok) throw new AssetTextError("http", `HTTP ${res.status}`);
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > MAX_TEXT_BYTES) throw new AssetTextError("oversized", "artifact exceeds 2 MB");
  const text = await res.text();
  if (new TextEncoder().encode(text).length > MAX_TEXT_BYTES) {
    throw new AssetTextError("oversized", "artifact exceeds 2 MB");
  }
  return text;
}
