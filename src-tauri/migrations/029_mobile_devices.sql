-- 모바일 브리지 — 페어링된 기기 (.oculpm/planner/mobile-bridge.md #mb0-pairing).
--
-- 토큰은 blake3 해시로만 저장한다 — 평문·복호화 가능 형태 금지 (플랜 D5 ②).
-- 페어링 코드(6자리·TTL 5분·1회용)는 메모리에만 살고 여기 남지 않는다.
CREATE TABLE IF NOT EXISTS mobile_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT '',
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_seen_at TEXT
);
