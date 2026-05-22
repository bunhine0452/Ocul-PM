# 출시 / 마이그레이션 / 리스크 계획

> 참조: [`00-spec.md`](./00-spec.md), [`01-backend.md`](./01-backend.md), [`02-frontend.md`](./02-frontend.md)

---

## 1. 페이즈 분해 (W1 ~ W6)

> 한 페이즈 ≈ 1주. 1인 개인 개발자 가정.
> 각 페이즈는 **그 자체로 동작하는 상태**로 끝나야 한다 (병합 가능한 단위).

### W1 — 기반 (Foundation)

**목표**: `.oculpm/` 디렉토리가 생기고, lock/config/atomic IO 가 동작하고, 기존 앱은 깨지지 않는다.

| ID | 작업 | 산출물 | 인수 조건 |
|---|---|---|---|
| W1-1 | Cargo 의존성 추가, `oculpm/` 빈 스켈레톤 (B-1, B-2) | `cargo check` 통과 | CI green |
| W1-2 | `spec.rs` + specta 노출 | `src/types/oculpm.ts` 자동 생성 확인 | 빌드 시 ts 파일 갱신 |
| W1-3 | `paths.rs` workday 계산 + 단위 테스트 (B-3) | KST 03:00 boundary 통과 | `cargo test paths` |
| W1-4 | `config.rs` 기본값 + 검증 (B-4) | `OculpmConfig::default()` | 단위 테스트 |
| W1-5 | `atomic_io.rs` + `lock.rs` + 단위 테스트 (B-5, B-6) | tmp 안 남김, stale lock 회수 | 단위 테스트 + race 시뮬레이션 |
| W1-6 | `commands/oculpm.rs` 의 init/get_status/get_config/set_config (B-16 일부) | 4 커맨드 동작 | 수동: tauri dev 에서 invoke 성공 |
| W1-7 | `OculpmManager` + `on_project_opened` 부트스트랩 (B-17 일부, 워처는 아직) | 프로젝트 열면 `.oculpm/` 생김 (확인 다이얼로그는 W3) | 새 프로젝트에서 폴더 확인 |
| W1-8 | `.gitignore` 관리 블록 자동 작성 | `index/` ignored, `journal/` 추적됨 | `git status` 검증 |

**W1 완료 시 그림**: 사용자가 프로젝트를 열면 `.oculpm/` 가 자동 생성되지만 UI 변경은 아직 없음. 백엔드 토대만 깔린 상태.

---

### W2 — 워처 + 세션 (Detection)

**목표**: 파일 변경이 `index/` 에 ndjson 으로 떨어지고, 세션이 자동으로 시작/종료된다.

| ID | 작업 | 인수 조건 |
|---|---|---|
| W2-1 | `index.rs` write/read (projects.json, sessions.json, snapshots, ndjson) (B-8) | 파일 1개 수동 변경 → ndjson 라인 추가 |
| W2-2 | `session.rs` 상태 머신 + 타이머 (B-9) | inactivity 30분 후 세션 자동 종료 (테스트는 timeout 5초로 단축) |
| W2-3 | `watcher.rs` notify 통합 + ignore (B-10) | `node_modules/` 변경 무시, `.oculpm/index/` 자기 자신 무시 |
| W2-4 | `crash_recovery_grace_minutes` 기반 좀비 세션 회수 | 강제 종료 후 재시작 → 직전 세션 `crash_recovered` 로 마감 |
| W2-5 | Tauri 이벤트 푸시 (`oculpm:file_changed`, `:session_started`, `:session_ended`) | tauri dev 콘솔에서 이벤트 관찰 |

**W2 완료 시**: `index/<today>/file_changes.ndjson` 과 `sessions.json` 이 실시간으로 쌓인다. UI 는 아직 미반영.

---

### W3 — Journal 인덱싱 + Today UI 골격 (Visibility)

**목표**: LLM 없이도 사용자가 수동으로 markdown 을 `.oculpm/journal/` 에 떨궈 넣으면 Today 탭에서 보인다.

