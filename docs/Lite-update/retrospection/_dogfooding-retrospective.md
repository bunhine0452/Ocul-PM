# Dogfooding 회고 (W3 ~ W5, ~ 2026-05-28)

> 본 문서는 [`../01-w6-reassessment.md`](../01-w6-reassessment.md) §6 *회고 작성 가이드* 의 산출물.
> Lite-W6 Phase A PR0 진입 전 *지배 사유* 가 되는 SSOT.
> 작성 시점: 2026-05-28
> 작성자: Claude(Opus 4.7)

---

## 0. 본 회고의 *재구성* 성격 명시

원안 W6-PR1 의 회고는 *fresh dogfood 세션 실측* 을 전제로 한다. 그러나 본 라운드는:

- **Lite-W6 시작 전 1회 작성** 으로 위치를 옮겼고,
- **신규 dogfood 1주차** 데이터 누적을 *별도로 진행하지 않았다*.

따라서 본 회고는 다음 3 출처를 *재구성* 한다:

1. **MEMORY.md 의 dogfooding 메모** (2026-05-25 / 26 / 27 의 3 회차) — 사용자 발견 + 같은 날 조치 기록.
2. **`docs/major_update/oculpm/phases/_dogfooding-w4.md`** — 14건의 발견 + 코드 변경 추적.
3. **현재 코드/디스크 상태 정찰** (2026-05-28 16:00 시점):
   - `.oculpm/journal/` 의 *워크데이별 디렉토리*
   - `.oculpm/index/<workday>/file_changes.ndjson` 의 라인 수
   - `.oculpm/config.toml` 의 `agents.active`
   - `.oculpm/agents/` 의 등록된 어댑터 파일

본 회고가 *실측 회고* 가 아니라 *증거-기반 재구성* 임을 잊지 않고, 결정의 *방향성* 은 신뢰하되 *세부 수치* 는 적당히 보수적으로 해석한다.

---

## 1. 작성률 추이

### 1.1 본 프로젝트 (`ai-pm`) 의 journal/

```
.oculpm/journal/
├── 20260521/          ← 비어 있음 (0 entries)
└── (이후 워크데이 디렉토리 없음)
```

```
.oculpm/index/
├── 20260521/file_changes.ndjson   ← 0 lines
└── 20260528/file_changes.ndjson   ← 1 line (오늘 03:56, db.rs create 1건)
```

→ **본 프로젝트의 *자체* journal 작성률 = 0%.**

이것은 *실패가 아니라 의도* — ai-pm 자체의 `.oculpm/config.toml` 의 `agents.active = []`. 본 프로젝트는 **자기 자신을 dogfood 대상으로 활성화하지 않았음.** 외부 프로젝트만 dogfood 했다.

### 1.2 외부 프로젝트 dogfood (메모리 + W4 doc 참조)

| 일자 | 외부 프로젝트 | 어댑터 | 결과 |
|---|---|---|---|
| 2026-05-25 | `black-corp-tycoon` | antigravity (+ Claude Code 위임) | 1건 자동 작성 — `0953_feature_game-overhaul-...md` |
| 2026-05-26 | `black-corp-tycoon` | 동일 | 다수 (정확 수치 미기록) |
| 2026-05-27 | `storygame` | antigravity | 3건 자동 작성 — 단, *init 시 reindex 누락* 으로 UI 에는 0건으로 보임 (발견 12 가 같은 날 fix) |

→ **외부 프로젝트의 작성률은 *0% 가 아님*** — 어댑터가 활성화되면 antigravity 는 frontmatter 가 정상인 entry 를 안정적으로 작성. *마스터 템플릿이 root `AGENTS.md` 에 있을 때*.

### 1.3 합산 해석

작성률 그 자체는 *측정 불가* (외부 프로젝트의 정확한 의도 단위 N 을 사후 추정 못 함). 그러나 *조건부 작성률* 은 명확:

