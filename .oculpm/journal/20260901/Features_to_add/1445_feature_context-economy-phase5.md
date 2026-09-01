---
schema_version: 1
type: feature
slug: context-economy-phase5
status: done
difficulty: high
created_at: 2026-09-01T14:45:00+09:00
session_id: manual-20260901-144500
agent:
  id: claude-code
  version: Opus 5 (1M context)
language: ko
verified_by_user: false
files_touched:
  - path: src/features/chat/recallGate.ts
    op: create
  - path: src/features/chat/manifest.ts
    op: create
  - path: src/features/chat/contextLoad.ts
    op: create
  - path: src/features/chat/slashInject.ts
    op: create
  - path: src/features/chat/recallUsage.ts
    op: create
  - path: src/features/chat/aiContext.ts
    op: update
  - path: src/features/chat/AiPanelScreenV2.tsx
    op: update
  - path: src/features/settings/tabs/ContextTab.tsx
    op: create
  - path: src/features/settings/SettingsPanel.tsx
    op: update
  - path: src/features/skills/skillsModel.ts
    op: update
  - path: src/features/skills/SkillsScreenV2.tsx
    op: update
  - path: src/api/context.ts
    op: create
  - path: src-tauri/migrations/035_context_recall.sql
    op: create
  - path: src-tauri/src/db/recall.rs
    op: create
  - path: src-tauri/src/commands/context.rs
    op: create
  - path: src-tauri/src/commands/skills.rs
    op: update
  - path: src-tauri/src/db/mod.rs
    op: update
  - path: src-tauri/src/commands/mod.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src/__tests__/context_economy.test.ts
    op: create
  - path: src/__tests__/rules_reachability.test.ts
    op: create
  - path: src/__tests__/fixtures/rules-compliance/questions.json
    op: create
  - path: src/__tests__/ai_context_parts.test.ts
    op: update
  - path: src/i18n/ko.ts
    op: update
  - path: src/i18n/en.ts
    op: update
  - path: docs/20260831_osaurus-bench/04-context-economy.md
    op: update
related:
  - 20260901/Features_to_add/1240_feature_theme-files-phase4.md
  - 20260901/Features_to_add/1113_feature_provenance-phase3.md
tags:
  - osaurus-bench
  - phase5
  - context-economy
  - tokens
---

[x] 안 넣는 것이 답이다 — 능력 매니페스트 · 회상 게이트 · 관련도 감쇠 (Phase 5)

## 추가 기능

AI 패널은 **매 턴** 플랜 전체와 일지 3건과 규칙 2,500자를 다시 조립해 system 앞에
올렸다. 두 가지가 동시에 잘못돼 있었다 — 거의 안 바뀌는 블록이 매 턴 재조립돼
프롬프트 캐시가 매번 깨졌고, "이 함수 이름 뭐가 좋을까" 같은 턴에도 전부 실렸다.

- **능력 매니페스트** — 규칙·스킬·계획·일지의 **목록만** 올린다. 본문은 필요할 때
  꺼낸다. `MAX_CTX_PLANS = 4` 상한이 사라졌다 (목록은 싸다).
- **세션 시작 시 동결** — 대화 동안 매니페스트는 **바이트 동일**이다.
- **`digestRules` 은퇴** — 규칙을 2,500자로 잘라 넣던 코드를 지웠다. 한 번은 그
  절단이 §5 시크릿 금지를 통째로 삼켰다. 이제 안 자르고, 대신 안 넣는다.
- **회상 게이트** — `detectRecall(turn)` 이 신호 4종(verbatim·episode·plan·fact)을
  결정적으로 판정한다. 무신호 턴에는 일지·플랜을 **아예 조립하지 않는다**.
- **회상 예산 ≤800토큰** — 넘치면 관련도 순으로 **버린다**(자르지 않는다).
- **관련도 감쇠** (`035_context_recall.sql`) — 반감기 30일, 쓰이면 회복. 파생
  캐시라 지워도 무해하다.
- **슬래시 결정적 주입** — `/rules` `/plan <id>` `/journal <path>` `/skill <name>`.
- **스킬 키워드** — frontmatter `keywords` 신설. 검색은 이름·설명·키워드만 색인한다.
- **설정 → 컨텍스트 탭** — 항상 가는 것 · 매니페스트 미리보기 · 예산 · 회상 후보
  (관련도 바 + 잊기) · 위험 구역.
- **프로젝트 지시문** — 전역 선호와 병합되고 프로젝트가 우선이다.

## 동작 흐름

**조립 순서가 곧 캐시 전략이다.** `system → manifest → rag → actions → git →
recall`. 앞의 두 블록이 안정적이고, 뒤로 갈수록 자주 바뀐다. 예전에는 거의 안
바뀌는 것이 앞자리에서 매 턴 재조립됐다.

