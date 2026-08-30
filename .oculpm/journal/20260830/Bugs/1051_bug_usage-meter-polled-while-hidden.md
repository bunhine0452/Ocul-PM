---
schema_version: 1
type: bug
slug: usage-meter-polled-while-hidden
status: done
created_at: 2026-08-30T10:51:00+09:00
session_id: "manual-20260830-105100"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
difficulty: verylow
files_touched:
  - path: src/features/chat/AcpUsageMeter.tsx
    op: update
related: []
tags: [acp, polling, audit-round]
---

[x] 사용량 미터가 Claude Code 화면을 떠나 있어도 8초마다 백엔드를 두드렸다

## 발생 원인

`AcpUsageMeter` 의 `setInterval(read, 8_000)` 에 가시성 게이트가 없었다. Claude Code 화면은 keep-alive(`display:none`)라 언마운트되지 않으므로 다른 화면에 가 있어도 타이머가 영원히 돌았다. 같은 파일의 `AcpConversation` 은 4초 폴링을 `isVisible()` 로 막고 있어 한쪽만 빠져 있던 것이다.

## 해결 방법

기존 `wrapRef` 로 `getClientRects().length` 가 0 이면(숨김) `read()` 를 건너뛴다. 돌아오면 다음 tick 이 따라잡는다.

## 검증

`pnpm typecheck` · `pnpm test`(1450) 그린. 감사가 함께 지적한 "플래너 목록 로드 실패 시 스켈레톤 무한" 은 확인해 보니 이미 `else` 분기와 재시도 버튼이 있어(`PlannerScreenV2.tsx:196`) 손대지 않았다 — 보고가 낡은 것이었다.