- **어댑터 미활성 (`agents.active = []`)**: 0%.
- **어댑터 활성 + 마스터 템플릿이 root `AGENTS.md`**: 추정 60~90% (3 회차 dogfood 에서 의도 단위마다 entry 1+건 생성).
- **어댑터 활성 + 마스터 템플릿이 `.oculpm/agents/_template.md` 만**: 추정 0~10% (외부 LLM 이 이 경로를 자발적으로 안 읽음 — 발견 1 의 핵심).

이 분포가 [`../00-master-plan.md`](../00-master-plan.md) §9 의 *"본 라운드의 작성 자체가 dogfooding"* 의 검증 기준이 된다.

---

## 2. 어댑터별 품질

> 본 절의 *근거* 는 W4 dogfooding 문서의 1~3차 발견. 신규 측정 없음.

### 2.1 antigravity

- **장점**: `AGENTS.md` 만 root 에 있으면 자발적으로 따름. frontmatter 가 *프로젝트 첫 시도부터* 정합 (created_at tz / files_touched.op enum / agent.id 모두 정상).
- **단점**: 작업 중 brief 재진입 시 *새 session_id 가 양산* 됨 (W4 발견 2, 9). resume grace 도입 + watcher_stop 의 session shutdown 분리로 1차 해결.
- **검증**: storygame `20260526` 의 `2318/2327/2335` 3건 — 모두 정상.

### 2.2 Claude Code

- **장점**: `.claude/CLAUDE.md` 의 `@AGENTS.md` 1줄 위임 패턴이 의외로 잘 동작. dogfood 1차에서 black-corp-tycoon 의 CLAUDE.md 가 실제로 1줄짜리였음에도 정상 entry 생성.
- **단점**: capability JSON 의 `opener:allow-open-path` 가 *identifier 만* 으로는 동작 안 함 → 객체 형식 + glob `**` 필요 (W4 발견 7).
- **검증**: 직접 실측 부족. 1.0 출시 전 1주 dogfood 가 *필요한 영역*.

### 2.3 Cursor

- **실측 없음**. W5 의 코드 흔적 (`adapter detection`, `templates/cursor.mdc.tpl`) 만 존재.
- **권장**: Phase A 직전에 본 ai-pm 프로젝트의 `.cursor/rules/` 를 활성화하고 1 PR 수준 작업으로 작성률 측정.

### 2.4 Gemini CLI

- **실측 없음**. dogfood 회차 모두 antigravity/claude 위주.
- **1.0 안에서 검증할 가치**: 낮음 — 다른 두 어댑터로 *작성률 검증* 충분.

→ **dogfood 데이터가 풍부한 어댑터: antigravity ✅, Claude Code ⚠️. Cursor/Gemini 는 미지수.**

---

## 3. 발견된 이슈 (priority 별)

### 3.1 Critical (Lite-W6 안에서 *반드시* 해소)

| ID | 이슈 | 출처 | Lite-W6 처분 |
|---|---|---|---|
| **C-1** | LayerComparison 모달의 *거짓 누락* — atomic-write tmp 파일 + adapter peer 파일이 환각으로 표시됨 | W4 발견 14 | [`../00-master-plan.md`](../00-master-plan.md) **D4 — Session UI 완전 제거** 로 *구조적* 해소. UI 가 사라지면 false positive 도 사라짐. |
| **C-2** | 세션 중복 생성 (외부 LLM 재진입 / start↔프로젝트 토글) | W4 발견 2, 9 | D4 가 UI 제거. 백엔드 resume 메커니즘은 *유지*. UI 표시 0 → 사용자 혼란 0. |
| **C-3** | opener.open_path 권한 누락 — 1차 fix 가 무효 (객체 형식 필요) | W4 발견 3, 7 | 이미 ✅ — `src-tauri/capabilities/default.json` 에 객체 형식 + glob `**` 적용. Lite 에선 *opener 사용 사이트* 가 ↓ (Session UI 진입점 제거), 재발 위험 작음. 단, **journal 파일 열기는 `oculpmApi.openEntryInEditor` 사용** — plugin-opener 직접 호출 금지 (MEMORY.md `opener-scope-recurring`). |
| **C-4** | init 시 reindex 누락 → 외부 LLM 이 미리 작성한 파일이 UI 에 안 보임 | W4 발견 12 | 이미 ✅ — `OculpmManager::reindex_journal_cache_incremental` 가 oculpm_init 에 hook. *유지*. |

