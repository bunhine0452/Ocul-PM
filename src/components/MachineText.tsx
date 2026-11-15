/**
 * 사람 글 안의 기계 글씨만 고정폭으로 (11-15 V-08, 영수증 규칙 2).
 *
 * 일지의 검증 칸 · 변경 화면 바닥줄 · 판정 줄의 끝 줄은 에이전트가 쓴 한 줄이고, 명령 · 결과와 한국어 문장이 섞여
 * 있다(「`pnpm test` 1652 passed · 설치본에서 눈으로 보지는 않았다」). 통째로 mono 로 그리면 한글이 고정폭 대체
 * 글꼴로 띄엄띄엄 놓였다. 이제 줄은 본문 서체이고, 기계 글씨만 고정폭이다:
 *
 *  - 백틱으로 감싼 것(에이전트가 코드라고 표시한 것) — 백틱은 벗긴다.
 *  - `$ ` 로 시작하는 줄(셸 기록) — 줄 전체.
 *  - 조각 머리(줄 처음 · `:` · `·` · `→` · `(` · `,` · `;` 뒤)의 명령(pnpm · cargo · git …)과 그 인자 — 한글 ·
 *    구분점 · 괄호 · 쉼표 앞까지. 문장 가운데 낱말로 나온 「cargo」 는 사람 말이라 그대로 둔다.
 *  - 결과 토큰 「1652 passed」 · 「0 failed」 · 「exit 0」.
 *
 * 굵게 표식(`**`)은 화면 표시용으로 벗긴다. 백틱이 짝이 안 맞으면 남은 조각은 글자 그대로 둔다.
 */
import { Fragment } from "react";

export interface MachinePart {
  text: string;
  mono: boolean;
}

// 명령 이름과 그 인자 — 한글 · 가운뎃점 · 화살표 · 줄표 · 쉼표 · 쌍반점 · 괄호 앞까지. 뒤돌아보기(lookbehind)는
// 쓰지 않는다 — 옛 WebKitGTK(리눅스)는 그 정규식을 읽지 못해 모듈째 서지 않는다. 머리 자리는 앞 글자로 따로 본다.
const COMMAND = /\b(?:pnpm|npm|npx|yarn|bun|cargo|git|node|python3?|pytest|go|make|tsc|vitest|gh|deno|rustc)\b[^\p{Script=Hangul}·→—,;()]*/gu;
/** 조각 머리 — 앞이 `:` · `·` · `→` · `(` · `,` · `;`(+ 공백)으로 끝난다. */
const AFTER_HEAD = /[:·→(,;]\s*$/u;
const RESULT = /\b\d[\d,]*\s+(?:passed|failed|skipped)\b|\bexit[ =]\d+\b/gu;

/**
 * 백틱 밖 한 조각 — 명령 · 결과 토큰의 자리만 고정폭으로. `first` 면 줄의 첫 조각이라 조각 처음도 머리다. 코드 조각
 * 뒤의 조각에서는 처음이 머리가 아니다(「`x` cargo …」 의 cargo 는 문장 가운데다).
 */
function outsideParts(s: string, first: boolean): MachinePart[] {
  const ranges: Array<[number, number]> = [];
  const atHead = (at: number) => AFTER_HEAD.test(s.slice(0, at)) || (first && s.slice(0, at).trim() === "");
  for (const [re, head] of [
    [COMMAND, true],
    [RESULT, false],
  ] as const) {
    for (const m of s.matchAll(re)) {
      if (m.index == null || (head && !atHead(m.index))) continue;
      // 끝의 공백과 문장 마침표는 사람 글이다.
      const text = m[0].replace(/\s+$/u, "").replace(/\.$/u, "");
      if (text) ranges.push([m.index, m.index + text.length]);
    }
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
