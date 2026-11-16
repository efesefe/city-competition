import { nanoid } from "nanoid";
import { many, one, type Queryable } from "./db.js";

export type InboxRow = {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

const LIST_LIMIT = 100;

export async function insertInbox(
  db: Queryable,
  input: {
    userId: string;
    type: string;
    title: string;
    body: string;
    payload: Record<string, unknown>;
  },
): Promise<InboxRow> {
  const id = nanoid();
  const row = await one<{
    id: string;
    user_id: string;
    type: string;
    title: string;
    body: string;
    payload: Record<string, unknown>;
    read_at: Date | null;
    created_at: Date;
  }>(
    db,
    `INSERT INTO user_notifications (id, user_id, type, title, body, payload)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING id, user_id, type, title, body, payload, read_at, created_at`,
    [id, input.userId, input.type, input.title, input.body, JSON.stringify(input.payload)],
  );
  if (!row) throw new Error("inbox_insert_failed");
  return mapRow(row);
}

export async function listInbox(db: Queryable, userId: string, limit = 50): Promise<InboxRow[]> {
  const capped = Math.min(Math.max(limit, 1), LIST_LIMIT);
  const rows = await many<{
    id: string;
    user_id: string;
    type: string;
    title: string;
    body: string;
    payload: Record<string, unknown>;
    read_at: Date | null;
    created_at: Date;
  }>(
    db,
    `SELECT id, user_id, type, title, body, payload, read_at, created_at
     FROM user_notifications
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, capped],
  );
  return rows.map(mapRow);
}

export async function unreadCount(db: Queryable, userId: string): Promise<number> {
  const row = await one<{ count: string }>(
    db,
    `SELECT COUNT(*)::text AS count FROM user_notifications
     WHERE user_id = $1 AND read_at IS NULL`,
    [userId],
  );
  return Number(row?.count ?? 0);
}

export async function markRead(
  db: Queryable,
  userId: string,
  opts: { ids?: string[]; all?: boolean },
): Promise<number> {
  if (opts.all) {
    const res = await db.query(
      `UPDATE user_notifications
       SET read_at = NOW()
       WHERE user_id = $1 AND read_at IS NULL`,
      [userId],
    );
    return res.rowCount ?? 0;
  }
  const ids = opts.ids ?? [];
  if (ids.length === 0) return 0;
  const res = await db.query(
    `UPDATE user_notifications
     SET read_at = NOW()
     WHERE user_id = $1 AND read_at IS NULL AND id = ANY($2::text[])`,
    [userId, ids],
  );
  return res.rowCount ?? 0;
}

export async function upsertPushToken(
  db: Queryable,
  input: { userId: string; token: string; platform: string },
): Promise<void> {
  await db.query(
    `INSERT INTO device_push_tokens (token, user_id, platform, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (token) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           platform = EXCLUDED.platform,
           updated_at = NOW()`,
    [input.token, input.userId, input.platform],
  );
}

export async function listPushTokens(
  db: Queryable,
  userId: string,
): Promise<Array<{ token: string; platform: string }>> {
  return many(
    db,
    `SELECT token, platform FROM device_push_tokens WHERE user_id = $1`,
    [userId],
  );
}

function mapRow(row: {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  read_at: Date | null;
  created_at: Date;
}): InboxRow {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    body: row.body,
    payload: row.payload ?? {},
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}
