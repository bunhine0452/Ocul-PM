---
schema_version: 1
type: feature
slug: lazy-code-tree
status: done
difficulty: medium
created_at: "2026-08-23T12:35:00+09:00"
session_id: "manual-20260823-123500"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/code.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/features/code/CodeTree.tsx"
    op: update
  - path: "src/features/code/CodeScreenV2.tsx"
    op: update
  - path: "src/features/code/treeUtils.ts"
    op: update
  - path: "src/features/code/code.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
  - path: "src/__tests__/code_dir_map.test.ts"
    op: create
  - path: "src/__tests__/code_tree_lazy.test.tsx"
    op: create
  - path: "src/__tests__/code_screen.test.tsx"
    op: update
related:
  - ".oculpm/journal/20260823/Bugs/1146_bug_code-tree-hidden-files.md"
tags: [code, tree, lazy-loading, gitignore, ide, parallel-sessions]
---

[x] 코드 트리를 지연 로딩으로 — `.git` 만 빼고 디스크에 있는 것을 전부 보여준다

## 작업 내용

[1146 일지](../Bugs/1146_bug_code-tree-hidden-files.md)가 숨김 축을 열면서 남긴
숙제. **gitignore 축은 그때 못 열었다** — 열 수가 없었다. `code_tree` 는 한 번에
전부 걷는 구조라 무시를 끄면 이 저장소만 해도 114,419 파일(node_modules 27k +
target 85k)이 되어 `MAX_TREE_FILES` 20,000 에 걸려 **트리가 통째로 잘린다**.

VS Code 탐색기가 무시된 파일을 보여줄 수 있는 것은 폴더를 펼칠 때 **한 단계씩
읽기** 때문이다. 같은 구조로 옮겼다.

### `code_dir` — 한 단계만

`.git` 만 빼고 디스크에 있는 것을 전부 돌려주되, 무시된 항목은 **지우는 대신
`ignored` 로 표시**한다. 비용이 펼친 폴더에만 든다.

무시 여부를 **손으로 판정하지 않은 것**이 이 커밋의 핵심이다. gitignore 는 중첩
`.gitignore` · git exclude · global 이 얽혀 있어, 여기서 다시 판정하기 시작하면
`code_tree`(필터·검색이 쓰는 시야)와 조용히 어긋난다. 대신 같은 걸음에 한 번 더
물었다:

```rust
// max_depth(1) 걸음이 살려 둔 이름의 집합
let kept: HashSet<OsString> = walk(dir).max_depth(1)…collect();
// read_dir 이 본 것 중 거기 없는 것 = 무시된 것
ignored: !kept.contains(&name_os)
```

판정 주체가 하나로 남는다.

심링크는 `DirEntry::metadata()`(따라가지 않음)로 종류를 본다 — 루프와 루트 밖
탈출을 여는 시점의 canonical 가드보다 **앞에서** 한 겹 더 막는다.

### 프런트 — 자식을 노드가 들고 있지 않다

`childrenOf(경로)` 조회로 바꿨다. `undefined` = 아직 안 읽음, `[]` = 읽었고 비었음.
**이 구별이 요점이다** — 없으면 안 읽힌 가지가 그냥 빈 폴더로 읽힌다. 렌더러가
그 자리에 "읽는 중…" 과 "빈 폴더" 를 각각 그린다.

트리를 통째로 들고 자식을 심는 불변 수술 대신 `Map<경로, 항목[]>` 캐시 하나로
끝냈다. 새로고침은 이 캐시도 버린다 — 안 그러면 디스크가 바뀌어도 이미 펼친
가지가 옛 목록을 계속 보여준다.

### 트리 소스가 둘인 것은 의도다

- **평소 탐색** — 지연 캐시. 무시된 것까지 보인다.
- **필터** — 기존 전량 걸음(`code_tree`). 안 읽은 가지의 매치는 지연 로딩으로
  **찾을 수 없다.** gitignore 를 존중하는 전량 걸음을 그대로 남겨 검색에 쓴다.

렌더러는 하나로 유지했다: 필터 결과를 `flattenToDirMap` 이 지연 캐시와 **같은
모양**으로 편다. 소스가 둘이어도 그리는 코드는 하나다.

### 무시된 항목은 숨기지 않고 흐리게

`opacity: .45` + title 로 이유. 디스크에 있는 것은 보이되, 왜 검색·인덱싱에 안
걸리는지가 눈으로 설명된다. 폴더를 펼칠 때의 진행 표시는
`prefers-reduced-motion` 에서 회전을 끈다.

## 검증

- Rust — `cargo test` 708 그린. 새 테스트 3개: 무시된 항목이 **목록에는 있고
  `ignored` 가 서는지** · 한 단계만 읽고 폴더 우선 정렬인지 · 넓은 디렉터리
  절단. `.git` 은 루트도 중첩도 안 나온다.
- 프런트 — 새 스위트 2개(17건). 렌더러가 "읽는 중"과 "빈 폴더"를 구별하는지,
  **접힌 폴더의 자식은 조회조차 하지 않는지**(`childrenOf` 호출 인자로 단언),
  무시된 항목이 숨겨지지 않고 `.ignored` + title 을 받는지.
- 기존 `code_screen.test.tsx` 는 트리가 지연 로딩이 되며 9건이 전부 깨졌다 —
  픽스처 전량 트리에서 해당 단계를 잘라 주는 `code_dir` 목을 더해 복구.
- `pnpm typecheck` · `pnpm lint` · `pnpm build` 각각 exit 0.
- 정직하게: **전체 `pnpm test` 를 깨끗하게 통과시키지 못했다.** 아래 메모 참조.
  인앱 육안 확인도 아직 안 했다.

## 메모

**병렬 세션과 워킹트리를 공유한 상태에서 작업했다.** 다른 Claude Code 세션이
같은 저장소에서 논의(discussion) 기능을 동시에 쓰고 있었고, 그 결과:

- 전체 `pnpm test` 가 실행할 때마다 다른 파일에서 실패했다 (`journal_v2` →
  `discussion_v2`). 각각 **단독으로는 통과**한다 — 상대 세션이 실행 도중 파일을
  쓰는 것이 원인이다. 그래서 전체 스위트 그린을 이 커밋의 근거로 삼지 않고,
  **내 스코프 3파일 17건 + Rust 708 + typecheck/lint/build** 로 대체했다.
- `i18n/ko.ts` · `i18n/en.ts` · `check-no-hardcoded-korean.mjs` 세 파일에 양쪽
  변경이 섞였다. `git add` 로는 상대 WIP 를 쓸어 담는다(2d95df8 전례). 공유
  인덱스를 아예 건드리지 않고 **임시 인덱스**(`GIT_INDEX_FILE`)에 HEAD+내 것만
  담은 blob 을 `update-index --cacheinfo` 로 심어 `commit-tree` 했고,
  `update-ref` 는 옛 HEAD 를 함께 넘겨 CAS 로 걸었다. 커밋 뒤 공유 인덱스가 새
  HEAD 와 어긋나 상대 세션의 `git status` 가 위험하게 보이므로
  `git reset -q HEAD`(워킹트리 불변)로 맞춰 뒀다.

남은 것 — 필터가 여전히 **추적되는 파일만** 검색한다(무시된 파일은 이름으로도
못 찾는다). 지연 로딩과 전량 검색을 어떻게 합칠지는 ide-completion #tree-filter
에서 계속.
