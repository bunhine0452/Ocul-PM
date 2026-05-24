<!-- ocul-pm:auto — `.oculpm/agents/_template.md` 의 마스터에서 자동 생성됨. 직접 편집하지 마세요 — 마스터를 편집한 뒤 ocul-pm 이 다시 동기화합니다. -->

# ocul-pm 작업 기록 규칙 (v1)

당신 (Antigravity) 은 ocul-pm 으로 추적되는 프로젝트에서 작업하고 있습니다. **하나의 논리적 작업 단위** (버그 수정 / 기능 추가 / 리팩토링 / 에러 해결 / 잡일) 를 끝낼 때마다, 그 작업에 관한 markdown 파일을 정해진 위치에 한 개 작성하세요. 사용자에게 묻지 마세요 — 작업의 끝을 인식하면 즉시 기록합니다.

## 1. 언제 기록하는가 (5 trigger)

1. **bug fix** — 재현되던 결함이 더 이상 재현되지 않음을 직접 확인.
2. **feature done** — 기획된 동작이 첫 happy-path 로 실행 가능.
3. **refactor batch** — 기능 동일 + 구조 변경 한 덩어리 완료 (테스트 그린).
4. **error cycle** — 빌드/런타임 에러 사이클 1회 완료 (성공/실패 무관).
5. **chore** — config / 문서 / 스크립트 같은 비기능 변경 완료.

## 2. 어디에 쓰는가

```
.oculpm/journal/{YYYYMMDD}/{TypeFolder}/{HHMM}_{type}_{slug}.md
```

- `YYYYMMDD` = workday (OS 시각, 사용자에게 묻지 말 것).
- `TypeFolder` = `Bugs` | `Features_to_add` | `Errors` | `Refactors` | `Chores`.
- `slug` = ASCII kebab-case, **권장 40자 이내** (60자 한도).

## 3. Frontmatter (필수 8 필드)

```yaml
---
schema_version: 1
type: bug
slug: example-slug
status: done
difficulty: medium
created_at: "2026-05-24T22:30:13+09:00"  # ⚠ tz offset 필수 (+09:00 형태)
session_id: "20260524-001"
agent: { id: antigravity, version: "1.0" }  # ⚠ mapping, 문자열 금지
language: ko
verified_by_user: false
files_touched:
  - { path: "src/oculpm/watcher.rs", op: update }
related: []
tags: ["watcher", "cache"]
---
```

## 4. 본문 구조

첫 줄 = `[x] 제목` 또는 `[ ] 제목`.

- **bug / error**: `## 발생 원인`, `## 해결 방법`, `## 검증`
- **refactor**: `## 동기`, `## 변경 요약`, `## 검증`
- **feature**: `## 추가 기능`, `## 동작 흐름`, `## 검증`
- **chore**: 자유 + `## 검증` 권장

## 5. 금지

- `.oculpm/index/**` 에 쓰기 금지 (앱이 자동 관리).
- secrets / API key / `.env` 본문 포함 금지.
- 기존 journal `.md` 수정 금지 — 새 파일을 만들고 `related` 로 링크.
- 한 파일에 두 작업 묶기 금지.

기존 entry 예시는 `.oculpm/journal/` 의 최근 1~2개 파일을 직접 읽어 참고하세요.
