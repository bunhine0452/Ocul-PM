# W3-PR6 — `TimelineView` + `SessionCard` + `JournalEntryCard`

> **목표**: TodayScreen 의 메인 영역 — 세션 단위 collapsible 카드 + 그 안의 entry 카드들. 키보드 j/k/space/enter 동작. 손으로 만든 `.md` 가 1초 안에 카드로 표시.
> **선행**: W3-PR2 (`JournalCache`), W3-PR3 (commands), W3-PR4 (oculpmApi, WorkspaceContext).
> **참조**: [`../phases/W3-journal-today-ui.md`](../phases/W3-journal-today-ui.md) §W3-PR6, [`../02-frontend.md`](../02-frontend.md) §6 (컴포넌트 트리), 페이즈 §3 (시안).

---

## 1. 컴포넌트 트리 (계획)

```
TodayScreen
├── TodayHeader (날짜, workday, tz, 설정 톱니)
├── CategoryFilterBar               // PR8
├── (split — left 70%, right 30%)
│   ├── TimelineView
│   │   ├── SessionCard × N (collapsible, 시간 역순)
│   │   │   ├── SessionHeader
│   │   │   └── EntryList
│   │   │       └── JournalEntryCard × M
│   │   └── EmptyToday (sessions 0개일 때)   // PR5
│   └── DetailPane                            // PR7
└── footer status: watcherStatus, integrity warnings
```

---

## 2. `SessionCard` (계획)

### Props

```ts
type SessionCardProps = {
  session: Session;
  entries: JournalEntrySummary[];
  defaultExpanded: boolean;            // 오늘 첫(=최신) 세션만 true
  selectedEntryPath?: string;
  onSelectEntry: (path: string) => void;
};
```

### 표시

- 헤더 라인 1: `Session 20260524-003 · 09:13 → 11:47 · 47 파일 · 12 unique · claude-code`
- 헤더 라인 2 (진행 중): `→ 진행 중` + 펄스 dot.
- entries 0개 + 진행 종료: "이 세션에 narrative 없음" + DiffVsNarrative 버튼 (W4 까지 disabled, tooltip).
- 펼침 상태는 `localStorage["oculpm.session.expanded." + projectId + "." + sessionId]` 영속화. 디폴트는 오늘 첫 세션만 true.

### Agent label guess

W4 의 `agent.id` 자동 추정이 없으니 W3 에서는 entry 들의 `agent.id` 모드(최빈값) 로 추정 + 없으면 "—".

---

## 3. `JournalEntryCard` (계획)

### 표시 ASCII

```
┌──────────────────────────────────────────────────────────────────────┐
│ [bug] [medium] [done]  09:25 · src-tauri/src/db.rs +1개 · ⚠ 미검증   │
│ Changelog Export 파라미터 불일치                                      │
│ #changelog #sqlite                                                   │
└──────────────────────────────────────────────────────────────────────┘
```

### 배지 (페이즈 §3.4 토큰 사용)

- type 배지: bug / feature / error / refactor / chore — 색상 토큰.
- difficulty 농도: verylow ~ superhigh — opacity 단계.
- status: done / in_progress / planned / abandoned — 아이콘 + 텍스트.
- warning: 미검증 / mismatch / parse error — 우상단 dot.

### 인터랙션

| Trigger | 결과 |
|---|---|
| 클릭 | DetailPane 에 entry 로드 + URL `?entry=...` |
| 더블클릭 | DetailPane + 원본 파일 OS 에서 열기 |
| 우클릭 | 컨텍스트 메뉴: 검증/해제, 원본 열기, 복사 (markdown), 삭제 (확인) |
| hover | 우측 ✓ 토글 표시 + ⌨ shortcut hint |
| `j` / `k` | 다음/이전 카드 선택 (Detail 자동 로드) |
| `space` | 선택 카드 verify 토글 (`oculpmApi.setJournalVerified`) |
| `enter` | DetailPane 포커스 |

---

## 4. `ManualEntryModal` 본격 구현 (PR5 의 stub 대체)

shortcut `⌘+Shift+J` 또는 EmptyToday V2/V3 의 [수동 entry 작성] 버튼이 트리거.

### 필드

