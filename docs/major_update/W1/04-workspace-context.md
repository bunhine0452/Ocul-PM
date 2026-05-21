# 04. WorkspaceContext 신설 — 상태 단일화

> **작업 ID**: W1 / UI-1  
> **일자**: 2026-05-21  
> **참조**: MASTER-GUIDE §6.1 (상태 단일화)

---

## 변경 요약

`App.tsx`의 12개 `useState` + 5개 `useEffect` + 흩어진 `localStorage` 접근을 `WorkspaceContext` 단일 store로 통합.

## 새 파일

### `src/contexts/WorkspaceContext.tsx`

**핵심 인터페이스**:
```typescript
interface WorkspaceState {
  currentProjectId: number | null;
  currentProjectName: string | null;
  currentProjectRoot: string | null;
  activeView: "overview" | "today" | "plan" | "changelog" | "code";
  openFiles: string[];
  activeFile: string | null;
  aiWorkbenchMode: "quick-edit" | "chat";
  aiWorkbenchOpen: boolean;
  bottomDrawerOpen: boolean;
  bottomDrawerTab: "terminal" | "git" | "problems";
  fileExplorerExpanded: Record<string, boolean>;
  // 휘발성 (영속화 안 됨)
  indexingProjectId: number | null;
  indexProgress: IndexProgress | null;
}
```

**원칙**:
1. `localStorage` 접근은 이 파일 안에서만
2. 영속화 키: `aipm:workspace:v1` 단일 키 + JSON
3. 마이그레이션 함수 `migrateV0()` → 기존 12개 키 자동 흡수 후 삭제
4. Terminal PiP 관련 4개 키도 함께 삭제 (기능 제거)

**제공하는 액션**:
- `setProject(id, name, root)` — 프로젝트 전환
- `setActiveView(view)` — 화면 전환
- `setActiveFile(file)` — 파일 선택
- `setIndexing(projectId, progress)` — 인덱싱 상태
- `resetWorkspace()` — 대시보드 복귀

## 레거시 마이그레이션

| 기존 localStorage 키 | 흡수 대상 |
|---|---|
| `selectedProjectId` | `currentProjectId` |
| `selectedProjectName` | `currentProjectName` |
| `selectedProjectRoot` | `currentProjectRoot` |
| `activeTab` | `activeView` (매핑: files→code, planner→plan 등) |
| `activeFile` | `activeFile` |
| `isTerminalPip` | 삭제 (PiP 제거) |
| `terminalPipX/Y` | 삭제 |
| `terminalSessions` | 삭제 |
| `terminalActiveSessionId` | 삭제 |

## 향후 App.tsx 통합

> **Note**: 이 파일은 독립적으로 생성되었습니다. App.tsx에서 실제로 useState를 제거하고 WorkspaceContext를 사용하는 전환 작업은 별도 진행 예정입니다. 현재는 두 시스템이 공존하는 상태이며, 점진적으로 전환됩니다.

## 해결될 문제
- ✅ 프로젝트 전환 시 `activeFile`이 이전 프로젝트 경로로 남는 깜빡임
- ✅ 새로고침 시 sub-state (PlannerPanel 필터 등) 손실
- ✅ localStorage 키 12개 → 1개 통합
- ✅ FileExplorer expanded 폴더 새로고침 후 보존 (fileExplorerExpanded 영속화)