### 3.2 High (Lite-W6 안에서 가능하면 해소)

| ID | 이슈 | 출처 | Lite-W6 처분 |
|---|---|---|---|
| **H-1** | "어댑터 규칙 다시 보내기" 라벨이 LLM 재주입 의도로 오인됨 | W4 발견 5 | 이미 ✅ — `AGENTS.md 재동기화` + 별도 `프롬프트 복사` 버튼 분리. D4 로 *DiffVsNarrative* 가 제거되면 두 버튼이 *Settings → ocul-pm 탭* 으로 이동. PR3 의 일부. |
| **H-2** | DiffVsNarrative 헤더 좁은 폭에서 글자별 세로 줄바꿈 | W4 발견 6 | 이미 ✅ — flex-wrap + min-w-0 적용. D4 로 컴포넌트 자체가 사라지므로 *추가 작업 없음*. |
| **H-3** | OculpmJournalAdded 이벤트 emit 0회 (dead-end) | W4 발견 11 | 이미 ✅ — apply_path_change 의 outcome → emit 분기. PR3 후에도 *유지* (TimelineView 가 이 이벤트 listen). |
| **H-4** | start ↔ 프로젝트 토글 세션 양산 | W4 발견 9 | 이미 ✅ — watcher_stop 의 session shutdown 분리. *유지*. |
| **H-5** | 어댑터 파일 위치: `.oculpm/agents/_template.md` 만으로는 외부 LLM 이 못 읽음 → root `AGENTS.md` 필요 | W4 발견 1 | 이미 ✅ — `agents-md` 어댑터 등록 + default `agents.active = ["agents-md"]`. **MEMORY.md 의 `dogfooding-w4-findings-2026-05-25` 와 정합**. *유지*. |
| **H-6** | 과거 날짜로 이동 시 옛 DailyBrief UI 회귀 | W4 발견 13 | 이미 ✅ — `targetWorkday` useMemo + dayOffset gate 제거. *유지*. Lite-W6 의 IA 안 A 에서 Overview 가 *Today 카드로 흡수* 되더라도 dayOffset 동작은 보존. |

### 3.3 Medium (Lite-W6 이후 backlog)

| ID | 이슈 | Lite-W6 처분 |
|---|---|---|
| M-1 | 터미널 버벅거림 (사용자 발언) | [`../03-feature-revisions.md`](../03-feature-revisions.md) §3.2 의 "버벅거림 원인 점검" 항목에서 1주 안 1차 수정. |
| M-2 | Cursor / Gemini 어댑터 실측 부족 | 1.0 출시 전 dogfood 1주 안에 1회 시도. |
| M-3 | Dependency Graph 의 실제 사용 빈도 미측정 | Lite-W6 의 *D6.6 결정* 으로 Today 의 Overview drawer 흡수 — 사용 데이터는 1.1 에서 누적. |
| M-4 | Cursor `.mdc` 포맷 변경 시 어댑터 깨질 위험 | 1.1 backlog. |
| M-5 | 마이그레이션 100 entries 미만 데이터의 dogfood 부재 | 외부 사용자 베타 시 발견 가능. 1.1. |

### 3.4 Low (v1.1+ backlog)

| ID | 이슈 |
|---|---|
| L-1 | journal_added 토스트의 클릭 비율 미측정 |
| L-2 | Greenfield 위저드 완료율 미측정 |
| L-3 | i18n 영문 추가 |
| L-4 | linux deb/AppImage 빌드 |

---

## 4. Frontmatter 오류 유형

