// 저장 시 정리 (B1) — 순수 모델.
//
// 설계 SSOT: docs/20260902_vscode-borrows/01-save-hygiene.md §B1.
// 근거: vscode/src/vs/workbench/contrib/codeEditor/browser/saveParticipants.ts
//
// 왜 순수 모듈인가: 이 계산은 **디스크에 쓰기 직전**의 본문을 정한다. 컴포넌트
// 안에 있으면 jsdom 이 못 보는 자리에서 조용히 틀리고, 그 결과가 파일로 남는다.
//
// 전제: 입력은 항상 LF 로 정규화된 버퍼 본문이다 (`codeBuffers.normalizeEol`).
// CRLF 복원은 `restoreEol` 이 이 뒤에 붙으므로 여기서는 줄 끝을 모른다.

export interface HygieneOptions {
  /** 각 줄 끝의 공백·탭을 지운다. */
  trimTrailingWhitespace: boolean;
  /** 본문이 개행으로 끝나게 한다. */
  insertFinalNewline: boolean;
  /** 끝의 빈 줄을 하나만 남긴다. */
  trimFinalNewlines: boolean;
  /**
   * 건드리면 안 되는 줄(1-based). 자동 저장이면 커서 줄, 수동 저장이면 빈 배열.
   *
   * VS Code 가 자동 저장일 때만 커서 줄을 살려 두는 이유가 그대로 적용된다
   * ("to avoid having the cursors jump"): 들여쓰기를 치고 잠깐 멈춘 순간
   * 자동 저장이 그 공백을 먹으면 커서가 줄 앞으로 튄다.
   */
  protectedLines: readonly number[];
}

/**
 * 후행 공백을 정리하지 않는 확장자.
 *
 * 마크다운은 줄 끝 두 칸이 **강제 개행**이라, 지우면 문서의 뜻이 바뀐다.
 * VS Code 도 `[markdown]` 언어별 오버라이드로 끈다 — 우리는 언어별 설정 축이
 * 없으므로 여기에 하드코딩한다.
 */
const KEEPS_TRAILING_WHITESPACE = [".md", ".markdown"];

/** 경로별 예외를 반영한 설정. 바꿀 것이 없으면 **받은 객체를 그대로** 돌려준다. */
export function hygieneForPath(path: string, o: HygieneOptions): HygieneOptions {
  if (!o.trimTrailingWhitespace) return o;
  const lower = path.toLowerCase();
  if (!KEEPS_TRAILING_WHITESPACE.some((ext) => lower.endsWith(ext))) return o;
  return { ...o, trimTrailingWhitespace: false };
}

/** 저장 직전의 본문을 다듬는다. 바꿀 것이 없으면 같은 문자열을 돌려준다. */
export function applyHygiene(text: string, o: HygieneOptions): string {
  if (!o.trimTrailingWhitespace && !o.insertFinalNewline && !o.trimFinalNewlines) return text;
  const protectedMax = maxProtected(o.protectedLines);
  let out = text;
  if (o.trimTrailingWhitespace) out = trimTrailing(out, o.protectedLines);
  // 순서가 중요하다: 끝의 빈 줄을 먼저 정리하고 **그 다음에** 개행 하나를
  // 보장한다. 둘 다 켜면 끝이 정확히 개행 하나로 정규화된다.
  if (o.trimFinalNewlines) out = trimFinalNewlines(out, protectedMax);
  if (o.insertFinalNewline) out = insertFinalNewline(out);
  return out;
}

function maxProtected(lines: readonly number[]): number {
  let max = 0;
  for (const n of lines) if (n > max) max = n;
  return max;
}

function trimTrailing(text: string, protectedLines: readonly number[]): string {
  const keep = new Set(protectedLines);
  const lines = text.split("\n");
  let changed = false;
  const next = lines.map((line, i) => {
    if (keep.has(i + 1)) return line;
    const trimmed = line.replace(/[ \t]+$/, "");
    if (trimmed !== line) changed = true;
    return trimmed;
  });
  return changed ? next.join("\n") : text;
}

/**
 * 마지막 비어 있지 않은 줄 뒤의 빈 줄을 지운다 (개행 하나는 남는다).
 *
 * 전부 빈 줄인 파일은 **손대지 않는다** — VS Code 는 본문을 통째로 지우지만
 * (`doTrimFinalNewLines`), 저장 한 번에 파일이 비는 편이 더 위험하다.
 */
function trimFinalNewlines(text: string, protectedMax: number): string {
  const lines = text.split("\n");
  let lastNonEmpty = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].length > 0) {
      lastNonEmpty = i + 1;
      break;
    }
  }
  if (lastNonEmpty === 0) return text;
  // 자를 첫 줄(1-based). 보호 줄은 살아남아야 커서가 유효하다.
  const deleteFrom = Math.max(lastNonEmpty + 1, protectedMax + 1);
  if (deleteFrom > lines.length) return text;
  return lines.slice(0, deleteFrom - 1).join("\n") + "\n";
}

function insertFinalNewline(text: string): string {
  if (text.length === 0 || text.endsWith("\n")) return text;
  return text + "\n";
}