| ID | 작업 | 인수 조건 |
|---|---|---|
| W3-1 | `frontmatter.rs` + `markdown.rs` (B-7) | 깨진 frontmatter 도 fail-soft |
| W3-2 | `cache.rs` SQLite 캐시 테이블 + 증분 재인덱싱 (B-11) | journal 폴더에 .md 떨구면 1초 안에 cache 반영 |
| W3-3 | 커맨드: list_journal_entries, get_journal_entry, get_file_changes, list_sessions | 모두 specta 자동 export |
| W3-4 | F-1 ~ F-4 (specta, api wrapper, WorkspaceContext, App 라우팅) | 디폴트 탭 today 적용 |
| W3-5 | F-5 (EmptyToday 3 변형, OnboardingModal) | `.oculpm/` 없는 프로젝트에서 카드 표시 |
| W3-6 | F-6 (TimelineView, SessionCard, JournalEntryCard) — minimal | journal/.md 수동 작성 → Today 에 카드로 보임 |
| W3-7 | F-7 (JournalEntryDetail, 마크다운 렌더) | 카드 클릭 → 디테일 표시 |
| W3-8 | F-8 (CategoryFilterBar) | 필터/검색 동작 |

**W3 완료 시**: 사용자가 손으로 `.oculpm/journal/20260522/Bugs/2055_bug_x.md` 를 만들면 즉시 Today 에 뜬다. **이 시점부터 dogfooding 가능** (사용자가 직접 만들고 향후 LLM 도 동일 포맷).

---

### W4 — 어댑터 동기화 + 이중 레이어 검증 (Closing the Loop)

**목표**: 4개 에이전트의 규칙 파일이 자동 동기화되고, journal 이 index 와 일치하는지 시각화된다.

| ID | 작업 | 인수 조건 |
|---|---|---|
| W4-1 | `agents.rs` 4개 어댑터 렌더러 + sync (B-12) | 토글 on/off 시 어댑터 파일 즉시 갱신/제거 |
| W4-2 | `agents.rs` 감지 + drift 모니터링 | 어댑터 외부 수정 시 drift 이벤트 |
| W4-3 | `redact.rs` + `integrity.rs` (B-13, B-14) | 가짜 API 키 패턴 자동 redact 확인 |
| W4-4 | 커맨드: detect_agents, set_active_agents, sync_agent_rules, compare_layers | 4개 커맨드 동작 |
| W4-5 | F-9 (DiffVsNarrative + LayerComparison) | mismatch 발생 시 ⚠ 배지 |
| W4-6 | F-11 (OculpmSettings 폼) | tz, ignore, agents 변경 가능 |
| W4-7 | F-13 (이벤트 listener + 토스트) | 새 entry 토스트 |
| W4-8 | F-14 (CommandPalette 새 명령) | 단축키 동작 |

**W4 완료 시**: 외부 LLM (Cursor 등) 에서 작업하면 어댑터에 의해 자동으로 `.oculpm/journal/` 가 채워지고, 사용자는 Today 에서 narrative 와 ground truth 의 차이를 본다.

---

### W5 — 마이그레이션 + Overview 재포지셔닝 (Continuity)

**목표**: 기존 SQLite changelog 사용자가 부드럽게 넘어오고, Overview 가 새로운 역할로 자리 잡는다.

| ID | 작업 | 인수 조건 |
|---|---|---|
| W5-1 | `migrate_from_sqlite.rs` dry-run + 실제 (B-15) | 42 entry 변환 후 journal 카운트 일치 |
| W5-2 | 백업 + 롤백 메커니즘 | 백업 폴더에서 1-클릭 복원 |
| W5-3 | 커맨드: migration_dry_run, migrate_from_sqlite, reindex_cache | UI 와 통합 |
| W5-4 | F-12 (MigrationModal + 진행률) | 사용자 컨펌 → 진행률 → 결과 |
| W5-5 | F-10 (OverviewScreen 재포지셔닝) | 4 위젯 + 클릭 시 Today 이동 |
| W5-6 | "구 changelog 데이터 삭제" 버튼 (마이그레이션 검증 후 활성화) | 명시 컨펌 |

**W5 완료 시**: 기존 사용자가 마이그레이션 후 Overview 에서 90일 활동, 미완료 체크박스, 에이전트 비중을 본다.

---

### W6 — 안정화 + Dogfooding 회고 (Stabilization)

**목표**: 실제로 한 주 사용해보고 발견된 이슈 정리.

