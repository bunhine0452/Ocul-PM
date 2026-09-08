---
schema_version: 1
type: bug
slug: "mobile-pairing-poll-never-stops"
status: done
difficulty: low
created_at: "2026-09-08T18:42:37+09:00"
session_id: "20260908-005"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "faee9c1b-8293-4d9c-8bad-017834dd5425"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/settings/MobileSettings.tsx"
    op: update
  - path: "src/__tests__/mobile_pairing_poll.test.tsx"
    op: create
related: []
tags:
  - "mobile-bridge"
  - "leak"
  - "react"
  - "mcp-tool"
---
[x] 페어링 기기 폴링이 만료·정지·언마운트에도 5분을 마저 돈다

## 발생 원인

`pollDevicesWhilePairing` 은 5초 × 60 = **5분**을 도는 루프인데 이것을 끊을 신호가
하나도 없었다. 주석은 "코드가 사는 동안 주기 폴링" 이라고 했지만 실제로는:

- 코드가 만료돼도 (카운트다운만 멈춘다)
- 서버를 꺼도 (`toggleServer` 는 `setPairing(null)` 만 한다)
- 설정 화면을 떠나도 (언마운트 정리는 `countdownRef` 만 걷었다)

계속 돌며 백엔드를 60번 두드리고 사라진 컴포넌트에 `setDevices`/`setPairing` 을 했다.
「페어링 시작」을 두 번 누르면 루프가 둘 겹쳤고, 먼저 뜬 쪽은 낡은 `before` 로
등록 성공을 판정했다.

곁가지로 카운트다운은 `setSecondsLeft` 의 **업데이터 함수 안에서** `clearInterval` 을
불렀다. 업데이터는 순수해야 하고(StrictMode 개발 모드는 두 번 부른다), 무엇보다 그
자리에서는 폴링 루프에 손이 닿지 않았다.

## 해결 방법

`pairingRunRef` — 지금 살아 있는 시도의 번호 하나. 새 발급·서버 정지·만료·언마운트가
전부 이 번호를 올리고(`stopPairing`), 루프는 매 바퀴 **그리고 왕복 뒤 한 번 더**
자기 번호가 최신인지 확인한다. 멈추는 판단은 업데이터에서 빼내 만료 이펙트로 옮겼다.

## 검증

새 회귀 4건 (`mobile_pairing_poll.test.tsx`) — 언마운트·만료·서버 정지·재발급 각각에
대해 `mobileBridgeDevices` 호출이 더 늘지 않는 것을 센다. "루프가 살아 있다" 를 다른
방법으로 관찰할 수 없어 호출 횟수로 문다.

취소 신호를 무력화해 옛 동작을 재현하면 **4건 모두 실패**한다 — 비어 있는 단언이
아닌 것을 확인했다.