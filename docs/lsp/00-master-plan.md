# LSP — 코드 인텔리전스 (설계 SSOT)

작성 2026-08-21 · 상태: PR-LSP0 진행 중

## 왜

앱에는 이미 코드 화면이 있다 — CodeMirror 6, 10개 언어 하이라이트, `code_tree`/`code_read`/`code_write`,
검색·코드맵에서 라인 점프, blake3 낙관적 잠금. **에디터로서는 동작한다.**

없는 것은 코드를 *이해하는* 층이다: 자동완성 · 인라인 진단 · 정의로 이동 · 호버 타입 ·
이름 바꾸기. 이것이 "에디터"와 "IDE" 를 가르는 선이고, 표준 창구는 LSP 하나다.

### 왜 VS Code 를 포크하지 않는가 (2026-08-21 결정)

Code-OSS 1.135.0 을 실제로 받아 놓고 비교한 뒤 접었다.

- `src/` 하나가 TS 8,572 파일 — ocul-pm 프런트엔드 전체(295)의 **29배**. 포크는 한 번이 아니라
  영원한 리베이스다.
- `product.json` 의 `extensionsGallery` 가 **`null`** — MIT 소스에 마켓플레이스는 없다.
  Open VSX 에는 Pylance·C/C++·C# Dev Kit·Remote-SSH·Dev Containers 가 없다(전부 MS 독점).
  "포크하면 생태계가 딸려온다" 는 성립하지 않는다.
- Electron 42 를 싣는 순간 24MB → 200MB대, 그리고 CLAUDE.md 첫 줄의 정체성
  ("Tauri 2 native, **not** Electron")이 뒤집힌다.
- 더 근본적으로, 이 제품의 해자는 에디터가 아니라 **에이전트 중립적 기록층**이다.
  `.oculpm/` 은 디스크가 SSOT 라 Claude Code·Cursor·Gemini CLI 어디에나 붙는다.
  한 에디터에 포크로 묶으면 그 성질을 스스로 버린다.

받아 둔 체크아웃은 **참고 자료**로 쓴다 (LSP 클라이언트·파일 감시·에디터 모델 구현을 읽는 용도).

## 재사용하는 기계

새로 만드는 것보다 이미 있는 것이 많다.

| 필요 | 이미 있는 것 |
|---|---|
| 서버 바이너리 조달 | `acp/env.rs` — `resolve_binary()` (로그인 셸 PATH), `effective_path()` |
| 자식 프로세스 수명 | `acp/process.rs` · `commands/terminal.rs` (PTY) 의 선례 |
| 스트리밍 | `Channel<AcpEvent>` 선례 → `Channel<LspEvent>` |
| JSON-RPC 2.0 | `oculpm/mcp/protocol.rs` (단, **프레이밍이 다르다** — 아래) |
| 파일 읽기/쓰기 | `commands/code.rs` — `code_read`/`code_write` |
| 라인 점프 | `CodeEditor` 의 `jumpLine` prop (정의로 이동이 그대로 재사용) |

## 설계

### 프레이밍 — MCP 와 다르다

MCP 는 개행 구분 JSON 이지만 **LSP 는 HTTP 스타일 헤더**를 쓴다:

```
Content-Length: 123\r\n
\r\n
{"jsonrpc":"2.0",...}
```

그래서 `mcp/protocol.rs` 를 재사용할 수 없고 `lsp/framing.rs` 를 따로 둔다. 순수 함수라
테스트 가치가 가장 높은 조각이다 (부분 수신·헤더 분할·잘못된 길이).

### 위치 인코딩 — 변환하지 않는 것이 정답

LSP 의 `Position.character` 는 기본이 **UTF-16 코드 유닛**이다. JS 문자열도 UTF-16 이라
프런트엔드와 LSP 는 **이미 같은 단위**다. Rust `String` 은 UTF-8 이라 중간에서 오프셋을
계산하면 거기서만 어긋난다.

→ **프런트가 `{line, character}` 를 만들고 그대로 받는다. Rust 는 통과시키기만 한다.**
한글 주석이 흔한 이 저장소에서 이 결정 하나가 오프셋 버그 한 부류를 통째로 없앤다.

### 서버 루트 — 프로젝트 루트가 아니다

`rust-analyzer` 는 Cargo 워크스페이스 루트(`src-tauri/`)를 원하지 프로젝트 루트(`ai-pm/`)가
아니다. 열린 파일에서 위로 올라가며 **루트 마커**를 찾는다.

```
ServerSpec { language, command, args, root_markers }
  rust  → rust-analyzer            · ["Cargo.toml"]
  ts/js → typescript-language-server --stdio · ["tsconfig.json","jsconfig.json","package.json"]
  python→ pyright-langserver --stdio · ["pyproject.toml","setup.py","requirements.txt"]
  go    → gopls                    · ["go.mod"]
```

