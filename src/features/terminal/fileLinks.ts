/**
 * 터미널 출력에서 `파일:줄` 참조를 찾아내는 순수 스캐너.
 *
 * 컴파일러·테스트 러너·린터가 쏟아내는 `src/lib/foo.ts:42:7` 을 ⌘클릭으로
 * 열 수 있게 하는 게 목적이다.
 *
 * # 신뢰 경계
 *
 * 여기서 뽑은 경로는 **터미널로 흘러든 임의의 바이트**다. 그래서 이 모듈은
 * 후보를 표시할 뿐이고, 실제 열기는 백엔드 `open_in_editor` 가 `secure_join`
 * 으로 프로젝트 루트 안쪽인지 다시 판정한다. 여기서도 명백히 위험한
 * 형태(절대경로·`..` 포함·URL 스킴)는 애초에 링크로 만들지 않는다 —
 * 클릭했는데 거절당하는 링크는 UI 로서 거짓말이다.
 */

export interface FileRef {
  /** 프로젝트 루트 기준 상대경로. */
  path: string;
  /** 1-based 줄 번호. 없으면 null. */
  line: number | null;
  /** 원문에서의 시작 인덱스 (0-based). */
  start: number;
  /** 원문에서의 끝 인덱스 (배타적). */
  end: number;
}

/**
 * `path/to/file.ext`, 뒤에 `:12` 또는 `:12:5` 가 붙을 수 있다.
 *
 * - 확장자를 요구한다. 없으면 `foo:1` 같은 일반 텍스트가 전부 링크가 된다.
 * - 경로 문자는 공백·따옴표·괄호를 뺀 것만 — 터미널 출력은 보통 이 안에 있다.
 */
const FILE_REF =
  /(?:^|[\s'"(\[<])((?:\.{1,2}\/)?(?:[\w.@+-]+\/)*[\w.@+-]+\.[A-Za-z]\w{0,9})(?::(\d+))?/g;

/** 링크로 만들지 않는 경로 — 클릭해도 백엔드가 거절할 것들. */
function isRejectable(path: string): boolean {
  if (path.startsWith("/") || path.startsWith("~")) return true; // 절대경로
  if (/(^|\/)\.\.(\/|$)/.test(path)) return true; // 상위 탈출
  if (/^[A-Za-z]:[\\/]/.test(path)) return true; // Windows 드라이브 절대경로
  return false;
}

/** `./` 접두사를 벗긴다 — `secure_join` 은 받아주지만 표시가 지저분하다. */
function normalize(path: string): string {
  return path.startsWith("./") ? path.slice(2) : path;
}

/**
 * 한 줄에서 파일 참조를 모두 찾는다. 반환 인덱스는 **입력 문자열 기준 0-based**
 * 다 — xterm 링크 프로바이더는 1-based 열을 요구하므로 호출부에서 +1 한다.
 */
export function scanFileRefs(text: string): FileRef[] {
  const out: FileRef[] = [];
  FILE_REF.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FILE_REF.exec(text)) !== null) {
    const [whole, rawPath, lineStr] = match;
    // URL 은 WebLinks 애드온 담당 — `https://x.com/a.js` 를 가로채지 않는다.
    const before = text.slice(0, match.index + whole.indexOf(rawPath));
    if (/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S*$/.test(before)) continue;
    if (isRejectable(rawPath)) continue;

    const pathStart = match.index + whole.indexOf(rawPath);
    const parsed = lineStr ? Number.parseInt(lineStr, 10) : Number.NaN;
    const line = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
    // 줄 번호까지 범위에 넣어야 `foo.ts:42` 전체가 클릭 가능해진다.
    const consumed = rawPath.length + (lineStr ? lineStr.length + 1 : 0);
    out.push({
      path: normalize(rawPath),
      line,
      start: pathStart,
      end: pathStart + consumed,
    });
  }
  return out;
}
