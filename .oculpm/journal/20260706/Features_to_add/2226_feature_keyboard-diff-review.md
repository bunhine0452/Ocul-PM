---
schema_version: 1
type: feature
slug: keyboard-diff-review
status: done
difficulty: medium
created_at: "2026-07-06T22:26:00+09:00"
session_id: "20260706-m01"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src/features/diff/DiffScreenV2.tsx
    op: update
  - path: src/styles/screens.css
    op: update
  - path: src/__tests__/diff_v2.test.tsx
    op: update
related: []
tags: ["v2-release", "U8", "P1", "keyboard", "diff"]
---

[x] U8 키보드 diff 검토 — j/k 파일 이동 + `/` in-diff 검색 + n/N 매치 점프

## 추가 기능

- **j/k**: 파일 리스트 표시 순서(그룹/평면 동일 배열) 그대로 선택 이동 — 선택 즉시 diff 로드, 활성 행 scrollIntoView(nearest). 경계에서 멈춤(순환 없음). 입력 필드 포커스 중엔 무시, 수식키 조합 무시.
- **`/` in-diff 검색**: diff-bar 의 소형 인풋 포커스. Enter/n=다음 매치, Shift+Enter/N=이전, Esc=해제. 매치 카운트 "3/17" 표시. 매치는 렌더된 `.dl` 라인의 textContent 를 그때그때 수집 — PatchView(하이라이트 HTML) 내부 무침습. 현재 매치는 `.dl-hit` 아웃라인 + scrollIntoView(center).
- 리스트 헤더에 `j k 이동 · / 검색` kbd 힌트 1줄 (백로그 P1 의 발견가능성 요건).
- 쿼리/파일/모드 변경 시 매치 커서 리셋. jsdom 호환 위해 `scrollIntoView?.()` 옵셔널 호출.

## 동작 흐름

diff 화면에서 손을 마우스로 옮기지 않고: j/k 로 파일 순회 → `/` 로 검색어 입력 → Enter·n 으로 매치 순환 → ⌘ 없이 검토 흐름 완결. 검토 토글(x)·hunk 확장은 P2 검토 세션으로 이월 (설계서 §3 명시).

## 검증

- 신규 vitest "j/k 가 파일 선택을 이동한다": 기본 선택→j→k 이동, 경계 정지, 인풋 포커스 중 무시. diff_v2 스위트 11/11 통과.
- 게이트: typecheck=0 / test=0 / lint=0 / build=0.
