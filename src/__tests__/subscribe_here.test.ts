import { describe, expect, it, vi } from "vitest";

// 10-30: 한 창을 닫으려 하면 터미널 닫기 확인이 **모든 창**에 떴다. 백엔드는 `emit_to(창)` 로
// 그 창에만 보냈지만, 전역 `listen` 은 대상이 `Any` 라 남의 창에 간 것까지 받았다. 그 창에만
// 오는 이벤트는 현재 창을 대상으로 구독해야 한다.
const h = vi.hoisted(() => {
  const seen: string[] = [];
  const scoped = (name: string) =>
    Object.assign(
      (target: { label: string }) => ({
        listen: () => {
          seen.push(`${name}@${target.label}`);
          return Promise.resolve(() => {});
        },
      }),
      {
        listen: () => {
          seen.push(`${name}@any`);
          return Promise.resolve(() => {});
        },
      },
    );
  return { seen, scoped, current: vi.fn(() => ({ label: "project-7" })) };
});

vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: h.current }));
vi.mock("@/lib/bindings", () => ({
  commands: {},
  events: {
    termCloseAsked: h.scoped("termCloseAsked"),
    tourRequested: h.scoped("tourRequested"),
    deepLinkReceived: h.scoped("deepLinkReceived"),
  },
}));

import { onDeepLink } from "@/api/deeplink";
import { subscribeHere } from "@/api/invoke";
import { terminalApi } from "@/api/terminal";
import { windowApi } from "@/api/window";

describe("subscribeHere", () => {
  it("listens on this window only for the close ask, the tour and a deep link", async () => {
    h.seen.length = 0;
    await terminalApi.onCloseAsked(() => {});
    await windowApi.onTourRequested(() => {});
    onDeepLink(() => {});
    await Promise.resolve();
    expect(h.seen).toEqual(["termCloseAsked@project-7", "tourRequested@project-7", "deepLinkReceived@project-7"]);
  });

  it("hands back a no-op unlisten outside the webview", async () => {
    h.current.mockImplementationOnce(() => {
      throw new Error("no __TAURI_INTERNALS__");
    });
    const off = await subscribeHere(h.scoped("x"), () => {});
    expect(typeof off).toBe("function");
  });
});
