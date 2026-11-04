// 앱 아이콘 컬러 / 흑백 (11-04) — 설정 값은 둘뿐이고, 모르는 값은 컬러로 읽는다(백엔드 `app_icon.rs` 와 같다).
import { describe, expect, it } from "vitest";

import { DEFAULTS, KEYS, entriesToSettings } from "@/lib/settings";

describe("app icon setting", () => {
  it("defaults to colour under the app_icon key", () => {
    expect(DEFAULTS.appIcon).toBe("color");
    expect(KEYS.appIcon).toBe("app_icon");
  });

  it("only mono is mono, anything else reads as colour", () => {
    expect(entriesToSettings([["app_icon", "mono"]]).appIcon).toBe("mono");
    expect(entriesToSettings([["app_icon", "color"]]).appIcon).toBe("color");
    expect(entriesToSettings([["app_icon", "rainbow"]]).appIcon).toBe("color");
  });
});
