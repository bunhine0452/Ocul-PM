/**
 * 사람 글 안의 기계 글씨만 고정폭으로 (11-15 V-08, 영수증 규칙 2).
 *
 * 일지의 검증 칸 · 변경 화면 바닥줄 · 판정 줄의 끝 줄은 에이전트가 쓴 한 줄이고, 명령 · 결과와 한국어 문장이 섞여
 * 있다(「`pnpm test` 1652 passed · 설치본에서 눈으로 보지는 않았다」). 통째로 mono 로 그리면 한글이 고정폭 대체
 * 글꼴로 띄엄띄엄 놓였다. 이제 줄은 본문 서체이고, 기계 글씨만 고정폭이다:
 *
 *  - 백틱으로 감싼 것(에이전트가 코드라고 표시한 것) — 백틱은 벗긴다.
 *  - `$ ` 로 시작하는 줄(셸 기록) — 줄 전체.
 *  - 사람 문장이 없는 도구 출력 줄(한글 · 백틱 · 사람 말 낱말 없이 결과 토큰이 있는 줄, 「test result: ok. 1157
 *    passed; 0 failed; …」) — 줄 전체. 결과 토큰만 고정폭이면 한 줄 안에서 글꼴이 섞였다.
 *  - 조각 머리(줄 처음 · `:` · `·` · `→` · `(` · `,` · `;` 뒤)의 명령(pnpm · cargo · git …)과 그 인자 — 한글 ·
 *    구분점 · 괄호 · 쉼표 앞, 또는 사람 말로 넘어가는 낱말(on · and · passed …) 앞까지. 문장 가운데 낱말로 나온
 *    「cargo」 는 사람 말이라 그대로 둔다. 흔한 영어 낱말이기도 한 go · make · node 는 바로 뒤가 인자 꼴(플래그 ·
 *    경로 · 흔한 하위 명령)일 때만 명령이다 — 「make sure …」 · 「go back …」 이 통째로 고정폭이었다.
 *  - 결과 토큰 「1652 passed」 · 「116 files passed」 · 「0 failed」 · 「exit 0」.
 *
 * 굵게 표식(`**`)은 화면 표시용으로 벗긴다. 백틱이 짝이 안 맞으면 남은 조각은 글자 그대로 둔다.
 */
import { Fragment } from "react";

export interface MachinePart {
  text: string;
  mono: boolean;
}

// 명령 이름 — 인자는 `commandEnd` 가 낱말마다 따라간다. 뒤돌아보기(lookbehind)는 쓰지 않는다 — 옛 WebKitGTK(리눅스)는
// 그 정규식을 읽지 못해 모듈째 서지 않는다. 머리 자리는 앞 글자로 따로 본다.
const COMMAND = /\b(?:pnpm|npm|npx|yarn|bun|cargo|git|node|python3?|pytest|go|make|tsc|vitest|gh|deno|rustc)\b/gu;
/** 흔한 영어 낱말이기도 한 명령 — 바로 뒤가 인자 꼴일 때만 명령이다. */
const AMBIGUOUS = /^(?:go|make|node)$/;
const SUBCOMMAND = /^(?:test|build|run|check|lint|install|clean|vet|fmt|bench)$/;
/** 인자 꼴 — 플래그 · 경로 · 키=값 · 파일 이름. */
const ARG = /^-|[/=]|\.\w/u;
/** 명령의 인자가 끝나는 낱말 — 사람 말로 넘어간다(「pnpm test passed on mac」). 결과 낱말은 `RESULT` 가 수와 함께 문다. */
const PROSE =
  /^(?:passed|failed|skipped|ok|on|and|or|but|then|after|before|with|without|for|from|to|in|is|are|was|were|it|the|a|an|not|no|again|also|still|both|when|while|since|because|so|as|at|by|of|here|there|locally)$/i;
