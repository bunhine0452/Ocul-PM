<!-- schema_version: 1 -->
# Ocul-PM 1.0 — 배포-실용성 리팩토링 전용 마스터 프롬프트 (v1)

> 본 프롬프트의 위상: 외부 LLM 에이전트 (Claude Code · Cursor · Antigravity · Gemini CLI) 가 **배포-실용성 라운드의 PR (PR-R0 ~ PR-R5) 을 작업할 때 *함께 읽는*** 규약.
> 작업 일지 작성 규칙 ([`.oculpm/agents/_template.md`](../../../.oculpm/agents/_template.md)) 은 *별개* — **여전히 활성**.
> 시각 SSOT (불변): [`../Lite-update/Fianl_UI_update_before1.0/Ocul-PM1.0/`](../Lite-update/Fianl_UI_update_before1.0/Ocul-PM1.0/) — 충돌 시 *목업이 옳다*.
> 시각 규약 (불변, 병행): [`../Lite-update/Fianl_UI_update_before1.0/UI-MASTER-PROMPT.md`](../Lite-update/Fianl_UI_update_before1.0/UI-MASTER-PROMPT.md) — **본 프롬프트와 동시 적용**.
> 의사결정 SSOT: [`00-refactor-master-plan.md`](./00-refactor-master-plan.md) §4 + [`02-fix-checklist.md`](./02-fix-checklist.md) §0.

---

## 1. 당신의 역할

당신은 Ocul-PM 의 **1.0 출시 직전 마지막 리팩토링** 라운드에서 PR 을 수행합니다. 직전 라운드(Final UI Update)가 *외관* 을 끝냈다면, 이 라운드는 **"처음 설치한 유저가 실제로 성공하는가"** 를 마감합니다.

이 라운드는 직전 라운드와 *두 가지가 다릅니다*:

1. **백엔드를 건드릴 수 있습니다** (실용성 fix 가 백엔드를 요구함 — entry-diff fallback, 수동 일지 등). 단 규율이 따릅니다 (§3.5).
2. **성공 기준이 "목업과 동일"이 아니라 "유저가 막힘없이 첫 일지에 도달"** 입니다.

PR 식별자는 `PR-R0` ~ `PR-R5`. 각 PR 의 DoD 는 [`02-fix-checklist.md`](./02-fix-checklist.md). **DoD 가 모두 ☑ 가 아니면 머지 제안하지 마세요.**

---

## 2. 작업 전 *반드시* 읽는 문서

1. [`README.md`](./README.md) — 폴더 위상 / 진행 상태.
2. [`00-refactor-master-plan.md`](./00-refactor-master-plan.md) — SSOT. 정체성·스코프·결정.
3. [`01-problems-inventory.md`](./01-problems-inventory.md) — *당신이 고칠 문제* 의 근거(`file:line`)와 심각도.
4. [`02-fix-checklist.md`](./02-fix-checklist.md) — 본인 PR 의 DoD.
5. **[`UI-MASTER-PROMPT.md`](../Lite-update/Fianl_UI_update_before1.0/UI-MASTER-PROMPT.md)** — *시각 규약 (불변)*. 새 UI 를 추가할 때 이 규약을 어기면 시각 회귀.

또한 *참고만*:
- [`../Lite-update/Fianl_UI_update_before1.0/05-implementation-checklist.md`](../Lite-update/Fianl_UI_update_before1.0/05-implementation-checklist.md) — Decision A~J (특히 §0.12 의 ui_v2 모달 패턴, §0.13/§8b 의 변수 remap).
- 직전 라운드 목업 jsx — 새 UI 의 시각 기준.

---

## 3. 절대 금지 사항

### 3.1 시각 회귀 (직전 라운드 잠금 — 한 줄이라도 어기면 DoD 미충족)

- ❌ `dark:` Tailwind variant 추가 (현재 0 — 유지).
- ❌ `classList.toggle("dark")` (현재 0 — `data-theme` 속성만).
- ❌ lucide-react 직접 import (`@/components/Icons` 단일 출구만).
- ❌ localStorage 직접 접근 (`useWorkspace`/SettingsContext 경유, allowlist 외 금지).
- ❌ Tailwind 임의 색 (`bg-red-500` 등) / `theme.extend.colors` 추가.
- ❌ 새 shadcn 컴포넌트로 ui_v2 8 화면 표면 오염 — 새 UI 는 ui_v2 토큰 클래스 + `--*` 변수.
- ❌ 토큰 격리 파괴 — 메인 css 에 ui_v2 녹색(`12a06b`) 누출.

### 3.2 IA / 단축키 (직전 라운드 잠금)

- ❌ 사이드바 9 슬롯 변경 / collapsible / 248px 변경.
- ❌ 새 IA 슬롯 추가.
- ❌ ⌘1~⌘7 / ⌘, 매핑 변경. (단, *약속됐으나 미구현*인 화면 내 단축키 — 예 ⌘N 수동 일지 — 를 *연결*하는 것은 본 라운드 대상.)

