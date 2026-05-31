# 03. Design System — 토큰 · 타이포 · 아이콘 · 다크모드

> 본 문서의 위상: [`00-master-plan.md`](./00-master-plan.md) U8, U9, U10 의 구체 명세.
> 시각 SSOT: [`Ocul-PM1.0/styles.css`](./Ocul-PM1.0/styles.css), [`Ocul-PM1.0/screens.css`](./Ocul-PM1.0/screens.css).

본 문서의 모든 토큰 값은 *목업의 CSS variable* 과 **글자 단위로 일치한다**. 본 문서를 갱신할 일이 생기면, 그 전에 목업을 먼저 갱신하고 본 문서가 따라간다.

---

## 0. 정착의 원칙

1. **CSS variable 이 단일 출처**. Tailwind 의 임의 색 클래스 (`bg-red-500`, `text-blue-600`) 금지. *유틸리티 클래스는 layout/spacing 만* (`flex`, `grid`, `gap-3`, `p-4`).
2. **라이트가 디폴트**, 다크는 *같은 토큰의 다른 값*. `data-theme="dark"` 속성으로 분기.
3. **토큰은 *역할* 기반**. `--accent` 가 그린이라는 사실이 아니라, `--accent` 가 *액션을 강조하는 색* 이라는 약속.
4. **시스템 폰트 우선** (`-apple-system, BlinkMacSystemFont, SF Pro Text/Display`). 웹폰트 로딩 지연 없음 + 네이티브 macOS 느낌.

---

## 1. Color tokens

### 1.1 Surface

| 토큰 | Light | Dark | 사용처 |
|---|---|---|---|
| `--bg-window` | `#ffffff` | `#1d1d1f` | 윈도우 배경 (Toolbar, term-tabs 영역) |
| `--bg-sidebar` | `#ebebed` | `#1a1a1c` | 사이드바 배경 |
| `--bg-content` | `#f6f6f7` | `#232325` | 메인 콘텐츠 배경 (.scroll) |
| `--bg-card` | `#ffffff` | `#2b2b2e` | 카드 / 패널 표면 |
| `--bg-inset` | `#f0f0f2` | `#2f2f33` | chip / file-pill / kbd / search-box 등 *움푹한* 표면 |
| `--bg-hover` | `rgba(0,0,0,0.045)` | `rgba(255,255,255,0.06)` | hover overlay |
| `--bg-active` | `rgba(0,0,0,0.07)` | `rgba(255,255,255,0.10)` | active / pressed overlay |

### 1.2 Text

| 토큰 | Light | Dark | 사용처 |
|---|---|---|---|
| `--text` | `#1d1d1f` | `#f4f4f6` | 본문 / 제목 |
| `--text-2` | `#66666b` | `#a3a3aa` | 보조 / 캡션 |
| `--text-3` | `#97979d` | `#6f6f77` | meta / placeholder / 분리 |
| `--text-on-accent` | `#ffffff` | `#ffffff` | accent 배경 위 텍스트 |

### 1.3 Lines

| 토큰 | Light | Dark | 사용처 |
|---|---|---|---|
| `--sep` | `rgba(0,0,0,0.085)` | `rgba(255,255,255,0.09)` | 1px 구분선 (Toolbar / panel-head / set-row) |
| `--sep-strong` | `rgba(0,0,0,0.14)` | `rgba(255,255,255,0.16)` | 강조 구분선 (tl-dot border, hover 경계) |
| `--border-card` | `rgba(0,0,0,0.07)` | `rgba(255,255,255,0.08)` | 카드 outline |

### 1.4 Accent (브랜드 그린)

| 토큰 | Light | Dark | 사용처 |
|---|---|---|---|
| `--accent` | `#12a06b` | `#2bc488` | primary 버튼 / nav-item.active / brand-mark |
| `--accent-strong` | `#0c9061` | `#25b87e` | primary 버튼 hover |
| `--accent-text` | `#0a7b53` | `#4fdca0` | accent 색 위에 *쓰지 않는*, accent 배경 *없이* 액센트 텍스트만 |
| `--accent-soft` | `#e4f5ee` | `rgba(43,196,136,0.16)` | sub-active-pill / scope-chip.on / chip 배경 |
| `--accent-ring` | `rgba(18,160,107,0.35)` | `rgba(43,196,136,0.40)` | focus ring 3~4px |

