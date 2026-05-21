# 07. localStorage 단일 키 + 마이그레이션

> **작업 ID**: W1 / UI-1 (마무리)
> **일자**: 2026-05-21
> **참조**: MASTER-GUIDE §6.1

---

## 변경 요약

흩어진 12+ 개의 localStorage 키를 단일 키 `aipm:workspace:v1` (JSON) 로
통합. 기존 사용자의 데이터를 1 회 읽어 통합 키에 쓰고 원본을 삭제.

## 마이그레이션 대상

| 레거시 키 | 새 위치 |
|---|---|
| `selectedProjectId` | `aipm:workspace:v1.currentProjectId` |
| `selectedProjectName` | `aipm:workspace:v1.currentProjectName` |
| `selectedProjectRoot` | `aipm:workspace:v1.currentProjectRoot` |
| `activeTab` | `aipm:workspace:v1.activeView` (+ `codeSubTab` for code 하위) |
| `activeFile` | `aipm:workspace:v1.activeFile` |
| `isTerminalPip` | (PiP 제거됨 §5.6, 키 삭제) |
| `terminalPipX` / `terminalPipY` | (PiP 제거됨, 키 삭제) |
| `terminalSessions` | (W5 에서 SQLite 로 이동 예정 — 현 상태 유지, eslint allowlist) |
| `terminalActiveSessionId` | (동일) |
| `action_${convId}_${i}` | (W5 에서 conversation_actions 테이블로 이동 예정) |

## 마이그레이션 함수 (`WorkspaceContext.tsx` 내 `migrateV0`)

```ts
function migrateV0(): WorkspaceState | null {
  const legacyKeys = ["selectedProjectId", "selectedProjectName",
                      "selectedProjectRoot", "activeTab", "activeFile",
                      "isTerminalPip"];
  if (!legacyKeys.some(k => localStorage.getItem(k) !== null)) return null;

  // … 레거시 키 읽기 …
  const mapped = mapLegacyTab(activeTab);
  const migrated: WorkspaceState = { ...DEFAULT_STATE, ... };

  legacyKeys.forEach(k => localStorage.removeItem(k));
  // PiP 키도 함께 제거
  ["terminalPipX","terminalPipY","terminalSessions","terminalActiveSessionId"]
    .forEach(k => localStorage.removeItem(k));

  return migrated;
}
```

## 호출 순서 (`loadFromStorage`)

```
1. STORAGE_KEY 가 이미 있으면 → JSON parse 후 DEFAULT_STATE 와 spread 머지
2. 없으면 migrateV0() 호출 → 결과 있으면 즉시 persistToStorage 하고 반환
3. 그래도 없으면 DEFAULT_STATE
```

휘발성 필드 (`indexingProjectId`, `indexProgress`) 는 매번 null 로 초기화.

## 설계 결정

- **단일 키 + JSON**: 키 수가 많을수록 마이그레이션 규칙이 복잡해진다. JSON
  하나면 forward-compatible (새 필드 추가 시 spread 머지로 자동 흡수).
- **버전 suffix `v1`**: 향후 schema 변경 시 `v2` 로 옮기고 `v1` 도 동일하게
  마이그레이션 함수를 추가하면 점진 업그레이드 가능.
- **PiP 키 폭삭 제거**: §5.6 결정대로 PiP 모드는 제거. 키도 함께 청소해 사용자
  머신에 dead data 가 남지 않게.
- **W5 영역 키는 유지**: ChatPanel/TerminalPanel 의 SQLite 이전은 W5 작업.
  마이그레이션에서 건드리지 않고 eslint allowlist 로 표시해 추적.

## 검증

- 새로 설치한 환경: `DEFAULT_STATE` 로 시작, 정상 동작.
- 기존 환경 (`activeTab="chat"` 등 보유): 1 회 로드 후 모든 레거시 키 삭제됨,
  새 단일 키에 통합 상태 저장됨.
- localStorage devtools 에서 `aipm:workspace:v1` 만 보이는지 수동 확인.
