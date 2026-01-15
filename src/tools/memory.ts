import { getDatabase } from '../database.js';

export interface MemoryEntry {
  id: number;
  key: string;
  content: string;
  tags: string | null;
  scope: string;
  source: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryWriteParams {
  key: string;
  content: string;
  tags?: string[];
  scope?: string;
  source?: string;
}

export interface MemorySearchParams {
  query: string;
  scope?: string;
  limit?: number;
}

export interface MemoryListParams {
  scope?: string;
  prefix?: string;
  limit?: number;
}

export function memoryWrite(params: MemoryWriteParams): { success: boolean; key: string } {
  const db = getDatabase();
  const { key, content, tags, scope = 'global', source = 'manual' } = params;
  const tagsJson = tags ? JSON.stringify(tags) : null;

  db.prepare(`
    INSERT INTO memory (key, content, tags, scope, source, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      content = excluded.content,
      tags = excluded.tags,
      scope = excluded.scope,
      source = excluded.source,
      updated_at = CURRENT_TIMESTAMP
  `).run(key, content, tagsJson, scope, source);

  return { success: true, key };
}

export function memoryRead(key: string): MemoryEntry | null {
  const db = getDatabase();
  const result = db.prepare('SELECT * FROM memory WHERE key = ?').get(key) as MemoryEntry | undefined;
  return result || null;
}

export function memorySearch(params: MemorySearchParams): MemoryEntry[] {
  const db = getDatabase();
  const { query, scope, limit = 20 } = params;

  let sql: string;
  let args: (string | number)[];

  if (scope) {
    sql = `
      SELECT m.* FROM memory m
      JOIN memory_fts fts ON m.id = fts.rowid
      WHERE memory_fts MATCH ? AND m.scope = ?
      ORDER BY rank
      LIMIT ?
    `;
    args = [query, scope, limit];
  } else {
    sql = `
      SELECT m.* FROM memory m
      JOIN memory_fts fts ON m.id = fts.rowid
      WHERE memory_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `;
    args = [query, limit];
  }

  return db.prepare(sql).all(...args) as MemoryEntry[];
}

export function memoryList(params: MemoryListParams = {}): MemoryEntry[] {
  const db = getDatabase();
  const { scope, prefix, limit = 100 } = params;

  let sql = 'SELECT * FROM memory WHERE 1=1';
  const args: (string | number)[] = [];

  if (scope) {
    sql += ' AND scope = ?';
    args.push(scope);
  }

  if (prefix) {
    sql += ' AND key LIKE ?';
    args.push(`${prefix}%`);
  }

  sql += ' ORDER BY updated_at DESC LIMIT ?';
  args.push(limit);

  return db.prepare(sql).all(...args) as MemoryEntry[];
}

export function memoryDelete(key: string): { success: boolean; deleted: boolean } {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM memory WHERE key = ?').run(key);
  return { success: true, deleted: result.changes > 0 };
}

export function memoryStats(): {
  total: number;
  byScope: Record<string, number>;
  bySource: Record<string, number>;
} {
  const db = getDatabase();

  const total = (db.prepare('SELECT COUNT(*) as count FROM memory').get() as { count: number }).count;

  const scopeResults = db.prepare('SELECT scope, COUNT(*) as count FROM memory GROUP BY scope').all() as { scope: string; count: number }[];
  const byScope: Record<string, number> = {};
  for (const row of scopeResults) {
    byScope[row.scope] = row.count;
  }

  const sourceResults = db.prepare('SELECT source, COUNT(*) as count FROM memory GROUP BY source').all() as { source: string; count: number }[];
  const bySource: Record<string, number> = {};
  for (const row of sourceResults) {
    bySource[row.source || 'unknown'] = row.count;
  }

  return { total, byScope, bySource };
}
