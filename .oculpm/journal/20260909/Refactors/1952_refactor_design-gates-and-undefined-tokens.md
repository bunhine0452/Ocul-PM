---
schema_version: 1
type: refactor
slug: "design-gates-and-undefined-tokens"
status: done
difficulty: medium
created_at: "2026-09-09T19:52:22+09:00"
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
  - "design"
  - "lint"
  - "tokens"
  - "de-ai"
  - "mcp-tool"
---
[x] 디자인 게이트 셋을 세우고, 조용히 죽어 있던 토큰 25곳을 되살린다

## 동기

3개 병렬 세션으로 "AI 스럽거나 어색하거나 아마추어 같은 곳"을 감사했다. 결론이 예상과 달랐다.

**AI 스러움은 이미 없었다.** 사전 3,346개 문자열에 과장어 1건·느낌표 1건·이모지 0건, `font-size` 선언 648개 중 640개가 토큰이다. de-AI 라운드(2026-09-02)와 램프 라운드(2026-09-08)가 실제로 먹혔다.

남은 것은 **"여러 손이 만든 티"** 였고, 원인은 둘로 좁혀졌다.

1. `check-design-discipline.mjs` 의 자간·무게 규칙이 **CSS 만 본다** (`ext: /\.css$/`). 같은 병이 TSX 로 샜다 — 타입 리터럴 `text-[11px]` 282개, 아이콘 크기를 클래스로 주는 우회 64개.
2. 아무 규칙도 **정의되지 않은 `var()`** 를 보지 않았다. 이름이 없으면 값이 틀리는 게 아니라 **선언 전체가 무효화**되는데(*invalid at computed-value time*), 눈에는 "왜 테두리가 없지" 로만 보인다.

## 변경 요약

### 게이트 (규칙 10·11·12·13)

- **`undefined-var`** — 파일 전체를 모아야 판정되므로 RULES 가 아니라 별도 패스. CSS 선언 · TSX 인라인 스타일 키 · `setProperty()` 셋을 정의로 모아 `var(--x)` 전부와 대조한다. 템플릿으로 이름을 조립하는 자리(`var(--t-${type}-soft)`)는 정적으로 못 푸니 건너뛴다. **fallback 이 있어도 위반** — 조용히 다른 값으로 돌아가서 더 안 잡힌다.
- **`type-literal`** — 리터럴이 생긴 진짜 이유는 **램프에 이름이 없어서**였다. `--text-xs~3xl` 은 램프의 일곱 단에만 이름을 주는데, 이 앱이 제일 많이 쓰는 10~11px 구간(`--fs-0`~`--fs-4`)에는 이름이 아예 없었다. 이름이 없으면 손은 대괄호로 간다. `@theme inline` 에 `--text-fs-0..12` 를 더해 램프 전체를 노출했다 — CSS 가 `var(--fs-5)` 라 부르는 단을 TSX 는 `text-fs-5` 라 부른다. `line-height` 는 일부러 안 얹었다(대체 대상인 `text-[11px]` 이 글자 크기만 바꿨으므로, 얹으면 282곳이 조용히 재조판된다).
- **`icon-size-class`** — 대문자 컴포넌트에 붙은 `w-N h-N` 만 잡는다. 소문자 태그(`<span className="w-2 h-2">`)는 점·아바타·스위치라 램프와 무관하다.
- **`motion-literal`** — 여러 줄 선언(`transition:\n  a,\n  b;`)을 봐야 해서 역시 별도 패스. `design-ignore` 는 선언이 걸친 줄 **과 그 앞 3줄** 에서 찾는다(블록 주석으로 사유를 적으면 자연히 선언 위에 놓이므로). **`animation:` 은 일부러 안 본다** — keyframe 주기(맥동 29개, 0.7~2.4s)는 상호작용 램프가 아닌 별도 축이고 그 램프는 아직 없다.

### 죽어 있던 것 (25곳)

| 토큰 | 어디서 | 실제 증상 |
|---|---|---|
| `--line`, `--shadow-soft` | `code.css` ×4 | **Monaco 호버·시그니처 팝업에 테두리도 그림자도 없었다** — 코드 위에 배경색만 얹혀 있었다 |
| `--text-1` | 7곳 | hover 색 무효, 그리고 `ErrorBoundary`·`TerminalErrorBoundary` — **크래시 화면 제목** |
| `--font-mono` | `tray.css` ×3 | 트레이 팝오버의 코드·경로만 본체와 다른 서체 |
| `--r-1`·`--r-2`·`--bg` | `nav-ia.css` | 통째로 다른 시스템의 어휘였다. `var(--fs-2, 12px)` 인데 실제 `--fs-2` 는 10.5px — fallback 이 거짓말을 하고 있었다 |
| `--surface-2` | TSX ×2 | fallback 이 순수 검정(`rgba(0,0,0,.02)`)이라 `ink-shadow` 규칙과 같은 이유로 금지 대상 |
| `--pc-text` | `home.css:692` | 오타. 같은 파일 `:1008` 이 이미 `var(--pc, var(--accent-text))` 관용구를 쓴다 |
| `--chart-1..5` | `App.css` ×5 | `@theme inline` 이 매핑만 하고 정의가 없었다. `chart-*` 유틸리티 사용처 0 → 삭제 |

### 램프 정리 (게이트가 초록이 되려면 함께 가야 하는 것)

- **전이 40종 → 램프**. 접는 기준은 값이 아니라 **역할**: 색 계열(background·color·border-color·box-shadow·opacity)은 hover 응답이니 전부 `--dur-1`, 기하(transform·width·left)만 값에 맞는 단으로. 36곳 치환.
- `@theme inline --ease-out` 이 은퇴한 곡선 `cubic-bezier(0.22,0.61,0.36,1)` 에 고정돼 `tokens.css` 와 갈라져 있었다 — 주석이 "값을 바꿀 때 반드시 함께" 라고 적어 둔 바로 그 자리다. 동기화.
- 죽은 `--radius-card|button|chip` 삭제(소비처 0). 주석의 "shadcn 유틸리티가 읽는다" 는 `--radius`(단수) 얘기였고, 이 셋은 `@theme` 이 아니라 `:root` 에 있어 `rounded-*` 유틸리티도 안 생긴다. 램프 밖 값(16·8px)을 **이름으로 정당화**하고 있어서 곡률 lint(선언만 본다)를 통과하던 자리다.
- 램프 값을 숫자로 복사한 `z-index: 200` 둘(`App.css`·`bootsplash.css`)과 `z-[1000]`(`Toaster`) → `var(--z-command)` / `z-top`.
- `CommandPalette`·`SettingsPanel` 이 손으로 좁힌 `React.ComponentType<{ className?: string }>` 을 쓰고 있어 아이콘이 `size` 를 못 받았다 → 공유 `IconComponent` 로.

## 검증

- 게이트 5종(undefined-var·type-literal·icon-size-class·z-literal·motion-literal)을 임시 probe 파일로 **음성 테스트** — 여러 줄 전이 포함 전부 발화하고 정상 줄은 통과함을 확인한 뒤 probe 제거.
- `pnpm typecheck` · `pnpm test`(192 파일 2,476개) · `pnpm lint`(6게이트, 0 errors) · `pnpm build` 각각 exit 0.
- 병렬 세션이 같은 워킹트리에서 Rust·skills 를 고치는 중이라, 겹치는 6개 파일의 diff 에 내 변경 신호가 0건임을 확인하고 경로를 명시해 커밋했다.