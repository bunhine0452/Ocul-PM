-- G2: 프로젝트 개요 자동 생성 (MASTER-GUIDE §4.2)
-- 인덱싱 직후 LLM이 작성하는 자연어 README-급 요약을 보존한다.
-- 사용자가 직접 편집하면 source_signature 와 generated_at 은 NULL 로 두어
-- "수동 편집 보호" 신호로 활용한다.

CREATE TABLE IF NOT EXISTS project_overviews (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  -- 한 줄 정체성 ("코드를 직접 수정하지 않고 …")
  identity TEXT,
  -- {"framework":"Tauri 2","languages":["Rust","TypeScript"], "package_manager":"pnpm", ...}
  stack_json TEXT,
  -- 마크다운 본문 (디렉터리 가이드/진입점/특이사항 포함)
  overview_md TEXT,
  -- 입력 신호 해시 (README + package.json + Cargo.toml + 언어 분포 등)
  -- 같은 시그니처면 재생성 스킵.
  source_signature TEXT,
  generated_at INTEGER,
  generated_by_model TEXT
);
