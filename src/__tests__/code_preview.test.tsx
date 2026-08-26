// 이미지·PDF 미리보기 — 어떤 파일이 에디터 대신 이 창으로 가는가(순수), 그리고
// 받은 바이트가 실제로 화면에 물리는가(컴포넌트).
//
// jsdom 은 `URL.createObjectURL` 을 구현하지 않는다. 여기서는 그 호출이 났는지와
// **언마운트에서 되돌려 주는지**가 검사 대상이라, 계수기가 달린 스텁으로 갈아끼운다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { t } from "@/i18n";
import { previewKindFor } from "@/features/code/previewKind";

const fx: {
  asset: { mime: string; base64: string; bytes: number } | null;
  error: string | null;
  calls: string[];
} = { asset: null, error: null, calls: [] };

vi.mock("@/lib/bindings", () => ({
  commands: {
    codeAsset: (_p: number, relPath: string) => {
      fx.calls.push(relPath);
      return Promise.resolve(
        fx.error
          ? { status: "error" as const, error: fx.error }
          : { status: "ok" as const, data: fx.asset },
      );
    },
  },
}));

import { CodePreview } from "@/features/code/CodePreview";

/** 1×1 투명 PNG. 내용이 아니라 "바이트가 왕복한다" 만 확인하면 되는 크기다. */
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

let created: string[] = [];
let revoked: string[] = [];

beforeEach(() => {
  fx.asset = { mime: "image/png", base64: PNG_1PX, bytes: 68 };
  fx.error = null;
  fx.calls = [];
  created = [];
  revoked = [];
  let n = 0;
  URL.createObjectURL = vi.fn(() => {
    n += 1;
    const url = `blob:mock/${n}`;
    created.push(url);
    return url;
  });
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url);
  });
});
afterEach(cleanup);

describe("previewKindFor", () => {
  it("routes images and PDFs away from the editor", () => {
    expect(previewKindFor("docs/img/logo.png")).toBe("image");
    expect(previewKindFor("a/b/shot.JPG")).toBe("image"); // 확장자는 대소문자를 안 가린다
    expect(previewKindFor("spec.pdf")).toBe("pdf");
    expect(previewKindFor("assets/icon.webp")).toBe("image");
  });

  it("keeps editable text in the editor", () => {
    // svg 는 곧 코드다 — 여기서 가져가면 아이콘 하나를 못 고치게 된다.
    expect(previewKindFor("assets/icon.svg")).toBeNull();
    expect(previewKindFor("src/main.ts")).toBeNull();
    expect(previewKindFor("README")).toBeNull();
    expect(previewKindFor(".gitignore")).toBeNull();
    // 폴더 이름의 점에 속지 않는다.
    expect(previewKindFor("my.png.dir/notes")).toBeNull();
  });
});

describe("CodePreview", () => {
  const props = {
    projectId: 1,
    kind: "image" as const,
    epoch: 0,
    canOpenExternal: false,
    onOpenExternal: () => {},
  };

  it("draws the fetched bytes as an image named after the file", async () => {
    render(<CodePreview {...props} path="docs/img/logo.png" />);
    const img = await screen.findByAltText("logo.png");
    expect(img).toHaveAttribute("src", "blob:mock/1");
    expect(fx.calls).toEqual(["docs/img/logo.png"]);
  });

  it("toggles between fit and actual size", async () => {
    render(<CodePreview {...props} path="a/shot.png" />);
    const toggle = await screen.findByRole("button", { name: t("code.preview.actual") });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(
      screen.getByRole("button", { name: t("code.preview.fit") }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("re-reads the asset when the file changes on disk, and lets the old blob go", async () => {
    const { rerender } = render(<CodePreview {...props} path="a/shot.png" />);
    await screen.findByAltText("shot.png");
    rerender(<CodePreview {...props} path="a/shot.png" epoch={1} />);
    await waitFor(() => expect(fx.calls).toHaveLength(2));
    // 새 판을 만들면서 앞 판은 반드시 되돌려 준다 — 안 그러면 사본이 쌓인다.
    await waitFor(() => expect(revoked).toContain("blob:mock/1"));
  });

  it("revokes the blob on unmount", async () => {
    const { unmount } = render(<CodePreview {...props} path="a/shot.png" />);
    await screen.findByAltText("shot.png");
    unmount();
    expect(revoked).toEqual(created);
  });

  it("hands a PDF to the webview viewer", async () => {
    fx.asset = { mime: "application/pdf", base64: PNG_1PX, bytes: 120 };
    render(<CodePreview {...props} kind="pdf" path="docs/spec.pdf" />);
    const frame = await screen.findByTitle("spec.pdf");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame).toHaveAttribute("src", "blob:mock/1");
    // PDF 뷰어가 자기 배율을 갖는다 — 우리 배율 토글은 띄우지 않는다.
    expect(screen.queryByRole("button", { name: t("code.preview.actual") })).toBeNull();
  });

  it("explains a failed read instead of showing an empty frame", async () => {
    fx.error = "File is too large to preview (over 16MB)";
    render(<CodePreview {...props} path="a/huge.png" />);
    expect(await screen.findByText(t("code.preview.failed"))).toBeInTheDocument();
    // 백엔드 원문이 아니라 사전을 거친 한국어가 보여야 한다.
    expect(screen.getByText(t("err.previewTooLarge"))).toBeInTheDocument();
    expect(created).toHaveLength(0);
  });
});
