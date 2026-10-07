---
schema_version: 1
type: feature
slug: "automation-consent-scoped-revocable"
status: done
difficulty: high
created_at: "2026-10-08T05:59:27+09:00"
session_id: "20261008-003"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "4450d61f-8efa-44ff-b9ec-4e171492ed94"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/automation/consent.rs"
    op: update
  - path: "src-tauri/src/oculpm/automation/consent_tests.rs"
    op: create
  - path: "src-tauri/src/commands/automation_consent.rs"
    op: update
  - path: "src-tauri/src/commands/automation.rs"
    op: update
  - path: "src-tauri/src/commands/oculpm.rs"
    op: update
  - path: "src-tauri/src/oculpm/automation/scheduler.rs"
    op: update
  - path: "src-tauri/src/oculpm/automation/watchers/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/journal_draft/mod.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/api/automation.ts"
    op: update
  - path: "src/features/settings/automation/AutomationConsentNotice.tsx"
    op: update
  - path: "src/features/settings/automation/AutomationTab.tsx"
    op: update
  - path: "src/__tests__/automation_consent_notice.test.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related:
  - ref: "20261007/Bugs/1010_bug_automation-device-consent.md"
    kind: "followup"
tags:
  - "security"
  - "automation"
  - "consent"
  - "mcp-tool"
---
[x] [x] 배경 자동화 동의를 그때 본 스위치·지시문 지문에 묶고 「허락 거두기」 추가

## 추가 기능

3차 피드백 "배경 AI 작업 허락이 여전히 프로젝트 단위로 한 번, 영구적" 을 수용했다. v3.8.0 결정 `#d-consent-unit` 은 "스위치별·정의별 승인은 복잡도 대비 이득이 작다" 였는데, 정의(`.oculpm/automation/*.md`)의 본문이 **내 키로 모델에 가는 지시문**이라는 점을 놓쳤다 — 허락 뒤 `git pull` 이 새 스케줄을 켜거나 지시문을 바꿔도 말없이 돌았고, 거두는 길도 없었다. 단위(프로젝트 하나)는 유지하고 "영구" 를 고쳤다.

- 동의 기록: 시각 한 줄 → `{at, switches, defs: {"schedules/<id>": 지문}}` JSON (direnv `allow` 모양). 지문은 정의에서 제목·날짜를 비운 serde_json 의 blake3 앞 16자 — 지시문·발동 조건·산출물이 바뀌면 달라진다.
- 표면 = 켜진 스위치 + 켜진 종류의 켜진 정의. 동의가 표면을 덮지 못하면 배경 작업 **전체**가 확인 대기. 끄기·지우기는 좁히는 쪽이라 묻지 않는다.
- 「거두기」: `automation_consent_revoke` + 설정 → 자동화의 한 줄 안내. 카드는 `changed` 로 새로/바뀐 정의 이름을 말한다.

## 동작 흐름

- 앱 안의 변경은 **변경분만** 허락: 설정 저장은 `approve_changes(before, after)`(새로 켠 스위치 + 지문이 달라진 정의), 정의 저장·재개는 `approve_def`(디스크에서 다시 읽은 지문). 설정의 다른 칸을 저장했다고 이미 대기 중인 남의 정의까지 허락되지 않는다.
- 발동 쪽 세 곳(스케줄러 틱·워처 틱·일지 삽입 화해)과 훅 초안이 `effective/granted(…, root)` 를 지난다. 워처 틱은 덮지 못하면 그 틱에 규칙 캐시를 비운다 — 규칙은 30초 캐시인데 발동은 정의를 새로 읽어서, 캐시가 사는 동안 바뀐 지시문이 나갈 수 있었다. 허락·거두기는 규칙 캐시를 무효화한다.
- v3.8.0~3.9.0 의 시각 기록은 스위치 4개를 허락한 것으로 읽는다 → 켜진 정의가 있는 프로젝트만 한 번 더 묻는다.

## 검증

`consent_tests.rs` 9개(디스크 변경 시 일시정지·제목만 바뀌면 유지·좁히기 유지·앱 변경분만 허락·거두기·레거시) + 프런트 `automation_consent_notice` 7개 통과. 전체 `cargo test`·clippy·fmt·typecheck·lint·vitest 3272·build exit 0. 실기기 카드·거두기 육안은 아직.