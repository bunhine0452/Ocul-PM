---
schema_version: 1
type: feature
slug: "release-notes-draft-from-journals"
status: done
difficulty: high
created_at: "2026-09-22T00:36:52+09:00"
session_id: "mcp-20260922-003652"
agent:
  id: "claude-code"
  version: "Fable 5.1 (감독) / Opus 5 (구현 세션 N)"
  session: "90a6ae8d-a58d-4177-a11b-44f0b573394f"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/release_notes.rs"
    op: create
  - path: "src/features/branch/ReleaseNotesSheet.tsx"
    op: create
  - path: "src/__tests__/release_notes_sheet.test.tsx"
    op: create
  - path: "src-tauri/src/git/changelog.rs"
    op: update
  - path: "src-tauri/src/git/tests.rs"
    op: update
  - path: "src-tauri/src/commands/summary/chunking.rs"
    op: update
  - path: "src/features/branch/BranchScreenV2.tsx"
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
  - "release"
  - "changelog"
  - "branch-screen"
  - "mcp-tool"
---
[x] 릴리스 노트 초안 — 태그 사이 커밋과 일지로 CHANGELOG 한 판, 파일은 사람이 붙인다

## 추가 기능

플랜 `journal-scale-round` {#release-notes-draft}. 3차 웨이브 세션 N(Opus 5) 구현, 감독자 합류. PR #28.

근거: 릴리스는 5면을 손으로 채우는 규율이고 CHANGELOG 가 GitHub 릴리스 노트의 유일한 소스(`docs/RELEASE.md`). 문체는 기능 나열이 아니라 "무엇이 왜 아팠고 어떻게 바뀌었다" 서사체.

- `oculpm_release_notes_draft(project_id, from_ref?, to_ref?, use_llm)`: `from_ref` 기본 최신 `v*` 태그(`git::changelog::latest_version_tag`), `to_ref` 기본 HEAD. 범위 커밋의 시각·파일(`log_range_with_files`) → `manager.workday_at` 으로 workday 범위(`chrono::Local` 로 때려 맞추면 `day_starts_at` 이 00:00 이 아닌 프로젝트에서 하루가 어긋난다) → 캐시 일지. 커밋 파일과 `files_touched` 겹침 가중, 중첩 저장소는 `repo_nesting` 한 번 재고 `rebase`(파일마다 canonicalize 하지 않음). 겹침 없는 일지는 「커밋 연결 없음」.
- 결정적 초안: `## v?` 자리표시 + "버전은 bump-version.mjs 가 정한다", 고친 것(bug/error)·새로 생긴 것(feature)·안에서 바뀐 것(refactor/chore), 항목 = 제목 + 첫 문단 인용 + `(일지: 경로)`, 통계 줄. `ContentLang` 따라 영어도.
- LLM: CHANGELOG 최근 2섹션을 문체 표본으로 시스템 프롬프트에. `summary::call_llm` 만 지나 egress 원장·`CALL_SITE_FILES` 무변경. 청킹은 R 의 `chunking.rs` 에 정책만 나눈 `map_reduce_blocks`(LLM_ENTRY_CAP 60·MAX_CHUNKS 12 공유). provider/model 은 설정에서(`default_provider` → `model_{provider}` → `default_model`, 전경 작업이라 대화 모델).
- `sane_ref`: `-` 시작·허용 문자 밖 입력 거절(`--output=…` 플래그 주입 차단), `release_notes_bad_ref`.
- 브랜치 화면 「릴리스 노트 초안」 시트: 범위·「AI 로 다듬기」·미리보기·「복사」·「CHANGELOG 맨 위에 붙여넣기」(둘 다 클립보드까지, 파일은 안 건드린다). 5면 규율 문장 푸터 상시.

## 검증

순수 생성기 단위 6(분류·가중·통계·자리표시·ref 위생) + git 범위 통합 1(tempdir 태그 2개) · vitest 2. `egress_inventory` 11/11. 통합 브랜치 전 게이트 exit 0. LLM 경로는 실제 호출을 못 물었다 — 첫 실사용 때 `used_llm`/`note` 로 폴백 여부가 드러난다. 실기기 육안 미실시.