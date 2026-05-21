# 08. Lint Rule: localStorage 직접 접근 금지

> **작업 ID**: W1 / UI-1 (마무리)
> **일자**: 2026-05-21
> **참조**: MASTER-GUIDE §6.1

---

## 변경 요약

`localStorage` 를 `WorkspaceContext` 외부에서 호출하지 못하도록 lint 단계에서
차단. ESLint 전체를 도입하는 대신 zero-dep Node 스크립트로 동일 효과 달성.

## 신규 파일

### `scripts/check-no-localstorage.mjs`

- `src/**/*.{ts,tsx}` 전체를 순회
- 코멘트 제외 (`//` / `*` 시작) 한 라인에서 `\blocalStorage\b` 매칭 시 위반
- `ALLOWLIST` 에 명시된 파일은 통과:
  - `contexts/WorkspaceContext.tsx` — *영구* (소유자)
  - `features/chat/ChatPanel.tsx` — W5 까지 한시적
  - `features/terminal/TerminalPanel.tsx` — W5 까지 한시적

### `package.json`

```json
{
  "scripts": {
    "lint:storage": "node scripts/check-no-localstorage.mjs",
    "lint": "pnpm lint:storage"
  }
}
```

향후 다른 lint 가 추가되면 `lint` 에 chain.

## 왜 ESLint 풀 설치 대신 스크립트인가

- 단 1 개의 규칙 ("`no-restricted-syntax: localStorage`") 을 위해 eslint +
  typescript-eslint + parser 트리 (~50 MB) 를 까는 건 과한 비용.
- 스크립트는 동일한 *의도* (regression 방지) 를 만족하며, deps 가 없어
  로컬·CI 어디서나 즉시 실행 가능.
- 정식 ESLint 도입이 다른 이유로 필요해지면 (예: a11y rules) 이 스크립트는
  유지하거나 동등한 ESLint rule 로 옮기면 됨.

## 출력 예시 (위반 시)

```
✗ direct `localStorage` access detected — route through WorkspaceContext:
  features/foo/Bar.tsx
    42: const v = localStorage.getItem("foo");

If this is intentional (e.g. a deferred migration), add the file to
ALLOWLIST in scripts/check-no-localstorage.mjs with a comment explaining
the timeline.
```

## 검증

```
$ pnpm lint
✓ no direct localStorage access outside the allowlist
```
