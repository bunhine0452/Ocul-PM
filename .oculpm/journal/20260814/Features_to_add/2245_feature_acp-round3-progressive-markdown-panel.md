---
schema_version: 1
type: feature
slug: "acp-round3-progressive-markdown-panel"
status: done
difficulty: high
created_at: "2026-08-14T22:45:38+09:00"
session_id: "mcp-20260814-224538"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/chat/markdownBlocks.ts"
    op: create
  - path: "src/__tests__/markdown_blocks.test.ts"
    op: create
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/styles/agent.css"
    op: update
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src-tauri/src/commands/acp.rs"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags:
  - "acp"
  - "performance"
  - "design"
  - "ux"
  - "mcp-tool"
---
[x] 스트리밍 서식 점프 제거 · Effort 슬라이더 · 세션 경로 필터 · 대화 패널

## 스트리밍 — 세 번째 시도에서야 맞췄다

이번 지적: 평문이 먼저 보이고 **나중에 서식이 입혀지는 점프**가 난다. 앞 라운드에서 "스트리밍 중엔 마크다운을 파싱하지 않는다"로 렉을 잡았는데, 그 대가가 이 점프였다. 두 실패가 같은 딜레마의 양 끝이다 — 매 프레임 전체를 파싱하면 끊기고, 끝에 한 번 파싱하면 점프한다.

**블록 단위**가 답이었다. 텍스트를 빈 줄 경계로 쪼개면 완성된 블록은 문자열이 더 이상 바뀌지 않으므로 `memo` 가 재파싱을 건너뛴다. 매 프레임 다시 파싱되는 것은 **마지막 블록 하나뿐**이라 비용이 대화 길이가 아니라 문단 길이에 묶인다. 서식은 처음부터 보이고, 끝에 아무 일도 일어나지 않는다.

경계 판정은 순수 함수로 뺐다(`markdownBlocks.ts`). 펜스 코드블록 안의 빈 줄은 경계가 아니다 — 잘리면 반쪽 펜스가 따로 파싱돼 화면이 깨진다. 테스트가 지키는 성질 둘: 코드블록 무결성, 그리고 **글자가 더 붙어도 앞 블록의 문자열이 바이트 단위로 같을 것**(이게 깨지면 memo 가 통째로 무의미해진다).

## Effort — 목록이 아니라 트랙

Effort 는 다른 설정과 달리 값에 **순서**가 있다(low→max). 순서 있는 값을 드롭다운으로 주면 "지금이 어느 정도인지"가 한눈에 안 들어온다. 점 트랙으로 그려 위치가 곧 강도가 되게 했고, 지나온 점은 채워 "여기까지 왔다"를 읽게 했다. ←/→ 키로도 움직인다(`role="slider"` + aria-valuetext).

## 세션 목록은 이 프로젝트 것만

`cwd` 를 요청에 실었지만 **우리가 다시 거른다.** 필터는 어댑터의 선의에 기대는 부분이고, 남의 프로젝트 대화가 섞이면 열어 보기 전까지 알 수 없다. 경로는 `canonicalize` 후 비교 — 심볼릭 링크로 들어온 루트와 어댑터가 돌려준 실경로가 다를 수 있다.

## 대화 패널

팝오버를 접히는 좌측 패널로 바꿨다. 대화를 고르는 일은 "잠깐 열어 보고 닫는" 동작이 아니라 **옆에 두고 오가는** 동작이다. 새 대화 버튼 · 검색 · 목록(제목+시각), 접힘 상태는 영속(`acpPanelOpen`). 세션이 바뀌면 목록을 다시 읽어 방금 만든 대화가 바로 보인다.

## 검증

typecheck 0 · 프런트 **763건(62파일)** · lint 0 · build 0 · 백엔드 569 유닛.

작업 중 실수 하나: 파이썬 슬라이스로 옛 컴포넌트를 지우면서 그 **뒤에 있던 `EffortSlider` 까지 날렸고**, 레이아웃 래퍼를 하나 더 감싸며 닫는 태그를 빠뜨렸다. 둘 다 typecheck 가 즉시 잡았다 — 문자열 치환으로 큰 컴포넌트를 옮길 때는 앞뒤 경계를 눈으로 확인해야 한다는 교훈.

**여전히 미확인**: 스트리밍 체감(사람 눈 필요)과 `session/resume` 의 과거 대화 재생 여부.