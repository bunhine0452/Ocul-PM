// ⌘K 의 고르기 점수 (11-15) — 접두 > 단어 시작 > 부분 > 초성, 초성은 한글 음절만 접는다.
import { describe, expect, it } from "vitest";

import { SCORE, isChoseongQuery, matchScore, toChoseong } from "@/lib/choseong";

// i18n-ignore-next-line -- 한글 음절 · 낱자가 검사 재료다
const [JOURNAL, TERMINAL, SETTINGS, CHO_JOURNAL, CHO_TERMINAL] = ["작업 일지", "터미널", "설정 열기", "ㅇㅈ", "ㅌㅁㄴ"];
// i18n-ignore-next-line -- 한글 음절 · 낱자가 검사 재료다
const [WORKING, CHO_JOURNAL_ALL] = ["작업 중", "ㅈㅇㅇㅈ"];

describe("toChoseong", () => {
  it("folds Hangul syllables to their initial consonant and leaves everything else", () => {
    // i18n-ignore-next-line -- 한글 음절 · 낱자가 검사 재료다
    expect(toChoseong(JOURNAL)).toBe("ㅈㅇ ㅇㅈ");
    expect(toChoseong(TERMINAL)).toBe(CHO_TERMINAL);
    // i18n-ignore-next-line -- 한글 음절 · 낱자가 검사 재료다
    expect(toChoseong("ai-pm 계획 v2")).toBe("ai-pm ㄱㅎ v2");
    // i18n-ignore-next-line -- 쌍자음 · 끝 음절(힣)의 경계가 검사 재료다
    expect(toChoseong("까힣")).toBe("ㄲㅎ");
  });
});

describe("isChoseongQuery", () => {
  it("is true only for consonant jamo (spaces allowed)", () => {
    expect(isChoseongQuery(CHO_JOURNAL)).toBe(true);
    // i18n-ignore-next-line -- 한글 낱자가 검사 재료다
    expect(isChoseongQuery("ㅇ ㅈ")).toBe(true);
    expect(isChoseongQuery(JOURNAL)).toBe(false);
    expect(isChoseongQuery("ab")).toBe(false);
    expect(isChoseongQuery("  ")).toBe(false);
  });
});

describe("matchScore", () => {
  it("ranks prefix over word start over substring over initials", () => {
    expect(matchScore("ter", ["terminal"])).toBe(SCORE.prefix);
    expect(matchScore("jour", ["work journal"])).toBe(SCORE.word);
    expect(matchScore("urna", ["work journal"])).toBe(SCORE.part);
    expect(matchScore(CHO_JOURNAL, [JOURNAL])).toBe(SCORE.choseong);
    expect(matchScore(CHO_TERMINAL, [TERMINAL])).toBe(SCORE.choseong);
  });

  it("takes the best text, is case-insensitive, and treats an empty query as a match for all", () => {
    expect(matchScore("TERM", ["shell", "Terminal"])).toBe(SCORE.prefix);
    expect(matchScore("", [JOURNAL])).toBe(1);
    expect(matchScore("   ", [])).toBe(1);
  });

  it("is 0 when nothing matches — initials do not match unrelated words", () => {
    expect(matchScore("zzz", ["terminal", JOURNAL])).toBe(0);
    expect(matchScore(CHO_JOURNAL, [SETTINGS, TERMINAL])).toBe(0);
    expect(matchScore(CHO_TERMINAL, [""])).toBe(0);
  });

  it("initials match inside one word anywhere, across words only from the start", () => {
    expect(matchScore(CHO_JOURNAL_ALL, [JOURNAL])).toBe(SCORE.choseong);
    // 「작업 중」 의 낱말을 건넌 「업 중」 은 「ㅇㅈ」 가 아니다.
    expect(matchScore(CHO_JOURNAL, [WORKING])).toBe(0);
  });

  it("word starts follow paths and separators", () => {
    expect(matchScore("ocul", ["/Users/me/dev/ocul-pm"])).toBe(SCORE.word);
    expect(matchScore("pm", ["ocul-pm"])).toBe(SCORE.word);
  });
});
