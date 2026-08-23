# DAP — 인앱 디버거 (설계 SSOT)

작성 2026-08-23 · 상태: PR-DAP0 착수 · 플랜 [ide-completion #p3-dap](../../.oculpm/planner/ide-completion.md)

## 왜 이제 와서

`lsp-code-intelligence` 는 디버거를 **의도적으로 제외**했다 — "에이전트가 코드를 쓰는
워크플로에서 인앱 디버거의 우선순위는 낮다" 는 판단이었다. 사용자가 2026-08-23 에
그 결정을 다시 열었다. 목표가 "VS Code 를 열 이유가 없어지는 것" 이라면 중단점을
찍고 변수를 들여다보는 일만 남겨 두는 것은 앞뒤가 안 맞는다.

## 먼저 실물로 확인한 것

문서만 읽고 설계하지 않았다. `lldb-dap` 을 실제로 띄워 **디버그 심벌이 든 Rust
바이너리에 붙여** 한 세션을 끝까지 돌렸다 (`initialize` → 중단점 → `stopped` →
호출 스택 → 스코프 → 변수 → 스텝 → `continue` → `terminated`). 아래 결정들은 그
실측에서 나왔다.

```
4) stopped: {"reason":"breakpoint","hitBreakpointIds":[1],"threadId":682093, …}
5) stack:  [('demo::add::h1c091…', 2), ('demo::main::h38e95…', 6),
            ('core::ops::function::FnOnce::call_once::h6e235…', 250)]
6) scopes: [('Locals', 1, False), ('Globals', 2, False), ('Registers', 3, False)]
7) vars:   [('a', '2', 'long'), ('b', '40', 'long')]
9) terminated ✓  output: 42
```

## LSP 와 같은 것 · 다른 것

| | LSP | DAP |
|---|---|---|
| 프레이밍 | `Content-Length` + `\r\n\r\n` | **같다** |
| 봉투 | JSON-RPC 2.0 (`jsonrpc`/`id`) | **다르다** — `seq`/`request_seq`/`type` |
| 줄 번호 | 0-based 고정 | **협상한다** (`linesStartAt1`) |
| 수명 | 프로젝트가 열려 있는 동안 계속 | **한 번의 실행마다 뜨고 죽는다** |
| 상태 | 대체로 무상태(문서 동기만) | **중단점·스레드·프레임·스코프** |
| 조달 | PATH 의 실행 파일 | **PATH 에 없는 경우가 더 많다** |

### 프레이밍은 그대로 쓴다 {#framing-shared}

`lsp/framing.rs` 는 이미 프로토콜과 무관하다 — `Content-Length` 를 읽고 바이트를
떼어 줄 뿐이다. **`src-tauri/src/framing.rs` 로 올려 두 프로토콜이 함께 쓴다.**
`dap` 이 `lsp` 를 임포트하게 두면 있지도 않은 계층 관계를 암시한다.

### 봉투는 JSON-RPC 가 아니다 {#envelope}

```jsonc
// 요청
{ "seq": 1, "type": "request", "command": "setBreakpoints", "arguments": { … } }
// 응답 — 상관 키가 `id` 가 아니라 `request_seq` 다
{ "seq": 7, "type": "response", "request_seq": 1, "command": "setBreakpoints",
  "success": true, "body": { … } }
// 이벤트 — 요청 없이 온다
{ "seq": 8, "type": "event", "event": "stopped", "body": { … } }
```

`success: false` 는 **전송 오류가 아니라 정상 응답**이다 (`message` 에 이유).
JSON-RPC 의 `error` 객체와 모양이 달라 `lsp/client.rs` 의 상관 코드를 그대로
쓸 수 없다 — `dap/protocol.rs` 를 따로 둔다.

### 줄 번호는 변환하지 않는다 {#one-based}

LSP 는 0-based 가 강제였고 JS 문자열도 UTF-16 이라 "통과시키기" 가 정답이었다.
DAP 는 **협상 가능**하다: `initialize` 에 `linesStartAt1: true`, `columnsStartAt1: true`
를 실어 보내면 어댑터가 1-based 로 말한다. CodeMirror 의 `line.number` 도 1-based다.

→ **1-based 로 협상하고 변환하지 않는다.** LSP 층과 숫자 규약이 다르다는 것이
유일한 주의점이라, 경계(`lsp_definition` → 코드 화면 점프)에만 주석으로 못 박는다.

### 순서를 가정하지 않는다 (실측) {#no-order}

명세는 "`initialize` 응답 → `initialized` 이벤트 → 설정 → `configurationDone`" 처럼
읽히지만, **같은 어댑터가 실행마다 다른 순서로 답했다**:

```
run A: initialize응답 → launch응답 → initialized
run B: initialize응답 → module → module → launch응답 → initialized
run C: initialize응답 → initialized → launch응답
```

→ 세션은 **순차 스크립트가 아니라 이벤트 구동 상태 기계**여야 한다. `initialized`
는 "이미 왔는지" 도 함께 보고 기다린다. `launch` 응답은 **기다리지 않고** 보낸
뒤, `initialized` 가 오면 설정을 밀어 넣고 `configurationDone` 을 보낸다.

### lldb-dap 은 `pathFormat` 을 요구한다 (실측) {#path-format}

`initialize` 에서 `pathFormat: "path"` 를 빼면 `success: false` 로 답하고 이후가
전부 조용히 망가진다. 명세상 선택 항목이지만 **항상 보낸다**.

## 어댑터 조달 — 여기가 LSP 와 가장 다르다 {#adapter-procurement}

LSP 서버는 넷 다 PATH 위의 실행 파일이었다. 디버그 어댑터는 **그런 것이 오히려 적다.**

| 언어 | 어댑터 | 조달 방식 | 이 기계에서 |
|---|---|---|---|
| Rust / C / C++ | `lldb-dap` | **Xcode 툴체인** — `xcrun -f lldb-dap` | ✅ `/Library/Developer/CommandLineTools/usr/bin/lldb-dap` (PATH 엔 없음) |
| Python | `debugpy` | **파이썬 모듈** — `python -m debugpy.adapter` | ❌ 미설치 |
| Go | `dlv` | **하위 명령** — `dlv dap` | ❌ 미설치 |
| TS / JS | `js-debug` | VS Code 확장 안 — `node dapDebugServer.js` | ❌ |

→ 레지스트리는 `command: &str` 하나로 부족하다. **해결 전략**을 값으로 든다:

```rust
enum Resolve {
    /// PATH 에서 이름으로 (LSP 와 같은 길).
    Path { command: &'static str },
    /// Xcode 툴체인 — `xcrun -f <name>`.
    Xcrun { name: &'static str },
    /// 인터프리터의 모듈 — `python3 -m debugpy.adapter`.
    Module { runner: &'static str, module: &'static str },
    /// 하위 명령 — `dlv dap`.
    Subcommand { command: &'static str, sub: &'static str },
}
```

**자동 설치는 하지 않는다** — LSP 와 같은 결정. 미설치는 설치 방법 안내로 끝낸다.

### 빌드가 선행한다 {#prelaunch}

Rust·Go 는 **디버그 심벌이 든 산출물이 먼저 있어야** 붙는다. LSP 에는 없던 단계다.
v1 은 만들어 주지 않는다 — 실행 구성에 `program`(산출물 경로)을 받고, 없으면
"먼저 `cargo build` 하세요" 라고 말한다. (자동 빌드는 어느 프로필로 어떤 타깃을
지을지가 곧 또 하나의 설정이 되고, 그 판단은 사용자 것이다.)

## 수명 — LSP 와 근본적으로 다른 부분 {#lifecycle}

LSP 서버는 `(project, language, root)` 로 **하나**가 오래 산다. 디버그 세션은
**실행 한 번**이다: 떴다가, 멈췄다가, 죽는다. 그래서 상태 모델도 다르다.

```
Idle ──launch──▶ Starting ──initialized──▶ Configuring ──configurationDone──▶ Running
                                                                                │  ▲
                                                                       stopped  ▼  │ continue/step
                                                                             Stopped
                     Running/Stopped ──terminated|exited|disconnect──▶ Ended
```

- **프로젝트당 세션 하나** (v1). 여러 개를 동시에 두면 "지금 어느 세션의 스택인가"
  가 UI 전체에 스며든다. 필요해지면 그때.
- **중단점은 세션보다 오래 산다.** 세션이 죽어도 찍어 둔 자리는 남아야 한다 —
  그래서 중단점 저장소는 세션이 아니라 프로젝트에 매단다.
- **끝은 반드시 알린다.** 어댑터가 죽거나 `exited` 가 오면 UI 를 Idle 로 되돌린다.
  LSP 의 "조용히 실패하지 않는다" 와 같은 원칙.

## 중단점 {#breakpoints}

- 에디터 거터를 눌러 토글한다 — git 거터 옆이다(`gitGutter.ts` 와 같은 자리 다툼).
- 저장소는 **파일 → 줄 집합**. 세션이 없어도 찍을 수 있고, 세션이 뜨면 그대로 밀어 넣는다.
- `setBreakpoints` 는 **파일 단위 전량 교체**다 (증분이 없다). 한 줄을 토글해도
  그 파일의 전체 목록을 다시 보낸다.
- 어댑터가 `verified: false` 로 답할 수 있다 (그 줄에 코드가 없음). **그 사실을
  거터에 그린다** — 찍었는데 안 걸리는 이유를 사용자가 알 수 없으면 고장으로 읽는다.
- 영속: 프로젝트별 `WorkspaceContext` 가 아니라 **`.oculpm/` 밖의 설정**도 아니다.
  v1 은 `WorkspaceContext` (탭·분할과 같은 자리) — 중단점은 "지금 하는 작업" 이지
  저장소에 커밋할 것이 아니다.

## 변수 — 지연 확장 {#variables}

`scopes` → `variables(variablesReference)` → 자식도 다시 `variablesReference`.
0 이 아니면 펼칠 수 있다는 뜻이다. **한 번에 다 읽지 않는다** — 큰 구조체에서
그러면 멈춘 순간 앱이 굳는다. 트리는 펼칠 때 읽는다(코드 트리의 지연 로딩과 같은 원칙).

## 호출 스택 — 프로젝트 밖 프레임 {#frames}

실측 스택의 세 번째 프레임은 `core::ops::function::FnOnce::call_once` 였다.
표준 라이브러리·런타임 프레임은 **지우지 않고 흐리게** 그린다 — 코드 트리가
gitignore 항목을 다루는 방식과 같다(있는 것은 보이되 성질은 밝힌다). 소스가 없어
열 수 없다는 것도 그 자리에서 말한다.

## 단계

- **PR-DAP0 — 파이프와 최소 세션** (이번 라운드): `framing` 공용화 · `dap/`
  (protocol·registry·client·session·state) · 커맨드 · 중단점 토글 + 거터 ·
  실행/정지/스텝 · 호출 스택 · 변수 트리 · 실행 구성 최소형. **lldb-dap 으로
  실제 Rust 바이너리에서 검증.**
- **PR-DAP1 — 나머지 어댑터**: debugpy · dlv · js-debug 조달 전략과 안내.
- **PR-DAP2 — 편의**: 조건부 중단점 · 예외 중단점 · 값 편집(`setVariable`) ·
  호버 평가(`evaluate`) · REPL.

## 하지 않는 것

- **역방향 디버깅·메모리 뷰·디스어셈블리** — `lldb-dap` 이 지원한다고 답하지만
  (`supportsDisassembleRequest` 등) 이 앱의 사용자가 그것을 찾을 자리가 아니다.
- **어댑터 자동 설치** — LSP 와 같은 이유.
- **원격 디버깅(attach to remote)** — 로컬 우선 원칙 밖.
