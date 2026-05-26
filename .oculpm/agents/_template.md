<!-- schema_version: 1 -->
# ocul-pm 작업 기록 규칙 (v1)

당신은 ocul-pm 으로 추적되는 프로젝트에서 작업하고 있습니다. **하나의 논리적 작업 단위** (버그 수정 / 기능 추가 / 리팩토링 / 에러 해결 / 잡일) 를 끝낼 때마다, 그 작업에 관한 markdown 파일을 정해진 위치에 한 개 작성하세요. 사용자에게 묻지 마세요 — 작업의 끝을 인식하면 즉시 기록합니다.

## 1. 언제 기록하는가 (5 trigger)

1. **bug fix** — 재현되던 결함이 더 이상 재현되지 않음을 직접 확인했을 때.
2. **feature done** — 기획된 동작이 첫 happy-path 로 실행 가능해졌을 때.
3. **refactor batch** — 기능 동일 + 구조 변경이 한 덩어리로 끝났을 때 (테스트 그린).
4. **error cycle** — 빌드/런타임 에러를 진단·수정 사이클을 1회 끝냈을 때 (성공 여부 무관 — 실패도 기록).
5. **chore** — config/문서/스크립트 같은 비기능 변경이 끝났을 때.

## 2. 어디에 쓰는가

경로:

```
.oculpm/journal/{YYYYMMDD}/{TypeFolder}/{HHMM}_{type}_{slug}.md
```

- `YYYYMMDD` = workday (사용자가 정한 day-start 기준, 보통 자정. **OS 시각을 그대로 사용 — 사용자에게 묻지 말 것**).
- `HHMM` = 24h 로컬 시각.
- `TypeFolder` = `Bugs` | `Features_to_add` | `Errors` | `Refactors` | `Chores`.
- `type` ∈ {`bug`, `feature`, `error`, `refactor`, `chore`}.
- `slug` = ASCII kebab-case, **권장 40자 이내** (60자 한도). 작업 내용을 1줄로 압축.

예: `.oculpm/journal/20260524/Bugs/0925_bug_journal-delete-not-reflected.md`

## 3. Frontmatter (필수)

YAML 헤더. **필드 순서는 자유지만 다음 8개는 반드시 포함**:

```yaml
---
schema_version: 1
type: bug                                    # bug | feature | error | refactor | chore
slug: journal-delete-not-reflected
status: done                                 # planned | in_progress | done | abandoned
difficulty: medium                           # verylow | low | medium | high | superhigh (선택)
created_at: "2026-05-24T22:30:13+09:00"      # ⚠ timezone offset 필수. +09:00 누락 시 UTC 로 해석됨
updated_at: "2026-05-24T22:52:00+09:00"      # 선택
session_id: "20260524-001"                   # 활성 세션 id, 없으면 "manual-<workday>-HHMMSS"
agent:
  id: claude-code                            # claude-code | cursor | antigravity | gemini-cli | manual
  version: "4.7"                             # 선택
language: ko                                 # ko | en
verified_by_user: false                      # 사용자가 UI 에서 토글
files_touched:
  - path: src/oculpm/watcher.rs
    op: update                               # create | update | delete | rename | correct
    bytes_added: 83
    bytes_removed: 12
related: []                                  # 다른 journal 파일 상대경로 (depends-on / fixes)
tags: ["watcher", "cache", "dogfooding-finding"]
---
```

⚠ **dogfooding 마찰 top 3** (이 부분을 LLM 이 가장 자주 틀림):

1. `created_at` 의 tz offset — 반드시 `+09:00` 형태. `+0900` 안 됨. `Z` 만 쓰면 UTC.
2. `agent` 는 **mapping** (id/version 키 가진 객체) — 문자열로 쓰면 안 됨.
3. `files_touched[].op` 는 enum — 위 5개만 허용. `"modify"` 는 `update` 의 alias 로 받지만 정식은 `update`.

## 4. 본문 구조 (타입별 강제 헤더)

**첫 줄**: `[x] 제목` 또는 `[ ] 제목` 체크박스 + 1줄 제목.

| type | 강제 헤더 (이 순서) | 공통 끝 헤더 |
|---|---|---|
| bug / error | `## 발생 원인`, `## 해결 방법` | `## 검증` (필수), `## 메모` (선택) |
| refactor | `## 동기`, `## 변경 요약` | 동일 |
| feature | `## 추가 기능`, `## 동작 흐름` | 동일 |
| chore | (강제 없음 — 자유) | `## 검증` 권장 |

`## 검증` 섹션엔 어떻게 확인했는지 1~3줄 (테스트 명, 수동 시나리오, 명령어 등).

## 5. 금지 사항

- `.oculpm/index/**` 에 절대 쓰지 말 것 — 앱이 자동 관리하는 영역.
- secrets / API key / `.env` 내용을 본문/diff 에 절대 포함 금지. 감지 시 ocul-pm 이 거부 + 사용자 토스트.
- 이미 존재하는 다른 journal `.md` 를 수정 금지. 새 파일을 만들고 frontmatter `related` 에 상대경로로 링크.
- 하나의 파일에 두 개 이상의 작업을 묶지 말 것 (대신 entry 두 개).

## 6. 예시

본 템플릿에 모든 예시를 박지 않는 이유는 토큰 비용. `.oculpm/journal/` 의 같은 type 의 최근 entry 1~2 개를 직접 읽어 참고하세요 — 실제 데이터가 가장 좋은 표본입니다. 새 프로젝트라 비어 있다면, dogfooding 시드 entry 가 곧 생성됩니다.
