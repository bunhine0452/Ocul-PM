import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { t } from "@/i18n";
import { VscodeExtensionBlock } from "@/features/settings/VscodeExtensionBlock";

// vscode-extension-round {#app-settings}: settings > integration "VS Code extension" row.
// Passing `status` as a prop skips the backend command (two-state snapshots).

const urls = {
  marketplace_url: "https://marketplace.visualstudio.com/items?itemName=oculpm.ocul-pm",
  open_vsx_url: "https://open-vsx.org/extension/oculpm/ocul-pm",
};

afterEach(() => cleanup());

describe("VscodeExtensionBlock", () => {
  it("not installed: badge + machine-scope chip + two market links (user-click anchors)", () => {
    const r = render(<VscodeExtensionBlock status={{ installed: false, editor: null, ...urls }} />);
    expect(r.getByText(t("op.plugin.notInstalled"))).toBeTruthy();
    expect(r.getByText(t("op.scope.machine"))).toBeTruthy();
    const links = r.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links).toEqual([urls.marketplace_url, urls.open_vsx_url]);
    expect(r.queryByText(t("op.vscode.installedHint"))).toBeNull();
    expect(r.container).toMatchSnapshot();
  });

  it("installed (stable): badge + round-trip hint", () => {
    const r = render(<VscodeExtensionBlock status={{ installed: true, editor: "vscode", ...urls }} />);
    expect(r.getByText(t("op.plugin.installed"))).toBeTruthy();
    expect(r.getByText(t("op.vscode.installedHint"))).toBeTruthy();
    expect(r.container).toMatchSnapshot();
  });

  it("insiders is named on the badge; null means checking", () => {
    const r = render(<VscodeExtensionBlock status={{ installed: true, editor: "vscode-insiders", ...urls }} />);
    expect(r.getByText(t("op.vscode.installedInsiders"))).toBeTruthy();
    cleanup();
    const r2 = render(<VscodeExtensionBlock status={null} />);
    expect(r2.getByText(t("op.st.checking"))).toBeTruthy();
  });
});
