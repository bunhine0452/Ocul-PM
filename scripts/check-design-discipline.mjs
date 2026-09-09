#!/usr/bin/env node
/**
 * Lint rule: "AI 가 만든 화면" 의 관용구가 되살아나지 않게 한다 (2026-09-02).
 *
 * 2026-09-02 de-AI 라운드에서 다음을 앱 전체에서 뺐다. 전부 한 번 뺀 뒤에도
 * 새 화면을 만들 때 손이 먼저 가는 것들이라, 규칙으로 못박지 않으면 돌아온다.
 * `check-no-localstorage.mjs` 와 같은 구조 — zero-dep Node, 주석은 건너뛴다.
 *
 *  1. Sparkles(✨) 아이콘 — "AI 기능이면 반짝이". 아이콘은 그 자리의 동작을 말한다
 *     (포맷=AlignLeft · 초안=PenLine · 갱신=RefreshCw · 새 프로젝트=FolderPlus · 모델=Cpu).
 *  2. 유리(backdrop-filter / backdrop-blur) — 스크림은 `.scrim`(어둡게만), 패널은 불투명.
 *     예외: src/mobile/mobile.css (폰 웹뷰의 sticky 헤더 — iOS 네이티브 관용구).
 *  3. Tailwind 팔레트 색(text-emerald-500 · bg-amber-500/10 …) — 테마 5종·액센트 6종을
 *     무시한다. 상태색은 토큰으로: text-(--ok-text) · bg-(--warn-soft) · border-(--danger)/40.
 *  4. 광택 그라데이션(linear-gradient(180deg, rgba(255,255,255,…))) 과 앰비언트
 *     radial-gradient — 버튼·활성 항목·캔버스는 단색이다.
 *
 * 2026-09-08 램프 라운드에서 다섯이 붙었다. 위 넷이 "AI 가 만든 화면" 을 막는다면,
 * 아래 다섯은 **아마추어가 만든 화면** 을 막는다 — 눈으로 고르다 보면 값이 자꾸
 * 늘어나서, 나란히 선 물건들이 저마다 1px 씩 다른 곡률·무게·자간을 갖게 되는 것.
 * 라운드 직전 실측은 둥글기 17종 · 무게 17종 · 자간 18종 · 아이콘 크기 16종이었다.
 * 값은 전부 tokens.css 의 램프에 접혔다.
 *
 *  5. 둥글기 리터럴(border-radius: 8px) — --radius-2xs|xs|s|m|l|xl|pill.
 *     50%(원)·0·calc(동심원)·var() 는 램프가 아니라 도형이라 통과한다.
 *  6. 무게 리터럴(font-weight: 650) — --fw-body|label|strong|bold.
 *     @font-face 의 `font-weight: 45 930` 은 지원 **범위** 선언이라 값 하나짜리만 본다.
 *  7. 자간 리터럴(letter-spacing: 0.04em) — --track-snug|tight|wide|caps|caps-lg.
 *  8. 아이콘 크기(size={14}) — 11 · 13 · 15 · 18 · 22 · 30 여섯 단. 클래스로
 *     주는 우회(`<Icon className="w-4 h-4">`)도 같이 본다 — 2026-09-09 에
 *     그 길로 64곳이 램프 밖(12·14·16·20px)에 나가 있었다.
 *  9. 검정 그림자(box-shadow: … rgba(0,0,0,…)) — 그림자는 잉크 계열이고
 *     --shadow-card|raise|pop|sheet|knob 가 그 값을 안다. 순수 검정은 테마·프리셋을
 *     무시한다 (스크롤바 손잡이가 같은 이유로 고정 회색이었다).
 *
 * 2026-09-09 일관성 라운드에서 열 번째가 붙었다. 위 아홉이 "손이 고른 값" 을
 * 막는다면, 이것은 **아무 값도 안 나오는 자리** 를 막는다.
 *
 * 10. 정의되지 않은 `var(--x)` — 이름이 없으면 그 선언 전체가 *invalid at
 *     computed-value time* 으로 무효화된다. 값이 틀리는 게 아니라 규칙이 통째로
 *     사라지므로, 눈으로는 "왜 테두리가 없지" 로만 보이고 원인이 안 보인다.
 *     실측(2026-09-09): `--line`·`--shadow-soft`(Monaco 호버 팝업의 테두리와
 *     그림자) · `--text-1` 7곳(크래시 화면 제목 포함) · `--font-mono`(트레이만
 *     다른 서체) · `--r-1`/`--r-2`/`--bg`(nav-ia.css 는 통째로 다른 시스템의
 *     어휘였다 — 그 파일은 {#fix-nav-ia} 에서 shell.css nav 블록으로 흡수됐다)
 *     — 17곳이 조용히 죽어 있었다.
 *     이 규칙은 한 줄이 아니라 파일 전체를 모아 봐야 하므로 RULES 가 아니라
 *     별도 패스다 (collectVars / reportUndefinedVars).
 *     **fallback 이 있어도 위반이다** — `var(--surface-2, rgba(0,0,0,.02))` 는
 *     조용히 다른 값으로 돌아가서 더 안 잡힌다.
 *
 * 16. 로딩을 빈 상태로 그리기(<EmptyState>{t("…loading")}</EmptyState>) —
 *     실측 **9곳**이고, 그중 다섯(NextTasks · WhatsNewCard ·
 *     ConversationHistoryModal · BinaryFileView · AutomationHistory)은 로딩
 *     분기와 빈 분기가 **같은 컴포넌트에 같은 props** 라 문자열만 달랐다.
 *     화면이 픽셀 단위로 같으면 "기다리면 채워진다" 와 "여기는 원래 비어
 *     있다" 가 구분되지 않는데, 둘은 정반대의 행동을 요구한다.
 *     `LoadingState` 는 같은 밀도를 그대로 입어 자리·치수를 유지하고
 *     스피너·role=status 로만 갈린다 ({#layout-loading-state}).
 *     **여러 줄 JSX 를 봐야 해서 별도 패스다** (checkLoadingAsEmpty) — 처음엔
 *     줄 단위 규칙으로 넣었다가 아홉 번째 자리를 통째로 놓쳤다.
 *
 * 17. 검색칸 상자를 다시 적기 — 실측 **13벌**(높이 23·24·26·26·26·28·29·30·
 *     30·32·32·60). 이름이 `-search`/`-filter` 로 끝나는 CSS 규칙이 `height`
 *     를 선언하면, 그건 `.search-box` 두 단(30 · `.sm` 26, primitives.css)
 *     밖에 열넷째 벌을 만든 것이다. TSX 쪽도 같은 죄가 인라인으로 나온다
 *     (`className="search-box" style={{ minWidth: 180 }}`) — 실제로 기본을
 *     쓰는 다섯 자리 중 넷이 그러고 있었다 ({#unify-search-input}).
 *     **선택자와 여러 줄 여는 태그를 봐야 해서 별도 패스다**
 *     (checkSearchBoxes). 예외는 `.home-search` 하나 — 시작 탭의 60px 밴드는
 *     상자가 아니라 밑줄이고, 그 결정은 home.css 가 직접 문서화한다.
 *
 * 18. 폭 기반 `@media` — 프로젝트 창 안에서 창 크기는 **화면이 쓸 수 있는 폭이
 *     아니다**. 사이드바 248px 나 터미널 도크를 열면 창은 그대로인데 화면만
 *     좁아진다. 실측 2곳(`.date-rail` 940 · `.sess-board` 900)이 그 눈먼
 *     기준이었고, 플래머가 `.pln-body` 로 세운 컨테이너 패턴은 2026-08-23
 *     이후로도 다른 화면에 퍼지지 않았다 ({#layout-container-query}).
 *     `@container screen (max-width: 640|460px)` 을 쓸 것 — `.page` 가 그
 *     컨테이너다(shell.css). `.content-main` 이 아닌 이유는 containment 가
 *     안쪽 `position: fixed` 의 기준을 바꾸기 때문이다(터미널 메뉴 셋 ·
 *     논의 스크림). 예외는 사이드바가 없는 전창 표면뿐:
 *     시작 탭(home.css)과 시작 창(welcome.css).
 *     **여러 줄 조건을 봐야 해서 별도 패스다** (checkViewportMedia).
 *
 * 2026-09-09 일관성 라운드가 더한 둘 (규칙 10 은 아래 별도 패스):
 *
 * 11. 타입 리터럴(text-[11px]) — 램프에 **이름이 없어서** 손이 대괄호로 간
 *     자리다. 실측 282곳(11px 186 · 10px 65 · 13px 15 …). App.css 의
 *     `@theme inline` 이 이제 램프 전체를 `text-fs-0..12` 로 노출한다 —
 *     CSS 가 `var(--fs-5)` 라 부르는 단을 TSX 는 `text-fs-5` 라 부른다.
 * 12. z 리터럴(z-[1000]) — `--z-sticky|strip|panel|dock|menu|popover|modal|
 *     command|top` 램프가 층을 안다. 숫자를 복사하면 두 물건이 같은 층에 앉는다.
 * 15. 무한 애니메이션 주기 리터럴(animation: x 1.2s … infinite) —
 *     --spin-dur|pulse-dur|breathe-dur 3단. 실측 29개가 열 가지 박자여서,
 *     에이전트가 도는 동안 사이드바 배지·탭·터미널이 **동시에 서로 다른
 *     박자로** 숨을 쉬었다. 한 번 지나가는 애니메이션(등장·퇴장)은 안 본다 —
 *     `infinite` 가 붙은 것만이 "여럿이 동시에 뜬다" 는 문제를 만든다.
 *
 * 14. 줄간격 리터럴(line-height: 1.6) — --lh-tight|snug|body|prose 4단.
 *     실측 12종이었고, 글자 크기는 램프에 접혀 있는데(648개 중 640개가 토큰)
 *     줄간격만 자유라 두 줄 이상 흐르는 한국어 블록마다 조판 밀도가 달랐다.
 *     `line-height: 1` 과 px 값은 통과한다 — 그건 조판이 아니라 고정 높이
 *     배지 안에서 글자를 수직 중앙에 두는 **도형**이다.
 *
 * 13. 전이 리터럴(transition: … 0.12s ease) — `--dur-1|2|3`(90·190·320ms) 과
 *     `--ease-out|in-out|spring` 이 값을 안다. 실측 40종이었고, 그래서 툴바를
 *     왼쪽에서 오른쪽으로 훑으면 버튼마다 반응 속도가 달랐다. 접는 기준은 값이
 *     아니라 **역할** 이다 — 색 계열(background·color·border-color·box-shadow·
 *     opacity)은 hover 응답이니 전부 --dur-1, 기하(transform·width·left)만
 *     값에 맞는 단으로. 이것도 여러 줄 선언을 봐야 해서 별도 패스다.
 *     **`animation:` 은 일부러 안 본다** — keyframe 주기(맥동 29개, 0.7~2.4s)는
 *     상호작용 램프가 아니라 별도 축이고, 그 램프는 아직 없다 (플랜의 {#ramp-pulse}).
 *
 * 예외 주석:  // design-ignore -- 사유   (같은 줄, TS/TSX)
 *            /* design-ignore -- 사유 *​/ (같은 줄, CSS)
 *
 * Exit 0 on clean, non-zero with a report on violations.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const SRC = new URL("../src", import.meta.url).pathname;
const SKIP_DIRS = new Set(["legacy", "__tests__"]);

/** 규칙별 예외 파일 (src 기준 상대 경로). 늘리지 말고 줄이는 방향으로만. */
const ALLOW = {
  glass: new Set(["mobile/mobile.css"]),
};

