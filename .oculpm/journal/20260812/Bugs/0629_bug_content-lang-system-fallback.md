---
schema_version: 1
type: bug
slug: "content-lang-system-fallback"
status: done
difficulty: medium
created_at: "2026-08-12T06:29:21+09:00"
session_id: "mcp-20260812-062921"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/content_lang.rs"
    op: update
  - path: "src/__tests__/i18n_english_render.test.tsx"
    op: create
  - path: "src/__tests__/i18n.test.ts"
    op: update
  - path: "scripts/check-no-localstorage.mjs"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "i18n"
  - "rust"
  - "content-language"
  - "mcp-tool"
---
[x] 영어 UI 인데 AI 산출물이 한국어로 나오던 문제 — 프런트·백엔드의 \"system\" 해석 불일치

## 발생 원인

직전 라운드에서 프런트에 작성 언어 축(`tc()`)을 배선하며 `"system"` 을 **UI 언어를 따르는 것**으로 정의했다. 그런데 백엔드 `oculpm/content_lang.rs` 는 이미 존재했고 `"system"` 을 **`Unset` → 지시 없음** 으로 해석하고 있었다. 프롬프트 본문이 한국어라 지시가 없으면 모델은 자연히 한국어로 답한다.

결과: **설정을 한 번도 안 건드린 영어 UI 사용자**가 화면은 영어인데 일지·회고·플래너 항목은 한국어로 받는다. 기본값이 그러면 "영어 지원"이라 부를 수 없다.

이건 영어화를 진행하다 **내가 만든 불일치**다 — 백엔드는 그 전까지 일관됐다(둘 다 한국어). 프런트만 바꾸면서 두 쪽 규칙이 갈렸다.

## 해결 방법

`current()` 가 `content_language` 가 미지정일 때 `language` 로 폴백한다 — 프런트 `getContentLang()` 과 **같은 규칙**. 명시 설정은 여전히 UI 와 독립이다(화면 영어 + 일지 한국어를 원하는 사용자가 이 축을 나눈 이유).

`language` 마저 `"system"` 이면 `Unset` 으로 남긴다. 그 해석은 `navigator.language`(웹뷰) 몫이라 Rust 가 알 수 없고, 여기서 OS 로케일을 새로 추측하면 프런트와 **또 다른 세 번째 규칙**이 생긴다. 한계를 코드 주석에 적어 뒀다.

테스트 4개로 폴백 사다리를 고정했다: 명시 우선 · system→UI · 키 부재→UI · 둘 다 system→Unset.

## 프롬프트 12곳은 이미 덮여 있었다

확인해 보니 `content_lang::apply()` 가 12개 프롬프트 파일에 모두 걸려 있었다. `oculpm/rule_promotion.rs` · `oculpm/skill_promotion.rs` · `oculpm/planner/ai.rs` 는 grep 에 안 걸렸지만, 이들은 프롬프트를 **정의만** 하고 소비처(`commands/*`, `reconcile.rs`)가 `.apply()` 로 감싸고 있었다. 파일 단위 grep 이 거짓 음성을 낼 수 있는 자리다.

## 곁들여 — 영어 모드 렌더 테스트

정적 스캐너는 "소스에 한글 리터럴이 있는가"만 본다. 상수 테이블의 한글이 렌더까지 흘러가거나 `memo` 컴포넌트가 언어 전환에 안 따라오는 경우는 구조적으로 못 잡는다. 그래서 실제로 그려서 한글을 찾는 스위트를 추가했다 — 텍스트뿐 아니라 `aria-label`/`title`/`placeholder` 까지 훑는다.

이 테스트가 첫 실행에서 바로 잡은 것: `setLangSetting("en")` 만으로는 영어가 안 된다. `SettingsProvider` 의 effect 가 저장된 설정을 스토어로 밀어넣으며 덮어쓴다(`setup.ts` 가 같은 함정을 기록해 뒀는데 그대로 밟았다). 설정을 목으로 넘기도록 고쳐 배선 전체(DB → 컨텍스트 → 스토어 → `t()`)를 검증한다.

## 검증

게이트 5종 exit 0 직접 확인 — typecheck / vitest 670통과 / **cargo test 520통과**(+4) / lint(남은 44 = 전부 테스트 파일) / build.