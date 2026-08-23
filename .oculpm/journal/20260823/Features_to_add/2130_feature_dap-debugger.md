---
schema_version: 1
type: feature
slug: dap-debugger
status: done
difficulty: superhigh
created_at: "2026-08-23T21:30:00+09:00"
session_id: "manual-20260823-213000"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: "docs/dap/00-master-plan.md"
    op: create
  - path: "src-tauri/src/framing.rs"
    op: rename
  - path: "src-tauri/src/lsp/mod.rs"
    op: update
  - path: "src-tauri/src/lsp/client.rs"
    op: update
  - path: "src-tauri/src/dap/mod.rs"
    op: create
  - path: "src-tauri/src/dap/protocol.rs"
    op: create
  - path: "src-tauri/src/dap/registry.rs"
    op: create
  - path: "src-tauri/src/dap/client.rs"
    op: create
  - path: "src-tauri/src/dap/session.rs"
    op: create
  - path: "src-tauri/src/dap/spec.rs"
    op: create
  - path: "src-tauri/src/dap/state.rs"
    op: create
  - path: "src-tauri/src/commands/dap.rs"
    op: create
  - path: "src-tauri/src/commands/mod.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/tests/dap_lldb.rs"
    op: create
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/features/code/breakpointGutter.ts"
    op: create
  - path: "src/features/code/debugConfig.ts"
    op: create
  - path: "src/features/code/useDebug.ts"
    op: create
  - path: "src/features/code/CodeDebugPanel.tsx"
    op: create
  - path: "src/features/code/CodeEditor.tsx"
    op: update
  - path: "src/features/code/CodePane.tsx"
    op: update
  - path: "src/features/code/CodeScreenV2.tsx"
    op: update
  - path: "src/features/code/code.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
  - path: "src/__tests__/code_debug.test.ts"
    op: create
related:
  - ".oculpm/journal/20260823/Features_to_add/2045_feature_lsp-phase2-and-git-gutter.md"
tags: [code-screen, ide, dap, debugger]
---

[x] 인앱 디버거 (DAP) — 설계 문서 + 파이프 + 최소 세션

## 추가 기능

- **설계 SSOT** `docs/dap/00-master-plan.md` — 사용자 지시대로 이것부터 썼다.
- **중단점** — 에디터 거터 클릭으로 토글. 어댑터가 "못 건다" 고 답하면 속 빈
  동그라미로 구별한다.
- **실행 제어** — 계속 / 한 줄 / 안으로 / 밖으로 / 중지.
- **호출 스택 · 변수 트리 · 콘솔** — 편집 영역 아래 패널 (참조 패널과 같은 자리).
- **실행 구성** — 언어·실행 파일·인자·첫 줄 정지. 지금 파일에서 첫 값을 추측한다.

## 동작 흐름

**문서만 읽고 설계하지 않았다.** `lldb-dap` 을 실제로 띄워 디버그 심벌이 든 Rust
바이너리에 붙여 한 세션을 끝까지 돌린 뒤에 썼다. 설계의 두 결정이 거기서 나왔다:

1. **순서를 가정하지 않는다.** 명세는 `initialize` → `initialized` → 설정 →
   `configurationDone` 로 읽히지만, **같은 어댑터가 실행마다 다른 순서로 답했다**
   (`initialized` 가 `launch` 응답 앞에 오기도, 뒤에 오기도 했다). 그래서 세션은
   순차 스크립트가 아니라 이벤트 구동 상태 기계다. `launch` 는 응답을 기다리지
   않고 보내고, `initialized` 는 **이미 왔는지까지 보고** 기다린다(`Latch`) —
   `oneshot` 은 소비되면 끝이고 순수 `Notify` 는 먼저 온 알림을 잃는다.
2. **`pathFormat` 은 반드시 보낸다.** 빼면 lldb-dap 이 `success: false` 로 답하고
   이후가 전부 조용히 망가진다.