| ID | 작업 | 인수 조건 |
|---|---|---|
| W6-1 | 통합 테스트 스위트 (B-18) | tempdir 시나리오 5종 통과 |
| W6-2 | 로깅/관측 정리 (B-19) | `oculpm.log` rotation |
| W6-3 | F-15, F-16 빈/로딩/에러 상태 마무리 + 다크모드 점검 | 모든 path 에 fallback UI |
| W6-4 | 성능 점검: 큰 프로젝트 (1만 파일) 워처 부하 | 평균 CPU < 2%, 메모리 < 50 MB |
| W6-5 | dogfooding 회고: 본 프로젝트(`ai-pm`) 자체를 W1 부터 `.oculpm/journal/` 로 추적해온 기록 정리 | `docs/` 로 회고 1편 |
| W6-6 | 1.0 릴리스 노트 + 사용자용 README | `docs/release-notes-1.0-oculpm.md` |

---

## 2. 의존 그래프

```
W1 (foundation)
  │
  └─► W2 (watcher + session)
        │
        └─► W3 (journal indexing + Today UI)
              │
              ├─► W4 (agent sync + dual-layer)
              │     │
              │     └─► W5 (migration + Overview)
              │           │
              │           └─► W6 (stabilize)
              │
              └─► (F-10 OverviewScreen 은 W3/W4 의 데이터가 다 있어야 의미 있어서 W5 로 둠)
```

병렬화 가능 (1인 개발이라 권장 X, 만약 인력 추가 시):
- W2 와 F-1~F-4 (W3 의 일부) 는 데이터 의존이 없어 평행 가능.
- W4 안에서 어댑터 sync (B-12) 와 DiffVsNarrative (F-9) 는 독립.

---

## 3. SQLite → `.oculpm/` 마이그레이션 — 사용자 흐름

```
[프로젝트 열기]
      │
      ▼
[.oculpm/ 존재?] ──── No ────► [Onboarding Modal] ── 동의 ──► oculpm_init
      │                              │ 거절
      │                              ▼
      │                       [세션 토픽바에 "ocul-pm 활성화" 링크만]
      Yes
      │
      ▼
[기존 SQLite changelog N>0?] ── No ──► [정상 Today 화면]
      │
      Yes
      │
      ▼
[MigrationModal: dry-run 결과 표시]
   │
   ├── [건너뛰기]      → 다음 진입 때 다시 묻지 않음 (영구). 사용자는 Overview 의 "구 데이터" 탭에서 read-only 로 봄.
   ├── [백업만 만들기] → `.oculpm.backup-pre-migration-<ts>/` 생성. SQLite 그대로 유지.
   └── [지금 마이그레이션]
          │
          ▼
       [백업 생성 → migrate 실행 → progress bar]
          │
          ▼
       [결과 화면: 성공 N, 스킵 M, 실패 0]
          │
          ▼
       [정상 Today 화면 + 토스트 "마이그레이션 완료"]
```

**롤백 (실패 시 자동)**:
1. 마이그레이션 중 어느 단계에서든 패닉/에러 발생 → catch.
2. `.oculpm/journal/` 의 마이그레이션 시점 이후 생성 파일 모두 삭제.
3. SQLite 는 건드리지 않았으므로 원상복귀.
4. 사용자에게 에러 다이얼로그 + 백업 폴더 위치 안내.

**롤백 (성공 후 사용자 요청)**:
1. Settings → "마이그레이션 되돌리기" 버튼 (백업이 7일 이내에 살아있을 때만 노출).
2. 컨펌 → `.oculpm/journal/` 의 manual entry 들 중 백업 시점 이후 mtime 인 것 삭제.
3. 백업 복원은 별도로 하지 않음 (마이그레이션은 SQLite 를 안 건드리니).

---

## 4. 리스크 레지스터