서버 인스턴스 키는 `(project_id, language, root)` — 모노레포에서 워크스페이스마다 따로 뜬다.

### 문서 동기 — full sync

`textDocument/didChange` 는 증분(range) 과 전량(full) 을 다 지원한다. **전량으로 간다**:
증분은 CM6 의 `ChangeSet` 을 LSP range 로 번역해야 하고 그 번역이 틀리면 서버 문서가
조용히 어긋나 진단이 엉뚱한 줄에 붙는다. 코드 화면은 2MB 가드가 걸린 단일 파일 편집이라
전량 전송 비용이 문제되지 않는다. (증분은 필요해지면 그때.)

### 상태 — 조용히 죽지 않게

`rust-analyzer` 는 첫 인덱싱에 수십 초가 걸린다. 그동안 진단이 안 오는 것을 "안 붙었다" 와
구별할 수 없으면 사용자는 고장으로 읽는다. `$/progress` 와 프로세스 상태를 `LspEvent::Status`
로 올려 상태줄에 밝힌다. 서버가 없으면(미설치) 조용히 실패하지 않고 그 사실을 말한다.

### 이름 바꾸기 — 여기서만 위치를 변환한다 (PR-LSP2)

PR-LSP0~1 은 위치를 프런트에 맡겨 변환 지점을 없앴다. **이름 바꾸기는 그럴 수 없다** —
열려 있지 않은 파일까지 고치므로 편집을 Rust 에서 적용해야 하고, 그러려면
UTF-16 `(line, character)` 를 UTF-8 바이트 오프셋으로 옮겨야 한다.

그래서 변환을 **딱 한 곳**(`lsp/edit.rs`)에 두고 테스트로 잠근다. 한글이 든 줄,
이모지(서로게이트 쌍), CRLF, 줄 끝을 넘는 character 값이 시험 대상이다.

적용 규칙 — 실패 모드가 파괴적이라 전부 방어한다:

1. **전부 아니면 전무.** 모든 파일의 새 내용을 메모리에서 먼저 만들고, 하나라도
   실패하면 **아무것도 쓰지 않는다**. 부분 적용은 코드를 깨진 채로 남긴다.
2. **뒤에서부터 적용.** 한 파일 안의 편집은 시작 위치 **내림차순**으로 적용해야
   앞선 오프셋이 유효하게 남는다.
3. **겹치는 편집은 거부.** 서버가 보낼 일은 없지만, 오면 결과가 조용히 망가진다.
4. **프로젝트 밖 URI 는 거부.** 의존성 소스를 고치는 일은 없어야 한다.
5. **미저장 버퍼가 있으면 거부** (프런트 게이트). 서버는 `didChange` 로 받은
   **버퍼** 내용을 보고 편집을 계산하는데 우리는 **디스크** 에 적용한다. 둘이
   다르면 오프셋이 어긋나 엉뚱한 자리를 덮어쓴다. 저장을 먼저 요구한다.

되돌리기는 제공하지 않는다 — 다중 파일 undo 스택을 만드는 대신 git 에 맡긴다
(이 앱은 변경 diff 화면을 이미 갖고 있다). 대신 무엇을 바꿨는지 파일·건수로 보고한다.

## 단계

- **PR-LSP0 — 파이프** (이번 라운드): framing · registry · client · state · 커맨드 ·
  `Channel<LspEvent>` · 프런트 진단 밑줄 + 자동완성. rust-analyzer 로 실제 `src-tauri/` 에서 검증.
- **PR-LSP1 — 호버 · 정의로 이동**: 정의로 이동은 기존 `jumpLine` 핸드오프 재사용.
- **PR-LSP2 — 이름 바꾸기 · 코드 액션**: `code_write` 의 낙관적 잠금과 함께 가야 한다
  (서버가 준 편집을 적용하는 동안 파일이 바뀌었을 수 있다).
- **PR-LSP3 — 설정·다중 언어**: 설정 화면에서 서버 경로 오버라이드·켜기/끄기, 미설치 안내.

## 하지 않는 것

- **디버거(DAP)** — LSP 로 안 닫힌다. 에이전트가 코드를 쓰는 워크플로에서 인앱 디버거의
  우선순위는 낮다고 판단. 필요해지면 별도 결정.
- **확장 호스트** — 포크를 접은 이유와 같다.
- **서버 자동 설치** — 조용히 네트워크를 타고 바이너리를 받는 일은 이 앱의 로컬 우선
  원칙과 맞지 않는다. 미설치는 설치 방법을 안내하는 것으로 끝낸다.
