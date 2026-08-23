---
schema_version: 1
type: feature
slug: lsp-code-intelligence
status: done
difficulty: superhigh
created_at: "2026-08-21T19:49:00+09:00"
session_id: "manual-20260821-194900"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: "docs/lsp/00-master-plan.md"
    op: create
  - path: "src-tauri/src/lsp/mod.rs"
    op: create
  - path: "src-tauri/src/lsp/framing.rs"
    op: create
  - path: "src-tauri/src/lsp/registry.rs"
    op: create
  - path: "src-tauri/src/lsp/client.rs"
    op: create
  - path: "src-tauri/src/lsp/spec.rs"
    op: create
  - path: "src-tauri/src/lsp/state.rs"
    op: create
  - path: "src-tauri/src/commands/lsp.rs"
    op: create
  - path: "src-tauri/tests/lsp_rust_analyzer.rs"
    op: create
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/src/commands/mod.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/features/code/lspBridge.ts"
    op: create
  - path: "src/features/code/useLsp.ts"
    op: create
  - path: "src/features/code/CodeEditor.tsx"
    op: update
  - path: "src/features/code/CodeScreenV2.tsx"
    op: update
  - path: "src/features/code/code.css"
    op: update
  - path: "src/__tests__/lsp_bridge.test.ts"
    op: create
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags: [lsp, code-editor, rust-analyzer, ide, codemirror, dogfooding]
---

[x] PR-LSP0 — 코드 화면에 언어 서버를 붙였다 (진단 · 자동완성). VS Code 포크 대신 고른 길

## 추가 기능

"완벽한 oculpm IDE studio" 를 만들자며 Code-OSS 1.135.0 을 통째로 받아 온 데서 시작했다.
받아 놓은 것을 실제로 재 보고 **포크는 접었다** (근거는 `docs/lsp/00-master-plan.md` 와
플래너 Decision 1). 요지는 세 가지 — `src/` 만 TS 8,572 파일로 이 저장소 프런트(295)의
29배라 영원한 리베이스가 되고, `product.json` 의 `extensionsGallery` 가 `null` 이라
마켓플레이스는 MIT 소스에 아예 없으며(Open VSX 에는 Pylance·C/C++·Remote-SSH 가 없다),
Electron 42 를 싣는 순간 24MB→200MB대에 "Tauri, not Electron" 정체성이 뒤집힌다.

에디터는 이미 있었다 (CodeMirror 6 · 10개 언어 · `code_read`/`code_write`). 없던 것은
코드를 *이해하는* 층이고, 그 표준 창구는 LSP 하나다. 그래서 그것만 직접 붙였다.

- `journal_search` 처럼 **디스크·프로세스만** 쓴다. 새 의존성은 프런트 쪽
  `@codemirror/autocomplete`·`@codemirror/lint` 둘뿐이다.
- 서버 조달은 ACP 의 `acp::env::resolve_binary`(로그인 셸 PATH) 를 그대로 재사용 —
  패키징된 `.app` 이 Finder 의 빈약한 PATH 로 뜨는 그 함정을 이미 넘어 둔 코드다.
- rust-analyzer · typescript-language-server · pyright · gopls 를 등록했고, 이번 라운드의
  실검증은 rust-analyzer 로 했다.

## 동작 흐름

`lsp/framing` → `registry` → `client` → `state` → `commands/lsp` → `useLsp` → CodeEditor.

설계에서 값을 한 결정 셋:

**위치를 변환하지 않는다.** LSP 의 `character` 는 UTF-16 코드 유닛이고 JS 문자열도
UTF-16 이라 프런트와 LSP 는 **이미 같은 단위**다. Rust `String` 은 UTF-8 이라 중간에서
오프셋을 계산하면 거기서만 어긋난다 — 한글 주석이 흔한 이 저장소에서 정확히 아픈 방식으로.
그래서 프런트가 `{line, character}` 를 만들고 Rust 는 통과만 시킨다. 이 결정 하나가
오프셋 버그 한 부류를 통째로 없앴고, 테스트로 잠갔다.

**루트는 프로젝트 루트가 아니다.** rust-analyzer 는 Cargo 워크스페이스 루트(`src-tauri/`)
를 원한다. 열린 파일에서 위로 올라가며 마커를 찾되 **프로젝트 밖으로는 안 나간다** —
홈에 굴러다니는 `package.json` 을 붙잡고 홈 전체를 인덱싱하는 사고를 막는다. 서버 키가
`(project_id, language, root)` 라 모노레포에서 워크스페이스마다 따로 뜬다.

**문서 동기는 full sync.** 증분은 CM6 `ChangeSet` 을 LSP range 로 번역해야 하고, 그
번역이 틀리면 서버 문서가 조용히 어긋나 진단이 엉뚱한 줄에 붙는다. 코드 화면은 2MB
가드가 걸린 단일 파일 편집이라 전량 전송이 싸다.

