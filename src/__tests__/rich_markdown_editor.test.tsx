/**
 * 리치 마크다운 편집기 화면 (2026-10-25) — 머리 정보 칩 · 원문 블록 · 열기만 해서는 안 바뀐다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/bindings", () => ({ commands: {}, events: {} }));

import { RichMarkdownEditor } from "@/features/code/richMarkdown/RichMarkdownEditor";
import { t } from "@/i18n";

afterEach(cleanup);

const DOC = [
  "---",
  "title: Plan",
  "status: open",
  "---",
  "",
  "# Heading",
  "",
  "- [ ] first task",
  "- [x] done task",
  "",
  "<!-- oculpm:discussion-log begin v1 -->",
  "| time | who |",
  "|---|---|",
  "<!-- oculpm:discussion-log end -->",
  "",
].join("\n");

describe("RichMarkdownEditor", () => {
  it("renders the document without reporting a change on open", () => {
    const onChange = vi.fn();
    const { container } = render(<RichMarkdownEditor initialText={DOC} onChange={onChange} />);
    expect(container.querySelector(".rich-md-doc h1")?.textContent).toBe("Heading");
    expect(container.querySelectorAll('ul[data-type="taskList"] li')).toHaveLength(2);
    // 관리 블록은 고칠 수 없는 원문 블록 하나다.
    const raw = container.querySelectorAll(".rich-raw");
    expect(raw).toHaveLength(1);
    expect(raw[0].textContent).toContain("| time | who |");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("folds the front matter into a chip that opens read-only", () => {
    render(<RichMarkdownEditor initialText={DOC} onChange={() => {}} />);
    const chip = screen.getByRole("button", { name: new RegExp(t("rich.frontmatter")) });
    expect(chip.textContent).toContain("title, status");
    expect(document.querySelector(".rich-md-fm-raw")).toBeNull();
    fireEvent.click(chip);
    expect(document.querySelector(".rich-md-fm-raw")?.textContent).toContain("status: open");
  });
});
