# 00. Ocul-PM Lite 1.0 — 마스터 플랜 (SSOT)

> 본 문서의 위상: 본 폴더의 모든 후속 문서가 참조하는 **단일 출처**.
> 변경 시 다른 문서의 표제 인용을 함께 업데이트한다.
> 작성일 2026-05-28.

---

## 0. Executive Summary (한 페이지)

`docs/refactor/MASTER-GUIDE.md` 가 W1~W6 에 걸쳐 ai-pm 을 "AI PM" 정체성으로 다시 태운다는 청사진이었다면, 본 문서는 **그 결과물에서 PM 정체성과 무관한 표면을 잘라내고 1.0 으로 묶는 라운드** 다.

W1~W5 는 (양 트랙 모두) ✅. 그러나 현재 ai-pm 은:

- **두 개의 변화 추적 시스템이 동시에 존재** — SQLite 의 `changelog_entries` + `.oculpm/journal/` 의 markdown. MigrationModal 이 후자로 이주를 권하지만 *기존 UI/커맨드/모달은 여전히 SQLite 시스템과도 연결*.
- **세션 추정 UI 가 여러 곳에 노출** — `DiffVsNarrative`, `SessionCard`, `EmptyTodayV3` 등이 "이 세션이 무슨 일을 했나" 를 보여주려 하지만 외부 LLM 의 실제 세션 경계와 어긋남.
- **IDE 흉내** — 9-탭 → 5-IA 로 줄였지만 그 안에 다시 6개의 Code sub-tab (Files / AI / Graph / Terminal / Git / 비활성 Problems) 이 누적되어 있고, 자체 CodeEditor 가 여전히 핵심 진입점처럼 동작.
- **"Problems" 같은 미작동 placeholder** — BottomDrawer 에 탭만 있고 본문은 "후속 PR 입니다" 문구.

이 라운드의 명령은 단순하다: **이 모든 것을 1.0 의 의도에 맞춰 잘라낸다.**

---

## 1. 1.0 의 정체성 재확인

> "AI PM" 의 *Lite* 변형 — 외부 코딩 에이전트가 코드를 쓰는 동안, 사용자는 우리의 앱에서 **기록 / 관리 / 검증** 만 한다.

| 기둥 | 1.0 에서의 의미 |
|---|---|
| **기록 (Record)** | `.oculpm/journal/*.md` 가 진실. 우리 앱은 이걸 읽고 보여준다. SQLite Changelog 는 제거. |
| **관리 (Manage)** | Planner (goals/subtasks) + Today 의 일일 브리프. 변하지 않음. |
| **검증 (Verify)** | 변경된 파일에 한해 *로컬 diff* 를 제공. 세션 단위 비교는 포기, **파일 단위 + 시간 윈도우 단위** 로 좁힘. |

이 세 기둥에 속하지 *않는* 모든 표면은 — 잘라낸다.

비-기둥 표면 식별 결과 (현재 코드 기준):

- ❌ **세션 추적 UI** (`SessionCard`, `DiffVsNarrative`, `EmptyTodayV3` 의 비교 진입점)
- ❌ **SQLite Changelog** (`ChangelogScreen`, `EntryDetail`, `DiffModal`, `commands/changelog.rs`)
- ❌ **CodeEditor** (`components/CodeEditor.tsx`)
- ❌ **Problems** 탭 (`BottomDrawer` 의 placeholder)
- ⚠️ **Git Panel** (commits/tags/releases 뷰는 사용 빈도 낮음 → 메인 메뉴에서 제거)
- ⚠️ **Dependency Graph** (Code sub-tab "graph" — 일회성 사용. Overview drawer 로 강등 or 제거)

이렇게 잘라낸 자리에 **로컬 diff 뷰어** 와 **유연한 도크 레이아웃** 을 채운다.

---

## 2. 위험 전제 (Risk Premise)

> 사용자의 핵심 우려: *"필요없는 로직을 걷어내며 코드를 삭제할 때 로직이 깨지지 않도록 주의한다."*

이 라운드의 모든 작업이 이 원칙을 *위반할 수 있다*. 다음 invariant 들은 **PR 별 회귀 테스트로 잠근다**:

| Invariant | 보호 방법 |
|---|---|
| `.oculpm/index/` ndjson 작성은 Watcher → IndexWriter 경로로 *동작 변화 없이* 유지 | `oculpm_integration_w2.rs` 통합 테스트 보존 + Lite-W6-PR0 에 회귀 케이스 추가 |
| Journal markdown 의 frontmatter parser 는 변경하지 않음 | parser 단위 테스트 전 케이스 ✅ 확인이 PR 머지 조건 |
| Today 의 `TimelineView` 가 journal 만으로 정상 렌더 | E2E: 빈 SQLite + 시드된 `.oculpm/journal/` 만으로 진입 → entries 표시 |
| Planner 의 goal CRUD | `commands/planner.rs` 통합 테스트 ✅ |
| Project lifecycle (create/rename/delete/select) | 회귀 테스트 ✅ |
| Settings 의 LLM provider/model 저장 (Keyring + DB) | 회귀 테스트 ✅ |
| 워크스페이스 상태 영속화 (`aipm:workspace:v1`) | 단일 키 마이그레이션 함수 — 신규 키 추가가 아닌 *삭제* 만 발생 |

