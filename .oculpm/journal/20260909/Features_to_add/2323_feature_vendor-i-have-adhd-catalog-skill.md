---
schema_version: 1
type: feature
slug: "vendor-i-have-adhd-catalog-skill"
status: done
difficulty: low
created_at: "2026-09-09T23:23:31+09:00"
session_id: "20260909-001"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "55cc0fcc-d3a8-4c54-a4d1-ef78c5bd3ef6"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/skills/catalog/i-have-adhd.md"
    op: create
  - path: "src/features/skills/catalog/LICENSE-i-have-adhd"
    op: create
  - path: "src/features/skills/skillsCatalog.ts"
    op: update
  - path: "src/__tests__/skills_catalog.test.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "landing/plugin.html"
    op: update
  - path: "landing/en/plugin.html"
    op: update
related: []
tags:
  - "skills"
  - "catalog"
  - "vendoring"
  - "landing"
  - "mcp-tool"
---
[x] 카탈로그 26번째 — 출처가 셋이 되자 3항식이 새 출처를 ponytail 로 읽고 있었다

## 추가 기능

`ayghri/i-have-adhd` 의 SKILL.md 를 스킬 샵 카탈로그의 26번째 항목으로 벤더링했다. ADHD 독자를 위한 **출력 형태** 규칙 10개(첫 줄이 실행할 명령 · 여러 단계는 번호 · 서두/요약/마무리 인사 삭제 · 목록 5개 상한 · 분 단위 시간 추정)와 예외 6개, 발송 전 체크리스트로 구성된다. MIT · 핀 `24d22f78`.

기존 25종이 전부 **스택**(언어·프레임워크·코드 스타일) 축이었는데, 이건 스택이 아니라 응답 형태를 바꾸는 첫 항목이다.

## 동작 흐름

- `catalog/i-have-adhd.md` — 원문 무수정 + `vendored-from:` 헤더 1줄만 삽입. `catalog/LICENSE-i-have-adhd` 동봉(MIT 재배포 요건, 테스트가 강제).
- 태그는 `["output"]` 하나. `style` 은 ponytail·inherit-legacy-style 이 쓰는 **코드 스타일** 축이라 같은 말로 부르지 않았다. 대신 `detect_stack` 이 언어/프레임워크만 내므로 **추천 목록엔 뜨지 않고** 검색·브라우즈로만 발견된다 — 랜딩 문안에도 그렇게 적었다.
- frontmatter 의 `disable-model-invocation: true` 는 앱이 이미 이해한다 (`skill_frontmatter.rs:64` → `user_invoked` → `classifyDormantSkill` 이 가장 먼저 `user-invoked` 로 가른다). 발동 0회를 「설명 고쳐 쓰기」 후보로 오분류하지 않는다.

## 함께 고친 것 — 출처가 둘일 때만 맞던 코드

`skillUrl()` 이 `source === "ecc" ? "affaan-m/ecc" : "DietrichGebert/ponytail"` 3항식이었고, `skills_catalog.test.ts` 가 **같은 3항식을 복제**하고 있었다. 출처가 셋이 되는 순간 둘 다 새 출처를 조용히 ponytail 로 읽는다 — 테스트가 프로덕션의 버그를 그대로 베껴 통과시키는 모양이다.

`CATALOG_REPOS: Record<CatalogSource, string>` 하나로 합치고 테스트도 그 맵을 읽게 했다. 이제 출처를 추가하면 맵을 채울 때까지 컴파일이 실패한다.

## 왜 상시 주입(always-on)은 안 가져왔나

업스트림의 간판 기능은 SessionStart 훅으로 6.8KB(≈1,700토큰) 전문을 **매 세션 무조건** 싣는 것이다. 2026-09-03 에 ECC 를 전역에서 걷어낸 이유가 정확히 그 비용 모델이라, 훅·플러그인 매니페스트는 하나도 가져오지 않고 SKILL.md 만 벤더링했다. 사람이 부를 때만 뜬다.

## 알려진 한계

업스트림이 공개한 `evals/RESULTS.md` 는 자기 릴리스 게이트를 통과하지 못했다(가중 +0.427 이지만 blocker 3 잔존). 회귀 2건 중 `partial-success` −0.63 의 지목된 메커니즘이 규칙 8(원인→처방)이 **증거 없이 원인을 대게 압박**한다는 것이다. 벤더링 무결성 규약상 원문은 못 고치므로, 요약문에 「직접 호출 전용」을 명시해 사용자가 켜는 자리를 좁히는 선에서 둔다.

## 검증

`pnpm typecheck` · `pnpm test`(196 파일 / 2,566 테스트) · `pnpm lint`(6게이트, exit 0) · `pnpm build` 전부 exit 0.
`skills_catalog.test.ts` 는 26개 엔트리 · 핀 SHA 40-hex · 디스크 동일성 · MIT 전문 동봉 · bidi/제로폭 위생을, `plugin_docs_sync.test.ts` 는 랜딩의 표 행·핀 배지·개수 문구를 확인한다. 본문 무수정은 `diff <(grep -v vendored-from …) 업스트림` 으로 직접 대조했다.