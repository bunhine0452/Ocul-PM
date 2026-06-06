# Ocul-PM

> AI 코딩 에이전트가 코드를 쓰는 동안, 당신은 **기록·관리·검증** 만 합니다.

Claude Code, Cursor, Gemini CLI 같은 외부 코딩 에이전트와 함께 일하는 개발자를 위한 **로컬-우선 AI 프로젝트 매니저** 입니다. 에이전트가 만든 변경을 자동으로 기록하고, 오늘 무엇이 바뀌었는지 한눈에 보여주고, 할루시네이션을 로컬 diff 로 즉시 검증합니다. 클라우드도, 계정도, 텔레메트리도 없습니다.

---

## Ocul-PM 이 해결하는 문제

외부 코딩 에이전트는 빠르지만, 며칠이 지나면 **무엇이 왜 바뀌었는지** 추적이 끊깁니다.

- 어제 Claude 에게 시킨 리팩토링이 어떤 파일들을 건드렸는지 기억나지 않습니다.
- Cursor 가 "수정했다" 고 한 코드가 실제로 동작하는지 별도 도구로 다시 확인해야 합니다.
- 여러 에이전트를 번갈아 쓰면 변경 이력이 도구마다 흩어집니다.
- 일주일이 지나면 "내가 이걸 왜 만들었지?" 라는 질문에 답할 수 없습니다.

Ocul-PM 은 이 간극을 메우기 위해 만들어졌습니다. 에이전트가 코드를 쓰고, Ocul-PM 이 **그들이 한 일을 사람이 읽을 수 있는 기록으로 남깁니다.**

---

## 핵심 기능

### 자동 작업 일지 (`.oculpm/journal/`)

프로젝트마다 `.oculpm/agents/` 에 마스터 프롬프트가 배포됩니다. AI 에이전트는 작업을 끝낼 때마다 이 규칙에 따라 `.oculpm/journal/YYYYMMDD/` 아래에 한 개의 markdown 파일을 작성합니다. 버그 수정, 기능 추가, 리팩토링, 에러 사이클, 잡일 — 다섯 가지 trigger 가 자동 분류됩니다.

- **단일 진실의 출처 (SSOT)** — 플랫 파일 markdown. DB lock-in 없음.
- **Git 친화** — journal 도 코드와 함께 커밋 가능. 팀이 PR 리뷰에서 함께 볼 수 있습니다.
- **시크릿 보호** — `.env`, `*.pem`, AWS credentials 등 30+ 패턴 자동 차단. AKIA / `sk-` / `ghp_` / Slack 토큰 등 정규식 기반 자동 redaction.

### 변경 파일 로컬 diff

에이전트가 "수정했다" 고 주장하는 모든 파일을 **네트워크 호출 없이** 로컬에서 즉시 비교합니다. Git 저장소면 `git diff` 경로, 아니면 file snapshot fallback 경로로 동작합니다. 할루시네이션 검증의 1차 방어선.

### 일일 브리프 (Today)

오늘 무엇이 바뀌었는지, 어제 무엇을 끝냈는지, 다음 우선순위는 무엇인지를 워크데이 경계로 정리합니다. 워크데이는 `Asia/Seoul` 등 사용자 타임존을 따르며, 자정 또는 사용자 설정 시각에 자동 롤오버됩니다.

### 통합 Planner

목표(goal) → 서브태스크 → journal entry 의 3 단계 위계로 장기 프로젝트를 관리합니다. AI 에이전트의 분 단위 작업을 사람이 정한 주 단위 목표에 묶습니다.

### 내장 터미널

`portable-pty` 기반 PTY + `xterm.js` 로 풀스크린 가능한 터미널을 내장. `claude-code "..."` 같은 CLI 명령을 별도 창 전환 없이 같은 앱에서 실행하면서, 일지가 자동으로 쌓이는 것을 옆에서 볼 수 있습니다.

### 멀티-LLM AI 패널

OpenAI / Anthropic / Google Gemini 를 같은 인터페이스로 사용합니다. API 키는 OS 키체인(macOS Keychain, Windows Credential Manager) 에 저장되며, 코드/설정 파일에 평문으로 남지 않습니다.

### 시맨틱 코드 검색 (로컬)

`tree-sitter` 로 Rust / TypeScript / JavaScript / Python / Go 의 AST 를 파싱하고, `fastembed` 로 로컬 임베딩을 생성한 뒤 `sqlite-vec` 에 저장합니다. **임베딩이 외부로 나가지 않습니다.** 검색은 모두 디스크에서 일어납니다.

---

## 기술 스택

