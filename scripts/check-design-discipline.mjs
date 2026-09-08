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
 *  8. 아이콘 크기(size={14}) — 11 · 13 · 15 · 18 · 22 · 30 여섯 단.
 *  9. 검정 그림자(box-shadow: … rgba(0,0,0,…)) — 그림자는 잉크 계열이고
 *     --shadow-card|raise|pop|sheet|knob 가 그 값을 안다. 순수 검정은 테마·프리셋을
 *     무시한다 (스크롤바 손잡이가 같은 이유로 고정 회색이었다).
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

const violations = [];
for await (const file of walk(SRC)) {
  const rel = relative(SRC, file);
  if (rel === "lib/bindings.ts") continue;
  const raw = await readFile(file, "utf8");
  const isCss = file.endsWith(".css");
  const src = stripComments(raw, isCss);
  const lines = src.split("\n");
  // 예외 표시는 **원본** 줄에서 찾는다. CSS 의 design-ignore 는 블록 주석 안에
  // 적는데, stripComments 가 그 주석을 이미 공백으로 지운 뒤라 지운 줄에서 찾으면
  // 영영 안 걸린다 — 머리 주석이 문서화한 탈출구가 CSS 에서만 죽어 있었다 (2026-09-08).
  const rawLines = raw.split("\n");
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

if (violations.length > 0) {
  console.error(`✗ design discipline: ${violations.length} violation(s)\n`);
  for (const v of violations) console.error("  " + v);
  console.error("\n  규칙과 사유는 scripts/check-design-discipline.mjs 머리 주석에.");
  process.exit(1);
}
console.log("✓ design discipline: clean");
