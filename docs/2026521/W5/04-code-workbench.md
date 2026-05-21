# 04. CodeWorkbench + AiWorkbench + BottomDrawer (UI-5)

> **작업 ID**: W5 / UI-5
> **일자**: 2026-05-21
> **참조**: MASTER-GUIDE §5.6 (Code 화면)

---

## 변경 요약

Code 화면을 **3 단 분할 + Bottom Drawer** 통합 워크벤치로 전환. 기존의
Files/Chat/Assist/Graph/Terminal/Git sub-tab 6 종을 한 화면에 흡수.

```
┌────────┬───────────────────────┬─────────────┐
│  Tree  │  Editor / Graph       │ AiWorkbench │  ⌘\ 토글
│ (Files)│  (primary content)    │ Quick Edit  │
│        │                       │ ↔ Chat      │
├────────┴───────────────────────┴─────────────┤
│  BottomDrawer (Terminal / Git / Problems)    │  ⌘J 토글
└──────────────────────────────────────────────┘
```

## 신규 파일

### `src/features/code/CodeWorkbench.tsx`

3 단 분할의 컨테이너 컴포넌트.

- **C-1 Tree**: 기존 `FileExplorer` 를 240px 좌측 패널로 마운트. 인덱싱
  gutter (progress + Re-index 버튼) 도 같이.
- **C-2 Primary content**: `codeSubTab` 에 따라 분기
  - `"files"`: `CodeEditor` 또는 placeholder (No File Opened — ⌘K 안내)
  - `"graph"`: `DependencyGraphView`
- **C-3 AiWorkbench**: `aiWorkbenchOpen` 일 때 380px 우측 패널 렌더
- **C-4 BottomDrawer**: 항상 마운트 (헤더는 9px 고정, `bottomDrawerOpen` 일 때 본문 노출)

`codeSubTab` 의 의미가 화면에 따라 다르게 매핑됨:
- `files`/`graph` → primary content 변경
- `chat`/`assist` → `aiWorkbenchMode` 변경 + 우측 강제 open
- `terminal`/`git` → BottomDrawer 강제 open + 해당 탭 활성

이 매핑은 W5 에서 정식 통합 UI 로 흡수되는 *과도기 호환* 역할.

### `src/features/code/AiWorkbench.tsx`

우측 AI 패널. 모드 토글 두 종:

| 모드 | 본문 |
|---|---|
| `quick-edit` | 자체 컴포넌트 `<QuickEdit>` — 입력 → Clarify → 영어 프롬프트 생성 |
| `chat` | 기존 `<ChatPanel isWorkspaceMode>` 임베드 |

**QuickEdit 의 동작 시퀀스**:
1. 사용자 입력 + Run 클릭
2. `clarify_edit_intent` 호출 → `auto_proceed=true` 면 바로 3 단계로
3. 모호 → ClarifyDialog 열림 → 사용자 답변
4. `generate_edit_prompt_with_answers` → 영어 프롬프트 + 한국어 요약 + 관련 파일
5. 복사 버튼

**추가 영역**: "오늘 변경사항" 스캔 + "Changelog 에 저장" CTA. W4 의
골든 패스를 그대로 옮겨와 AssistPanel 의 역할을 완전히 흡수.

### `src/features/code/BottomDrawer.tsx`

Code 화면 하단의 통합 드로워.

| 탭 | 내용 |
|---|---|
| Terminal | 기존 `<TerminalPanel>` 도킹 모드 (PiP 제거) |
| Git | 기존 `<GitPanel>` (Changelog 탭 제거됨 — W4 화면으로 승격) |
| Problems | LSP 진단 placeholder ("후속 PR") |

⌘J 단축키는 `useGlobalShortcuts` 가 `bottomDrawerOpen` 토글.
탭 클릭 시 닫혀있던 드로워는 열림, 같은 탭 재클릭은 닫힘.

`AiWorkbench` 와 `BottomDrawer` 모두 *상태는 WorkspaceContext* — 다른 화면 (Plan
등) 으로 갔다 돌아와도 마지막 상태 복원.

## 수정 파일

### `src/App.tsx`

- Code view 의 거대한 sub-tab 분기 블록 (130+ 줄) → 한 줄 `<CodeWorkbench>` 로 압축
- 인라인 `FileExplorer`, `TerminalPanel`, `<CodeEditor>`, `<ChatPanel>`, `<AssistPanel>`,
  `<GitPanel>`, `<DependencyGraphView>` 마운트 전부 제거 → CodeWorkbench 내부로 이전
- `Workspace` props 슬림: `activeFile`/`initialScrollLine`/`handleOpenFile`/
  `indexingId`/`progress`/`startIndex` 모두 제거 (모두 WorkspaceContext / CodeWorkbench
  내부에서 관리)
- 미사용 import 삭제 (`FileExplorer`, `CodeEditor`, `AssistPanel`, `ChatPanel`,
  `DependencyGraphView`, `GitPanel`)

### Sidebar 의 Code sub-nav 유지

12px 폭 secondary sidebar 의 6 sub-tab 버튼은 *그대로 유지*. CodeWorkbench
가 `codeSubTab` 변화를 감지해 적절한 화면을 노출하므로 사용자 멘탈 모델이
호환됨. 정식 통합 UI 가 자리 잡으면 후속에서 단순화 가능.

## 검증

```
$ npx tsc --noEmit
exit=0
$ pnpm lint
✓ no direct localStorage access outside the allowlist
$ cd src-tauri && cargo check
warning: `ai-pm` (lib) generated 5 warnings, 0 errors
```
