---
schema_version: 1
type: chore
slug: "outside-copy-users-words"
status: done
difficulty: medium
created_at: "2026-11-23T21:25:43+09:00"
session_id: "20261123-001"
agent:
  id: "claude-code"
  version: "Sonnet 5.5"
  session: "9db3a5f7-812f-4644-aa3a-8b45252c03a5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "README.en.md"
    op: update
  - path: "README.md"
    op: update
  - path: "docs/PROMISE.md"
    op: update
  - path: "landing/en/index.html"
    op: update
  - path: "landing/en/plugin.html"
    op: update
  - path: "landing/index.html"
    op: update
  - path: "landing/plugin.html"
    op: update
  - path: "landing/wiki-src/agents.md"
    op: update
  - path: "landing/wiki-src/claude-code.md"
    op: update
  - path: "landing/wiki-src/data.md"
    op: update
  - path: "landing/wiki-src/faq.md"
    op: update
  - path: "landing/wiki-src/getting-started.md"
    op: update
  - path: "landing/wiki-src/index.md"
    op: update
  - path: "landing/wiki-src/journal.md"
    op: update
  - path: "landing/wiki-src/planner.md"
    op: update
  - path: "landing/wiki-src/screens.md"
    op: update
  - path: "landing/wiki-src/settings.md"
    op: update
  - path: "landing/wiki-src/today.md"
    op: update
  - path: "landing/wiki-src/troubleshooting.md"
    op: update
  - path: "landing/wiki-src/en/agents.md"
    op: update
  - path: "landing/wiki-src/en/claude-code.md"
    op: update
  - path: "landing/wiki-src/en/data.md"
    op: update
  - path: "landing/wiki-src/en/faq.md"
    op: update
  - path: "landing/wiki-src/en/getting-started.md"
    op: update
  - path: "landing/wiki-src/en/index.md"
    op: update
  - path: "landing/wiki-src/en/journal.md"
    op: update
  - path: "landing/wiki-src/en/planner.md"
    op: update
  - path: "landing/wiki-src/en/screens.md"
    op: update
  - path: "landing/wiki-src/en/settings.md"
    op: update
  - path: "landing/wiki-src/en/today.md"
    op: update
  - path: "landing/wiki-src/en/troubleshooting.md"
    op: update
  - path: "plugin/oculpm-codex/skills/oculpm-codex/SKILL.md"
    op: update
  - path: "plugin/oculpm-codex/skills/redteam/SKILL.md"
    op: update
  - path: "plugin/oculpm/skills/oculpm-journal/SKILL.md"
    op: update
  - path: "plugin/oculpm/skills/redteam/SKILL.md"
    op: update
  - path: "src-tauri/tests/plugin_skill_copy.rs"
    op: create
related: []
tags:
  - "문서"
  - "love-round"
  - "landing"
  - "mcp-tool"
---
[x] 문서: README · 랜딩을 사람의 말로 고친다

디자인팀 바깥 문구 레인.

- README ko/en 시작 안내를 실제 순서로: 앱에서 기록 켜기 → 플러그인 두 줄 → Claude 재시작, 필요한 것 세 줄, 「일지가 안 오면」 체크리스트. 지금 구조에서 거짓인 「앱 없이도 시작」 을 걷었다(최종 검수 F3 가 확장의 같은 안내도 맞춤).
- 바깥 문구의 「판정/verdict」 를 확인 결과 · Last result 로(#jargon). 다섯 화면을 앱 탭과 같게(오늘 · 작업 일지 · 계획 · 변경 · 터미널, 설정은 ⌘,). 히어로 부제를 상황과 결과로.
- 스킬 description 을 사용자의 말 + 트리거 중심으로(next · inception · redteam), help 는 직접 부를 때만. Codex 사본은 원문에서 다시 렌더.
- README · 랜딩 · 위키에 이번 라운드 새 기능 한 줄씩. 위키는 build.mjs 로 다시 구웠다(생성물은 원본에서).

## 검증
로컬 `plugin_manifest` 11 · `plugin_codex_skills` 4 · `plugin_skill_copy` 2 passed, vitest landing_pages 초록. 최종 검수 F3 가 G3 의 새 이름(Journal · 다른 기기에서 온 일지 · 업데이트)에 맞춰 위키 · README · 랜딩의 옛 이름을 고쳤다.