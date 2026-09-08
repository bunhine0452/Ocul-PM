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
  /(?:^|[\s'"([<])((?:\.{1,2}\/)?(?:[\w.@+-]+\/)*[\w.@+-]+\.[A-Za-z]\w{0,9})(?::(\d+))?/g;

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

// ─────────────────────────────────────────────────────────────────────────────
// 문자열 인덱스 → 버퍼 열 (2026-09-07)
// ─────────────────────────────────────────────────────────────────────────────
//
// `scanFileRefs` 의 인덱스는 **문자 수**고 xterm 의 링크 범위는 **셀 수**다.
// 한글·이모지는 한 문자가 두 셀을 먹으므로 둘은 같지 않다. 예전에는 문자
// 인덱스를 그대로 열로 썼고, 그래서 한글이 섞인 줄에서는 링크 상자가 실제
// 경로보다 **왼쪽으로 밀렸다** — 경로 위에 마우스를 올려도 밑줄이 안 그려지고,
// 엉뚱한 자리에서 손 모양 커서가 떴다. Claude Code 처럼 한국어로 말하면서
// 경로를 뱉는 도구에서는 사실상 모든 줄이 그랬다.
//
// 그래서 줄을 **셀 단위로 직접 읽어** 문자 하나가 어느 열에서 시작해 어느
// 열에서 끝나는지 함께 만든다. `translateToString` 은 그 대응을 돌려주지
// 않는다 (공개 타입에 out 파라미터가 없다).

/** xterm `IBufferCell` 중 여기서 쓰는 부분만. */
export interface CellLike {
  getChars(): string;
  getWidth(): number;
}

/** xterm `IBufferLine` 중 여기서 쓰는 부분만. */
export interface BufferLineLike {
  readonly length: number;
  getCell(x: number, cell?: CellLike): CellLike | undefined;
}

export interface LineColumns {
  /** 줄의 텍스트 — `translateToString(true)` 와 같은 문자열. */
  text: string;
  /** `text[i]` 가 시작하는 열 (0-based). */
  startCol: number[];
  /** `text[i]` 가 끝나는 열 (0-based, 포함). 넓은 문자는 시작+1. */
  endCol: number[];
}

/**
 * 버퍼 줄 하나를 텍스트 + 열 대응으로 읽는다.
 *
 * 폭 0 셀(넓은 문자의 오른쪽 반쪽)은 건너뛴다 — `translateToString` 과 같은
 * 규칙이라 나오는 문자열도 같다. 코드포인트가 비어 있는 셀은 공백 한 칸으로
 * 친다 (역시 같은 규칙).
 *
 * `cell` 은 재사용 버퍼다. 마우스가 움직일 때마다 불리는 경로라 줄마다
 * 셀 객체를 새로 만들지 않는다.
 */
export function readLineColumns(line: BufferLineLike, cell?: CellLike): LineColumns {
  let text = "";
  const startCol: number[] = [];
  const endCol: number[] = [];
  for (let col = 0; col < line.length; ) {
    const at = line.getCell(col, cell);
    if (!at) break;
    const width = at.getWidth();
    // 폭 0 은 앞 문자의 꼬리다 — 문자열에 기여하지 않는다.
    if (width === 0) {
      col += 1;
      continue;
    }
    const chars = at.getChars() || " ";
    for (let i = 0; i < chars.length; i++) {
      startCol.push(col);
      endCol.push(col + width - 1);
    }
    text += chars;
    col += width;
  }
  // 오른쪽 공백은 잘라 낸다 (`translateToString(true)`). 인덱스는 앞에서부터라
  // 대응 배열은 손대지 않아도 된다.
  const trimmed = text.replace(/\s+$/, "");
  return { text: trimmed, startCol, endCol };
}
