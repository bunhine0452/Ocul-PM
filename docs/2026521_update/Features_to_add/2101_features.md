[x] Chat + QuickEdit(Assist) 통합: 채팅창 상단에 Cursor 스타일 모드 토글 추가 및 사이드바 아이콘 통합

- 난이도: **high** — 6개 파일에 걸쳐 수정 필요, CodeSubTab 타입 변경에 따른 연쇄 수정 + localStorage 상태 마이그레이션 포함

- 기능 추가 방법:
  1. `WorkspaceContext.tsx`에서 `CodeSubTab` 타입을 `"chat" | "assist"` → `"ai"` 하나로 변경하고 저장된 상태 마이그레이션 추가
  2. `App.tsx` 왼쪽 Code 서브 사이드바에서 Chat/Assist 두 아이콘을 AI 하나로 통합
  3. `CodeWorkbench.tsx`에서 `codeSubTab === "ai"` 통합 처리
  4. `AiWorkbench.tsx`에서 2단 헤더 구조 구현: 1행에 `[Chat] [QuickEdit]` 모드 토글, provider/model 상태를 양 모드가 공유하도록 리프트
  5. `ChatPanel.tsx`에 `externalProvider`/`externalModel` props 추가하여 외부 주입 지원
  6. `CommandPalette.tsx`에서도 Chat/Assist → AI 통합

- 수정, 삭제, 생성된 파일들:

| 파일 경로 | 작업 유형 |
|-----------|-----------|
| `src/contexts/WorkspaceContext.tsx` | **Update** |
| `src/App.tsx` | **Update** |
| `src/features/code/CodeWorkbench.tsx` | **Update** |
| `src/features/code/AiWorkbench.tsx` | **Update** |
| `src/features/chat/ChatPanel.tsx` | **Update** |
| `src/components/CommandPalette.tsx` | **Update** |

---

[x] LLM 제공자/모델 셀렉터: API 키 등록 여부에 따른 Provider + Model 드롭다운을 Cursor 스타일로 구현

- 난이도: **medium** — 신규 컴포넌트 1개 생성 + 기존 AiWorkbench에 통합

- 기능 추가 방법:
  1. `ModelSelector.tsx` 재사용 컴포넌트 신규 생성 (마운트 시 `commands.secretHas()`로 API 키 유무 체크, Provider별 추천 모델 목록 내장, 드롭다운 + 직접 입력 지원)
  2. `AiWorkbench.tsx` 헤더 2행에 `ModelSelector` 배치하여 Chat/QuickEdit 양 모드에서 공유
  3. QuickEdit 내부의 기존 별도 provider/model select bar 제거

- 수정, 삭제, 생성된 파일들:

| 파일 경로 | 작업 유형 |
|-----------|-----------|
| `src/components/ModelSelector.tsx` | **Create** |
| `src/features/code/AiWorkbench.tsx` | **Update** |
