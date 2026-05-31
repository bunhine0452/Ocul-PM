<!-- schema_version: 1 -->
# Ocul-PM 1.0 — UI 작업 전용 마스터 프롬프트 (v1)

> 본 프롬프트의 위상: 외부 LLM 에이전트 (Claude Code · Cursor · Antigravity · Gemini CLI) 가 **Final UI Update 라운드의 PR (PR-UI 0 ~ PR-UI 7) 을 작업할 때 *함께 읽는*** 시각 / IA / 금지 사항 규약.
> 작업 일지 작성 규칙 ([`.oculpm/agents/_template.md`](../../../.oculpm/agents/_template.md)) 은 *별개*. 본 프롬프트가 *시각* 을 다룬다면, 일지 템플릿은 *기록* 을 다룬다. **두 프롬프트 모두 활성** 으로 읽어야 함.
> 시각 SSOT: [`Ocul-PM1.0/`](./Ocul-PM1.0/) — 충돌 시 *목업이 옳다*.
> 의사결정 SSOT: [`00-master-plan.md`](./00-master-plan.md) §3 의 11 결정 + [`05-implementation-checklist.md`](./05-implementation-checklist.md) §0 의 잠금 표.

---

## 1. 당신의 역할

당신은 Ocul-PM 의 **1.0 출시 직전 UI 전면 개편** 라운드에서 PR 을 수행합니다. 이 라운드의 모든 PR 은 *시각 / IA / 상태 영속화* 에만 손댑니다. **백엔드 로직 · `.oculpm/` 파이프라인 · LLM provider · Planner DB · Settings keyring · `.oculpm/agents/_template.md`** 는 *건드리지 않습니다*.

PR 식별자는 `PR-UI 0` ~ `PR-UI 7`. 각 PR 의 DoD 는 [`05-implementation-checklist.md`](./05-implementation-checklist.md) 의 해당 표에서 확인. **DoD 가 모두 ☑ 가 아니면 머지 제안하지 마세요.**

---

## 2. 작업 전 *반드시* 읽는 문서

1. [`README.md`](./README.md) — 폴더 구조 / 진행 상태.
2. [`00-master-plan.md`](./00-master-plan.md) — SSOT. 11 결정.
3. [`01-ia-and-shell.md`](./01-ia-and-shell.md) — 사이드바 / IA / 단축키.
4. [`02-screen-specs.md`](./02-screen-specs.md) — *작업할 화면* 의 §만 읽어도 OK.
5. [`03-design-system.md`](./03-design-system.md) — 토큰 / 타이포 / 아이콘.
6. [`04-removal-and-migration.md`](./04-removal-and-migration.md) — 삭제 대상 + WorkspaceContext 마이그레이션.
7. [`05-implementation-checklist.md`](./05-implementation-checklist.md) — 본인 PR 의 DoD.
8. **`Ocul-PM1.0/styles.css`, `screens.css`, 화면별 `*.jsx`** — *시각 SSOT*. 문서와 충돌 시 목업이 옳다.

또한 *참고만* (수정 금지):
- [`../00-master-plan.md`](../00-master-plan.md) — Lite-W6 SSOT (선행 문맥).
- [`../04-ui-ux-redesign.md`](../04-ui-ux-redesign.md) — *옛 결정 (3 IA / 56px)*. 본 라운드에서 **명시적 reversal** 됨.

---

## 3. 절대 금지 사항

다음을 한 줄이라도 추가하면 PR 의 *DoD 미충족*. revert 후 재작업.

### 3.1 시각 토큰 / 색 관련

- ❌ Tailwind 의 임의 색 클래스 — `bg-red-500`, `text-blue-600`, `border-purple-300/40` 등.
- ❌ `tailwind.config.js` 의 `theme.extend.colors` 에 항목 추가.
- ❌ inline `style={{ background: "#hex" }}` 의 *액센트 / 트리거 / surface 색*. (단, 목업의 모델 칩 같은 *데이터 기반 색* 은 OK — agent 별 색은 데이터로 받음.)
- ❌ 그라데이션 (`linear-gradient`, `radial-gradient`) — 단 *목업이 이미 사용* 한 곳 (`.proj-icon` 의 accent gradient, `.week-bar > i` 의 accent 그라데이션) **제외**.
- ❌ 색 입힌 그림자 (`shadow-purple-500/20` 같은). `--shadow-*` 토큰만.

### 3.2 다크 모드

- ❌ `dark:` Tailwind variant. (`dark:bg-zinc-800` 등 모두 금지.)
- ❌ `classList.toggle("dark")` — `data-theme` 속성만.
- ❌ 별도 다크 분기 prop 또는 component (`<DarkCard>` 같은 이중 컴포넌트). CSS variable 로 *자동* 전환.

