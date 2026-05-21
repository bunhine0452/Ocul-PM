# 06. WorkspaceContext 를 App.tsx 에 실제 연결

> **작업 ID**: W1 / UI-1 (마무리)
> **일자**: 2026-05-21
> **참조**: MASTER-GUIDE §6.1 (상태 단일화)

---

## 변경 요약

기존에 파일만 만들어두고 mount 하지 않았던 `WorkspaceContext` 를 `main.tsx` 의
Provider 트리에 연결하고, `App.tsx` 의 12 개 useState + 5 개 useEffect +
17 개 직접 `localStorage` 호출을 전부 흡수.

## 변경 파일

### `src/main.tsx`

`SettingsProvider` 안쪽에 `WorkspaceProvider` 추가:

```tsx
<SettingsProvider>
  <WorkspaceProvider>
    <App />
  </WorkspaceProvider>
</SettingsProvider>
```

### `src/contexts/WorkspaceContext.tsx`

- `WorkspaceState` 에 `codeSubTab: CodeSubTab` 추가 — UI-5 (W5) 가 정식
  통합 워크벤치로 흡수할 때까지의 *전환 기간 보조 상태*. Code 탭 내부에서
  Files/Chat/Assist/Graph/Terminal/Git 중 어디를 보고 있는지 보존.
- 새 타입: `export type CodeSubTab = "files"|"chat"|"assist"|"graph"|"terminal"|"git"`.
- `mapLegacyTab` 을 `(LegacyTab) → { view, sub }` 형태로 확장.
  레거시 키 `activeTab="chat"` 같은 값을 `(view="code", sub="chat")` 로
  매핑해 마이그레이션 1 회로 끝낸다.
- 신규 헬퍼:
  - `setCodeSubTab(sub)` — 세컨더리 탭만 변경
  - `openInCode(sub)` — `activeView="code"` + `codeSubTab=sub` 원샷
- 기본값 `activeView` 를 `"code"` → `"overview"` 로 변경 (W3 IA 의도에 맞춤).

### `src/App.tsx` (전면 재작성)

다음 12 useState 제거 → `useWorkspace().state` 로 흡수:

| 제거된 useState | 새 출처 |
|---|---|
| `selectedProjectId` | `state.currentProjectId` |
| `selectedProjectName` | `state.currentProjectName` |
| `selectedProjectRoot` | `state.currentProjectRoot` |
| `activeTab` | `state.activeView` (+ `state.codeSubTab`) |
| `activeFile` | `state.activeFile` |
| `isTerminalPip` | (PiP 기능 §5.6 에 의해 제거 — false 고정) |
| `indexingId` | `state.indexingProjectId` |
| `progress` | `state.indexProgress` |
| `showSettingsModal` | (로컬 `settingsOpen` 으로 단순화 + ⌘, 으로 이동) |
| `showDiagnostics` | (Diagnostics 가 Settings 마지막 탭으로 흡수) |
| `health` | (Diagnostics 탭이 자체적으로 관리) |
| `healthError` | (동일) |

다음 5 개 `useEffect` (localStorage 동기화용) 전면 삭제. 영속화는 이제
`WorkspaceProvider` 내부의 단일 `useEffect` 가 책임.

App.tsx 안에서 `localStorage` 호출은 **0 건**. (sanity check: `grep -c localStorage src/App.tsx` → 0)

## 설계 결정

- **`codeSubTab` 을 컨텍스트에 둠**: 사용자가 `Files → Overview → Files` 로
  돌아왔을 때 동일 sub-tab 으로 복원되어야 자연스럽다. 휘발성으로 두면
  *"화면 전환 시 sub-state 손실"* 문제 (§2.2) 가 재발한다.
- **`DEFAULT_STATE.activeView = "overview"`**: 새 사용자가 프로젝트를 처음
  열면 PM 정체성 화면이 먼저 보여야 한다 (§5.1 IA 의 의도). 기존 사용자는
  마이그레이션이 `activeTab` 값을 그대로 보존하므로 영향 없음.
- **로컬 dialog 상태는 남김**: rename/delete dialog 와 `paletteOpen`/
  `settingsOpen` 같은 *일회성 모달 상태* 는 context 에 둘 가치가 없다.
  page reload 시 초기화되는 게 옳다.

## 검증

```
$ npx tsc --noEmit
exit=0
$ pnpm lint:storage
✓ no direct localStorage access outside the allowlist
```
