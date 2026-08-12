---
schema_version: 1
type: chore
slug: "harden-tailscale-bind-detection"
status: done
difficulty: medium
created_at: "2026-08-11T21:25:22+09:00"
session_id: "mcp-20260811-212522"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "docs/20260811_three-features/02-mobile-tailscale.md"
    op: update
  - path: "docs/20260811_three-features/00-master-plan.md"
    op: update
  - path: ".oculpm/planner/three-features-round.md"
    op: update
related: []
tags:
  - "설계"
  - "보안"
  - "tailscale"
  - "모바일"
  - "mcp-tool"
---
[x] 모바일 바인딩 설계 교정 — CGNAT 대역만 보는 판정의 구멍을 막다

## 발생 원인

직전 일지([2054_chore_plan-three-features-round](../Chores/2054_chore_plan-three-features-round.md))에서 모바일 서버의 바인딩 규칙을 "`100.64.0.0/10` 대역의 인터페이스를 찾아 거기에만 bind" 로 설계했다. 사용자가 "카페 WiFi 에 안 열리는 게 맞냐"를 되물어 재검토하다 구멍을 발견했다.

**`100.64.0.0/10` 은 Tailscale 전용 대역이 아니라 RFC 6598 CGNAT(캐리어급 NAT) 대역이다.** ISP 가 CGNAT 을 쓰면 사용자의 일반 WiFi 인터페이스에도 `100.64.x` 주소가 붙는다. 대역만 보고 고르는 판정은 그 환경에서 **WiFi 인터페이스를 골라 바인딩** — 정확히 막으려던 상황이 벌어진다.

구현 전에 잡았으므로 실제 노출은 없다.

## 해결 방법

이 기기 실측으로 확실한 판별자를 확인했다:

```
Tailscale  utun8: POINTOPOINT · inet 100.73.187.123 --> 100.73.187.123 netmask 0xffffffff
                               (/32, broadcast 없음 — 점대점 터널)
WiFi       en0  : BROADCAST   · inet 192.168.75.41 netmask 0xffffff00 broadcast 192.168.75.255
                               (/24, broadcast 있음 — 브로드캐스트 LAN)
```

ISP CGNAT 이 물린 WiFi 는 `100.x` 이면서도 **브로드캐스트 LAN** 이라 Tailscale 의 `/32` 점대점과 갈린다.

4중 방어로 재설계:

1. **판정 강화** — (a) `100.64.0.0/10` **그리고** (b) `/32` + broadcast 없음 **그리고** (c) `tailscale` CLI 가 있으면 그 결과와 일치. CLI 는 필수가 아닌 교차검증(App Store 판은 CLI·LocalAPI 소켓이 없음을 확인) 이되, 있는데 불일치하면 기동하지 않는다.
2. **폴백을 타입으로 차단** — 문서 약속은 약하다. "dev 에서 잠깐 127.0.0.1 로" 가 릴리스에 남는 게 이 부류의 전형이다. private 필드 + 유일 생성자 `detect()` 를 가진 `TailscaleBindAddr` newtype 을 두고 `serve()` 가 `SocketAddr` 대신 그것만 받게 한다 → 임의 주소 전달이 **컴파일 에러**.
3. **바인딩 후 되읽기** — `local_addr()` 재확인, 불일치면 리스너 폐기·중단.
4. **출발지 검사** — axum 미들웨어에서 요청 출발지 IP 가 CGNAT 밖이면 거부 (심층 방어).

회귀는 테스트로 고정했다: `(100.90.1.2, /32, bcast=None)` 채택 **AND** `(100.90.1.2, /24, bcast=Some)` 거부. 두 번째가 ISP CGNAT WiFi 의 모습이라, 대역만 보는 구현으로 되돌아가면 즉시 빨개진다.

리스크 등록부에 R5b 를 신설하고, 플래너의 바인딩 항목을 1개 → 7개로 분화했다 (newtype·되읽기·출발지검사·경계테스트·ISP회귀테스트·엣지케이스).

## 배운 것

대역(CIDR)만으로 "이 인터페이스는 VPN 이다"를 판정하면 안 된다. 대역은 용도를 보장하지 않는다 — 인터페이스의 **형태**(점대점 여부·프리픽스 길이·broadcast 유무)까지 봐야 한다. 그리고 보안 불변식을 산문으로 적어 두는 것과 타입으로 강제하는 것의 차이가 크다. 전자는 6개월 뒤 편의 변경에 지고, 후자는 정의를 고쳐야 해서 리뷰에 걸린다.

## 검증

구현 전 설계 단계라 실행 게이트는 해당 없음. 실측 확인: `ifconfig utun8` (POINTOPOINT·/32·broadcast 없음) 대 `ifconfig en0` (BROADCAST·/24·broadcast 있음), macOS 앱 설치판에 LocalAPI 소켓이 표준 경로에 없음. `plan_status` 로 플랜 파서가 신규 `{#id}` 6개를 정상 인식(총 43항목)함을 확인.