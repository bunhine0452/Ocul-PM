---
schema_version: 1
type: feature
slug: code-map-readability-redesign
status: done
difficulty: high
created_at: "2026-06-17T20:12:54+09:00"
updated_at: "2026-06-17T20:12:54+09:00"
session_id: "20260617-001"
agent:
  id: claude-code
  version: "opus-4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src/features/graph/GraphScreenV2.tsx
    op: update
    bytes_added: 12200
    bytes_removed: 14100
  - path: src/features/graph/FileNode.tsx
    op: update
    bytes_added: 3754
    bytes_removed: 1560
  - path: src/features/graph/layout.ts
    op: update
    bytes_added: 1732
    bytes_removed: 416
  - path: src/features/graph/GraphInspector.tsx
    op: create
    bytes_added: 18466
    bytes_removed: 0
  - path: src/features/graph/types.ts
    op: create
    bytes_added: 1932
    bytes_removed: 0
  - path: src/features/shell/ShellV2.tsx
    op: update
    bytes_added: 79
    bytes_removed: 53
related: []
tags: ["graph", "code-map", "ui_v2", "readability", "dogfooding-finding"]
---

[x] 코드 맵 가독성 재설계 — 중요도 크기·포커스·LOD + 영향/역할 중심 인스펙터

## 추가 기능

사용자 피드백 3건(① 그래프가 난잡함 ② 파일 클릭 정보가 유저를 고려 안 함 ③ 대규모 프로젝트가 안 보임)에 대응.

1. **중요도 기반 노드 크기** — `layout.sizeForDegree(deg)` 5단계 tier. 연결 수(import+imported-by)가 큰 허브가 크게, 말단이 작게 렌더. dagre/force 레이아웃이 이 크기를 인지(겹침 방지: dagre `setNode(w/h)`, force `forceCollide` 노드별 반경).
2. **LOD(레벨 오브 디테일)** — `onMove` 의 줌값을 far/mid/near 버킷으로. far(줌아웃)에선 카드 대신 라벨 핀(점+이름)만 그려 500노드도 글자가 안 깨짐. mid=스트라이프+이름, near=풀카드(서브라인·언어·←in/out→).
3. **포커스 모드(기본 ON)** — 노드 선택 시 이웃(1-hop)만 남기고 나머지를 *숨김*(기존엔 흐리게만). `onInit` 으로 잡은 React Flow 인스턴스의 `fitView({nodes})` 로 이웃 서브그래프에 카메라를 맞춰 흩어진 이웃이 화면 밖으로 안 나가게. 툴바 토글 + "포커스 해제" 패널 버튼.
4. **인스펙터 전면 재설계(`GraphInspector.tsx`)** — 개발자 raw 덤프 → PM 관점. 상단부터: **역할 배지**(허브/핵심 모듈/진입점·조립/기반 모듈/연결, in-out degree + p85 hubThreshold 로 산출) → **변경 영향 헤드라인**("이 파일을 바꾸면 N개 파일에 영향", `get_change_impact` 역BFS, 폴더는 소속 파일 path union) → **한눈 지표**(의존·의존받음·심볼) → **액션**(에디터에서 열기 `open_in_editor`, 코드 미리보기 앞40줄) → 관계(타입칩+클릭이동) → 심볼(종류별 그룹, 행 클릭 시 `read_file_range` 인라인 펼침) → 호출 관계.

## 동작 흐름

`ShellV2` 가 `projectRoot` 를 `GraphScreenV2` 에 새로 전달(에디터 열기/미리보기에 필요). `built` 메모가 노드 degree → `sizes` 맵 계산 후 레이아웃에 주입, `hubThreshold`(p85·최소4) 별도 메모. 선택 시 `connected`(이웃집합) → 포커스면 `displayNodes`/`displayEdges` 를 이웃으로 컬링(위치는 유지=공간 기억 보존), 아니면 기존 dim. `neighbors` 메모가 엣지를 노드별로 접어 타입 배열로 인스펙터에 공급. 공용 형/경로헬퍼/EDGE_META 는 `types.ts` 로 추출해 화면·인스펙터가 공유.

## 검증

- `pnpm typecheck` exit 0.
- `pnpm test` 114 passed / 3 todo (그래프 전용 테스트는 없음 — 회귀 없음 확인).
- `pnpm lint`(no-localStorage) 통과.
- `pnpm build`(tsc && vite build) 성공, GraphScreenV2 lazy 청크 348kB 정상 emit.
- 런타임 시각 검증(앱에서 실제 그래프 확인)은 미수행 — `verified_by_user: false`.

## 메모

- **부수 수정**: 기존 커밋된 `GraphScreenV2.tsx` 블롭에 stray NUL 바이트 2개가 있어 git 이 binary 로 취급(→ 그 파일의 entry_diffs/변경 diff 캡처가 깨졌을 것). 전면 재작성으로 NUL 0 의 깨끗한 UTF-8 로 교체되어 해소.
- React Flow `fitView({nodes})` 는 culling 직후 store 반영 레이스를 피하려 30ms 디퍼. 포커스 중엔 LOD 를 강제 near 로 고정(이웃 소수라 항상 풀카드).
- 후속 후보: 폴더 드릴다운(상위폴더 롤업→더블클릭 펼침), 레이아웃 워커(1000+ 노드 메인스레드 블록 방지), 인스펙터 "AI 설명 생성"(03-ui-screen-spec §7).
