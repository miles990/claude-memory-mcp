import { getDatabase } from '../database.js';

export interface Skill {
  id: number;
  name: string;
  version: string;
  source: string;
  project_path: string | null;
  installed_by: string | null;
  installed_at: string;
  last_used_at: string | null;
  use_count: number;
}

export interface SkillUsage {
  id: number;
  skill_name: string;
  project_path: string | null;
  started_at: string | null;
  completed_at: string | null;
  success: boolean | null;
  outcome: string | null;
  tokens_used: number | null;
  notes: string | null;
}

export interface SkillRegisterParams {
  name: string;
  version: string;
  source: string;
  project_path?: string;
  installed_by?: string;
}

export interface SkillUsageStartParams {
  skill_name: string;
  project_path?: string;
}

export interface SkillUsageEndParams {
  usage_id: number;
  success: boolean;
  outcome?: string;
  tokens_used?: number;
  notes?: string;
}

export function skillRegister(params: SkillRegisterParams): { success: boolean; skill: Skill } {
  const db = getDatabase();
  const { name, version, source, project_path, installed_by } = params;

  db.prepare(`
    INSERT INTO skills (name, version, source, project_path, installed_by)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      version = excluded.version,
      source = excluded.source,
      project_path = excluded.project_path
  `).run(name, version, source, project_path || null, installed_by || null);

  const skill = db.prepare('SELECT * FROM skills WHERE name = ?').get(name) as Skill;
  return { success: true, skill };
}

export function skillGet(name: string): Skill | null {
  const db = getDatabase();
  const result = db.prepare('SELECT * FROM skills WHERE name = ?').get(name) as Skill | undefined;
  return result || null;
}

export function skillList(project_path?: string): Skill[] {
  const db = getDatabase();

  if (project_path) {
    return db.prepare(`
      SELECT * FROM skills
      WHERE project_path = ? OR project_path IS NULL
      ORDER BY use_count DESC, name
    `).all(project_path) as Skill[];
  }

  return db.prepare('SELECT * FROM skills ORDER BY use_count DESC, name').all() as Skill[];
}

export function skillUsageStart(params: SkillUsageStartParams): { success: boolean; usage_id: number } {
  const db = getDatabase();
  const { skill_name, project_path } = params;

  const result = db.prepare(`
    INSERT INTO skill_usage (skill_name, project_path, started_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `).run(skill_name, project_path || null);

  // Update last_used_at
  db.prepare(`
    UPDATE skills SET last_used_at = CURRENT_TIMESTAMP
    WHERE name = ?
  `).run(skill_name);

  return { success: true, usage_id: Number(result.lastInsertRowid) };
}

export function skillUsageEnd(params: SkillUsageEndParams): { success: boolean } {
  const db = getDatabase();
  const { usage_id, success, outcome, tokens_used, notes } = params;

  db.prepare(`
    UPDATE skill_usage
    SET completed_at = CURRENT_TIMESTAMP,
        success = ?,
        outcome = ?,
        tokens_used = ?,
        notes = ?
    WHERE id = ?
  `).run(success ? 1 : 0, outcome || null, tokens_used || null, notes || null, usage_id);

  // Get skill name and update use_count
  const usage = db.prepare('SELECT skill_name FROM skill_usage WHERE id = ?').get(usage_id) as { skill_name: string } | undefined;
  if (usage) {
    db.prepare(`
      UPDATE skills SET use_count = use_count + 1
      WHERE name = ?
    `).run(usage.skill_name);
  }

  return { success: true };
}

export function skillRecommend(params: {
  project_type?: string;
  limit?: number;
}): Array<{
  skill: Skill;
  success_rate: number;
  usage_count: number;
}> {
  const db = getDatabase();
  const { project_type, limit = 5 } = params;

  let sql: string;
  let args: (string | number)[];

  if (project_type) {
    sql = `
      SELECT
        s.*,
        COALESCE(AVG(CASE WHEN u.success THEN 1.0 ELSE 0.0 END), 0) as success_rate,
        COUNT(u.id) as usage_count
      FROM skills s
      LEFT JOIN skill_usage u ON s.name = u.skill_name
      WHERE u.project_path LIKE ?
      GROUP BY s.id
      HAVING usage_count > 0
      ORDER BY success_rate DESC, usage_count DESC
      LIMIT ?
    `;
    args = [`%${project_type}%`, limit];
  } else {
    sql = `
      SELECT
        s.*,
        COALESCE(AVG(CASE WHEN u.success THEN 1.0 ELSE 0.0 END), 0) as success_rate,
        COUNT(u.id) as usage_count
      FROM skills s
      LEFT JOIN skill_usage u ON s.name = u.skill_name
      GROUP BY s.id
      ORDER BY success_rate DESC, usage_count DESC
      LIMIT ?
    `;
    args = [limit];
  }

  const results = db.prepare(sql).all(...args) as Array<Skill & { success_rate: number; usage_count: number }>;

  return results.map((row) => ({
    skill: {
      id: row.id,
      name: row.name,
      version: row.version,
      source: row.source,
      project_path: row.project_path,
      installed_by: row.installed_by,
      installed_at: row.installed_at,
      last_used_at: row.last_used_at,
      use_count: row.use_count,
    },
    success_rate: row.success_rate,
    usage_count: row.usage_count,
  }));
}

export function skillStats(): {
  total_skills: number;
  total_usages: number;
  success_rate: number;
  most_used: Skill | null;
} {
  const db = getDatabase();

  const totalSkills = (db.prepare('SELECT COUNT(*) as count FROM skills').get() as { count: number }).count;
  const totalUsages = (db.prepare('SELECT COUNT(*) as count FROM skill_usage').get() as { count: number }).count;

  const successResult = db.prepare(`
    SELECT AVG(CASE WHEN success THEN 1.0 ELSE 0.0 END) as rate
    FROM skill_usage
    WHERE success IS NOT NULL
  `).get() as { rate: number | null };

  const mostUsed = db.prepare(`
    SELECT * FROM skills ORDER BY use_count DESC LIMIT 1
  `).get() as Skill | undefined;

  return {
    total_skills: totalSkills,
    total_usages: totalUsages,
    success_rate: successResult.rate || 0,
    most_used: mostUsed || null,
  };
}
