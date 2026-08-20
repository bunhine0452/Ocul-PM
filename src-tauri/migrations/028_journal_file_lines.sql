-- Per-file line churn (Today 히어로의 「라인 변화」) for the journal cache.
--
-- `bytes_added`/`bytes_removed` next to these are the *frontmatter-recorded*
-- values — an agent has to type them by hand, and none of the write paths
-- (MCP `journal_write` included) fill them, so they have been NULL for every
-- entry since the MCP server shipped. These two columns are instead **derived**
-- from the durable entry-diff sidecar (`.oculpm/index/diffs/*.json`): the +/-
-- lines of the patch actually recorded for the entry.
--
-- Lossy cache columns like the rest of oculpm_journal_files — the entry upsert
-- deletes and re-inserts its file rows, so these go back to NULL on reindex and
-- are refilled from the sidecar by the backfill sweep. NULL = "no recorded diff
-- (yet)", which the workday SUM treats as 0.
ALTER TABLE oculpm_journal_files ADD COLUMN lines_added INTEGER;
ALTER TABLE oculpm_journal_files ADD COLUMN lines_removed INTEGER;
