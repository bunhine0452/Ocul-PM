---
schema_version: 1
type: chore
slug: mobile-bridge-plan
status: done
difficulty: medium
created_at: "2026-08-24T10:26:00+09:00"
session_id: "manual-20260824-102600"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: ".oculpm/planner/mobile-bridge.md"
    op: create
related: []
tags: [mobile, tailscale, planner, design]
---

[x] 모바일 브리지 설계 — Tailscale 로 폰에서 ocul-pm, 플랜 확정

"orca 처럼 네이티브 앱을 만들까" 질문에서 출발. 데이터(`.oculpm/`·git·키체인)가
전부 맥에 있어 모바일은 어떤 형태든 원격 클라이언트라는 구조적 사실에서
**헤드리스 서버(axum 인프로세스) + 기존 React 프런트 PWA 재사용**으로 결론.
Tauri 모바일 빌드·네이티브 앱 기각. Phase 0(SSH 검증) 생략, 호스트=맥북 —
사용자 결정.

설계 전 실측: 커맨드 251개 / 이벤트 25종 / HTTP 서버 의존성 0 / bindings.ts
가 `__TAURI_INVOKE` 단일 통로 / 파라미터 분포 State 262·AppHandle 57·Window 7
·Channel 1. 이 분포 덕에 "커맨드 리팩토링 대공사" 우려가 기각됨 — 인프로세스
axum 이 `app.state::<T>()` 로 커맨드 함수를 직접 호출 가능. 화면별 grep 으로
실사용 커맨드를 추적해 ~50개 화이트리스트를 표로 확정 (삭제류·secret_set·ACP
제외).

결정 7건을 플랜에 잠금: 원격≠네이티브 / 인프로세스 서버 / invoke 미러링+vite
alias 셤 / 커맨드 화이트리스트 / Tailscale 100.64/10 전용 바인드+Bearer 토큰
+Funnel 금지 / MobileShell 전용(ShellV2 비재사용) / 잠자기 한계 정직 고지.
Phase MB0~MB4, 항목 18개.

## 검증

- 실측 수치는 전부 이 세션에서 grep/wc 로 직접 확인 (추정 아님).
- 플랜 파일이 AGENTS.md §4 규격(frontmatter·{#id} 줄끝·plan-log 블록)을 따르는지
  기존 활성 플랜(three-features-round·ide-completion)과 대조.

## 메모

- ACP 원격(폰에서 에이전트 구동)이 실은 최대 매력 — v1 범위 통제로 보류했고
  MB4 회고에서 v2 판정.
- iOS 16.4+ PWA Web Push 지원이라 알림도 네이티브 사유가 아님.
