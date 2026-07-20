---
schema_version: 1
type: bug
slug: rules-managed-block-and-review-fixes
status: done
difficulty: high
created_at: "2026-07-20T19:01:00+09:00"
session_id: "manual-20260720-184859"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/oculpm/rules.rs
    op: update
  - path: src-tauri/src/oculpm/rule_promotion.rs
    op: update
  - path: src-tauri/src/notion.rs
    op: update
  - path: src-tauri/src/commands/notion.rs
    op: update
  - path: src/features/retro/RetroScreenV2.tsx
    op: update
  - path: plugin/oculpm/hooks/hooks.json
    op: update
  - path: src/__tests__/rule_promotion_v2.test.tsx
    op: update
  - path: src/__tests__/notion_export_v2.test.tsx
    op: update
related:
  - 20260720/Features_to_add/1734_feature_rules-hub-tabs-and-cursor-mirror.md
  - 20260720/Features_to_add/1746_feature_rule-promotion-loop.md
  - 20260720/Features_to_add/1825_feature_notion-export-v1.md
  - 20260720/Bugs/1848_bug_gitignore-anchor-and-block-drift.md
tags: ["code-review", "data-loss", "security", "PR-CI3", "PR-CI4", "PR-CI7", "PR-CI8"]
---

[x] PR-CI3~CI8 적대적 리뷰 지적 5건 수정 (HIGH 1 · MED 3 · LOW 1)

## 발생 원인

다른 세션이 완료한 PR-CI3~CI8 에 대해 적대적 코드 리뷰를 돌려 확인된 결함들. 각 건은
코드를 직접 읽어 재현 경로를 확인했다.

**HIGH — 규칙 허브가 앱 소유 관리 블록을 파괴.** `.claude/CLAUDE.md` 는 (a) `claude-code`
어댑터가 `WriteMode::ManagedBlock` 으로 **매 sync 마다 블록을 재작성**하는 대상이면서
(b) 규칙 허브의 편집 슬롯(`PROJECT_CLAUDE_MD_SLOTS`)이다. `rules::save` 는 관리 블록을
전혀 모르고 전체 파일을 덮어썼다. 결과 ① 사용자가 블록 *안에* 규칙을 쓰고 저장하면 다음
프로젝트 열기(`sync_agents` 는 무조건 실행, `auto_sync_adapters` 기본 true)에 **조용히
소실** ② 편집 중 sync 가 끼면 낡은 스냅샷 저장이 어댑터 갱신을 **되돌림** ③ 짝 안 맞는
마커를 저장할 수 있어 어댑터를 영구 에러 상태로 만들 수 있었다 (claude_hooks·mcp::register
가 지키는 "해석 불가 대상엔 쓰지 않는다" 계약이 여기만 빠져 있었다).

**MED — Notion 내보내기에 redact 부재.** `notion_export` 는 임의 문자열을 외부로 보내는
유일한 경로인데 마스킹 없이 POST 했다. 현 호출자는 이미 마스킹된 캐시 파생물만 넘겨
실유출은 아니었으나, 커맨드 자체에 보증이 없어 다음 호출자가 원본을 넘기면 새는 구조.

**MED — 넓은 규칙이 후보를 억제하지 못함.** `rule_covers_area` 가 `glob.strip_prefix(area)`
한 방향만 봐서, `paths: ["src/**"]` 같이 **영역보다 넓은** 규칙이 `src/api` 후보를 억제하지
못했다 → 같은 후보가 영구 재제안.

**MED — Notion URL 프래그먼트 오인.** `normalize_page_id` 가 `?` 만 떼고 `#` 는 안 떼서
`…/Retros-<페이지id>#<블록id>` 입력 시 **블록 id** 를 부모로 저장 → 이후 모든 내보내기가
원인 불명 4xx.

**LOW — 플러그인 훅 EPIPE.** 가드 `[ -d .oculpm ] && … || true` 가 단락 평가라 비추적
프로젝트에선 `cat` 이 안 돌아 stdin 이 소비되지 않는다 (세션당 3회 EPIPE).

## 해결 방법

1. `rules::save` 에 `guard_managed_block` 추가 — 저장 내용의 마커 짝이 안 맞으면 무조건
   거부하고, 디스크에 관리 블록이 있으면 **블록 안이 바이트 동일**할 때만 저장을 허용한다
   (블록 밖 편집은 자유). 거부 메시지는 `.oculpm/agents/_template.md` 로 안내.
2. `notion_export` 에 `project_id` 인자 추가 → 프로젝트 redact 패턴으로 제목·본문 재마스킹
   (rule_promotion 의 LLM 전송 규율과 동일). 프런트 호출부·테스트 계약 동반 갱신.
3. `rule_covers_area` 를 양방향으로 — 와일드카드 앞 세그먼트를 base 로 잡아 디렉터리
   경계(`/`)로 비교. `src/apiX/**` 가 `src/api` 를 덮지 않는 성질은 유지.
4. `normalize_page_id` 가 `#` → `?` 순으로 먼저 제거.
5. 훅 커맨드를 `if …; then …; else cat > /dev/null; fi` 로 — 가드 실패에도 stdin 소비.
6. 리뷰가 지적한 "실패할 수 없는 테스트"(rule_promotion_v2 :171) 를 목록 컨테이너 단언으로
   교체 — 저장 후 후보가 실제로 사라지는지(savedKeys 필터)를 처음으로 검증하게 됐다.

## 검증

- 신규 Rust 테스트: 관리 블록 보호 2(블록 밖 편집 허용 / 블록 안 편집·블록 삭제 거부 +
  디스크 불변 / 고아 마커 거부 시 파일 미생성), 억제 양방향 6 assertion, Notion 프래그먼트 2.
  `cargo test` **384** 그린 (수정 전 382 + 2).
- 프런트: `notion_export` 계약 갱신 + #11 테스트 실질화. vitest **176/28파일** 그린.
- typecheck / lint / build exit 0.
- 내 수정의 허점을 내가 쓴 테스트가 잡음 — `src/**/*.ts` 처럼 와일드카드가 중간에 있는
  glob 에서 첫 구현(접미 trim)이 실패 → 세그먼트 기반으로 재작성.

## 메모

**미수정(백로그 등재 예정)**: ① Cursor 미러 경로 평탄화 충돌 시 안내 문구가 사실과 다름
(데이터 손실은 없음 — write_mirror 가 거부) ② `sync_mirrors` 가 fixpoint 가 아니라 규칙
이름 변경 후 1회 sync 로는 미러가 사라짐(2회째 복구) ③ `gather_evidence` 가 일지 누락을
빈 발췌로 삼킴 ④ `split_frontmatter` 가 선두 `---` 수평선을 frontmatter 로 오인(미러 본문
유실, 원본 무사) ⑤ 읽기 경로에 크기 상한 부재.

리뷰가 **깨끗하다고 확인한 영역**: Notion 토큰 취급(키체인 전용·로그 무유출·헤더 전송),
PR-CI4 제안→승인 구조(자동 적용 경로 부재), PR-CI6 소프트 게이트, 규칙 경로 탈출 방어,
저장소 규율(localStorage 무위반), CI5 중복 설치 가드.
