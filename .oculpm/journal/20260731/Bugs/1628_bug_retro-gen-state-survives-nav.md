---
schema_version: 1
type: bug
slug: "retro-gen-state-survives-nav"
status: done
difficulty: medium
created_at: "2026-07-31T16:28:25+09:00"
session_id: "mcp-20260731-162825"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/retro/retroGen.ts"
    op: create
  - path: "src/features/retro/RetroScreenV2.tsx"
    op: update
  - path: "src/features/terminal/dispatchBus.ts"
    op: update
related: []
tags:
  - "retro"
  - "state-bus"
  - "ux"
  - "monitoring"
  - "mcp-tool"
---
[x] 회고 생성 중 화면 이탈 시 초기화 — 생성 상태를 전역 버스로 승격

## 발생 원인

`generating` 상태와 `generateRetro` 호출 결과 처리가 RetroScreenV2 **컴포넌트 로컬**에 있었다. 다른 화면으로 가면 컴포넌트가 언마운트되어 상태가 사라지고, 백엔드 호출은 계속 돌아 DB 에 캐시되지만 재마운트된 화면은 그 사실을 모른다 — 사용자는 "생성 중"이 사라지고 결과도 안 보이는 초기화를 목격. 진행 상황 표시도 스피너뿐이라 모니터링 수단이 전무했다.

## 해결 방법

- **retroGen.ts 전역 버스**(dispatchBus 와 같은 모듈 싱글턴): 생성 시작·완료·결과를 모듈이 소유. 화면 복귀 시 useSyncExternalStore 로 재연결되어 "생성 중…"이 이어지고, 부재 중 완료는 lastDone 으로 보관했다가 재마운트 시 입양 + 전역 토스트("회고가 준비됐어요")
- **모니터링**: 버튼 라벨에 경과 초 + provider/model 실시간 표시 ("생성 중… 12초 · anthropic/claude-…")
- 적대 리뷰(react) 반영: **(MED)** invoke 미종결 시 전역 슬롯 영구 잠금 → 3분 시효 + 소유자 확인(finally 가 자기 run 일 때만 해제), 재마운트 refetch 의 null 이 입양 결과를 덮는 경합 → range 일치 시 유지 가드, 디스패치 버튼 연타 가드, dispatchBus 다중 생산자 latest-wins 문서화. 자정 경계(rangeKey 재계산)는 알려진 한계로 주석 명시.

## 검증

typecheck/vitest/build/lint 전부 exit 0. 시나리오 수동 점검 경로: 생성 시작 → 타 화면 → 복귀(생성 중 유지) / 부재 중 완료 → 복귀(결과 입양) — 실기기 확인은 사용자 A0d 라운드에 동승.