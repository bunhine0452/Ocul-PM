-- 011: Greenfield wizard draft storage (MASTER-GUIDE §4.4 / §8.2)
--
-- Stores in-progress wizard state so the user can close mid-way and
-- resume later from the StartScreen.

CREATE TABLE IF NOT EXISTS project_blueprints (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL DEFAULT '',
  idea_text   TEXT,                            -- Step 0: 자유 텍스트 아이디어
  target_users TEXT,                           -- Step 1: 주 사용자
  stack_choice TEXT,                           -- Step 2: JSON {"framework":"vite","language":"typescript",...}
  folder_name  TEXT,                           -- Step 3: 프로젝트 이름
  folder_path  TEXT,                           -- Step 3: 부모 경로
  seed_goals_json TEXT,                        -- Step 4: JSON [{"title":"...","description":"...","priority":1}]
  wizard_step  INTEGER NOT NULL DEFAULT 0,     -- 마지막 진행 단계 (0-4)
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
