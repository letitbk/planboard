import { describe, it, expect, vi, beforeEach } from "vitest";

const { list, del } = vi.hoisted(() => ({
  list: vi.fn(),
  del: vi.fn(async (_url: string, _options: Record<string, unknown>) => {}),
}));
vi.mock("@vercel/blob", () => ({ list, del }));

import { run } from "./clear";

const env = { BOARD_SESSION_SECRET: "sess", BOARD_PULL_KEY: "pull-1", BLOB_READ_WRITE_TOKEN: "tok" };
const now = 1_000_000;

beforeEach(() => {
  list.mockReset();
  del.mockClear();
});

const authHeaders = { "x-board-key": "pull-1" };

describe("clear", () => {
  it("401 without auth (never HTML), and deletes nothing", async () => {
    const result = await run({}, env, now);
    expect(result.status).toBe(401);
    expect(del).not.toHaveBeenCalled();
  });

  it("deletes every comments/ blob when authed with the pull key", async () => {
    list.mockResolvedValue({
      blobs: [
        { url: "https://x.blob.vercel-storage.com/comments/1.json" },
        { url: "https://x.blob.vercel-storage.com/comments/2.json" },
      ],
      hasMore: false,
    });
    const result = await run(authHeaders, env, now);
    expect(result.status).toBe(200);
    expect(result.json).toEqual({ ok: true, deleted: 2 });
    expect(del).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ token: "tok", prefix: "comments/" }));
  });

  it("paginates across multiple list() pages", async () => {
    list.mockResolvedValueOnce({
      blobs: [{ url: "https://x.blob.vercel-storage.com/comments/1.json" }],
      hasMore: true,
      cursor: "c1",
    });
    list.mockResolvedValueOnce({
      blobs: [{ url: "https://x.blob.vercel-storage.com/comments/2.json" }],
      hasMore: false,
    });
    const result = await run(authHeaders, env, now);
    expect(list).toHaveBeenCalledTimes(2);
    expect((result.json as { deleted: number }).deleted).toBe(2);
  });
});
