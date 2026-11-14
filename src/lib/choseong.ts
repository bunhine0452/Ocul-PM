/**
 * ⌘K 의 고르기 점수 (11-15) — 접두 > 단어 시작 > 부분 > 초성.
 *
 * 예전 필터는 맞으면 1, 아니면 0 이라 순위가 없었다(「일」 을 치면 「작업 일지」 와 「처음 쓰는 법」 의
 * 별칭이 같은 자리). 초성 검색도 없었다 — 「ㅇㅈ」 로 작업 일지, 「ㅌㅁㄴ」 으로 터미널을 찾는다. 같은 점수
 * 안의 순서는 부르는 쪽이 넣은 순서(최근 순)를 따른다(cmdk 의 정렬은 안정적이다).
 *
 * 한글 낱자는 코드 포인트로 적는다 — 이 파일에 한글 글자를 두면 화면 문구처럼 보인다(lint:i18n).
 */

/** 초성 19자 — 가(U+AC00)부터 588자마다 다음 초성이다. 호환 자모(ㄱ U+3131 …)로 돌려준다. */
const CHOSEONG = [
  0x3131, 0x3132, 0x3134, 0x3137, 0x3138, 0x3139, 0x3141, 0x3142, 0x3143, 0x3145, 0x3146, 0x3147, 0x3148, 0x3149,
  0x314a, 0x314b, 0x314c, 0x314d, 0x314e,
].map((c) => String.fromCodePoint(c));

const SYLLABLE_FIRST = 0xac00;
const SYLLABLE_LAST = 0xd7a3;
const PER_CHOSEONG = 588;

/** 한글 음절을 초성으로 — 그 밖의 글자(라틴 · 숫자 · 공백 · 낱자)는 그대로. */
export function toChoseong(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    out += c >= SYLLABLE_FIRST && c <= SYLLABLE_LAST ? CHOSEONG[Math.floor((c - SYLLABLE_FIRST) / PER_CHOSEONG)] : ch;
  }
  return out;
}

/** 자음 낱자(호환 자모)의 범위 — ㄱ U+3131 부터 ㅎ U+314E 까지. 겹받침 낱자(ㄳ …)도 이 안에 든다. */
const JAMO_FIRST = 0x3131;
const JAMO_LAST = 0x314e;

function isJamo(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return c >= JAMO_FIRST && c <= JAMO_LAST;
}

/** 검색어가 자음 낱자만으로 이뤄졌나 — 띄어쓰기는 상관없다. */
export function isChoseongQuery(query: string): boolean {
  const chars = [...query].filter((ch) => !/\s/.test(ch));
  return chars.length > 0 && chars.every(isJamo);
}

/**
 * 겹받침 낱자를 두 초성으로 — ㄳ → ㄱㅅ, ㄵ → ㄴㅈ … ㅄ → ㅂㅅ. 입력기가 「ㄱ」 다음 「ㅅ」 을 ㄳ 한 자로 합치는데
 * (Windows MS IME), 초성은 19자뿐이라 합친 채로는 아무것도 안 맞았다(「ㄱㅅ」 → 기술). 쌍자음(ㄲ ㄸ ㅃ ㅆ ㅉ)은
 * 그 자체가 초성이라 그대로 둔다.
 */
const CLUSTERS: Record<number, [number, number]> = {
  0x3133: [0x3131, 0x3145], // ㄳ
  0x3135: [0x3134, 0x3148], // ㄵ
  0x3136: [0x3134, 0x314e], // ㄶ
  0x313a: [0x3139, 0x3131], // ㄺ
  0x313b: [0x3139, 0x3141], // ㄻ
  0x313c: [0x3139, 0x3142], // ㄼ
  0x313d: [0x3139, 0x3145], // ㄽ
  0x313e: [0x3139, 0x314c], // ㄾ
  0x313f: [0x3139, 0x314d], // ㄿ
  0x3140: [0x3139, 0x314e], // ㅀ
  0x3144: [0x3142, 0x3145], // ㅄ
};

function splitClusters(query: string): string {
  let out = "";
  for (const ch of query) {
    const pair = CLUSTERS[ch.codePointAt(0) ?? 0];
    out += pair ? String.fromCodePoint(...pair) : ch;
  }
  return out;
}

/** 단어 시작 — 띄어쓰기 · 구두점 · 경로 구분자 뒤. */
const WORD_BREAK = /[\s\-_/\\.·:,()[\]]+/;

export const SCORE = { prefix: 4, word: 3, part: 2, choseong: 1 } as const;

/**
 * 초성이 맞나 — 한 낱말 안에서는 어디든(「ㅇㅈ」 → 작업 「일지」), 낱말을 건너서는 앞에서부터만(「ㅈㅇㅇㅈ」 →
 * 「작업 일지」). 건너서 아무 데나 맞추면 「작업 중」 의 「업 중」 이 「ㅇㅈ」 에 걸렸다.
 */
function choseongHit(text: string, cho: string): boolean {
  const spaced = toChoseong(text);
  return spaced.includes(cho) || spaced.replace(/\s+/g, "").startsWith(cho);
}

/**
 * 검색어 하나와 글들(라벨 · 별칭 · 경로)의 점수 — 가장 잘 맞은 글의 것. 빈 검색어는 모두 1, 안 맞으면 0.
 */
export function matchScore(query: string, texts: readonly string[]): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const cho = isChoseongQuery(q) ? splitClusters(q.replace(/\s+/g, "")) : null;
  let best = 0;
  for (const raw of texts) {
    const text = raw.trim().toLowerCase();
    if (!text) continue;
    if (text.startsWith(q)) return SCORE.prefix;
    if (best < SCORE.word && text.split(WORD_BREAK).some((w) => w.startsWith(q))) best = SCORE.word;
    else if (best < SCORE.part && text.includes(q)) best = SCORE.part;
    if (cho && best < SCORE.choseong && choseongHit(text, cho)) best = SCORE.choseong;
  }
  return best;
}