/**
 * 규칙 17 의 예외 — 검색칸이되 **상자가 아닌** 자리.
 * `.home-search`: 시작 탭은 바가 아니라 밴드 레이아웃이고, 포커스를 밑줄
 * 한 줄로 표현한다(면을 그리면 밴드의 여백감이 죽는다 — home.css 에 사유).
 * 늘리기 전에 "정말 상자가 아닌가" 를 먼저 물을 것. 30/26 중 하나면 예외가
 * 아니라 `.search-box` 나 `.search-box.sm` 이다.
 */
const SEARCH_BOX_ALLOW = new Set(["features/onboarding/home.css"]);

/**
 * 규칙 18 의 예외 — 사이드바도 도크도 없는 **전창** 표면. 여기서는 창 폭이
 * 곧 화면 폭이라 `@media` 가 옳다. 프로젝트 창 안의 화면을 여기 넣지 말 것.
 */
const VIEWPORT_MEDIA_ALLOW = new Set([
  "features/onboarding/home.css",
  "features/onboarding/welcome.css",
]);

/**
 * 규칙 10 의 예외 — 이 저장소 밖에서 정의되는 커스텀 프로퍼티의 접두사.
 * (Tailwind 런타임의 `--tw-*`, 브라우저/에디터가 심는 것들.)
 * 늘리기 전에 "정말 우리가 정의할 수 없는 값인가" 를 먼저 물을 것.
 */
