---
schema_version: 1
type: feature
slug: "related-suggest-link-auto"
status: done
difficulty: high
created_at: "2026-09-21T19:13:15+09:00"
session_id: "20260921-001"
agent:
  id: "claude-code"
  version: "Fable 5.1 (감독) / Opus 5 (구현 세션 L)"
  session: "90a6ae8d-a58d-4177-a11b-44f0b573394f"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/related.rs"
    op: create
  - path: "src-tauri/src/oculpm/cache/related.rs"
    op: create
  - path: "src-tauri/src/commands/related.rs"
    op: create
  - path: "src-tauri/src/oculpm/mcp/tools/related.rs"
    op: create
  - path: "src-tauri/src/oculpm/manager/tests_related.rs"
    op: create
  - path: "src/features/oculpm/RelatedSuggestCard.tsx"
    op: create
  - path: "src/__tests__/related_suggest.test.tsx"
    op: create
  - path: "src-tauri/src/oculpm/manager/journal.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/mod.rs"
    op: update
  - path: "src/features/oculpm/EntryDetailView.tsx"
    op: update
  - path: "src/api/oculpm.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags:
  - "journal-scale"
  - "related"
  - "mcp"
  - "journal-detail"
  - "mcp-tool"
---
[x] 관련 일지 후보 제안·「잇기」·결함 일지 자동 followup — 700건을 목록에서 그래프로

## 추가 기능

플랜 `journal-scale-round` {#related-suggest} {#related-ui} {#related-auto}. 병렬 워크트리 세션 L(Opus 5) 구현, 감독자 합류. PR #26.

근거: 727건 중 `links` 0건, 비어있지 않은 `related` 243건. 같은 파일에 bug 일지가 5건 넘게 붙은 파일 31개인데 "재발" 을 아무도 못 봤다.

- **점수**(`oculpm/related.rs`, I/O 없음): `Σ(IDF 가중 공유 파일) + min(0.5×플랜항목수, 1.0) + 0.75×제목 자카드`. IDF = ln(total/df)/ln(total). **허브 파일은 개별 상한 0.15 이자 합산도 0.15** — 개별 상한만 두면 `ko.ts+en.ts` 만 겹친 짝이 0.30 으로 문턱(0.2)을 넘어 i18n 만진 전 일지가 서로의 후보가 된다. 허브 표는 경로 끝 매칭(ko.ts/en.ts/lib.rs/mod.rs/bindings.ts/package.json/Cargo.toml/lock/CHANGELOG/tauri.conf.json). 제목만인 후보는 자카드 0.34 이상.
- 근거는 코드+파라미터(`shared_files`/`plan_item`/`title`)로만 내고 문장은 프런트가 만든다 — 백엔드가 한국어를 만들면 영어 모드에서 샌다.
- **잇기 쓰기**(`oculpm_add_related`)는 코어스 선례대로: `entry_write_guard` 를 읽기 앞에서 잡고 → frontmatter 만 바꿔 재작성(본문 바이트 불변, 테스트가 `disk_body == body` 로 문다) → `apply_path_change` 로 재투영. 거절 넷: 규격 밖 kind·자기 자신·없는 대상·중복. 잇는 kind 는 `followup` 하나 — 나머지 셋은 사람이 아는 사실이라 후보가 대신 고를 수 없다.
- **자동 followup**(MCP `journal_write`): `related` 를 안 줬고 type 이 bug/error 이며 허브 아닌 `files_touched` 가 겹치는 지난 bug/error 가 있으면 최신 1건을 `followup` 으로. MCP 프로세스는 앱 DB 를 못 여는 갈래로 보고 **디스크 walk 폴백**(정적 허브 표, 파일명 토큰으로 bug/error 만 열기, 최신순 300개 상한). 응답 `auto_related:[{ref,kind,via}]`.
- `mcp/tools/mod.rs` 1198→1174줄 (related 인자 파싱을 새 모듈로).

## 덤으로 잡힌 잠복 결함

캐시에 `related` 칸이 없어 `cache/query.rs` 가 늘 `Vec::new()` 로 투영했다 — 일지 상세의 관련 칩은 frontmatter 에 값이 있어도 **한 번도 뜬 적이 없다**. 표/마이그레이션 대신 상세 경로에서 SSOT(디스크)를 한 번 읽어 채운다(`hydrate_related_from_disk`, get_journal_entry 2경로 + 메타/코어스/본문편집/잇기 반환 4곳).

## 알아 둘 것

- 플랜 신호는 `oculpm_plan_item_updates` 가 채워져 있을 때만 — 그 표는 `reproject_all` 이 채우므로 플래너/Today 를 한 번도 안 그린 세션에서는 비어 있다(후보가 줄 뿐 틀린 후보는 안 난다).
- specta 가 `f32` 를 `number | null` 로 내보내 TS `score` 는 nullable(화면은 근거만 그린다).
- 안 한 것: 잇기 되돌리기 UI(원본 열어 지우는 길), 일지 목록/검색 화면에 후보 붙이기, 실기기 육안 확인.

## 검증

순수 점수 테스트 14 + manager 잇기 테스트(본문 불변·경로 탈출·거절 넷) + MCP 계약 테스트(기존 `related` 카운트·경고 2건·접두 벗기기 유지) + vitest `related_suggest` 카드. 통합 브랜치 전 게이트 exit 0.