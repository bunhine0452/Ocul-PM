import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { localIsoDate } from "@/lib/workday";

// 한국 시간 09시 전에는 UTC 날짜가 하루 이르다 — 자동화 정의의 `created` 가
// 어제로 찍히던 자리 (`toISOString().slice(0, 10)`).
describe("localIsoDate", () => {
  let prevTz: string | undefined;
  beforeEach(() => {
    prevTz = process.env.TZ;
    process.env.TZ = "Asia/Seoul";
  });
  afterEach(() => {
    if (prevTz === undefined) delete process.env.TZ;
    else process.env.TZ = prevTz;
  });

  it("returns the local calendar date even when UTC is still the previous day", () => {
    const earlyMorningKst = new Date("2026-10-17T16:30:00Z"); // 10-18 01:30 KST
    expect(earlyMorningKst.toISOString().slice(0, 10)).toBe("2026-10-17");
    expect(localIsoDate(earlyMorningKst)).toBe("2026-10-18");
  });

  it("rolls over month and year ends", () => {
    expect(localIsoDate(new Date("2026-12-31T15:00:00Z"))).toBe("2027-01-01");
  });
});