회귀 테스트 보강 PR (Lite-W6-PR0) 가 다른 모든 삭제 PR 의 *선행 조건*. 보호망부터 친 후 손을 댄다.

---

## 3. 9 가지 핵심 결정

| # | 결정 | 근거 | 영향 받는 파일 (대표) |
|---|---|---|---|
| D1 | **SQLite Changelog 시스템 완전 제거** | journal/ 가 진실. 두 시스템 병행은 사용자 인지 부담 + 마이그레이션 부담만 누적. | `src/features/changelog/*`, `src-tauri/src/commands/changelog.rs`, migration 007, `db.rs` 의 ChangelogEntry/File struct, `AiWorkbench` 의 saveToChangelog. |
| D2 | **CodeEditor 빌드 제외** (legacy 폴더로 이동) | 외부 에이전트가 편집 담당. 우리 에디터는 quick view 정도였고, 1.0 의 정체성과 맞지 않음. | `src/components/CodeEditor.tsx` → `src/legacy/CodeEditor.tsx`. CodeWorkbench 의 editor pane 을 read-only viewer 로 강등 (§3 D6 참조). |
| D3 | **Problems 탭 완전 삭제** | 동작하지 않는 placeholder. 1.0 에서 노출하면 신뢰 손상. | `BottomDrawer` TABS 배열, `WorkspaceContext.bottomDrawerTab` 의 union 축소. |
| D4 | **세션 추정 UI 제거**. backend session 종료 로직은 유지하되 *UI 에서 노출 안 함* | "어디까지가 1 세션" 은 외부 LLM 차이로 불가능에 가까움. UI 가 거짓을 보일 위험. backend invariant (index ndjson 작성 + workday boundary) 는 유지. | `SessionCard`, `DiffVsNarrative` (`compare` 액션), `EmptyTodayV3`, `TimelineView` 의 session grouping → flat journal entry 리스트로 단순화. CommandPalette 의 "compare latest" 액션 제거. |
| D5 | **로컬 reindex + diff 뷰어 신규**. 외부 LLM 결과 검증의 대체 경로. | "변경된 파일들 또는 생성된 파일들에 대한 reindex 만 실행할 수 있다면 로컬환경에서 바로 diff 도 판단 가능할 수 있지 않을까?" — 사용자 발언. | 신규: `src/features/diff/LocalDiffView.tsx`. 백엔드: `src-tauri/src/commands/diff.rs` (또는 `git.rs` 확장). |
| D6 | **사이드바 5-IA → 3-IA + 플렉서블 도크** | 사이드바 의존 줄이고, 한 화면이 여러 컨텍스트를 흡수 가능하게. | `App.tsx` 의 `PRIMARY_NAV`, `WorkspaceContext.activeView` 의 union, `useGlobalShortcuts` 의 ⌘1~⌘5 매핑. |
| D7 | **Terminal 을 메인 도크로 승격** (Code sub-tab → BottomDock 의 일등 시민, 풀스크린 모드 추가) | "사용자가 터미널을 통해서 Claude-code 또는 cli 환경을 사용하며 today를 함께 볼 수 있도록 하고싶음" — 사용자 발언. | `TerminalPanel`, `BottomDrawer`, `WorkspaceContext.layoutMode` 신설. |
| D8 | **Git 메인 진입 제거**. Today 의 헤더에 현재 브랜치/uncommitted indicator 만 남김. | 사용 빈도 낮고, 터미널에서 `git` cli 로 충분. `GitPanel` 코드는 보존하되 ↓D2 와 같은 legacy 폴더로. | `BottomDrawer` 의 git 탭 제거, `commands/git.rs` 의 metadata 일부만 유지 (head_branch, uncommitted_count). |
| D9 | **배포 채널 결정**: macOS dmg + Windows msi 직접 다운로드 (자동 업데이트는 v1.1 이후) | 자동 업데이트는 코드 서명·인증서·서버 비용 동반. 1.0 은 직접 다운로드로 단순화. 개인 도구이므로 사용자 풀이 작음. | `tauri.conf.json`, GitHub Releases workflow. |

각 결정의 *세부* 와 *대체 안* 은 후속 문서에서 다룬다.

---

## 4. 통합 일정 (Lite-W6)

W5 종료 시점부터 1.0 까지 **3 ~ 5 주** 로 추산.