/** 인자 안에서 멈추는 글자 — 한글 · 가운뎃점 · 화살표 · 줄표 · 쉼표 · 쌍반점 · 괄호. */
const STOP = /[\p{Script=Hangul}·→—,;()]/u;
/** 조각 머리 — 앞이 `:` · `·` · `→` · `(` · `,` · `;`(+ 공백)으로 끝난다. */
const AFTER_HEAD = /[:·→(,;]\s*$/u;
const RESULT = /\b\d[\d,]*\s+(?:[a-z]+\s+)?(?:passed|failed|skipped)\b|\bexit[ =]\d+\b/gu;
/** 줄에 한 번이라도 나오면 사람 문장이다 — 도구 출력 줄로 보지 않는다. */
const LINE_PROSE = /\b(?:the|a|an|and|or|but|not|no|on|with|without|was|were|is|are|it|this|that|after|before|then|when|while|because|so|still|also|yet|only|both|again)\b/i;
/** `RESULT` 가 있는가만 — 전역 정규식의 `test` 는 lastIndex 를 남긴다. */
const HAS_RESULT = new RegExp(RESULT.source, "u");

/** 사람 문장이 없는 도구 출력 줄인가 — 한글 · 백틱(에이전트가 코드를 표시한 사람 글) · 사람 말 낱말이 없고 결과 토큰이 있다. */
const isOutputLine = (line: string) => !/[\p{Script=Hangul}`]/u.test(line) && HAS_RESULT.test(line) && !LINE_PROSE.test(line);

/** 끝의 문장 마침표는 사람 글이다 — 낱말 · 수 바로 뒤의 마침표 하나(「./...」 의 점은 그대로). */
const trimPeriod = (s: string) => (/[\p{L}\p{N}_)\]]\.$/u.test(s) ? s.slice(0, -1) : s);

/** 명령 이름(`from` 앞까지) 뒤의 인자를 낱말마다 따라간 끝 자리. 명령이 아니면 `-1`. */
function commandEnd(s: string, name: string, from: number): number {
  const word = /\s+(\S+)/y;
  const ambiguous = AMBIGUOUS.test(name);
  let end = from;
  let first = true;
  word.lastIndex = from;
  for (let m = word.exec(s); m; m = word.exec(s)) {
    const cut = m[1].search(STOP);
    if (cut === 0) break;
    const w = trimPeriod(cut > 0 ? m[1].slice(0, cut) : m[1]);
    const bare = w.replace(/[.:]+$/u, "");
    if (first && ambiguous && !(ARG.test(w) || SUBCOMMAND.test(bare))) return -1;
    first = false;
    if (PROSE.test(bare)) break;
    end = m.index + m[0].length - m[1].length + w.length;
    if (cut > 0 || w.length < m[1].length) break;
  }
  return first && ambiguous ? -1 : end;
}

/**
 * 백틱 밖 한 조각 — 명령 · 결과 토큰의 자리만 고정폭으로. `first` 면 줄의 첫 조각이라 조각 처음도 머리다. 코드 조각
 * 뒤의 조각에서는 처음이 머리가 아니다(「`x` cargo …」 의 cargo 는 문장 가운데다).
 */
function outsideParts(s: string, first: boolean): MachinePart[] {
  const ranges: Array<[number, number]> = [];
  const atHead = (at: number) => AFTER_HEAD.test(s.slice(0, at)) || (first && s.slice(0, at).trim() === "");
  for (const m of s.matchAll(COMMAND)) {
    if (m.index == null || !atHead(m.index)) continue;
    const end = commandEnd(s, m[0], m.index + m[0].length);
    if (end > 0) ranges.push([m.index, end]);
  }
  for (const m of s.matchAll(RESULT)) {
    if (m.index != null) ranges.push([m.index, m.index + m[0].length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const out: MachinePart[] = [];
  let pos = 0;
  for (const [a, b] of ranges) {
    if (b <= pos) continue;
    const start = Math.max(a, pos);
    if (start > pos) out.push({ text: s.slice(pos, start), mono: false });
    out.push({ text: s.slice(start, b), mono: true });
    pos = b;
  }
  if (pos < s.length) out.push({ text: s.slice(pos), mono: false });
  return out;
}

/** 한 줄을 사람 글 · 기계 글씨 조각으로. 조각을 이으면 표시할 글(백틱 · `**` 를 벗긴 것)이다. */
export function machineParts(raw: string): MachinePart[] {
  const line = raw.replace(/\*\*/g, "");
  if (/^\$\s/.test(line)) return [{ text: line, mono: true }];
  if (isOutputLine(line)) {
    const body = trimPeriod(line);
    return body.length < line.length ? [{ text: body, mono: true }, { text: ".", mono: false }] : [{ text: line, mono: true }];
  }
  const bits = line.split("`");
  if (bits.length % 2 === 0) {
    // 짝이 안 맞는 백틱 — 마지막 백틱부터는 글자 그대로 바깥 조각이다.
    const tail = bits.splice(bits.length - 2, 2).join("`");
    bits.push(tail);
  }
  const parts: MachinePart[] = [];
  bits.forEach((bit, i) => {
    if (!bit) return;
    if (i % 2 === 1) parts.push({ text: bit, mono: true });
    else parts.push(...outsideParts(bit, i === 0));
  });
  // 기계 글씨 둘 사이의 구분점 · 쉼표 · 공백만인 틈은 기계 글씨다 — 「2 failed, 418 passed」 가 쉼표마다 글꼴을
  // 바꾸지 않고 한 줄로 선다.
  parts.forEach((p, i) => {
    if (!p.mono && parts[i - 1]?.mono && parts[i + 1]?.mono && /^[\s\p{P}\p{S}]+$/u.test(p.text)) p.mono = true;
  });
  // 이웃한 같은 갈래는 하나로.
  return parts.reduce<MachinePart[]>((acc, p) => {
    const last = acc[acc.length - 1];
    if (last && last.mono === p.mono) last.text += p.text;
    else acc.push({ ...p });
    return acc;
  }, []);
}

/** 표시할 글 — 백틱 · `**` 를 벗긴 한 줄(툴팁 · 복사용). */
export function machinePlain(raw: string): string {
  return machineParts(raw)
    .map((p) => p.text)
    .join("");
}

/** 조각들을 `at` 글자 자리에서 둘로 — 끝을 남기고 앞을 줄이는 줄(변경 화면 바닥줄)이 쓴다. */
export function splitParts(parts: readonly MachinePart[], at: number): [MachinePart[], MachinePart[]] {
  const head: MachinePart[] = [];
  const tail: MachinePart[] = [];
  let pos = 0;
  for (const p of parts) {
    const end = pos + p.text.length;
    if (end <= at) head.push(p);
    else if (pos >= at) tail.push(p);
    else {
      head.push({ text: p.text.slice(0, at - pos), mono: p.mono });
      tail.push({ text: p.text.slice(at - pos), mono: p.mono });
    }
    pos = end;
  }
  return [head, tail];
}

/** 조각을 그린다 — 기계 글씨는 `.mono` span, 사람 글은 글자 그대로. 글꼴 크기 · 색은 부모가 정한다. */
export function MachineText({ text, parts }: { text?: string; parts?: readonly MachinePart[] }) {
  const list = parts ?? machineParts(text ?? "");
  return (
    <>
      {list.map((p, i) =>
        p.mono ? (
          <span key={i} className="mono">
            {p.text}
          </span>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}
