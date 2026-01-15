import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { mkdirSync, existsSync } from 'fs';

const DB_PATH = join(homedir(), '.claude', 'claude.db');

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!db) {
    // Ensure directory exists
    const dir = dirname(DB_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initializeSchema(db);
  }
  return db;
}

function initializeSchema(db: Database.Database): void {
  db.exec(`
    -- Memory table (knowledge base)
    CREATE TABLE IF NOT EXISTS memory (
      id INTEGER PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      content TEXT NOT NULL,
      tags TEXT,
      scope TEXT DEFAULT 'global',
      source TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Skills table (replaces .skillpkg/state.json)
    CREATE TABLE IF NOT EXISTS skills (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      version TEXT NOT NULL,
      source TEXT NOT NULL,
      project_path TEXT,
      installed_by TEXT,
      installed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_used_at DATETIME,
      use_count INTEGER DEFAULT 0
    );

    -- Skill Usage table (effectiveness tracking)
    CREATE TABLE IF NOT EXISTS skill_usage (
      id INTEGER PRIMARY KEY,
      skill_name TEXT NOT NULL,
      project_path TEXT,
      started_at DATETIME,
      completed_at DATETIME,
      success BOOLEAN,
      outcome TEXT,
      tokens_used INTEGER,
      notes TEXT,
      FOREIGN KEY (skill_name) REFERENCES skills(name)
    );

    -- Failures table (shared failure experiences)
    CREATE TABLE IF NOT EXISTS failures (
      id INTEGER PRIMARY KEY,
      error_pattern TEXT NOT NULL,
      error_message TEXT,
      solution TEXT,
      skill_name TEXT,
      project_path TEXT,
      occurrence_count INTEGER DEFAULT 1,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Context table (cross-skill state)
    CREATE TABLE IF NOT EXISTS context (
      id INTEGER PRIMARY KEY,
      session_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      skill_name TEXT,
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(session_id, key)
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_memory_scope ON memory(scope);
    CREATE INDEX IF NOT EXISTS idx_memory_source ON memory(source);
    CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);
    CREATE INDEX IF NOT EXISTS idx_skill_usage_skill ON skill_usage(skill_name);
    CREATE INDEX IF NOT EXISTS idx_failures_pattern ON failures(error_pattern);
    CREATE INDEX IF NOT EXISTS idx_context_session ON context(session_id);

    -- FTS5 tables for full-text search
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      key,
      content,
      tags,
      content='memory',
      content_rowid='id'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS failures_fts USING fts5(
      error_pattern,
      error_message,
      solution,
      content='failures',
      content_rowid='id'
    );

    -- Triggers to keep FTS in sync
    CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory BEGIN
      INSERT INTO memory_fts(rowid, key, content, tags)
      VALUES (new.id, new.key, new.content, new.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory BEGIN
      INSERT INTO memory_fts(memory_fts, rowid, key, content, tags)
      VALUES ('delete', old.id, old.key, old.content, old.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON memory BEGIN
      INSERT INTO memory_fts(memory_fts, rowid, key, content, tags)
      VALUES ('delete', old.id, old.key, old.content, old.tags);
      INSERT INTO memory_fts(rowid, key, content, tags)
      VALUES (new.id, new.key, new.content, new.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS failures_ai AFTER INSERT ON failures BEGIN
      INSERT INTO failures_fts(rowid, error_pattern, error_message, solution)
      VALUES (new.id, new.error_pattern, new.error_message, new.solution);
    END;

    CREATE TRIGGER IF NOT EXISTS failures_ad AFTER DELETE ON failures BEGIN
      INSERT INTO failures_fts(failures_fts, rowid, error_pattern, error_message, solution)
      VALUES ('delete', old.id, old.error_pattern, old.error_message, old.solution);
    END;

    CREATE TRIGGER IF NOT EXISTS failures_au AFTER UPDATE ON failures BEGIN
      INSERT INTO failures_fts(failures_fts, rowid, error_pattern, error_message, solution)
      VALUES ('delete', old.id, old.error_pattern, old.error_message, old.solution);
      INSERT INTO failures_fts(rowid, error_pattern, error_message, solution)
      VALUES (new.id, new.error_pattern, new.error_message, new.solution);
    END;
  `);
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
