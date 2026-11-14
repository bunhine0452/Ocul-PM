import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import MarkdownImpl, { NOWRAP_CODE_MAX } from "@/components/MarkdownImpl";

// JN-02 (11-15) — one typesetting for the journal body. Tailwind Typography (`prose prose-sm …`) on the
// markdown wrapper won at 14px/24px, so journal.css's 13px/1.7 never reached the text, and the first/last
// child resets pointed at the wrapper (a 39px gap above the first heading). The wrapper now carries no
// prose classes; `.jd-prose` alone sets the type. Short inline code (≤ 24 chars) does not break at a hyphen.

const css = readFileSync(join(__dirname, "..", "features", "oculpm", "journal.css"), "utf8");

afterEach(() => cleanup());

describe("journal prose — one typesetting", () => {
  it("the markdown wrapper has no Tailwind prose classes", async () => {
    const { container } = render(<MarkdownImpl>{"## Cause\nsome text\n"}</MarkdownImpl>);
    await waitFor(() => expect(container.querySelector("h2")).not.toBeNull());
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).not.toMatch(/\bprose\b|prose-/);
  });

  it("inline code up to 24 characters gets `nowrap`; longer code may wrap", async () => {
    const short = "x".repeat(NOWRAP_CODE_MAX);
    const long = "y".repeat(NOWRAP_CODE_MAX + 1);
    const { container } = render(<MarkdownImpl>{`run \`kebab-case-fn\` then \`${short}\` and \`${long}\``}</MarkdownImpl>);
    await waitFor(() => expect(container.querySelectorAll("code")).toHaveLength(3));
    const [a, b, c] = Array.from(container.querySelectorAll("code"));
    expect(NOWRAP_CODE_MAX).toBe(24);
    expect(a.classList.contains("nowrap")).toBe(true);
    expect(b.classList.contains("nowrap")).toBe(true);
    expect(c.classList.contains("nowrap")).toBe(false);
  });

  it("journal.css owns the reading width, the reset and the broken-code background", () => {
    expect(css).toMatch(/\.jd-prose\s*\{[^}]*max-width:\s*var\(--read-narrow\)/);
    expect(css).toMatch(/\.jd-prose > \* > :first-child\s*\{\s*margin-top:\s*0/);
    expect(css).toMatch(/box-decoration-break:\s*clone/);
    expect(css).toMatch(/\.jd-prose :not\(pre\) > code\.nowrap\s*\{\s*white-space:\s*nowrap/);
    expect(css).toMatch(/\.jd-prose strong\s*\{\s*font-weight:\s*var\(--fw-label\)/);
  });
});
