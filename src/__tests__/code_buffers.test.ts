import { beforeEach, describe, expect, it } from "vitest";
import {
  CODE_BUFFER_CAP,
  _resetBuffers,
  bufferKey,
  deleteBuffer,
  detectEol,
  getBuffer,
  isDirty,
  listDirtyPaths,
  normalizeEol,
  putBuffer,
  restoreEol,
} from "@/features/code/codeBuffers";

// 코드 화면 — 편집 버퍼 캐시 (모듈 스코프 LRU). 미저장 편집이 화면·파일
// 전환에도 살아남는 것이 계약이고, 상한 초과 시 깨끗한 버퍼부터 밀려난다.

const clean = (text: string) => ({ text, baseText: text, baseHash: "h", eol: "\n" as const });
const dirty = (text: string) =>
  ({ text, baseText: text + "-base", baseHash: "h", eol: "\n" as const });

beforeEach(_resetBuffers);

describe("codeBuffers", () => {
  it("stores and retrieves by project-scoped key", () => {
    putBuffer(bufferKey(1, "a.ts"), clean("x"));
    expect(getBuffer(bufferKey(1, "a.ts"))?.text).toBe("x");
    expect(getBuffer(bufferKey(2, "a.ts"))).toBeUndefined();
    deleteBuffer(bufferKey(1, "a.ts"));
    expect(getBuffer(bufferKey(1, "a.ts"))).toBeUndefined();
  });

  it("isDirty compares text against baseText", () => {
    expect(isDirty(clean("x"))).toBe(false);
    expect(isDirty(dirty("x"))).toBe(true);
  });

  it("evicts the oldest CLEAN buffer first when over cap", () => {
    putBuffer(bufferKey(1, "dirty-oldest.ts"), dirty("d"));
    for (let i = 0; i < CODE_BUFFER_CAP; i++) {
      putBuffer(bufferKey(1, `clean-${i}.ts`), clean(`c${i}`));
    }
    // 상한 초과 — 가장 오래된 것은 dirty 지만, 깨끗한 clean-0 이 먼저 밀린다.
    expect(getBuffer(bufferKey(1, "dirty-oldest.ts"))).toBeDefined();
    expect(getBuffer(bufferKey(1, "clean-0.ts"))).toBeUndefined();
    expect(getBuffer(bufferKey(1, `clean-${CODE_BUFFER_CAP - 1}.ts`))).toBeDefined();
  });

  it("falls back to evicting the oldest dirty buffer when all are dirty", () => {
    for (let i = 0; i <= CODE_BUFFER_CAP; i++) {
      putBuffer(bufferKey(1, `d-${i}.ts`), dirty(`d${i}`));
    }
    expect(getBuffer(bufferKey(1, "d-0.ts"))).toBeUndefined();
    expect(getBuffer(bufferKey(1, `d-${CODE_BUFFER_CAP}.ts`))).toBeDefined();
  });

  it("re-inserting an existing key refreshes its LRU position", () => {
    putBuffer(bufferKey(1, "a.ts"), clean("a"));
    putBuffer(bufferKey(1, "b.ts"), clean("b"));
    // a 를 다시 만지면 b 가 가장 오래된 것이 된다.
    putBuffer(bufferKey(1, "a.ts"), clean("a2"));
    for (let i = 0; i < CODE_BUFFER_CAP - 1; i++) {
      putBuffer(bufferKey(1, `x-${i}.ts`), clean(`x${i}`));
    }
    expect(getBuffer(bufferKey(1, "b.ts"))).toBeUndefined();
    expect(getBuffer(bufferKey(1, "a.ts"))?.text).toBe("a2");
  });

  it("listDirtyPaths returns only this project's dirty paths", () => {
    putBuffer(bufferKey(1, "clean.ts"), clean("c"));
    putBuffer(bufferKey(1, "dirty.ts"), dirty("d"));
    putBuffer(bufferKey(2, "other.ts"), dirty("o"));
    expect([...listDirtyPaths(1)]).toEqual(["dirty.ts"]);
  });

  it("putBuffer returns the evicted key only when unsaved edits were lost", () => {
    putBuffer(bufferKey(1, "dirty-oldest.ts"), dirty("d"));
    let last: string | null = null;
    for (let i = 0; i < CODE_BUFFER_CAP; i++) {
      last = putBuffer(bufferKey(1, `clean-${i}.ts`), clean(`c${i}`));
    }
    // clean-0 이 밀렸다 — 깨끗했으므로 알릴 것 없음.
    expect(last).toBeNull();

    _resetBuffers();
    for (let i = 0; i <= CODE_BUFFER_CAP; i++) {
      last = putBuffer(bufferKey(1, `d-${i}.ts`), dirty(`d${i}`));
    }
    // 전부 dirty — 가장 오래된 d-0 이 미저장 편집째 밀렸으니 키를 알린다.
    expect(last).toBe(bufferKey(1, "d-0.ts"));
  });
});

describe("eol helpers", () => {
  it("detectEol picks the dominant line ending", () => {
    expect(detectEol("a\nb\n")).toBe("\n");
    expect(detectEol("a\r\nb\r\n")).toBe("\r\n");
    expect(detectEol("")).toBe("\n");
    expect(detectEol("no newline")).toBe("\n");
    // 혼합 — 다수결, 동률이면 LF.
    expect(detectEol("a\r\nb\r\nc\n")).toBe("\r\n");
    expect(detectEol("a\r\nb\nc\n")).toBe("\n");
  });

  it("normalize + restore round-trips a CRLF file byte-for-byte", () => {
    const disk = "line1\r\nline2\r\nline3\r\n";
    const eol = detectEol(disk);
    expect(restoreEol(normalizeEol(disk), eol)).toBe(disk);
  });

  it("restoreEol leaves LF files untouched", () => {
    expect(restoreEol("a\nb\n", "\n")).toBe("a\nb\n");
  });
});