| ID | 리스크 | 영향 | 가능성 | 완화 |
|---|---|---|---|---|
| **R-1** | 외부 LLM 이 어댑터 규칙을 무시 → `journal/` 비어있음 | Today 가 빈 카드만 나오는 안 좋은 UX | 중상 | `EmptyToday` 변형 3 (file_changes 있는데 journal 없는 상태) 에서 어댑터 상태 + DiffVsNarrative 버튼 노출. 사용자가 즉시 인지. 추가로 "manual entry 작성" 단축키로 우회 가능. |
| **R-2** | LLM 이 frontmatter 포맷 틀림 | 파서 깨짐 | 중 | fail-soft 인덱싱. frontmatter 없어도 본문은 표시. 노란 배지로 경고. |
| **R-3** | 워처가 대형 프로젝트에서 CPU/메모리 폭증 | 앱 사용감 저하 | 중 | debounce 500ms + batch_max_events + 큰 파일 hash skip. W6-4 에서 성능 점검. 워처 일시중지 토글 노출. |
| **R-4** | 다중 윈도우/인스턴스 race | `.oculpm/` 파일 손상 | 낮 | lock + atomic rename. read-only 모드 fallback. |
| **R-5** | 워크데이 타임존 계산 버그 (KST/UTC 혼동) | 엔트리가 잘못된 날짜에 들어감 | 중 | `paths.rs` 단위 테스트로 boundary 케이스 픽스. 과거 `daily_brief` 버그 (`docs/2026521/Bugs/2055_bugs.md`) 의 교훈을 spec 에 명시. |
| **R-6** | 사용자가 `journal/` 을 commit 했는데 secret 누설 | 보안 | 중 | `auto_redact_patterns` + `forbid_journal_for_paths` 디폴트. Settings 에서 강조. 마이그레이션 시 사전 스캔. |
| **R-7** | 어댑터를 사용자가 수동으로 편집했는데 앱이 덮어씀 | 사용자 작업 손실 | 중 | 관리 블록 외부는 절대 안 건드림. 한쪽 마커만 있으면 거부. drift 이벤트로 사용자에게 알림. |
| **R-8** | 마이그레이션 실패로 데이터 손실 | 치명적 | 낮 | dry-run 강제 + 백업 강제 + SQLite 보존. 롤백 경로 확보. |
| **R-9** | 크래시 후 `index/` 손상 | 데이터 일부 손실 | 낮 | append-only ndjson 의 마지막 줄만 손상 가능 → cut + `.corrupted-tail` 백업. snapshot 으로 일부 복구. |
| **R-10** | LLM 이 `.oculpm/index/` 에 쓰려고 시도 | 무한 루프, 손상 | 중 | 워처가 `.oculpm/index/` 자기 자신 무시. 어댑터 규칙 본문에 "index/ 절대 금지" 명시. CI 에서 발견 시 자동 quarantine. |
| **R-11** | schema 변경으로 구 데이터 못 읽음 | 사용자 이탈 | 낮 | `schema_version` + forward-only migration + 백업. |
| **R-12** | Tauri/notify 가 일부 macOS 버전에서 fsevents 이슈 | 워처 누락 | 낮 | fallback 폴링 모드. 통합 테스트에 시뮬레이션. |
| **R-13** | Greenfield 위저드 직후 OculpmOnboardingModal 가 다시 떠서 사용자가 onboarding 을 두 번 보는 UX 마찰 | 중 | 중 | **W3-PR10** 에서 위저드 Step 4 에 "ocul-pm 추적" 체크박스 (디폴트 ON) + 백엔드가 위저드 흐름에서 `OculpmManager::init_project` 까지 호출. 모달은 `.oculpm/` 존재 감지 시 self-dismiss. ([refactor-integration §3.1](./refactor-integration.md), [phases/W3-journal-today-ui.md W3-PR10](./phases/W3-journal-today-ui.md)) |
| **R-14** | `manager.init_project` 가 Greenfield 흐름 중간에 실패 → 프로젝트는 만들어졌지만 `.oculpm/` 부재 | 낮 | 낮 | non-fatal 처리. `tracing::warn`. 사용자는 EmptyToday V1 의 "활성화" 카드로 재시도 가능. |

---

## 5. 페이즈별 인수 조건 (E2E 체크리스트)

### W1
- [ ] 새 프로젝트 열기 → `.oculpm/{config.toml, .lock, .schema-version}` 생성됨
- [ ] `.gitignore` 에 관리 블록 추가됨, 두 번 실행해도 중복 X
- [ ] `cargo test` 전체 통과
- [ ] 기존 changelog UI 가 깨지지 않음 (회귀 X)

### W2
- [ ] 임의 파일 1개 수정 → 1초 안에 `index/<today>/file_changes.ndjson` 에 줄 추가됨
- [ ] `node_modules/` 안 변경은 무시
- [ ] 30분 비활성 (테스트는 5초) 후 세션 자동 종료, `sessions.json` 에 `ended_reason: inactivity_timeout`
- [ ] 앱 강제종료 후 재시작 → 직전 세션이 `crash_recovered` 로 마감되어 있음
- [ ] 워크데이 boundary 넘어가면 새 폴더 자동 생성 + 직전 세션 boundary 로 종료

### W3
- [ ] `.oculpm/journal/<today>/Bugs/0900_bug_x.md` 를 손으로 만들면 Today 에 카드로 나타남 (1초 이내)
- [ ] 카드 클릭 → 디테일 패널 + 마크다운 렌더
- [ ] 카테고리 필터 동작
- [ ] frontmatter 일부러 깨뜨려도 앱이 안 죽고 노란 배지로 표시
- [ ] EmptyToday 3 변형 모두 정상 노출

