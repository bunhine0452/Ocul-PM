// 설치본 로그 2026-10-01: `oculpmLog.warn` 한 번이 파일에 **두 줄**로 남았다 —
// 한 줄은 직접 보낸 것, 한 줄은 DevTools 거울로 부른 `console.warn` 을 브리지가
// 다시 실어 보낸 것. 앱이 남기는 모든 경고·오류가 두 배로 적히고 있었다.
import { describe, expect, test, vi } from "vitest";

const sent: Array<[string, string, string]> = [];
vi.mock("@/lib/bindings", () => ({
  commands: {
    oculpmLog: (level: string, target: string, message: string) => {
      sent.push([level, target, message]);
      return Promise.resolve({ status: "ok", data: null });
    },
  },
}));

import { installConsoleBridge, oculpmLog } from "@/lib/oculpmLog";

describe("console bridge — 앱 로그는 한 번만 적힌다", () => {
  test("oculpmLog.warn/error 는 브리지가 깔린 뒤에도 한 줄씩", () => {
    const silence = vi.spyOn(console, "warn").mockImplementation(() => {});
    const silenceErr = vi.spyOn(console, "error").mockImplementation(() => {});
    installConsoleBridge();
    sent.length = 0;

    oculpmLog.warn("updater", "check -> error");
    oculpmLog.error("updater", "install -> error");
    expect(sent).toEqual([
      ["warn", "updater", "check -> error"],
      ["error", "updater", "install -> error"],
    ]);

    // 서드파티의 console.warn 은 여전히 브리지가 받아 적는다.
    console.warn("third-party");
    expect(sent[sent.length - 1]).toEqual(["warn", "console", "third-party"]);

    silence.mockRestore();
    silenceErr.mockRestore();
  });
});
