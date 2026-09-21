import { describe, expect, it } from "vitest";

import { deriveIntegrationStatus } from "@/features/terminal/shellStatus";

// The terminal toolbar used to say "shell integration is off" whenever the focused
// pane had not yet produced a nonce-verified OSC 133 marker — including panes that
// were reattached after an app restart, panes running a long program, and fresh
// shells before their first prompt — while Settings showed the integration as
// installed (2026-09-22). Three states, not two.

describe("deriveIntegrationStatus", () => {
  it("is active once the pane has a verified signal, whatever settings say", () => {
    expect(deriveIntegrationStatus({ active: true, provisioned: false }, false)).toBe("active");
    expect(deriveIntegrationStatus({ active: true }, null)).toBe("active");
  });

  it("is pending when the pane was spawned with the script but has not signalled yet", () => {
    expect(deriveIntegrationStatus({ active: false, provisioned: true }, null)).toBe("pending");
    expect(deriveIntegrationStatus({ active: false, provisioned: true }, false)).toBe("pending");
  });

  it("is pending when settings report the rc block installed and the pane is silent or unknown", () => {
    expect(deriveIntegrationStatus({ active: false, provisioned: false }, true)).toBe("pending");
    expect(deriveIntegrationStatus(undefined, true)).toBe("pending");
  });

  it("is off only when neither the pane nor settings know of any integration", () => {
    expect(deriveIntegrationStatus({ active: false, provisioned: false }, false)).toBe("off");
    expect(deriveIntegrationStatus(undefined, null)).toBe("off");
    expect(deriveIntegrationStatus({ active: false }, null)).toBe("off");
  });
});
