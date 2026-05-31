import { afterEach, describe, expect, it } from "vitest";

import { __setUiV2Override, isUiV2Enabled } from "@/lib/uiFlags";

// ─── PR-UI 0 — ui_v2 flag (Final UI Update round) ─────────────────────────
//
// The flag gates the phased rollout of the new shell (PR-UI 1~7). It lives in
// src/lib/uiFlags.ts, deliberately OUTSIDE the settings KEYS registry, so
// `no_feature_flags.test.ts` keeps passing. At PR-UI 0 the flag defaults OFF
// and the App seam (WorkspaceShell) renders the legacy Workspace for BOTH
// states — flag-on and flag-off are identical until PR-UI 1 builds the new
// sidebar. These tests lock the flag's contract.

afterEach(() => {
  __setUiV2Override(null);
});

describe("PR-UI 0 — ui_v2 flag", () => {
  it("defaults OFF so flag-off renders the legacy shell", () => {
    expect(isUiV2Enabled()).toBe(false);
  });

  it("override forces the flag on and off", () => {
    __setUiV2Override(true);
    expect(isUiV2Enabled()).toBe(true);
    __setUiV2Override(false);
    expect(isUiV2Enabled()).toBe(false);
  });

  it("null override restores the default (OFF)", () => {
    __setUiV2Override(true);
    __setUiV2Override(null);
    expect(isUiV2Enabled()).toBe(false);
  });
});
