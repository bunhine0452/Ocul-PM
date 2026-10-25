/**
 * 리치 마크다운 코덱 — 고치지 않은 블록은 한 글자도 바꾸지 않는다 (2026-10-25).
 *
 * 직렬화기는 표 칸을 맞추고 빈 줄·목록 기호를 제 식으로 쓴다. 문서를 통째로 직렬화하던
 * 첫 시도는 저장소의 .md 425개 중 하나만 원문과 같았다. 블록마다 원문을 붙들어
 * 고친 블록만 새로 쓰게 한 뒤로 전부 같다 — 아래 첫 테스트가 그 사실을 지킨다.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { Editor } from "@tiptap/core";

import {
  parseWithSource,
  richExtensions,
  roundTrip,
  serializeWithSource,
} from "@/features/code/richMarkdown/codec";
import { frontmatterKeys, joinFrontmatter, splitFrontmatter } from "@/features/code/richMarkdown/frontmatter";
import { filterSlashItems, SLASH_ITEMS } from "@/features/code/richMarkdown/slashCommands";

/** 실제 편집기를 거친 왕복 — 편집기가 기본 속성을 채워도 원문 대조가 맞아야 한다. */
function throughEditor(body: string, edit?: (e: Editor) => void): string {
  const { doc, source } = parseWithSource(body);
  const editor = new Editor({ extensions: richExtensions(), content: doc });
  edit?.(editor);
  const out = serializeWithSource(editor.getJSON(), source);
  editor.destroy();
  return out;
}

describe("every markdown file in this repository", () => {
  const files = execSync("git ls-files '*.md'").toString().trim().split("\n");
  const read = (file: string): string | null => {
    try {
      return readFileSync(file, "utf8");
    } catch {
      return null; // 작업 트리에서 지워진 파일
    }
  };

  // 편집기를 파일마다 띄우면 CI 러너에서 15초를 넘는다(2026-10-25) — 전수는 코덱으로.
  it("opens and saves back byte-for-byte when nothing was edited", () => {
    expect(files.length).toBeGreaterThan(100);
    const changed = files.filter((file) => {
      const text = read(file);
      if (text == null) return false;
      const { frontmatter, body } = splitFrontmatter(text);
      return joinFrontmatter(frontmatter, roundTrip(body)) !== text;
    });
    expect(changed).toEqual([]);
  }, 60_000);

  // 편집기를 거쳐도 같은가 — 편집기가 기본 속성을 채워 넣어도 원문 대조가 맞아야 한다.
  // 블록이 많은 큰 파일 몇 개로 본다.
  it("stays byte-for-byte through a real editor on the largest files", () => {
    const largest = files
      .map((file) => ({ file, text: read(file) ?? "" }))
      .sort((a, b) => b.text.length - a.text.length)
      .slice(0, 8);
    const changed = largest.filter(({ text }) => {
      const { frontmatter, body } = splitFrontmatter(text);
      return joinFrontmatter(frontmatter, throughEditor(body)) !== text;
    });
    expect(changed.map((c) => c.file)).toEqual([]);
  }, 60_000);
});

describe("editing changes only the edited block", () => {
  const body = [
    "# Title",
    "",
    "| a | b |",
    "|---|---|",
    "| 1 | 2 |",
    "",
    "* star bullet",
    "* another",
    "",
    "Second paragraph.",
    "",
  ].join("\n");

  it("keeps the table and the star bullets exactly when the last paragraph is edited", () => {
    const out = throughEditor(body, (e) => {
      e.commands.setTextSelection(e.state.doc.content.size - 1);
      e.commands.insertContent(" More");
    });
    expect(out).toBe(body.replace("Second paragraph.", "Second paragraph. More"));
  });

  it("appends a new block after a paragraph with a blank line, not glued to it", () => {
    const out = throughEditor("Only line\n", (e) => {
      e.commands.setTextSelection(e.state.doc.content.size);
      e.commands.insertContentAt(e.state.doc.content.size, { type: "paragraph", content: [{ type: "text", text: "Next" }] });
    });
    expect(out).toBe("Only line\n\nNext\n");
  });

  it("drops a deleted block and keeps its neighbours", () => {
    const out = throughEditor("A\n\nB\n\nC\n", (e) => {
      const json = e.getJSON();
      e.commands.setContent({ ...json, content: [json.content![0], json.content![2]] });
    });
    expect(out).toBe("A\n\nC\n");
  });
});

describe("managed blocks and raw html", () => {
  const managed = [
    "## Log",
    "",
    "<!-- oculpm:discussion-log begin v1 -->",
    "| time | who | note |",
    "|---|---|---|",
    "| 2026-10-25 | me | hi |",
    "<!-- oculpm:discussion-log end -->",
    "",
    "## Next",
    "",
  ].join("\n");

  it("carries a begin…end block as one untouchable raw block", () => {
    const { doc } = parseWithSource(managed);
    const raw = doc.content!.filter((n) => n.type === "rawBlock");
    expect(raw).toHaveLength(1);
    expect(String(raw[0].attrs!.source)).toContain("| 2026-10-25 | me | hi |");
    expect(roundTrip(managed)).toBe(managed);
  });

  it("keeps the managed block verbatim when a heading next to it is edited", () => {
    const out = throughEditor(managed, (e) => {
      e.commands.setTextSelection(4);
      e.commands.insertContent("!");
    });
    expect(out).toContain("<!-- oculpm:discussion-log begin v1 -->\n| time | who | note |\n|---|---|---|");
  });
});

describe("front matter", () => {
  const text = "---\ntitle: x\nstatus: open\n---\n\n# Body\n";
  it("splits and joins without touching a byte", () => {
    const { frontmatter, body } = splitFrontmatter(text);
    expect(frontmatter).toBe("---\ntitle: x\nstatus: open\n---\n");
    expect(joinFrontmatter(frontmatter, body)).toBe(text);
    expect(frontmatterKeys(frontmatter)).toEqual(["title", "status"]);
  });
  it("leaves documents without front matter alone", () => {
    expect(splitFrontmatter("# x\n")).toEqual({ frontmatter: "", body: "# x\n" });
  });
});

describe("slash menu", () => {
  const label = (key: string) => key;
  it("lists everything for an empty query and finds items by alias", () => {
    expect(filterSlashItems("", label)).toHaveLength(SLASH_ITEMS.length);
    expect(filterSlashItems("todo", label).map((i) => i.id)).toEqual(["task"]);
    expect(filterSlashItems("h2", label).map((i) => i.id)).toEqual(["h2"]);
  });
});
