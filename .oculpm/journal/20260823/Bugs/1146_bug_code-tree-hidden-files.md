---
schema_version: 1
type: bug
slug: code-tree-hidden-files
status: done
difficulty: low
created_at: "2026-08-23T11:46:00+09:00"
session_id: "manual-20260823-114600"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: true
files_touched:
  - path: "src-tauri/src/commands/code.rs"
    op: update
related:
  - ".oculpm/journal/20260821/Features_to_add/1949_feature_lsp-code-intelligence.md"
tags: [code, tree, hidden-files, ignore, dogfooding, ide]
---

[x] 코드 화면 트리에 점 파일이 하나도 안 보이던 것 — `.oculpm/` 도 `.github/` 도 `.gitignore` 도

## 발생 원인

"ocul-pm 앱에 ide 를 넣는 것은 어느정도 진행됐어? (…) 그리고 숨김파일도 전부
보여줘야 해."

`build_code_tree` 의 걸음이 `ignore` 크레이트 기본값 한 줄에 얹혀 있었다.

```rust
ignore::WalkBuilder::new(root)
    .standard_filters(true)   // ← gitignore 와 hidden 을 한꺼번에 켠다
    .build()
```

`standard_filters(true)` 는 이름이 하나지만 축이 여럿이다 — gitignore · git
global · git exclude · **hidden**. 의도한 것은 앞의 셋(빌드 산출물을 트리에서
빼는 것)이었는데 hidden 이 묶여 따라왔다.

그 결과가 이 저장소에서 특히 나쁘다. 코드 화면에서 실제로 열어 고치는 것이
대부분 점 파일이기 때문이다 — `.oculpm/`(이 앱의 SSOT 그 자체) · `.github/`
워크플로 · `.claude-plugin/` · `.gitignore` · `.vscode/`. 트리에 아예 없으니
"파일이 없다" 와 구별할 방법도 없었다. LSP 를 붙여 에디터를 IDE 로 끌어올린
직후라 이 구멍이 더 두드러졌다.

`code_tree` 의 문서 주석은 이 동작을 "인덱서와 같은 시야" 라고 정당화하고
있었지만, 인덱서(의미 검색 대상)와 파일 트리(사람이 여는 것)는 같은 시야를
가질 이유가 없다. 전자는 본문을 임베딩할 값어치로 고르고, 후자는 사용자가
디스크에서 볼 것을 비춘다.

## 해결 방법

숨김 축만 끄고 gitignore 축은 남겼다.

```rust
.standard_filters(true)
.hidden(false)                               // 숨김 필터만 끈다
.filter_entry(|e| e.file_name() != ".git")   // 객체 DB 만 예외
```

두 결정에 근거가 있다.

**gitignore 는 왜 남기나.** 이 축까지 끄면 이 저장소가 114,419 파일이 된다
(`node_modules` 27k + `src-tauri/target` 85k). `MAX_TREE_FILES` 는 20,000
이므로 트리가 통째로 잘려 `truncated` 배지만 남는다 — 숨김을 고치려다 트리
전체를 못 쓰게 만드는 교환이다. 이 축을 여는 것은 폴더를 펼칠 때 한 단계씩
읽는 **지연 로딩 트리**가 전제이고, 그건 별도 작업으로 뗐다.

**`.git` 만은 왜 막나.** 저장소 객체 DB 는 수만 파일인데 사람이 여기서 편집할
것은 하나도 없다. 상한을 이것 하나가 다 먹는다. ripgrep 도 `--hidden` 에 같은
예외를 둔다. 중첩 저장소가 있는 프로젝트를 이미 지원하므로(primary_repo) 깊이와
무관하게 이름으로 막았다.

## 검증

- 새 회귀 테스트 `tree_shows_hidden_files_but_never_dot_git` — `.env`·`.gitignore`
  는 보이고, `.oculpm/` 은 폴더로 서고, 루트 `.git` 과 **중첩** `nested/.git` 은
  둘 다 안 보이고, 숨김을 켜도 gitignore 가 여전히 이긴다(`secret-ignored/`).
- 기존 `tree_nests_and_respects_gitignore` 에서 "`.hidden` 이 안 보인다" 단언을
  뺐다 — 이제 보이는 것이 맞는 동작이라 단언 자체가 뒤집혔다.
- `cargo test` 전량 그린 (lib 705 + 통합 스위트 전부, 실패 0).
- `pnpm typecheck` · `pnpm test`(96파일 1116건) · `pnpm lint` · `pnpm build`
  각각 exit 0.
- 실제 저장소 기준 트리 883 → 1,253 파일. 새로 보이는 최상위 항목:
  `.oculpm` · `.github` · `.vscode` · `.claude-plugin` · `.gitignore`.
- 사용자가 앱에서 육안 확인 (2026-08-23). 트리는 기본 접힘이라 `.oculpm` 이
  폴더 하나로 서지, 수백 건이 펼쳐지지는 않는다.

## 메모

`.claude/` 와 `.env` 는 이 저장소 `.gitignore` 에 걸려 **여전히 안 보인다**.
숨김이 아니라 gitignore 축이라 이번 변경의 사정거리 밖이다 — 위의 지연 로딩
트리 작업에서 함께 열린다.

`code_tree` 의 문서 주석에서 "인덱서와 같은 시야" 문구를 걷어내고 왜 다른지를
적어 뒀다. 다음에 이 줄을 읽는 쪽이 같은 이유로 되돌리지 않도록.
