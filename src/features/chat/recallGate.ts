/**
 * 회상 게이트 (Osaurus 라운드 Phase 5 `#recall-gate` · `#recall-budget`).
 *
 * 지금까지 AI 패널은 **매 턴** 일지 3건과 플랜 전체와 규칙 2,500자를 system 에
 * 다시 올렸다. "이 함수 이름 뭐가 좋을까" 같은 턴에도 전부 실렸고, 거의 안
 * 바뀌는 블록이 매 턴 재조립되니 프롬프트 캐시도 매번 깨졌다.
 *
 * Osaurus 의 답은 잘라 넣는 게 아니라 **안 넣는 것**이다. 이 모듈이 그 판정을
 * 한다 — 회상 신호가 있는 턴에만 기록을 꺼내고, 없으면 길이 0 이다.
 *
 * **결정적이다** (LLM 0 · 네트워크 0). 한/영 신호어 사전 하나로 판정하므로
 * 테스트가 표를 그대로 단언할 수 있고, 같은 문장은 언제나 같은 답을 낸다.
 */

/** 무엇을 꺼낼 것인가. `none` 이면 회상 블록을 **아예 조립하지 않는다**. */
export type RecallSignal = "verbatim" | "episode" | "plan" | "fact" | "none";

/**
 * 신호 우선순위 — 한 문장이 여러 신호를 때릴 때 이 순서로 이긴다.
 *
 * `verbatim`("내가 뭐라고 했지")이 가장 강하다: 사용자가 **원문**을 요구한
 * 것이라 요약으로 답하면 질문 자체가 성립하지 않는다. 그다음이 `episode`
 * (시간 표현) — 무엇을 꺼낼지가 가장 좁게 정해진다. `plan` 과 `fact` 는
 * 범위가 넓어 뒤에 둔다.
 */
const PRECEDENCE: RecallSignal[] = ["verbatim", "episode", "plan", "fact"];

/**
 * 신호어 사전. **어간이 아니라 사용자가 실제로 치는 말**을 적는다 (Osaurus 의
 * 키워드 조언과 같은 규칙 — "텍스트 처리" 말고 "요약, tldr, 핵심").
 *
 * 한국어는 조사가 붙으므로 부분 일치로 본다(`지난주에`·`지난주는`). 영어는
 * 단어 경계로 본다 — `plan` 이 `explanation` 안에서 걸리면 안 된다.
 */
// i18n-ignore -- 아래 한글은 **표시 문자열이 아니라 탐지 사전**이다 (정규식
// 문자 클래스와 같은 부류). 번역하면 한국어 질문을 못 알아듣는다.
const SIGNALS: Record<Exclude<RecallSignal, "none">, { ko: string[]; en: string[] }> = {
  verbatim: {
    ko: ["뭐라고 했", "뭐랬", "원문", "그대로 보여", "정확히 뭐", "정확히 어떻게", "내가 한 말"], // i18n-ignore -- 탐지 사전
    en: ["exact words", "verbatim", "what did i say", "what i said", "quote me", "my exact"],
  },
  episode: {
    ko: [
      "지난주", "지난 주", "저번주", "저번 주", "지난달", "지난 달", "어제", "그저께", // i18n-ignore -- 탐지 사전
      "오늘 뭐", "요즘 뭐", "최근에 뭐", "마지막으로 작업", "그때 뭐", "언제 했", // i18n-ignore -- 탐지 사전
      "무슨 작업", "뭐 했", "뭘 했", "작업 기록", "일지", // i18n-ignore -- 탐지 사전
    ],
    en: [
      "last week", "last month", "yesterday", "recently", "what did we do",
      "what have i done", "what did i work on", "previously", "earlier today",
      "journal", "work log",
    ],
  },
  plan: {
    ko: ["계획", "플랜", "할 일", "남은 항목", "진행 상황", "어디까지", "다음 작업", "todo"], // i18n-ignore -- 탐지 사전
    en: ["the plan", "roadmap", "what's left", "whats left", "remaining items", "next task", "todo", "progress"],
  },
  fact: {
    ko: ["전에 정한", "예전에", "저번에", "결정했", "우리가 정한", "규칙", "컨벤션", "약속했"], // i18n-ignore -- 탐지 사전
    en: ["we decided", "we agreed", "convention", "the rule", "previously agreed", "as before"],
  },
};

