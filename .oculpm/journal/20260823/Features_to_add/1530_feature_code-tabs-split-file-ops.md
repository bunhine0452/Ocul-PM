---
schema_version: 1
type: feature
slug: code-tabs-split-file-ops
status: done
difficulty: high
created_at: "2026-08-23T15:30:00+09:00"
session_id: "manual-20260823-153000"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/Cargo.lock"
    op: update
  - path: "src-tauri/src/commands/code.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/features/code/codeTabs.ts"
    op: create
  - path: "src/features/code/fileOps.ts"
    op: create
  - path: "src/features/code/CodePane.tsx"
    op: create
  - path: "src/features/code/CodeTabsBar.tsx"
    op: create
  - path: "src/features/code/CodeContextMenu.tsx"
    op: create
  - path: "src/features/code/CodeScreenV2.tsx"
    op: update
  - path: "src/features/code/CodeTree.tsx"
    op: update
  - path: "src/features/code/codeBuffers.ts"
    op: update
  - path: "src/features/code/code.css"
    op: update
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src/components/Icons.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "scripts/check-no-localstorage.mjs"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
  - path: "src/__tests__/code_tabs.test.ts"
    op: create
  - path: "src/__tests__/code_file_ops.test.ts"
    op: create
  - path: "src/__tests__/code_screen_tabs.test.tsx"
    op: create
  - path: "src/__tests__/code_tree_lazy.test.tsx"
    op: update
related: []
tags: [code-screen, ide, tabs, file-ops]
---

[x] 코드 화면에 탭·좌우 분할·파일 조작 — VS Code 를 끊기 위한 Phase 1

## 추가 기능

- **탭 바** — 파일을 여럿 열어 두고 오간다. 가운데 버튼·×·우클릭 메뉴(닫기 / 다른 탭
  닫기 / 옆에 나란히 열기)를 지원하고, 미저장 파일은 점으로 표시한다.
- **좌우 2분할** — 창 하나가 아니라 **편집 상태 한 벌**을 복제한다. 탭을 창 사이로
  끌어다 놓을 수 있고, 한쪽이 비면 분할이 자동으로 접힌다.
- **탭 상태 영속** — `WorkspaceContext.codeTabs` 경유(직접 localStorage 금지). 되살아나는
  것은 "무엇을 열어 뒀는가" 뿐이고 내용은 디스크에서 다시 읽는다 — 미저장 버퍼를
  영속하지 않는 기존 결정을 그대로 유지.
- **`code_create` / `code_mkdir` / `code_rename` / `code_delete`** — 없던 백엔드 창구.
  삭제는 **영구 삭제가 아니라 OS 휴지통**(`trash` 크레이트)이다.
- **트리 조작 UI** — 우클릭 메뉴 + 인라인 이름 입력칸(다이얼로그가 아니라 그 자리에서),
  삭제 확인 다이얼로그, 폴더/루트로 **드래그 이동**.

## 동작 흐름

**소유권을 다시 그었다.** `CodeScreenV2`(925줄)가 트리·편집·LSP 를 전부 들고 있었는데,
분할은 "에디터를 두 번 그리는 것"이 아니라 버퍼·커서·충돌·LSP 수명을 **두 벌 갖는
것**이라 인덱스로 갈라진 상태가 읽을 수 없게 된다. 그래서 창 하나를 `CodePane` 으로
떼어내고(742줄), 화면은 트리 + 탭 목록 + 파일 조작만 남겼다(741줄).

- `codeTabs.ts` — 탭·분할 상태의 순수 함수. 닫을 때 다음 활성 탭 고르기, 빈 창 접기,
  **경로 재매핑**(이름 바꾸기·삭제가 탭을 따라오게)까지 전부 여기 있다.
- `fileOps.ts` — 경로 계산·이름 검사·드래그 목적지. 백엔드가 최종 권한이고 여기는
  오지 않아도 될 왕복을 막는 층이다.
- `codeBuffers.renameBufferPath` / `dropBuffersUnder` — **미저장 편집이 이동을 따라간다.**
  이게 없으면 파일을 옮기는 순간 편집 중이던 내용이 조용히 사라진다.

**삭제·이름 바꾸기가 열린 탭과 만나는 자리**가 이 작업의 핵심이다.
파일이 사라졌는데 탭이 옛 경로를 들고 있으면 저장도 되읽기도 안 되는 유령이 된다.
삭제는 **누르기 전에** 함께 닫히는 탭과 그중 미저장인 것을 확인 창에 열거하고,
누른 뒤에는 실제로 사라진 편집 건수를 토스트로 다시 말한다.

**백엔드 가드.** 조작은 `code_read` 의 심링크 가드를 그대로 못 쓴다 — 경로 전체를
canonical 로 풀면 대상이 심링크일 때 "루트 안의 링크를 지운다"가 "루트 밖의 원본을
지운다"가 되고, 생성은 아직 없는 경로가 대상이라 canonicalize 자체가 실패한다.
`resolve_for_mutation` 은 **마지막 구간을 풀지 않고** 실존하는 가장 깊은 조상까지만
풀어 루트 안인지 본다. 존재 판정은 `exists()` 가 아니라 `symlink_metadata` 로 한다 —
`exists()` 는 링크를 따라가므로 **깨진 심링크**를 "없음"으로 보고, 그 자리에 파일을
만들면 커널이 링크를 따라가 루트 밖에 쓴다.

**LSP 와의 정합.** 백엔드는 (프로젝트, 파일)로 문서를 하나만 연다. 같은 파일이 양쪽
창에 열리면 didOpen 이 두 번 나가고 한쪽을 닫을 때 아직 보고 있는 쪽까지 닫힌다 —
그래서 같은 파일일 때는 왼쪽 창만 서버를 붙인다(`lspEnabled`).

## 검증

- 게이트 5종 전부 exit 0 을 직접 확인: `pnpm typecheck` · `pnpm test`(103파일 1201개)
  · `pnpm lint` · `pnpm build` · `cd src-tauri && cargo test`(725 + 통합 스위트).
- 새 테스트 39개. 백엔드 10개(심링크 탈출·깨진 링크로의 쓰기·덮어쓰기 거부·폴더를
  자기 안으로 옮기기 차단), `codeTabs` 19개, `fileOps`+버퍼 재키잉 10개,
  화면 통합 10개(탭 전환·분할·생성·이름 바꾸기 시 버퍼 보존·삭제 확인).
- 휴지통 이동 자체는 테스트하지 않는다 — `cargo test` 가 사용자의 휴지통을 더럽히지
  않게. 휴지통을 부르기 전에 서는 가드만 단언한다.

## 메모

- **인앱 육안 확인은 아직**(`verified_by_user: false`). 드래그 이동·우클릭 메뉴 위치·
  분할 폭은 jsdom 이 못 보는 축이다.
- 탭 개수 상한은 두지 않았다. 버퍼 캐시(20)를 넘긴 탭은 누를 때 디스크에서 다시
  읽히고, 미저장이 밀려나는 경우는 기존 경고가 이미 말한다.
- `trash` 크레이트 추가(+7 패키지, Windows 쪽은 타깃 한정). 휴지통이 실패하면
  **영구 삭제로 물러서지 않고** 오류를 그대로 알린다.
