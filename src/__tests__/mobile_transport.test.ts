// 모바일 브리지 전송 셤 (#mb2-shim) — 브라우저 경로 단위 테스트.
//
// vitest(jsdom)에는 __TAURI_INTERNALS__ 가 없으므로 셤은 자동으로 브라우저
// 모드다. fetch 는 여기서 모킹한다 — 네이티브 invoke 와의 계약(성공=Ok 값
// resolve, 실패=에러 문자열 reject)이 검증 대상.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { authHeaders, getToken, httpInvoke, isTauri, setToken } from "@/lib/transport/http";
import { SseParser } from "@/lib/transport/sse";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  mockFetch.mockReset();
});

const jsonResponse = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as Response;

describe("httpInvoke — native invoke contract", () => {
  test("jsdom is browser mode", () => {
    expect(isTauri()).toBe(false);
  });

  test("POSTs camelCase args to /api/invoke/{cmd} and resolves the Ok value", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, [{ id: 1 }]));
    setToken("tok123");

    const out = await httpInvoke("plan_list", { projectId: 1 });

    expect(out).toEqual([{ id: 1 }]);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/invoke/plan_list");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ projectId: 1 }));
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok123");
  });

  test("no-arg commands send an empty object body", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, []));
    await httpInvoke("list_projects");
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe("{}");
  });

  test("422 command errors reject with the error string, matching native reject", async () => {
    mockFetch.mockResolvedValue(jsonResponse(422, { error: "plan not found" }));
    await expect(httpInvoke("plan_get", { projectId: 1, planId: "x" })).rejects.toBe(
      "plan not found",
    );
  });

  test("Ok(None) resolves to null — the settings_get contract", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, null));
    await expect(httpInvoke("settings_get", { key: "nope" })).resolves.toBeNull();
  });

  test("network failure rejects with an unreachable message", async () => {
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(httpInvoke("list_projects")).rejects.toMatch(/mobile bridge unreachable/);
  });

  test("token set/clear round trip", () => {
    expect(getToken()).toBeNull();
    expect(authHeaders()).toEqual({});
    setToken("abc");
    expect(getToken()).toBe("abc");
    expect(authHeaders()).toEqual({ authorization: "Bearer abc" });
    setToken(null);
    expect(getToken()).toBeNull();
  });
});

describe("SseParser — frame reassembly across chunk boundaries", () => {
  test("complete frame in a single chunk", () => {
    const p = new SseParser();
    const frames = p.push('id: 3\nevent: settings-changed\ndata: {"keys":["theme"]}\n\n');
    expect(frames).toEqual([
      { id: "3", event: "settings-changed", data: '{"keys":["theme"]}' },
    ]);
  });

  test("frames split across two chunks are reassembled", () => {
    const p = new SseParser();
    expect(p.push("id: 1\nevent: oculpm-journal-")).toEqual([]);
    const frames = p.push("added\ndata: {}\n\nid: 2\nevent: e2\ndata: 1\n\n");
    expect(frames).toHaveLength(2);
    expect(frames[0]).toEqual({ id: "1", event: "oculpm-journal-added", data: "{}" });
    expect(frames[1]).toEqual({ id: "2", event: "e2", data: "1" });
  });

  test("keep-alive comments (: ping) produce no frames", () => {
    const p = new SseParser();
    expect(p.push(": ping\n\n")).toEqual([]);
  });

  test("multiple data lines join with newline", () => {
    const p = new SseParser();
    const frames = p.push("event: e\ndata: a\ndata: b\n\n");
    expect(frames[0].data).toBe("a\nb");
  });
});
