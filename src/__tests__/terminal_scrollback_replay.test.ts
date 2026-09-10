/**
 * 재접속 스크롤백을 찍힌 폭 그대로 재생한다 (2026-09-11).
 *
 * 도크(좁음)↔터미널 화면(넓음)을 오가면 옛 대화가 찌부러지던 버그의 수리 —
 * 근거는 `scrollbackReplay.ts` 머리 주석. 여기서는 두 가지를 못박는다:
 *
 *  1) 스냅샷은 마커대로 "크기 → 텍스트" 구간으로 잘린다 (경계·정렬·빈 구간)
 *  2) 재생은 앞 구간의 쓰기가 **끝난 뒤에야** 다음 크기로 바꾼다 — xterm 의
 *     write 는 비동기라 순서를 지키지 않으면 마지막 크기로 전부 해석된다
 */
import { describe, it, expect } from "vitest";

import { replayInto, splitReplay, type ReplayTarget } from "@/features/terminal/scrollbackReplay";

describe("splitReplay — 마커대로 구간을 자른다", () => {
  it("첫 마커가 0 이면 구간마다 그 크기를 입는다", () => {
    const segs = splitReplay("abcdefgh", [
      { at: 0, rows: 24, cols: 80 },
      { at: 3, rows: 40, cols: 200 },
      { at: 7, rows: 40, cols: 60 },
    ]);
    expect(segs).toEqual([
      { rows: 24, cols: 80, text: "abc" },
      { rows: 40, cols: 200, text: "defg" },
      { rows: 40, cols: 60, text: "h" },
    ]);
  });

  it("마커가 없으면(구버전 호스트) 크기를 모르는 한 구간이다", () => {
    expect(splitReplay("hello", [])).toEqual([{ rows: 0, cols: 0, text: "hello" }]);
    expect(splitReplay("", [])).toEqual([]);
  });

  it("첫 마커 앞의 텍스트는 크기를 모르는 구간으로 남긴다", () => {
    expect(splitReplay("xxyy", [{ at: 2, rows: 24, cols: 80 }])).toEqual([
      { rows: 0, cols: 0, text: "xx" },
      { rows: 24, cols: 80, text: "yy" },
    ]);
  });

  it("텍스트 끝의 마커는 빈 구간으로 남아 마지막 크기를 정한다", () => {
    expect(splitReplay("ab", [{ at: 0, rows: 24, cols: 80 }, { at: 2, rows: 30, cols: 120 }])).toEqual([
      { rows: 24, cols: 80, text: "ab" },
      { rows: 30, cols: 120, text: "" },
    ]);
  });

  it("어긋난 마커를 정리한다 — 정렬·범위 밖·같은 자리·0 크기", () => {
    expect(
      splitReplay("abcd", [
        { at: 2, rows: 24, cols: 90 },
        { at: 0, rows: 24, cols: 80 },
        { at: 2, rows: 24, cols: 100 }, // 같은 자리 — 마지막이 이긴다
        { at: 99, rows: 24, cols: 50 }, // 범위 밖 — 끝으로 접힌다
        { at: 1, rows: 0, cols: 80 }, // 0 크기 — 버린다
      ]),
    ).toEqual([
      { rows: 24, cols: 80, text: "ab" },
      { rows: 24, cols: 100, text: "cd" },
      { rows: 24, cols: 50, text: "" },
    ]);
  });
});

/** write 를 붙들어 두는 가짜 xterm — 콜백 시점을 테스트가 쥔다. */
function fakeTerm() {
  const log: string[] = [];
  const pending: (() => void)[] = [];
  const term: ReplayTarget = {
    resize(cols, rows) {
      log.push(`resize ${cols}x${rows}`);
    },
    write(data, callback) {
      log.push(`write ${data}`);
      if (callback) pending.push(callback);
    },
  };
  return { term, log, flush: () => pending.shift()?.() };
}

describe("replayInto — 앞 구간이 다 써진 뒤에야 다음 크기로 바꾼다", () => {
  it("resize → write → (콜백) → resize → write 순서를 지킨다", async () => {
    const { term, log, flush } = fakeTerm();
    const done = replayInto(term, [
      { rows: 24, cols: 80, text: "A" },
      { rows: 24, cols: 40, text: "B" },
    ]);
    await Promise.resolve();
    // 첫 구간의 콜백이 오기 전에는 두 번째 resize 가 나가지 않는다.
    expect(log).toEqual(["resize 80x24", "write A"]);
    flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(log).toEqual(["resize 80x24", "write A", "resize 40x24", "write B"]);
    flush();
    await done;
  });

  it("크기를 모르는 구간은 resize 없이 쓰고, 빈 구간은 resize 만 한다", async () => {
    const { term, log, flush } = fakeTerm();
    const done = replayInto(term, [
      { rows: 0, cols: 0, text: "old" },
      { rows: 30, cols: 120, text: "" },
    ]);
    await Promise.resolve();
    expect(log).toEqual(["write old"]);
    flush();
    await done;
    expect(log).toEqual(["write old", "resize 120x30"]);
  });
});
