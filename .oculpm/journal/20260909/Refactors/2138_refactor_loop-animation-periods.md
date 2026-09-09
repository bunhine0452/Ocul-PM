---
schema_version: 1
type: refactor
slug: "loop-animation-periods"
status: done
difficulty: low
created_at: "2026-09-09T21:38:17+09:00"
session_id: "20260909-001"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "c997b348-9e50-41e9-845f-4681b1fda66a"
language: "ko"
verified_by_user: false
files_touched: []
related: []
tags:
  - "design"
  - "motion"
  - "tokens"
  - "mcp-tool"
---
[x] 화면이 안절부절못하던 이유 — 무한 애니메이션 29개가 열 박자

## 동기

`infinite` 애니메이션 29개의 주기가 **열 가지**였다 — 0.7 · 0.8 · 0.9 · 1 · 1.2 · 1.4 · 1.6 · 2 · 2.4s.

에이전트가 도는 동안 사이드바 배지 · 탭 · 터미널 표시 · 채팅 점이 **동시에, 서로 다른 박자로** 숨을 쉰다. 하나씩 보면 멀쩡한데 같이 뜨면 화면이 안절부절못하는 인상이 된다.

전이 램프(`--dur-*`)와는 다른 축이다 — 저건 **사용자 입력에 대한 응답 시간**이고 이건 **"살아 있다" 는 신호의 주기**다. 그래서 앞선 모션 게이트에서 `animation:` 을 일부러 범위 밖으로 뒀었다.

## 변경 요약

역할이 셋이라 값도 셋이다.

```
--spin-dur: 0.9s     회전 — 스피너·인디케이터
--pulse-dur: 1.4s    맥동 — 상태 점·배지·LED·캐럿
--breathe-dur: 2.4s  느린 호흡 — 터미널 페인처럼 넓은 면
```

25곳을 접었다. 남긴 넷은 각각 `design-ignore` 와 사유를 달았다.

- **`.ocul-spin-arc` ×3** — 브랜드 로더의 합성 모션이다. 세 호가 서로 다른 속도로 반대 방향으로 돌아야 그 형태가 나온다. 한 주기로 접으면 로고가 아니라 원 세 개가 된다.
- **`agent-caret`** — 텍스트 캐럿. 1초 온/오프는 터미널·에디터의 관례라 상태 표시의 맥박과 같은 축이 아니다.

## 감사 오탐 정정

감사는 **"`nav-attention-blink` 깜빡임은 상용 데스크톱 앱에서 거의 쓰지 않는 어휘"** 라며 맥동으로 교체하라고 했다. 열어 보니 이미 맥동이었다 — `@keyframes nav-attention-blink { 50% { opacity: 0.45; } }`. **이름만 blink 이고 동작은 부드러운 맥박**이다. 감사가 이름을 보고 판단한 것으로 보인다.

동작을 바꿀 게 아니라 **이름이 거짓말을 하는 것**이 문제라, `nav-attention-pulse` 로 바꿨다.

`ai-blink`(0.18까지 떨어지는 진짜 깜빡임)도 확인했는데, 스트리밍 **캐럿**이었고 바로 위 주석이 *"`steps(2)` 하드 온/오프에서 부드러운 맥박으로 바꿨다 — 딱딱 끊기는 깜빡임은 살아 있다는 신호가 아니라 고장 난 것처럼 읽힌다"* 고 적어 두었다. 이미 한 번 고친 자리다.

## 검증

게이트 추가 (`check-design-discipline.mjs` 규칙 15) — `infinite` 가 붙은 애니메이션의 주기 리터럴 금지. 한 번 지나가는 애니메이션(등장·퇴장)은 안 본다: `infinite` 만이 "여럿이 동시에 뜬다" 는 문제를 만든다.

**음성 테스트**: probe 로 `animation: x 1.2s ease infinite` 는 잡히고, `0.3s ease both`(1회)와 `var(--pulse-dur) ease infinite` 는 통과하는 것을 확인.

`pnpm typecheck` · `pnpm lint`(6게이트) · `pnpm test`(195 파일 2,545개) · `pnpm build` 각 exit 0.