```
┌───────────────────────────────────────────────────────────────┐
│ Phase A — Safety Net (1 주)                                   │
│   PR0: 회귀 테스트 보강 (Section 2 의 7 invariant)             │
│   PR1: feature flag 정리 (Lite 모드 진입 점)                   │
├───────────────────────────────────────────────────────────────┤
│ Phase B — Cut (1~2 주)                                        │
│   PR2: Problems 탭 삭제                                       │
│   PR3: Session 추정 UI 삭제 (D4)                              │
│   PR4: SQLite Changelog 시스템 삭제 (D1)                      │
│   PR5: CodeEditor / GitPanel legacy 이동 (D2, D8)             │
├───────────────────────────────────────────────────────────────┤
│ Phase C — Rebuild (1~2 주)                                    │
│   PR6: 로컬 diff 뷰어 (D5)                                    │
│   PR7: 3-IA + 플렉서블 도크 (D6, D7)                          │
│   PR8: FileTree 재설계 (변경 하이라이트, 전체 파일 트리)        │
│   PR9: AI 패널 재배치                                         │
├───────────────────────────────────────────────────────────────┤
│ Phase D — Release (1 주)                                      │
│   PR10: a11y / 다크모드 / 카피 정렬 (W6 원안에서 흡수)         │
│   PR11: 성능 점검 + 통합 테스트 25 시나리오 green              │
│   PR12: tauri bundle, 코드 서명, GitHub Releases 1.0 태깅       │
└───────────────────────────────────────────────────────────────┘
```

순서 원칙:
- **Safety Net 이 모든 삭제 PR 의 선행** — Section 2 의 invariant 가 PR 별로 자동 검증되는 상태에서만 손을 댄다.
- **Cut 이 Rebuild 보다 먼저** — 삭제로 비워진 공간을 본 다음 새 UX 를 그려야 자연스럽다.
- **Release 는 Cut + Rebuild 가 완전히 안정된 다음**.

각 PR 의 DoD 와 회귀 보호 체크는 [`07-implementation-checklist.md`](./07-implementation-checklist.md) 에 정리.

---

## 5. 비전 — 1.0 출시 후 사용자가 보는 화면

```
┌──────────────────────────────────────────────────────────────┐
│ Ocul-PM 1.0 · ai-pm · main · uncommitted: 4 files            │
├────┬─────────────────────────────────────────────────────────┤
│ 🔥 │  오늘 · 2026-06-15                                      │
│ 📅 │  ┌──────────────────────────────┬────────────────────┐ │
│ ⚙  │  │ 오늘의 포커스 / 어제의 완료    │ 활동 (journal)     │ │
│    │  │ • Planner 시드 분리           │ 14:22 [feature]    │ │
│    │  │ • 마이그레이션 PR 머지         │       useGoals     │ │
│    │  │ • Lite-W6 PR3                │       hook 분리    │ │
│    │  │                              │ 11:05 [refactor]   │ │
│    │  │                              │       FileExplorer │ │
│    │  └──────────────────────────────┴────────────────────┘ │
│    │  ┌──────────────────────────────────────────────────┐  │
│    │  │ 변경된 파일 (4) — [reindex 후 diff 보기]          │  │
│    │  │ ▸ src/features/diff/LocalDiffView.tsx   M       │  │
│    │  │ ▸ src/contexts/WorkspaceContext.tsx     M       │  │
│    │  │ ▸ src-tauri/src/commands/diff.rs        A       │  │
│    │  │ ▸ docs/Lite-update/05-index-comparison  M       │  │
│    │  └──────────────────────────────────────────────────┘  │
├────┴─────────────────────────────────────────────────────────┤
│ ▾ Terminal (확장 ⌘J · 풀스크린 ⌘⇧J)                          │
│  $ git status                                                │
│  $ claude-code "useGoals hook 을 별도 파일로 분리해줘"        │
└──────────────────────────────────────────────────────────────┘
```

이게 1.0 의 *일상 화면*. Code 워크벤치, Changelog 화면, Session 비교 모달, 자체 CodeEditor 는 더 이상 노출되지 않는다.

---

## 6. 명시적 *안티* 비전

1.0 에서 *의도적으로* 하지 않는 것:

- ❌ 외부 LLM 의 STDIN/STDOUT 을 hook 해 우리 앱이 세션을 감지하는 시도.
- ❌ 자동 업데이트 인프라 (서명 키, 업데이터 서버) — v1.1 이상.
- ❌ 모바일/웹 버전.
- ❌ 팀 공유 / 클라우드 동기화.
- ❌ Plugin marketplace, custom 어댑터 등록 UI.
- ❌ 자체 LSP / 자체 코드 인덱서 강화 (현재 수준 유지).
- ❌ 신규 LLM provider 추가 (현재 OpenAI/Anthropic/Gemini 로 충분).
- ❌ Dependency Graph 의 lazy load 외 추가 최적화.

