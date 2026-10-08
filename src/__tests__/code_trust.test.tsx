import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";

import { CodeStatusBar, type CodeStatusBarProps } from "@/features/code/CodeStatusBar";
import { codeTrustKey } from "@/features/code/codeTrust";
import { lspLabelFor } from "@/features/code/codePane/lspLabel";
import { t } from "@/i18n";
import { lspLanguageIdFor } from "@/features/code/lspBridge";
import { useLsp } from "@/features/code/useLsp";

// useLsp 가 부르는 언어 서버 창구. jsdom 에선 Tauri 이벤트가 오지 않는다 — 막 마운트된
// 편집기가 「신뢰 전」 이벤트를 놓친 상황(v3.10.0 첫 배포의 결함)이 그대로 재현된다.
const lsp = vi.hoisted(() => ({
  open: vi.fn(),
  close: vi.fn(async () => undefined),
  change: vi.fn(async () => undefined),
  status: vi.fn(),
  onDiagnostics: vi.fn(async () => () => {}),
  onServerState: vi.fn(async (_cb: (p: unknown) => void) => () => {}),
}));
vi.mock("@/api/lsp", () => ({ lspApi: lsp }));

// 코드 실행 신뢰 (2026-10-08 검토) — 언어 서버는 파일을 여는 것만으로 저장소의
// 빌드 스크립트·툴체인 설정을 실행하므로, 이 기기에서 신뢰하기 전엔 띄우지 않는다.
// 백엔드(`crate::trust`)가 문을 닫고, 화면은 그 사실을 말하고 여는 손잡이를 준다.

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
    const rust = readFileSync(resolve(__dirname, "../../src-tauri/src/trust.rs"), "utf8");
    expect(rust).toContain('pub const KEY_PREFIX: &str = "code_trust.";');
    expect(codeTrustKey(7)).toBe("code_trust.7");
  });
});

describe("code trust — the chip shows even when the state event is missed (v3.10.0 regression)", () => {
  beforeEach(() => {
    lsp.open.mockReset();
    lsp.status.mockReset();
    lsp.onServerState.mockReset();
    lsp.onServerState.mockImplementation(async () => () => {});
  });
  afterEach(cleanup);

  const server = (state: string) => ({ language_id: "rust", command: "rust-analyzer", state, root: null, detail: null });

  it("asks for the state when a language file did not attach, and shows untrusted", async () => {
    lsp.open.mockResolvedValue(false);
    lsp.status.mockResolvedValue([server("untrusted")]);
    const { result } = renderHook(() => useLsp(1, "src/main.rs", "fn main() {}", 1));
    await waitFor(() => expect(result.current.status.state).toBe("untrusted"));
    expect(lsp.status).toHaveBeenCalledWith(1);
  });

  it("does not ask for files without a language server", async () => {
    lsp.open.mockResolvedValue(false);
    renderHook(() => useLsp(1, "README.md", "# hi", 1));
    await waitFor(() => expect(lsp.open).toHaveBeenCalled());
    expect(lsp.status).not.toHaveBeenCalled();
  });

  // review-2026-10-09 — 예전엔 붙으면 묻지 않았다. 그러면 다른 파일을 열 때 지나간
  // 「인덱싱 중」·「준비됨」 을 이 편집기가 못 본다.
  it("asks when attached too, and shows the server's current state", async () => {
    lsp.open.mockResolvedValue(true);
    lsp.status.mockResolvedValue([server("indexing")]);
    const { result } = renderHook(() => useLsp(1, "src/main.rs", "fn main() {}", 1));
    await waitFor(() => expect(result.current.status.state).toBe("indexing"));
  });

  it("ignores state events from another language's server", async () => {
    let push: (p: unknown) => void = () => {};
    lsp.onServerState.mockImplementation(async (cb) => {
      push = cb;
      return () => {};
    });
    lsp.open.mockResolvedValue(true);
    lsp.status.mockResolvedValue([server("ready")]);
    const { result } = renderHook(() => useLsp(1, "src/main.rs", "fn main() {}", 1));
    await waitFor(() => expect(result.current.status.state).toBe("ready"));
    act(() => push({ project_id: 1, language_id: "python", state: "failed", detail: "pyright exited" }));
    expect(result.current.status.state).toBe("ready");
  });

  it("drops the status answer when a newer state event arrived meanwhile", async () => {
    let push: (p: unknown) => void = () => {};
    lsp.onServerState.mockImplementation(async (cb) => {
      push = cb;
      return () => {};
    });
    let answer: (v: unknown) => void = () => {};
    lsp.open.mockResolvedValue(true);
    lsp.status.mockImplementation(() => new Promise((r) => (answer = r)));
    const { result } = renderHook(() => useLsp(1, "src/main.rs", "fn main() {}", 1));
    await waitFor(() => expect(lsp.status).toHaveBeenCalled());
    await waitFor(() => expect(lsp.onServerState).toHaveBeenCalled());
    act(() => push({ project_id: 1, language_id: "rust", state: "ready", detail: null }));
    await act(async () => answer([server("indexing")])); // 이벤트보다 먼저 만든 답
    expect(result.current.status.state).toBe("ready");
  });

  it("maps paths to the same language ids as the backend registry", () => {
    expect(lspLanguageIdFor("a/b.rs")).toBe("rust");
    expect(lspLanguageIdFor("x.tsx")).toBe("typescript");
    expect(lspLanguageIdFor("x.mjs")).toBe("typescript");
    expect(lspLanguageIdFor("x.pyi")).toBe("python");
    expect(lspLanguageIdFor("main.go")).toBe("go");
    expect(lspLanguageIdFor("README.md")).toBeNull();
    expect(lspLanguageIdFor("Makefile")).toBeNull();
  });
});
