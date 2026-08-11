---
schema_version: 1
type: feature
slug: "split-ui-and-content-language"
status: done
difficulty: medium
created_at: "2026-08-11T22:54:34+09:00"
session_id: "mcp-20260811-225434"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/content_lang.rs"
    op: create
  - path: "src-tauri/src/oculpm/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/journal_draft.rs"
    op: update
  - path: "src-tauri/src/commands/retro.rs"
    op: update
  - path: "src-tauri/src/commands/plan.rs"
    op: update
  - path: "src/lib/settings.ts"
    op: update
  - path: "src/features/settings/SettingsPanel.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "plugin/oculpm/.claude-plugin/plugin.json"
    op: correct
  - path: ".claude-plugin/marketplace.json"
    op: correct
related: []
tags:
  - "i18n"
  - "설계"
  - "llm"
  - "프롬프트"
  - "mcp-tool"
---
[x] UI 언어와 AI 작성 언어 분리 — 되돌릴 수 없는 산출물을 UI 조작에 묶지 않는다

## 추가 기능

`content_language` 설정 신설. LLM 이 만드는 산출물(작업 일지·플래너·회고)의 언어를 UI 언어와 **별도로** 정한다.

- `Settings.contentLanguage` (SQLite `content_language`)
- 설정 → 모양에 "UI 언어" / "AI 작성 언어" 두 섹션
- UI 언어를 바꾸면 AI 언어도 맞출지 **액션 버튼 토스트**로 제안
- Rust `oculpm::content_lang` — 프롬프트에 출력 언어 지시를 덧붙임 (journal_draft · retro · planner AI 3곳 배선)

## 동기

원래 계획([03-i18n.md §4.5])은 Rust 가 `settings.language` 를 그대로 읽어 프롬프트 출력 언어를 정하는 거였다. **그게 틀렸다.**

둘은 되돌릴 수 있느냐가 다르다:

| | UI 언어 | AI 작성 언어 |
|---|---|---|
| 영향 | 화면 텍스트 | `.oculpm/journal/*.md` · 플래너 · 회고 |
| 되돌리기 | 즉시, 무료 | **불가** — 디스크에 쓰인 일지는 그대로 |

한국인 개발자가 스크린샷·습관 때문에 UI 만 영어로 바꾸는 건 흔한데, 부작용으로 프로젝트 일지가 조용히 영어로 넘어가면 언어가 섞인 이력이 영구히 남는다. 반대로 팀이 국제화돼서 일지만 영어로 쓰고 UI 는 한국어로 두고 싶은 경우도 있다. 하나의 스위치로 묶을 수 없다.

## 모달이 아니라 토스트인 이유

사용자 요청은 "경고창"이었지만 모달은 과하다. UI 언어 변경은 즉시 되돌릴 수 있는 무해한 조작인데 그때마다 흐름을 막으면 설정을 만지기가 싫어진다.

이 앱엔 이미 맞는 관용구가 있다 — AGENTS.md 업그레이드 제안(App.tsx)의 **액션 버튼 달린 비차단 토스트**. 경고가 아니라 제안이다: 무시하면 안전한 쪽(기존 언어 유지)으로 남고, 원하면 한 번 클릭. 같은 패턴을 그대로 썼다.

해석된 언어가 실제로 갈라질 때만 띄운다 — 둘 다 "시스템"이면 이미 같은 언어라 물어볼 게 없다.

## 프롬프트 본문은 번역하지 않는다

`ContentLang::apply()` 가 시스템 프롬프트 **끝에 출력 언어 지시 한 줄만** 덧붙인다. 본문(한국어 지시문)은 그대로 둔다.

본문을 두 벌로 유지하면 한쪽만 고치는 드리프트가 반드시 생기는데, 본문은 모델에게 주는 지시지 사용자가 읽는 문자열이 아니라 두 벌을 유지할 이득이 없다. LLM 은 한국어 지시 + 영어 출력 요구를 문제없이 처리한다.

`Unset`(설정 "시스템")이면 지시를 **한 글자도 붙이지 않는다** — 기존 프로젝트의 프롬프트가 바이트 단위로 동일해 이 기능이 회귀를 만들지 않는다. 테스트로 고정했다.

## 곁다리로 고친 것

`cargo test` 가 이미 깨져 있었다 — `plugin.json` 이 2.8.3, 앱이 2.8.4. v2.8.4 릴리스가 앱 버전만 올리고 플러그인 스탬프를 빠뜨렸다 (마지막 갱신이 v2.8.3 커밋). 내 변경과 무관한 기존 실패라 버전만 동기화했다 (`plugin.json` + `marketplace.json`).

## 검증

게이트 5종 전부 exit 0 직접 확인 — typecheck / vitest(54파일 649건) / lint / build / **cargo test(516건 + 통합 스위트, 실패 0)**.

`content_lang` 단위 테스트 5건: 값 파싱 · 알 수 없는 값/None → Unset · **Unset 이 프롬프트를 안 건드림**(회귀 방지) · 한/영 지시가 본문 뒤에 붙음.

미착수: 프롬프트 12파일 중 3곳만 배선했다 (journal_draft · retro · planner AI). summary · overview · greenfield · rule/skill_promotion · reconcile 은 남았다.