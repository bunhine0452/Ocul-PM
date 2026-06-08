-- 017: embedding model switched to a quantized multilingual model.
--   MultilingualE5Small (fp32, ~480MB)  →  ParaphraseMLMiniLML12V2Q (int8, ~135MB)
-- Both are 384-dim, so the vec0 schema (chunk_embeddings) is UNCHANGED — but the
-- stored vectors were produced by the old model and are incompatible with queries
-- from the new one. Clear the code index so the next auto-index rebuilds embeddings
-- with the new model.
--
-- Everything cleared here is derived / re-buildable. Deleting `chunks` fires the
-- existing AFTER-DELETE trigger that clears the matching `chunk_embeddings` (vec0)
-- rows; deleting `files` then cascades to `ast_dependencies` (ON DELETE CASCADE).
-- Journal, diff history and file snapshots do NOT reference `files`, so they are
-- left untouched. The next auto-index rebuilds everything with the new model.
DELETE FROM chunks;
DELETE FROM files;