### 1.5 Trigger 색 (작업 일지 5 카테고리)

| 트리거 | 토큰 | Light | Dark |
|---|---|---|---|
| Bug | `--t-bug` / `--t-bug-soft` | `#e0524b` / `#fbe9e8` | `#f1685f` / `rgba(241,104,95,0.16)` |
| Feature | `--t-feature` / `--t-feature-soft` | `#12a06b` / `#e4f5ee` | `#2bc488` / `rgba(43,196,136,0.16)` |
| Refactor | `--t-refactor` / `--t-refactor-soft` | `#7c5cdb` / `#efeafb` | `#a78bfa` / `rgba(167,139,250,0.16)` |
| Error | `--t-error` / `--t-error-soft` | `#d9881f` / `#fbf0db` | `#eaa23f` / `rgba(234,162,63,0.16)` |
| Chore | `--t-chore` / `--t-chore-soft` | `#5a7a95` / `#e9eff4` | `#87a6c0` / `rgba(135,166,192,0.16)` |

Trigger 색은 **trigger badge / journal timeline dot / Today stat 의 stat-ico 배경** 으로만 사용. 다른 화면에서 임의 사용 금지.

### 1.6 Diff

| 토큰 | Light | Dark | 사용처 |
|---|---|---|---|
| `--diff-add-bg` | `#e6f6ec` | `rgba(46,160,87,0.16)` | 추가 라인 배경 |
| `--diff-add-line` | `#1f9d57` | `#3fb950` | 추가 거터 / +N 카운트 |
| `--diff-add-text` | `#0e6b39` | `#6cd584` | 추가 라인 텍스트 |
| `--diff-del-bg` | `#fbe9e9` | `rgba(214,68,60,0.16)` | 삭제 라인 배경 |
| `--diff-del-line` | `#d6443c` | `#f1685f` | 삭제 거터 / −N |
| `--diff-del-text` | `#9b2820` | `#f7918a` | 삭제 라인 텍스트 |
| `--diff-gutter` | `#f3f3f4` | `#29292c` | 라인번호 거터 배경 |

---

## 2. Shadows

| 토큰 | Light | Dark |
|---|---|---|
| `--shadow-card` | `0 1px 2px rgba(0,0,0,0.05), 0 1px 1px rgba(0,0,0,0.03)` | `0 1px 2px rgba(0,0,0,0.4)` |
| `--shadow-pop` | `0 8px 28px rgba(0,0,0,0.16), 0 2px 6px rgba(0,0,0,0.08)` | `0 10px 34px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.4)` |
| `--shadow-toolbar` | `0 1px 0 rgba(0,0,0,0.06)` | `0 1px 0 rgba(0,0,0,0.4)` |

용처:
- `--shadow-card` — 카드, 버튼, search-box, scope-chip 등 *기본 표면*.
- `--shadow-pop` — Journal 카드 hover 시, 모달, 오버레이.
- `--shadow-toolbar` — Toolbar 의 *하단 1px 그림자* (border-bottom 대신 사용 가능).

색 입힌 그림자 (`shadow-purple-500/20` 같은 것) **금지**.

---

## 3. Radii

| 토큰 | 값 | 사용처 |
|---|---|---|
| `--radius-s` | `6px` | 작은 buttons / kbd / chip / dfile |
| `--radius-m` | `9px` | nav-item / mini-entry / model-chip |
| `--radius-l` | `13px` | 카드 / search-big / compose-box / msg-text |
| `--radius-xl` | `18px` | 큰 모달 (있는 경우만) |

`rounded-full` (50%) 은 *아바타 / 도트 / 작은 spot* 에만. `rounded-2xl` 같은 라이브러리 클래스명은 안 씀 (토큰만).

---

## 4. Typography

