# Ocul-PM Lite 1.0 — 마스터링 문서

> 상태: **초안 (1차)** · 작성일 2026-05-28 · 작성자 Claude(Opus 4.7)
> 선행 문서: `docs/refactor/MASTER-GUIDE.md`, `docs/major_update/oculpm/phases/W6-stabilize-dogfood.md`
> 작업 디렉토리: `docs/Lite-update/`

---

## 0. 이 폴더의 위상

W1~W5(refactor 트랙) + W1~W5(major_update/oculpm 트랙) 가 모두 ✅ 인 시점에서,
**1.0 배포를 위한 단일 마스터링 가이드**.

`MASTER-GUIDE.md` 가 "AI PM 으로 다시 태우기" 의 청사진이었다면,
**본 문서들은 "그렇게 태운 결과물에서 무엇을 더 덜어내고 1.0 으로 묶을 것인가"** 를 다룬다.

핵심 전환:
1. **`.oculpm/journal/` 가 진실의 단일 출처** 가 되면서, 기존 SQLite Changelog 는 *중복 기능* 으로 강등.
2. **외부 코딩 에이전트 (Claude Code / Cursor / Gemini CLI) 와 실시간 통신은 포기**. 세션 경계를 앱이 추정하려는 모든 시도를 걷어내고, `AGENTS.md` 의 프롬프트로 LLM 을 신뢰한다.
3. **앱 내부 코드 에디터를 1.0 에서 제거**. 외부 에이전트가 코드를 쓰는 동안 우리는 *기록·관리·요약* 에 집중.
4. **사이드바 의존도를 줄이고 유연한 레이아웃** 으로. 한 화면이 여러 컨텍스트를 흡수할 수 있도록.

---

## 1. 문서 구성

| 파일 | 역할 | 우선 독자 |
|---|---|---|
| [`00-master-plan.md`](./00-master-plan.md) | **마스터 플랜 (SSOT)**. 1.0 의 정체성, 핵심 결정 9개, 전체 일정. 본 폴더의 다른 문서가 모두 여기서 시작한다. | 전원 |
| [`01-w6-reassessment.md`](./01-w6-reassessment.md) | "W6 를 그대로 진행해야 하는가?" 에 대한 답 + 새 W6 (=Lite-W6) 의 재정의. | PM(사용자) |
| [`02-removal-plan.md`](./02-removal-plan.md) | 삭제 대상 (Changelog / CodeEditor / Problems / Session UI) 의 의존 그래프, 안전 삭제 순서, 잔존 logic 보호 전략. | 백엔드/프론트 |
| [`03-feature-revisions.md`](./03-feature-revisions.md) | 수정 대상 (FileTree / AI 패널 / Terminal / Git) 의 새 위치, 인터랙션, 데이터 흐름. | 프론트 |
| [`04-ui-ux-redesign.md`](./04-ui-ux-redesign.md) | "사이드바 의존 ↓ · 레이아웃 유연성 ↑" 의 구체 화면. 5-IA → 3-IA + 플렉서블 도크. | 프론트/디자인 |
| [`05-index-comparison.md`](./05-index-comparison.md) | "변경 파일에 reindex 하고, 로컬에서 diff 를 보여준다" — 세션 감지 없이 hallucination 검증 흐름을 살리는 설계. | 백엔드/프론트 |
| [`06-release-1.0-plan.md`](./06-release-1.0-plan.md) | Tauri 번들링, 코드 서명, 자동 업데이트, 배포 채널, 브랜딩, 릴리스 노트. | PM(사용자) |
| [`07-implementation-checklist.md`](./07-implementation-checklist.md) | Lite-W6 의 PR 단위 분해 + 각 PR 의 DoD + 회귀 보호 체크. | 전원 |

---

## 2. 빠른 요약 — 한 화면

**무엇을 하나**:
1. **삭제**: SQLite Changelog · CodeEditor · Problems · Session 표시 UI · Diff-vs-Narrative 모달 일부.
2. **유지·수정**: FileTree(전체 파일 + 변경 하이라이트), AI 패널(레이아웃 이동), Terminal(메인 도크), Git(최소화 또는 흡수).
3. **신규**: 로컬 diff 뷰어 (변경된 파일에 한해 즉시 비교 가능), 플렉서블 도크 (터미널 풀스크린 ↔ Today 분할).
4. **회귀 보호**: 각 삭제 단계마다 oculpm pipeline 의 invariant 가 깨지지 않는지 통합 테스트로 잠금.

**무엇을 안 하나**:
- 외부 LLM 과의 실시간 통신 시도 (세션 추적, IPC 채팅 hook 등). 영구 포기.
- 새로운 백엔드 기능 추가. *덜어내고 다듬는 라운드* 임을 잊지 않는다.
- v2 영역으로 정해진 기능 (멀티 머신, 팀 공유) 의 단초 코드 사전 작성.

**가장 위험한 가정**:
- 외부 LLM 이 `AGENTS.md` (마스터 템플릿) 를 *읽고 따른다* 는 가정. 따르지 않을 경우 journal 이 비어 있고, 사용자는 "왜 비었는지" 모른다.
  → 대응: §5 의 로컬 reindex + diff 뷰어가 **journal 없이도 변화 흐름을 보여주는 대안 경로** 역할.

---

## 3. 핵심 의사결정 (1줄씩)

- **세션 추정**: 표시 X. 백엔드 로직은 watcher 수준에서 유지 (index/ndjson 작성용).
- **할루시네이션 검증**: 세션 비교 모달 → *로컬 diff 뷰어 + reindex* 로 대체.
- **Changelog**: SQLite 테이블 + UI 전부 제거. journal 이 대체.
- **CodeEditor**: 빌드에서 제외 (legacy 폴더로 이동), 코드 보존.
- **Problems**: 완전 삭제.
- **FileTree**: 전체 디렉토리 (oculpm-aware ignore 적용) + 변경 하이라이트.
- **AI 패널**: 사이드바 보조 → 오버레이 / 분리 윈도우.
- **Terminal**: BottomDrawer → 메인 도크 (확장 가능).
- **Git**: 1.0 에서 사이드패널 진입 제거, 터미널 안에서 사용 권장.
- **사이드바**: 5-IA strip → 3-IA strip + 플렉서블 도크.

---

## 4. 진행 상태 (2026-05-29)

- [x] **모든 사전 결정 잠금 완료** — [`07-implementation-checklist.md`](./07-implementation-checklist.md) §0 참조.
- [x] Phase A 직전 *dogfooding 회고* — [`retrospection/_dogfooding-retrospective.md`](./retrospection/_dogfooding-retrospective.md)
- [x] **Phase A PR0 (회귀 보호망)** — `pre-cut-PR0` 태그 머지 완료
- [ ] Phase A PR1 (Feature flag 정리) ← 다음 액션 후보
- [ ] **PR-0c (pre-existing clippy 48 errors 일괄 fix)** ← 1.0 출시 전 처리 필요 (master-prompt §5.3)
- [ ] Phase B (PR2~PR5) — 병렬 가능
- [ ] Phase C (PR6~PR9)
- [ ] Phase D (PR10~PR12) — 1.0 출시

진행 순서:
1. `_dogfooding-retrospective.md` 작성 (1시간).
2. [`02-removal-plan.md`](./02-removal-plan.md) §2 PR0 로 진입.
3. 의존 그래프 순서대로: PR1 → Phase B (병렬) → Phase C → Phase D.

> 본 문서들은 *살아있는 문서* — Lite-W6 진행 중 발견된 새 결정은 [`07-implementation-checklist.md`](./07-implementation-checklist.md) §0 에 추가 + 해당 §에 반영.
