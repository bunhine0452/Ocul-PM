import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// 2026-08-20 — "무엇이 기여했나가 잘 안 보인다".
//
// 원문을 통째로 `<pre>` 에 걸었더니 292px 카드에서 한 문장이 네 줄로 접히고
// 그 아래가 잘렸다. 모양별로 뜯어 그리되 **모르는 줄은 원문 그대로** 남는지가
// 이 스위트의 계약이다.

const DETAIL = [
  "Approximate, based on local sessions on this machine — does not include other devices or claude.ai.",
  "",
  "Last 7d · 4704 requests · 44 sessions",
  "  92% of your usage was at >150k context",
  "  Top skills: /frontend-design:frontend-design 2%, /claude-api 1%",
  "  누구도 모르는 새 줄",
].join("\n");

const usage = {
  used: 100,
  size: 1000,
  cost_usd: 1.5,
  detail: DETAIL,
  limits: [
    {
      kind: "five_hour",
      utilization: 0.42,
      resets_at: null,
      resets_text: "Aug 23 at 5am",
      status: null,
    },
  ],
};

vi.mock("@/lib/bindings", () => ({
  commands: {
    acpUsage: vi.fn(async () => ({ status: "ok", data: usage })),
    acpRefreshUsage: vi.fn(async () => ({ status: "ok", data: usage })),
  },
}));

const { AcpUsageMeter } = await import("@/features/chat/AcpUsageMeter");

afterEach(cleanup);

async function openCard() {
  render(<AcpUsageMeter projectId={1} />);
  const button = await waitFor(() => {
    const found = document.querySelector(".usage-meter");
    if (!found) throw new Error("계기가 아직 안 떴다");
    return found;
  });
  fireEvent.click(button);
  await waitFor(() => screen.getByRole("dialog"));
}

describe("사용량 카드의 기여도 대목", () => {
  it("비율 줄은 숫자와 설명으로 갈라져 막대와 함께 뜬다", async () => {
    await openCard();
    const share = document.querySelector(".usage-share");
    expect(share?.textContent).toContain("was at >150k context");
    expect(share?.textContent).toContain("92");
    // 되풀이되는 군더더기는 뗀다 — 네 줄이 같은 말로 시작하면 폭만 먹는다.
    expect(share?.textContent).not.toContain("of your usage");
    expect(share?.querySelector(".usage-bar-fill")?.getAttribute("style")).toContain("92%");
  });

  it("Top 줄은 이름표와 칩으로", async () => {
    await openCard();
    const top = document.querySelector(".usage-top");
    expect(top?.querySelector(".usage-top-label")?.textContent).toBe("Top skills");
    const chips = [...(top?.querySelectorAll(".usage-chip") ?? [])].map((c) => c.textContent);
    expect(chips).toEqual(["/frontend-design:frontend-design2%", "/claude-api1%"]);
  });

  it("단서 문장은 고정폭에서 풀어 준다", async () => {
    await openCard();
    expect(document.querySelector(".usage-note")?.textContent).toContain("Approximate, based on");
  });

  it("모르는 줄도 사라지지 않는다", async () => {
    await openCard();
    expect(document.querySelector(".usage-raw")?.textContent).toContain("누구도 모르는 새 줄");
  });
});
