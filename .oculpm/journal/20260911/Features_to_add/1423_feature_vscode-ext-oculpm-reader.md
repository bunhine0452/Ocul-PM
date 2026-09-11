---
schema_version: 1
type: feature
slug: "vscode-ext-oculpm-reader"
status: done
difficulty: medium
created_at: "2026-09-11T14:23:56+09:00"
session_id: "20260911-008"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "f765a77e-6dcb-4163-aad5-23b2741956c9"
language: "ko"
verified_by_user: false
files_touched:
  - path: "extension/src/oculpm/frontmatter.ts"
    op: create
  - path: "extension/src/oculpm/journal.ts"
    op: create
  - path: "extension/src/oculpm/planner.ts"
    op: create
  - path: "extension/src/oculpm/store.ts"
    op: create
  - path: "extension/src/oculpm/reader.test.ts"
    op: create
  - path: "extension/vitest.config.mts"
    op: create
  - path: "extension/tsconfig.vitest.json"
    op: create
  - path: "extension/tsconfig.json"
    op: update
  - path: "extension/package.json"
    op: update
  - path: "src-tauri/tests/fixtures/plan_sample.md"
    op: create
  - path: "src-tauri/tests/fixtures/journal_sample.md"
    op: create
  - path: "src-tauri/src/oculpm/planner/parse.rs"
    op: update
  - path: "src-tauri/src/oculpm/frontmatter/tests.rs"
    op: update
related: []
tags:
  - "vscode"
  - "extension"
  - "parser"
  - "fixtures"
  - "mcp-tool"
---
[x] VS Code 확장 .oculpm 읽기 계층 — Rust 파서와 픽스처를 공유하는 TS 이식

## 추가 기능

플랜 `vscode-extension-round` `{#sc-reader}` — `extension/src/oculpm/` 에 읽기 전용 파서 4파일(573줄): `frontmatter.ts`(울타리 분리 — Rust `parse_frontmatter_and_body` 의 행렬 그대로: 첫 줄 `---` 만, 안 닫히면 원문 무손실+경고, 깨진 YAML 은 raw 보존), `journal.ts`(경로 규약 `{YYYYMMDD}/{TypeFolder}/{HHMM}_{type}_{slug}.md` + frontmatter 필드 + 본문 첫 줄 `[x] 제목`), `planner.ts`(`parse_plan` 이식 — 글리프 6종·**첫** `{#id}` 우선·⟶/-> 메모·끝 `@…` 귀속 제거·2칸/탭 하위·줄바꿈 접기·결정 섹션 경계·plan-log 행·부모 롤업 `rollup_status`), `store.ts`(fs 층 — `index/**` 는 걷지 않음, `_`로 시작하는 플랜 파일 제외, `localWorkday` 는 OS 로컬).

## 동작 흐름

- **픽스처 공유** `{#sc-reader-fixture}`: Rust 의 인라인 샘플 두 개(`parse.rs` 의 `SAMPLE`, `frontmatter/tests.rs` 의 `sample_yaml`)를 `src-tauri/tests/fixtures/{plan,journal}_sample.md` 로 꺼내고 `include_str!` 로 되돌려 읽는다. vitest 는 같은 파일을 상대경로로 읽어 Rust 테스트(`parses_full_plan`·`parses_well_formed_frontmatter_with_no_warnings`)와 **같은 단언**을 건다 — 규격이 바뀌면 양쪽이 같이 붉어진다.
- **글리프·롤업** `{#sc-reader-glyph}`: 6종 상태값, 모르는 글리프는 경고+todo(Rust 와 같은 문구), 부모 `[~]` 가 하위 `[ ]` 롤업으로 todo 가 되는 것(파일 글리프≠파생값), `rollupStatus` 4경우, plan-log 블록은 파싱만.
- **실제 `.oculpm/`**: 이 저장소를 그대로 읽어 오늘 일지 수 = 순진한 파일 집계, 활성 플랜마다 파서 항목 수 = 정규식 항목 수, 최근 3건 frontmatter type/slug = 경로와 일치.
- vitest 는 Node16/CJS tsconfig 에서 ESM 전용이라 TS1479 가 났다 → 단위 테스트만 `tsconfig.vitest.json`(Bundler 해석)으로 따로 검사, `check-types` 가 둘 다 돈다. `pnpm test` = `vitest run && vscode-test`.

## 검증

- `cargo test --lib oculpm::planner::parse`(19) · `oculpm::frontmatter`(23) 통과, `rustfmt --check` 통과.
- `cd extension && pnpm compile && pnpm test`: vitest 7 + mocha 2 통과, exit 0. 루트 `pnpm lint:js`(경고 4=상한)·`lint:extension` exit 0.