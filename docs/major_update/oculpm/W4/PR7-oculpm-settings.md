# W4-PR7 — Frontend `OculpmSettings` 5 섹션 폼

> **목표**: `OculpmConfig` 의 모든 키를 사용자가 GUI 로 편집 가능하게. 변경은 500ms 디바운스 후 `oculpm_set_config` 호출. 검증 실패 시 인라인 에러.
> **선행**: W3-PR4 (oculpmApi.{getConfig, setConfig}), W4-PR2 (detect, sync_active), W4-PR3 (redact 패턴 검증).
> **참조**: [`../phases/W4-agents-dual-layer.md`](../phases/W4-agents-dual-layer.md) §W4-PR7, [`../00-spec.md`](../00-spec.md) §5 (config 스키마).
> **상태**: ⬜

---

## 1. 위치 / 진입 (계획)

- 파일: `src/features/settings/OculpmSettings.tsx`.
- 진입: 기존 Settings 화면의 새 탭 "ocul-pm" (= W3-PR4 에서 자리만 보존됐다면 그 자리, 아니면 본 PR 에서 신설).
- 또는 CommandPalette 의 "ocul-pm 설정" (PR8).

---

## 2. 5 섹션 (계획)

### 2.1 Workday

| 필드 | UI | 검증 |
|---|---|---|
| `timezone` | shadcn Select (IANA 자동완성) | backend 의 `WorkdayResolver::new` 가 reject 시 inline 에러 |
| `day_starts_at` | time picker (`HH:MM`) | 정규식 `^([01]\d\|2[0-3]):[0-5]\d$` |

### 2.2 Session

| 필드 | UI | 검증 |
|---|---|---|
| `idle_timeout_secs` | slider 300~3600 | u32 |
| `auto_close.on_app_exit` | toggle | — |
| `auto_close.on_idle` | toggle | — |

### 2.3 Git

| 필드 | UI | 검증 |
|---|---|---|
| `journal_committed` | toggle | — |
| `forbid_journal_for_paths` | tag editor (chip per pattern) | glob valid (W4-PR3 의 validate) |
| `auto_redact_patterns` | textarea (1줄 1정규식) | `Regex::new` (inline 에러) |

### 2.4 Watcher

| 필드 | UI | 검증 |
|---|---|---|
| `ignore` | tag editor | glob valid |
| `respect_gitignore` | toggle | — |
| `debounce_ms` | number input 50~2000 | u32 |

### 2.5 Agents

| 필드 | UI | 동작 |
|---|---|---|
| `active` | 4 chip multi-select (Cursor / Claude Code / Antigravity / Gemini CLI) | 변경 시 컨펌 모달 → set_config + sync_agents |
| `auto_detect_on_open` | toggle | — |
| `auto_sync_adapters` | toggle | — |
| "감지" 버튼 | onClick → `oculpmApi.detectAgents` → 각 chip 옆에 confidence 배지 (Present/Likely) | PR2 `detect` |
| "지금 동기화" 버튼 | onClick → `oculpmApi.syncAgents` → 토스트 결과 | PR2 `sync_active` |

---

## 3. 변경 흐름 (계획)

```
사용자 입력 ──► local React state ──► 500ms debounce
                                          │
                                          ▼
                              oculpmApi.setConfig(projectId, newConfig)
                                          │
                                ┌─────────┴─────────┐
                              성공                  실패
                                │                    │
                                ▼                    ▼
                       (silent) toast            inline 에러
                                                     │
                                                     ▼
                                            local state 는 그대로
                                            (사용자가 수정 가능)
```

### `active` 변경 시 컨펌 모달

```
"Cursor 를 활성화하면 .cursor/rules/ocul-pm.mdc 가 생성됩니다.
 진행할까요?

 [활성화] [취소]"
```

비활성화 시:

```
"Cursor 를 비활성화하면 .cursor/rules/ocul-pm.mdc 가 삭제됩니다.
 사용자가 직접 편집한 내용이 있다면 손실됩니다.

 [비활성화] [취소]"
```

---

## 4. 테스트 (계획)

페이즈 §3: Vitest 5 케이스 (W6 위임).

- [ ] 5 섹션 모두 mount + 디폴트 값 표시.
- [ ] 잘못된 tz 입력 → inline 에러 + setConfig 호출 안 함.
- [ ] 활성화/비활성화 컨펌 모달 동작.
- [ ] active 변경 → setConfig + syncAgents 두 호출 모두 발생.
- [ ] auto_redact_patterns 에 잘못된 정규식 → inline 에러.

수동 QA (페이즈 §4 #1, #2, #3):

- [ ] Cursor 활성화 → `.cursor/rules/ocul-pm.mdc` 생성, mtime 가 방금.
- [ ] Cursor 비활성화 → 파일 삭제.
- [ ] Claude Code 활성화 → `.claude/CLAUDE.md` 의 관리 블록 추가, 블록 밖 사용자 콘텐츠 보존.

---

## 5. DoD

- [ ] 5 섹션 모두 동작.
- [ ] 잘못된 tz / 정규식 / glob 입력 시 inline 에러.
- [ ] 활성화/비활성화 시 어댑터 파일 시스템 변경 확인 (수동 QA 3건).
- [ ] 500ms 디바운스 — 슬라이더/타이핑 중 매 입력에 setConfig 호출 안 함.

---

## 6. 실행 노트 (작업 중 갱신)

### 의사결정 후보

1. **저장 UI 패턴** — auto-save (500ms 디바운스) vs 명시적 `[저장]` 버튼. 페이즈 권장은 auto-save. 단점: 부분 잘못된 입력 (예: tz 가 중간 상태 `Asia/`) 이 일시적으로 setConfig 호출. validate 가 먼저 통과해야 호출.
2. **`forbid_journal_for_paths` 의 디폴트 readonly?** — Settings 에 chip 으로 노출하면 사용자가 실수로 다 지우는 위험. 디폴트 5개는 readonly + 추가 chip 만 사용자 편집 가능 검토.
3. **컨펌 모달 vs 토스트 + undo** — 컨펌이 안전 (특히 비활성화 시 파일 삭제). 단점: 클릭 1번 추가. v1 은 컨펌.

### 발견된 함정 / 변경

(작성 중)

### 다음 PR 로 넘기는 메모

- PR8 의 CommandPalette 가 "ocul-pm 설정" 명령으로 본 PR 의 화면 진입.
- PR9 의 자동 dogfooding 중 `active` 의 어댑터를 1개씩 켜며 작성률 측정 → 본 PR 의 UI 가 사용성 충분한지 검증.
