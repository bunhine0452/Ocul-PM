---
schema_version: 1
type: chore
slug: "polish-round-promise-tiers-cadence"
status: done
difficulty: medium
created_at: "2026-10-27T19:31:50+09:00"
session_id: "20261027-002"
agent:
  id: "claude-code"
  version: "Fable 5.1"
  session: "d10a8c2c-116c-4611-b76f-b84aa7c64d3d"
language: "ko"
verified_by_user: false
files_touched:
  - path: "docs/PROMISE.md"
    op: create
  - path: "docs/launch/first-user-observation.md"
    op: create
  - path: "src-tauri/tests/mcp_write_to_cache.rs"
    op: create
  - path: "scripts/bump-version.mjs"
    op: update
  - path: "src/__tests__/bump_version.test.ts"
    op: update
  - path: "docs/RELEASE.md"
    op: update
  - path: "docs/README.md"
    op: update
  - path: "CLAUDE.md"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
  - path: "landing/index.html"
    op: update
  - path: "landing/en/index.html"
    op: update
  - path: "landing/wiki-src/screens.md"
    op: update
  - path: "landing/wiki-src/en/screens.md"
    op: update
related: []
tags:
  - "polish"
  - "docs"
  - "release"
  - "planner"
  - "test"
  - "mcp-tool"
---
[x] 완성도 라운드 — 약속 문서 · 화면 3등급 · 릴리스 리듬 경고 · MCP→캐시 경계 테스트 · 플랜 완료 조건 · 캐시 정리

## 변경 요약

완성도 논의(2026-10-27)의 결론 — 부족한 것은 기능이 아니라 **확인·범위·약속**이다. 10월 릴리스 16(10-24 하루 4) · fix 59 : feat 10 · 플래너 미완 123(육안 확인 대기 28) · 이슈 0 · 14일 방문자 4. 코드를 더 쓰지 않고 「무엇을 하지 않을지」와 「누가 확인하는지」를 바꿨다.

- **약속 문서** `docs/PROMISE.md` — 이 앱이 하는 일 10문장, 약속하지 않는 것, 화면 3등급(핵심 Today·일지·변경·플래너 / 뷰어 검색·논의·브랜치·스킬 / 보류=베타 터미널·편집기·Claude Code·Codex·AI 패널), 약속마다 지키는 장치. README ko/en 「한 왕복」 위에 약속 블록 + 화면 구성에 등급 태그, 랜딩 ko/en 왕복 섹션에 「약속은 이 왕복이 전부」 + 콘솔·⌘J 터미널에 베타 배지, 위키 screens ko/en 등급 문단(build.mjs 재생성), docs/README 색인 등재.
- **CLAUDE.md** 범위 동결 아래 Screen tiers 규칙 — 보류 등급은 결함 수정만, 다음 분기 fix 상위면 걷기 후보.
- **릴리스 리듬** `docs/RELEASE.md` §0-2 — 패치 자유 · 마이너 2주 1회 · 마이너 전날 확인 날(eyes 0) · 하루 둘째 릴리스 금지. `bump-version.mjs` 가 둘을 알린다(막지 않음): `tagsCutOn` 으로 오늘 이미 태그가 있으면 「같은 날 N번째」, `isMinorBump` 이고 `pendingEyes(readPlans())` 가 0 이 아니면 플랜별 미확인 eyes 건수. 순수 함수 테스트 4건 추가.
- **경계 테스트** `src-tauri/tests/mcp_write_to_cache.rs` — MCP `call_tool("journal_write")` → 실제 `.oculpm/journal` 디스크 → `JournalCache::reindex_full` → `list_entries` 에 같은 slug·제목·종류·에이전트가 서고 `relative_path` 가 응답 path 의 꼬리인지. 지금까지 MCP 쓰기와 캐시 읽기는 따로만 테스트됐다. 첫 실행에서 응답 path 가 `.oculpm/` 기준이 아니라 **프로젝트 루트 기준**(`.oculpm/journal/…`)임을 확인해 단언을 고쳤다.
- **외부 눈** `docs/launch/first-user-observation.md` — 30분 관찰 프로토콜(A 설치 → G 이어하기), 기록 양식, 멈춤 지점 4분류(말·길·고장·기대).
- **플랜 끝 적기** — active 플랜 11개 본문 첫 phase 앞에 `**완료 조건:**` 한 줄(frontmatter 는 손대지 않음). 새 플랜 `polish-round-20261027` 생성; 그 안의 사용자 확인 항목 id 가 `eyes-` 로 시작해 경고 집계에 섞이는 것을 발견, `observe-*`·`sweep-*` 로 바꿨다.
- **캐시 정리** — `pnpm clean:target` 9.7→6.8GB(2.9GB), `node_modules/.vite` 51MB, `~/Library/Caches/ai-pm`(옛 dev 웹뷰 캐시 482MB, 6월 이후 미사용), `pnpm store prune` 1831 패키지. 손대지 않은 것: app-data `ocul-pm.db.bak-v40` 735MB(10-14 마이그레이션 백업 — 사용자 결정), `ocul-pm.db` 837MB(진단 탭 compact 는 앱 안 액션), ort 다운로드 캐시 459MB(매 클린 빌드가 쓴다), cargo registry 2.0GB.

## 검증

- `pnpm typecheck` · `pnpm lint` · `pnpm test`(bump_version 10건 포함) · `pnpm build` 모두 exit 0. `cargo fmt --check` · `cargo clippy --all-targets --locked -D warnings` 통과. `cargo test --test mcp_write_to_cache` 2건 통과. 전체 `cargo test --locked` 는 커밋 전 확인.
- `node -e` 로 `pendingEyes(readPlans(...))` 실측: 5개 플랜 28건 → 랜딩·RELEASE 의 수치와 일치.