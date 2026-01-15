import { getDatabase } from '../database.js';

export interface ContextEntry {
  id: number;
  session_id: string;
  key: string;
  value: string;
  skill_name: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface ContextSetParams {
  session_id: string;
  key: string;
  value: unknown;
  skill_name?: string;
  expires_in_minutes?: number;
}

export interface ContextGetParams {
  session_id: string;
  key: string;
}

export function contextSet(params: ContextSetParams): { success: boolean; key: string } {
  const db = getDatabase();
  const { session_id, key, value, skill_name, expires_in_minutes } = params;

  const valueJson = JSON.stringify(value);
  const expiresAt = expires_in_minutes
    ? new Date(Date.now() + expires_in_minutes * 60 * 1000).toISOString()
    : null;

  db.prepare(`
    INSERT INTO context (session_id, key, value, skill_name, expires_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(session_id, key) DO UPDATE SET
      value = excluded.value,
      skill_name = excluded.skill_name,
      expires_at = excluded.expires_at
  `).run(session_id, key, valueJson, skill_name || null, expiresAt);

  return { success: true, key };
}

export function contextGet(params: ContextGetParams): { value: unknown } | null {
  const db = getDatabase();
  const { session_id, key } = params;

  // Clean up expired entries first
  db.prepare(`
    DELETE FROM context
    WHERE expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP
  `).run();

  const result = db.prepare(`
    SELECT value FROM context
    WHERE session_id = ? AND key = ?
  `).get(session_id, key) as { value: string } | undefined;

  if (!result) return null;

  try {
    return { value: JSON.parse(result.value) };
  } catch {
    return { value: result.value };
  }
}

export function contextList(session_id: string): ContextEntry[] {
  const db = getDatabase();

  // Clean up expired entries first
  db.prepare(`
    DELETE FROM context
    WHERE expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP
  `).run();

  return db.prepare(`
    SELECT * FROM context
    WHERE session_id = ?
    ORDER BY created_at DESC
  `).all(session_id) as ContextEntry[];
}

export function contextClear(session_id?: string): { success: boolean; cleared: number } {
  const db = getDatabase();

  let result;
  if (session_id) {
    result = db.prepare('DELETE FROM context WHERE session_id = ?').run(session_id);
  } else {
    result = db.prepare('DELETE FROM context').run();
  }

  return { success: true, cleared: result.changes };
}

export function contextShare(params: {
  from_session: string;
  to_session: string;
  keys?: string[];
}): { success: boolean; shared: number } {
  const db = getDatabase();
  const { from_session, to_session, keys } = params;

  let entries: ContextEntry[];
  if (keys && keys.length > 0) {
    const placeholders = keys.map(() => '?').join(',');
    entries = db.prepare(`
      SELECT * FROM context
      WHERE session_id = ? AND key IN (${placeholders})
    `).all(from_session, ...keys) as ContextEntry[];
  } else {
    entries = db.prepare(`
      SELECT * FROM context WHERE session_id = ?
    `).all(from_session) as ContextEntry[];
  }

  for (const entry of entries) {
    db.prepare(`
      INSERT INTO context (session_id, key, value, skill_name, expires_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(session_id, key) DO UPDATE SET
        value = excluded.value,
        skill_name = excluded.skill_name,
        expires_at = excluded.expires_at
    `).run(to_session, entry.key, entry.value, entry.skill_name, entry.expires_at);
  }

  return { success: true, shared: entries.length };
}
