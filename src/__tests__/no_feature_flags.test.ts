import { describe, it, expect } from "vitest";

import { KEYS, DEFAULTS } from "@/lib/settings";

// ─── Lite-W6 PR1 — feature flags forbidden ──────────────────────────────
//
// PR1 was specified as "remove 5 feature flags + cleanup migration", but the
// flags (`feature_changelog_v2`, `feature_overview_v2`, `feature_clarify`,
// `feature_greenfield_wizard`, `feature_new_ia`) were never actually
// implemented — they appear only in the Lite-update planning docs. PR1 ships
// as no-op + this test, which locks the invariant going forward: the central
// settings registry must contain no `feature_*` entries.
//
// Anti-pattern from master-prompt §8: "feature flag 신설. (Lite-W6 는 *플래그
// 정리* 라운드, *추가* 라운드 아님.)"

describe("Lite-W6 PR1 — no feature flag rows", () => {
  it("settings.ts KEYS registry contains no feature_* entries", () => {
    const offenders = Object.entries(KEYS).filter(
      ([field, key]) =>
        key.startsWith("feature_") || field.toLowerCase().startsWith("feature"),
    );
    expect(offenders).toEqual([]);
  });

  it("settings.ts DEFAULTS has no feature-named fields", () => {
    const offenders = Object.keys(DEFAULTS).filter((field) =>
      field.toLowerCase().startsWith("feature"),
    );
    expect(offenders).toEqual([]);
  });
});