### 3.3 아이콘 / SVG

- ❌ 자체 SVG path 정의 (단, *목업의 thumbnail svg* 같은 *브랜드 마크* 제외).
- ❌ emoji 를 UI 라벨로 사용 (`📅`, `🔥`). 데이터 / 본문에 들어간 emoji 는 OK.
- ❌ `react-icons`, `heroicons` 등 추가 라이브러리.

### 3.4 의존성

- ❌ `framer-motion`, `react-spring`, `radix-themes`, `tailwind-variants`, `cva` 외 새 라이브러리.
- ❌ shadcn 컴포넌트 *교체*. wrapping 으로 토큰 매핑은 OK.
- ❌ npm `radix-ui` 의 *추가* 모듈 — 현재 설치된 것만 사용.

### 3.5 백엔드

- ❌ `src-tauri/` 안의 *기존* command 시그니처 변경.
- ❌ `.oculpm/agents/_template.md` 수정.
- ❌ migration 추가 (현재 010 까지 잠금. 본 라운드는 *DB 무변경*).
- ⚠ **신규 command 추가는 OK** (예: `get_today_brief`, `get_today_highlights`) — 단 `tauri-specta` 바인딩 재생성 필수.

### 3.6 IA / 단축키

- ❌ 사이드바를 *접을 수 있게* 만들기 (collapsible). 248px 고정.
- ❌ 새 IA 슬롯 추가 (현재 9 슬롯 + AiOverlay 가 *모두*).
- ❌ ⌘B / ⌘J / ⌘⇧J / ⌘⇧\ 단축키 복귀.
- ❌ `codeSubTab`, `CodeWorkbench` 의 *형제 sub-tab 패턴* 어떤 형태로든 재도입.

### 3.7 스코프

- ❌ "겸사겸사" 리팩터 — *현재 PR 의 DoD 밖* 코드 정리. 별도 PR 로.
- ❌ a11y / 시각과 *무관한* 백엔드 회귀 fix — 별도 PR 로.
- ❌ Lite-W6 의 *결정 재논의*. 본 라운드는 시각 라운드.

---

## 4. 반드시 지켜야 하는 패턴

### 4.1 색 / 표면

```tsx
// ✅ 토큰 사용
<div style={{ background: "var(--bg-card)", color: "var(--text)" }}>
<button className="btn primary">  {/* primitives.css 의 토큰 클래스 */}

// ❌ 금지
<div className="bg-white text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
<div style={{ background: "#fff" }}>
```

### 4.2 아이콘

```tsx
import { Sunrise } from "@/components/Icons";  // ← 단일 출구
<Sunrise className="w-5 h-5" />

// ❌ 금지
import { Sunrise } from "lucide-react";  // 직접 import
```

`src/components/Icons.tsx` 는 *lucide-react 의 re-export only*. 새 아이콘 사용 시 본 파일에 *export 추가만*.

### 4.3 라이트 / 다크 토글

```tsx
// ✅ ThemeContext
const { theme, setTheme } = useTheme();
setTheme(theme === "dark" ? "light" : "dark");
// ↓ 자동으로 document.documentElement.setAttribute("data-theme", theme);

// ❌ 금지
document.documentElement.classList.toggle("dark");
```

### 4.4 새 화면 추가 시 디렉토리

```
src/features/<name>/
  <Name>Screen.tsx       ← Toolbar + .scroll/.page 의 화면 컨테이너
  <Name>Card.tsx         ← 화면 내부 컴포넌트
  hooks.ts               ← 화면 전용 훅
```

`src/components/` 는 **여러 화면이 공유하는** 컴포넌트 (Sidebar, Toolbar, Icons, CommandPalette, GitBranchChip 등) 만.

### 4.5 영속화

화면별 state 가 *새로고침 후에도 같아야 한다* 면 **`WorkspaceContext` 의 영속 키 추가**. 영속 키는 [`02-screen-specs.md`](./02-screen-specs.md) §9 의 표에 *추가 후* 코드에 반영.

```ts
// ✅ Context 경유
const { state, setJournalFilter } = useWorkspace();

// ❌ 금지 — localStorage 직접 접근
localStorage.setItem("journal-filter", "feature");
```

### 4.6 단축키

```ts
// ✅ useGlobalShortcuts 의 등록
useGlobalShortcuts({
  onCmd5: () => setActiveView("search"),
});

// ❌ 금지 — 컴포넌트 안에서 keydown listener 직접 등록
useEffect(() => {
  window.addEventListener("keydown", ...);
});
```

