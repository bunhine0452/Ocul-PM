---
schema_version: 1
type: feature
slug: "terminal-overhaul-panes-persist"
status: done
difficulty: high
created_at: "2026-07-20T19:57:45+09:00"
session_id: "mcp-20260720-195745"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/TerminalScreenV2.tsx"
    op: update
  - path: "src/features/terminal/TerminalInstanceImpl.tsx"
    op: update
  - path: "src/features/terminal/TerminalInstance.tsx"
    op: update
  - path: "src/lib/termPanes.ts"
    op: create
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src/components/Icons.tsx"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/__tests__/term_panes.test.ts"
    op: create
  - path: "src/lib/bindings.ts"
    op: update
  - path: "package.json"
    op: update
related: []
tags:
  - "terminal"
  - "ui"
  - "panes"
  - "persistence"
  - "xterm"
  - "dogfooding"
  - "mcp-tool"
---
[x] 터미널 대규모 개편 — 분할 페인·세션 지속·검색·Warp풍 크롬 (iTerm2/cmux 참조)

## 추가 기능

[pty-utf8-chunk-split-mojibake] 버그 fix 와 함께 나간 터미널 화면 전면 개편.

1. **세션 지속(cmux 핵심)** — PTY 를 화면 이탈 시 죽이지 않고(`persistent`), 백엔드가 세션별 스크롤백 링버퍼(200KB)+단조 seq 를 유지. 재마운트 시 신규 `attach_pty_session` 스냅샷을 리플레이하고 seq 로 라이브 이벤트 중복을 걸러 이어붙인다. kill 은 탭/페인 닫기에서만. 동시 start 경합은 insert 원자화로 늦은 쪽 child 를 drop, 셸 자체 종료(exit)는 EOF 에서 맵을 걷어내 다음 마운트가 새 셸을 받게 함. Today 빠른 터미널은 기존(휘발) 의미 유지.
2. **분할 페인(iTerm2)** — 탭당 이진 트리 레이아웃(`src/lib/termPanes.ts`, 순수·불변). ⌘D 가로/⇧⌘D 세로 분할, 드래그 리사이즈(로컬 오버레이 + pointerup 커밋, 15~85% 클램프), 포커스 링, 포커스 승계(siblingSid), 페인 닫기(⌘W, 마지막이면 탭 닫기). `WorkspaceContext.TerminalTab.panes/focusSid` 로 영속.
3. **탭 스트립 재설계(Warp)** — 다크 크롬 일체형(#101014/#16161c), 더블클릭 인라인 리네임, 호버 닫기, 스트립 내 + 버튼.
4. **xterm 애드온** — Unicode11(한글·이모지 셀 폭), WebLinks(URL 클릭 → 백엔드 open_url, opener scope 재발 패턴 회피), Search(⌘F 오버레이: incremental + Enter/⇧Enter, Esc 복귀 포커스).
5. **글자 크기** — ⌘+/⌘-/⌘0, 상태바 A−/A+ 버튼, `terminalFontSize` 영속, 열린 터미널에 라이브 반영(refit+PTY resize).
6. **하단 상태바** — 탭·페인 수, 단축키 힌트, 글자크기, `.oculpm` 감시 상태(툴바 chip 은 검색/분할/새 세션 버튼으로 교체).

## 동작 흐름

- 마운트: listen 등록 → `attachPtySession` → 스냅샷 있으면 리플레이(+seq 필터), 없으면 `startPtySession`(idempotent) → onData/resize 연결.
- 분할: 포커스 leaf 를 split(기존, 새 sid)로 치환 → 새 페인 autoFocus. 인스턴스별 ResizeObserver 가 fit+resizePty.
- 화면 단축키는 ref 경유 단일 리스너(⌘T/W/D/F/±/0) — 화면 unmount 시 해제되고 PTY 는 백엔드에 남는다.

## 검증

- `cargo test` 390 / `pnpm test` 194(신규 termPanes 5 포함) / typecheck / lint / build 전부 exit 0 직접 확인.
- 분할 트리 변형(분할·제거·비율 클램프·포커스 승계·불변 참조 보존) 테스트 고정.
- 실기기 체감(분할 드래그, 세션 지속 재접속, 한글 IME 조합, 검색)은 사용자 확인 필요.