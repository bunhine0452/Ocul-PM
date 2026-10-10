import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// MarkdownImpl depends on the theme hook; irrelevant here, so pin it.
vi.mock("@/lib/theme", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));

import { Markdown } from "@/components/Markdown";
import { MarkdownBlock } from "@/features/chat/conversation/Markdown";

// The webview CSP (img-src 'self' data: blob:) blocks remote images. They render
// as a placeholder link instead of a broken icon; local (data:) stays an <img>.

describe("Markdown remote images", () => {
  it("https image becomes an alt-labelled link, not an img", async () => {
    const { container } = render(<Markdown>{"![Architecture](https://example.com/a.png)"}</Markdown>);
    const label = await screen.findByText("Architecture");
    expect(label.closest("a")?.getAttribute("href")).toBe("https://example.com/a.png");
    expect(container.querySelector("img")).toBeNull();
  });

  it("falls back to the hostname without alt", async () => {
    const { container } = render(<Markdown>{"![](https://cdn.example.org/x/y.png)"}</Markdown>);
    await screen.findByText("cdn.example.org");
    expect(container.querySelector("img")).toBeNull();
  });

  it("protocol-relative src is remote and opens over https", async () => {
    render(<Markdown>{"![](//img.example.net/p.png)"}</Markdown>);
    const label = await screen.findByText("img.example.net");
    expect(label.closest("a")?.getAttribute("href")).toBe("https://img.example.net/p.png");
  });

  it("data: image stays an img", async () => {
    const { container } = render(<Markdown>{"![dot](data:image/png;base64,iVBORw0KGgo=)"}</Markdown>);
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    expect(container.querySelector("a")).toBeNull();
  });

  it("the agent-reply renderer takes the same path", async () => {
    const { container } = render(<MarkdownBlock text="![](https://a.example.com/z.png)" />);
    await screen.findByText("a.example.com");
    expect(container.querySelector("img")).toBeNull();
  });
});