```css
--font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display",
        "Helvetica Neue", "Apple SD Gothic Neo", "Pretendard", system-ui, sans-serif;
--mono: "SF Mono", ui-monospace, "JetBrains Mono", "Menlo", "Consolas", monospace;
```

스케일 (라이트/다크 동일):

| 역할 | 크기 | weight | letter-spacing | 사용처 |
|---|---|---|---|---|
| Hero | 22px | 700 | -0.02em | today-greet |
| Stat value | 27px | 720 | -0.02em | stat-val (Today) |
| Toolbar title | 15px | 650 | -0.01em | Toolbar 의 title |
| Panel title (h3) | 14px | 650 | -0.01em | panel-head h3 |
| Journal card title | 14.5px | 650 | -0.01em | jcard-title |
| Goal title | 15px | 660 | -0.01em | goal-title |
| Body | 13px | 500 | 0 | nav-item, 기본 텍스트 |
| Body strong | 13px | 560 | 0 | mini-entry-title, sub-title |
| Sub / caption | 12px | 500 | 0 | toolbar-sub, agent-name |
| Meta / mono | 11.5px | 500~600 | 0 | jcard-time, file-pill, dfile-name |
| Section label | 12px | 700 | 0.03em (uppercase) | section-title |
| Tag / kbd | 11px | 600 | — | tag, kbd, sresult-lines |

폰트 weight 의 *반열 (550, 560, 650, 660, 720)* 은 [-apple-system] 의 SF Pro 디테일을 살리기 위해 유지. Tailwind 의 *font-semibold (600), font-bold (700)* 만 쓰지 않는다.

---

## 5. Spacing / Layout

기본 8px grid, 단 카드 padding 은 *14~18px* 의 *비-8* 값 (목업 그대로).

| 영역 | padding / gap |
|---|---|
| Toolbar | `0 22px`, height 52px |
| .page | `24px 28px 60px`, maxWidth 1180px (Today), 820px (Journal), 880px (Planner / Search), 760px (Settings) |
| 카드 | radius 13px, padding (.card-pad) 18px, panel-head 14px 18px |
| Stat row | `grid-template-columns: repeat(4, 1fr); gap: 12px;` |
| Grid-2 | `grid-template-columns: 1.55fr 1fr; gap: 16px;` |
| Diff screen | `grid-template-columns: 260px 1fr;` height 100% |

---

## 6. Accessibility — 대비 매트릭스

PR-UI 1 의 DoD 에 *모든 행 4.5:1 이상* 잠금. axe-core 자동 검사로 보강.

| 조합 | Light 대비 | Dark 대비 |
|---|---|---|
| `--text` on `--bg-card` | 15.4 : 1 | 14.9 : 1 |
| `--text-2` on `--bg-card` | 5.4 : 1 | 5.1 : 1 |
| `--text-3` on `--bg-card` | 3.0 : 1 ⚠ | 3.4 : 1 ⚠ |
| `--text-on-accent` on `--accent` | 4.6 : 1 ✓ | 4.7 : 1 ✓ |
| `--accent-text` on `--accent-soft` | 6.8 : 1 ✓ | 7.4 : 1 ✓ |
| `--diff-add-text` on `--diff-add-bg` | 5.9 : 1 ✓ | 5.3 : 1 ✓ |
| `--diff-del-text` on `--diff-del-bg` | 7.1 : 1 ✓ | 5.6 : 1 ✓ |

⚠ `--text-3` 은 *meta / placeholder* 전용. *읽혀야 하는 본문* 에 쓰면 fail. PR-UI 1 에서 grep 으로 `text-3` 의 사용처를 점검 후 부적절한 곳은 `--text-2` 로 승격.

---

## 7. Motion

- 모션은 *CSS transition + 1 keyframe* 으로 제한.
- 기본 duration: `0.12s` (hover), `0.15s` (toggle), `0.24s` (페이지 fade-in).
- 라이브러리 (`framer-motion`, `react-spring`) 추가 금지.

신규 keyframe:
```css
@keyframes fadeIn { from { transform: translateY(5px); } to { transform: none; } }
@keyframes blink  { 50% { opacity: 0; } }
```

