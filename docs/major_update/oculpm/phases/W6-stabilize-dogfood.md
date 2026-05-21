# W6 — Stabilize + Dogfood 회고 + 1.0 릴리스

> **목표**: 한 주간 실제로 살아 있는 dogfooding 데이터를 바탕으로 발견된 이슈를 정리하고, 통합 테스트와 성능 점검을 마치고, 1.0 으로 묶는다.
> **기간**: 1주.
> **선행 조건**: W5 의 §7 핸드오프 4개 항목 모두 ✅.

---

## 0. 이 페이즈가 끝나면 보이는 그림

- W1~W5 의 dogfooding 데이터를 토대로 한 회고 문서가 `docs/major_update/oculpm/phases/_dogfooding-retrospective.md` 에 정리.
- 발견된 모든 critical/high 이슈에 대해 hotfix PR 이 머지됨.
- 통합 테스트 스위트가 5개 시나리오 모두 green.
- 1만 파일 데모 레포에서 성능 SLO 통과 (CPU < 2%, 메모리 < 50 MB).
- 모든 페이즈의 빈/로딩/에러 상태가 의도된 모양으로 표시.
- 다크모드/접근성 점검 통과.
- 1.0 릴리스 노트 + 사용자용 README.
- `.schema-version` 이 1 로 잠금.

---

## 1. PR 분해

### W6-PR1 — Dogfooding 회고 + Hotfix Backlog

**Files**:
- `docs/major_update/oculpm/phases/_dogfooding-retrospective.md` (new)

회고 구조:

```markdown
# Dogfooding 회고 (W3 ~ W5, 약 2주)

## 1. 작성률 추이
| 페이즈 | 일평균 entries | 자동 작성률 | 사람 보정 비율 |
|---|---|---|---|
| W3 (수동) | ... | — | 100% |
| W4 (자동 도입) | ... | x% | y% |
| W5 (자동 안정) | ... | x% | y% |

## 2. 어댑터별 품질
- claude-code: ...
- cursor: ...
- antigravity: (실사용 시 데이터, 없으면 N/A)
- gemini-cli: ...

## 3. 발견된 이슈 (priority 별)
### Critical (반드시 W6 내)
- ...
### High (W6 내 가능하면)
- ...
### Medium (W6 이후 backlog)
- ...

## 4. frontmatter 오류 유형
| 유형 | 빈도 | 자동 보정 가능? |
|---|---|---|
| created_at tz 누락 | ... | yes |
| ...

## 5. UI 가 보여주지 못한 케이스
- ...

## 6. 의도대로 잘 동작한 부분
- ...

## 7. W6 작업으로 끌어올린 항목
- (체크리스트, 다른 PR 들과 cross-reference)
```

**Critical 이슈 hotfix**: W6-PR2 ~ PR5 로 분배.

**DoD**:
- [ ] 회고 문서 작성.
- [ ] Critical 이슈가 0개이거나, 0개로 만들 PR 들이 정의됨.

### W6-PR2 ~ W6-PR5 — Hotfixes (회고에서 발견된 이슈)

회고 결과에 따라 동적으로 정의. 예상되는 카테고리 (실제 내용은 dogfooding 후에 확정):

- **PR2** — frontmatter 자동 보정 강화 (tz 추가, slug 변환, path 정규화).
- **PR3** — LayerComparison 의 false positive 줄이기 (rename 추적 보강).
- **PR4** — 어댑터 템플릿의 prompt engineering 개선 (작성률 낮은 어댑터 위주).
- **PR5** — UI 마무리 (회고 §5 의 표시 누락 케이스).

각 PR 의 DoD 는 "이 이슈가 회고에 적힌 그대로 해결" + "재발 방지 테스트 1개".

### W6-PR6 — 통합 테스트 스위트 정리

**Files**:
- `src-tauri/tests/oculpm_integration_w1.rs` — foundation 시나리오
- `src-tauri/tests/oculpm_integration_w2.rs` — watcher/session 시나리오
- `src-tauri/tests/oculpm_integration_w3.rs` — journal indexing 시나리오
- `src-tauri/tests/oculpm_integration_w4.rs` — agents/compare 시나리오
- `src-tauri/tests/oculpm_integration_w5.rs` — migration 시나리오

각 파일 안에 그 페이즈 가이드의 §통합/수동 QA 중 자동화 가능한 항목을 시나리오로.

**공통 헬퍼** (`tests/common/`):
- `setup_fake_project()` — tempdir + git init + 초기 파일들
- `seed_sqlite_changelog(n)` — N개 가짜 entry
- `wait_for_event(name, timeout)` — Tauri event 대기
- `assert_file_exists`, `assert_ndjson_contains_line`, `assert_session_finalized`

**총 시나리오 수**: ~25 (W1: 4, W2: 5, W3: 6, W4: 5, W5: 5).

**CI 시간**: 전체 ≤ 5분.

**DoD**:
- [ ] 모든 시나리오 green.
- [ ] CI YAML 에 `cargo test --test oculpm_integration_*` 추가.

### W6-PR7 — 성능 점검 + 결과 기록

