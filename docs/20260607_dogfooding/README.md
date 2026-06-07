<!-- schema_version: 1 -->
# 도그푸딩 피드백 라운드 (2026-06-07) — 문서 인덱스

> 상태: **구현 완료 ✅** · 작성일 2026-06-07 · 작성자 claude-code (Opus 4.8)
> 브랜치: `feat/dogfooding-feedback-round-20260607`
> 선행 라운드: [`../planner-upgrade/`](../planner-upgrade/) (Planner Upgrade, PR-PLN 0~5 ✅) · [`../20260606_refactor/`](../20260606_refactor/) (배포-실용성)
> 시각 SSOT (불변): [`../Lite-update/Fianl_UI_update_before1.0/Ocul-PM1.0/`](../Lite-update/Fianl_UI_update_before1.0/Ocul-PM1.0/)

---

## 0. 이 폴더의 위상

직접 도그푸딩하며 4개 영역(**사이드바 · 작업 일지 · Planner · 변경 diff**)에 대해 정리한 피드백(버그 + UX 개선 혼합)을, 이 프로젝트 관행대로 **검토 가능한 PR 배치 5개**로 쪼개 구현한 라운드. 직전 라운드들과 달리 *설계-우선*이 아니라 **피드백 → 즉시 구현** 라운드라, 본 문서 세트는 *완료 기록*이다.

핵심 질문: **"내가(개발자) 매일 쓰면서 거슬렸던 마찰들이, 실제로 사라졌는가?"**

---

## 1. 문서 구성

| 파일 | 역할 |
|---|---|
| [`00-feedback-and-decisions.md`](./00-feedback-and-decisions.md) | 원본 피드백(4영역 16항목) + 확정 결정 3건(카드→모달 / 잠금 방식 / diff 묶음 기준) + 스코프 |
| [`01-changes-by-area.md`](./01-changes-by-area.md) | 영역별 변경 내역 — 원인·수정·`file:line` 근거 (구현 기록) |
| [`02-implementation-checklist.md`](./02-implementation-checklist.md) | PR 배치별 DoD + 상태표 + 게이트 결과 + 수동 검증 가이드 |

읽는 순서: `README` → `00` → `01` → 검증 시 `02`.

---

## 2. 한 화면 요약

| 영역 | 무엇이 바뀌었나 |
|---|---|
| **사이드바** | 접기 버튼 추가. 접으면 화면에서 사라지고, 좌측 가장자리 호버 시 오버레이로 떠오름. 버튼으로 다시 고정. 상태 영속. |
| **작업 일지** | 카드의 `+0` 파일 칩 제거(에이전트가 byte 미기입). 카드 클릭 → **2-pane 모달**(좌: 일지 서술 + 변경파일 op·경로구분, 우: 기록된 diff). 큰 파일 상단 잘림·diff 줄바꿈 해소. |
| **Planner** | **완료·잠금** 버튼(`status: done`). 잠긴 plan 은 인앱 편집·AI 갱신을 거부(백엔드 가드) + AGENTS.md 규칙으로 외부 에이전트도 차단. 다중 plan 칩 정렬(active 먼저)·🔒. |
| **변경 diff** | 삭제 파일 모달(에러 대신), `!`임시·redacted 추적 중단, **모두 검토 완료** 버튼, 파일을 **작업 일지 + Plan 기준 그룹화**. |

---

## 3. 진행 상태 (2026-06-07)

| PR 배치 | 내용 | 상태 |
|---|---|---|
| **PR-FIX** | 삭제파일 diff · `!`/redacted 억제 · 모두 검토 · 단일행 diff | ✅ |
| **PR-SB** | 사이드바 접기 + 호버 노출 | ✅ |
| **PR-JR** | 카드 정리 + 풍부한 모달(서술+diff) + 동일이름 구분 | ✅ |
| **PR-PLN6** | Planner 완료·잠금 + 다중 plan 내비 + AGENTS.md 규칙 | ✅ |
| **PR-DF-GROUP** | 변경 파일 일지/plan 그룹화 (`oculpm_group_changes`) | ✅ |

**게이트 (커밋 직전 직접 확인 — 전부 exit 0):**
- `pnpm typecheck` ✅ · `pnpm test` ✅ (113 pass) · `pnpm lint` ✅ · `pnpm build` ✅
- `cargo test --lib` ✅ (260 pass)

---

## 4. 브랜치 / 빌드 메모

- 브랜치: **`feat/dogfooding-feedback-round-20260607`** (main 분기). 본 라운드 단일 커밋(영역 간 파일 얽힘으로 배치별 분리 대신 통합 커밋).
- `src/lib/bindings.ts` 는 **gitignore** — `cargo test` 의 `export_bindings` 가 재생성. 신규 커맨드(`plan_set_status`, `oculpm_group_changes`) 추가 후 `cargo test` 필수.
- DMG: `pnpm tauri build` → `src-tauri/target/release/bundle/dmg/`. 서명 없음(첫 실행 시 "손상됨" 안내는 [`../20260606_refactor`] 와 동일, 우클릭→열기).
