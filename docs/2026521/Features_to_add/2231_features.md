[x] 하단 패널 터미널 있는 곳의 크기를 사용자가 드래그 해서 변경할 수 있도록 변경

- 난이도: **low**

- 기능 추가 방법:
  1. (프론트엔드) `BottomDrawer.tsx`에 `drawerHeight` state 및 `useRef`를 추가하여 드래그 시작 좌표와 초기 높이를 기록
  2. (프론트엔드) 패널 상단에 `cursor-row-resize` 핸들 `<div>`를 absolute 배치하여 마우스 드래그 이벤트(`mousedown` → `mousemove` → `mouseup`)로 높이를 실시간 조절
  3. (프론트엔드) 기존 고정 높이(`h-72`) 대신 `style={{ height }}` 동적 값을 적용하고, 드래그 중 transition 애니메이션을 비활성화하여 자연스러운 리사이징 구현

- 수정, 삭제, 생성된 파일들:
  - `src/features/code/BottomDrawer.tsx` (Update) — `useState`, `useRef` 임포트 추가, 리사이즈 핸들 UI 및 드래그 이벤트 핸들러 추가, 높이를 동적 `style`로 변경


[x] Shell 모양·디자인·레이아웃을 VSCode처럼 변경 + Maximize Panel Size 추가 + 터미널 탭을 오른쪽 사이드바로 이동 + PiP 모드 제거

- 난이도: **medium**

- 기능 추가 방법:
  1. (프론트엔드 — BottomDrawer) 탭바 우측에 Maximize/Restore 토글 버튼 추가. `isMaximized` state로 패널 높이를 `100%`(전체화면) ↔ 이전 높이로 전환
  2. (프론트엔드 — TerminalPanel) 기존 상단 헤더바(탭 가로 배열) 레이아웃을 제거하고, flex-row 구조로 변경: 좌측에 터미널 인스턴스(메인 콘텐츠), 우측에 세션 목록 사이드바 배치
  3. (프론트엔드 — TerminalPanel 우측 사이드바) 상단에 상태 표시(Connected/Connecting 등), 새 터미널 추가(+) 버튼, 새 창 분리 버튼을 배치하고, 하단에 세션 탭을 세로 리스트로 표시 (아이콘 + 이름 + hover 시 닫기 버튼)
  4. (프론트엔드 — TerminalPanel) `isPip`, `onTogglePip` 관련 props 및 PiP UI 로직을 완전 제거

- 수정, 삭제, 생성된 파일들:
  - `src/features/code/BottomDrawer.tsx` (Update) — Maximize/Restore 토글 버튼 및 `isMaximized` state 추가, SVG 아이콘 인라인 렌더링
  - `src/features/terminal/TerminalPanel.tsx` (Update) — 전체 레이아웃을 flex-row(좌: 터미널, 우: 탭 사이드바)로 교체, 상단 헤더바 제거, PiP 관련 코드 제거