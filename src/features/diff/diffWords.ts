/**
 * 바뀐 단어 (11-15 #diff-basics) — 짝지은 지운 줄 · 더한 줄을 단어 단위로 견줘 바뀐 조각만 한 단
 * 진하게 칠한다. 한 글자 바뀐 긴 줄을 눈으로 찾지 않게.
 *
 * 토큰은 단어(글자 · 숫자 · `_`) · 공백 덩이 · 구두점 한 글자. 줄당 200토큰을 넘으면 견주지 않는다
 * (LCS 는 두 줄 토큰 수의 곱이다). 같은 것이 거의 없으면(3할 미만) 줄 색으로 충분하다 — 다
 * 칠하면 줄 전체가 진해질 뿐이다. 공백만 바뀐 토큰은 칠하지 않는다(들여쓰기 소음).
 */

export type CharRange = readonly [start: number, end: number];

const TOKEN = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;
const MAX_TOKENS = 200;
const MIN_SHARED = 0.3;

const isSpace = (tok: string) => /^\s+$/.test(tok);

/** 두 줄(표식 뺀 코드)의 바뀐 글자 구간. 견줄 수 없거나 견줄 값이 없으면 `null`. */
export function wordRanges(a: string, b: string): [CharRange[], CharRange[]] | null {
  const ta = a.match(TOKEN) ?? [];
  const tb = b.match(TOKEN) ?? [];
  if (ta.length === 0 || tb.length === 0 || ta.length > MAX_TOKENS || tb.length > MAX_TOKENS) return null;
  const n = ta.length;
  const m = tb.length;
  // 뒤에서부터 채운 LCS 길이 표 — dp[i][j] = ta[i..] 와 tb[j..] 의 공통 부분열 길이.
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = ta[i] === tb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const keepA = new Array<boolean>(n).fill(false);
  const keepB = new Array<boolean>(m).fill(false);
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (ta[i] === tb[j]) {
      keepA[i++] = true;
      keepB[j++] = true;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  const solid = (toks: string[], keep?: boolean[]) =>
    toks.reduce((sum, tok, k) => (isSpace(tok) || (keep && !keep[k]) ? sum : sum + tok.length), 0);
  const shared = solid(ta, keepA);
  if (shared < MIN_SHARED * Math.max(solid(ta), solid(tb))) return null;
  return [changedRanges(ta, keepA), changedRanges(tb, keepB)];
}

/** 바뀐 토큰의 글자 구간 — 공백만 사이에 둔 이웃은 한 구간으로 잇는다(조각조각 칠하지 않게). */
function changedRanges(tokens: string[], keep: boolean[]): CharRange[] {
  const out: [number, number][] = [];
  let pos = 0;
  let joinable = false;
  tokens.forEach((tok, k) => {
    const start = pos;
    pos += tok.length;
    if (isSpace(tok)) return;
    if (keep[k]) {
      joinable = false;
      return;
    }
    const last = out[out.length - 1];
    if (last && joinable) last[1] = pos;
    else out.push([start, pos]);
    joinable = true;
  });
  return out;
}

/**
 * 강조(hljs)까지 입힌 줄 HTML 에 바뀐 구간을 덧입힌다. 태그는 건너뛰고 글자만 센다(`&amp;` 같은
 * 엔티티는 한 글자). 구간이 span 경계를 넘으면 그 앞에서 닫고 뒤에서 다시 연다 — 태그를 엇갈리게
 * 겹치지 않는다.
 */
export function markRanges(html: string, ranges: readonly CharRange[], cls = "dl-word"): string {
  if (ranges.length === 0) return html;
  let out = "";
  let pos = 0;
  let r = 0;
  let open = false;
  for (let i = 0; i < html.length; ) {
    const end = html[i] === "<" ? html.indexOf(">", i) : -1;
    if (end > i) {
      if (open) {
        out += "</span>";
        open = false;
      }
      out += html.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    let len = 1;
    if (html[i] === "&") {
      const semi = html.indexOf(";", i);
      if (semi > i) len = semi - i + 1;
    }
    while (r < ranges.length && pos >= ranges[r][1]) r++;
    const inside = r < ranges.length && pos >= ranges[r][0];
    if (inside !== open) {
      out += inside ? `<span class="${cls}">` : "</span>";
      open = inside;
    }
    out += html.slice(i, i + len);
    i += len;
    pos++;
  }
  if (open) out += "</span>";
  return out;
}
