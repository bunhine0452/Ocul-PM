# W3 — 작업 트래커

> 페이즈 명세: [`../phases/W3-journal-today-ui.md`](../phases/W3-journal-today-ui.md) (SSOT)
> 본 폴더의 PR 파일들은 **그 PR 의 워킹 도큐먼트** — 진행하면서 체크박스/노트 갱신.
> 선행: W2 의 §6 핸드오프 6개 항목 모두 ✅ (`../W2/README.md` §§ 참조).

---

## 진행 현황

| PR | 제목 | 상태 | 워킹 도큐먼트 |
|---|---|---|---|
| W3-PR1 | `frontmatter.rs` + `markdown.rs` (fail-soft 파서) | ✅ 완료 | [`PR1-frontmatter-markdown.md`](./PR1-frontmatter-markdown.md) |
| W3-PR2 | `cache.rs` SQLite 캐시 + 증분 재인덱싱 | ✅ 완료 | [`PR2-cache-sqlite.md`](./PR2-cache-sqlite.md) |
| W3-PR3 | 신규 5개 `oculpm_*` journal 커맨드 + manual entry | ✅ 완료 | [`PR3-commands.md`](./PR3-commands.md) |
| W3-PR4 | Frontend: specta wrapper + WorkspaceContext + 라우팅 | ✅ 완료 | [`PR4-frontend-context.md`](./PR4-frontend-context.md) |
| W3-PR5 | `EmptyToday` 3 변형 + `OculpmOnboardingModal` | ✅ 완료 | [`PR5-empty-today-onboarding.md`](./PR5-empty-today-onboarding.md) |
| W3-PR6 | `TimelineView` + `SessionCard` + `JournalEntryCard` | ✅ 완료 | [`PR6-timeline-cards.md`](./PR6-timeline-cards.md) |
| W3-PR7 | `JournalEntryDetail` (디테일 패널 + 마크다운) | ⬜ | [`PR7-entry-detail.md`](./PR7-entry-detail.md) |
| W3-PR8 | `CategoryFilterBar` + 필터 영속화 | ⬜ | [`PR8-category-filter.md`](./PR8-category-filter.md) |
| W3-PR10 | Greenfield 위저드 ↔ oculpm 통합 (옵션 A) | ⬜ | [`PR10-greenfield-integration.md`](./PR10-greenfield-integration.md) |
| W3-PR9 | 수동 dogfooding 부트스트랩 (5+ 시드 entry) | ⬜ | [`PR9-dogfooding-bootstrap.md`](./PR9-dogfooding-bootstrap.md) |

상태 표기: ⬜ 시작 전 · 🟡 진행 중 · ✅ 완료 · 🔴 블로커.

> **순서 주의**: PR 번호가 `1→2→…→8 → 10 → 9` 인 이유 = PR10 (Greenfield 통합) 이 PR9 (dogfooding) 의 입력 데이터를 제공해야 회고 품질이 살아남. dogfooding 은 페이즈의 **마지막** 게이트.

---

## 권장 진행 순서 (선후 의존)

```
PR1 (frontmatter/markdown) ─┐
                            ├─► PR2 (cache) ──┐
PR3 (commands) ─────────────┘                 │
                                              ▼
                                   PR4 (frontend wrapper/context)
                                              │
                       ┌──────────────────────┼──────────────────────┐
                       ▼                      ▼                      ▼
              PR5 (EmptyToday/Onboard)  PR6 (Timeline/Cards)   PR8 (FilterBar)
                       │                      │                      │
                       └────────┬─────────────┘──────────────────────┘
                                ▼
                          PR7 (EntryDetail)
                                │
                                ▼
                          PR10 (Greenfield 통합)
                                │
                                ▼
                          PR9 (dogfooding 회고)
```

병렬화 (1인이라도 컨텍스트 분리에 도움):
- 백엔드 (PR1/PR2/PR3) 와 프론트 (PR4) 는 specta binding 만 살아있으면 동시 진행 가능.
- PR5/PR6/PR8 은 PR4 완료 후 데이터 의존 없이 평행.

---

## 페이즈 종료 조건

- W3 의 모든 PR 이 ✅ (PR1~PR10, PR9 포함 10개)
- `phases/W3-journal-today-ui.md` §5 의 수동 QA 15개 항목 ✅
- `phases/W3-journal-today-ui.md` §7 의 Definition of Done 6개 항목 ✅
- W4 의 선행 조건 (`phases/W3-journal-today-ui.md` §8) 5개 ✅
- `_dogfooding-w3.md` 가 존재하고 시드 entry 5+ 회고가 들어 있음 (PR9)
- `cargo test`, `cargo clippy`, `pnpm test`, `pnpm tauri build` 모두 green

