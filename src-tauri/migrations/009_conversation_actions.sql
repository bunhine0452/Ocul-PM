-- UI-5 (W5): persist Chat ActionProposalCard apply-state in SQLite instead of
-- localStorage. The old keys looked like `action_${convId}_${i}` with the
-- literal value "applied"; we store the same semantic (one row per
-- conv+message-index) and gain referential integrity (CASCADE on conversation
-- delete) + future-proofing (status enum, applied_at).

CREATE TABLE IF NOT EXISTS conversation_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  -- Index of the assistant message inside its conversation (0-based).
  message_index INTEGER NOT NULL,
  -- Reserved enum for future "dismissed", "errored" states. Defaults to
  -- "applied" because that's the only state the localStorage version tracked.
  status TEXT NOT NULL CHECK(status IN ('applied','dismissed','errored')) DEFAULT 'applied',
  applied_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(conversation_id, message_index)
);

CREATE INDEX IF NOT EXISTS idx_conv_actions_conv
  ON conversation_actions(conversation_id);
