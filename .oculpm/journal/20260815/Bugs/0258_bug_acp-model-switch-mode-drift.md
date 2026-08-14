---
schema_version: 1
type: bug
slug: "acp-model-switch-mode-drift"
status: done
difficulty: medium
created_at: "2026-08-15T02:58:58+09:00"
session_id: "mcp-20260815-025858"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/acp/session.rs"
    op: update
  - path: "src-tauri/src/acp/process.rs"
    op: update
  - path: "src-tauri/src/commands/acp.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/styles/agent.css"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
related: []
tags:
  - "acp"
  - "safety"
  - "bug"
  - "ux"
  - "mcp-tool"
---
[x] 모델을 바꾸면 권한 모드가 조용히 내려간다 — UI 가 "Auto"라 거짓말하던 것

## "세션 중에 모델 바꿔도 문제 없나?"

문제가 있었다. 어댑터 소스가 명시적이다.

```js
if (!newAvailableModes.some((m) => m.id === previousModeId)) {
    session.modes = { availableModes: newAvailableModes, currentModeId: "default" };
    await session.query.setPermissionMode("default");
    modeDowngraded = true;
}
```

새 모델이 현재 권한 모드를 지원하지 않으면 어댑터가 **조용히 `default`(Manual)로 내린다.** 그 사실은 우리가 보낸 요청의 응답이 아니라 **알림**(`current_mode_update` / `config_option_update`)으로 오는데, 우리는 그 둘을 `Other` 로 버리고 있었다.

결과: Opus + Auto 로 쓰다 모델을 바꾸면 실제로는 Manual 인데 칩에는 "Auto" 가 남는다. 사용자는 자동 승인될 거라 믿고 자리를 뜬다 — **안전 문제**라 기능 요청보다 먼저 고쳤다.

- `config_option_update` → `AcpEvent::ConfigChanged` 로 승격, 상태의 설정 한 벌을 갈아 끼운다.
- `current_mode_update` → 모드 값만 패치.
- 이 알림들은 **프롬프트 밖**에서도 오므로 싱크만으로는 못 받는다. `acp_options` 로 되읽고, 화면은 4초마다 동기화한다(로컬 상태 조회라 값싸다).

## `/clear`

그냥 보내면 CLI 쪽 문맥만 비고 **화면은 그대로** 남아 둘이 어긋난다. 사용자 추측이 맞다 — 의도는 "새로 시작"이므로 우리 쪽 새 세션 생성으로 잇는다. `/usage` 와 같은 처리다.

## Effort 팝오버

- **Tab 으로 값이 움직인다.** 열려 있는 동안 Tab 은 포커스 이동이 아니라 값 이동이다 — 그 순간 사용자가 하려는 일은 그것뿐이다. 열리면 슬라이더로 포커스를 옮긴다(안 옮기면 Tab 이 포커스를 팝오버 밖으로 던진다). Enter·Esc 로 닫힌다.
- 점을 큰 원으로 늘어놓으니 신호등처럼 보였다. **얇은 트랙 위의 눈금**으로 낮추고 지나온 구간을 선으로 채웠다 — "어디쯤"이 점을 세기 전에 읽힌다. 현재 위치만 흰 테두리로 떠 보이는 손잡이가 되고, 울트라코드 칸은 채움선이 보라로 번진다.

## 검증

게이트: typecheck 0 · 프런트 791건 · lint 0 · build 0 · 백엔드 575 유닛.

**미확인**: 모드 강등을 실제로 겪어 보지 않았다(모델을 바꿔 Auto 가 Manual 로 떨어지는 장면). 소스와 알림 배선은 맞췄으니, Opus+Auto 에서 Haiku 로 바꿔 보면 칩이 따라 내려가는지로 확인된다.