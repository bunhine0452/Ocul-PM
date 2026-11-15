/**
 * 사전의 셸 · 단축키 낱말 (11-15 최종 검수).
 *
 *  - 부르는 곳이 없어진 키는 사전에도 없다 — 「N건 더」 를 일지 화면으로 보내며 남은 `today.unread.less`, 날짜 머리를
 *    `workdayLabel` 로 옮기며 남은 `journal.dayYmd`, 그리고 이번 고침이 걷은 셋(⌘O 의 ✓ 이름 · 시작 창과 오늘의 옛
 *    줄 옮기기 이름).
 *  - 「내 차례」 는 오늘 화면의 계획 사람 몫(누르면 계획으로)에만 남는다 — ⌘J 는 기다리는 세션으로 가는 키라
 *    「기다림」 계열로 부른다. 같은 말이 두 가지를 가리켰다.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { en } from "@/i18n/en";
import { ko } from "@/i18n/ko";

import { ROOT, walk } from "./designFs";

const GONE = ["today.unread.less", "journal.dayYmd", "sidebar.currentProject", "start.keysMove", "keys.todayMove"];

describe("dictionary keys nobody calls", () => {
  it("are gone from both dictionaries and nothing in src asks for them", () => {
    for (const key of GONE) {
      expect(key in ko, key).toBe(false);
      expect(key in en, key).toBe(false);
    }
    const callers = [...walk(ROOT)].filter((file) => GONE.some((key) => readFileSync(file, "utf8").includes(`"${key}"`)));
    expect(callers).toEqual([]);
  });
});

describe("one word, one meaning", () => {
  const MY_TURN = "내 차례"; // i18n-ignore -- 사전 낱말이 검사 재료다

  it("no shortcut name says 「my turn」 — ⌘J is named for the waiting session", () => {
    const shortcutNames = Object.entries(ko).filter(([key, value]) => key.startsWith("keys.") && value.includes(MY_TURN));
    expect(shortcutNames).toEqual([]);
    expect(ko["keys.jumpWaiting"]).toContain("기다리는"); // i18n-ignore -- 사전 낱말이 검사 재료다
    expect(en["keys.jumpWaiting"]).not.toMatch(/\b(my|your) turn\b/i);
    expect(en["keys.jumpWaiting"]).toMatch(/waiting/);
  });

  it("「my turn」 stays with the plan's human-owned items on Today and in the planner", () => {
    expect(ko["today.nums.mine"]).toContain(MY_TURN);
    expect(ko["plan.item.user"]).toContain(MY_TURN);
  });

  // 단축키 표의 줄은 「줄」 하나로 — 「줄 사이 이동」 바로 아래 「처음 · 끝 행으로」 · 「그 행의 동작」 이 같은 것을 두 낱말로
  // 불렀다(11-15 재검수). 「실행」 처럼 낱말 가운데의 글자는 행이 아니다 — 낱말 머리의 「행」 만 본다.
  it("the shortcut sheet has one word for a row", () => {
    const rowWord = /(?<![가-힣])행/; // i18n-ignore -- 사전 낱말이 검사 재료다
    const named = Object.entries(ko).filter(([key, value]) => key.startsWith("keys.") && rowWord.test(value));
    expect(named).toEqual([]);
  });
});
