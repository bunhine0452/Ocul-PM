# 기능 구현 또는 변경 예시

[ ] 추가하고자 하는 기능(필요하다면 기능 변경 제목을 변경해도 됨), 완료 후 체크마크 표시 

- 난이도: AI가 아래 기준에 따라 superhigh, high, medium, low, verylow 중 하나를 선택합니다.

<난이도 선정 기준>
* **superhigh**: 엮여진 파일들이 매우 많거나, 앱의 핵심 아키텍처를 크게 변경해야 하는 경우
* **high**: 여러 파일에 걸쳐 수정이 필요하거나, 새로운 데이터베이스 마이그레이션이 포함된 경우
* **medium**: 2~3개 내외의 파일 수정으로 완료되며, 기존 아키텍처를 유지하면서 새로운 컴포넌트나 간단한 로직을 추가하는 경우
* **low**: 단일 파일 내의 로직 수정이나, UI 레이아웃 및 스타일의 단순 변경인 경우
* **verylow**: 오타 수정, 텍스트(문구) 변경, 주석 추가 등 애플리케이션의 핵심 로직이나 파일 구조에 전혀 영향을 주지 않는 단순 작업

- 기능 추가 방법: 해당 기능을 구현하기 위한 단계별 접근 방식(백엔드, 프론트엔드 순서 등)

- 수정, 삭제, 생성된 파일들: 영향을 받는 모든 파일의 경로와 이름, 그리고 작업 유형(Create/Update/Delete)을 명시합니다
---

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
