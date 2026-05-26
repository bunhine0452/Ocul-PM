# W4 — 작업 트래커

> 페이즈 명세: [`../phases/W4-agents-dual-layer.md`](../phases/W4-agents-dual-layer.md) (SSOT)
> 본 폴더의 PR 파일들은 **그 PR 의 워킹 도큐먼트** — 진행하면서 체크박스/노트 갱신.
> 선행: W3 의 §8 핸드오프 5개 항목 모두 ✅ ([`../W3/MANUAL-CHECKLIST.md`](../W3/MANUAL-CHECKLIST.md) §3 참조).

---

## 진행 현황

| PR | 제목 | 상태 | 워킹 도큐먼트 |
|---|---|---|---|
| W4-PR1 | `.oculpm/agents/_template.md` + 4 어댑터 템플릿 | ✅ | [`PR1-agent-templates.md`](./PR1-agent-templates.md) |
| W4-PR2 | `agents.rs` 렌더러 + `sync_active` + `detect` | ✅ | [`PR2-agents-renderer.md`](./PR2-agents-renderer.md) |
| W4-PR3 | `redact.rs` + `forbid_journal_for_paths` 강제 | ✅ | [`PR3-redact-forbid.md`](./PR3-redact-forbid.md) |
| W4-PR4 | Adapter drift 감지 + 토스트 흐름 | ✅ (BE) | [`PR4-adapter-drift.md`](./PR4-adapter-drift.md) |
| W4-PR5 | `compare_layers` 커맨드 + LayerComparison | ✅ | [`PR5-compare-layers.md`](./PR5-compare-layers.md) |
| W4-PR6 | Frontend `DiffVsNarrative` 모달 + 4 trigger | ✅ | [`PR6-diff-vs-narrative.md`](./PR6-diff-vs-narrative.md) |
| W4-PR7 | Frontend `OculpmSettings` 5 섹션 폼 | ✅ | [`PR7-oculpm-settings.md`](./PR7-oculpm-settings.md) |
| W4-PR8 | 이벤트 → 토스트 매핑 + CommandPalette 8 명령 | ✅ | [`PR8-events-toasts.md`](./PR8-events-toasts.md) |
| W4-PR9 | 자동 dogfooding 전환 + 3일치 회고 | 🟡 | [`PR9-auto-dogfooding.md`](./PR9-auto-dogfooding.md) |

상태 표기: ⬜ 시작 전 · 🟡 진행 중 · ✅ 완료 · 🔴 블로커.

> **순서 주의**: 백엔드 PR1~PR5 가 먼저, 그 위에 프론트 PR6~PR8, 마지막에 운영 전환 PR9. PR9 는 코드가 아닌 운영 전환 — W3-PR9 와 같이 인간 작업.

---

## 권장 진행 순서 (선후 의존)

```
PR1 (어댑터 템플릿) ──┐
                      ├─► PR2 (렌더러 + sync) ──┐
                      │                          │
                      │                          ├─► PR4 (drift 감지)
                      │                          │
                      ▼                          │
              PR3 (redact + forbid)              │
                      │                          │
                      ▼                          │
              PR5 (compare_layers) ──────────────┘
                      │
                      ├──────────────┬──────────────┐
                      ▼              ▼              ▼
              PR6 (DiffVsNarrative) PR7 (Settings) PR8 (Events+Toasts)
                      │              │              │
                      └──────────────┴──────────────┘
                                     │
                                     ▼
                              PR9 (자동 dogfooding 전환)
```

병렬화 (1인이라도 컨텍스트 분리에 도움):
- PR1 (마크다운 작성) 와 PR2/PR3 (Rust) 는 별도 컨텍스트라 평행 가능.
- PR6/PR7/PR8 은 PR5 의 `compare_layers` binding 만 살아있으면 평행.
- PR9 는 PR1~PR8 모두 완료 후 운영 시작.

---

## 페이즈 종료 조건

- W4 의 모든 PR 이 ✅ (PR1~PR9, 9개)
- `phases/W4-agents-dual-layer.md` §4 의 수동 QA 14개 항목 ✅
- `phases/W4-agents-dual-layer.md` §6 의 Definition of Done 6개 항목 ✅
- W5 의 선행 조건 (`phases/W4-agents-dual-layer.md` §7) 5개 ✅
- `_dogfooding-w4.md` 가 존재하고 3일치 데이터, 작성률 ≥ 60% (PR9)
- 실제 외부 LLM (Cursor / Claude Code 중 1개 이상) 으로 작업 → journal 자동 작성 검증 1회 이상
- `cargo test`, `cargo clippy`, `pnpm tauri build` 모두 green

---

## §4 수동 QA 진행 (페이즈 가이드 §4 기준 — 14개)

