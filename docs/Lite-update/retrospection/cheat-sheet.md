# Lite-W6 Cheat Sheet — 사용자 → AI 한 줄 명령

> 사용자가 *반복 입력하기 귀찮은* 명령을 한 줄로 줄인 사전.
> AI 는 본 사전의 *왼쪽 명령* 을 보면 *오른쪽 행동* 을 즉시 실행한다 (다른 확인 없이).
> 단, 각 명령의 *부수 confirmation 조건* 은 지킨다.

---

## 0. 진행 / 일시정지 / 복구

| 명령 | AI 행동 | 부수 확인 |
|---|---|---|
| `이어가` | 마지막 보고의 *다음 액션* 진행 | 보고에 다음 액션이 명시되어 있을 때만 |
| `이어가 X` | 마지막 보고의 X 번째 옵션 진행 (보고가 옵션을 나열했을 때) | — |
| `잠깐` / `멈춰` | 현재 작업 즉시 중단, 진행 상태 보고 | — |
| `되돌려` | `git stash` 또는 `git restore` 로 마지막 보고 시점 상태로 복귀 | 변경 파일 목록 보여주고 사용자 *yes* 받은 후 실행 |
| `되돌려 (PR<N>)` | `git reset --hard pre-cut-PR<N>` 로 해당 PR 직전 태그로 복귀 | 위와 동일 |
| `처음부터` | 현재 PR 전체 폐기 + master-prompt.md §5.1 의 *미진입* 상태로 재설정 | 강한 확인 필요 (체크박스 3개 입력) |

## 1. 보고 / 정찰

| 명령 | AI 행동 |
|---|---|
| `보고만 해` | 코드 변경 0. `quick-start.md` 6 step 의 보고 양식만 출력 |
| `상태` | `git status`, `git log --oneline -5`, master-prompt §5.1, 위반 의심 invariant 한 줄 보고 |
| `12 점검` | 12 invariant 각각을 *현재 코드/디스크* 와 비교해 ✅ / ⚠ / ❌ 표 출력 |
| `결정 19` | `07-implementation-checklist.md` §0 의 19 결정을 표로 재출력 |
| `회고` | `_dogfooding-retrospective.md` 의 §3 (Critical 4 + High 6) 만 요약 |
| `cheat-sheet` | 본 파일 다시 출력 |
| `문서 인덱스` | `master-prompt.md` §4 의 SSOT 인덱스 출력 |

## 2. PR 진행

| 명령 | AI 행동 |
|---|---|
| `PR<N> 시작해` | 해당 PR 의 *첫 작업* 진행 (보통 사전 정찰 + 회귀 테스트 추가). 코드 작성 전에 다시 사용자 확인 |
| `PR<N> 계획` | 해당 PR 의 sub-step 목록만 출력 (코드 변경 0) |
| `PR<N> DoD` | 해당 PR 의 DoD 체크리스트만 출력 |
| `PR<N> 머지 준비` | typecheck / lint / test / cargo / clippy 5종 실행 + 결과 보고. 머지는 사용자 직접 |
| `PR<N> 회귀` | 해당 PR 의 invariant 위반 가능성을 grep + 통합 테스트로 점검 |
| `다음 PR` | master-prompt §5.1 에서 *미진입* 첫 PR 식별 + 계획 출력 |

## 3. 결정 갱신

| 명령 | AI 행동 |
|---|---|
| `결정 추가: X → Y` | `07-implementation-checklist.md` §0.7 에 1행 추가 + 영향 받는 §장 동기화 |
| `결정 변경: X → Y → Z` | §0 의 기존 X 항목을 Y → Z 로 갱신 + 영향 §장 동기화 + master-prompt §5.3 에 변경 기록 |
| `결정 잠금 해제: X` | §0 의 X 항목을 *미해결* 로 복원 + 사용자 확인 필요 표시 |

## 4. 작업 흐름 단축

| 명령 | AI 행동 |
|---|---|
| `dogfood` | `pnpm tauri dev` 시작 + 사용자가 *수동 dogfood* 진행하는 동안 AI 는 대기 |
| `테스트` | `pnpm test` + `cargo test` 실행 + 실패만 보고 |
| `타입` | `pnpm typecheck` + `cargo check` 실행 + 에러만 보고 |
| `린트` | `pnpm lint` + `cargo clippy -- -D warnings` 실행 + 경고만 보고 |
| `빌드` | `pnpm tauri build --target aarch64-apple-darwin` 실행 + 크기 보고 |
| `포맷` | `pnpm format` + `cargo fmt` 실행 |
| `회귀` | `cargo test --test oculpm_integration_*` 실행 + 실패만 보고 |
| `로그 확인` | 최근 `oculpm.log.YYYY-MM-DD` 의 `[FLOW]` 라인 grep + 마지막 20줄 |

## 5. Phase / 일정

| 명령 | AI 행동 |
|---|---|
| `Phase A` | Phase A (PR0 ~ PR1) 의 다음 미진입 항목 진행 |
| `Phase B` | Phase B (PR2 ~ PR5) 의 다음 미진입 PR 식별 — 병렬 가능 표시 |
| `Phase C` | Phase C (PR6 ~ PR9) 의 다음 미진입 PR |
| `Phase D` | Phase D (PR10 ~ PR12) 의 다음 미진입 PR |
| `1.0 잔여` | 1.0 출시까지 미완 PR 모두 한 화면에 표 |
| `남은 일정` | master-prompt §5.1 기준 *예상 소요 주차* 추정 |

## 6. 위급

| 명령 | AI 행동 |
|---|---|
| `긴급 복구` | `master-prompt.md` 부록 B 의 응급 복구 한 줄 명령 실행 (사용자 *yes* 후) |
| `로그 덤프` | `.oculpm/index/oculpm.log.*` 최근 7일 분량 압축 + 첨부 가능 위치 안내 |
| `데이터 백업` | `.oculpm/` 전체를 `<workdir>/_backup-YYYYMMDD/` 로 cp -r |
| `세션 메모` | 마지막 N 시간의 *대화 요약* 을 master-prompt §5.2 에 누적 |

---

## 7. 사용 패턴 예시

```
사용자: <quick-start.md 붙여넣기>
AI: (보고)
사용자: 이어가
AI: (작업 진행)
...
사용자: 잠깐
AI: (현재 상태 보고)
사용자: 되돌려
AI: (변경 목록 보여줌)
사용자: yes
AI: (git restore + 보고)
```

```
사용자: <quick-start.md 붙여넣기>
AI: (보고)
사용자: PR3 시작해
AI: (PR3 사전 정찰 + 계획 출력)
사용자: 이어가
AI: (회귀 테스트 추가 → 사용자 확인 → 코드 작성)
```

```
사용자: 상태
AI: (1줄 보고)
사용자: 결정 추가: AI 오버레이 폭 720 → 640
AI: (§0.5 + §0.7 + master-prompt §5.3 갱신)
```

---

## 부록 — 명령이 *겹치지 않는* 룰

- *명령은 한 번에 하나*. `이어가 + 되돌려` 같은 결합 안 함.
- *명사 + 동사 단순체*. `보고만 해`, `결정 추가` 처럼 짧게.
- *모호 시 AI 는 cheat-sheet 의 어느 명령인지 사용자에게 되묻는다*. 추측 X.
- 본 사전에 *없는* 명령은 일반 자연어로 처리. (cheat-sheet 외 작업도 가능)
