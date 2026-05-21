-- G1: Changelog 자동화 데이터 모델 (MASTER-GUIDE §4.1)
-- 일별 Changelog 엔트리: 사용자의 한 번의 "수정 세션" = 한 개의 entry

CREATE TABLE IF NOT EXISTS changelog_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- 사용자가 최초로 입력한 한국어 요청 (예: "로그인 페이지에 소셜 로그인 추가")
  user_intent TEXT,
  -- generate_edit_prompt 가 만들어낸 영어 프롬프트 원본 (감사 추적용)
  prompt_text TEXT,
  -- LLM이 변경된 코드를 보고 작성한 자연어 요약 (Markdown 허용)
  ai_summary TEXT NOT NULL,
  -- 사용자가 직접 수정 가능한 한 줄 제목 (없으면 ai_summary 첫 문장 자동 사용)
  title TEXT,
  -- 사용자 분류 라벨 (feature/fix/refactor/docs/test/chore)
  category TEXT,
  -- 외부 LLM 도구 (claude-code, cursor, gemini-cli 등) 식별자 (선택)
  external_tool TEXT,
  -- 변경 규모 통계
  files_changed INTEGER NOT NULL DEFAULT 0,
  lines_added   INTEGER NOT NULL DEFAULT 0,
  lines_removed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  -- 사용자가 별표로 마킹한 중요 엔트리
  pinned INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_changelog_project_date
  ON changelog_entries(project_id, created_at);

-- 엔트리에 속한 개별 파일 변경 (기존 file_changes를 entry에 묶음)
CREATE TABLE IF NOT EXISTS changelog_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES changelog_entries(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('created','modified','deleted','renamed')),
  -- 통계
  lines_added INTEGER NOT NULL DEFAULT 0,
  lines_removed INTEGER NOT NULL DEFAULT 0,
  -- 정규화된 unified-diff (압축 저장 권장; 큰 파일은 head/tail만)
  diff_patch TEXT,
  -- 파일별 LLM 한 줄 요약 (예: "AuthContext에 OAuthProvider 인터페이스 추가")
  per_file_summary TEXT,
  old_hash TEXT,
  new_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_changelog_files_entry
  ON changelog_files(entry_id);

-- 기존 file_changes는 "raw event"로 유지하되, entry_id 외래키를 추가하여
-- 그룹핑 가능하도록 확장
ALTER TABLE file_changes ADD COLUMN entry_id INTEGER
  REFERENCES changelog_entries(id) ON DELETE SET NULL;
