/**
 * 메인 화면 프로젝트 검색 매칭 — 순수 함수 계약.
 *
 * 검색은 이 화면의 확장성 축이다 (프로젝트 10개 → 50개). 점수 우선순위가
 * 흔들리면 "타이핑 3글자 → ⏎" 근육 기억이 깨지므로 여기서 못박는다.
 */
import { describe, expect, it } from "vitest";
import { toChoseong, scoreName, scorePath, bestScore } from "@/features/onboarding/home/homeMatch";

describe("toChoseong — 한글 초성 추출", () => {
  it("완성형 한글을 초성으로 바꾼다", () => {
    expect(toChoseong("회고")).toBe("ㅎㄱ");
    expect(toChoseong("정리")).toBe("ㅈㄹ");
  });

  it("공백과 라틴 문자는 그대로 통과시킨다", () => {
    expect(toChoseong("회고 정리")).toBe("ㅎㄱ ㅈㄹ");
    expect(toChoseong("ai-pm")).toBe("ai-pm");
    expect(toChoseong("내 portfolio")).toBe("ㄴ portfolio");
  });

  it("이미 초성인 자모는 그대로 둔다 (사용자가 ㅎㄱ 를 직접 칠 수 있다)", () => {
    expect(toChoseong("ㅎㄱ")).toBe("ㅎㄱ");
  });

  it("겹받침이 있는 글자도 초성만 뽑는다", () => {
    // '값'(U+AC12) → ㄱ. (code-0xAC00)/588 = 0 → 초성 테이블 0번.
    expect(toChoseong("값")).toBe("ㄱ");
  });

  it("빈 문자열은 빈 문자열", () => {
    expect(toChoseong("")).toBe("");
  });
});

describe("scoreName — 이름 매칭 우선순위", () => {
  it("접두 일치가 가장 높다", () => {
    expect(scoreName("aurora-web", "aur")).toBe(100);
  });

  it("단어 경계 접두는 접두 다음이다", () => {
    // 하이픈 뒤 단어의 시작
    expect(scoreName("aurora-web", "web")).toBe(80);
    expect(scoreName("my_ledger_api", "ledger")).toBe(80);
    // camelCase 전환도 단어 경계로 본다
    expect(scoreName("pastelUI", "ui")).toBe(80);
  });

  it("퍼지(부분수열)는 갭이 클수록 낮아진다", () => {
    const tight = scoreName("ledger-api", "lgr");
    const loose = scoreName("ledger-api", "lpi");
    expect(tight).not.toBeNull();
    expect(loose).not.toBeNull();
    expect(tight!).toBeGreaterThan(loose!);
    expect(tight!).toBeLessThan(80);
  });

  it("초성 일치를 잡는다", () => {
    const s = scoreName("회고 정리", "ㅎㄱ");
    expect(s).toBe(55);
  });

  it("대소문자와 구분자를 무시한다", () => {
    expect(scoreName("Aurora-Web", "aurora")).toBe(100);
    expect(scoreName("aurora-web", "AURORAWEB")).toBe(100);
    expect(scoreName("my_ledger", "myledger")).toBe(100);
  });

  it("맞지 않으면 null", () => {
    expect(scoreName("aurora-web", "zzz")).toBeNull();
  });

  it("빈 질의는 null (호출자가 검색 아님으로 처리)", () => {
    expect(scoreName("aurora-web", "")).toBeNull();
    expect(scoreName("aurora-web", "   ")).toBeNull();
  });
});

describe("scorePath — 경로는 이름보다 낮다", () => {
  it("경로 부분문자열은 30", () => {
    expect(scorePath("/Users/me/git/aurora-web", "git")).toBe(30);
  });

  it("이름 최저 점수보다도 낮아야 한다 (이름이 항상 이긴다)", () => {
    const pathScore = scorePath("/Users/me/lab/x", "lab")!;
    const worstName = scoreName("labyrinth", "lbrnth")!; // 퍼지, 갭 많음
    expect(pathScore).toBeLessThan(worstName);
  });

  it("맞지 않으면 null", () => {
    expect(scorePath("/Users/me/git/x", "zzz")).toBeNull();
  });
});

describe("bestScore — 이름과 경로 중 높은 쪽", () => {
  it("이름이 맞으면 이름 점수", () => {
    expect(bestScore("aurora-web", "/Users/me/git/aurora-web", "aur")).toBe(100);
  });

  it("이름이 안 맞고 경로만 맞으면 경로 점수", () => {
    expect(bestScore("aurora-web", "/Users/me/lab/aurora-web", "lab")).toBe(30);
  });

  it("둘 다 안 맞으면 null — 호출자가 행을 버린다", () => {
    expect(bestScore("aurora-web", "/Users/me/git/aurora-web", "zzz")).toBeNull();
  });
});