그 밖에 실제로 문제가 됐던 것들:

- **stderr 를 읽어야 한다.** 파이프를 열고 안 읽으면 서버가 버퍼를 채우다 통째로 블록된다.
- **진단은 트랜잭션으로 반영한다** (`setDiagnostics`). 확장 재구성으로 하면 타자 도중
  실행 취소 이력과 접힘 상태가 날아간다.
- **완성은 `filter: false`.** 서버가 문맥으로 고른 목록인데 CM6 가 접두사로 다시 거르면
  `.` 직후처럼 접두사가 빈 자리에서 후보가 통째로 사라진다. 순서도 `boost` 로 고정했다 —
  rust-analyzer 는 타입이 맞는 후보를 앞에 올리는데 알파벳순으로 다시 섞으면 그 지능이 없어진다.
- **서버가 안 붙는 파일에는 확장을 안 단다.** `autocompletion({override})` 를 무조건 걸면
  `.css`·`.md` 의 기존 언어 모드 완성이 통째로 사라진다. 프런트가 확장자 목록을 따로 드는데
  (CM6 확장 구성이 마운트 1회라 그때 알아야 한다), 양쪽이 어긋나면 조용히 깨지므로
  **Rust·TS 양쪽에 서로를 가리키는 교차 테스트**를 걸었다.
- **"분석 중" 을 밝힌다.** rust-analyzer 는 첫 기동에 수십 초를 쓴다. 그동안 진단이 안 오는
  것을 "안 붙었다" 와 구별할 수 없으면 사용자는 고장으로 읽는다. `$/progress` 를 상태줄로 올렸다.

## 검증

- **실제 rust-analyzer 왕복 3/3** (`tests/lsp_rust_analyzer.rs`) — initialize 핸드셰이크,
  `completionProvider` 능력 광고 확인, 구문 오류 파일의 진단이 **정확히 그 줄(0-based 1)** 에
  오는 것, 깨끗한 파일에는 오류가 안 붙는 것, `stop()` 이 매달리지 않는 것. PATH 에
  rust-analyzer 가 없으면 건너뛴다(다른 기기에서 스위트가 빨개지지 않게).
- `cargo test` 676 그린 (직전 641 + 신규 35). 단위: 프레이밍(부분 수신 전 경계·배치·헤더
  대소문자·과대 길이 거부), 레지스트리(워크스페이스 루트·모노레포·마커 우선순위·탈출 방지·
  URI 한글/공백 왕복), 변환(심각도 4종·망가진 항목만 버리기·응답 두 형태·textEdit 우선·상한),
  경로 가드(심링크 탈출 거부), 버전 단조 증가.
- `pnpm test` 1107 그린 (신규 18) — 좌표 왕복, 한글 코드 유닛, 문서 밖 진단 접기, 길이 0
  범위 넓히기, boost 범위, 트리거 문자 완성 지점, 확장자 목록 교차 검증.
- `pnpm typecheck` · `pnpm lint` · `pnpm build` 각각 exit 0.

**정직하게 — 앱을 띄워서 눈으로 본 검증은 아직 안 했다.** 백엔드↔rust-analyzer 는 실프로세스
통합 테스트로, 좌표·변환은 단위 테스트로 증명됐지만, 코드 화면에서 `.rs` 파일을 열어 빨간
밑줄과 완성 목록이 실제로 그려지는 것은 확인하지 않았다. 남은 위험은 커맨드↔이벤트 배선과
CSS 다.

## 메모

도그푸딩이 버그를 하나 잡았다. 통합 테스트를 처음 돌렸을 때 rust-analyzer 가 0.18초 만에
죽었는데, `~/.cargo/bin/rust-analyzer` 가 **컴포넌트 미설치 rustup 심**이었다 (PATH 에는
있는데 실행하면 즉시 종료). 그때 우리 메시지는 "언어 서버가 종료됐습니다" 뿐이었고, 사용자에게
필요한 문장("Unknown binary 'rust-analyzer' in official toolchain")은 오직 stderr 에만 있었다.
→ 마지막 stderr 줄을 붙들어 기동 실패 메시지에 덧붙이게 고쳤다. PATH 에 있지만 망가진
바이너리는 흔한 실패 유형이라 이 한 줄이 진단 전체를 바꾼다.

다음(플래너 Phase 1~3): 호버 · 정의로 이동(기존 `jumpLine` 핸드오프 재사용) · 이름 바꾸기
(`code_write` 낙관적 잠금과 함께 가야 한다) · 설정에서 언어별 토글과 미설치 안내.

**디버거(DAP)는 하지 않기로 했다** — LSP 로 안 닫히고, 에이전트가 코드를 쓰는 워크플로에서
인앱 디버거의 우선순위는 낮다고 봤다. 포크가 실제로 값을 하는 유일한 영역이기도 하다.
