# 07. 버그 수정: 사이드바 Chat UI 뭉개짐

> **작업 ID**: W5 / regression fix
> **일자**: 2026-05-21
> **참조**: §5.6 (Code 워크벤치), W5/04 (AiWorkbench)

---

## 증상

W5 의 AiWorkbench (Code 화면 우측 380px 패널) 에서 Chat 모드로 전환하면:
- 채팅 헤더의 "AI Code Chat / Context: …" 텍스트가 잘림
- "+ New Chat" 버튼이 사라지거나 줄바꿈
- 메시지 영역과 입력창이 좁게 짓눌림
- 코드블록이 한 줄 한 글자씩 wrap

## 원인

`ChatPanel.tsx` 의 workspace-mode 레이아웃이 *고정 폭 + 가변 폭* 가로 분할:

```
[w-56 Conversations sidebar][flex-1 Active chat area]
       224px                       나머지
```

전체 화면에서는 224 + 600~1200 = OK. 하지만 AiWorkbench 의 380px 컨테이너
안에서는:

```
[224px sidebar][156px chat]
```

채팅 영역이 156px 밖에 안 남아 모든 자식 (메시지 bubble, textarea, 버튼) 이
짓눌림.

## 수정

### `src/features/chat/ChatPanel.tsx`

새 prop `compactSidebar?: boolean` 추가. true 일 때:

1. **인라인 conversations sidebar 숨김** — chat thread 가 컨테이너 전체 폭 사용
2. **헤더 단순화** — "AI Code Chat" 라벨 제거, context 칩 단축
3. **Conversations popover** — 헤더 우상단에 `💬 N` 버튼, 클릭 시 264px 드롭다운으로
   ConversationSidebar 노출. 선택 시 자동 닫힘. backdrop click 으로 닫힘.
4. **"+ New" 텍스트 단축** — "+ New Chat" → "+ New" 로 폭 절약

추가로 헤더 컨테이너에 `gap-2 min-w-0`, context 칩에 `truncate` 적용해
긴 프로젝트명에도 안전.

### `src/features/code/AiWorkbench.tsx`

ChatPanel 호출 시 `compactSidebar` prop 전달:

```tsx
<ChatPanel
  isWorkspaceMode
  compactSidebar
  activeProjectId={activeProjectId}
  activeFile={activeFile}
/>
```

전체-화면용 진입점 (있다면) 은 `compactSidebar` 미설정 → 기본 false → 기존
사이드바 레이아웃 유지. 회귀 없음.

## 설계 결정

- **container query 대신 명시 prop**: container query 도 가능하지만 부모가
  `container-type: inline-size` 를 선언해야 하고, 분기 조건이 명시되지 않아
  미래 디버깅이 어렵다. prop 한 줄이 더 읽기 쉬움.
- **popover 위치**: 헤더 우상단 (New 버튼 옆). 우측 패널의 우측 끝에 가깝게
  배치돼 마우스 이동 거리 최소.
- **conversation 선택 후 자동 닫기**: 모달처럼 강제 닫기 — 좁은 컨텍스트
  에서 사용자가 popover 를 직접 닫는 동작을 줄임.

## 알려진 제약

- 채팅 메시지 안의 매우 긴 한 줄 (minified 토큰) 은 여전히 가로 스크롤 가능.
  Markdown 컴포넌트의 `<pre>` 가 `overflow-x: auto` 라 어쩔 수 없음 — 사용자
  의도에 부합 (잘리는 것보다 스크롤되는 게 안전).

## 검증

```
$ npx tsc --noEmit
exit=0
```

수동 검증 (다음 dev 런):
1. Code → AiWorkbench → Chat 모드 토글
2. 헤더가 한 줄 안에 깔끔하게 정렬되는지 확인
3. `💬 N` 클릭 → 264px 드롭다운 등장, conversation 클릭 시 자동 닫힘
4. 메시지 입력창과 Send/Optimize 버튼이 짓눌리지 않는지 확인
5. ⌘\\ 토글로 AiWorkbench 접었다 펴도 정상 복원
