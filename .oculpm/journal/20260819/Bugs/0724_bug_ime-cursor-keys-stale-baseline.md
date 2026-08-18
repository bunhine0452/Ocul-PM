---
schema_version: 1
type: bug
slug: "ime-cursor-keys-stale-baseline"
status: done
difficulty: medium
created_at: "2026-08-19T07:24:00+09:00"
session_id: "manual-20260819-072400"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/imeBridge.ts"
    op: update
  - path: "src/__tests__/ime_bridge.test.ts"
    op: update
related: [".oculpm/journal/20260818/Bugs/2011_bug_hangul-doubles-on-composing-backspace.md"]
tags: ["terminal", "ime", "hangul", "claude-code"]
---

[x] 터미널 IME 브리지 — 커서 이동·Escape 가 부기 기준선을 리셋하지 않던 것

## 발생 원인

버그 헌팅 라운드에서 발견한 구조적 공백. keydown 갈래가 Enter/Tab(항상),
Backspace/Delete(`!imeKey` 일 때)만 `endSession()` 하고, **화살표·Home/End·
PageUp/Down·Escape 는 그대로 통과**시켰다. macOS 입력기는 커서 이동 키에서
조합을 확정하는데, 브리지의 `syncEcho` 는 절대 위치 없이 "마지막으로 보낸
문자열"과의 공통 접두사 diff 로만 DEL 수를 계산한다 — 셸 커서가 `echoed` 의
끝에서 떠난 뒤에도 기준선이 살아 있으면, 다음 조합의 DEL 이 이동한 커서 옆의
**엉뚱한 글자**를 지울 수 있다 (vim 에서 한글 입력 직후 Esc 도 같은 계열).

에이전트가 HIGH 로 올린 "조합 중 붙여넣기가 앞 글자를 남긴다"는 **기각** —
macOS 네이티브 동작이 정확히 '조합 커밋 후 붙여넣기'(= `ㅅtest`)라, 제안된
DEL 선발사는 오히려 사용자가 친 글자를 지우는 회귀가 된다.

## 해결 방법

`SESSION_END_KEYS`(Backspace·Delete·화살표 4종·Home/End·PageUp/Down·Escape)
셋으로 묶어 `!imeKey` 일 때 `endSession()` — v2.13.1 이 세운 판정 축(조합 키는
전부 keyCode 229)을 그대로 따르므로, 조합 내비게이션(229)은 종전대로 세션을
유지한다. 검증된 기존 경로(Enter/Tab/229 계열)는 변경 없음.

## 검증

ime_bridge 회귀 3건 신규 — ① 비조합 ArrowLeft 후 새 조합이 DEL 없이 시작,
② 조합 중(229) 화살표는 세션 유지(교체분에 DEL 유지), ③ 비조합 Escape 리셋.
17건 전부 통과. 실기기 IME 조합 자동화는 불가라 단위 수준 검증 — 이 파일의
재발 이력을 감안해 변경을 기존 `!imeKey` 브랜치 확장으로만 한정했다.

## 메모

에이전트 리뷰의 LOW(NBSP 정규화 과광역)는 실피해 시나리오가 없어 보류.
