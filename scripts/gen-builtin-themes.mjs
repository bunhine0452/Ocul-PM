#!/usr/bin/env node
/**
 * 내장 테마 5종을 `src/styles/tokens.css` 의 `[data-preset]` 블록에서 생성한다
 * (Osaurus 라운드 Phase 4 `#builtin-themes-as-json`).
 *
 * 왜 생성하는가: 프리셋은 CSS 에만 있었고 테마 스키마는 JSON 이다. 손으로
 * 옮겨 적으면 둘이 갈라지는 날이 반드시 온다. 여기서 뽑아 두면 **내장이 곧
 * 예제**가 되고, `src/__tests__/theme_schema.test.ts` 가 같은 파서로 다시 뽑아
 * "생성된 JSON == CSS 블록" 을 단언한다. tokens.css 를 고치면 그 테스트가
 * 깨지고, 고치는 방법은 이 스크립트를 한 번 돌리는 것이다:
 *
 *   node scripts/gen-builtin-themes.mjs
 *
 * 파서를 export 하는 이유가 그것이다 — 생성기와 검사기가 **같은 코드**를 봐야
 * "일치" 단언이 의미를 갖는다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

/** 내장 프리셋의 표시 이름과 가족 — `SettingsContext.PRESET_FAMILY` 와 같은 표. */
export const BUILTIN_PRESETS = [
  { id: "solarized", name: "Solarized", family: "light" },
  { id: "sepia", name: "Sepia", family: "light" },
  { id: "nord", name: "Nord", family: "dark" },
  { id: "dracula", name: "Dracula", family: "dark" },
  { id: "high-contrast", name: "High Contrast", family: "dark" },
];

/**
 * `[data-preset="<id>"] { --a: v; --b: v }` 블록 → `{ "--a": "v", … }`.
 *
 * 한 줄에 선언이 여럿 있는 형식(`--bg-card: #fdf6e3;    --bg-inset: #eee8d5;`)이라
 * 줄 단위가 아니라 `;` 단위로 자른다. 주석은 블록 안에 없다.
 */
export function parsePresetBlock(css, id) {
  const head = `[data-preset="${id}"] {`;
  const start = css.indexOf(head);
  if (start < 0) return null;
  const end = css.indexOf("}", start);
  if (end < 0) return null;
  const body = css.slice(start + head.length, end);
  /** @type {Record<string,string>} */
  const tokens = {};
  for (const decl of body.split(";")) {
    const idx = decl.indexOf(":");
    if (idx < 0) continue;
    const key = decl.slice(0, idx).trim();
    const value = decl.slice(idx + 1).trim();
    if (!key.startsWith("--") || !value) continue;
    tokens[key] = value;
  }
  return tokens;
}

/** CSS 전문 → 내장 테마 파일 5개 (`ThemeFile` 스키마 v1). */
export function buildBuiltinThemes(css) {
  return BUILTIN_PRESETS.map((preset) => {
    const tokens = parsePresetBlock(css, preset.id);
    if (!tokens) throw new Error(`tokens.css 에 [data-preset="${preset.id}"] 블록이 없습니다`);
    return {
      oculpm_theme: "v1",
      metadata: {
        id: preset.id,
        name: preset.name,
        version: "1.0",
        author: "Ocul-PM",
        // 내장은 파일 갱신 시각이 의미 없다 — 스키마를 채우되 고정값이라
        // 재생성이 매번 diff 를 만들지 않는다.
        created_at: "",
        updated_at: "",
      },
      family: preset.family,
      is_built_in: true,
      follows_system_accent: false,
      tokens: Object.fromEntries(Object.entries(tokens).sort(([a], [b]) => a.localeCompare(b))),
    };
  });
}

export function readTokensCss() {
  return readFileSync(join(ROOT, "src/styles/tokens.css"), "utf8");
}

function main() {
  const themes = buildBuiltinThemes(readTokensCss());
  for (const theme of themes) {
    const path = join(ROOT, "src/features/theme/builtin", `${theme.metadata.id}.json`);
    writeFileSync(path, `${JSON.stringify(theme, null, 2)}\n`, "utf8");
    console.log(`wrote ${path} (${Object.keys(theme.tokens).length} tokens)`);
  }
}

// 직접 실행할 때만 쓴다 — 테스트는 파서만 import 한다.
if (import.meta.url === `file://${process.argv[1]}`) main();