const EXTERNAL_VAR_PREFIXES = ["--tw-", "--vscode-", "--monaco-", "--xterm-"];

const PALETTE =
  "(?:emerald|green|red|blue|indigo|violet|purple|pink|amber|yellow|orange|slate|gray|zinc|neutral|stone|sky|cyan|teal|lime|rose|fuchsia)";
const ICON_RAMP = new Set([11, 13, 15, 18, 22, 30]);
const RULES = [
  {
    id: "sparkles",
    ext: /\.tsx?$/,
    re: /\bSparkles(?:Icon)?\b/,
    hint: "✨ 대신 그 자리의 동작을 말하는 아이콘 (Icons.tsx 의 de-AI 주석 참고)",
  },
  {
    id: "glass",
    ext: /\.(tsx?|css)$/,
    re: /backdrop-filter|backdrop-blur/,
    hint: "유리 대신 .scrim / 불투명 패널",
  },
  {
    id: "palette",
    ext: /\.tsx?$/,
    re: new RegExp(`\\b(?:text|bg|border|ring|from|via|to|fill|stroke|shadow|outline|decoration)-${PALETTE}-\\d{2,3}\\b`),
    hint: "상태 토큰: text-(--ok-text) · bg-(--warn-soft) · border-(--danger)/40",
  },
  {
    id: "radius-literal",
    ext: /\.css$/,
    re: /border-radius: *(?![^;]*\bvar\()(?![^;]*\bcalc\()[^;]*\d+px/,
    hint: "--radius-2xs|xs|s|m|l|xl|pill (동심원은 calc(var(--radius-s) + Npx))",
  },
  {
    id: "weight-literal",
    ext: /\.css$/,
    // 값 하나짜리 선언만 — `font-weight: 45 930` 은 가변 폰트의 지원 범위다.
    re: /font-weight: *\d+ *[;}]/,
    hint: "--fw-body|label|strong|bold",
  },
  {
    id: "track-literal",
    ext: /\.css$/,
    re: /letter-spacing: *-?\d*\.?\d+(?:em|px)/,
    hint: "--track-snug|tight|wide|caps|caps-lg (0 은 그대로)",
  },
  {
    id: "icon-size",
    ext: /\.tsx?$/,
    re: /size=\{\d+\}/,
    test: (line) => {
      for (const m of line.matchAll(/size=\{(\d+)\}/g)) {
        if (!ICON_RAMP.has(Number(m[1]))) return true;
      }
      return false;
    },
    hint: "아이콘은 11 · 13 · 15 · 18 · 22 · 30 여섯 단",
  },
  {
    id: "icon-size-class",
    ext: /\.tsx?$/,
    // 대문자로 시작하면 컴포넌트 = 아이콘, 소문자면 태그 = 도형(점·아바타·스위치).
    // 도형은 램프와 무관하므로 `<span className="w-2 h-2">` 는 통과한다.
    re: /<[A-Z][A-Za-z0-9]*[^<>]*\bw-[0-9.]+ h-[0-9.]+/,
    hint: "아이콘 크기는 className 이 아니라 size={11|13|15|18|22|30}",
  },
  {
    id: "type-literal",
    ext: /\.tsx?$/,
    re: /text-\[\d+px\]/,
    hint: "text-fs-0..12 (App.css 의 @theme inline 이 --fs-* 램프를 그 이름으로 노출한다)",
  },
  {
    id: "loop-period-literal",
    ext: /\.css$/,
    re: /animation:[^;]*\b[0-9.]+m?s\b[^;]*\binfinite\b/,
    hint: "--spin-dur|pulse-dur|breathe-dur (한 번 지나가는 애니메이션은 대상이 아니다)",
  },
  {
    id: "leading-literal",
    ext: /\.css$/,
    // 소수만 본다 — 정수 1 과 px 은 도형이라 통과.
    re: /line-height:\s*\d+\.\d+/,
    hint: "--lh-tight|snug|body|prose (line-height: 1 과 px 은 도형이라 예외)",
  },
  {
    id: "z-literal",
    ext: /\.tsx?$/,
    re: /z-\[\d+\]/,
    hint: "--z-sticky|strip|panel|dock|menu|popover|modal|command|top (Tailwind 로는 z-top 등)",
  },
  {
    id: "ink-shadow",
    ext: /\.css$/,
    re: /box-shadow:[^;]*rgba?\(\s*0\s*[,)]/,
    hint: "--shadow-card|raise|pop|sheet|knob (그림자는 잉크 계열이지 순수 검정이 아니다)",
  },
  {
    id: "gloss",
    ext: /\.css$/,
    re: /linear-gradient\(\s*180deg\s*,\s*rgba\(\s*255\s*,\s*255\s*,\s*255|radial-gradient\(/,
    hint: "광택·앰비언트 그라데이션 대신 단색",
  },
];

/** 주석을 지운 소스 — 주석 속 언급(“backdrop-filter 를 쓰지 않는다”)은 위반이 아니다. */
function stripComments(src, isCss) {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  if (!isCss) {
    // `//` 줄 주석 — 문자열 안의 `https://` 를 지우지 않도록 따옴표 밖에서만.
    out = out
      .split("\n")
      .map((line) => {
        let quote = null;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (quote) {
            if (ch === "\\") i++;
            else if (ch === quote) quote = null;
          } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
          else if (ch === "/" && line[i + 1] === "/") return line.slice(0, i);
        }
        return line;
      })
      .join("\n");
  }
  return out;
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(join(dir, entry.name));
    } else if (/\.(tsx?|css)$/.test(entry.name)) {
      yield join(dir, entry.name);
    }
  }
}

/**
 * 규칙 10 — 파일 전체를 모아야 판정할 수 있는 것.
 *
 * `defined` 는 이름이 **생기는** 자리 셋: CSS 의 선언(`--x: …`, 한 줄 규칙 안이든
 * 어디든), TSX 인라인 스타일 객체의 키(`{ "--x": v }`), `setProperty("--x", …)`.
 * `used` 는 `var(--x` 전부다.
 */
const definedVars = new Set();
const usedVars = []; // { name, rel, line }

function collectVars(rel, src, isCss) {
  if (isCss) {
    for (const m of src.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)) definedVars.add(m[1]);
  } else {
    for (const m of src.matchAll(/["'](--[a-zA-Z0-9_-]+)["']\s*:/g)) definedVars.add(m[1]);
    for (const m of src.matchAll(/setProperty\(\s*["'](--[a-zA-Z0-9_-]+)["']/g)) definedVars.add(m[1]);
  }
  src.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/var\(\s*(--[a-zA-Z0-9_-]*)/g)) {
      // 템플릿으로 이름을 조립하는 자리 — `var(--t-${type}-soft)` 는 정적으로 못 푼다.
      if (line.slice(m.index + m[0].length).startsWith("$")) continue;
      usedVars.push({ name: m[1], rel, line: i + 1 });
    }
  });
}

const violations = [];
for await (const file of walk(SRC)) {
  const rel = relative(SRC, file);
  if (rel === "lib/bindings.ts") continue;
  const raw = await readFile(file, "utf8");
  const isCss = file.endsWith(".css");
  const src = stripComments(raw, isCss);
  collectVars(rel, src, isCss);
  const lines = src.split("\n");
  // 예외 표시는 **원본** 줄에서 찾는다. CSS 의 design-ignore 는 블록 주석 안에
  // 적는데, stripComments 가 그 주석을 이미 공백으로 지운 뒤라 지운 줄에서 찾으면
  // 영영 안 걸린다 — 머리 주석이 문서화한 탈출구가 CSS 에서만 죽어 있었다 (2026-09-08).
  const rawLines = raw.split("\n");
  if (isCss) checkTransitions(rel, src, rawLines);
  else checkLoadingAsEmpty(rel, src, rawLines);
  checkSearchBoxes(rel, src, rawLines, isCss);
  if (isCss) checkViewportMedia(rel, src, rawLines);
  for (const rule of RULES) {
    if (!rule.ext.test(file)) continue;
    if (ALLOW[rule.id]?.has(rel)) continue;
    lines.forEach((line, i) => {
      if (rule.test ? !rule.test(line) : !rule.re.test(line)) return;
      if (/design-ignore\s*--/.test(rawLines[i] ?? "")) return;
      violations.push(`${rel}:${i + 1}  [${rule.id}] ${line.trim().slice(0, 110)}\n      → ${rule.hint}`);
    });
  }
}

/**
 * 규칙 16 — 로딩을 빈 상태로 그리기. **여러 줄 JSX 를 봐야 한다**: 줄 단위
 * 규칙으로 넣었다가 `EntryDetailView` 의
 *
 *     <EmptyState align="start" style={{ padding: 16 }}>
 *       {t("common.loading")}
 *     </EmptyState>
 *
 * 한 곳을 통째로 놓쳤다 — 여는 태그와 문안이 다른 줄이면 안 걸린다. 여덟 곳을
 * 고치고 게이트를 세운 바로 그 라운드에서 아홉 번째가 규칙을 빠져나간 셈이라,
 * 이 규칙만은 줄이 아니라 **여는 태그부터 첫 문안까지**를 떠서 본다.
 */
function checkLoadingAsEmpty(rel, src, rawLines) {
  for (const m of src.matchAll(/<EmptyState\b[^>]*>\s*\{\s*t\(\s*"([^"]*)"/g)) {
    if (!/oading/.test(m[1])) continue;
    const line = src.slice(0, m.index).split("\n").length;
    // design-ignore 는 여는 태그 줄과 그 앞 3줄에서 찾는다 (checkTransitions 와 같은 규약).
    if (rawLines.slice(Math.max(0, line - 4), line).some((l) => /design-ignore\s*--/.test(l))) continue;
    violations.push(
      `${rel}:${line}  [loading-as-empty] <EmptyState …>{t("${m[1]}")}\n` +
        "      → 로딩은 <LoadingState> ({#layout-loading-state}) — 치수는 같은 밀도를 상속하고 스피너·role=status 로만 갈린다",
    );
  }
}

/**
 * 규칙 13 — 전이 선언은 여러 줄에 걸치므로(`transition:\n  a …,\n  b …;`) 줄 단위
 * RULES 로는 값을 못 본다. 선언 하나를 통째로 떠서 검사한다.
 * design-ignore 는 선언이 걸친 줄 **과 그 앞 3줄** 에서 찾는다 — 블록 주석으로
 * 사유를 적으면 자연히 선언 위에 놓이기 때문이다.
 */
/**
 * 규칙 17 — 검색칸 상자를 다시 적기. **줄 하나로는 못 본다**: CSS 는
 * 선언이 어느 선택자 밑에 있는지를 알아야 하고, TSX 는 className 과 style 이
 * 다른 줄에 있을 수 있다(규칙 16 이 아홉 번째 자리를 놓친 그 이유).
 *
 * 이름이 `-search`/`-filter` **로 끝나는** 것만 본다 — `.dfl-filter-clear`
 * (지우기 버튼 20px) · `.code-filter-ico` · `.diff-search-count` 는 상자가
 * 아니라 상자 **안의** 물건이라 자기 치수를 갖는 게 맞다.
 * 정의 자리(primitives.css)는 당연히 예외다 — 두 단이 거기서 나온다.
 */
function checkSearchBoxes(rel, src, rawLines, isCss) {
  if (SEARCH_BOX_ALLOW.has(rel)) return;
  const at = (i) => src.slice(0, i).split("\n").length;
  const ignoredNear = (line, back = 3) => {
    for (let i = Math.max(1, line - back); i <= line; i++) {
      if (/design-ignore\s*--/.test(rawLines[i - 1] ?? "")) return true;
    }
    return false;
  };

  if (isCss) {
    if (rel === "styles/primitives.css") return;
    // 선택자 { … } 한 덩이. 중첩 없는 평평한 CSS 라 여는 중괄호까지로 충분하다.
    for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const [, selector, body] = m;
      if (!/-(?:search|filter)(?![\w-])/.test(selector)) continue;
      const h = /(?:^|[;{\s])height\s*:\s*([^;}]+)/.exec(body);
      if (!h) continue;
      const line = at(m.index + m[0].indexOf(h[0]));
      if (ignoredNear(line)) continue;
      violations.push(
        `${rel}:${line}  [search-box] ${selector.trim().split("\n").pop().trim()} { height: ${h[1].trim()} }\n` +
          "      → 높이는 .search-box(30px) 또는 .search-box.sm(26px) 이 갖는다 (primitives.css). 자리가 셋째 높이를 요구하면 자리를 잘못 고른 것이다",
      );
    }
    return;
  }

  // TSX — className 에 search-box 가 있는 여는 태그가 인라인으로 치수를 덮는가.
  for (const m of src.matchAll(/<[A-Za-z][^>]*?\bclassName=(?:"[^"]*\bsearch-box\b[^"]*"|\{[^}]*\bsearch-box\b[^}]*\})[\s\S]*?>/g)) {
    const tag = m[0];
    const bad = /\bstyle=\{\{[^}]*\b(height|minHeight|width|minWidth|maxWidth|padding|borderRadius)\s*:/.exec(tag);
    if (!bad) continue;
    const line = at(m.index + bad.index);
    if (ignoredNear(line, 4)) continue;
    violations.push(
      `${rel}:${line}  [search-box] 인라인 ${bad[1]} 이 .search-box 를 덮는다\n` +
        "      → 치수는 두 단(.search-box / .search-box.sm)이 갖는다. 이 자리만의 폭이면 호출부 클래스로 (primitives.css)",
    );
  }
}

/**
 * 규칙 18 — 폭 기반 `@media`. 조건이 여러 줄에 걸칠 수 있어 줄 단위가 아니다.
 * `prefers-*`·`print`·`hover`·`pointer` 는 창 폭과 무관하니 안 본다.
 */
function checkViewportMedia(rel, src, rawLines) {
  if (VIEWPORT_MEDIA_ALLOW.has(rel)) return;
  for (const m of src.matchAll(/@media\s*([^{]+)\{/g)) {
    const cond = m[1].replace(/\s+/g, " ").trim();
    if (!/\b(?:min|max)-width\s*:/.test(cond)) continue;
    const line = src.slice(0, m.index).split("\n").length;
    let ignored = false;
    for (let i = Math.max(1, line - 3); i <= line; i++) {
      if (/design-ignore\s*--/.test(rawLines[i - 1] ?? "")) ignored = true;
    }
    if (ignored) continue;
    violations.push(
      `${rel}:${line}  [viewport-media] @media ${cond.slice(0, 70)}\n` +
        "      → 창 폭은 화면이 쓸 수 있는 폭이 아니다 (사이드바·터미널 도크). @container screen (max-width: 640|460px) — 컨테이너는 shell.css 의 .page",
    );
  }
}

function checkTransitions(rel, src, rawLines) {
  for (const m of src.matchAll(/transition(?:-duration|-timing-function)?\s*:\s*([^;{}]+)/g)) {
    const val = m[1];
    const startLine = src.slice(0, m.index).split("\n").length;
    const endLine = startLine + val.split("\n").length - 1;
    const bare = val.replace(/var\(--ease-[\w-]+\)/g, "");
    const hasTime = /(?<![\w.-])\d*\.?\d+m?s\b/.test(val);
    const hasEase = /(?<!-)\b(?:ease|ease-in|ease-out|ease-in-out|linear|cubic-bezier)\b/.test(bare);
    if (!hasTime && !hasEase) continue;
    let ignored = false;
    for (let i = Math.max(0, startLine - 4); i <= endLine; i++) {
      if (/design-ignore\s*--/.test(rawLines[i - 1] ?? "")) ignored = true;
    }
    if (ignored) continue;
    violations.push(
      `${rel}:${startLine}  [motion-literal] transition: ${val.split("\n").join(" ").replace(/\s+/g, " ").trim().slice(0, 80)}\n` +
        "      → --dur-1|2|3 · --ease-out|in-out|spring (색 계열은 전부 --dur-1, 기하만 값에 맞는 단)",
    );
  }
}

for (const { name, rel, line } of usedVars) {
  if (definedVars.has(name)) continue;
  if (EXTERNAL_VAR_PREFIXES.some((p) => name.startsWith(p))) continue;
  violations.push(
    `${rel}:${line}  [undefined-var] var(${name}) — 이 이름을 정의하는 곳이 없다\n` +
      "      → 선언 전체가 무효화된다 (테두리·그림자·색이 통째로 사라진다). fallback 이 있어도 마찬가지로 위반이다",
  );
}

if (violations.length > 0) {
  console.error(`✗ design discipline: ${violations.length} violation(s)\n`);
  for (const v of violations) console.error("  " + v);
  console.error("\n  규칙과 사유는 scripts/check-design-discipline.mjs 머리 주석에.");
  process.exit(1);
}
console.log("✓ design discipline: clean");
