-- Migration 020 (PR-GR3): caller granularity for relations. `from_symbol` is
-- the enclosing symbol the reference occurs in (the *caller*; NULL = file
-- top-level), resolved from byte ranges at extraction. Enables symbol-level
-- call lists ("which function calls which"). Added as a column (019 already
-- shipped) — existing rows get NULL and refill on the next index.
ALTER TABLE symbol_relations ADD COLUMN from_symbol TEXT;
