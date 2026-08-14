---
schema_version: 1
type: feature
slug: "acp-usage-refresh-is-free"
status: done
difficulty: medium
created_at: "2026-08-15T02:38:48+09:00"
session_id: "mcp-20260815-023848"
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
  - path: "src/features/chat/AcpUsageMeter.tsx"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
related: []
tags:
  - "acp"
  - "usage"
  - "measurement"
  - "ux"
  - "mcp-tool"
---
[x] /usage 는 토큰을 쓰지 않는다 — 새로고침을 진짜 새로고침으로

## 질문과 측정

"`/usage` 쓰면 토큰 들어?" — 내가 만든 버튼이 quota 를 먹는지라 추측할 자리가 아니었다. 빈 세션에서 한 턴 돌려 실측했다(2026-08-15).

```
"usage": {"inputTokens": 0, "outputTokens": 0,
          "cachedReadTokens": 0, "cachedWriteTokens": 0, "totalTokens": 0}
```

**0 토큰.** CLI 가 로컬에서 답하는 커맨드라 모델 왕복이 없다. 그리고 응답 본문에 세 줄이 그대로 있었다.

```
Current session: 0% used
Current week (all models): 83% used · resets Aug 16 at 4:59am (Asia/Seoul)
Current week (Fable): 66% used · resets Aug 16 at 4:59am (Asia/Seoul)
```

## 이게 설계를 바꿨다

어제 만든 새로고침은 "로컬 재조회"였다 — ACP 에 사용량 조회 메서드가 없다는 이유로 타협한 것이고, 그때는 `/usage` 가 공짜인 줄 몰랐다. 이제 **진짜 새로고침**이다: `/usage` 를 보내 세션·주간·Fable 을 한 번에, 공짜로 받는다.

`_meta` 경로(`usage_update` 의 rateLimit)는 한 번에 한 종류씩만 오므로 세 줄이 다 모이려면 턴이 여러 번 돌아야 한다. 즉 새 경로가 **더 싸면서 더 완전하다**.

## 구현에서 걸린 것

우리가 대신 물어보는 턴이라 답을 **프런트 채널로 받을 수 없다**(사용자가 시작한 프롬프트가 아니다). 상태에 갈무리 버퍼를 두고 알림 핸들러가 답변 청크를 모으게 했다.

한도 갱신은 병합이 아니라 **교체**다. `/usage` 는 완전한 스냅샷이라 옛 `_meta` 조각과 섞으면 같은 한도가 두 이름으로 두 줄 보인다(`seven_day` 와 `week (all models)`).

초기화 시각은 CLI 가 쓴 문장을 **그대로** 쓴다(`resets_text`). epoch 보다 덜 정확하지만 더 정직하다 — 우리가 시간대를 다시 계산하다 틀리느니 낫다.

파싱은 방어적이다. 문구가 바뀌면 **못 읽을 뿐 죽지 않고**, 못 읽은 줄은 조용히 빠져 호출부가 기존 값을 지킨다.

## 검증

백엔드 유닛 2건 신규 — 실측 응답 원문 그대로 파싱하는 것과, 모르는 문구를 만나도 빈 배열을 돌려주는 것. 문구가 바뀌면 앞의 테스트가 먼저 깨진다.

게이트: typecheck 0 · 프런트 791건 · lint 0 · build 0 · 백엔드 **575 유닛**.