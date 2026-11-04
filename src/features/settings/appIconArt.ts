/**
 * 앱 아이콘 그림 — 한 벌의 모양(`landing/icon.svg`)에 색 벌만 바꾼다 (11-04).
 *
 * 설정 「표시 › 앱 아이콘」 의 미리보기와, Dock · 번들에 거는 PNG(`scripts/build-app-icons.mjs` 가 이 함수로
 * 그려 `src-tauri/icons/variants/<id>.png` 로 굽는다)가 같은 함수에서 나온다 — 미리보기와 실제 아이콘이
 * 어긋나지 않는다. 색을 바꾸면 스크립트를 다시 돌려 PNG 를 새로 굽는다.
 *
 * 기본(`color`)은 번들 아이콘 그대로라 PNG 가 없다(백엔드가 `None` 을 걸어 되돌린다).
 */

export const APP_ICON_IDS = ["color", "dark", "light", "mono", "blue", "violet", "rose", "orange", "teal"] as const;
export type AppIconId = (typeof APP_ICON_IDS)[number];

interface Palette {
  /** 타일 위 · 아래 그라디언트. */
  bg: [string, string];
  /** 가운데 은은한 빛 — 색과 불투명도. */
  glow: [string, number];
  /** 마크 그림자 색과 불투명도. */
  shadow: [string, number];
  /** 테두리 머리카락 선 — 색과 불투명도. */
  edge: [string, number];
  /** 동심 아크 바깥 · 가운데 · 안쪽, 그리고 가운데 점. */
  rings: [string, string, string];
  dot: string;
}

/* design-ignore -- 앱 아이콘 그림의 색 벌이다(앱 UI 토큰이 아니다). 바꾸면 build-app-icons 를 다시 돌린다. */
export const APP_ICON_PALETTES: Record<AppIconId, Palette> = {
  color: { bg: ["#0f5b43", "#073122"], glow: ["#2ec48d", 0.4], shadow: ["#02120c", 0.4], edge: ["#ffffff", 0.1], rings: ["#0c9061", "#2bc88a", "#ffffff"], dot: "#ffffff" },
  dark: { bg: ["#1c201e", "#070908"], glow: ["#2ec48d", 0.14], shadow: ["#000000", 0.5], edge: ["#ffffff", 0.1], rings: ["#0c9061", "#2bc88a", "#ffffff"], dot: "#ffffff" },
  light: { bg: ["#ffffff", "#e8ebe7"], glow: ["#2ec48d", 0.16], shadow: ["#0f3a2c", 0.16], edge: ["#000000", 0.08], rings: ["#a5dcc4", "#1fae76", "#0f5b43"], dot: "#0f5b43" },
  mono: { bg: ["#2b2b2a", "#0c0c0c"], glow: ["#ffffff", 0.07], shadow: ["#000000", 0.4], edge: ["#ffffff", 0.1], rings: ["#5a5a58", "#a6a6a3", "#ffffff"], dot: "#ffffff" },
  blue: { bg: ["#1f56b0", "#0a2558"], glow: ["#5b9cf0", 0.4], shadow: ["#020a1c", 0.4], edge: ["#ffffff", 0.1], rings: ["#2d6fd6", "#74acf6", "#ffffff"], dot: "#ffffff" },
  violet: { bg: ["#5a3bb0", "#25125a"], glow: ["#9b7cf0", 0.4], shadow: ["#0c041e", 0.4], edge: ["#ffffff", 0.1], rings: ["#7550dc", "#ab8ff6", "#ffffff"], dot: "#ffffff" },
  rose: { bg: ["#b0335a", "#4c0b22"], glow: ["#f07f9a", 0.38], shadow: ["#1c030b", 0.4], edge: ["#ffffff", 0.1], rings: ["#d6466f", "#f68ea8", "#ffffff"], dot: "#ffffff" },
  orange: { bg: ["#c25a1c", "#5a2306"], glow: ["#f6a15e", 0.38], shadow: ["#1f0b01", 0.4], edge: ["#ffffff", 0.1], rings: ["#e0702a", "#f8ac6c", "#ffffff"], dot: "#ffffff" },
  teal: { bg: ["#0e7078", "#033539"], glow: ["#4fd0d4", 0.38], shadow: ["#011315", 0.4], edge: ["#ffffff", 0.1], rings: ["#149aa2", "#5ad8db", "#ffffff"], dot: "#ffffff" },
};

export function isAppIconId(v: string): v is AppIconId {
  return (APP_ICON_IDS as readonly string[]).includes(v);
}

/**
 * 아이콘 SVG 문자열 — 1024 격자. `uid` 는 한 문서에 여럿 그릴 때 그라디언트 · 필터 id 가 겹치지 않게.
 * 모양 · 반지름 · 대시는 `landing/icon.svg` 와 같다(마크 1.4배 확대 포함).
 */
export function appIconSvg(id: AppIconId, uid: string, size = 1024): string {
  const p = APP_ICON_PALETTES[id];
  const bg = `ai-bg-${uid}`;
  const glow = `ai-glow-${uid}`;
  const sh = `ai-sh-${uid}`;
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
    `<defs>` +
    `<linearGradient id="${bg}" x1="512" y1="80" x2="512" y2="944" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${p.bg[0]}"/><stop offset="1" stop-color="${p.bg[1]}"/></linearGradient>` +
    `<radialGradient id="${glow}" cx="0.5" cy="0.48" r="0.55" gradientUnits="objectBoundingBox"><stop offset="0" stop-color="${p.glow[0]}" stop-opacity="${p.glow[1]}"/><stop offset="1" stop-color="${p.glow[0]}" stop-opacity="0"/></radialGradient>` +
    `<filter id="${sh}" x="200" y="200" width="624" height="640" filterUnits="userSpaceOnUse"><feDropShadow dx="0" dy="10" stdDeviation="16" flood-color="${p.shadow[0]}" flood-opacity="${p.shadow[1]}"/></filter>` +
    `</defs>` +
    `<rect x="80" y="80" width="864" height="864" rx="204" fill="url(#${bg})"/>` +
    `<rect x="80" y="80" width="864" height="864" rx="204" fill="url(#${glow})"/>` +
    `<rect x="81.5" y="81.5" width="861" height="861" rx="202.5" stroke="${p.edge[0]}" stroke-opacity="${p.edge[1]}" stroke-width="3"/>` +
    `<g transform="translate(512 512) scale(1.4) translate(-512 -512)">` +
    `<g filter="url(#${sh})" fill="none" stroke-linecap="round">` +
    `<circle cx="512" cy="512" r="190" stroke="${p.rings[0]}" stroke-width="40" stroke-dasharray="970 224" transform="rotate(125 512 512)"/>` +
    `<circle cx="512" cy="512" r="132" stroke="${p.rings[1]}" stroke-width="40" stroke-dasharray="640 190" transform="rotate(-40 512 512)"/>` +
    `<circle cx="512" cy="512" r="74" stroke="${p.rings[2]}" stroke-width="40" stroke-dasharray="330 135" transform="rotate(70 512 512)"/>` +
    `</g>` +
    `<circle cx="512" cy="512" r="22" fill="${p.dot}"/>` +
    `</g></svg>`
  );
}
