---
schema_version: 1
type: feature
slug: docs-wiki-viewer
status: done
difficulty: medium
created_at: "2026-06-19T19:24:33+09:00"
updated_at: "2026-06-19T19:24:33+09:00"
session_id: "20260619-m01"
agent:
  id: claude-code
  version: "opus-4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/commands/docs.rs
    op: create
    bytes_added: 13149
    bytes_removed: 0
  - path: src-tauri/src/lib.rs
    op: update
    bytes_added: 212
    bytes_removed: 0
  - path: src-tauri/src/commands/mod.rs
    op: update
    bytes_added: 31
    bytes_removed: 0
  - path: src-tauri/Cargo.toml
    op: update
    bytes_added: 109
    bytes_removed: 0
  - path: src/features/docs/DocsScreenV2.tsx
    op: create
    bytes_added: 9851
    bytes_removed: 0
  - path: src/features/docs/resolveDocsPath.ts
    op: create
    bytes_added: 2980
    bytes_removed: 0
  - path: src/features/docs/DocsTree.tsx
    op: create
    bytes_added: 2702
    bytes_removed: 0
  - path: src/features/docs/DocsImage.tsx
    op: create
    bytes_added: 1813
    bytes_removed: 0
  - path: src/features/docs/docs.css
    op: create
    bytes_added: 4060
    bytes_removed: 0
  - path: src/components/Markdown.tsx
    op: update
    bytes_added: 775
    bytes_removed: 107
  - path: src/components/Sidebar.tsx
    op: update
    bytes_added: 63
    bytes_removed: 0
  - path: src/components/Icons.tsx
    op: update
    bytes_added: 58
    bytes_removed: 0
  - path: src/contexts/WorkspaceContext.tsx
    op: update
    bytes_added: 190
    bytes_removed: 0
  - path: src/features/shell/ShellV2.tsx
    op: update
    bytes_added: 142
    bytes_removed: 0
  - path: src/__tests__/docs_resolve.test.ts
    op: create
    bytes_added: 2844
    bytes_removed: 0
related: []
tags: ["docs", "wiki", "ui_v2", "markdown", "read-only", "dogfooding-finding"]
---

[x] 프로젝트 루트 `./docs` 폴더를 읽기 전용 위키(문서) 화면으로

## 추가 기능

프로젝트 루트의 `docs/` 폴더를 8개 화면에 이어 9번째 화면 "문서"로 추가. `.oculpm` 저널과 동일한 패턴(projectId→DB→root, `secure_join`, react-markdown 렌더)을 재사용하되, SQLite 캐시 없이 요청마다 디스크에서 직접 읽는다(docs 는 SSOT=디스크, 변경 드묾). 이번 라운드는 **읽기 전용 뷰어**까지 — 편집기는 후속.

1. **백엔드 `commands/docs.rs`(신규) + 커맨드 3종.** `docs_tree`(프로젝트 `docs/` 를 재귀 워크 → 마크다운 파일·마크다운을 품은 폴더만, 심볼릭링크·숨김·빈 폴더 제외. README/index 를 각 단계 최상단 고정 + 숫자 인지 자연정렬로 `00-`/`01-` 컨벤션 그대로), `docs_read`(단일 문서 본문), `docs_asset`(이미지 바이트→base64+MIME, 16MB 상한). 모든 읽기는 `secure_docs_join` 으로 `root/docs` 밖 탈출 차단. `base64` 의존성 추가. lib.rs 의 `use`+`collect_commands!` 양쪽 등록 후 `cargo test` 로 bindings.ts 재생성.
2. **공유 `<Markdown>` 확장(가산적).** 선택적 `components`(빌트인 `pre` 위에 머지)·`urlTransform` props 추가 — 기존 호출부 무영향. 문서 뷰어가 `a`/`img` 를 주입해 링크·이미지를 가로챈다.
3. **프런트 `features/docs/` 화면.** 좌 트리(`DocsTree`) + 우 마크다운 2-pane. 상대 링크는 위키 내 이동, 외부 링크(`scheme:`/`//`)는 시스템 브라우저(`open_url`), `#앵커`는 본문 스크롤, 이미지는 `DocsImage`(`docs_asset`→data URI, 메모리 캐시·스켈레톤·실패 폴백). 경로 해석은 순수 함수 `resolveDocsPath.ts`(현재 문서 dir 기준 `.`/`..` 정규화, 퍼센트 디코딩, href 분류)로 분리·단위테스트.
4. **배선.** `UiV2View` 에 `"docs"` 추가 + 마지막 본 문서 경로 `docsActivePath` 영속(WorkspaceContext 단일 키 경유 — 직접 localStorage 금지 준수). 사이드바 도구 그룹에 "문서" 슬롯(lucide `BookText` SVG 아이콘 — 이모지 금지). `docs/` 부재 시 빈 상태 안내.

## 동작 흐름

화면 진입 → `commands.docsTree(projectId)`. `exists=false`(폴더 없음)면 안내 빈 상태. 트리 로드 후 초기 선택은 `현재 선택(유효 시)` → `영속 docsActivePath` → `첫 문서(README 최상단)` 순. 선택 변경 시 `docs_read` 로 본문 로드 + 조상 폴더 자동 펼침 + 본문 스크롤 최상단 + 경로 영속. 본문 내 링크 클릭: `classifyHref` 가 external/anchor/relative 로 분기 — relative 이면서 트리에 존재하는 `.md` 면 `setSelected` 로 인플레이스 이동, 없으면 토스트 경고. 이미지 `src` 도 같은 분류를 거쳐 상대경로만 `DocsImage` 로 백엔드 로드.

## 검증

- 백엔드 단위테스트 5종(`docs::tests`): 마크다운 필터·빈 폴더 가지치기, 루트기준 상대경로, README 고정+자연 숫자정렬, `secure_docs_join` 트래버설 차단(`docs/../secret`·`../../etc/passwd`), MIME 추정 — 전부 통과.
- 프런트 단위테스트 11종(`docs_resolve.test.ts`): `resolveRelative`(`.`/`..`/선행슬래시/퍼센트디코딩), `classifyHref`(external/anchor/relative+해시 분리), `isMarkdownPath`/`displayName` — 전부 통과.
- 게이트 직접 확인: `pnpm typecheck`=0, `pnpm test` 15파일 125 통과, `pnpm lint`(스토리지 규율) 통과, `pnpm build` 성공, `cargo test` 285 통과(0 실패). 아직 `pnpm tauri dev` 실앱 수동확인은 미실시(사용자 검증 대기).

## 메모

- v1 은 docs 폴더명 `docs` 고정. 비표준 이름(`documentation`/`wiki`)·watcher 연동 자동 새로고침·`[[wikilink]]`·문서 내 검색·저널/플래너 교차링크·AI 컨텍스트 주입은 후속 단계. 앵커 스크롤은 heading id 가 없으면(현재 rehype-slug 미적용) no-op — best-effort.
- 다음 라운드 예고: **문서 편집기**(저널 `updateEntryBody` 패턴 참고, 디스크 쓰기·충돌 고려).
