# 01. W6 재검토 — 그대로 진행할 것인가?

> 본 문서의 위상: 사용자 질문 *"W6 를 꼭 개발해야하는지도 확인해주길 바람"* 에 대한 정답.
> 결론을 받아들이면 [`07-implementation-checklist.md`](./07-implementation-checklist.md) 의 일정이 잠긴다.

---

## 0. TL;DR

**W6 의 원안을 그대로 진행하는 것은 권하지 않는다.** 그러나 W6 가 다루던 *문제* (회고 · 통합 테스트 · 성능 · a11y · 릴리스 노트 · schema 잠금) 는 1.0 출시에 *필수*. 따라서:

> **원안 W6 (`docs/major_update/oculpm/phases/W6-stabilize-dogfood.md`) 의 PR 들을 그대로 머지하는 대신, 본 폴더의 `Lite-W6` (= Phase A + B + C + D) 로 *재구성* 한다.**

원안 W6 의 항목을 어떻게 흡수/대체했는지:

| W6 원안 PR | 처분 | 새 위치 |
|---|---|---|
| W6-PR1 (Dogfooding 회고) | **유지**. 단, 회고 결과의 hotfix backlog 가 *Lite-W6 자체* 의 결정에 흡수됨. | `_dogfooding-retrospective.md` 작성은 그대로. |
| W6-PR2~PR5 (Hotfixes) | **대체**. dogfooding 발견 이슈 4건 (MEMORY.md 의 2026-05-25 / 26 / 27 회차) + Lite 의 *기능 삭제* PR 들로 흡수. | Lite-W6 의 Phase B PR3 ~ PR5. |
| W6-PR6 (통합 테스트 25 시나리오) | **유지**. 단, *삭제된 기능* (Changelog, Session 비교) 의 시나리오는 제거. *신규 기능* (로컬 diff 뷰어) 의 시나리오 추가. | Lite-W6 PR11. |
| W6-PR7 (성능 점검) | **유지**. SLO 그대로. | Lite-W6 PR11. |
| W6-PR8 (a11y / dark mode) | **유지**. 단, *Lite 후 잔존 화면* 만 점검. | Lite-W6 PR10. |
| W6-PR9 (로깅/관측) | **부분 유지**. `oculpm.log` rotation 만. tracing module breakdown 은 v1.1 로 미룸. | Lite-W6 PR10 또는 PR11. |
| W6-PR10 (1.0 릴리스 노트 + README + schema lock) | **유지 + 확장**. 릴리스 노트가 *Lite 변화* 까지 포함. | Lite-W6 PR12. |

핵심 차이는 — **W6 원안은 "현재 상태를 안정화" 가 목적**이었고, **Lite-W6 는 "현재 상태에서 더 잘라낸 다음 안정화" 가 목적**이라는 점이다.

---

## 1. W6 원안의 가정과 그 가정이 깨진 지점

W6 원안의 작성 시점 가정:

1. *W1~W5 가 끝나면 ai-pm 의 표면은 "AI PM" 정체성에 충실해진다.*
2. *그 이후엔 dogfooding 만으로 발견된 *작은* 이슈만 남는다.*
3. *Critical/High hotfix 4건 정도면 1.0 으로 잠글 수 있다.*

dogfooding 1~3 차 결과 (MEMORY.md):

> - **W4 1차 (2026-05-25)**: AGENTS.md 가 외부 LLM 에 더 잘 먹힘. **session 중복 생성 버그**. opener 권한 누락. **LayerComparison 모달 UX 재설계 필요.**
> - **W4 2차 (2026-05-26)**: opener scope 미설정 (1차 fix 무효). DiffVsNarrative 좁은 폭 헤더 깨짐. "규칙 다시 보내기" 라벨/동작 분리.
> - **W4 3차 (2026-05-27)**: 과거 날짜 UI 회귀. **LayerComparison 이 tmp/agent-state peer 파일을 거짓 누락**. session 종료 탐지 정리.

3 회차 회고의 공통 주제는 — *세션 추정 UI 자체가 잘못된 표면* 이라는 신호. dogfooding 이 거듭될수록 "이 UI 는 더 정교한 hotfix 가 필요" 가 아니라 **"이 UI 는 1.0 의 정체성과 안 맞는다"** 가 결론. W6 원안의 PR2~PR5 (hotfix 4건) 로 해결되지 않는 *구조적* 문제.

비슷하게:

- SQLite Changelog 는 W5 의 마이그레이션 도구로 *journal/ 로 옮길 수 있는 상태*. **두 시스템 병존이 더 이상 필요 없는 시점**.
- 자체 CodeEditor 는 W2 ~ W5 의 일관된 의도 (*외부 에이전트가 코드를 쓰고, 우리는 기록한다*) 와 정합하지 않음. 사용 빈도도 낮음.
- Problems 탭은 *PR placeholder 자체* 가 1.0 에 노출되면 신뢰 손상.

이 결정들은 *hotfix* 가 아니라 *축소* 다. W6 원안은 축소를 다루지 않는다 → 원안 그대로 진행은 부적합.

---

## 2. Lite-W6 의 추가 가치

W6 원안이 다루지 않았지만 Lite-W6 가 다루는 항목:

