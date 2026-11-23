---
schema_version: 1
type: chore
slug: "app-copy-one-glossary"
status: done
difficulty: medium
created_at: "2026-11-23T21:25:27+09:00"
session_id: "20261123-001"
agent:
  id: "claude-code"
  version: "Sonnet 5.5"
  session: "9db3a5f7-812f-4644-aa3a-8b45252c03a5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
  - path: "src/__tests__/i18n.test.ts"
    op: update
  - path: "src/__tests__/i18n_copy_terms.test.ts"
    op: create
  - path: "src/__tests__/i18n_errors.test.ts"
    op: update
  - path: "src/__tests__/i18n_switch.test.tsx"
    op: update
  - path: "src/__tests__/polish_phase2.test.tsx"
    op: update
  - path: "src/__tests__/today_local_only.test.tsx"
    op: update
  - path: "src/__tests__/today_num.test.tsx"
    op: update
  - path: "src/__tests__/update_banner.test.tsx"
    op: update
  - path: "src/features/settings/SettingsPage.tsx"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/i18n/errors.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
related: []
tags:
  - "문구"
  - "love-round"
  - "i18n"
  - "mcp-tool"
---
[x] 문구: 영어 용어표로 앱 문구를 한 벌로

디자인팀 문구 레인. 키 이름은 그대로 두고 값만 고쳤다.

- 영어 용어표를 `en.ts` 머리 주석(GLOSSARY)으로 정하고 `i18n_copy_terms` 시험이 버린 말(entry · journal · record 섞임, leaf, 새 판 등)이 값에 돌아오지 못하게 막는다. 영어 화면 이름은 Journal 하나, 일지 없는 칩은 어디서나 No entry.
- 오류 · 빈 상태가 다음 걸음을 말한다(캐시 오류 → 설정 › 앱 › 처음부터 다시 만들기, 파일 오류 → 폴더 권한). 걷은 기능(ACP 등)의 죽은 오류 키 14개를 지웠다.
- git 을 몰라도 읽히게: 「받아 온 일지 · 이 기기에만」 → 「다른 기기에서 온 일지 · 다른 기기에 없는 일지와 계획」(툴팁에 git push · pull 한 번), 새 판 · 옛 판 · 리프 → 새 버전 · 오래된 · 미완 항목, worktree 는 첫 자리에서 풀이.
- 영어 칩이 한국어 어순을 끌고 오던 곳(Elsewhere · Pick · Rang the bell · Got it)과 투어 어조, 「Codex Not installed」 대소문자.

## 검증
vitest i18n 관련(i18n_* · glossary · copy_terms) 초록. 합류 CI 에서 용어표 시험이 G2 의 새 문구 둘을 잡아(새 판 · leaves) 지휘자와 최종 검수(F3)가 고쳤다 — 7ca523f4 이후 프런트 초록.