import { afterEach, describe, it, expect, vi } from "vitest";
import { loadAssetText, AssetTextError, MAX_TEXT_BYTES } from "./assetText";

const b64 = (s: string) => Buffer.from(s, "utf-8").toString("base64");

afterEach(() => vi.unstubAllGlobals());

describe("loadAssetText / data: URLs", () => {
  it("decodes base64 UTF-8 including non-ASCII", async () => {
    const url = `data:text/csv;base64,${b64("héllo,wörld\n1,2")}`;
    expect(await loadAssetText(url)).toBe("héllo,wörld\n1,2");
  });
  it("decodes invalid UTF-8 bytes to replacement chars instead of throwing", async () => {
    // 0xFF is never valid UTF-8
    const url = `data:text/plain;base64,${Buffer.from([0x61, 0xff, 0x62]).toString("base64")}`;
    expect(await loadAssetText(url)).toBe("a�b");
  });
  it("rejects non-base64 or malformed data URLs as malformed", async () => {
    await expect(loadAssetText("data:text/plain,plain%20text")).rejects.toMatchObject({ kind: "malformed" });
    await expect(loadAssetText("data:text/plain;base64,@@not-base64@@")).rejects.toMatchObject({ kind: "malformed" });
  });
  it("rejects oversized payloads BEFORE decoding (byte estimate from base64 length)", async () => {
    // fake base64 body longer than 2MB*4/3 — must reject without atob
    const url = "data:text/csv;base64," + "A".repeat(Math.ceil((MAX_TEXT_BYTES + 1024) * (4 / 3)));
    await expect(loadAssetText(url)).rejects.toMatchObject({ kind: "oversized" });
  });
  it("decodes empty base64 to empty string", async () => {
    expect(await loadAssetText("data:text/plain;base64,")).toBe("");
  });
});

describe("loadAssetText / fetch URLs", () => {
  it("returns text for ok responses and passes the signal through", async () => {
    let gotSignal: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", (_u: string, init?: RequestInit) => {
      gotSignal = init?.signal;
      return Promise.resolve(new Response("hello", { status: 200 }));
    });
    const ctrl = new AbortController();
    expect(await loadAssetText("/artifact/x/r1/a.md", ctrl.signal)).toBe("hello");
    expect(gotSignal).toBe(ctrl.signal);
  });
  it("throws an http error for non-2xx instead of rendering the body", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("nope", { status: 404 })));
    await expect(loadAssetText("/artifact/x/r1/a.md")).rejects.toMatchObject({ kind: "http" });
  });
  it("rejects oversized responses via Content-Length before reading the body", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(new Response("x", {
        status: 200,
        headers: { "Content-Length": String(MAX_TEXT_BYTES + 1) },
      })),
    );
    await expect(loadAssetText("/artifact/x/r1/a.md")).rejects.toMatchObject({ kind: "oversized" });
  });
  it("errors are AssetTextError instances", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("nope", { status: 500 })));
    await expect(loadAssetText("/x")).rejects.toBeInstanceOf(AssetTextError);
  });
});
