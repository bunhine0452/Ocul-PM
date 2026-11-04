// 앱 아이콘 고르기 (11-04) — 라디오 아홉, 고르면 저장, 방향키로 옮긴다.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AppIconPicker } from "@/features/settings/AppIconPicker";
import { APP_ICON_IDS } from "@/features/settings/appIconArt";
import { t } from "@/i18n";

afterEach(cleanup);

describe("app icon picker", () => {
  it("shows all nine as radios with the current one checked, and picks on click", () => {
    const onChange = vi.fn();
    render(<AppIconPicker value="mono" onChange={onChange} />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(APP_ICON_IDS.length);
    expect(screen.getByRole("radio", { name: t("appIcon.mono") })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: t("appIcon.dark") }));
    expect(onChange).toHaveBeenCalledWith("dark");
  });

  it("arrow keys move to the next variant, wrapping around", () => {
    const onChange = vi.fn();
    render(<AppIconPicker value="teal" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("color");
  });
});