화면 내부의 ⌘F / j-k 등 *focused-view 단축키* 만 화면 컴포넌트 안에서 등록 (단, *글로벌 단축키와 충돌 시 stop propagation*).

---

## 5. 작업 흐름

PR-UI <N> 을 시작할 때:

1. [`05-implementation-checklist.md`](./05-implementation-checklist.md) 의 해당 PR 표를 *복사해서 PR description* 에 넣는다.
2. **목업의 화면 jsx** 를 *먼저* 본다. 예: PR-UI 2 (Today) → [`Ocul-PM1.0/src/today.jsx`](./Ocul-PM1.0/src/today.jsx).
3. 목업의 CSS 클래스 (`.stat`, `.mini-entry`, `.week-bar` 등) 를 *그대로* 사용. 클래스 이름을 바꾸지 마세요.
4. React 컴포넌트 이름은 [`02-screen-specs.md`](./02-screen-specs.md) 의 §Layout 에 명시된 식별자를 우선.
5. `pnpm dev` 로 띄워 **목업과 시각 비교**. *layout shift / spacing / radius / shadow* 가 *목업과 다르면* 토큰을 잘못 쓴 것.
6. axe-core (vitest-axe) 자동 검사 통과 확인.
7. PR description 의 체크박스를 *작업 진행 중* 갱신. 완료 시 ☑ 로.
8. [`.oculpm/agents/_template.md`](../../../.oculpm/agents/_template.md) 의 trigger 에 해당하는 작업은 *반드시* journal entry 작성.

PR 완료 시:

- **반드시** [`05-implementation-checklist.md`](./05-implementation-checklist.md) §7 의 PR-UI 표 갱신 (상태 + 머지 해시).
- 새 결정이 있었다면 §0 에 추가 + 영향 받는 후속 문서 동기화.

---

## 6. 용어 사전 (카피 일관성)

본 라운드에서 사용되는 모든 카피는 다음 용어로 통일. *동의어 / 약어 사용 금지*.

| 권장 (✅) | 금지 (❌) | 비고 |
|---|---|---|
| 작업 일지 | 변경 로그, 체인지로그, Changelog, 활동 | journal entries 의 사용자 표시 |
| 변경 diff | diff, 변경사항, 변경분 | 화면 라벨 |
| 에이전트 | AI, LLM, 봇, 어시스턴트 | "외부 코딩 에이전트" 의 약어 |
| 일지 | entry, 항목, 기록물 | 단일 journal entry |
| 트리거 | 카테고리, 종류, 타입 | bug/feature/refactor/error/chore |
| 워크데이 | 영업일, 작업일, day | 사용자 정의 day boundary |
| 잡일 (chore) | 자질구레, 기타, misc | trigger 'chore' 한국어 |
| 잠금 / 잠긴다 | 락, 락걸림, freeze, lock | 결정의 잠금 |
| 사이드바 | 좌측 패널, 좌측 네비, sidebar | (영문 단어 그대로 OK) |
| Toolbar | 툴바, 헤더 | (영문 단어 그대로 OK) |
| 코드 검색 | semantic search, 의미 검색, code search | IA 라벨 |
| 다크 모드 / 라이트 모드 | 야간 모드, 어두운 테마, 다크 테마 | 모드 라벨 |
| Planner | 플래너, 기획, 계획 | (한 단어로 통일) |
| Today | 오늘 화면, 홈, 대시보드 | IA 라벨은 **Today**, hero 카피는 *"오늘"* OK |

화면 내 *데이터 표시* (예: tag 이름, 사용자 입력) 는 자유.

---

## 7. 자주 발생하는 실수

다음 4 가지를 LLM 이 가장 자주 틀립니다. 작업 전 점검.

### 7.1 Tailwind 다크 variant 의 *습관적* 추가

```tsx
// ❌ 무의식적으로 dark: 를 추가
<div className="bg-white dark:bg-zinc-800">

// ✅ 토큰만
<div style={{ background: "var(--bg-card)" }}>
// 또는 primitives.css 에 정의된 클래스
<div className="card">
```

### 7.2 lucide-react 직접 import

```tsx
// ❌
import { Search } from "lucide-react";

// ✅
import { Search } from "@/components/Icons";
```

`@/components/Icons.tsx` 에 *없는* 아이콘이 필요하면 *그 파일에 export 추가*. 직접 import 금지.

### 7.3 `data-theme` 대신 `.dark` class

```tsx
// ❌
<html className="dark">

// ✅
<html data-theme="dark">
```

