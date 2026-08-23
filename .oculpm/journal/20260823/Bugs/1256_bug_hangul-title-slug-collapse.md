---
schema_version: 1
type: bug
slug: hangul-title-slug-collapse
status: done
difficulty: low
created_at: "2026-08-23T12:56:00+09:00"
session_id: "manual-20260823-125600"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/frontmatter.rs"
    op: update
  - path: "src-tauri/src/oculpm/discussion/project.rs"
    op: update
  - path: "src-tauri/src/oculpm/planner/project.rs"
    op: update
related:
  - ".oculpm/journal/20260823/Chores/1215_chore_release-v2-15-0.md"
tags: [slug, i18n, discussion, planner, frontmatter, dogfooding]
---

[x] 한글 제목의 논의·플랜이 전부 같은 이름으로 떨어지던 것 — 「사용자가 찾은 버그들」이 `discussion/`

## 발생 원인

추적 누락된 논의 하나(`.oculpm/discussion/discussion/`)를 커밋하다 폴더 이름이
눈에 걸렸다. 제목은 「사용자가 찾은 버그들」인데 폴더는 `discussion`.

`slug_for` 가 ASCII 만 남기고 있었다. 사본이 **둘**이고, 문서 주석이 증상을 그대로
자백하고 있었다 — "falls back to `"discussion"` when nothing ASCII remains
(e.g. a purely Korean title)".

```rust
if c.is_ascii_alphanumeric() { … }        // 한글은 여기서 전부 탈락
…
if s.is_empty() { "discussion".to_string() }   // planner 쪽은 "plan"
```

한글만 있는 제목은 남는 글자가 하나도 없어 **상수 폴백**으로 간다. 논의·플랜은
파일/폴더 **이름이 곧 정체성**이라, 한글로 만드는 항목은 전부 `discussion`,
`discussion-2`, `discussion-3`… (플랜은 `plan.md`, `plan-2.md`…) 이 된다.
목록에서 무엇이 무엇인지 알 수 없다.

### 왜 일지에서는 안 났나 — 규약이 반쪽만 움직였다

`.oculpm/` 안에 slug 를 만드는 자리가 **셋**인데 v1.19.0 의 한글 유니코드화가
하나에만 닿았다.

| 자리 | 함수 | 상태 |
|---|---|---|
| frontmatter `slug:` 필드 | `frontmatter::normalize_slug` | **v1.19.0 에서 유니코드화됨** |
| 논의 폴더 이름 | `discussion::project::slug_for` | ASCII (이번 버그) |
| 플랜 파일 이름 | `planner::project::slug_for` | ASCII (이번 버그) |
| 일지 파일 이름 | `journal_draft::sanitize_slug` | ASCII — **증상 없음** |

일지가 멀쩡했던 것은 규칙이 좋아서가 아니라 **파일명이 시각 접두사로 이미
유일하기 때문**이다(`1146_bug_….md`). 폴백도 세션 기반이라 상수가 아니다.
논의·플랜만 이름이 유일성을 책임진다.

그리고 `sanitize_slug` 의 주석은 아직 `비 ASCII (한글 등) 는 버린다 —
frontmatter slug 규약` 이라고 적고 있다. **그 규약이 v1.19.0 에 움직였는데
주석과 두 사본이 따라가지 않았다.** 사본이 셋으로 갈라져 있던 것이 드리프트의
직접 원인이다.

## 해결 방법

구현을 **한 곳으로 합쳤다** — `frontmatter::slug_from_title(title, fallback)`.
`normalize_slug` 바로 옆에 두어 다음에 규약이 움직일 때 둘이 같이 눈에 들어오게
했다. 두 `slug_for` 는 폴백 문자열만 달리 넘기는 한 줄이 됐다.

동작:

- 유니코드 alphanumeric 을 살린다 → `사용자가-찾은-버그들`
- 섞인 제목도 양쪽 다 산다 → `버그 FIX 라운드` → `버그-fix-라운드`
  (ASCII 만 남기던 옛 규칙은 한글 절반을 버렸다)
- 폴백은 **정말로 남는 글자가 없을 때만** (구두점만 있는 제목)
- 60자 캡 — 경로 길이 방어. 자른 자리가 하이픈이어도 끝에 남기지 않는다

**일지 파일명(`sanitize_slug`)은 건드리지 않았다.** 증상이 없고, 시각 접두사로
유일성이 이미 보장되며, 바꾸면 기존 일지 파일명 규칙과 새 것이 갈린다. 판단이
다르므로 범위 밖으로 뒀다.

## 검증

- 새 단위 테스트 4개 — 한글 보존 · **기존 ASCII 제목의 결과가 그대로인지**(회귀
  방어: 이미 있는 폴더 이름이 흔들리면 안 된다) · 폴백은 정말 빈 경우에만 ·
  60자 캡과 앞뒤 하이픈 없음.
- **파일시스템 왕복 테스트 2개** — 순수 함수 단언으로는 부족하다고 봤다. 한글
  이름으로 실제 폴더를 만들어 `read_dir` 로 같은 이름이 돌아오는지, `id` 로
  `find_discussion_path` 가 찾는지, `load_all_discussions` 투영이 통과하는지
  확인했다 (APFS 는 이름을 정규화해 비교하므로 만든 이름과 읽은 이름이 다를 수
  있다 — 실제로는 문제없었다).
- 게이트 5종 — `cargo test` **714** 그린(+6) / `pnpm typecheck` · `test`(100파일
  1149건) · `lint` · `build` 각각 exit 0.
- `bindings.ts` 변화 없음 (커맨드 시그니처가 아니라 내부 헬퍼).

## 메모

**기존 폴더·파일은 그대로 둔다.** 조회는 폴더 이름이 아니라 frontmatter `id` 로
하고(`find_discussion_path`), 플랜도 `find_plan_path` 가 같다. 이름을 바꾸면
기존 일지의 `related` 경로 링크만 깨진다 — 이름은 새로 만드는 것부터 적용된다.
이미 있는 `.oculpm/discussion/discussion/` 도 그대로 뒀다.

남은 불일치 — `journal_draft::sanitize_slug` 의 주석이 아직 옛 규약을 인용한다.
증상이 없어 이번엔 안 건드렸지만, 다음에 slug 를 만질 사람이 같은 함정에 빠질
자리다.
