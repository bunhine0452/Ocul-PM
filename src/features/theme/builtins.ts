/**
 * 내장 테마 5종 — `scripts/gen-builtin-themes.mjs` 가 `tokens.css` 에서 뽑은
 * JSON 을 그대로 싣는다 (Phase 4 `#builtin-themes-as-json`).
 *
 * 손으로 고치지 말 것. tokens.css 를 고쳤다면 스크립트를 다시 돌린다 —
 * `theme_schema.test.ts` 가 둘의 일치를 단언한다.
 *
 * 백엔드를 지나지 않는다: 내장은 **파일이 아니라 코드**이고, `theme_list` 는
 * 사용자가 만든 테마만 돌려준다.
 */
import type { ThemeFile } from "@/lib/bindings";

import dracula from "./builtin/dracula.json";
import highContrast from "./builtin/high-contrast.json";
import nord from "./builtin/nord.json";
import sepia from "./builtin/sepia.json";
import solarized from "./builtin/solarized.json";

export const BUILTIN_THEMES: readonly ThemeFile[] = [
  solarized as ThemeFile,
  sepia as ThemeFile,
  nord as ThemeFile,
  dracula as ThemeFile,
  highContrast as ThemeFile,
];

/** 내장 테마 id → 테마. 설정의 `theme` 값(`"nord"` 등)이 곧 이 id 다. */
export const BUILTIN_BY_ID: Readonly<Record<string, ThemeFile>> = Object.fromEntries(
  BUILTIN_THEMES.map((t) => [t.metadata.id, t]),
);
