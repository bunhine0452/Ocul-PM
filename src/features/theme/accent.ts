/**
 * 시스템 강조색 → 강조 5토큰 (Phase 4 `#system-accent`).
 *
 * `follows_system_accent: true` 인 테마는 `--accent` 계열을 직접 적지 않고
 * macOS 시스템 강조색에서 **유도**한다. 유도 규칙은 `tokens.css` 의
 * `[data-accent]` 팔레트가 이미 보여 준 것과 같다: 라이트 가족은 기준색을
 * 조금씩 어둡게, 다크 가족은 밝게 — 배경 대비를 유지하기 위해서다.
 *
 * 순수 함수다. 색 공간 변환 라이브러리를 들이지 않는다 (sRGB 선형 믹스로
 * 충분하고, 값이 결정적이라 테스트가 단순하다).
 */
import type { ThemeFamily } from "./schema";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** `#rgb` · `#rrggbb` (알파는 무시) → `Rgb`. 파싱 실패는 `null`. */
export function parseHex(hex: string): Rgb | null {
  const raw = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]+$/.test(raw)) return null;
  const expand = (s: string) => Number.parseInt(s.length === 1 ? s + s : s, 16);
  if (raw.length === 3 || raw.length === 4) {
    return { r: expand(raw[0]), g: expand(raw[1]), b: expand(raw[2]) };
  }
  if (raw.length === 6 || raw.length === 8) {
    return { r: expand(raw.slice(0, 2)), g: expand(raw.slice(2, 4)), b: expand(raw.slice(4, 6)) };
  }
  return null;
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

/** `ratio` 만큼 `target` 쪽으로 섞는다 (0 = 그대로, 1 = target). */
export function mix(color: Rgb, target: Rgb, ratio: number): Rgb {
  const t = Math.max(0, Math.min(1, ratio));
  return {
    r: clamp255(color.r + (target.r - color.r) * t),
    g: clamp255(color.g + (target.g - color.g) * t),
    b: clamp255(color.b + (target.b - color.b) * t),
  };
}

const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

export function toHex({ r, g, b }: Rgb): string {
  const h = (n: number) => clamp255(n).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function toRgba({ r, g, b }: Rgb, alpha: number): string {
  return `rgba(${clamp255(r)},${clamp255(g)},${clamp255(b)},${alpha})`;
}

/**
 * 기준색 하나 → `--accent` 계열 5토큰.
 *
 * 라이트: 기준색이 그대로 강조, 눌린 상태는 8% 어둡게, 글자용은 16% 어둡게.
 * 다크: 어두운 배경에 앉히려 22% 밝힌 값이 강조가 되고, 글자용은 더 밝힌다.
 * soft/ring 은 같은 색의 알파 — 표면 위에 얹히는 값이라 hex 가 아니어야 한다.
 */
export function deriveAccentTokens(baseHex: string, family: ThemeFamily): Record<string, string> {
  const base = parseHex(baseHex);
  if (!base) return {};
  if (family === "light") {
    return {
      "--accent": toHex(base),
      "--accent-strong": toHex(mix(base, BLACK, 0.08)),
      "--accent-text": toHex(mix(base, BLACK, 0.16)),
      "--accent-soft": toRgba(base, 0.14),
      "--accent-ring": toRgba(base, 0.35),
    };
  }
  const lifted = mix(base, WHITE, 0.22);
  return {
    "--accent": toHex(lifted),
    "--accent-strong": toHex(mix(base, WHITE, 0.14)),
    "--accent-text": toHex(mix(base, WHITE, 0.42)),
    "--accent-soft": toRgba(lifted, 0.16),
    "--accent-ring": toRgba(lifted, 0.4),
  };
}
