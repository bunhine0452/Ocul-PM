-- F7a-B 후속: 캐시 행에 적용된 frontmatter 보정(coercion) 버전.
--
-- 보정 로직(tz 오프셋 backfill·slug 정규화)이 바뀌면 코드의 COERCION_VERSION 을
-- 올린다. 증분 인덱싱은 mtime 이 같아도 stale 버전 행을 1회 재투영해 재보정한 뒤
-- 현재 버전으로 도장을 찍는다(이후엔 다시 skip). 기본 0 = 보정 메커니즘 이전 행
-- → 다음 증분 인덱싱에서 한 번 재보정된다.
ALTER TABLE oculpm_journal ADD COLUMN coercion_version INTEGER NOT NULL DEFAULT 0;