- type (radio): bug / feature / error / refactor / chore
- slug (input, 정규식 hint)
- title (input)
- difficulty (select, optional)
- status (select, default planned)
- session_id (display only — 현재 세션 또는 "새 manual 세션 시작")
- files_touched (chip multi-select — recent file_changes 에서 후보 자동 채움)
- tags (chip multi-select)
- body_markdown (textarea + 마크다운 preview toggle)

### 액션

- [작성] → `oculpmApi.createManualEntry(projectId, draft)`.
- 성공 → 모달 close + 토스트 + DetailPane 에 자동 로드.
- slug 위반 → inline 에러.

---

## 5. 데이터 fetch / 갱신 전략

페이즈 §2.4 의 3단계:
1. **Mount 시**: `listJournalEntries(workday)` + `listSessions(workday)` 일괄.
2. **이벤트 기반**: `oculpm:journal_path_changed` (또는 PR2 의 `journal_cache_updated`) 가 오면 invalidate.
3. **포커스 복귀**: tab visibility = visible → 전체 재요청.

키보드 선택 상태는 `TimelineView` 내 useState. 카드 순서가 바뀌어도 path 기반으로 유지.

---

## 6. 테스트 (계획)

### Vitest (페이즈 §4 키보드 단축키 2개 + 추가)

- [ ] 손으로 만든 entry 3개 → 카드 3개 렌더 (mock `listJournalEntries`).
- [ ] 클릭 → `onSelectEntry` 콜백 호출 + URL 갱신.
- [ ] 키보드 `j` → 다음 카드 selected.
- [ ] 키보드 `space` → `oculpmApi.setJournalVerified` 호출.
- [ ] 진행 중 세션 헤더 → "진행 중" 배지 노출.
- [ ] frontmatter 깨진 entry → 노란 dot.
- [ ] ManualEntryModal 의 slug 위반 → inline 에러.
- [ ] ManualEntryModal 성공 → `oculpmApi.createManualEntry` 호출 + 모달 close.

### 수동 QA (페이즈 §5 항목 1, 3, 7, 8)

- [ ] `.oculpm/journal/<오늘>/Bugs/0900_bug_test.md` 손으로 만들면 1초 안에 카드.
- [ ] 파일 내용 수정 (frontmatter title) → 카드 제목 갱신.
- [ ] verified 토글 → 파일 frontmatter 실제 변경 (`cat` 확인).
- [ ] j/k 키 동작.

---

## 7. DoD

- [ ] 손으로 만든 .md 3개가 1초 안에 카드로 표시.
- [ ] 카드 클릭 → 우측 디테일 패널 열림 (PR7 와 통합).
- [ ] j/k 키 동작 + space 토글 + enter 포커스.
- [ ] 진행 중 세션 펄스 dot.
- [ ] 1024px 폭 적응: DetailPane 이 사이드 → 모달.
- [ ] `pnpm test` 7+ 케이스 green.
- [ ] 시안 (페이즈 §3) 과 80% 일치 (스크린샷 비교 첨부).

---

## 8. 실행 노트 (작업 중 갱신)

### 의사결정 후보

1. **세션 그룹화 알고리즘**: `entries.groupBy(e => e.session_id)` 후 `listSessions` 결과와 join. 세션이 없는 entry (manual 단독) 는 "Manual" 가상 세션에 묶음.
2. **가상화**: 페이즈 §2.5 — W3 은 일반 렌더링, W6 측정 후 결정. 100 entry 이상이면 react-virtual 도입.
3. **컨텍스트 메뉴 라이브러리**: shadcn ContextMenu 권장.
4. **`agent_label_guess`**: 빈도 1위 + 1위가 50% 이상 점유시만 표시. 그 외 "—".

### 발견된 함정 / 변경

(작성 중)

### 다음 PR 로 넘기는 메모

- PR7 의 `JournalEntryDetail` 가 본 PR 의 selectedEntryPath 와 URL query 를 source-of-truth 로 사용.
- W4 의 DiffVsNarrative 가 SessionCard 의 "narrative 없음" 자리 + 컨텍스트 메뉴에 wired.
- ManualEntryModal 의 `files_touched` 자동 채움 — `oculpmApi.getFileChanges(workday, sessionId)` 호출. session_id 없으면 최근 50개.