**Bench 스크립트** (`scripts/oculpm-perf.sh`):
- 1만 파일 데모 레포 생성 (random typescript 파일들).
- 워처 ON, 1분 idle → 평균 CPU/메모리 측정.
- 100 파일 일괄 변경 → 이벤트 latency p50/p95/p99.
- 100 journal entries 마이그레이션 시간.
- Overview 페이지 로드 시간 (with 90일 데이터).

**SLO 목표**:
- idle CPU < 2%
- idle 메모리 < 50 MB (oculpm 관련 부분만)
- 단일 파일 변경 → ndjson 라인 추가 latency p95 < 500ms
- 100 파일 일괄 변경 → 모든 이벤트 처리 < 5초
- 마이그레이션 100 entries < 10초
- Overview 페이지 로드 < 500ms

**결과 기록**: `docs/major_update/oculpm/phases/_perf-w6.md`.

미달 시:
- 워처 화이트리스트 (`02-w2 §2.1`) 적용.
- cache batch update.
- React Virtual list for Today (entry > 100 시).

**DoD**:
- [ ] 6개 SLO 모두 통과.
- [ ] 결과 기록 문서 존재.

### W6-PR8 — 빈/로딩/에러 상태 마무리 + a11y

`02-frontend.md §14` 의 매트릭스 모든 행을 점검.

**a11y 점검 도구**:
- `axe-core` 또는 `react-aria` 의 검증.
- 모든 인터랙티브 요소 keyboard navigable.
- 모든 색상 대비 ≥ 4.5:1.
- mismatch 배지 같은 경고 = 색 + 아이콘 + 텍스트 3중.

**다크모드**:
- shadcn 의 dark variant 모두 적용.
- 직접 정의한 토큰 (W3-PR6 의 difficulty 농도) 의 다크 변형 확인.
- `prefers-reduced-motion` 존중.

**DoD**:
- [ ] axe-core report critical 0개.
- [ ] 다크모드 시각 비교 OK (라이트와 정보량 동일).
- [ ] 키보드 only navigation 으로 전체 Today/Overview 사용 가능.

### W6-PR9 — 로깅/관측 정리

**`tracing` 설정**:
- production: INFO 이상.
- debug 모드 (config.toml `[debug].verbose = true`): DEBUG 이상, `.oculpm/index/oculpm.log` 파일에도 기록.
- rotation: 10MB × 3.

**모듈별 target**:
- `oculpm::watcher`
- `oculpm::session`
- `oculpm::agents`
- `oculpm::migrate`
- `oculpm::cache`

**관측 포인트**:
- 워처: 매 1분마다 INFO 로 events_total / events_ignored_total.
- 세션: 전이마다 INFO.
- 마이그레이션: 매 entry 마다 DEBUG.
- 에러: 모두 ERROR.

**DoD**:
- [ ] `oculpm.log` 가 verbose 모드에서 생성.
- [ ] rotation 동작 확인 (수동 30MB 작성 시뮬레이션).
- [ ] 정상 모드에서 콘솔 잡음 최소.

### W6-PR10 — 1.0 릴리스 노트 + 사용자용 README + schema_version lock

**Files**:
- `docs/release-notes-1.0-oculpm.md` (new)
- `README.md` (update — ocul-pm 섹션 추가)
- `src-tauri/src/oculpm/schema_migrate.rs` (lock: v1 만 지원)

**릴리스 노트 구조**:

```markdown
# ocul-pm 1.0 — .oculpm/ 아키텍처 출시

## 이게 뭔가요
- 1줄 요약 + 핵심 변화

## 주요 변경
- `.oculpm/` 디렉토리 도입
- Today 가 메인 탭
- Overview 재포지셔닝
- 4개 LLM 에이전트와 자동 연동
- SQLite changelog 마이그레이션 가능

## 깨지는 변경 (breaking)
- 기존 ChangelogScreen 은 read-only (1.0)
- 디폴트 탭이 Today
- localStorage schema_version 1 → 2

## 마이그레이션
- 자동 (앱 진입 시 안내)

## 알려진 한계
- LLM 작성률은 어댑터/모델에 따라 다름
- 단일 사용자 가정

## 다음 라운드 (1.1+)
- (회고의 medium/low 항목들)
```

**사용자용 README**:
- 5분 onboarding 가이드.
- 어댑터 활성화 방법.
- "내 LLM 이 journal 을 안 써요" 트러블슈팅.
- `.oculpm/` 디렉토리 안 무엇이 있는지 한 화면.

**schema_version lock**: 1 이 아닌 schema_version 을 발견하면 명시적 에러 + 마이그레이션 미구현 안내. (2 이상은 후속 라운드.)

**DoD**:
- [ ] 릴리스 노트 작성.
- [ ] README 의 ocul-pm 섹션 추가.
- [ ] schema_version != 1 분기에서 명시적 에러.

---

## 2. 핵심 기술 노트

### 2.1 회고의 quality bar

