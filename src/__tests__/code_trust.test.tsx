import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { CodeStatusBar, type CodeStatusBarProps } from "@/features/code/CodeStatusBar";
import { codeTrustKey } from "@/features/code/codeTrust";
import { lspLabelFor } from "@/features/code/codePane/lspLabel";
import { t } from "@/i18n";

// 코드 실행 신뢰 (2026-10-08 검토) — 언어 서버는 파일을 여는 것만으로 저장소의
// 빌드 스크립트·툴체인 설정을 실행하므로, 이 기기에서 신뢰하기 전엔 띄우지 않는다.
// 백엔드(`lsp::trust`)가 문을 닫고, 화면은 그 사실을 말하고 여는 손잡이를 준다.

function bar(over: Partial<CodeStatusBarProps>) {
  const props: CodeStatusBarProps = {
    dirty: false,
    saving: false,
    autoSaveOn: false,
    cursor: { line: 1, col: 1 },
    selection: null,
    problemTotals: { error: 0, warning: 0, info: 0, hint: 0 },
    lspState: null,
    lspLabel: null,
    lspDetail: null,
    onTrustLsp: () => {},
    eolLabel: "LF",
    langLabel: "Rust",
    bytesLabel: "1 KB",
    wordWrap: false,
    aiChip: null,
    onGoToLine: () => {},
    onToggleWordWrap: () => {},
    onOpenProblems: () => {},
    ...over,
  };
  return render(<CodeStatusBar {...props} />);
}

describe("code trust", () => {
  afterEach(cleanup);

  it("labels the untrusted state instead of hiding it", () => {
    expect(lspLabelFor("untrusted")).toBe(t("code.lsp.untrusted"));
  });

  it("turns the status chip into a trust button only while untrusted", () => {
    const onTrustLsp = vi.fn();
    bar({ lspState: "untrusted", lspLabel: lspLabelFor("untrusted"), onTrustLsp });
    const button = screen.getByRole("button", { name: new RegExp(t("code.lsp.trustAction")) });
    expect(button.getAttribute("title")).toBe(t("code.lsp.trustHint"));
    fireEvent.click(button);
    expect(onTrustLsp).toHaveBeenCalledTimes(1);
  });

  it("keeps other states as a plain chip", () => {
    bar({ lspState: "ready", lspLabel: lspLabelFor("ready") });
    expect(screen.queryByRole("button", { name: new RegExp(t("code.lsp.trustAction")) })).toBeNull();
    expect(screen.getByText(t("code.lsp.ready"))).toBeTruthy();
  });

  it("uses the same settings key shape as the backend", () => {
    const rust = readFileSync(resolve(__dirname, "../../src-tauri/src/lsp/trust.rs"), "utf8");
    expect(rust).toContain('pub const KEY_PREFIX: &str = "code_trust.";');
    expect(codeTrustKey(7)).toBe("code_trust.7");
  });
});
