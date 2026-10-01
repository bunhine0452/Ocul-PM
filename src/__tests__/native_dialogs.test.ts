import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 2026-10-01 `{#no-bare-confirm-gate}` — 웹뷰에서 bare `confirm()` 은 dialog
// 플러그인이 async 로 덮어써 truthy Promise 가 된다. 서드파티 호출은 린트가 못
// 보므로, 런타임 가드가 안전한 답(false/null)을 주고 파일 로그에 호출 위치를 남긴다.

const oculpmLog = vi.fn((_level: string, _target: string, _message: string) =>
  Promise.resolve({ status: "ok", data: null }),
);
vi.mock("@/lib/bindings", () => ({
  commands: {
    oculpmLog: (level: string, target: string, message: string) => oculpmLog(level, target, message),
  },
}));

const { installNativeDialogGuard } = await import("@/lib/nativeDialogs");

let uninstall: (() => void) | null = null;
const pluginAlert = vi.fn();

beforeEach(() => {
  oculpmLog.mockClear();
  pluginAlert.mockClear();
  // dialog 플러그인 init 스크립트가 해 두는 모양 — confirm 은 async(truthy Promise).
  window.confirm = (async () => true) as unknown as typeof window.confirm;
  window.alert = pluginAlert;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  uninstall = installNativeDialogGuard();
});

afterEach(() => {
  uninstall?.();
  uninstall = null;
  vi.restoreAllMocks();
});

describe("bare 대화상자 가드", () => {
  it("confirm 은 묻지 않은 '예' 대신 동기 false 를 돌려준다", () => {
    const answer = window.confirm("Open link?");
    expect(answer).toBe(false);
    // Promise 가 아니다 — `if (confirm(...))` 이 지나가지 않는다.
    expect(typeof answer).toBe("boolean");
  });

  it("호출을 파일 로그에 WARN 한 줄로 남긴다 (메시지·호출 위치 포함)", () => {
    window.confirm("Delete everything?");
    expect(oculpmLog).toHaveBeenCalledTimes(1);
    const [level, target, message] = oculpmLog.mock.calls[0];
    expect(level).toBe("warn");
    expect(target).toBe("dialog");
    expect(message).toContain("bare window.confirm()");
    expect(message).toContain("Delete everything?");
    expect(message).toContain(" at ");
  });

  it("prompt 는 취소(null)로 답한다", () => {
    expect(window.prompt("Name?")).toBeNull();
    expect(oculpmLog.mock.calls[0][2]).toContain("bare window.prompt()");
  });

  it("alert 는 로그를 남기고 원래 구현(플러그인 메시지 상자)으로 넘긴다", () => {
    window.alert("Saved");
    expect(pluginAlert).toHaveBeenCalledWith("Saved");
    expect(oculpmLog.mock.calls[0][2]).toContain("bare window.alert()");
  });

  it("긴 메시지는 200자로 자른다", () => {
    window.confirm("x".repeat(500));
    const message = oculpmLog.mock.calls[0][2];
    expect(message).toContain(`"${"x".repeat(200)}"`);
    expect(message).not.toContain("x".repeat(201));
  });

  it("해제하면 원래 함수로 돌아간다", () => {
    uninstall?.();
    uninstall = null;
    window.alert("after");
    expect(pluginAlert).toHaveBeenCalledWith("after");
    expect(oculpmLog).not.toHaveBeenCalled();
  });
});
