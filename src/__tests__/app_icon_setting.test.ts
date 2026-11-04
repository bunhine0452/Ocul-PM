// 앱 아이콘 변형 (11-04) — 아홉 가지, 모르는 값은 기본으로 읽는다(백엔드 `app_icon.rs` 와 같다).
import { describe, expect, it } from "vitest";

import { APP_ICON_IDS, APP_ICON_PALETTES, appIconSvg } from "@/features/settings/appIconArt";
import { DEFAULTS, KEYS, entriesToSettings } from "@/lib/settings";

describe("app icon setting", () => {
  it("defaults to the bundled green icon under the app_icon key", () => {
    expect(DEFAULTS.appIcon).toBe("color");
    expect(KEYS.appIcon).toBe("app_icon");
  });

  it("reads every known variant and falls back to the default otherwise", () => {
    for (const id of APP_ICON_IDS) expect(entriesToSettings([["app_icon", id]]).appIcon).toBe(id);
    expect(entriesToSettings([["app_icon", "rainbow"]]).appIcon).toBe("color");
  });

  it("every variant has a palette and draws with ids unique to the instance", () => {
    expect(Object.keys(APP_ICON_PALETTES).sort()).toEqual([...APP_ICON_IDS].sort());
    const a = appIconSvg("dark", "x1", 34);
    expect(a).toContain('id="ai-bg-x1"');
    expect(a).toContain('width="34"');
    expect(a).not.toContain("ai-bg-x2");
  });
});
