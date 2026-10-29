---
schema_version: 1
type: chore
slug: "title-40-and-harness-measure"
status: done
difficulty: low
created_at: "2026-10-29T23:29:16+09:00"
session_id: "20261029-015"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/mcp/tools/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/agents/templates/journal_spec_ko.md.tpl"
    op: update
  - path: "src-tauri/src/oculpm/agents/templates/journal_spec_en.md.tpl"
    op: update
  - path: "plugin/oculpm/skills/oculpm-journal/SKILL.md"
    op: update
related: []
tags:
  - "ui-audit"
  - "agents"
  - "mcp-tool"
---
[x] 제목 40자 규칙 · 화면 검사 전후 실측(하네스 일지 48건)

## 한 일

- **제목 40자 (#title-40)** — 긴 제목은 화면 쪽 말줄임으로 뜻을 잃었다(일지 목록 · 오늘 · 계획의 한 줄). 그래서 같은 규칙을 세 곳에 넣었다.
  - MCP 도구 설명: `journal_write.title`, `plan_create.title`, 항목 `text` — 「40자 안, 한 줄에 들어가게, 자세한 것은 본문에」.
  - 앱이 관리하는 `journal-spec`(ko · en): 일지 첫 줄 제목, 계획 항목 줄.
  - 플러그인 `oculpm-journal` 스킬: 같은 문장.
- **전후 실측 (#harness-diff)** — 하네스(앱 통째, 이 저장소의 일지 48건 · 계획 4개, 1440×900)에서 잰 값이다.
  - 오늘 첫 장의 단추(`.btn`)는 4개다: 출력 보기 · 변경 보기 · 모두 읽음 · 터미널에서 실행. 검사 전에는 10개였다.
  - 딱지는 2개다(실패 · 일지 없는 변경). 검사 전에는 9개였다.
  - 화면에 보이는 합계는 서로 맞는다.
    - 먼저 볼 것 「2」 = 줄 2개
    - 검증 없이 끝난 일지 「4」 = 줄 4개
    - 오늘 한 일 「48」 = 계획 밖 48건
    - 윗줄 변경 「3」 = 「3개 파일」
  - 12px 아래 글자(배지 · 단축키 제외)는 오늘 · 일지 · 계획 · 변경 · 설정 · 터미널 여섯 화면 모두 0 이다.

## 검증

- 하네스 측정 스크립트(보이는 글자 요소의 계산된 font-size < 12, `.chip.sm · kbd · .kbd · .tbadge · .nav-badge` 안쪽 제외)의 결과는 화면마다 「under12 non-badge 0」이었다. 오늘 화면은 `.btn` 4 · `.chip` 2 였다.
- `cargo fmt --check && cargo clippy -D warnings && cargo test --locked` → exit 0, 1146 passed(plugin_manifest 11 · agents 24 포함).