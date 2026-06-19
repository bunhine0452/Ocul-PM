// 문서(docs) 뷰어의 링크/이미지 경로 해석. 순수 함수 — 단위 테스트로 검증한다.
//
// docs 문서들은 서로를 상대 경로로 참조한다: `./02-spec.md`, `../graph-upgrade/00.md`,
// `img/logo.png`. react-markdown 이 그대로 넘겨준 href/src 를 **현재 문서의 위치 기준**
// 으로 정규화해 프로젝트-루트 기준 경로(예: `docs/graph-upgrade/00.md`)로 바꾼다.

/** `scheme:` 로 시작하는 절대 URL (http:, https:, mailto:, tel:, data:, vscode: …). */
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

export type HrefKind =
  | { kind: "external"; href: string }
  | { kind: "anchor"; hash: string }
  | { kind: "relative"; path: string; hash: string | null };

/** `docs/sub/01-x.md` → `docs/sub`. 슬래시가 없으면 빈 문자열(루트). */
export function dirOf(relPath: string): string {
  const i = relPath.lastIndexOf("/");
  return i >= 0 ? relPath.slice(0, i) : "";
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * `href`(상대 경로)를 `currentRelPath`(프로젝트-루트 기준 현재 문서) 기준으로 정규화한다.
 * `.`/`..`/중복 슬래시를 접고, 선행 `/` 는 프로젝트 루트 기준으로 본다.
 * 결과는 선행 `./` 없는 프로젝트-루트 기준 슬래시 경로.
 */
export function resolveRelative(currentRelPath: string, href: string): string {
  const segs: string[] = href.startsWith("/")
    ? []
    : dirOf(currentRelPath).split("/").filter(Boolean);
  for (const raw of safeDecode(href).split("/")) {
    if (raw === "" || raw === ".") continue;
    if (raw === "..") {
      segs.pop();
      continue;
    }
    segs.push(raw);
  }
  return segs.join("/");
}

/**
 * 마크다운 링크 href 를 분류한다.
 *  - `external` — scheme: 절대 URL 또는 `//host` → 시스템 브라우저로.
 *  - `anchor`   — `#heading` → 현재 문서 내 스크롤.
 *  - `relative` — 그 외 → 현재 문서 기준으로 해석한 프로젝트-루트 경로(+선택적 #해시).
 */
export function classifyHref(href: string, currentRelPath: string): HrefKind {
  const h = href.trim();
  if (h.startsWith("#")) return { kind: "anchor", hash: h };
  if (SCHEME_RE.test(h) || h.startsWith("//")) return { kind: "external", href: h };

  const hashIdx = h.indexOf("#");
  const pathPart = hashIdx >= 0 ? h.slice(0, hashIdx) : h;
  const hash = hashIdx >= 0 ? h.slice(hashIdx) : null;
  return { kind: "relative", path: resolveRelative(currentRelPath, pathPart), hash };
}

const MD_RE = /\.(md|markdown|mdx)$/i;

/** 마크다운 문서로 이동 가능한 경로인지 (확장자 기준). */
export function isMarkdownPath(path: string): boolean {
  return MD_RE.test(path);
}

/** 표시용 라벨: 확장자만 제거하고 번호 접두(00- 등)는 순서 정보이므로 유지. */
export function displayName(fileName: string): string {
  return fileName.replace(MD_RE, "");
}
