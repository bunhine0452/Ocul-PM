[x] 오른쪽 사이드바 (채팅) 드래그로 크기 조절이 가능하도록 변경 왼쪽 오른쪽 다 유기적으로 줄나눔이 되어야 함.

- 난이도: **medium**
- 기능 추가 방법:
  1. `CodeWorkbench.tsx` 컴포넌트에 `aiWidth` 상태(state)를 추가하여 우측 패널의 너비를 관리하도록 하였습니다.
  2. `onMouseMove`와 `onMouseUp` 이벤트를 이용한 드래그 핸들 로직을 구현하여 사용자가 핸들을 드래그할 때 `aiWidth`가 300~1200px 사이로 조절되도록 하였습니다.
  3. 핸들(`div`)과 `AiWorkbench` 컨테이너에 Flex 관련 속성(shrink-0 등)을 부여하여 레이아웃이 깨지지 않고 유기적으로 줄바꿈/크기 조절이 되도록 지원했습니다.
- 수정, 삭제, 생성된 파일들:
  - Update: `/Users/kimhyunbin/Desktop/git/ai-pm/src/features/code/CodeWorkbench.tsx`

---

[x] 터미널과 , git , problems 패널이 오른쪽과 왼쪽 사이드바에 영향을 끼치지 않게 즉, 에디터 내로 폭대로 유기적으로 크기 조절이 가능해야함.

- 난이도: **low**
- 기능 추가 방법:
  1. 기존 `CodeWorkbench.tsx`의 최상단 Flex column 구조 안에서, `BottomDrawer` 컴포넌트가 화면 전체 너비를 차지하도록 배치되어 있었습니다.
  2. 이를 수정하여 `BottomDrawer`를 가운데 영역(Editor / Graph)과 함께 하나의 Flex column 컨테이너로 묶었습니다.
  3. 결과적으로 하단 패널들이 좌/우측 사이드바 영역을 침범하지 않고 중앙 에디터 영역의 폭에 맞춰 표시되도록 레이아웃을 재구성했습니다.
- 수정, 삭제, 생성된 파일들:
  - Update: `/Users/kimhyunbin/Desktop/git/ai-pm/src/features/code/CodeWorkbench.tsx`

---

[x] git 패널에서 Refresh 버튼과 길이 선택 하는 것은 브랜치와 깃허브 링크로 이동하는 곳 옆쪽에 존재하도록 변경

- 난이도: **medium**
- 기능 추가 방법:
  1. 기존에 `CommitsView` 컴포넌트 내부에 존재하던 조회 개수(limit) 선택 및 새로고침(Refresh) 버튼 UI를 상위 컴포넌트인 `GitPanel.tsx`의 헤더(브랜치 및 깃허브 링크 영역)로 이동(State Lifting)시켰습니다.
  2. 상위 컴포넌트에서 상태 변경을 하위 뷰들로 전달하기 위해 `refreshKey` 상태를 도입하고, 이를 `CommitsView`, `TagsView`, `ReleasesView` 에 props로 전달했습니다.
  3. 각 하위 뷰의 `useEffect` 의존성 배열에 `refreshKey`를 추가하여, 헤더의 Refresh 버튼을 누를 때마다 데이터를 다시 불러오도록(load) 연동했습니다.
- 수정, 삭제, 생성된 파일들:
  - Update: `/Users/kimhyunbin/Desktop/git/ai-pm/src/features/git/GitPanel.tsx`