---

## §5 수동 QA 진행 (페이즈 가이드 §5 기준 — 15개)

| # | 항목 | 상태 | 비고 |
|---|---|---|---|
| 1 | 손으로 `.oculpm/journal/<오늘>/Bugs/0900_bug_test.md` 만들면 1초 안에 카드 표시 | ⬜ | PR2 + PR6 |
| 2 | 그 파일 삭제 → 1초 안에 카드 사라짐 | ⬜ | PR2 증분 reindex |
| 3 | 파일 내용만 수정 (frontmatter title 변경) → 카드 제목 갱신 | ⬜ | PR2 mtime 비교 |
| 4 | frontmatter 일부러 깨뜨림 (`type: ` 빈 값) → 카드 노란 dot, detail 원본 보기 | ⬜ | PR1 fail-soft + PR7 |
| 5 | 5개 type 필터 토글 OK | ⬜ | PR8 |
| 6 | 검색 "export" → 매치 카드만 표시 | ⬜ | PR8 검색 디바운스 |
| 7 | verified 토글 → 파일 frontmatter 실제로 변경 (cat 확인) | ⬜ | PR3 `set_journal_verified` |
| 8 | j/k 키 동작 | ⬜ | PR6 키보드 |
| 9 | EmptyToday V1 (`.oculpm/` 없는 새 프로젝트): "활성화" 카드 | ⬜ | PR5 V1 |
| 10 | EmptyToday V2 (init 했는데 오늘 0개, file_changes 0개) | ⬜ | PR5 V2 |
| 11 | EmptyToday V3 (오늘 file_changes 있지만 journal 0개) + DiffVsNarrative 자리 | ⬜ | PR5 V3 (버튼 disabled OK) |
| 12 | Onboarding 모달 3 step 완주 | ⬜ | PR5 |
| 13 | Onboarding 거절 → 재진입 시 모달 안 뜸, 상단 링크 유지 | ⬜ | PR5 localStorage |
| 14 | 디폴트 탭이 Today | ⬜ | PR4 라우팅 |
| 15 | 기존 사용자 storage 가 마이그레이션됨 (devtools 로 확인) | ⬜ | PR4 schema_version 1→2 |
| 보너스 | manual entry 작성 → agent.id == "manual" | ⬜ | PR3 + PR9 |

---

## §7 Definition of Done (W3 전체 — 페이즈 가이드 §7 기준)

| 항목 | 상태 | 근거 |
|---|---|---|
| 모든 PR 의 DoD ✅ | ⬜ | PR1~PR10 워킹 doc 의 DoD 체크박스 |
| §5 의 수동 QA 15개 ✅ | ⬜ | 위 §5 표 |
| 통합 테스트 `tests/oculpm_journal_indexing.rs` 5 시나리오 green | ⬜ | PR2 / PR3 / PR6 통합 |
| dogfooding 시드 entry 5개 + 회고 `_dogfooding-w3.md` | ⬜ | PR9 |
| 시안 (§3) 과 실제 UI 80% 이상 일치 | ⬜ | PR6 + PR7 디자인 검수 |
| `cargo test`, `cargo clippy`, `pnpm test`, `pnpm tauri build` 모두 green | ⬜ | CI / 로컬 확인 |

---

## §8 W4 핸드오프 (페이즈 가이드 §8 기준 — 5개)

| 항목 | 상태 | 위치 |
|---|---|---|
| 손으로 작성한 journal 이 Today UI 에서 보이는 상태 (자동 작성 X) | ⬜ | PR2+PR6 |
| cache 가 실시간 증분 갱신 (`oculpm:journal_path_changed` 트리거) | ⬜ | PR2 이벤트 hook |
| EmptyToday V3 (file_changes 있는데 journal 없음) UI 가 살아있음 | ⬜ | PR5 V3 |
| dogfooding 회고가 어댑터 템플릿(`agents/_template.md`) 의 첫 draft 에 인용 가능한 형태 | ⬜ | PR9 |
| "수동 entry 작성" 모달이 동작 — W4 자동화의 fallback | ⬜ | PR3 + PR5/PR6 |

---

## 페이즈 회고

> W3 마지막 PR 종료 시 채울 자리. 다음 항목을 최소 다룰 것 (W1/W2 회고 양식과 동일).

- **예상 대비 실제 소요**:
- **발견된 함정 vs 가이드 예측**:
- **W4 로 넘기는 결정/주의**:
