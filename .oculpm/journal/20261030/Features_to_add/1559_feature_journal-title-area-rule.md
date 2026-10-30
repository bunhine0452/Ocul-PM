---
schema_version: 1
type: feature
slug: "journal-title-area-rule"
status: done
difficulty: medium
created_at: "2026-10-30T15:59:28+09:00"
session_id: "20261030-005"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/mcp/tools/title.rs"
    op: create
  - path: "src-tauri/src/oculpm/mcp/tools/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/tests/title.rs"
    op: create
  - path: "src-tauri/src/oculpm/agents/templates/journal_spec_ko.md.tpl"
    op: update
  - path: "src-tauri/src/oculpm/agents/templates/journal_spec_en.md.tpl"
    op: update
  - path: "plugin/oculpm/skills/oculpm-journal/SKILL.md"
    op: update
  - path: "landing/wiki-src/journal.md"
    op: update
  - path: "CHANGELOG.md"
    op: update
related: []
tags:
  - "mcp"
  - "journal"
  - "spec"
  - "mcp-tool"
---
[x] MCP: 일지 제목을 영역 형식으로 강제

## 추가 기능

사용자 요청: 「작업 일지에 제목 또는 분류를 더욱 세분화하고 정형화해서 지키게」. 사용자가 고른 것:
- 종류 다섯은 그대로, 「영역」 필수
- 제목은 「영역: 무엇을 했다」 40자 안
- 형식이 아니면 기록 도구가 거절

실측: 이 저장소 일지 934건 중 47%(439)가 「40자 안」 안내를 넘었다. 절반(463)은 줄표로 두 문장을 이었고, 영역을 앞에 쓴 것은 4건뿐이었다. 안내만으로는 지켜지지 않았다.

## 동작 흐름

- `journal_write` 가 새 `mcp/tools/title.rs` 의 `checked_title` 를 먼저 부른다.
  - 영역은 제목 앞 `영역: ` 으로 쓰거나 `area` 인자로 준다. 둘 다 주면 같아야 한다.
  - 영역은 1~12자이고 콜론을 쓸 수 없다.
  - 영역을 포함한 제목 전체가 40자 안이어야 한다. 줄표(— –)는 받지 않는다.
- 어긋나면 일지를 쓰지 않고 거절 문구를 돌려준다. 문구에는 무엇이 틀렸는지, 예시, 이 프로젝트가 이미 쓰는 영역이 들어간다. 영역은 최근 300건에서 많이 쓴 순으로 8개까지 싣는다. 에이전트는 그 문구대로 고쳐 다시 부른다.
- 영어 프로젝트(`agents.template_language = "en"`)는 문구도 영어다.
- 받은 영역은 첫 태그로 남는다(`lead_with_area_tag`). 그래서 태그 필터가 곧 영역별 보기다.
- 파일을 직접 쓰는 에이전트용 규격(`journal-spec` ko/en)과 플러그인 기록 스킬에도 같은 규칙을 적었다. 위키(일지) · 플러그인 문서 페이지 · CHANGELOG Unreleased 도 고쳤다.
- `mcp/tools/mod.rs` 는 800줄 한도에 붙어 있어 검사 로직을 새 모듈로 뺐다(파일 크기 래칫 통과).

## 검증

- 새 테스트 `mcp::tools::tests::title` 5개: 받음 · area 인자로 조립 · 거절 다섯 갈래 · 기존 영역 안내 · 영어 거절. 거절된 호출은 파일을 남기지 않는다.
- 기존 테스트와 통합 테스트(두 프로세스 · 캐시 경계 · 크로스플랫폼)의 제목을 새 형식으로 바꿨다.
- `cargo fmt --check && cargo clippy --all-targets --locked -D warnings && cargo test --locked --no-fail-fast` → rust passed 1158 failed 0
- `pnpm typecheck && pnpm test && pnpm lint && pnpm build` → 0 · Tests 946 passed · 0 · 0
- `node scripts/check-file-sizes.mjs` → clean

## 메모

이 일지의 제목도 새 형식으로 썼다. 다만 지금 돌고 있는 설치본(4.1.0)의 MCP 는 아직 옛 규칙이라 이 제목을 검사하지 않았다. 다음 릴리스부터 거절이 동작한다.