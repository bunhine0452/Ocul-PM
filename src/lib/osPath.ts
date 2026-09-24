/**
 * OS 절대경로에서 **이름·부모**를 뽑는 단일 창구 (크로스플랫폼 라운드 {#ui-winpath-name}).
 *
 * 폴더를 골라 프로젝트를 들이면 이름을 경로의 마지막 조각으로 짓는다. 그 자리들이
 * `path.split("/")` 로만 잘라서, Windows(E2E)에서는 프로젝트 이름이
 * `D:\a\_temp\…\e2e-fixture` — 경로 전체가 됐다. 사용자 폴더·셸 cwd·첨부 파일처럼
 * **OS 가 준 경로**를 다루는 곳은 전부 여기를 부른다.
 *
 * 구분자는 OS 가 정한다: Windows 는 `\` 와 `/` 둘 다, macOS·Linux 는 `/` 만.
 * 유닉스에서 `\` 는 파일 이름에 쓸 수 있는 글자다 — 거기서 `\` 로 자르면 macOS 의
 * 표기가 바뀐다(D3). 저장소 안 상대경로(`.oculpm/…`·git·코드 트리)는 백엔드가 늘
 * `/` 로 주므로 이 헬퍼가 필요 없다.
 *
 * Windows 경로의 모양 셋을 받는다: 드라이브(`C:\Users\me`), UNC(`\\server\share\dir`),
 * 확장 길이(`\\?\C:\…` · `\\?\UNC\server\share\…` — 백엔드의 canonicalize 가 준다).
 */
import { getPlatform, type Platform } from "./platform";

function separatorPattern(platform: Platform): RegExp {
  return platform === "windows" ? /[\\/]+/ : /\/+/;
}

/** `\\?\` · `\\.\` 접두를 뗀다 — 표시할 이름에는 뜻이 없고 첫 조각을 `?` 로 만든다. */
function stripWindowsPrefix(path: string): string {
  if (/^\\\\\?\\UNC\\/i.test(path)) return `\\\\${path.slice(8)}`;
  if (path.startsWith("\\\\?\\") || path.startsWith("\\\\.\\")) return path.slice(4);
  return path;
}

/** 경로의 조각들 (빈 조각 없음). 루트뿐이면 빈 배열. */
export function pathSegments(path: string, platform: Platform = getPlatform()): string[] {
  const body = platform === "windows" ? stripWindowsPrefix(path) : path;
  return body.split(separatorPattern(platform)).filter(Boolean);
}

/**
 * 마지막 이름 — 끝의 구분자는 무시한다(`/a/b/` → `b`). 이름이 없으면(`/`) 빈 문자열이라
 * 부르는 쪽이 제 기본값을 고른다(`pathBaseName(p) || "project"`).
 */
export function pathBaseName(path: string, platform: Platform = getPlatform()): string {
  const segs = pathSegments(path, platform);
  return segs[segs.length - 1] ?? "";
}

/** 마지막 구분자의 자리 (없으면 -1). 이름과 부모를 원문 그대로 가를 때 쓴다. */
export function lastSeparatorIndex(path: string, platform: Platform = getPlatform()): number {
  const slash = path.lastIndexOf("/");
  return platform === "windows" ? Math.max(slash, path.lastIndexOf("\\")) : slash;
}

/** 이 OS 가 경로를 이어 적을 때 쓰는 구분자 — 표시용. */
export function displaySeparator(platform: Platform = getPlatform()): string {
  return platform === "windows" ? "\\" : "/";
}

/**
 * `path` 가 `root` 자신이거나 그 아래면 root 뒤의 상대 부분(원문 구분자 그대로,
 * 앞 구분자 없이), 아니면 `null`. 자신이면 빈 문자열.
 *
 * Windows 는 대소문자를 가리지 않는다(`D:\Proj` 와 `d:\proj` 는 같은 폴더) —
 * 셸이 알려 주는 cwd 는 사용자가 친 대로의 대소문자를 담을 수 있다.
 */
export function relativeUnder(
  root: string,
  path: string,
  platform: Platform = getPlatform(),
): string | null {
  if (platform !== "windows") {
    // macOS·Linux — 예전 판정 그대로 (D3).
    if (path === root) return "";
    return path.startsWith(`${root}/`) ? path.slice(root.length).replace(/^\//, "") : null;
  }
  const bare = root.replace(/[\\/]+$/, "");
  if (!bare) return null;
  // 대소문자·구분자 모양은 같은 폴더를 가리킨다 — 비교할 때만 접는다 (돌려주는 값은 원문).
  const fold = (s: string) => s.toLowerCase().replace(/\\/g, "/");
  if (fold(path.replace(/[\\/]+$/, "")) === fold(bare)) return "";
  if (fold(path.slice(0, bare.length)) !== fold(bare)) return null;
  const next = path.charAt(bare.length);
  if (next !== "/" && next !== "\\") return null;
  return path.slice(bare.length).replace(/^[\\/]+/, "").replace(/[\\/]+$/, "");
}