### 3.3 스코프

- ❌ "겸사겸사" 리팩터 — 현재 PR 의 DoD 밖 코드 정리는 별도 PR.
- ❌ "1.1 예정" 신기능의 *엔진 구현* (심볼/정확 검색 등). 본 라운드는 *그 비활성 표면을 어떻게 처리할지(제거/안내)* 만.
- ❌ ui_v2 시각 재디자인 / 재논의.

### 3.4 데이터 루프 (회귀 방지)

- ❌ watcher 의 `is_self_suppressed` / journal cache 무효화 / session resume 경로를 *테스트 없이* 변경.
- ❌ `WorkspaceContext` schema 의 역 마이그레이션이 필요한 변경 (additive / deletion-only 만).
- ❌ `.oculpm/agents/_template.md` 의 *일지 작성 규칙 본문* 변경.

### 3.5 백엔드 — *허용되지만 규율 있음* (직전 라운드와 다른 점)

본 라운드는 백엔드를 건드릴 수 있습니다. 단:

- ✅ **신규 `#[tauri::command]` 추가 OK** — 단 `tauri-specta` 바인딩 재생성(`bindings.ts`) + `cargo test` green 필수.
- ⚠ **기존 command 시그니처 변경은 가급적 회피** — 불가피하면 호출부 *전수* + specta 재생성 + `cargo test`.
- ✅ **DB migration 추가 OK** — additive only (역 마이그레이션 불요).
- ❌ `bindings.ts` 를 *커밋* 하지 마세요 — gitignore 된 생성물. 매 `cargo test`/`tauri dev` 에서 재생성됨. tsc 통과용 한 줄 수동 추가가 필요하면 그것만(재생성이 덮음).

---

## 4. 반드시 지켜야 하는 패턴

### 4.1 새 UI 표면 (시각 — UI-MASTER-PROMPT 계승)

```tsx
// ✅ ui_v2 토큰
<div style={{ background: "var(--bg-card)", color: "var(--text)" }}>
<button className="btn primary">
import { Sunrise } from "@/components/Icons";        // 단일 출구
const { theme } = useTheme();
const { state, setX } = useWorkspace();

// ❌ 금지
<div className="bg-white dark:bg-zinc-800">
import { Sunrise } from "lucide-react";
localStorage.setItem(...)
```

### 4.2 ui_v2 모달 (수동 일지 등 새 모달)

PR-UI 6 에서 정립된 패턴을 따르세요 (05-impl §0.12):
- `.set-modal-backdrop` / `.set-modal` (token-only, `--shadow-pop`).
- `role="dialog"` + `aria-modal` + `aria-labelledby`, Esc/백드롭 닫기.
- shadcn `ManualEntryModal`(레거시) 을 끌어오지 말고, 이 패턴으로 *신규* 작성.

### 4.3 백엔드 신규 command

```rust
// src-tauri/src/commands/oculpm.rs (또는 적절한 모듈)
#[tauri::command]
#[specta::specta]
pub async fn oculpm_xxx(...) -> Result<T, String> { ... }
```
→ `cargo test` 실행으로 `bindings.ts` 재생성 → 프론트는 `commands.oculpmXxx(...)` 사용.

### 4.4 영속화 / 단축키 / 아이콘

직전 라운드와 동일: `WorkspaceContext` 영속 키, `useGlobalShortcuts` 등록, `Icons.tsx` re-export. (UI-MASTER-PROMPT §4 그대로.)

---

## 5. 작업 흐름

PR-R<N> 시작 시:

1. [`01-problems-inventory.md`](./01-problems-inventory.md) 에서 본인 PR 의 문제 ID 들을 읽고 *근거 file:line* 을 직접 확인.
2. [`02-fix-checklist.md`](./02-fix-checklist.md) 의 해당 PR 표를 PR description 에 복사.
3. 새 UI 가 있으면 *목업 jsx* + UI-MASTER-PROMPT 규약 확인.
4. 백엔드 변경이 있으면 *가장 작은 표면* 으로 — 신규 command 우선, 시그니처 변경 회피.
5. `pnpm dev` (또는 `pnpm tauri dev`) 로 띄워 *실제 동선* 확인. 단위 테스트로 못 잡는 건 dogfood.
6. DoD 체크박스를 진행 중 갱신.
7. trigger 해당 작업은 [`.oculpm/agents/_template.md`](../../../.oculpm/agents/_template.md) 의 규칙대로 journal entry 작성.

PR 완료 시:
- [`02-fix-checklist.md`](./02-fix-checklist.md) §7 진행표 + §9 변경 기록 갱신.
- 새 결정이 있었다면 §0 + [`00-refactor-master-plan.md`](./00-refactor-master-plan.md) §4 동기화.

---

## 6. 용어 사전 (직전 라운드 §6 계승)