/**
 * 이 턴이 과거를 불러오는가.
 *
 * `lang` 은 **사전 선택이 아니라 우선순위**다 — 사용자는 한국어 UI 에서
 * 영어로 묻기도 한다. 두 사전을 다 보되, 어느 쪽도 안 걸리면 `none`.
 */
export function detectRecall(turn: string, _lang: "ko" | "en" = "ko"): RecallSignal {
  const text = turn.toLowerCase().trim();
  if (!text) return "none";

  for (const signal of PRECEDENCE) {
    const dict = SIGNALS[signal as Exclude<RecallSignal, "none">];
    if (dict.ko.some((needle) => text.includes(needle))) return signal;
    if (dict.en.some((needle) => matchesWord(text, needle))) return signal;
  }
  return "none";
}

/**
 * 영어 신호어는 **단어 경계**로 본다. `todo` 가 `todos` 에는 걸려야 하지만
 * `plan` 이 `explanation` 안에서 걸리면 안 된다 — 앞쪽 경계만 엄격히 본다.
 */
function matchesWord(text: string, needle: string): boolean {
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at < 0) return false;
    const before = at === 0 ? " " : text[at - 1];
    if (!/[a-z0-9]/.test(before)) return true;
    from = at + 1;
  }
}

/**
 * 회상 예산 (토큰 근사). 설계 §2 의 ≤800 토큰.
 *
 * 토크나이저를 들이지 않는다 — 이 값은 **상한을 지키기 위한 근사**이고,
 * 과소평가만 하지 않으면 된다. 프로젝트의 기존 추정기(`estimateTokens`)와 같은
 * 규칙을 쓴다.
 */
export const RECALL_BUDGET_TOKENS = 800;

/** 한글은 1자당 토큰이 크다 — 영어 4자/토큰, 한글 1.5자/토큰으로 잡는다. */
export function approxTokens(text: string): number {
  let hangul = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0xac00 && code <= 0xd7a3) hangul += 1;
  }
  const rest = text.length - hangul;
  return Math.ceil(hangul / 1.5 + rest / 4);
}

export interface RecallCandidate {
  /** 주입 후보의 원문. */
  text: string;
  /** 관련도 0..1 — `recall_stats` 의 점수. 높을수록 먼저 담는다. */
  score: number;
  /** 무엇인지 (통계 갱신용). */
  kind: "journal" | "plan" | "rule" | "skill";
  ref: string;
}

export interface RecallSelection {
  /** 예산 안에 담긴 후보 (관련도 내림차순). */
  chosen: RecallCandidate[];
  /** 담긴 것들의 토큰 합. */
  tokens: number;
  /** 예산을 넘겨 잘린 개수 — 화면이 정직하게 밝힌다. */
  dropped: number;
}

/**
 * 관련도 순으로 예산까지 담는다.
 *
 * 넘치는 후보는 **자르지 않고 버린다** — 반쪽짜리 일지를 넣느니 그 일지를
 * 통째로 빼는 편이 낫다 (`digestRules` 가 규칙 §5 를 잘라 먹었던 교훈).
 * 몇 개를 버렸는지는 돌려주므로 화면이 그 사실을 말할 수 있다.
 */
export function selectWithinBudget(
  candidates: readonly RecallCandidate[],
  budget = RECALL_BUDGET_TOKENS,
): RecallSelection {
  const ranked = [...candidates].sort((a, b) => b.score - a.score);
  const chosen: RecallCandidate[] = [];
  let tokens = 0;
  let dropped = 0;
  for (const candidate of ranked) {
    const cost = approxTokens(candidate.text);
    if (tokens + cost > budget) {
      dropped += 1;
      continue;
    }
    chosen.push(candidate);
    tokens += cost;
  }
  return { chosen, tokens, dropped };
}
