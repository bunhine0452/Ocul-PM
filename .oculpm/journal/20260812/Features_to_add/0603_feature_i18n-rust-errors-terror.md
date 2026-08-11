---
schema_version: 1
type: feature
slug: "i18n-rust-errors-terror"
status: done
difficulty: high
created_at: "2026-08-12T06:03:41+09:00"
session_id: "mcp-20260812-060341"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/i18n/errors.ts"
    op: create
  - path: "src/__tests__/i18n_errors.test.ts"
    op: create
  - path: "src/__tests__/i18n.test.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src-tauri/src/oculpm/rules.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools.rs"
    op: update
  - path: "src-tauri/src/commands/skills.rs"
    op: update
  - path: "src-tauri/src/commands/discussion.rs"
    op: update
  - path: "src-tauri/src/commands/notion.rs"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "i18n"
  - "rust"
  - "errors"
  - "mcp-tool"
---
[x] Rust 사용자 노출 에러 114곳 영어화 + tError 역매핑

플랜 항목 `i18n-rust-errors`. 영어 모드에서 **뭔가 실패하는 순간 한국어 토스트가 뜨던** 문제를 없앴다.

## 동기 — 게이트가 못 보던 구멍

프런트 12파일·21곳이 `toast.destructive(res.error)` 로 백엔드 문자열을 **그대로** 띄운다. 그 문자열이 한글 116곳이었으니, 화면을 아무리 영어화해도 저장 하나 실패하면 한국어가 나왔다. 프런트 하드코딩 게이트(`pnpm lint`)는 이걸 볼 수 없다 — 문자열이 Rust 에 있기 때문이다.

## 변경 요약

**Rust 114곳 한글 → 영어** (21파일). §4.4 대로 `Result<_, String>` 계약은 그대로 두고 문자열만 바꿨다. 에러 코드 도입은 여전히 후속이다.

**`src/i18n/errors.ts` 의 `tError(raw)`** — 영어 원문을 한국어로 되돌린다. `[정규식, 키]` 표 24개, **이름 있는 캡처 그룹**을 사전 자리표시자로 넘긴다(`No API key configured for anthropic` → `anthropic API 키가 설정되지 않았습니다`). 순서 의존을 없애려고 그룹에 이름을 줬다 — `{provider}` 가 어느 언어에서 앞에 오든 상관없다.

**매칭 실패가 곧 폴백이다.** 표에 없으면 영어 원문이 그대로 보인다. 그래서 116곳 중 24곳만 표에 있어도 앱은 정상이고, 자주 보는 것부터 늘리면 된다. 테스트가 이 계약을 가장 촘촘히 덮는다(빈 문자열·미지 문구·부분 일치 오작동).

영어 모드에서는 표를 **건너뛴다** — 원문이 이미 영어라 매칭할 이유가 없다.

## 판단이 필요했던 3곳

- `rule_promotion.rs:284` — `Err(_) =>` 안에 있지만 **에러 반환이 아니라 프롬프트 증거 본문**에 끼우는 자리표시자였다. §4.5 대로 한국어 유지 + 근거 주석.
- `discussion.rs:472` — `` `## 다음 단계` `` 는 토의 문서의 **섹션 헤더 규격**(디스크 산출물)이라 문장만 영어로 바꾸고 헤더 리터럴은 남겼다.
- `mcp/tools.rs` — 에이전트에게 가는 메시지지만 영어가 더 낫고 나머지와 결이 맞아 함께 바꿨다.

## cargo test 가 잡은 것

`rules.rs:799` 의 `assert!(err.contains("닫히지"))` 가 깨졌다 — 예상했던 자리다. 추가로 `tools.rs:1450` 의 `contains("이미 있습니다")` 를 통해 내가 놓쳤던 한글 에러 1곳(`plan_create` 중복 거부)을 찾았다. **테스트가 grep 보다 정확했다.**

## 곁들여 — 자리표시자 정합성 게이트

`i18n.test.ts` 에 ko/en 의 `{name}` 집합 일치 검사를 넣었다. 타입은 키만 강제하고 **값 안의 `{n}`** 은 못 본다 — en 에서 빠지면 숫자가 조용히 사라지고("N건" → "entries"), en 에만 있으면 `{n}` 이 그대로 렌더된다. 현재 전 키 통과.

## 검증

게이트 5종 exit 0 직접 확인 — typecheck / vitest 663통과(+8) / **cargo test 516통과** / lint(남은 미번역 54) / build.