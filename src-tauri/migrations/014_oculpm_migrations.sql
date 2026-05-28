-- W5-PR7: Migration history + safety record for "legacy SQLite changelog
-- deletion". One row per successful `oculpm_migrate_from_sqlite` run; the
-- `legacy_deleted_at` column gates the destructive delete command.
--
-- See docs/major_update/oculpm/W5/PR7-legacy-delete.md.

CREATE TABLE IF NOT EXISTS oculpm_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- Unix epoch (seconds) of the MigrationReport.completed_at — the
  -- `confirm_token` half that lets the deletion command verify identity.
  report_timestamp INTEGER NOT NULL,
  source_entry_count INTEGER NOT NULL,
  success_count INTEGER NOT NULL,
  skip_count INTEGER NOT NULL,
  failure_count INTEGER NOT NULL,
  -- Basename only, e.g. `.oculpm.backup-pre-migration-20260601T120000Z`.
  backup_dir TEXT NOT NULL,
  -- Full MigrationReport JSON for forensics / re-display.
  report_json TEXT NOT NULL,
  -- Set when the user runs `oculpm_delete_legacy_changelog` against this
  -- history row. NULL = not yet deleted.
  legacy_deleted_at INTEGER,
  legacy_delete_backup_dir TEXT
);

CREATE INDEX IF NOT EXISTS idx_oculpm_migrations_project
  ON oculpm_migrations(project_id, report_timestamp);