### W4
- [ ] Settings 에서 Cursor 활성화 → `.cursor/rules/ocul-pm.mdc` 생성
- [ ] 비활성화 → 파일 삭제 (관리 블록 모드의 다른 어댑터는 블록만 제거)
- [ ] `_template.md` 수정 → 모든 활성 어댑터 자동 갱신
- [ ] 사용자가 `.claude/CLAUDE.md` 의 관리 블록 밖을 편집 → 보존됨
- [ ] DiffVsNarrative 에서 only_in_index 와 only_in_journal 이 정확히 나옴
- [ ] auto_redact 가짜 API 키 패턴 동작

### W5
- [ ] dry-run 이 실제 마이그레이션 전에 사용자에게 카운트/충돌 노출
- [ ] 마이그레이션 후 entry 카운트 = SQLite 카운트
- [ ] 백업 폴더 존재
- [ ] Overview 4 위젯 표시 + 클릭 시 Today 이동
- [ ] "구 데이터 삭제" 는 명시 컨펌 후만 동작

### W6
- [ ] 1만 파일 프로젝트에서 평균 CPU < 2% (1분 측정)
- [ ] 통합 테스트 스위트 green
- [ ] 다크모드/접근성 lint 통과
- [ ] dogfooding 회고가 `docs/` 에 존재
- [ ] 1.0 릴리스 노트 존재

---

## 6. Dogfooding 전략

**원칙**: W3 종료 시점부터 본 프로젝트 (`ai-pm` 자체) 의 작업을 `.oculpm/journal/` 에 기록한다. 즉 이 구현 작업의 W4–W6 자체가 첫 사용자 시나리오.

- W3 끝까지는 수동 작성.
- W4 끝나면 Claude Code (또는 Cursor) 가 자동 작성. 잘 안 되면 R-1 의 완화책이 실제로 통하는지 검증.
- W6-5 회고에 다음을 기록:
  - 4개 어댑터 중 실제로 어떤 게 가장 잘 따랐는가?
  - frontmatter 포맷 이탈률은?
  - DiffVsNarrative 가 실제 유용했는가? (mismatch 가 의미 있게 잡혔는가)

---

## 7. 비목표 (이 라운드에서 안 하는 것)

명시적으로 제외 — 미래 회의 주제:

- 팀 협업 / 외부 노출 / SaaS 동기화 → Intent-2 에서 제외 합의.
- 비-`.oculpm` 형식 데이터의 import (Notion, Linear 등).
- LLM 자동 작성 품질 점수화 (R-1 의 양적 측정).
- Mobile / Web 버전.
- 다중 사용자 conflict resolution.
- 다국어 UI (현재 한국어 + 영어 본문이 frontmatter `language` 로만 구분).

---

## 8. 향후 (참고만, 결정 대상 아님)

W6 이후에 자연스럽게 따라올 수 있는 것들 (메모용):

- 세션 간 narrative 자동 요약 (LLM 이 그날 끝에 "오늘의 PR 설명" 초안 생성).
- `.oculpm/journal/` 을 입력으로 한 CHANGELOG.md 자동 생성.
- 미완료 체크박스를 GitHub Issue 로 동기화 (사용자 옵션).
- 워처가 수집한 commit 시점 데이터로 git commit message 추천.

---

## 9. 결정 / 합의 필요 (지금)

이 문서가 합의되면 W1 부터 즉시 착수. 그 전에 한 번만 확인하고 싶은 것:

1. **페이즈 길이**: W1~W6 = 6주가 길다면, W2 와 W3 를 합쳐 5주로 줄일 수 있음. 1인 개발 페이스를 모르므로 사용자 판단 필요.
2. **dogfooding 시작 시점**: W3 종료 직후 (수동), W4 종료 직후 (자동) 중 어느 쪽?
3. **`forbid_journal_for_paths` 디폴트**: 위 안에 `.env*, *secret*, *credential*` 두었음. 더 보수적으로 갈지 (예: `**/.git/**` 까지)?
4. **시각적 톤**: TodayScreen 의 entry 카드 디자인을 시안으로 만들어볼지 (와이어프레임 vs 실제 컴포넌트 스케치)?

답변 주시면 W1 첫 PR 단위로 작업 분해를 한 번 더 잘게 만들겠습니다.
