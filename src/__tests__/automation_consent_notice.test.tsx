import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AutomationConsentNotice } from "@/features/settings/automation/AutomationConsentNotice";
import { t } from "@/i18n";
import type { AutomationConsent } from "@/lib/bindings";

// 배경 자동화의 기기 동의 안내 (보안 피드백 라운드 #automation-consent).
//
// 지키는 계약:
//  1. 저장소 config 가 켠 스위치가 있고 아직 허락하지 않았을 때만 그린다.
//  2. 「이 기기에서 켜기」는 동의를 기록하고, 그 뒤로는 사라진다.
//  3. 오늘 카드는 이번 실행 동안 접을 수 있다 — 설정 안내는 접히지 않는다.
//  4. 상태를 못 읽으면 아무것도 그리지 않는다 (토스트로 쏟지 않는다).

const status = vi.hoisted(() => ({
  current: { requested: [] as string[], granted: false } as AutomationConsent,
}));
const grants = vi.hoisted(() => ({ current: 0 }));
const failRead = vi.hoisted(() => ({ current: false }));

vi.mock("@/api/automation", () => ({
  automationApi: {
    consentStatus: () =>
      failRead.current ? Promise.reject(new Error("nope")) : Promise.resolve(status.current),
    consentGrant: () => {
      grants.current += 1;
      status.current = { ...status.current, granted: true };
      return Promise.resolve(status.current);
    },
  },
}));
vi.mock("@/lib/toast", () => ({
  toast: { info: vi.fn(), destructive: vi.fn(), warning: vi.fn() },
}));

beforeEach(() => {
  status.current = { requested: [], granted: false };
  grants.current = 0;
  failRead.current = false;
});
afterEach(cleanup);

describe("AutomationConsentNotice", () => {
  it("names the switches the repository turned on and records consent", async () => {
    status.current = {
      requested: ["agents.auto_reconcile", "automation.schedules"],
      granted: false,
    };
    const onGranted = vi.fn();
    render(<AutomationConsentNotice projectId={1} variant="inline" onGranted={onGranted} />);

    const notice = await screen.findByRole("status");
    expect(notice.textContent).toContain(t("automation.consent.switch.reconcile"));
    expect(notice.textContent).toContain(t("automation.consent.switch.schedules"));
    expect(notice.textContent).toContain(".oculpm/config.toml");
    // 설정 안내는 접을 수 없다.
    expect(screen.queryByRole("button", { name: t("automation.consent.dismiss") })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: t("automation.consent.grant") }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(grants.current).toBe(1);
    expect(onGranted).toHaveBeenCalledTimes(1);
  });

  it("draws nothing when nothing is pending", async () => {
    status.current = { requested: ["agents.auto_reconcile"], granted: true };
    const { container } = render(<AutomationConsentNotice projectId={2} variant="card" />);
    await waitFor(() => expect(container.innerHTML).toBe(""));

    status.current = { requested: [], granted: false };
    const again = render(<AutomationConsentNotice projectId={3} variant="card" />);
    await waitFor(() => expect(again.container.innerHTML).toBe(""));
  });

  it("lets the Today card be put away for this run only", async () => {
    status.current = { requested: ["automation.watchers"], granted: false };
    render(<AutomationConsentNotice projectId={4} variant="card" />);
    fireEvent.click(await screen.findByRole("button", { name: t("automation.consent.dismiss") }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(grants.current).toBe(0);
    cleanup();

    // 같은 실행 안에서 다시 그려도 접힌 채다. 설정 안내는 여전히 말한다.
    render(<AutomationConsentNotice projectId={4} variant="card" />);
    render(<AutomationConsentNotice projectId={4} variant="inline" />);
    await waitFor(() => expect(screen.getAllByRole("status")).toHaveLength(1));
  });

  it("stays silent when the status cannot be read", async () => {
    failRead.current = true;
    const { container } = render(<AutomationConsentNotice projectId={5} variant="card" />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.innerHTML).toBe("");
  });
});