1. **"세션 추정 UI 의 거짓 표시 위험" 의 구조적 해소** — D4 결정 (UI 제거, backend invariant 유지).
2. **"두 변화 추적 시스템 병존" 의 해소** — D1 결정 (SQLite Changelog 완전 제거).
3. **"IDE 흉내" 의 해소** — D2, D6, D7 결정 (CodeEditor 제외, 3-IA, 메인 도크 터미널).
4. **"외부 LLM 결과 검증의 대체 경로"** — D5 결정 (로컬 diff 뷰어).

이 4개 가치는 — 사용자 발언 *"주요 목적은 프로젝트 관리하는 목적에 부합하도록 필요없는 기능을 덜어낸다"* 의 직접 반영.

---

## 3. Lite-W6 의 추가 비용

원안 W6 가 1주였다면, Lite-W6 는 *3~5주*. 추가 비용은:

- **삭제 PR 의 회귀 위험** — 보호망 PR0 의 추가 작성 시간 약 3일.
- **로컬 diff 뷰어 신규 구현** — 약 1주 (backend reindex hook + frontend diff view).
- **3-IA 재구성** — 약 3~4일 (단축키 매핑, persist 키 마이그레이션 포함).

비용 / 가치 비교:

| | 원안 W6 (1주) | Lite-W6 (3~5주) |
|---|---|---|
| 1.0 출시 후 1.1 으로 미룬 *구조적 부채* | 큼 (D1, D4 의 구조적 이슈 잔존) | 작음 |
| 1.0 의 정체성 명확도 | 중 | 높음 |
| 신규 사용자가 첫 5분 안에 길 잃을 확률 | 중 | 낮음 |
| 외부 LLM 어댑터 의존성 (R-1) | 그대로 큼 | 작음 (로컬 diff 가 대안 경로) |

이 라운드를 *1.0 정체성을 굳히는 마지막 기회* 로 본다면 — 3~5주 추가는 정당하다.

---

## 4. Lite-W6 를 *진행하지 않는* 시나리오

다음 중 하나가 사실이면 Lite-W6 를 포기하고 원안 W6 로 진행해도 된다:

- (a) **"1.0 출시일이 이미 외부에 약속됨"** — 약속된 마감이 < 2주 라면 Lite 는 무리.
- (b) **"외부 LLM 어댑터가 이미 충분히 잘 동작"** — dogfooding 작성률이 ≥ 90% 이고 LayerComparison 의 false positive 가 ≤ 2% 라면 D4, D5 의 추진 동기가 약해짐.
- (c) **"SQLite Changelog 의 잔존 사용자 데이터가 큼"** — 사용자가 SQLite 시대에 쌓아둔 entries 가 *마이그레이션 모달로 옮기기 어려운 양* 이면 D1 의 단계적 제거가 필요. (현재 본 프로젝트 데이터는 dogfooding 산물이 대부분이라 해당 없음.)

위 3개 모두 *현재 시점에 해당되지 않는다* → Lite-W6 진행이 합리.

---

## 5. 결정 요청 (사용자 확정 사항)

1. ☐ Lite-W6 의 전체 방향 (§0 ~ §4) 에 동의한다.
2. ☐ 3~5 주 추가 일정 (Lite-W6 의 Phase A+B+C+D) 에 동의한다.
3. ☐ `docs/major_update/oculpm/phases/W6-stabilize-dogfood.md` 는 *역사적 문서* 로 보존하고 더는 갱신하지 않는다.
4. ☐ 회고 (`_dogfooding-retrospective.md`) 는 Lite-W6 의 *Phase A 직전* 에 한 번 작성하고, 그 결과를 [`02-removal-plan.md`](./02-removal-plan.md) 의 우선순위에 반영한다.

위 4 항목이 ✅ 되면 본 문서의 결정이 잠긴다.

---

## 6. 회고 작성 가이드 (Phase A 직전)

Lite-W6 진행 전 1 시간 안에 작성. 양식:

```markdown
# Dogfooding 회고 (W3 ~ W5 ~ 2026-05-28)

## A. 작성률
| 기간 | 의도 단위 N | 자동 entries M | 작성률 |

## B. 어댑터별 품질
- claude-code:
- cursor:
- antigravity:
- gemini-cli:

## C. dogfooding 1~3차 (2026-05-25/26/27) 의 발견
- (메모리 참조: opener scope, AGENTS.md 효과, LayerComparison false positive)

## D. *구조적* 결정으로 옮긴 항목
- D1, D4 가 hotfix 가 아니라 축소가 된 근거.

## E. Lite-W6 에서 *해결하지 않을* 항목
- v1.1 backlog 후보. 본 문서 §6 의 미해결 결정과 cross-link.
```

이 회고가 — Lite-W6 PR 의 *지배 사유* 가 된다. PR 본문은 회고의 어느 § 를 해결하는지를 인용한다.

---

## 7. 결정 후 액션

1. 본 문서 §5 의 4 항목을 사용자가 ✅ 한다.
2. [`07-implementation-checklist.md`](./07-implementation-checklist.md) §0 의 미해결 결정 (§00 §부록 B) 도 함께 확정.
3. 회고 작성 (Phase A 직전).
4. [`02-removal-plan.md`](./02-removal-plan.md) 의 PR0 로 진입.
