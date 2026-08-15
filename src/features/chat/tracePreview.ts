// 도구 출력의 **머리 몇 줄만** 떼어 온다 (2026-08-16).
//
// 예전에는 끝난 도구 호출이 한 줄로 접혀서, 대화가 "무엇을 시켰다" 스무 줄이
// 됐다 — 무엇이 나왔는지는 하나하나 펼쳐야 알 수 있었다. 반대로 다 펼쳐 두면
// 수백 줄짜리 출력이 정작 읽어야 할 답변을 화면 밖으로 밀어낸다.
//
// 그래서 **머리만** 보여 준다. 자르는 일을 CSS(max-height)에 맡기지 않는 이유는
// 두 가지다: 잘린 뒤에도 DOM 에는 만 줄이 그대로 남아 스트리밍 중 레이아웃이
// 무거워지고, "몇 줄이 더 있는지"를 화면이 말해 줄 수 없다.

/** 미리보기 기본값 — 네 줄이면 무엇이 나왔는지는 알고, 답변을 밀어내지는 않는다. */
export const PEEK_LINES = 4;

/**
 * 명령(IN)은 두 줄. 대개 한 줄이고, 길어도 앞머리에 무엇을 실행했는지가 있다.
 * 결과(OUT)는 네 줄 — 오류 메시지 한 문단이 대개 이 안에 들어온다.
 */
export const PEEK_IN_LINES = 2;
export const PEEK_OUT_LINES = 4;

/**
 * 글자 수 상한. 줄 수로만 자르면 한 줄이 10만 자인 출력(minified 번들·base64)
 * 하나가 그대로 들어온다 — 줄 수는 넷이어도 화면은 만신창이가 된다.
 */
export const PEEK_CHARS = 800;

export interface TracePeek {
  /** 보여 줄 본문. 빈 문자열이면 보여 줄 것이 없다. */
  text: string;
  /** 미리보기에 못 담은 줄 수 (0 이면 줄 단위로는 다 보인다). */
  hiddenLines: number;
  /** 무엇이든 잘렸는가 — 페이드와 "더 보기"의 근거. */
  truncated: boolean;
}

/**
 * 머리 `maxLines` 줄, 최대 `maxChars` 자를 떼어 온다.
 *
 * **반 줄은 만들지 않는다**: 글자 수에 걸리면 마지막 줄바꿈에서 자른다. 잘린
 * 줄이 화면에 반쯤 걸쳐 있으면 그게 출력인지 잘린 자국인지 읽히지 않는다.
 * 다만 첫 줄부터 한도를 넘으면 그 줄을 잘라서라도 보여 준다 — 아무것도 안
 * 보이는 것보다 앞부분이라도 보이는 편이 낫다.
 */
export function peekLines(
  source: string,
  maxLines: number = PEEK_LINES,
  maxChars: number = PEEK_CHARS,
): TracePeek {
  // 뒤쪽 빈 줄은 세지 않는다 — 명령 출력 끝의 개행 하나가 "+1줄"이 되면 거짓말이다.
  const trimmed = source.replace(/\s+$/, "");
  if (!trimmed) return { text: "", hiddenLines: 0, truncated: false };

  const lines = trimmed.split("\n");
  let text = lines.slice(0, maxLines).join("\n");
  let charCut = false;
  if (text.length > maxChars) {
    charCut = true;
    const lastBreak = text.lastIndexOf("\n", maxChars);
    text = lastBreak > 0 ? text.slice(0, lastBreak) : text.slice(0, maxChars);
  }

  const shown = text ? text.split("\n").length : 0;
  const hiddenLines = Math.max(0, lines.length - shown);
  return { text, hiddenLines, truncated: hiddenLines > 0 || charCut };
}