**LSP 와 같은 것 · 다른 것.** 프레이밍은 같아서 `lsp/framing.rs` 를
`src-tauri/src/framing.rs` 로 올려 둘이 공유한다 (`dap` 이 `lsp` 를 임포트하면
있지도 않은 계층 관계를 암시한다). 봉투는 다르다 — JSON-RPC 가 아니라
`seq`/`request_seq` 이고, 실패가 `error` 객체가 아니라 `success: false` 다.
수명도 다르다: 언어 서버는 오래 살고, 디버그 세션은 **실행 한 번**이다.

**조달이 LSP 와 가장 다르다.** 언어 서버는 넷 다 PATH 위 실행 파일이었지만
디버그 어댑터는 그런 것이 오히려 적다 — `lldb-dap` 은 Xcode 툴체인 안(`xcrun -f`),
`debugpy` 는 파이썬 모듈, `dlv` 는 하위 명령이다. 그래서 레지스트리가
`command: &str` 이 아니라 **조달 전략**(`Path`/`Xcrun`/`Module`/`Subcommand`)을 든다.

**줄 번호는 1-based 로 협상한다.** LSP 는 0-based 가 강제라 "통과시키기" 가
정답이었지만, DAP 는 `linesStartAt1` 로 고를 수 있고 CodeMirror 도 1-based 다 —
협상해서 변환을 없앤다. 두 층의 숫자 규약이 다르다는 것만 주석으로 못 박았다.

**중단점은 세션보다 오래 산다.** 세션이 죽어도 찍어 둔 자리는 남아야 하므로
저장소를 세션이 아니라 프로젝트에 매달았다. 파일이 옮겨지면 따라간다 (탭·버퍼와
같은 정합 규칙).

## 검증

- 게이트 5종 전부 exit 0 직접 확인: `pnpm typecheck` · `pnpm test`(107파일 1245개)
  · `pnpm lint` · `pnpm build` · `cd src-tauri && cargo test`(779 + 통합).
- 새 테스트 35개. 백엔드 단위 23(봉투 파싱·조달 전략·걸쇠 3종·중단점 저장소·
  프레임/스코프/변수 변환), **실제 `lldb-dap` 왕복 2**, 프런트 10.
- 통합 테스트는 진짜로 돈다: 중단점을 걸고, 멈추고, `a=2 b=40` 을 읽고, 스텝하고,
  끝까지 실행해 `terminated` 를 받는다. 어댑터나 `rustc` 가 없으면 건너뛴다.

## 메모

- **핸들 직렬화에서 한 번 밟았다.** specta 가 `i64` 를 IPC 로 못 내보내게 해서
  `f64` 로 바꿨는데, 그 값을 그대로 어댑터에 돌려보내니 `frameId: 3.0` 이 되어
  `scopes` 가 거절당했다. 통합 테스트가 즉시 잡았고, 캐스팅을 흩뿌리는 대신
  이름 붙은 `wire_id()` 한 곳으로 모았다. specta 는 `f64` 를 `number | null` 로
  내보내기도 한다(NaN 때문) — 프런트에서 한 번 좁힌다.
- **인앱 육안 확인은 아직**(`verified_by_user: false`). 거터 클릭 반응·패널 높이·
  변수 트리 펼침은 jsdom 밖이다. `lldb-dap` 이 있으므로 이 저장소에서
  `cargo build` 한 뒤 `target/debug/ocul-pm` 으로 실제로 붙여 볼 수 있다.
- **debugpy·dlv 는 이 기계에 없어 조달 경로만 넣고 왕복은 검증하지 못했다.**
  설계 문서의 PR-DAP1 로 남긴다.
- 실행 구성은 영속하지 않는다 — v1 은 "이번에 무엇을 띄울지" 만 묻는다. 구성
  파일(`launch.json` 격)은 이번 범위 밖.
- 자동 빌드는 하지 않는다: 어느 프로필로 어떤 타깃을 지을지가 곧 또 하나의
  설정이고, 그 판단은 사용자 것이다.
