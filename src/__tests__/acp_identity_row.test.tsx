import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// acp-adapter-0751 {#carry-auth} — 어댑터가 `_auth/status_update` 로 밀어 주는
// 신원을 사용량 카드가 보여 준다. 계약 셋: 보고가 없으면(`identity: null`)
// 아무 줄도 없다 · 계정이면 이름표와 이메일 · 로그아웃(`kind: none`)은 한도가
// 없어도 계기가 서고 경고로 그린다.

const limit = { kind: "five_hour", utilization: 0.42, resets_at: null, resets_text: null, status: null };
const account = {
  kind: "account",
  label: "Claude Max",
  detail: null,
  email: "me@example.com",
  organization: "Acme",
  plan: "max",
};

let current: Record<string, unknown> = {};
vi.mock("@/lib/bindings", () => ({
  commands: {
    acpUsage: vi.fn(async () => ({ status: "ok", data: current })),
    acpRefreshUsage: vi.fn(async () => ({ status: "ok", data: current })),
  },
}));

const { AcpUsageMeter } = await import("@/features/chat/AcpUsageMeter");

afterEach(cleanup);

async function meter() {
  render(<AcpUsageMeter projectId={1} />);
  return waitFor(() => {
    const found = document.querySelector(".usage-meter");
    if (!found) throw new Error("계기가 아직 안 떴다");
    return found;
  });
}

describe("사용량 카드의 신원 줄", () => {
  it("보고가 없으면 아무 줄도 없다 — 침묵은 로그아웃이 아니다", async () => {
    current = { used: 0, size: 0, cost_usd: null, detail: null, limits: [limit], identity: null };
    fireEvent.click(await meter());
    await waitFor(() => screen.getByRole("dialog"));
    expect(screen.queryByTestId("usage-identity")).toBeNull();
    expect(document.querySelector(".usage-pill.warn")).toBeNull();
  });

  it("계정이면 이름표·종류·이메일", async () => {
    current = { used: 0, size: 0, cost_usd: null, detail: null, limits: [limit], identity: account };
    fireEvent.click(await meter());
    await waitFor(() => screen.getByRole("dialog"));
    const row = screen.getByTestId("usage-identity");
    expect(row.querySelector(".usage-identity-label")?.textContent).toContain("Claude Max");
    expect(row.querySelector(".usage-identity-kind")?.textContent).toBe("구독 계정");
    expect(row.querySelector(".usage-identity-detail")?.textContent).toBe("me@example.com");
    expect(row.classList.contains("warn")).toBe(false);
  });

  it("로그아웃은 한도가 없어도 계기가 서고, 경고로 그린다", async () => {
    current = {
      used: 0,
      size: 0,
      cost_usd: null,
      detail: null,
      limits: [],
      identity: { kind: "none", label: "Not logged in", detail: null, email: null, organization: null, plan: null },
    };
    const button = await meter();
    expect(button.querySelector(".usage-pill.warn")?.textContent).toContain("로그인 필요");
    fireEvent.click(button);
    await waitFor(() => screen.getByRole("dialog"));
    const row = screen.getByTestId("usage-identity");
    expect(row.classList.contains("warn")).toBe(true);
    expect(row.querySelector(".usage-identity-label")?.textContent).toContain("로그인되어 있지 않아요");
  });
});
