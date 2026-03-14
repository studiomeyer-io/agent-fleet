-- Agent Fleet — Optional PostgreSQL Schema
-- Only needed if you want to persist reports to a database.
-- Reports are always saved to files in reports/ regardless.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS agent_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_type VARCHAR(50) NOT NULL,
  topic TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,
  sources TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  project VARCHAR(255),
  parent_report_id UUID REFERENCES agent_reports(id),
  tags TEXT[] DEFAULT '{}',
  quality NUMERIC(3,1),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_discussions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id UUID NOT NULL REFERENCES agent_reports(id),
  agent_type VARCHAR(50) NOT NULL,
  position VARCHAR(20) NOT NULL CHECK (position IN ('agree', 'disagree', 'extend', 'question', 'synthesize')),
  content TEXT NOT NULL,
  referenced_report_ids UUID[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_agent_type ON agent_reports(agent_type);
CREATE INDEX IF NOT EXISTS idx_reports_created ON agent_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_project ON agent_reports(project);
CREATE INDEX IF NOT EXISTS idx_discussions_report ON agent_discussions(report_id);
