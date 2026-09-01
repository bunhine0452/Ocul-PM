import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

// ─── Phase 7 — 도달성 표시의 계약 ──────────────────────────────────────────
//
// 이 훅이 지켜야 하는 것은 하나다: **"모른다" 를 "안 된다" 로 그리지 않는다.**
// 백엔드는 한 번이라도 불러 본 프로바이더만 돌려주므로, 목록에 없는 것은
// 관측이 없다는 뜻이지 못 닿는다는 뜻이 아니다. 첫 실행에 모든 모델이 회색이
// 되는 것이 이 규약이 막는 실패다.

const fx = { marks: [] as unknown[] };

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) =>
          prop === "llmReachability" ? () => ok(fx.marks) : () => ok(null),
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

import { useReachability } from "@/features/settings/useReachability";

function Probe({ providers }: { providers: string[] }) {
  const reach = useReachability();
  return (
    <ul>
      {providers.map((p) => (
        <li key={p} data-testid={p}>
          {reach.offline(p) ? "offline" : "ok"}
          {reach.detail(p) ? ` — ${reach.detail(p)}` : ""}
        </li>
      ))}
    </ul>
  );
}

beforeEach(() => {
  fx.marks = [];
});

afterEach(cleanup);

describe("useReachability", () => {
  it("관측이 없는 프로바이더는 정상으로 그린다", async () => {
    render(<Probe providers={["anthropic", "openai"]} />);
    await waitFor(() => expect(screen.getByTestId("anthropic").textContent).toBe("ok"));
    expect(screen.getByTestId("openai").textContent).toBe("ok");
  });

  it("전송 실패가 관측된 프로바이더만 오프라인이고, 사유를 그대로 싣는다", async () => {
    fx.marks = [
      {
        provider: "anthropic",
        reachable: false,
        detail: "http: error sending request",
        observed_at: "2026-09-01T10:00:00+00:00",
      },
      { provider: "openai", reachable: true, detail: null, observed_at: "2026-09-01T10:00:01+00:00" },
    ];
    render(<Probe providers={["anthropic", "openai", "gemini"]} />);

    await waitFor(() =>
      expect(screen.getByTestId("anthropic").textContent).toBe(
        "offline — http: error sending request",
      ),
    );
    // 성공이 관측된 것도, 아무 관측이 없는 것도 정상이다.
    expect(screen.getByTestId("openai").textContent).toBe("ok");
    expect(screen.getByTestId("gemini").textContent).toBe("ok");
  });
});
