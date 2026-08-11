---
schema_version: 1
type: refactor
slug: "skill-bodies-single-source"
status: done
difficulty: medium
created_at: "2026-08-12T03:53:39+09:00"
session_id: "mcp-20260812-035339"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/skills/skillsGallery.ts"
    op: update
  - path: "src/features/skills/skillsCatalog.ts"
    op: update
  - path: "src/features/skills/SkillShopTab.tsx"
    op: update
  - path: "src/features/skills/SkillsScreenV2.tsx"
    op: update
  - path: "src/__tests__/skills_catalog.test.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "i18n"
  - "phase2"
  - "리팩토링"
  - "스킬"
  - "mcp-tool"
---
[x] 스킬 갤러리 본문을 플러그인 정본에서 직접 임포트 — 사본 제거 + 카탈로그 라벨 영어화

## 동기

`skillsGallery.ts` 는 한글 하드코딩 검사기에 112건으로 잡혀 있었는데, 그중 **104건이 SKILL.md 본문**이었다 — 사용자의 `.claude/skills/<id>/SKILL.md` 로 그대로 쓰이는 디스크 산출물이라 [계획상 번역 범위 밖](docs/20260811_three-features/03-i18n.md)이다. 번역할 것은 label/summary 8건뿐인데 검사기가 본문 전체를 오탐하고 있었다.

## 변경 요약

본문을 `.ts` 밖으로 빼되, **플러그인 디렉토리에서 직접** `?raw` 로 읽게 했다:

```ts
import projectInceptionMd from "../../../plugin/oculpm/skills/project-inception/SKILL.md?raw";
```

같은 본문이 이 파일의 템플릿 리터럴과 `plugin/oculpm/skills/<id>/SKILL.md` 두 곳에 있었고, `plugin_skills_sync` 테스트가 둘이 어긋나지 않는지 감시하고 있었다. 사본을 하나로 줄이니 그 불변식이 **테스트가 아니라 구조로** 보장된다 — 드리프트가 애초에 불가능해진다. 부수 효과로 본문이 검사기(=.ts/.tsx 만 훑는다) 시야에서 사라진다.

카탈로그·갤러리의 label/summary 58건은 `labelKey`/`summaryKey` 로 전환했다.

## 발생 원인 — 내 검증이 잘못됐던 것

처음에는 본문을 `src/features/skills/gallery/<id>.md` 로 복사했고, "추출이 내용을 바꾸지 않았는지" 를 확인했더니 **byte-identical** 이 나왔다. 그런데 `plugin_skills_sync` 4건이 깨졌다.

검증이 틀렸다. 나는 정규식으로 캡처한 **소스 텍스트**와 내가 쓴 파일을 비교했는데, 그건 내 입력과 내 출력을 비교한 것이라 자명하게 통과한다. 실제로 필요한 비교는 템플릿 리터럴의 **평가된 값**이었고, 원문에는 이스케이프된 백틱(`` \` ``)이 있어서 파일에는 백슬래시가 그대로 남아 있었다.

테스트가 아니었으면 스킬 본문이 미묘하게 깨진 채 사용자 디스크에 쓰였을 것이다. 교훈: "내가 만든 것"과 "내가 만든 것"을 비교하는 검증은 검증이 아니다 — **독립적인 정본**(여기서는 plugin/ 디렉토리)과 대조해야 한다.

결과적으로 그 정본에서 직접 임포트하는 쪽으로 바꿔 사본 자체를 없앴다.

## 함께 다룬 것

`seed()` 가 모듈 로드 시점에 실행되므로 거기서 `t()` 를 부르면 언어가 굳는다 (DeferLedger 와 같은 함정) — 타입에 키를 싣고 소비처에서 해석한다.

`SkillShopTab` 의 검색은 `tAll()` 로 **양 언어를 색인**한다 — 영어 모드에서도 한국어 요약으로 찾힌다 (내비·팔레트와 같은 정책).

카탈로그 무결성 테스트의 `label.length > 0` 단언은 키 존재 확인(`t(key) !== key`)으로 옮겼다 — 값이 비지 않았는지는 i18n 테스트가 이미 본다.

## 검증

게이트 4종 전부 exit 0 직접 확인 — typecheck / vitest(54파일 649건) / lint / build. allowlist 88 → 86.