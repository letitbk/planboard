import { put, list, get } from "@vercel/blob";

const PREFIX = "comments/";

export interface StoredComment {
  id: string; clientId: string; author: string; shareHash: string;
  docHash: string | null;
  annotation: Record<string, unknown>; receivedAt: string;
}

export async function putComment(token: string, comment: StoredComment): Promise<void> {
  await put(`${PREFIX}${comment.id}.json`, JSON.stringify(comment), {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json",
    token,
  });
}

export async function listComments(token: string): Promise<StoredComment[]> {
  const out: StoredComment[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ token, prefix: PREFIX, cursor, limit: 1000 });
    for (const b of page.blobs) {
      const r = await get(b.pathname, { access: "private", token });
      if (r?.statusCode === 200) {
        try { out.push(JSON.parse(await new Response(r.stream).text())); } catch { /* skip corrupt */ }
      }
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out; // content only — blob urls never leave this module
}
