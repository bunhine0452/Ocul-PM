---
schema_version: 1
type: refactor
slug: "copy-glossary-and-clipboard-form"
status: done
difficulty: low
created_at: "2026-09-09T20:44:24+09:00"
session_id: "20260909-001"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "c997b348-9e50-41e9-845f-4681b1fda66a"
language: "ko"
verified_by_user: false
files_touched: []
related: []
tags:
  - "i18n"
  - "copy"
  - "glossary"
  - "design"
  - "mcp-tool"
---
[x] 복사 확인 13종을 한 형태로, 용어집을 계약으로 못박는다

## 동기

같은 것을 두 가지로 부르면 사용자는 서로 다른 것이라고 읽는다. 그런데 이건 **눈으로 못 잡는다** — 두 표기가 한 화면에 같이 뜨는 일이 드물다.

직접 세어 보니 감사보다 심했다. 클립보드 복사 확인이 6종이 아니라 **13종**이었고 말투가 셋이었다.

```
복사됨(4)          common.copied · settings.storage.copied("복사됨!") ·
                   tray.standupCopied("복사됨 ✓") · plugin.copied
복사했습니다(3)     ctx.manifest.copied · term.block.copiedCommand/Output
복사했어요(6)       today.standup.copiedAi/Plain · disc.pathCopied ·
                   today.honesty.copied · disc.promptCopied · plugin.copyToast
```

## 변경 요약

**순수 확인은 「(무엇) 복사됨」 한 형태다.** 중복 3개(`settings.storage.copied`·`tray.standupCopied`·`plugin.copied`)는 `common.copied` 로 접고, 나머지는 형태만 통일했다. 느낌표 하나와 체크글리프 하나가 함께 사라졌다 — 아이콘이 이미 토스트에 있다.

`common.copiedWhat` 을 만들려다 접었다. `{what}` 에 넣을 **명사 키**가 없어서(`ctx.manifest.copy` 는 "복사", `disc.copyPath` 는 "문서 경로 복사") 억지 키를 새로 만들어야 했다. 키를 그대로 두고 값의 형태만 맞추는 쪽이 호출부 변경도 없고 읽기도 낫다.

뒤에 할 일을 덧붙이는 것(`disc.promptCopied` = "복사했어요 — 붙여넣으면…")은 종류가 다른 메시지라 손대지 않았다. 말투 통일은 `{#copy-voice}` 몫이다.

**용어집** — "작업일지"(7)→"작업 일지"(18) · "디렉토리"(3)/"디렉터리"(2)→"폴더"(54) · "기록없음"→"기록 없음" · 값 안의 "Planner"(2)→"플래너"(24) · 영문 뒤 조사 붙여쓰기 17곳→띄어쓰기(관례 183곳). `ai.actionApply` "적용하기 (Apply)" → "적용" (다른 "적용" 3개는 전부 그냥 "적용"이고, 영어를 병기한 유일한 순수 한국어 동사였다).

## 감사의 오탐 정정

**`Ocul-PM`(7) vs `ocul-pm`(37) 은 드리프트가 아니다.** CLAUDE.md 가 적어 둔 구분이다 — 산문의 제품명은 `Ocul-PM`("Ocul-PM 이 기록을 남깁니다"), 식별자는 `ocul-pm`(설정 탭·인스턴스·플러그인 슬러그·경로). 두 표기가 다른 자리에 쓰이고 있어 손대지 않았다.

`plan.*` 네임스페이스도 "계획" 으로 일관적이었다 — "플래너/플랜/계획" 이 섞인다는 지적은 화면 이름(플래너)과 대상(계획)의 구분이지 드리프트가 아니다.

## 검증

`i18n_glossary.test.ts` 신규 15개 — 금지 표기 4종 · 값 안의 Planner · 조사 띄어쓰기 · 순수 확인 8키가 「복사됨」으로 끝남 · 느낌표/체크글리프 없음. **음성 테스트**: probe 로 위반 6가지를 심어 여섯 개가 전부 발화하는 것을 확인한 뒤 되돌렸다.

주석 제거를 정규식으로 하다가 사전 **값** 안의 `**/*.tsx` 글롭이 주석 시작으로 읽혀 뒤 수백 줄이 사라지는 함정을 밟았다(키 셋을 못 찾았다). 줄 단위 필터로 바꿨고 그 이유를 파일에 적어 뒀다.

`pnpm typecheck` · `pnpm lint`(6게이트) · `pnpm test`(195 파일 2,537개) · `pnpm build` 각 exit 0.