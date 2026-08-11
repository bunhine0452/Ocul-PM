/**
 * 메인 화면 프로젝트 검색 매칭 — 순수 함수, 의존성 0.
 *
 * 전부 메모리 연산이라 디바운스가 없다 (타이핑 즉시 반영). 점수 체계는
 * "이름이 항상 경로를 이긴다"를 불변식으로 둔다 — 경로에 우연히 섞인
 * 단어(git, Users, Desktop …) 때문에 엉뚱한 프로젝트가 1위로 오르면
 * "타이핑 3글자 → ⏎" 가 위험해지기 때문이다.
 */

/** 이름 접두 일치. */
const SCORE_PREFIX = 100;
/** 단어 경계(구분자 뒤 / 대소문자 전환) 접두 일치. */
const SCORE_WORD = 80;
/** 부분수열(퍼지)의 상한 — 갭 수만큼 깎인다. */
const SCORE_FUZZY_BASE = 60;
/** 퍼지 점수의 하한 (경로 점수보다는 항상 높게). */
const SCORE_FUZZY_MIN = 35;
/** 초성 일치. */
const SCORE_CHOSEONG = 55;
/** 경로 부분문자열 — 이름 매칭 어느 것보다도 낮다. */
const SCORE_PATH = 30;

const CHOSEONG = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
];
/** 완성형 한글이 하나라도 있는지 (초성 규칙 적용 여부). */
// i18n-ignore-next-line -- 초성 검색용 한글 판정 문자 클래스 (표시 문자열 아님)
const HANGUL = /[가-힣]/;
const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;
/** 중성(21) × 종성(28) — 초성 하나가 차지하는 코드포인트 수. */
const JUNG_JONG = 588;

/**
 * 완성형 한글을 초성 문자열로. 한글이 아닌 문자는 그대로 통과시켜
 * "내 portfolio" → "ㄴ portfolio" 처럼 섞인 이름도 그대로 매칭된다.
 */
export function toChoseong(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code >= HANGUL_BASE && code <= HANGUL_LAST) {
      out += CHOSEONG[Math.floor((code - HANGUL_BASE) / JUNG_JONG)];
    } else {
      out += ch;
    }
  }
  return out;
}

/** 대소문자·구분자를 지운 비교용 형태. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[-_./\\\s]/g, "");
}

/**
 * 단어 시작 인덱스들. 구분자 뒤와 소문자→대문자 전환점을 단어 경계로 본다
 * ("pastelUI" 의 "UI", "my_ledger_api" 의 "ledger"/"api").
 */
function wordStarts(name: string): number[] {
  const starts: number[] = [];
  for (let i = 1; i < name.length; i += 1) {
    const prev = name[i - 1];
    const cur = name[i];
    const afterSep = /[-_./\\\s]/.test(prev);
    const camel = prev === prev.toLowerCase() && cur !== cur.toLowerCase();
    if (afterSep || camel) starts.push(i);
  }
  return starts;
}

/**
 * 부분수열 매칭. 모든 질의 문자가 순서대로 나타나면 갭(건너뛴 문자) 수를
 * 반환하고, 아니면 `null`.
 */
function subsequenceGaps(haystack: string, needle: string): number | null {
  let hi = 0;
  let gaps = 0;
  for (const ch of needle) {
    const found = haystack.indexOf(ch, hi);
    if (found === -1) return null;
    gaps += found - hi;
    hi = found + 1;
  }
  return gaps;
}

/** 이름 매칭 점수. 맞지 않으면 `null`. */
export function scoreName(name: string, query: string): number | null {
  const q = query.trim();
  if (!q) return null;

  const nq = normalize(q);
  if (!nq) return null;
  const nName = normalize(name);

  if (nName.startsWith(nq)) return SCORE_PREFIX;

  // 단어 경계 접두 — 원본 문자열 기준으로 잘라 정규화 후 비교.
  for (const i of wordStarts(name)) {
    if (normalize(name.slice(i)).startsWith(nq)) return SCORE_WORD;
  }

  // 초성 — 이름에 한글이 있을 때만 본다. 라틴 이름에서는 toChoseong 이
  // 항등함수라 이 규칙이 "이름 부분문자열" 로 퇴화해, 아래 퍼지 규칙과
  // 겹치면서 점수만 어긋난다 ("echo" 가 "ch" 에 초성 매칭됐다고 나오는 식).
  if (HANGUL.test(name)) {
    const choName = normalize(toChoseong(name));
    const choQuery = normalize(toChoseong(q));
    if (choName.includes(choQuery)) return SCORE_CHOSEONG;
  }

  const gaps = subsequenceGaps(nName, nq);
  if (gaps !== null) {
    return Math.max(SCORE_FUZZY_MIN, SCORE_FUZZY_BASE - gaps);
  }

  return null;
}

/** 경로 매칭 점수. 맞지 않으면 `null`. */
export function scorePath(path: string, query: string): number | null {
  const q = query.trim();
  if (!q) return null;
  return normalize(path).includes(normalize(q)) ? SCORE_PATH : null;
}

/** 이름과 경로 중 높은 점수. 둘 다 아니면 `null` (행을 버린다). */
export function bestScore(name: string, path: string, query: string): number | null {
  const n = scoreName(name, query);
  if (n !== null) return n;
  return scorePath(path, query);
}