> dogfood 1~3차 회차에서 발생한 *실제* frontmatter parse 에러는 *없음* (모든 자동 entries 가 정합). 그 이유:

1. **antigravity 가 `AGENTS.md` 의 schema 를 정확히 따름** — entry 생성 시점에 created_at tz, files_touched.op enum, agent.id 모두 정상.
2. **수동 작성 entries 는 `ManualEntryModal` 이 직접 schema 를 채움** — 사용자가 free-form 으로 잘못 입력할 여지 없음.
3. **frontmatter parser 가 fail-soft** — 일부 필드 누락 시 `Default::default()` 로 채우고 invalidEntries 카운터만 증가.

→ **현재 시점의 frontmatter 오류율 ≈ 0%.** 1.0 출시 후 *외부 사용자* 가 다양한 어댑터로 작성하면 케이스 폭증 예상. 1.1 의 회고에서 실측 누적.

---

## 5. UI 가 보여주지 못한 케이스

### 5.1 *Watcher 가 본* 변경이 *UI* 에서 안 보임

dogfood 3차 (storygame 2026-05-27) 의 핵심 증상:

- `.oculpm/index/<workday>.ndjson` 에 라인 N 개 있음 (워처 정상).
- `.oculpm/journal/<workday>/*.md` 에 entries M 개 있음 (antigravity 정상).
- 그러나 Today 의 TimelineView 에는 **0건** 표시.

원인 (W4 발견 12): `oculpm_init` 의 reindex 누락 → SQLite 캐시 비어 있음 → `list_journal_entries` 가 0 반환.

→ **워처 ndjson 과 SQLite 캐시 간의 *디스크-only* 영역이 존재** 했음. 캐시는 *opt-in* invariant 가 아니라 *영구* invariant 여야 함. 이미 ✅ 처리됐지만, **Lite-W6 의 PR0 회귀 테스트에 다시 한번 명시적 시나리오로 잠금**.

### 5.2 LayerComparison 의 *반대 false positive*: 사용자가 의도하지 않은 파일 노출

dogfood 3차 (W4 발견 14):
- 사용자가 `.claude/settings.json`, `*.tmp.<RAND>` 같은 *내부 / atomic-write* 파일을 *코드 변경* 으로 인식하지 않는데, watcher 는 ndjson 에 기록.
- LayerComparison 이 "journal 에서 누락 15건" 으로 표시 → 사용자 입장에선 *환각* 또는 *잡음*.

이게 D4 (Session UI 제거) 의 *결정적* 증거. UI 자체가 잘못된 메시지를 만들 위험. Lite 에선 *워처는 정확히 본 것을 기록* (보존) + *UI 가 그 정확성을 사용자에게 강제 표시 안 함* (제거) 의 분리.

### 5.3 *외부 LLM 호출 결과* 가 어떤 파일을 *왜* 바꿨는지 추적 불가

- journal entry 에 `files_touched: [{path, op}]` 는 있지만, *각 파일의 어디가 바뀌었는지* 본문에 없음.
- 사용자가 "AI 가 진짜 내가 시킨 대로 했나" 확인하려면 외부 git diff / VS Code 의 git lens 등 *별도 도구* 필요.

→ **D5 (로컬 diff 뷰어)** 의 도입 사유. Lite 가 *이 갭* 을 메우는 첫 시도.

---

## 6. 의도대로 잘 동작한 부분

균형을 위해 잘 된 영역도 기록.

