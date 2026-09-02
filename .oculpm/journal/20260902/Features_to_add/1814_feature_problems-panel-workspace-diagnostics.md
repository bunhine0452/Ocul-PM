---
schema_version: 1
type: feature
slug: "problems-panel-workspace-diagnostics"
status: done
difficulty: high
created_at: "2026-09-02T18:14:06+09:00"
session_id: "20260902-007"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/lsp/spec.rs"
    op: update
  - path: "src-tauri/src/lsp/state.rs"
    op: update
  - path: "src-tauri/src/commands/lsp.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/features/code/problemsStore.ts"
    op: create
  - path: "src/features/code/problemsModel.ts"
    op: create
  - path: "src/features/code/CodeProblems.tsx"
    op: create
  - path: "src/features/code/CodeScreenV2.tsx"
    op: update
  - path: "src/features/code/CodePane.tsx"
    op: update
  - path: "src/features/code/code.css"
    op: update
  - path: "src/components/Icons.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
  - path: "src/__tests__/code_problems.test.tsx"
    op: create
related:
  - ref: "20260902/Features_to_add/1754_feature_sticky-scroll-in-code-editor.md"
    kind: "followup"
tags:
  - "code"
  - "lsp"
  - "rust"
  - "vscode-borrows"
  - "mcp-tool"
---
[x] 코드 화면 문제 패널 — 워크스페이스 진단을 한자리에 (vscode-borrows Phase 5)

## 추가 기능

진단이 **열려 있는 파일 하나**에만 보였다. rust-analyzer 는 `cargo check` 결과를
워크스페이스 단위로 밀어 주는데 그 정보가 통째로 버려지고 있어서, "에이전트가
방금 뭘 깨뜨렸나"를 보려면 파일을 하나씩 열어야 했다.

이제 코드 화면에 **문제** 패널이 있다 — 파일별로 접히고, 심각도로 좁히고,
항목을 누르면 그 파일 그 줄로 간다. 설계 SSOT 는
`docs/20260902_vscode-borrows/05-problems.md`.

## 동작 흐름

1. **`lsp_diagnostics_snapshot`(신규 커맨드)** — `LspState.raw_diagnostics` 를
   프로젝트 루트 접두로 걸러 좁은 타입(`LspFileDiagnostics`)으로 준다.
   브리지 절차대로 `lib.rs` 의 `use` + `collect_commands![]` 양쪽에 등록하고
   `cargo test` 로 `bindings.ts` 를 재생성했다.
2. **`problemsStore.ts`** — 모듈 스코프 + `useSyncExternalStore`, 프로젝트별
   버킷. 구독은 창 최상위가 아니라 **코드 화면**이 건다 (코드 화면을 한 번도 안
   연 창이 진단을 메모리에 쌓을 이유가 없다).
3. **`problemsModel.ts`(순수)** — 오류 있는 파일 먼저 → 오류 수 → 경로 사전순,
   파일 안은 줄·열. `filterBySeverity` · `totalCounts`.
4. **`CodeProblems.tsx`** — 참조 패널과 같은 자리·같은 뼈대(`.code-refs` 재사용).

## 구현 중 정한 것 4

- **백엔드에 워크스페이스 진단 저장소를 새로 만들지 않았다.** `raw_diagnostics`
  는 코드 액션용이라 문서를 닫으면 사라지고 프로젝트 축도 없다. 승격하려면
  수명·소유권을 다시 설계해야 하는데 얻는 것은 "앱을 껐다 켜도 남는다" 뿐이고,
  서버를 다시 띄우면 진단은 어차피 다시 오므로 그건 거짓말이다.
- **스냅샷 커맨드는 서버를 띄우지 않는다.** 화면을 열었다는 이유로 프로젝트의
  모든 언어 서버가 기동하면 안 보고 있는 언어까지 색인을 시작한다.
- **`touched` 집합** — 처음엔 "이미 맵에 있는 경로는 스냅샷이 안 덮는다" 로
  짰는데, 테스트를 쓰다 구멍을 봤다: 맵에 **없다**는 것만으로는 "아직 못 들었다"
  와 "방금 고쳐서 지웠다"를 구별할 수 없다. 늦게 온 스냅샷이 방금 고친 파일을
  되살리고, 그 파일은 진단이 없으니 서버가 다시 말해 주지도 않아 영영 남는다.
  이벤트가 한 번이라도 말한 경로를 따로 기억해 막았다.
- **패널 자리는 하나** — 참조/디버그와 같은 슬롯이라 여는 쪽이 상대를 닫는다.
  탭으로 공존시키는 것은 이 라운드 범위 밖이고, 숨은 패널이 남으면 "아까 그건
  어디 갔지"가 된다.

빈 상태 문구는 "문제 없음"이 아니라 **"아직 아는 문제가 없습니다 — 언어 서버가
연 파일부터 압니다"** 다. 이 패널이 아는 것은 서버가 본 파일뿐이고, 그 한계를
말하지 않으면 빈 목록이 보증서처럼 읽힌다. 상태줄 총계 뱃지(`⊘ n △ n`)가 패널을
여는 유일한 신호라 0 일 때도 남긴다 — 감추면 빈 상태를 읽을 길이 없어진다.

## 검증

- 프런트 25건 — 정렬·필터·합계(순수), 스토어(빈 배열=삭제·프로젝트 격리·스냅샷
  덮어쓰기 방지·무변경이면 구독자 안 깨움), 패널(이동 좌표·필터·더 보기·접기·
  빈 상태 문구·a11y). Rust 2건 — 접두 필터+빈 파일 제거, 정렬.
- 게이트 전부 exit 0: `pnpm typecheck` · `pnpm test`(157 파일 2024건) ·
  `pnpm lint`(4종) · `pnpm build` · `cargo test`(1113 + 통합) ·
  `cargo clippy --all-targets -D warnings`.
- 육안 확인은 라운드 마감(#eyes)에서.