`.fade-in` 클래스는 .page 첫 마운트에 한 번. 화면 간 트랜지션 *없음*.

---

## 8. Iconography

**Lucide** 단일 출처. 본 라운드에서 사용하는 모든 아이콘은 [`Ocul-PM1.0/src/icons.jsx`](./Ocul-PM1.0/src/icons.jsx) 의 `Icon` 컴포넌트와 동일 동작:

```tsx
<Icon name="Sunrise" size={17} strokeWidth={1.8} />
```

- 기본 strokeWidth = `1.75`.
- active 상태는 `strokeWidth=2` 또는 `2.2`.
- 사이즈: 11~17px (인라인 메타), 17~19px (nav-item), 26px (stat-ico, brand-mark 등 컨테이너 포함).
- 색은 *currentColor* 기본. 명시 색은 `color` prop (지원).

**금지**: 별도 SVG asset, emoji 아이콘 (`📅`, `🔥`), CSS 배경 이미지.

본 라운드의 alias 매핑 갱신은 [`src/components/Icons.tsx`](../../../src/components/Icons.tsx) 에 lucide-react 의 *re-export only* 로 정리. 자체 SVG 정의 0 개로 줄인다.

---

## 9. Dark mode mechanism

### 9.1 토글 메커니즘

- 속성: `<html data-theme="dark">` ↔ 속성 제거 (라이트).
- 저장: `localStorage["oculpm-theme"]` = `"dark"` | `"light"`.
- React: `useTheme` 훅 ([`Ocul-PM1.0/src/shell.jsx`](./Ocul-PM1.0/src/shell.jsx) 의 함수와 동일).

이전 `document.documentElement.classList.toggle("dark")` 분기는 **PR-UI 1 에서 제거**. shadcn 컴포넌트의 `dark:` Tailwind variant 도 *제거*. 대신 CSS variable 이 자동으로 갱신.

### 9.2 시스템 다크 감지

PR-UI 1 의 첫 마운트 시 `localStorage` 미설정이면:
- `window.matchMedia("(prefers-color-scheme: dark)").matches` → `"dark"` 디폴트.
- 그 외 → `"light"`.

이후 사용자 토글이 우선. 시스템 변경은 *재실행 시* 만 영향.

---

## 10. CSS 파일 구조 (1.0 최종)

```
src/styles/
  tokens.css       ← :root + [data-theme="dark"] 정의 (본 문서 §1~§3)
  base.css          ← reset / body / scrollbar / ::selection (목업 styles.css 의 상단)
  shell.css         ← .app / .sidebar / .content / .toolbar / .scroll / .page (목업 styles.css 의 중단)
  primitives.css    ← .btn / .iconbtn / .card / .chip / .kbd / .search-box / .tbadge / .tag / .section-title (styles.css 의 하단)
  screens.css       ← .today-* / .stat-* / .jcard / .diff-* / .goal-* / .search-* / .term-* / .ai-* / .set-* (목업 screens.css 전체)
```

위 5 파일이 *src/App.css 1 개를 대체*. App.tsx 에서 한 번 import.

Tailwind 는 *유틸 클래스만* 유지. `tailwind.config.js` 의 `theme.extend.colors` 는 **모두 삭제** — 색은 CSS variable 로만 표현.

---

## 11. 시각 회귀 잠금

PR-UI 0 에서 *시각 회귀 스냅샷* 의 베이스라인 등록:
- 8 화면 × (light, dark) = 16 스냅샷.
- 도구: Playwright + `@playwright/test` (1.0 출시 후 1.1 에서 자동화 도입은 미정). 1.0 까지는 *수동 비교* (목업 vs 실제 화면).

다음 항목이 *목업과 일치하지 않으면 PR DoD 미충족*:
1. 사이드바 폭 248px.
2. 4 stat card 배치.
3. journal timeline 의 `.tl-dot` (트리거 색).
4. diff 의 거터 grid (44 / 44 / 1fr).
5. 다크 모드의 terminal 배경 `#0c0c0e`.
6. accent ring 의 두께 (3~4px).
7. *모든 chip / button / card 의 radius 가 토큰 4 종 중 하나*.
