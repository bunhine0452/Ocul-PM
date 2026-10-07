import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ConfigControl, DANGEROUS_MODES } from "@/features/chat/conversation/ConfigControls";
import { t } from "@/i18n";
import type { AcpConfigOption } from "@/lib/bindings";

// 위험한 권한 모드는 메뉴에서 고를 때 한 번 더 묻는다 (보안 피드백 #6).
// ⇧Tab 순환은 원래부터 이 모드들을 건너뛴다 — 여기서 지키는 것은 메뉴 쪽이다.

const MODE: AcpConfigOption = {
  id: "mode",
  name: "Mode",
  category: "mode",
  current: "default",
  is_boolean: false,
  choices: [
    { value: "default", name: "Default", description: "Prompts for dangerous operations" },
    { value: "acceptEdits", name: "Accept Edits", description: null },
    { value: "bypassPermissions", name: "Bypass Permissions", description: "Skips every prompt" },
  ],
};

afterEach(cleanup);

function openMenu() {
  fireEvent.click(screen.getByTitle("Mode"));
}

describe("dangerous permission modes", () => {
  it("applies a safe mode straight away", () => {
    const onChange = vi.fn();
    render(<ConfigControl option={MODE} onChange={onChange} />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Accept Edits/ }));
    expect(onChange).toHaveBeenCalledWith("mode", "acceptEdits");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks before bypassPermissions and does nothing on cancel", async () => {
    const onChange = vi.fn();
    render(<ConfigControl option={MODE} onChange={onChange} />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Bypass Permissions/ }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain(
      t("acp.mode.dangerTitle", { mode: "Bypass Permissions" }),
    );
    expect(dialog.textContent).toContain("Skips every prompt");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onChange).not.toHaveBeenCalled();

    openMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Bypass Permissions/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: t("acp.mode.dangerConfirm") }),
    );
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("mode", "bypassPermissions"));
  });

  it("covers Claude's two silent modes and Codex full access", () => {
    expect([...DANGEROUS_MODES].sort()).toEqual(["bypassPermissions", "dontAsk", "full-access"]);
  });
});