| 권장 (✅) | 금지 (❌) |
|---|---|
| 작업 일지 | 변경 로그, 체인지로그, 활동 |
| 변경 diff | diff, 변경사항 |
| 에이전트 | AI, LLM, 봇 |
| 일지 | entry, 항목 |
| 트리거 | 카테고리, 타입 |
| 워크데이 | 영업일, 작업일 |
| 코드 검색 | semantic search, 의미 검색 |
| Today | 오늘 화면, 홈, 대시보드 |

추가(본 라운드):

| 권장 (✅) | 금지 (❌) | 비고 |
|---|---|---|
| 핵심 루프 | 워크플로우, 파이프라인 | 온보딩 카피의 "프로젝트→AGENTS.md→에이전트→일지" |
| AGENTS.md 재동기화 | 규칙 다시 보내기 | *파일 쓰기만* — LLM 세션 무영향 (dogfooding 오인 방지) |
| 프롬프트 복사 | 규칙 전송 | 클립보드 복사 — *한 번만* 붙여넣기 안내 |

---

## 7. 자주 발생하는 실수 (본 라운드 특화)

### 7.1 죽은 컨트롤을 "비활성 회색"으로 남김
"1.1 예정" 칩을 또 추가하지 마세요. **연결하거나 제거**합니다 (Decision R1).

### 7.2 백엔드 시그니처를 *조용히* 바꿈
기존 command 인자/반환을 바꾸면 `bindings.ts` 재생성 후 프론트 호출부가 깨집니다. 신규 command 를 추가하는 쪽이 거의 항상 안전합니다.

### 7.3 온보딩 카피가 *수동성* 을 설명 안 함
이 앱은 유저가 *직접 입력*하는 도구가 아니라 *에이전트 작업을 수동(passively) 기록*하는 도구입니다. 온보딩은 "너는 평소처럼 에이전트로 코딩만 하면 된다" 를 *명시* 해야 합니다. (dogfooding 에서 만든 사람도 오인했음.)

### 7.4 시각 잠금을 무심코 깨뜨림
새 UI 추가 시 습관적으로 `dark:bg-...` / `import from "lucide-react"` 를 쓰지 마세요. §8 grep 게이트로 자가 점검.

---

## 8. PR 제출 직전 체크리스트

```bash
pnpm typecheck && pnpm test && pnpm lint && pnpm build
# 백엔드 변경 PR 만:
cargo test
```

시각 잠금 grep (본인 변경 줄 0):
```bash
grep -rn "dark:" src/ --include="*.tsx" --include="*.ts" | grep -v "/legacy/" | grep -v "\.test\."   # 0
grep -rn 'classList.toggle("dark")' src/ | grep -v "/legacy/"                                          # 0
grep -rn 'from "lucide-react"' src/ | grep -v "Icons.tsx" | grep -v "/legacy/"                         # 0
```

수동:
- [ ] 추가 UI = ui_v2 토큰 + Icons 단일출구 + Context 경유.
- [ ] 화면에 *동작 안 하는 컨트롤* 0 (또는 명확한 사유).
- [ ] 백엔드 변경 시 specta 재생성 + 호출부 전수 + cargo test.
- [ ] [`02-fix-checklist.md`](./02-fix-checklist.md) 진행표 + 변경 기록 갱신.

---

## 9. 막힘 / 도움 요청

1. [`01-problems-inventory.md`](./01-problems-inventory.md) 의 근거 file:line 재확인.
2. 시각이면 목업 jsx + UI-MASTER-PROMPT.
3. 데이터 루프면 직전 라운드 Decision F (백엔드 무변경 정신) 와 본 라운드 §3.5 (허용 규율) 의 *경계* 를 판단 — 모호하면 **추측 말고** PR description 에 open question.

**절대 추측하지 마세요.** 특히 *백엔드 시그니처 변경* 과 *AGENTS.md 템플릿 경계* 는 한 번 틀리면 데이터 루프 전체를 흔듭니다.

---

## 10. 빠른 요약 (1 paragraph)

당신은 Ocul-PM 1.0 의 *배포-실용성* 라운드 PR 을 작업합니다. 직전 라운드가 잠근 ui_v2 시각 시스템(`dark:` 0 / `classList.toggle` 0 / lucide 단일출구 / 토큰 격리)은 **불변** — 새 UI 도 ui_v2 토큰만 씁니다. 이 라운드는 *백엔드를 건드릴 수 있지만*(신규 command + specta 재생성 + cargo test), 시그니처 변경은 회피하고 `.oculpm/agents/_template.md` 본문과 watcher/session 핵심 경로는 테스트로 보호합니다. 목표는 **죽은 컨트롤을 연결하거나 제거**하고(비활성 회색 금지), **첫 실행 온보딩**으로 새 유저가 "에이전트가 일지를 자동 기록한다"는 멘탈 모델을 즉시 갖게 하며, **entry-diff/opener 등 핵심 루프의 현실 케이스**를 견고하게 만드는 것입니다. 막히면 추측 말고 open question.
