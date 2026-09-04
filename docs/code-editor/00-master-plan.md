# 코드 화면 — 인앱 코드 뷰어·에디터 마스터 플랜

> 2026-08-16. 이 문서가 이 서브시스템의 SSOT 다.

## 1. 왜 만드는가 (그리고 왜 "IDE" 가 아닌가)

Ocul-PM 의 화면들(검색·코드맵·변경 diff·일지)은 전부 **코드를 가리키기만** 한다 —
실제로 열어 보거나 고치려면 외부 에디터로 나가야 한다. 가벼운 확인/수정까지
앱을 떠나는 것은 컨텍스트 낭비다.

그렇다고 풀 IDE(LSP·디버깅·멀티탭·리팩토링)를 흉내내지 않는다. 제품 정체성은
PM/기록이고, 무거운 편집이 필요한 순간은 이미 있는 외부 에디터 점프
(`open_in_editor`, `%path`/`%line` 템플릿)가 정답이다. 이 화면의 스코프는:

**"컨텍스트(검색·코드맵·diff)에서 바로 열어 보고, 가볍게 고치고, 저장하는 에디터"**

## 2. 에디터 선택 — CodeMirror 6

| | CodeMirror 6 | Monaco |
|---|---|---|
| 번들 | 모듈식 수백 KB | 수 MB + Vite 워커 설정 |
| WKWebView | 웹뷰 대상 설계, 궁합 좋음 | 워커·리사이즈 이슈 잦음 |
| 언어 | rust/ts/py/go/md/json/… 개별 패키지 | TS/JS 인텔리센스만 강점 |

Monaco 의 유일한 강점(TS 인텔리센스)은 Rust 백엔드 코드베이스엔 무용하고,
그 수준이 필요하면 외부 에디터로 점프한다. CM6 는 lazy 청크에 얹기도 가볍다.
하이라이트는 CM 의 Lezer 문법을 쓴다 (백엔드 tree-sitter 재활용은 IPC 왕복·
증분 파싱 재구현 비용 대비 이득이 없다).

## 3. 아키텍처

### 3.1 백엔드 — `src-tauri/src/commands/code.rs`

| 커맨드 | 역할 |
|---|---|
| `code_tree(project_id)` | `ignore::WalkBuilder`(gitignore·hidden 존중)로 파일 트리. 폴더 우선 + 자연 정렬(docs.rs 의 `natural_cmp` 재사용). 20,000 파일 상한 → `truncated` 플래그 |
| `code_read(project_id, rel_path)` | 본문 + **blake3 해시**(충돌 감지 토큰) + 바이너리 판정(선두 8KB NUL) + 2MB 상한(`too_large`) |
| `code_write(project_id, rel_path, content, base_hash)` | 저장 전 디스크 해시 대조 — 다르면 `Conflict{disk_hash}` 반환(덮어쓰지 않음). 같은 디렉터리 임시파일 + rename 원자 저장. 기존 파일만 허용(신규 생성은 스코프 밖) |

- 모든 경로는 기존 `secure_join`(project.rs) 경유 — 탈출·절대경로 방어 재사용.
- SSOT 는 디스크. 캐시 없음 (docs 뷰어와 같은 원칙). 저장 후 watcher 가
  자동으로 증분 인덱싱하므로 검색/코드맵 갱신은 공짜.

### 3.2 프런트 — `src/features/code/`

```
CodeScreenV2.tsx   화면 오케스트레이션 (트리 로드·선택·버퍼·저장·충돌·watcher)
CodeTree.tsx       좌측 트리 (필터 입력 + dirty 배지, docs-tree 패턴)
CodeEditor.tsx     CodeMirror 마운트 래퍼 (언어·테마·⌘S·라인 점프)
codeLang.ts        확장자 → 언어 매핑 (순수, 테스트)
codeBuffers.ts     모듈 스코프 편집 버퍼 캐시 (화면 이탈에도 미저장 편집 보존)
treeUtils.ts       트리 필터·조상 경로 (순수, 테스트)
code.css           스타일 (ui_v2 토큰만)
```

