---
schema_version: 1
type: chore
slug: "feedback-triage-ci-plan"
status: done
difficulty: low
created_at: "2026-08-25T19:42:31+09:00"
session_id: "manual-20260825-194231"
agent:
  id: "claude-code"
  version: "Opus 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: ".oculpm/planner/ci-and-module-boundaries.md"
    op: create
related: []
tags: ["ci", "refactor", "code-review", "planning"]
---

[x] 외부 리뷰 피드백 4건 실측 검증 후 라운드 계획 수립

## 검증한 주장과 결론

**0번 "Cargo.toml 2.19.0인데 공개 최신 릴리스는 v1.8.1, README는 그 사이" — 기각.**
세 버전 파일 모두 2.19.0 이고 `gh release list` 최신도 v2.19.0(2026-08-25 03:10Z),
README.md·README.en.md 최상단 섹션도 `## 🚀 v2.19.0`, landing 에도 v2.19.0 이 10곳.
v1.8.1 태그는 실재하지만 2026-06-15 로 30여 릴리스 전이다. 다섯 면이 모두 동기 상태 —
조치 없음.

**1번 "CI에 테스트가 없다" — 수용, 최우선.** `.github/workflows/` 는 release.yml 하나뿐,
트리거는 `push: tags: v*`, 스텝은 checkout→toolchain→pnpm install→CHANGELOG 추출→
tauri-action 뿐이다. cargo test·pnpm test·typecheck·lint 어느 것도 자동 실행되지 않는다.

**2번 "manager/cache/db가 비대" — 수용하되 수치 조정.** 줄 수는 정확하지만
`#[cfg(test)]` 를 뺀 실코드 기준으로 순위가 뒤집힌다. manager.rs 는 4,514줄 중 45%가
테스트라 실코드는 2,460줄이고, db.rs 는 3,292줄 중 테스트가 107줄뿐이라 실코드
3,184줄로 가장 크다.

**3번 "프런트도 같은 문제" — 부분 수용.** 컴포넌트 지적은 맞지만 초점이 다르다.
AcpConversation.tsx 의 문제는 파일 3,542줄이 아니라 본체 컴포넌트 하나가 182~2,104줄
(1,922줄)이라는 점이고, 나머지 ~20개 하위 컴포넌트는 이미 경계가 서 있다.
bindings.ts 도메인 분할은 불가 — tauri-specta 는 `collect_commands!` 하나에서 단일
파일만 생성하며 분할 출력 옵션이 없다. 262개 커맨드의 실제 신호는 파사드 부재다
(`commands.*` 직접 import 160파일 vs `src/api/` 경유 18파일).

## 계획

[ci-and-module-boundaries](../../../planner/ci-and-module-boundaries.md) 신설.
Phase 0(검증, 완료) → Phase 1 CI 게이트 → Phase 2 백엔드 분할 → Phase 3 프런트 분해
→ Phase 4 커맨드 표면. 2·3번은 동작 무변경 구조 작업이라 Phase 1 의 안전망이 먼저
서야 한다는 순서 의존을 계획에 명시했다.

## 검증

수치는 전부 직접 실측했다 — `wc -l`, `grep -c` 로 줄 수·pub fn 수·`#[cfg(test)]` 시작 줄,
`gh release list`/`git log -1 <tag>` 로 릴리스 시점, `collect_commands!` 파싱으로 262개.
기준선도 확인: `pnpm test` 113파일 1,303케이스 10.6초 전부 통과, `cargo test` exit 0,
실행 후 `git status --porcelain src/lib/bindings.ts` 가 비어 있어 커밋된 bindings 는 최신.
이 라운드에서 코드 변경은 없다(계획 문서만 추가).

## 메모

Phase 1 의 Rust 잡은 macos-latest 로 고정해야 한다 — tauri 의 `macos-private-api`
feature 와 `cfg(target_os = "macos")` 9개 파일 탓에 ubuntu 빌드는 미검증이다.
저장소가 public 이라 macOS 러너 분과금은 없다.
