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
  for (const rule of RULES) {
    if (!rule.ext.test(file)) continue;
    if (ALLOW[rule.id]?.has(rel)) continue;
    lines.forEach((line, i) => {
      if (!rule.re.test(line)) return;
      if (/design-ignore\s*--/.test(line)) return;
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
