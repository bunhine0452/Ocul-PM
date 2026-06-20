-- Add agent.version (the model name, e.g. "Opus 4.8" / "Gemini 3 Pro") to the
-- journal cache so the UI can show "Claude Code · Opus 4.8" on each entry.
--
-- Lossy cache column, like the rest of oculpm_journal: backfilled from the
-- on-disk frontmatter `agent.version` on reindex. Nullable — older entries and
-- agents that don't report a model leave it NULL and the UI shows just the
-- agent label.
ALTER TABLE oculpm_journal ADD COLUMN agent_version TEXT;