회고는 "잘 됐어요" 가 아니라:
- **수치**: 작성률, 오류율, latency.
- **인용**: 실제 journal 파일 한두 개를 인용해서 좋은 예/나쁜 예.
- **결정**: 발견 → 어떻게 처리할 것인가의 결정 + 그 결정의 근거.

이 문서가 1.0 이후 1.1, 1.2 의 출발점이 된다. 짧게 쓰지 말 것.

### 2.2 성능 측정의 reproducibility

`scripts/oculpm-perf.sh` 는 매번 같은 seed (random 시드 고정) 로 데모 레포를 만들고 결과를 `_perf-w6.md` 에 누적. 회귀 발견 시 같은 스크립트로 재측정.

### 2.3 a11y 의 우선순위

개인 도구이므로 a11y 의 사회적 가치는 보통 작지만, **키보드 only 사용** 은 자신의 워크플로우에 직접 영향. 키보드 단축키가 잘 동작하는지 한 번 더 체크.

### 2.4 로깅이 jouranl 의 메타가 되지 않게

`oculpm.log` 는 디버그 도구. journal 의 narrative 와 혼동되어선 안 됨. log 라인에 어떤 entry 의 작성도 트리거하지 않도록 (워처가 `.oculpm/oculpm.log` 무시).

### 2.5 schema_version lock 의 의미

`schema_version = 1` 을 잠근다는 건, 그 이후의 변경은 모두 v2 로 명시되어야 한다는 의미. 호환성을 깨는 변경 (frontmatter 필수 필드 변경 등) 은 반드시 마이그레이션 코드 + schema_version 증가가 동반.

자잘한 비호환 변경을 v1 안에서 슬쩍 넣지 말 것.

---

## 3. 통합/수동 QA 체크리스트

- [ ] dogfooding 회고 문서 존재 + 데이터 채워짐
- [ ] Critical 이슈 0
- [ ] High 이슈 모두 처리 또는 backlog 로 명시 이월
- [ ] 통합 테스트 25개 시나리오 green
- [ ] 성능 SLO 6개 모두 통과
- [ ] axe-core a11y report critical 0
- [ ] 다크모드 모든 화면 정상
- [ ] 키보드 only 로 Today/Overview/Settings/Onboarding/Migration 전부 완주 가능
- [ ] `oculpm.log` rotation 동작
- [ ] 릴리스 노트 + 사용자 README 존재
- [ ] schema_version != 1 시 명시적 에러
- [ ] 전체 회귀: 기존 화면들 (chat, code, planner, terminal) 모두 정상
- [ ] CI green: `cargo test`, `cargo clippy`, `pnpm test`, `pnpm tauri build`
- [ ] 신선한 macOS dmg / Windows msi 빌드 둘 다 성공 (가능한 경우)

---

## 4. 알려진 함정

| 함정 | 대응 |
|---|---|
| 회고 작성을 미루다 W6 막판에 한꺼번에 | W3 부터 매일 한 줄씩 누적 (`_dogfooding-w3.md`, `_dogfooding-w4.md`, `_dogfooding-w5.md`). W6 에서는 통합/추출만. |
| Critical 이슈가 예상보다 많아 W6 1주로 부족 | 일정 ≥ 데이터. 1주 연장 vs 1.0 출시 후 1.1 핫픽스 둘 중 사용자 판단. 기본은 W6 연장. |
| 성능 측정의 환경 변수 (다른 앱 실행 중 등) | 측정 전 다른 앱 닫고, 3회 측정 평균. |
| schema_version 잠금 후 우리가 직접 v1 을 깨고 싶어짐 | "v1.5" 같은 중간 버전 만들지 말 것. v2 PR 로 처리. |

---

## 5. Definition of Done (W6 전체 = 1.0)

- [ ] 모든 PR 의 DoD ✅
- [ ] §3 의 수동 QA 14개 ✅
- [ ] dogfooding 회고 + perf 결과 문서 둘 다 존재
- [ ] 1.0 태그 (`v1.0.0-oculpm`) 생성 가능한 상태 (사용자가 푸시는 별도 액션)
- [ ] `.oculpm/` 의 schema_version 이 1 로 잠긴 상태

---

## 6. 출시 후 (참고)

1.0 출시 이후 운영:
- 매주 dogfooding 데이터 누적, 월 1회 리뷰.
- 회고의 medium/low 이슈를 1.1, 1.2 로 분배.
- 사용 어댑터의 신규 버전 출시 (예: Cursor 가 `.mdc` 포맷 변경) 시 어댑터 정의 갱신 PR.
- schema_version 증가는 명확한 사유와 마이그레이션 코드와 함께만.

---

## 7. 페이즈 종료 = 프로젝트 첫 라운드 종료

W6 의 끝은 ocul-pm 의 첫 메이저 라운드의 끝. 이 시점부터:
- `.oculpm/` 는 ai-pm 의 정체성 일부.
- 후속 작업은 모두 `.oculpm/journal/` 에 자동 기록됨.
- 본 phases/ 폴더는 history 로 보존 (삭제 X). 다음 라운드는 별도 폴더 (예: `docs/major_update/oculpm-v1.1/`) 로.