ThemeContext 가 해주므로 *수동 변경할 일이 없어야 정상*. 만약 직접 변경해야 한다면 ThemeContext 가 잘못 설계된 것 — 그쪽을 수정.

### 7.4 화면 컴포넌트가 *Toolbar 를 직접 그림*

```tsx
// ❌ 각 화면이 div + h1 + 버튼으로 자체 헤더 만듦
<div className="flex h-12 px-5 border-b">
  <h1>Today</h1>
  ...
</div>

// ✅ Toolbar 컴포넌트 사용
<Toolbar title="Today" sub={project.today}>
  <button className="btn primary">오늘 변경 검토</button>
</Toolbar>
```

모든 화면이 *같은 Toolbar 컴포넌트* 를 써야 *툴바 통일성* 이 자동으로 유지됨.

---

## 8. PR 제출 직전 체크리스트

머지 제안 전 *반드시* 다음 명령어 모두 green:

```bash
pnpm typecheck   # TypeScript 오류 0
pnpm test        # vitest green
pnpm lint        # ESLint + lint:storage green
cargo test       # 백엔드 회귀 green (UI PR 이라도 백엔드 임포트 변화 시 영향)
```

그리고 *수동* 점검:

- [ ] 라이트 모드 + 다크 모드 둘 다 **목업과 시각적으로 동일**.
- [ ] 다크 토글 시 *layout shift 0* (DevTools Layers 패널).
- [ ] 사이드바 9 슬롯 + Toolbar + Scroll 영역의 *공간 비율 일치*.
- [ ] 추가한 색 / 폰트 / 그림자 모두 [`03-design-system.md`](./03-design-system.md) §1~§3 의 토큰.
- [ ] grep `dark:` → 본인 변경 줄에 0.
- [ ] grep `from "lucide-react"` → 본인 변경 줄에 0 (Icons.tsx 제외).
- [ ] grep `localStorage\\.` → 본인 변경 줄에 0 (ThemeContext.tsx / WorkspaceContext.tsx 제외).
- [ ] [`05-implementation-checklist.md`](./05-implementation-checklist.md) §7 의 진행 상태 표 갱신 + 머지 해시 기록 슬롯 준비.

---

## 9. 도움 요청 / 막힘

진행 중 막혔으면 다음 순서로:

1. **목업 jsx 를 다시 본다**. 거의 모든 답이 목업에 있음.
2. [`02-screen-specs.md`](./02-screen-specs.md) 의 해당 화면 §Edge / §Note.
3. [`04-removal-and-migration.md`](./04-removal-and-migration.md) §1 의 의존 그래프.
4. 그래도 막히면 *추측하지 말고* PR description 에 *open question* 으로 명시. 사용자 / 리뷰어 회신 대기.

**절대 추측하지 마세요**. 본 라운드는 *시각 잠금 라운드* — 임의의 시각 결정이 *후속 모든 PR 의 spec 을 흔든다*.

---

## 10. 본 프롬프트의 갱신

본 프롬프트는 *라이브* — 라운드 진행 중 새 패턴이 등장하면 *갱신*.

- 새 금지 사항 발견 시 §3 에 추가.
- 새 의무 패턴 등장 시 §4 에 추가.
- 자주 발생하는 새 실수 발견 시 §7 에 추가.

갱신 시:
- 본 파일 상단의 schema_version 을 *유지* (v1 그대로 — v2 는 *프롬프트 구조 자체* 가 바뀔 때만).
- [`05-implementation-checklist.md`](./05-implementation-checklist.md) §0 의 *카피 용어 사전* 항목 갱신도 함께.

---

## 11. 빠른 요약 (1 paragraph)

당신은 Ocul-PM 1.0 의 시각 라운드 PR 을 작업합니다. [`Ocul-PM1.0/`](./Ocul-PM1.0/) 목업이 시각 SSOT 입니다. [`00-master-plan.md`](./00-master-plan.md) 의 11 결정과 [`05-implementation-checklist.md`](./05-implementation-checklist.md) §0 의 잠금 표가 의사결정 SSOT 입니다. 백엔드 / `.oculpm/` / Settings 키체인 / migration 은 건드리지 마세요. Tailwind 임의 색 / `dark:` variant / lucide-react 직접 import / `classList.toggle("dark")` / `localStorage` 직접 접근은 금지. CSS variable 토큰 (`--bg-*`, `--text-*`, `--accent`, `--t-*`, `--diff-*`) 와 `@/components/Icons` 와 `useTheme` 와 `useWorkspace` 와 `useGlobalShortcuts` 만 사용. 막히면 추측 말고 PR open question.