> 자세한 사용자 체크리스트는 **W4 종료 직전** [`./MANUAL-CHECKLIST.md`](./MANUAL-CHECKLIST.md) 를 W3 와 동일 방식으로 작성 권장. 현재는 페이즈 표만 미러.

| # | 항목 | 상태 | 비고 |
|---|---|---|---|
| 1 | Settings 에서 Cursor 활성화 → `.cursor/rules/ocul-pm.mdc` 생성, mtime 가 방금 | ⬜ | PR2 + PR7 |
| 2 | Cursor 비활성화 → 파일 삭제 | ⬜ | PR2 sync remove |
| 3 | Claude Code 활성화 → `.claude/CLAUDE.md` 의 관리 블록 추가, 블록 밖 사용자 콘텐츠 보존 | ⬜ | PR2 ManagedBlock |
| 4 | `.oculpm/agents/_template.md` 직접 편집 → 1초 후 활성 어댑터 모두 갱신 | ⬜ | PR2 + watcher |
| 5 | 외부 에디터로 `.cursor/rules/ocul-pm.mdc` 변경 → drift 토스트 → "동기화" 클릭 → 원상복귀 | ⬜ | PR4 + PR8 |
| 6 | 가짜 API 키를 코드 본문에 넣고 저장 → ndjson 의 path 그대로, content 는 redact | ⬜ | PR3 |
| 7 | `.env.local` 수정 → ndjson 의 path 가 `**redacted/sensitive**:...` | ⬜ | PR3 forbid_journal_for_paths |
| 8 | DiffVsNarrative: 일부러 entries 부족한 세션 → only_in_index 4개 표시 | ⬜ | PR5 + PR6 |
| 9 | DiffVsNarrative: 일부러 가짜 path 적은 entry → only_in_journal 1개 표시 (환각 검출) | ⬜ | PR5 + PR6 |
| 10 | DiffVsNarrative: "수동 narrative 작성" → ManualEntry 모달의 files_touched prefill | ⬜ | PR6 + W3 ManualEntryModal |
| 11 | 외부 LLM (Claude Code) 으로 실제 작업 1건 → 자동으로 journal 파일 생성 + Today 카드 | ⬜ | PR9 (자동 dogfooding) |
| 12 | integrity_warning: 잘못된 frontmatter → 토스트 + 노란 dot | ⬜ | PR8 + W3-PR7 destructive 카드 |
| 13 | CommandPalette 의 새 명령 8개 동작 | ⬜ | PR8 |
| 14 | 2일치 자동 dogfooding 데이터 (`_dogfooding-w4.md`) | ⬜ | PR9 |

---

## §6 Definition of Done (W4 전체 — 페이즈 가이드 §6 기준)

| 항목 | 상태 | 근거 |
|---|---|---|
| 모든 PR 의 DoD ✅ | ⬜ | PR1~PR9 워킹 doc 의 DoD 체크박스 |
| §4 의 수동 QA 14개 ✅ | ⬜ | 위 §4 표 |
| 통합 테스트 `tests/oculpm_agents_compare.rs` 5 시나리오 green | ⬜ | PR2 / PR5 통합 |
| `_dogfooding-w4.md` 가 3일치 데이터, 작성률 ≥ 60% | ⬜ | PR9 |
| 실제 외부 LLM 으로 작업 → journal 자동 작성 검증 1회+ | ⬜ | PR9 |
| `cargo test`, `cargo clippy`, `pnpm tauri build` 모두 green | ⬜ | CI / 로컬 확인 |

---

## §7 W5 핸드오프 (페이즈 가이드 §7 기준 — 5개)

| 항목 | 상태 | 위치 |
|---|---|---|
| 자동 dogfooding 이 안정적으로 동작 (W5 작업 자체가 자동 기록됨) | ⬜ | PR9 |
| `LayerComparison` API 가 검증된 비교를 반환 | ⬜ | PR5 |
| `OculpmSettings` 폼이 모든 config 키를 노출 | ⬜ | PR7 |
| drift 감지 + 사용자 액션 흐름 검증됨 | ⬜ | PR4 + PR8 |
| redact + forbid_journal_for_paths 의 false positive 가 없음 (3일 사용 검증) | ⬜ | PR3 + PR9 |

---

## 페이즈 회고

> W4 마지막 PR 종료 시 채울 자리. 다음 항목을 최소 다룰 것 (W1/W2/W3 회고 양식과 동일).

- **예상 대비 실제 소요**:
- **발견된 함정 vs 가이드 예측**:
- **작성률 (PR9 최종 수치)**:
- **W3 dogfooding 회고가 어댑터 템플릿에 실제로 인용된 위치**:
- **W5 로 넘기는 결정/주의**:
