// ui_v2 — Final UI Update round phased-rollout flag.
//
// Lives OUTSIDE the settings KEYS registry on purpose: `no_feature_flags.test.ts`
// forbids `feature_*` rows in src/lib/settings.ts, and the Lite-W6 round was a
// "remove flags" round. The Final UI Update round (2026-05-31) is a sanctioned
// exception — see docs/Lite-update/Fianl_UI_update_before1.0/UI-MASTER-PROMPT.md
// and 05-implementation-checklist.md §0. The flag is a plain module const (not a
// settings row, not a WorkspaceContext field) so it can't leak into either
// persisted registry. PR-UI 7 flips the default ON permanently, then deletes
// this module along with every `isUiV2Enabled()` call site.
//
// Default OFF in PR-UI 0: flag-off renders the legacy shell unchanged, and
// flag-on also renders the legacy shell (the new Sidebar shell arrives in
// PR-UI 1), so the two states are byte-identical at this checkpoint.

let testOverride: boolean | null = null;

export function isUiV2Enabled(): boolean {
  if (testOverride !== null) return testOverride;
  return false;
}

/**
 * Test-only override. Pass a boolean to force the flag on/off, or `null` to
 * restore the default. Never call this from app code.
 */
export function __setUiV2Override(value: boolean | null): void {
  testOverride = value;
}
