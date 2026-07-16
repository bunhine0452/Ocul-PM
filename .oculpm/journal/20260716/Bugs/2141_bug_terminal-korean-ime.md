---
schema_version: 1
type: bug
slug: terminal-korean-ime
status: done
difficulty: medium
created_at: "2026-07-16T21:41:00+09:00"
session_id: "20260716-m01"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/commands/terminal.rs
    op: update
  - path: src/features/terminal/TerminalInstanceImpl.tsx
    op: update
  - path: src/styles/screens.css
    op: update
related: []
tags: ["terminal", "korean", "ime", "pty", "locale", "d2coding"]
---

[x] 터미널 한국어 입력 깨짐 — PTY 로케일 부재 + 한글 셀 폭 불일치 + 조합 미리보기 무스타일

## 발생 원인

세 겹의 원인이 겹쳐 "한국어가 잘 안 쳐지는" 체감을 만들었다:
1. **PTY 가 C 로케일로 뜸** — `start_pty_session` 이 `TERM` 만 설정했다. Finder 로
   실행된 .app 은 `LANG` 이 비어 있어 zsh ZLE 가 멀티바이트(한글)를 바이트 단위로
   다룬다 → 조합 깨짐, 백스페이스가 자모를 쪼갬, 에코 깨짐. (근본 원인)
2. **셀 폭 불일치** — xterm fontFamily 가 SF Mono 선두라 한글 글리프는 시스템 고딕
   폴백으로 렌더 → 반각×2 셀 폭과 어긋나 겹침/들쭉날쭉.
3. **조합 미리보기 무스타일** — xterm `.composition-view` 가 기본 무스타일이라
   조합 중인 글자가 안 보였다.

## 해결 방법

1. terminal.rs: `LANG` 이 비어 있으면 `en_US.UTF-8`, `LC_ALL`/`LC_CTYPE` 둘 다
   없으면 `LC_CTYPE=UTF-8` 를 PTY env 에 보장 (기존 값은 존중).
2. fontFamily 를 **D2Coding 선두**로 — 이미 앱에 번들된 한글 2:1 고정폭 subset
   (App.css @font-face)이라 네트워크 없이 셀 폭이 정확히 맞는다.
3. screens.css: `.term-screen .xterm .composition-view` 에 터미널 배경/전경 +
   액센트 밑줄 스타일 — 조합 중 글자가 또렷이 보인다.

## 검증

- cargo test 전체 그린 (env 로직은 스폰 경로라 단위테스트 대신 코드검토),
  프런트 게이트 4종 exit 0.
- 실기기 한글 타이핑(조합·백스페이스·zsh 편집) 확인은 미수행 — 앱 재실행 후
  새 터미널 세션에서 확인 필요 (기존 세션은 옛 env 유지).

## 메모

- unicode11 애드온은 추가하지 않음 — 한글 음절 폭은 v6 wcwidth 로도 wide 처리되고,
  체감 문제는 로케일/폰트가 원인이었다. 이모지 폭 이슈가 보이면 그때 추가.
