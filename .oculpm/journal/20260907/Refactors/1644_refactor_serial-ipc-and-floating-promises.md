---
schema_version: 1
type: refactor
slug: "serial-ipc-and-floating-promises"
status: done
difficulty: low
created_at: "2026-09-07T16:44:02+09:00"
session_id: "20260907-002"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "b2e235a0-7801-4870-9780-7b970cc85e65"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/chat/aiContext.ts"
    op: update
  - path: "src/features/chat/useProviderKeys.ts"
    op: create
  - path: "src/features/chat/AiPanelScreenV2.tsx"
    op: update
  - path: "src/features/onboarding/useCliChecks.ts"
    op: create
  - path: "src/features/onboarding/GreenfieldWizard.tsx"
    op: update
  - path: "src/api/llm.ts"
    op: update
  - path: "package.json"
    op: update
  - path: "docs/optimization/00-ledger.md"
    op: create
  - path: "docs/README.md"
    op: update
related: []
tags:
  - "감사"
  - "최적화"
  - "react"
  - "문서"
  - "mcp-tool"
---
[x] AI 컨텍스트 직렬 IPC 와 떠 있는 프로미스를 걷고 최적화 원장을 연다

감사에서 나온 최적화·React 항목을 닫고, 앞으로 최적화를 적을 자리를 만들었다.

## 동기

세 자리가 같은 손버릇이었다 — **비동기를 루프 안에 넣었다.**

### ① `aiContext.ts` 가 IPC 를 직렬로 돈다

이 블록은 **매 메시지마다** 재조립돼 system 으로 다시 올라간다. 그런데 상세를 루프 **안에서** `await` 하고 있어서 왕복이 계획 수만큼 직렬로 깔렸다. 그 지연은 전송 버튼과 첫 토큰 사이에 그대로 쌓인다.

| 빌더 | 직렬 단계 (전) | (후) | 병렬로 보낸 것 |
|---|---|---|---|
| `buildPlannerSystemContext` | 5 | **2** | `planGet` × `MAX_CTX_PLANS`(4) |
| `buildOculpmSystemContext` | 4 | **2** | `oculpmGetJournalEntry` × 3 |

### ② `forEach(async …)` 두 곳

`AiPanelScreenV2`(키체인 조회)와 `GreenfieldWizard`(CLI 탐지). `forEach` 는 async 콜백의 프로미스를 **버린다** — 거부를 아무도 안 받고, 완료를 기다릴 수 없고, 프로바이더마다 `setState` 를 따로 쏴서 화면이 그 수만큼 다시 그려진다.

### ③ 그 밑에 깔려 있던 진짜 버그

eslint `react-hooks/exhaustive-deps` 30건 중 18건이 `t` 누락인데, `useT()` 의 `t` 는 모듈 `t()` 에 위임하고 그쪽이 **호출 시점**에 언어를 읽으므로 무해하다. 문제는 그 무해한 노이즈가 **진짜 2건을 덮고 있었다**는 것이다:

- `GreenfieldWizard:421` — ESC 리스너가 `[]` deps 로 걸려 첫 렌더의 `handleClose` 를 붙들고 있었다. 그 함수는 **초안을 저장하고** 닫는다. 즉 **ESC 로 닫으면 그때까지 친 아이디어·폴더명이 빈 초안으로 덮여 사라졌다.**
- `GreenfieldWizard:230` — "이미 본 CLI" 를 렌더 상태에서 읽으면서 그 값을 deps 에 넣지 않아 스테일 클로저로 읽었다.

## 변경 요약

- `aiContext.ts` 두 루프를 `Promise.all` 로. 입력 순서를 보존하므로 **출력 마크다운은 바이트까지 같다.**
- 조각 훅 둘로 갈랐다 (`useEscCancel` 이 `AcpConversation` 에서 나온 것과 같은 사정 — 두 화면 다 크기 래칫에 걸려 있어 자리를 먼저 만들어야 했다):
  - `features/chat/useProviderKeys.ts` — 한 번에 묻고 한 번에 쓴다.
  - `features/onboarding/useCliChecks.ts` — "이미 봤다"를 ref 로 옮겨 스테일 클로저를 없앴다. 실패(`null`)면 기억을 되돌려 다음 진입에서 다시 본다.
- `api/llm.ts` 에 `hasKey(provider)` 추가. 새 훅이 `bindings` 를 직접 만지지 않게 하는 길이라 `lint:bindings` allowlist 가 **안 늘었다**. `null` 은 "키 없음"이 아니라 "못 읽었다"로 남긴다 — 둘을 섞으면 키체인이 잠깐 안 열렸을 때 멀쩡한 모델을 잠근다.
- ESC 리스너는 mount 때 한 번만 달고 최신 `handleClose` 를 ref 로 따라간다 (`useDeferredCommit` 의 `flushRef` 와 같은 손).
- `lint:js` 상한 `--max-warnings=61` → `50`. 잔고와 상한을 붙여 놨다.

## 새 문서 — `docs/optimization/00-ledger.md`

앞으로의 최적화는 라운드 폴더를 새로 파지 않고 여기 적는다. 규칙 셋: **측정 없이 항목을 올리지 않는다 · 죽은 추정도 「기각」으로 남긴다 · 값에는 재현 명령이 붙는다.** 절은 넷이다 — 고쳤다 / 확정했지만 안 고쳤다 / 기각 / 잔고 표. `docs/README.md` 「살아 있는 설계」 표에 등재했다.

이번 라운드가 기각한 것도 적어 뒀다: 프로덕션 `unwrap` 남용(없음) · `await` 너머의 std 락(0) · SQL 조립(전부 바인딩) · clippy 부채(0) · 마크다운 XSS(hljs 이스케이프 출력·`rehype-raw` 부재).

## 검증

- 게이트 전부 초록: typecheck · lint 6종(`max-warnings=50`) · `pnpm test` 2,403 · build · `cargo test` · `clippy -D warnings` · `cargo fmt --check`.
- 프리티어를 한 번 돌렸다가 되돌렸다 — 이 저장소엔 `.prettierrc` 도 포맷 게이트도 없어서 기본값(80칸)이 무관한 줄 400여 줄을 재포맷했다. `git checkout` 후 손으로 다시 넣어 diff 를 실제 변경분만 남겼다.