| 영역 | 잘 된 점 |
|---|---|
| **워처** | ndjson append-only / `.oculpm/index/.lock` 정합 / debounce — 1만 파일 데모 레포에서도 안정. |
| **frontmatter parser** | 1.1 까지 schema_version=1 잠금 가능할 만큼 견고. fail-soft 분기 OK. |
| **AGENTS.md 패턴** | "root AGENTS.md + 어댑터 stub 위임" 의 단순함. 외부 LLM 이 *자발적으로* 따르는 거의 유일한 경로. |
| **resume 메커니즘** | 30→60min inactivity + 15min grace 의 조합이 *외부 LLM 응답 대기* 갭을 흡수. 토글 양산은 watcher_stop 분리로 별도 해소. |
| **MigrationModal** | W5 의 5단계 흐름 — 백업 + 드라이런 + 명시 확인. 1.0 까지 정책 변경 불요. |
| **워크스페이스 영속화** | 단일 키 `aipm:workspace:v1` + 자동 마이그레이션. 사용자 데이터 손실 0. |
| **incremental reindex** | mtime 매치 비율 높음. 대규모 journal 트리도 거의 무비용. |
| **`[FLOW]` 로깅** | 7 step 의 happy path 가 `oculpm.log.YYYY-MM-DD` 에 남음. 사용자 트러블슈팅 첨부 가능. |

→ **Lite-W6 는 이 영역들을 *건드리지 않는다*.** [`../00-master-plan.md`](../00-master-plan.md) §부록 A 의 *건드리지 않는 영역* 목록과 정합.

---

## 7. *구조적 결정* 으로 옮긴 항목

W4 dogfood 14건 중 *5 건* 이 hotfix 가 아니라 *축소* 로 해소됐다:

| 발견 | hotfix 시도 | 그러나 *재발* 원인 | Lite-W6 의 *구조* 해소 |
|---|---|---|---|
| LayerComparison false positive (atomic-write tmp, adapter peer 파일) | suppress 패턴 확장 | 새 라이브러리 추가 시 또 등장 (`<dest>.tmp.<rand>` 가 무한 변종) | **D4** — UI 자체 제거. 백엔드는 그대로 *잡되* 표시 안 함. |
| 세션 양산 (재진입 / 토글) | resume grace + watcher_stop 분리 | LLM 시간 갭 패턴이 다양 → grace 가 *정답이 아닌 추정* | **D4** — UI 가 session 단위로 묶지 않음. *시간 윈도우* (=마지막 reindex 이후) 로 대체. |
| AGENTS.md vs `.oculpm/agents/_template.md` | `agents-md` 어댑터 추가 | 외부 LLM 의 자발적 참조 영역 변화 가능 | **D5** — 외부 LLM 실패 시에도 *로컬 diff 뷰어* 가 대체 검증 경로. |
| init 시 reindex 누락 | incremental reindex 도입 | 다른 lifecycle 경로 (워처 재시작 / config reload) 에서도 재발 가능 | 회귀 보호 PR0 에 *명시 시나리오* — 워처 ndjson 과 캐시의 정합을 *상시 검증*. |
| SQLite Changelog vs `.oculpm/journal/` 병존 | MigrationModal 도입 | 두 시스템이 동시에 살아 있으면 *어느 게 진실인지* 인지 부담 | **D1** — SQLite Changelog 완전 제거. journal 단일 출처. |

→ **5건의 패턴**: hotfix → 재발 → 축소. Lite-W6 는 *재발 가능성* 의 영역 자체를 제거.

---

## 8. Lite-W6 의 *진행 동의 사유 (정량)*

본 회고의 데이터로 [`../01-w6-reassessment.md`](../01-w6-reassessment.md) §4 의 *Lite 진행 안 함* 시나리오 3개를 재확인:

- (a) **출시일 외부 약속**: 없음 → Lite 진행 OK.
- (b) **외부 LLM 어댑터가 *충분히* 잘 동작**: antigravity 는 ≥ 80% 추정, Claude Code 는 미지수, Cursor/Gemini 는 0% 측정. → *충분히 잘 동작* 의 기준 미달. Lite 의 D5 (로컬 diff) 가 대체 경로로서 *필요*.
- (c) **SQLite Changelog 의 잔존 사용자 데이터가 큼**: 본 프로젝트의 `changelog_entries` 행 수는 dogfood 산물 < 100건. 마이그레이션 모달로 즉시 이주 가능. → 잔존 데이터 부담 없음.

