---
schema_version: 1
type: bug
slug: "webgl-addon-dispose-crash-root"
status: done
difficulty: high
created_at: "2026-07-31T04:01:02+09:00"
session_id: "mcp-20260731-040102"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "package.json"
    op: update
  - path: "pnpm-lock.yaml"
    op: update
  - path: "src/features/terminal/TerminalInstanceImpl.tsx"
    op: update
related: []
tags:
  - "terminal"
  - "xterm"
  - "webgl"
  - "crash-root-cause"
  - "a0d-finding"
  - "mcp-tool"
---
[x] 터미널 크래시 근본 원인 — addon-webgl 0.19 dispose 가 xterm 5.5 내부 부재로 폭발

## 발생 원인

2차 수정에서 심은 window 전역 훅이 마침내 실스택을 포착:

```
TypeError: undefined is not an object (evaluating 'this._terminal._core._store._isDisposed')
@xterm_addon-webgl.js dispose 체인 → TerminalInstanceImpl.tsx:262 term.dispose()
→ React commitPassiveUnmountEffects (삭제 트리)
```

- **`@xterm/addon-webgl@0.19`** 는 신형 코어를 전제로 `_core._store` 내부를 dispose 에서 만지는데, 이 레포는 **`@xterm/xterm@5.5`** — 해당 내부가 없어 TypeError.
- 이 throw 가 **React 언마운트 커밋(cleanup)** 안에서 나면 에러 경계로도 못 막고 루트가 통째로 무너진다 → 앱 전체 빈 화면. dev StrictMode 는 마운트 직후 cleanup 을 한 번 돌리므로 **터미널을 열기만 해도 수 초 뒤 크래시** — 디스패치 프리필이 안 보였던 것도 서브트리가 먼저 죽었기 때문.
- 유입 시점: 어제 렌더러 품질 라운드(d386cb7)에서 WebGL 렌더러 도입 시 애드온이 0.19 로 설치됨(peer 는 `^5.0` 이라 설치는 통과 — 내부 API 는 5.6 전제).

## 해결 방법

1. **버전 정합**: `@xterm/addon-webgl` ^0.19 → **^0.18.0** (xterm 5.5 짝, 설치 확인 0.18.0).
2. **정리 경로 throw 금지(심층 방어)**: 애드온 핸들을 ref 로 보관, cleanup 에서 `webgl.dispose()` → `term.dispose()` 순서로 **각각 try/catch**(로그 후 무시) — 미래의 어떤 dispose 예외도 언마운트 커밋을 못 무너뜨린다.

## 검증

- typecheck/lint/vitest 339/build 그린, lockfile 0.18.0 확인.
- 실기기 재확인 절차: 터미널 열고 10초 대기(StrictMode cleanup 통과) → 다른 화면 전환/복귀 → 플래너 ▶실행 → 프리필 → Enter. 관측 3종(경계·전역 훅·포맷 브리지)은 유지 — 재발 시 즉시 스택이 남는다.

## 메모

1·2차 수정(경계 래퍼 내부화·전역 훅·프리필 수명)이 없었으면 이 스택은 영영 못 봤다 — "관측 먼저, 추측 나중" 이 맞았던 사례. 관련: 20260731/Bugs/0346, 0354.