위 모든 항목은 회의록에 *명시적 거절* 로 남겨두고, 누군가 PR 로 가져오면 reject 의 근거로 사용한다.

---

## 7. 성공 지표 (1.0 출시 기준)

| 지표 | 목표 | 측정 |
|---|---|---|
| 첫 화면 진입 → "오늘 무엇이 바뀌었는지" 확인까지 | < 5 초 | dogfood 세션 녹화 |
| 변경된 파일에 대해 diff 가 *로컬에서만* 표시되는가 | 100% (네트워크 호출 0) | DevTools network 패널 |
| Session 단어가 UI 에 노출되는 곳 | 0 (백엔드 module 명에만) | grep |
| `commands::commit_changelog_entry` 가 코드베이스에서 호출되는 곳 | 0 | grep |
| 사이드바 strip 의 1차 IA 개수 | 3 (현재 5) | App.tsx 의 PRIMARY_NAV 길이 |
| 빌드 크기 (macOS dmg) | < 60MB | tauri build 산출물 |
| 콜드 스타트 | < 1.5 초 (현재 ~1.2 초 유지) | 측정 스크립트 |

---

## 8. 의존 그래프 (Lite-W6 내부)

```
                  PR0 (Safety Net)
                       │
       ┌───────┬───────┼───────┬────────┐
       ▼       ▼       ▼       ▼        ▼
      PR2     PR3     PR4     PR5      (PR1 feature flag)
       │       │       │       │
       └───┬───┴───┬───┴───┬───┘
           ▼       ▼       ▼
          PR6     PR7     PR8
                   │
                   ▼
                  PR9
                   │
                   ▼
                 PR10
                   │
                   ▼
                 PR11
                   │
                   ▼
                 PR12
```

- Phase B (Cut, PR2~PR5) 는 *병렬 가능*. PR0 만 선행.
- Phase C (Rebuild) 는 *Cut 완료* 후. PR6 (diff 뷰어) → PR7 (레이아웃) → PR8 (FileTree) → PR9 (AI 패널) 순.
- Phase D (Release) 는 Phase C 완료 후.

---

## 9. 본 라운드의 *작성 자체* 가 dogfooding

`docs/Lite-update/` 의 작성 과정이 *.oculpm/journal/ 의 첫 1.0 시대 entries* 가 된다. 본 문서를 작성하는 LLM (Claude / Cursor / Gemini) 이 마스터 템플릿을 *읽고 따라* `.oculpm/journal/20260528/HHMM_docs_lite-update-readme.md` 같은 파일을 자동 생성하는지가 어댑터 품질의 첫 1.0 검증 케이스.

작성률이 < 80% 이면 [`02-removal-plan.md`](./02-removal-plan.md) 의 PR 시작 전에 어댑터 템플릿 패치를 한 차례 추가한다 (W4-PR1, PR2 를 다시 살짝).

---

## 부록 A. 본 라운드에서 *건드리지 않는* 영역

- LLM provider 추상화 (`src-tauri/src/llm/`)
- AST / 임베딩 / 인덱싱 파이프라인
- Planner / Goals
- Settings 의 LLM provider/model 관리
- Greenfield Wizard / StartScreen (W6 원안의 P2 작업물, 이미 ✅)
- `tauri-specta` 바인딩 생성 파이프라인
- 단축키 매핑 시스템 (3-IA 매핑만 갱신)

위 영역에 손이 가는 PR 은 의심한다. *덜어내는 라운드* 에서 *새로 짓는* 일이 발생하면 scope creep.

---

## 부록 B. 결정 완료 항목 (2026-05-28 잠금)

본 라운드 시작 전 결정 사항은 모두 [`07-implementation-checklist.md`](./07-implementation-checklist.md) §0 에서 잠금. 요약:

1. **앱 이름** → **`Ocul-PM`**. `.oculpm/` 디렉토리 정합 + 검색 노이즈 최소.
2. **3-IA 구성** → **안 A** (Today / Plan / Settings). Overview 는 Today 의 *접힌 카드* 로 흡수.
3. **CodeEditor 처분** → **`src/legacy/` 로 이동, 영구 보존**. 빌드에서는 제외.
4. **`changelog_entries` 처분** → **PR4 의 마이그레이션 008 에서 DROP**. MigrationModal 의 SELECT 만 v0.x 호환용으로 유지.
5. **외부 도구 자동 라벨링** → **v1.1 로 미룸**. 현재 어댑터 detection (파일 존재 여부) 만 1.0 에 유지.
6. **Dependency Graph** → **Today 의 Overview 카드 drawer 로 흡수**. 사용자가 카드를 열고 *명시 진입* 시에만 마운트.

이후 변경 시 §0 가 SSOT — 본 부록은 그 요약에 불과하다.