→ **3개 기준 모두 Lite 진행을 지지.**

---

## 9. Lite-W6 에서 *해결하지 않을* 항목 (v1.1 backlog)

- 외부 도구 자동 라벨링 (clipboard / 단축키 hook) — [`../00-master-plan.md`](../00-master-plan.md) D5 의 의지로 *명시 거절*.
- 자동 업데이트 인프라.
- LSP-기반 Problems 패널 (D3 로 1.0 에선 *완전 삭제*).
- 멀티 사용자 / 팀 공유.
- Cursor `.mdc` 포맷 변경 추적.
- 다중 파일 동시 diff (1.0 은 1 파일씩).
- 변경 하이라이트 24h fade.

이 backlog 는 1.1 의 회고 시점에 *우선순위 재평가*.

---

## 10. 마스터 템플릿 강화 후보

dogfood 회차에서 *수집됐지만 즉시 반영 안 한* 마스터 템플릿 (`AGENTS.md`) 수정 후보:

1. **"단일 파일 수정도 기록 대상"** 명시 — 외부 LLM 이 trivial 변경을 *skip* 하는 패턴 방지.
2. **trigger 의 "⌘+Shift+J 단축키 권장"** 추가 — 사용자가 수동 entry 도 빠르게 만들 수 있게.
3. **"여러 파일 묶음 작업 시 entry 1건 + files_touched 다수"** 예시 추가 — 환각/누락 비율 ↓.
4. **frontmatter 필드 명세** 의 영문 / 한글 병기 — gemini-cli 의 영문 응답 비율이 높을 때 한글 frontmatter 작성 실패 방지.
5. **`session_id` 형식 제약** 명시 — `<workday>-NNN` 패턴 + synthetic 은 `<workday>-mNN` (MEMORY.md `oculpm-session-id-format`).

→ Lite-W6 진행 *전* 에 본 5개 항목으로 `AGENTS.md` 1 PR 머지 권장 (PR0 의 일부로 흡수 가능).

---

## 11. 다음 액션

1. ☐ 본 회고의 §1~§10 검토 + 동의.
2. ☐ §10 의 마스터 템플릿 강화 5개 — PR0 의 *일부* 로 흡수 또는 별도 PR.
3. ☐ Lite-W6 [`../02-removal-plan.md`](../02-removal-plan.md) PR0 진입.
4. ☐ [`master-prompt.md`](./master-prompt.md) 를 *세션 단절 시 다음 AI* 에게 전달.

---

## 부록 A. 본 회고의 원본 출처 인덱스

- `docs/major_update/oculpm/phases/_dogfooding-w4.md` — 14 발견의 코드 변경 추적 (현재까지의 가장 두꺼운 1차 자료).
- `.oculpm/journal/` — 본 프로젝트 0 entries (의도된 결과).
- `.oculpm/index/<workday>/file_changes.ndjson` — 2 워크데이 (20260521 빈 파일 + 20260528 1줄).
- `.oculpm/config.toml` — `agents.active = []`, `inactivity_timeout_minutes = 30` (1차 dogfood 후 60 으로 상향 권장된 값은 *기본값* 변경, 본 프로젝트 config 는 그대로).
- `MEMORY.md` 의 5 메모리:
  - `dogfooding-w4-findings-2026-05-25.md`
  - `dogfooding-w4-findings-2026-05-26.md`
  - `dogfooding-w4-findings-2026-05-27.md`
  - `opener-scope-recurring.md`
  - `oculpm-session-id-format.md`

본 회고의 *모든* 수치/사례는 위 출처로 *역추적 가능*.

---

## 부록 B. 본 회고의 *서명*

- 작성자: Claude (Opus 4.7)
- 검증: 사용자 1차 검토 대기.
- 갱신 정책: Lite-W6 진행 중 새 발견 발생 시 §3 의 우선순위 표에 추가하고, §11 의 다음 액션도 갱신.
- 보존: Lite-W6 종료 후 *변경 금지* — history 로 잠금.