**동결은 "다시 읽지 않는다" 는 뜻이다.** 대화 중 규칙 파일이 바뀌어도 그 대화의
매니페스트는 그대로다. 즉시 도달이 필요하면 `context_discover` 가 디스크를 본다 —
목록의 신선도와 프롬프트 캐시를 맞바꾼 것이고, 맞바꿀 값어치가 있다.

**도구가 없어서 텍스트 규약을 썼다.** 설계는 `context_discover`/`context_load` 를
**도구**로 적었는데, `LlmProvider` 트레이트에는 도구 호출이 없다 — 네 어댑터에
함수 호출을 얹는 것은 이 Phase 보다 큰 일이다. 대신 저장소가 이미 쓰는 관용구
(```` ```json:action ````)를 빌려 ```` ```json:context ```` 로 요청받고 앱이
실행해 되돌린다. 플래너 액션과 다른 점 하나 — 그쪽은 **쓰기**라 승인 카드를
거치지만 이쪽은 **읽기**라 자동으로 왕복한다. 왕복은 `MAX_CONTEXT_HOPS = 2`.

**통계는 보내는 경로에서만 올린다.** `assembleAiContext` 는 토큰 추정 때문에
타이핑 중에도 디바운스로 불린다 — 거기서 `recall_touch` 를 부르면 키를 칠 때마다
점수가 뛴다. 그래서 조립은 `recallUsed` 목록만 돌려주고 전송 경로가 올린다.

**감쇠는 읽을 때 계산한다.** 저장된 점수는 `last_used` 시점의 값이고 `recall_top`
이 반감기 30일로 깎아서 준다. 스케줄러를 하나 더 만들지 않았고, 앱이 꺼져 있던
기간을 따로 보정할 필요가 없다. 회복분은 **감쇠를 반영한 뒤** 더한다 — 아니면
오래 안 쓰인 항목이 한 번 쓰였다고 예전 점수를 그대로 되찾는다.

**규칙이 조용히 사라지지 않게.** `digestRules` 를 지우면 규칙이 자동으로는 안
들어간다. 셋으로 막았다 — (1) 안전 조항 **3줄**은 매니페스트에 상주한다(시크릿
금지는 "안 꺼내 봐서 몰랐다" 가 성립하지 않는다), (2) `/rules` 가 사용자의
확정 경로다, (3) 회귀 게이트가 12개 질문마다 도달 가능성을 단언한다.

## 검증

`pnpm typecheck` · `pnpm test`(135 파일 1656건) · `pnpm lint`(3게이트) ·
`pnpm build` · `cargo test`(1005건) · `cargo clippy --all-targets -- -D warnings` ·
`cargo fmt --check` 전부 exit 0 을 직접 확인.

새 테스트 — `context_economy.test.ts`(29건): 회상 신호 표 12줄(한/영 × 4종 +
무신호) · 우선순위 · 영어 단어 경계(`explanation` 이 `plan` 을 안 때린다) ·
결정성 · 예산 상한과 관련도 순과 **자르지 않고 버림** · 동결(디스크가 바뀌어도
같은 바이트) · 다른 대화는 새 목록 · 녹이면 다시 읽음 · 키워드 검색 · 본문
미색인 · 규약 파싱(깨진 JSON·모르는 kind 는 무시) · 요청 블록 숨김.
`rules_reachability.test.ts`(5건): 픽스처 12문항, always 는 상주 · on-demand 는
전문 도달(절단 마커 0 · 펜스 짝수) · 안전 조항 3줄 · 매니페스트는 목록만.
Rust `db::recall`(4건): 30일 반감·60일 2회 반감 · 시드/회복 · 잊기·초기화 멱등 ·
**저장 점수가 아니라 감쇠 점수로** 정렬. `commands::skills`: 키워드 두 YAML 모양.

## 메모

설계 대비 이탈 다섯 가지는 `docs/20260831_osaurus-bench/04-context-economy.md`
§7 에 적었다. 가장 큰 것은 **도구 → 텍스트 규약**(§7.1)이고, 나머지는 회상
신호 우선순위 신설 · 감쇠를 읽을 때 계산 · 통계는 전송 경로에서만 · "구/신 경로
비교" 를 "도달 가능성" 으로 재정의(구 경로가 삭제돼 비교 대상이 없다).

남긴 것: 「항상 가는 것」을 줄 단위 목록 UI 로 승격하지 않았다 — 전역과 프로젝트
두 텍스트 영역이고 병합 규칙만 설계대로다. ACP 구동면은 §0.1 대로 손대지 않았다.