Ocul-PM 은 **네이티브 데스크톱 앱** 입니다. Electron 이 아닙니다.

| 계층 | 기술 |
|---|---|
| 셸 | [Tauri 2](https://tauri.app) — Rust 백엔드 + 시스템 웹뷰. macOS dmg 번들 < 60MB. |
| 백엔드 | Rust 2021 · `tokio` · `rusqlite` (SQLite 번들드) · `sqlite-vec` (벡터 검색) |
| 코드 분석 | `tree-sitter` (Rust/TS/JS/Py/Go) · `fastembed` (로컬 임베딩) · `blake3` (콘텐츠 해시) |
| 파일 감시 | `notify` + `notify-debouncer-full` — gitignore 존중, 500ms 디바운스 |
| 일지 파서 | `gray_matter` (YAML frontmatter) · `pulldown-cmark` · `chrono-tz` (워크데이 경계) |
| 터미널 | `portable-pty` (PTY) · `xterm.js` + `@xterm/addon-fit` |
| 보안 | `keyring` (네이티브 키체인) · `rustls` (TLS) · 정규식 기반 시크릿 redaction |
| 프론트엔드 | React 19 · TypeScript 5.8 · Vite 7 · Tailwind 4 · `@xyflow/react` (의존성 그래프) · `recharts` |
| 타입 안전성 | `tauri-specta` 로 Rust ↔ TypeScript 양방향 타입 생성 |
| 테스트 | Vitest · Testing Library · `axe-core` (a11y) |

전체 데이터는 **프로젝트 폴더의 `.oculpm/` 디렉토리** 와 **로컬 SQLite** 에 머무릅니다. 앱이 외부로 보내는 네트워크 요청은 — 사용자가 명시적으로 호출한 LLM API 호출, 그것뿐입니다.

---

## 왜 로컬-우선인가

- **소유권** — 일지는 markdown 파일입니다. 앱이 망해도 데이터는 그대로 남습니다. `git clone` 으로 다른 머신에 옮기면 그대로 동작합니다.
- **개인 정보** — 코드, 임베딩, 작업 기록 어느 것도 우리 서버로 가지 않습니다. 우리 서버가 없기 때문입니다.
- **속도** — 콜드 스타트 < 1.5초. 검색은 디스크 I/O 가 한계입니다.
- **오프라인** — LLM 호출을 빼면 전부 오프라인에서 동작합니다.

---

## 누구를 위한 앱인가

- **외부 AI 코딩 에이전트를 일상적으로 쓰는 개발자.** Claude Code, Cursor, Aider, Gemini CLI, Antigravity 등.
- **개인 프로젝트 혹은 1~3인 팀.** 팀 클라우드 동기화는 v1.1 이후 로드맵.
- **터미널을 떠나기 싫지만, 변경 이력은 시각적으로 보고 싶은 사람.**
- **자기 코드와 데이터를 자기 디스크에 두는 것을 가치라고 느끼는 사람.**

---

## 설치 / 다운로드

최신 빌드는 **[GitHub Releases](https://github.com/bunhine0452/Ocul-PM/releases)** 에서 받습니다.

- **macOS** (Apple Silicon · Intel) — `.dmg` 다운로드 → 열어서 `Applications` 로 드래그.
  - 코드서명되지 않은 빌드라 첫 실행 시 Gatekeeper 경고가 뜨면: 앱을 **우클릭 → 열기**, 또는 `시스템 설정 → 개인정보 보호 및 보안` 에서 "확인 없이 열기".
- **Windows** 10/11 — `.msi` (후속 릴리즈 제공 예정).

### 업데이트 알림

앱을 켜면 GitHub Releases 의 최신 버전을 확인해, **새 버전이 있으면 우측 하단에 알림** 을 띄우고 다운로드 페이지로 안내합니다. 네트워크가 없거나 새 버전이 없으면 조용히 넘어갑니다. (앱 내 자동 다운로드·설치는 v1.1 로드맵.)

### 소스에서 빌드

```bash
pnpm install
pnpm tauri dev      # 개발 실행
pnpm tauri build    # 배포 번들 (.dmg / .app)
```

요구사항: Node 18+ · pnpm · Rust (stable) · (macOS) Xcode Command Line Tools.

---

## 라이선스 / 상태

**1.0 출시.** 개인 도구 성격이 강하며, 안정성과 단순함을 우선합니다. 이슈와 PR 환영합니다.

---

> Ocul-PM 은 AI 에게 빼앗긴 *"왜 이걸 만들었더라"* 의 답을 다시 손에 쥐는 도구입니다.
