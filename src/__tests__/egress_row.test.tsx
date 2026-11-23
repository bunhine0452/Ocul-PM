// 설정 「기기를 떠나는 것」 (11-23 love-round G2 #egress-visible).
//
// 목록의 출처는 `egressDoors.json` 하나 — 두 Rust 원장 시험(`egress_inventory.rs` E · `egress_spawn_ledger.rs` D7)이
// 그 표를 원장과 대조하고, 여기서는 표의 문마다 사람 말(ko · en)이 있고 화면에 그대로 서는지를 본다.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { EgressRow, EGRESS_DOOR_IDS } from "@/features/settings/EgressRow";
import { setLangSetting, t, type I18nKey } from "@/i18n";
import { en } from "@/i18n/en";
import { ko } from "@/i18n/ko";

afterEach(() => {
  cleanup();
  setLangSetting("ko");
});

describe("EgressRow", () => {
  it("lists the update check, opened links and terminal runs — nothing more, nothing less", () => {
    expect([...EGRESS_DOOR_IDS]).toEqual(["update", "links", "terminal"]);
  });

  it("every door has a name and a one-line detail in both languages", () => {
    for (const id of EGRESS_DOOR_IDS) {
      for (const key of [`prefs.egress.${id}`, `prefs.egress.${id}.detail`]) {
        expect((ko as Record<string, string>)[key], key).toBeTruthy();
        expect((en as Record<string, string>)[key], key).toBeTruthy();
      }
    }
  });

  it("renders one item per door with its words, in the row's own list", () => {
    setLangSetting("ko");
    const { container } = render(<EgressRow />);
    const items = [...container.querySelectorAll(".prefs-egress > li")];
    expect(items.map((li) => li.getAttribute("data-door"))).toEqual([...EGRESS_DOOR_IDS]);
    expect(items[0].textContent).toContain(t("prefs.egress.update" as I18nKey));
    expect(container.textContent).toContain(t("prefs.egress.meta"));
    // 정적 문구뿐 — 링크도 단추도 없다(앱이 무엇을 부르지 않는다).
    expect(container.querySelector("a, button")).toBeNull();
  });
});
