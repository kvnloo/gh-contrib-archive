CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contributions (
  id TEXT PRIMARY KEY,
  github_node_id TEXT UNIQUE,
  type TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  html_url TEXT NOT NULL,
  repo TEXT,
  number INTEGER,
  title TEXT,
  excerpt TEXT,
  body_chars INTEGER NOT NULL DEFAULT 0,
  state TEXT,
  visibility TEXT NOT NULL DEFAULT 'unknown',
  created_at TEXT NOT NULL,
  updated_at TEXT,
  ingested_at TEXT NOT NULL,
  extra_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_contrib_type ON contributions(type);
CREATE INDEX IF NOT EXISTS idx_contrib_created ON contributions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contrib_repo ON contributions(repo);

CREATE TABLE IF NOT EXISTS flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contribution_id TEXT NOT NULL,
  code TEXT NOT NULL,
  severity TEXT NOT NULL,
  detail TEXT NOT NULL,
  UNIQUE(contribution_id, code),
  FOREIGN KEY (contribution_id) REFERENCES contributions(id)
);

CREATE INDEX IF NOT EXISTS idx_flags_code ON flags(code);
CREATE INDEX IF NOT EXISTS idx_flags_severity ON flags(severity);

CREATE TABLE IF NOT EXISTS commit_buckets (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL,
  repo TEXT,
  visibility TEXT NOT NULL,
  commit_count INTEGER NOT NULL,
  html_url TEXT
);