- **11번째 화면.** (설계 당시 "13번째" 라고 적었으나 `navRegistry.ts` 순서로는
  11번째다 — ⌘번호가 붙는 앞 10개 바로 다음.) `navRegistry` 맨 끝(⌘번호 불변), `UiV2View` union +
  `KNOWN_VIEWS` + ShellV2 라우터 lazy 청크. 영속 상태는 `codeActivePath` 하나
  (additive 필드 — 스키마 bump 불필요).
- **편집 버퍼는 모듈 스코프 캐시** (`codeBuffers.ts`, 프로젝트+경로 키, 상한
  20개 LRU). 파일 전환·화면 이탈로 컴포넌트가 언마운트돼도 미저장 편집이
  살아남는다. 확인 다이얼로그로 전환을 막는 것보다 낫다.
- **충돌 처리 2중**: ① 저장 시 base_hash 대조(백엔드) ② 열려 있는 파일의
  watcher 이벤트(`oculpmFileChanged`) 수신 시 — dirty 아니면 조용히 리로드,
  dirty 면 재읽기로 해시 대조 후 다르면 충돌 배너(디스크 버전 불러오기 /
  덮어쓰기 저장).
- **테마**: `EditorView.theme` + `HighlightStyle` 이 전부 CSS 변수(`--code-*`,
  code.css 에 light/dark 정의)를 참조 — `data-theme`/`data-preset` 전환이
  리마운트 없이 즉시 반영된다.
- **⌘S 저장**, CM 검색패널(⌘F, 한국어 phrases), 하단 상태줄(Ln·Col·언어·크기),
  바이너리/대용량은 읽기 불가 안내 + "외부 에디터로 열기" CTA.

### 3.3 진입점 통합 (이 화면의 실질 가치)

| 출발지 | 동작 |
|---|---|
| 검색 결과 (텍스트·심볼) | 행 액션 "코드 화면에서 열기" → 해당 라인으로 점프 |
| 코드맵 파일 패널 | "코드 화면에서 열기" 버튼 |
| (후속) diff 파일 헤더 | 현재 버전 열기 |

핸드오프는 ShellV2 로컬 one-shot 상태(`codeTarget: {path, line}`) — journalFocus
와 같은 확립된 패턴. 검색/코드맵엔 옵셔널 prop 으로 내려준다.

## 4. 스코프 밖 (v1)

- LSP(자동완성·정의 이동) — 필요 순간 = 외부 에디터 점프 순간. YAGNI.
- 신규 파일 생성·삭제·이름변경, 멀티탭, diff 인라인 편집(`@codemirror/merge` 후속).
- `.gitignore`/hidden 파일 노출 — v1 은 인덱서와 같은 시야.

> **뒤집힘 (2026-09-04 확인)** — 이 절의 항목이 **전부 출시됐다**. v1 스코프의
> 기록으로만 읽을 것.
> - **LSP** — `src-tauri/src/lsp/` · v2.15.0 (자동완성·진단·호버·정의·이름 바꾸기·
>   코드 액션). 설계는 [`../lsp/00-master-plan.md`](../lsp/00-master-plan.md).
>   그 문서가 다시 "하지 않는 것" 으로 잡았던 **디버거(DAP)** 도 뒤집혀
>   [`../dap/00-master-plan.md`](../dap/00-master-plan.md) 로 출시됐다.
> - **파일 생성·삭제·이름변경** — `code_create` / `code_mkdir` / `code_rename` /
>   `code_delete` (`commands/code.rs`) · v2.16.0. 드래그 이동은 v2.34.0.
> - **멀티탭·좌우 분할** — v2.16.0 (`code_screen_tabs.test.tsx`), 미리보기 탭은 v2.34.0.
> - **diff 인라인 비교** — v2.16.0.
>
> `.gitignore`/hidden 파일도 지금은 트리에 보인다 (`.oculpm/` · `.github/` · `.gitignore`).

## 5. PR 단위

- **PR-CODE0** 백엔드 3 커맨드 + Rust 테스트 + bindings 재생성
- **PR-CODE1** 코드 화면 코어 (트리·에디터·저장·충돌·상태줄·버퍼 캐시)
- **PR-CODE2** 진입점 통합 (검색·코드맵) + i18n
- **PR-CODE3** 프런트 테스트 + 4대 게이트 + 일지
