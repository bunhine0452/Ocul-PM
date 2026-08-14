---
schema_version: 1
type: feature
slug: "terminal-escape-hatch-for-cli-only-features"
status: done
difficulty: medium
created_at: "2026-08-15T07:21:14+09:00"
session_id: "mcp-20260815-072114"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/terminalLaunch.ts"
    op: create
  - path: "src/__tests__/terminal_launch.test.ts"
    op: create
  - path: "src/features/terminal/TerminalInstanceImpl.tsx"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags:
  - "acp"
  - "terminal"
  - "architecture"
  - "benchmark"
  - "mcp-tool"
---
[x] 터미널 탈출구 — ACP 가 못 닿는 CLI 기능은 진짜 셸에서 (orca 벤치마크)

## orca 를 뜯어보고 내린 결론

`stablyai/orca` 는 ACP 를 안 쓴다. `src/shared/tui-agent-config.ts`:

```ts
claude: { detectCmd: 'claude', launchCmd: 'claude',
          promptInjectionMode: 'argv', draftPromptFlag: '--prefill' }
```

`node-pty` 로 진짜 터미널에 CLI 를 띄우고 TUI 를 렌더한다. README 의 "if it runs in a terminal, it runs in Orca" 가 문자 그대로다 — 지원 에이전트 37개도 프로토콜 구현이 아니라 터미널 렌더라서 가능한 숫자다. `/remote-control` 이 되는 이유도 같다: CLI 의 대화형 UI 가 통째로 살아 있다.

**우리가 갈아탈 이유는 없다.** 도구 카드·권한 승인·대화별 기록·진행 레일은 전부 `session/update` 가 타입 있는 데이터라서 가능한 것들이고, PTY 로 가면 ANSI 이스케이프가 된다. 무엇보다 이 앱의 전제(에이전트가 한 일을 일지로 남긴다)가 구조를 요구한다.

대신 ACP 의 실제 비용은 인정한다: 2주에 여러 번 배포되는 0.x 어댑터에 매여 있고, CLI 에 있는 기능도 어댑터가 노출하기 전엔 못 쓴다.

## 그래서 탈출구를 둔다

**우리에겐 이미 터미널이 있다.** 갈아타지 않고 문 하나만 냈다 — 툴바의 터미널 버튼, 그리고 `/rc` 를 치면 그리로 보낸다.

몇 가지 판단:

- **첫 명령은 일회용 등록소에** 둔다. 탭에 얹어 영속화하면 그 탭을 다시 열 때마다 `claude` 가 또 뜬다 — 사용자는 셸을 이어 쓰려고 돌아온 것이다. 그래서 **갓 뜬 셸에만** 치고(재접속 갈래는 건드리지 않는다) 꺼내면서 지운다.
- **`--prefill`** 을 쓴다(orca 에서 가져온 것). 입력만 채우고 보내지 않는다 — 사람이 읽고 고칠 틈이 이 길의 요점이다.
- **셸 인용**을 반드시 한다. 프롬프트에는 사용자가 쓴 아무 글자나 들어오고, 감싸지 않으면 백틱·`$`·`;` 하나에 엉뚱한 명령이 실행된다.

`/remote-control` 은 앞서 `_meta` 로 CLI 플래그를 넘기는 길을 열어 뒀지만(`acp_start_remote_control`), 짝짓기 안내가 CLI 의 **화면 출력**이라 ACP 위로 올라오지 않는다 — 켜져도 쓸 수가 없다. 터미널에서는 그 출력이 곧 화면이라 그냥 된다.

## 걸린 것 둘

- lint 의 주석 스트리퍼가 **따옴표를 품은 정규식 리터럴**(`/'/g`)에서 상태를 잃고, 그 뒤 주석을 통째로 코드로 읽었다. 정규식을 안 쓰는 쪽으로 바꿨다.
- `replaceAll` 은 tsconfig 의 `lib` 보다 최신이라 타입이 없다. `split`/`join` 으로.

## 남은 빚

`TerminalScreenV2` 안의 `newId` 와 이 모듈의 `newPtySessionId` 가 **같은 규격을 두 번 적고 있다**(`p<projectId>-` 접두사는 Rust 의 `pty_prefix_for` 와 짝이라 어긋나면 좀비 셸 정리가 조용히 실패한다). 그 파일을 지금 다른 작업이 잡고 있어 손대지 않았다 — 풀리면 한 곳으로 모을 것.

## 검증

typecheck 0 · 프런트 853(런처 10건 추가) · lint 0 · build 0 · 백엔드 전 스위트.

**미확인**: 실제로 셸이 뜨고 `claude` 가 실행되는지는 눌러 봐야 안다.