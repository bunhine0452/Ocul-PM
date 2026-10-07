---
schema_version: 1
type: bug
slug: "monaco-widget-font-ramp-regression"
status: done
difficulty: low
created_at: "2026-10-07T20:41:47+09:00"
session_id: "20261007-004"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fdeb6d9e-9327-4e65-8f8a-4524621720ff"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/code/code.css"
    op: update
related: []
tags:
  - "design"
  - "design-tokens"
  - "monaco"
  - "mcp-tool"
---
[x] 편집기 우클릭 메뉴·자동완성 글자가 옛 램프 번호로 1~4px 크게 그려지던 것

## 발생 원인

2026-09-09 22:04 `488b6fc` 가 글자 램프를 13단 → 10단으로 재번호했다(반 단은 위로: 10.5→11 · 11.5→12 · 12.5→13). 46분 뒤 `770b7f88`(편집기 위젯 테마)이 **옛 번호**로 일곱 줄을 넣었다 — 옛 `--fs-7` 은 13px, 새 `--fs-7` 은 17px 다. 그래서 13px 편집면 위에 우클릭 메뉴 17px · 이름 바꾸기 칸 15px · 피크 파일명 15px · 자동완성 목록 14px 이 떴다. 근거: 그 절의 주석이 "앱의 `.code-ctxmenu` 와 같은 얼굴" 이라 적는데 `.code-ctxmenu-item` 은 새 램프 `--fs-4`(13px)다. 화면 머리 크기 판정(같은 날)을 조사하다 `--fs-7` 이상을 전수로 보며 찾았다.

## 해결 방법

재번호 규칙 그대로 되돌렸다 — 자동완성 행·제안 본문·찾기 개수·피크 목록 → `--fs-3`(12), 우클릭 메뉴·피크 파일명·이름 바꾸기 → `--fs-4`(13). 재번호 직후 30분 안에 들어온 다른 커밋 둘(`f566c19b` 설정, `b22d6155`)은 새 램프를 쓴 것으로 확인했다(뒤의 것은 `488b6fc` 를 직접 인용한다). 줄 수는 늘리지 않았다(code.css 2356줄, 래칫).

## 검증

- `design_ratchets`·`design_tokens`·파일 크기 래칫 93 통과, `pnpm lint`·`build` 통과. PR #71.
- 실기기 미확인 — 우클릭 메뉴·자동완성 크기는 설치본에서 (`compact-chrome` {#eyes-compact-chrome}).