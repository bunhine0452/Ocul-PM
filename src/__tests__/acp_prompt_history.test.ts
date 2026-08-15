import { describe, expect, it } from "vitest";
import { recallBack, recallForward } from "@/features/chat/promptHistory";

// ↑/↓ 프롬프트 되부르기 — CLI 히스토리와 같은 기대.

const prompts = ["첫 지시", "둘째 지시", "셋째 지시"]; // i18n-ignore -- 테스트 고정값

describe("recallBack", () => {
  it("starts from the most recent prompt and stashes the draft", () => {
    const step = recallBack(prompts, null, "쓰다 만 글"); // i18n-ignore -- 테스트 고정값
    expect(step?.text).toBe("셋째 지시"); // i18n-ignore -- 테스트 고정값
    expect(step?.state).toEqual({ index: 2, stash: "쓰다 만 글" }); // i18n-ignore -- 테스트 고정값
  });

  it("walks further back on repeated presses", () => {
    const first = recallBack(prompts, null, "")!;
    const second = recallBack(prompts, first.state, first.text)!;
    expect(second.text).toBe("둘째 지시"); // i18n-ignore -- 테스트 고정값
  });

  /** 맨 과거에서 한 번 더 눌러도 입력창이 흔들리면 안 된다. */
  it("stops at the oldest prompt", () => {
    const atOldest = { index: 0, stash: "" };
    expect(recallBack(prompts, atOldest, "첫 지시")).toBeNull(); // i18n-ignore -- 테스트 고정값
  });

  it("does nothing when there is no history", () => {
    expect(recallBack([], null, "초안")).toBeNull(); // i18n-ignore -- 테스트 고정값
  });
});

describe("recallForward", () => {
  it("returns toward the present", () => {
    const step = recallForward(prompts, { index: 0, stash: "" })!;
    expect(step.text).toBe("둘째 지시"); // i18n-ignore -- 테스트 고정값
  });

  /** 끝까지 내려오면 recall 이 끝나고 **쓰다 만 초안이 돌아온다** — 버리면
      반쯤 쓴 지시문이 ↑ 한 번에 사라지는 꼴이 된다. */
  it("restores the stashed draft past the newest prompt", () => {
    const step = recallForward(prompts, { index: 2, stash: "쓰다 만 글" })!; // i18n-ignore -- 테스트 고정값
    expect(step).toEqual({ state: null, text: "쓰다 만 글" }); // i18n-ignore -- 테스트 고정값
  });

  it("is inert when not recalling", () => {
    expect(recallForward(prompts, null)).toBeNull();
  });
});
