---
schema_version: 1
type: feature
slug: "en-landing-shots-and-acp-today-fallback"
status: done
difficulty: medium
created_at: "2026-09-11T22:54:49+09:00"
session_id: "20260911-013"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "e844171e-1cc7-43d6-92e2-254120fb4e99"
language: "ko"
verified_by_user: false
files_touched:
  - path: "landing/shots/en/01-today.jpg"
    op: create
  - path: "landing/shots/en/02-journal.jpg"
    op: create
  - path: "landing/shots/en/03-diff.jpg"
    op: create
  - path: "landing/shots/en/04-graph.jpg"
    op: create
  - path: "landing/shots/en/05-terminal.jpg"
    op: create
  - path: "landing/shots/en/08-receipt.jpg"
    op: create
  - path: "landing/shots/en/s2.jpg"
    op: create
  - path: "landing/en/index.html"
    op: update
  - path: "landing/en/keynote.html"
    op: update
  - path: "src/features/shell/ShellV2.tsx"
    op: update
  - path: "src/__tests__/shell_acp_view_no_today_fallback.test.tsx"
    op: create
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
  - path: "scripts/check-no-localstorage.mjs"
    op: update
related: []
tags:
  - "landing"
  - "english"
  - "screenshots"
  - "regression"
  - "tcc"
  - "automation"
  - "mcp-tool"
---
[x] 영문 랜딩 스크린샷 7장 — 설치본을 직접 조작해 촬영, 그 길에 잡은 회귀 둘(ACP 위 Today 폴백 · 툴바 날짜 로케일)

v3-release `{#en-shots}` — `landing/en/index.html` 이 한국어 스샷을 가리키고 `landing/shots/en/` 이 없었다. 사용자가 「네가 스스로 띄우고 찍어」라 해서 **설치본(2.47.0)을 내 손으로 조작해** 찍었다.

## 추가 기능

**1. 촬영 경로 — dev 가 아니라 설치본.** dev 를 띄우면 같은 번들 id 라 오늘 넣은 single-instance 가 설치본으로 흡수하고, id 를 바꾸면 빈 앱데이터(어댑터 재설치·대화 재생)가 된다. 대신 **화면 기록 + 손쉬운 사용** 두 TCC 권한을 Ocul-PM 에 받아 내장 터미널의 자식(이 세션)이 `screencapture -l <창id>` 와 CGEvent(클릭·드래그·스크롤, swift 4개)·AppleScript `keystroke`(⌘단축키) 로 앱을 몰았다. 두 권한 모두 "켰는데 안 먹는" 함정을 밟았다: (a) 권한은 프로세스 생성 시점에 적용되고 PTY 호스트는 앱 재시작을 살아남으므로 호스트를 죽여야 한다(메모리 `ptyhost-outlives-tcc-grants`), (b) 오늘 13:27 자동 업데이트가 번들을 갈아 끼워 **TCC 항목이 낡아** 스위치가 켜져 있어도 무효 — `tccutil reset <service> com.kimhyunbin.ocul-pm` 으로 항목을 지우고 프롬프트를 다시 띄워야 했다(AX 는 `AXIsProcessTrustedWithOptions(prompt)` 로 띄움).

**2. 7장.** 설정을 English·Dark·초록 액센트로 바꾸고(원래 한국어·Light·빨강 — 끝나고 되돌림, 사이드바 접힘도 복원) 기존 한국어 스샷과 같은 구도로: Today · Work Journal · Diff(GraphScreenV2 hunk) · Code Map(file·Organic 39파일 87관계) · 터미널 도크(⌘J, 페인 하나 확대) · 끝난 턴+영수증(README.en.md 한 줄 추가를 시켜 Edit 카드 + 「5 tools · 3 commands · 2m 55s」) · 승인 카드(Manual 모드에서 그 Edit 의 diff 가 든 카드; 첫 시도는 Bash printf 였고 「Edit 도구로」라 다시 시켜 diff 카드를 받았다). 둘 다 **거절**해 README 는 무변경. 창 1512×949 → 2x 캡처 → 1600×1004 jpeg 88. `en/index.html`·`en/keynote.html` 의 `src` 7+7 곳을 `/shots/en/` 으로, 높이 1128/1164→1004.

**3. 찍다 잡은 회귀 둘.**
- **ACP 화면 위에 Today 툴바가 얹힘.** `b3984c2`(09-06) 가 라우터 사슬의 마지막 갈래를 `null`→Today 로 바꿨는데, Claude Code/Codex 는 **keep-alive 컨테이너가 따로 그리므로** 사슬에선 폴백으로 떨어져 Today 가 ACP 뒤에 통째로 마운트됐다(스샷에 「Today 2026년 9월 11일 금」 툴바가 ACP 탭 줄 위에 보였고 브리프 IPC 도 이중). 그 두 뷰만 `null` 로. 회귀 테스트 `shell_acp_view_no_today_fallback` — ShellV2 를 마운트해 툴바 1개·Today 제목 없음을 단언(수정 전엔 `['오늘 현황']` 로 실패 확인).
- **툴바 날짜가 영어 모드에서도 한국어** — `ShellV2.tsx` 의 `toLocaleDateString("ko-KR")` 하드코딩 → `lang` 을 따른다.

## 검증

- main(`5271bea`, 다른 세션이 2.48.0 으로 올린 상태) 워크트리에 13파일만 얹어 `typecheck` · `test` 215파일 2706건 · `lint` 6게이트 · `build` · `node landing/wiki-src/build.mjs` 전부 exit 0. 랜딩을 로컬 http 로 띄워 Chrome 에서 `/shots/en/*` 이 실제로 로드되는지 확인. 커밋 `c938e0f`.
- 스크린샷 안의 조작 흔적(Today 「Agents involved 1 files」·한국어 날짜)은 2.47.0 의 것 — 둘 다 main 에서 고쳐졌으니 3.0.0 뒤 한 번 더 찍으면 사라진다.
- 부작용 하나: 키 입력이 한 번 다른 세션의 터미널로 새어 `/mod` 가 입력창에 남았다 → Ctrl-U·Esc 로 지웠다. 앞으로 타이핑 전엔 포커스를 스샷으로 확인한다.