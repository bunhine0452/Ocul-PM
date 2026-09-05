---
schema_version: 1
type: feature
slug: "egress-ledger-and-automation-conditions"
status: done
difficulty: high
created_at: "2026-09-05T13:28:33+09:00"
session_id: "20260905-002"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "6a994a30-8c4f-47ba-a782-68dd1893c4d1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/tests/egress_inventory.rs"
    op: create
  - path: "src-tauri/src/oculpm/automation/conditions.rs"
    op: create
  - path: "src-tauri/src/oculpm/automation/egress.rs"
    op: create
  - path: "src-tauri/src/oculpm/automation/runner/facts.rs"
    op: create
  - path: "src-tauri/src/oculpm/automation/runner/ledger.rs"
    op: create
  - path: "src-tauri/src/oculpm/automation/runner/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/automation/seeds.rs"
    op: update
  - path: "src-tauri/src/oculpm/redact.rs"
    op: update
  - path: "src/features/settings/automation/EgressBadge.tsx"
    op: create
  - path: "src/features/settings/automation/AutomationEditor.tsx"
    op: update
  - path: "src/features/settings/automation/AutomationHistory.tsx"
    op: update
related: []
tags:
  - "유출경계"
  - "자동화"
  - "로컬우선"
  - "v3"
  - "mcp-tool"
---
[x] 유출 경계를 원장으로 — 새 아웃바운드는 빌드를 깨고, 자동화는 조건 없이 빈 요약을 안 만든다

## 추가 기능

이 제품의 1번 약속은 로컬 우선인데, **그 약속을 지키는 장치가 코드에 없었다.** 새 아웃바운드를 넣어도 아무것도 막지 않았고, 자동화가 프로젝트 내용을 어느 프로바이더로 보내는지가 화면에 없었다.

**`tests/egress_inventory.rs`** — 기기 밖으로 나가는 호출은 가드를 지나거나, 사유가 적힌 면제 목록에 있거나, 아니면 테스트가 실패한다. 판정이 `contains` 가 아니라 **집합 상등**이라 표를 안 고치면 아웃바운드를 늘릴 수도 **줄일 수도** 없다. 사유 없는 면제는 테스트가 거부한다.

전수 조사 결과 Rust 15곳 · 웹뷰 7곳 · 호스트 21개(실제 목적지 10 · 브라우저 위임 2 · 목적지 아님 3 · 테스트 픽스처 6).

**유출 배지** — 모델 호출이 있는 자동화 정의에 프로바이더 이름이 찍힌 배지가 붙고, **로컬 모델이면 안 붙는다.** 그 구분이 제품 약속의 핵심인데 화면에 없었다. 판정은 백엔드 소유이고 호스트 표가 `llm/*.rs` 의 실제 `BASE_URL` 상수와 대조된다 — 오늘 5종은 전부 원격이라 배지가 늘 뜨지만, 로컬 프로바이더가 붙는 날 **저절로** 사라진다. 화면 문자열에 하드코딩했으면 그날 거짓말이 됐을 자리다.

**자동화 스텝 조건** — "일지 3건 이상일 때만 주간 요약"이 안 돼서 **빈 요약을 만들고 성공했다고 말했다.** 어휘 3종(`journal_count_gte(n)`·`plan_has_open_items`·`git_dirty`)을 열거형으로 넣었다(자유 표현식 금지). 조건이 안 맞으면 건너뛰고 **그 사실이 실행 이력에 남는다.** 모르는 조건은 fail-closed — 막고 사유를 남기되 오타 원문은 `raw` 에 보존해 왕복시킨다. 하위호환은 `conditions:` 없으면 빈 벡터 = 항상 실행이고, 비었으면 렌더가 키를 안 써 기존 파일이 바이트 불변이다.

## 동작 흐름

조건 판정 창은 **직전 성공 실행 이후**다. 경계 워크데이만 `created_at` 으로 정확히 잘라, 같은 날 두 번째 발동이 아침 일지를 다시 세지 않는다.

`redact.rs` 모듈 문서를 실측으로 정정했다 — 문서는 22파일이라 주장했고 실제는 **23파일 · 면제 4개**(AI 패널·모바일 중계·README 직독·사용자 청사진)다. 전체 LLM 프롬프트 자리 13곳 중 직접 4 · 캐시 경유 5 · 면제 4. 문서가 다시 낡지 않게 그 숫자 자체를 테스트가 상수와 대조한다.

## 검증

**퇴화 방지를 변이로 실증했다** — 새 아웃바운드 파일 추가 / 기존 파일에 목적지만 추가 / 원장 항목 삭제 / 사유 삭제 / `git push` 삽입, 5건 전부 실패로 잡혔다.

`egress_inventory` 11, `automation` 105, `redact` 18 통과. `lint` 6게이트·`fmt`·`clippy -D warnings` 전부 초록. 크기 래칫 초과 셋을 쪼개 해소: `runner/mod.rs` 922→706, `store.rs`→`store/{mod,tests}` 610+219, `watchers.rs`→`watchers/{mod,tests}` 694+224.

## 메모

**약속 문구 자체가 사실보다 좁다.** `CLAUDE.md`·README·랜딩의 "LLM 호출과 업데이트 확인 말고는 기기 밖으로 안 나간다"는 실제로 예외를 다섯 개 더 갖는다 — Notion API + **`https://oculpm.com/api/notion/oauth/start` OAuth 브로커**(우리 서버가 사용자 인증 흐름 한가운데 있다), 플러그인 zip, 테마 다운로드, fastembed 모델 내려받기. 대부분 사용자가 시작하는 동작이라 성격상 문제는 아니지만 **문구가 그걸 안 적고 있다.** 원장이 사실을 적었으니 다음은 문구다.

`tauri.conf.json` 의 `csp: null` — 웹뷰에 CSP 가 없다. 지금은 프런트 원장이 대신 지킨다.

`src/i18n/errors.ts` 에 `automation_bad_condition` 을 못 넣었다(다른 세션 소유 파일). 지금은 파서 경고가 카드에 뜨고 실행은 fail-closed 로 막힌다.