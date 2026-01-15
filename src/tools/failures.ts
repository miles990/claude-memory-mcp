import { getDatabase } from '../database.js';

export interface Failure {
  id: number;
  error_pattern: string;
  error_message: string | null;
  solution: string | null;
  skill_name: string | null;
  project_path: string | null;
  occurrence_count: number;
  last_seen_at: string;
  created_at: string;
}

export interface FailureRecordParams {
  error_pattern: string;
  error_message?: string;
  solution?: string;
  skill_name?: string;
  project_path?: string;
}

export interface FailureSearchParams {
  query: string;
  limit?: number;
}

export function failureRecord(params: FailureRecordParams): { success: boolean; failure: Failure } {
  const db = getDatabase();
  const { error_pattern, error_message, solution, skill_name, project_path } = params;

  // Check if similar pattern exists
  const existing = db.prepare(`
    SELECT id FROM failures WHERE error_pattern = ?
  `).get(error_pattern) as { id: number } | undefined;

  if (existing) {
    // Update existing record
    db.prepare(`
      UPDATE failures
      SET occurrence_count = occurrence_count + 1,
          last_seen_at = CURRENT_TIMESTAMP,
          solution = COALESCE(?, solution),
          error_message = COALESCE(?, error_message)
      WHERE id = ?
    `).run(solution || null, error_message || null, existing.id);
  } else {
    // Insert new record
    db.prepare(`
      INSERT INTO failures (error_pattern, error_message, solution, skill_name, project_path)
      VALUES (?, ?, ?, ?, ?)
    `).run(error_pattern, error_message || null, solution || null, skill_name || null, project_path || null);
  }

  const failure = db.prepare(`
    SELECT * FROM failures WHERE error_pattern = ?
  `).get(error_pattern) as Failure;

  return { success: true, failure };
}

export function failureSearch(params: FailureSearchParams): Failure[] {
  const db = getDatabase();
  const { query, limit = 10 } = params;

  // Use FTS5 for full-text search
  return db.prepare(`
    SELECT f.* FROM failures f
    JOIN failures_fts fts ON f.id = fts.rowid
    WHERE failures_fts MATCH ?
    ORDER BY f.occurrence_count DESC, rank
    LIMIT ?
  `).all(query, limit) as Failure[];
}

export function failureGet(id: number): Failure | null {
  const db = getDatabase();
  const result = db.prepare('SELECT * FROM failures WHERE id = ?').get(id) as Failure | undefined;
  return result || null;
}

export function failureList(params: {
  skill_name?: string;
  limit?: number;
} = {}): Failure[] {
  const db = getDatabase();
  const { skill_name, limit = 50 } = params;

  if (skill_name) {
    return db.prepare(`
      SELECT * FROM failures
      WHERE skill_name = ?
      ORDER BY occurrence_count DESC, last_seen_at DESC
      LIMIT ?
    `).all(skill_name, limit) as Failure[];
  }

  return db.prepare(`
    SELECT * FROM failures
    ORDER BY occurrence_count DESC, last_seen_at DESC
    LIMIT ?
  `).all(limit) as Failure[];
}

export function failureUpdate(id: number, solution: string): { success: boolean } {
  const db = getDatabase();
  db.prepare(`
    UPDATE failures SET solution = ? WHERE id = ?
  `).run(solution, id);
  return { success: true };
}

export function failureDelete(id: number): { success: boolean; deleted: boolean } {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM failures WHERE id = ?').run(id);
  return { success: true, deleted: result.changes > 0 };
}

export function failureStats(): {
  total: number;
  with_solution: number;
  most_common: Failure | null;
  by_skill: Record<string, number>;
} {
  const db = getDatabase();

  const total = (db.prepare('SELECT COUNT(*) as count FROM failures').get() as { count: number }).count;
  const withSolution = (db.prepare('SELECT COUNT(*) as count FROM failures WHERE solution IS NOT NULL').get() as { count: number }).count;

  const mostCommon = db.prepare(`
    SELECT * FROM failures ORDER BY occurrence_count DESC LIMIT 1
  `).get() as Failure | undefined;

  const bySkillResults = db.prepare(`
    SELECT skill_name, COUNT(*) as count
    FROM failures
    WHERE skill_name IS NOT NULL
    GROUP BY skill_name
  `).all() as Array<{ skill_name: string; count: number }>;

  const bySkill: Record<string, number> = {};
  for (const row of bySkillResults) {
    bySkill[row.skill_name] = row.count;
  }

  return {
    total,
    with_solution: withSolution,
    most_common: mostCommon || null,
    by_skill: bySkill,
  };
}
