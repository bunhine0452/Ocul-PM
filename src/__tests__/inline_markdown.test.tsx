import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { parseInlineMarkdown, stripInlineMarkdown } from "@/lib/inlineMarkdown";
import { InlineMarkdown } from "@/components/InlineMarkdown";

// 플래너 항목 제목은 `.oculpm/planner/*.md` 에서 온 **마크다운**인데 화면에는
// 원문 그대로 나와 `**` 가 노출됐다 (사용자 보고 2026-08-23).
//
// 지키는 성질 셋:
// ① `**굵게**` / `` `코드` `` 는 기호 없이 렌더된다
// ② snake_case 식별자는 절대 기울임으로 잡히지 않는다 — 플래너 제목엔
//    `plan_apply_edit` 같은 이름이 널려 있어 오탐 비용이 강조 이득보다 크다
// ③ 짝이 안 맞는 기호는 **원문 그대로** 남는다 (내용을 삼키지 않는다)

describe("parseInlineMarkdown", () => {
  it("renders bold without leaking the asterisks", () => {
    expect(parseInlineMarkdown("필터는 **전량 걸음** 유지")).toEqual([
      { kind: "text", value: "필터는 " },
      { kind: "strong", children: [{ kind: "text", value: "전량 걸음" }] },
      { kind: "text", value: " 유지" },
    ]);
  });

  it("keeps code spans literal", () => {
    expect(parseInlineMarkdown("렌더러는 `flattenToDirMap` 으로")).toEqual([
      { kind: "text", value: "렌더러는 " },
      { kind: "code", value: "flattenToDirMap" },
      { kind: "text", value: " 으로" },
    ]);
  });

  it("never treats snake_case as emphasis", () => {
    const src = "plan_apply_edit 로 in_progress 를 넘긴다";
    expect(parseInlineMarkdown(src)).toEqual([{ kind: "text", value: src }]);
  });

  it("leaves unpaired or space-flanked markers as plain text", () => {
    expect(parseInlineMarkdown("필터는 ** 전량")).toEqual([{ kind: "text", value: "필터는 ** 전량" }]);
    expect(parseInlineMarkdown("2 * 3 * 4")).toEqual([{ kind: "text", value: "2 * 3 * 4" }]);
  });

  it("parses strikethrough and nested emphasis inside bold", () => {
    expect(parseInlineMarkdown("~~취소~~")).toEqual([
      { kind: "del", children: [{ kind: "text", value: "취소" }] },
    ]);
    expect(parseInlineMarkdown("**굵고 *기운* 것**")).toEqual([
      {
        kind: "strong",
        children: [
          { kind: "text", value: "굵고 " },
          { kind: "em", children: [{ kind: "text", value: "기운" }] },
          { kind: "text", value: " 것" },
        ],
      },
    ]);
  });

  it("promotes only http(s)/mailto links — never javascript:", () => {
    expect(parseInlineMarkdown("[문서](https://oculpm.com)")).toEqual([
      { kind: "link", href: "https://oculpm.com", children: [{ kind: "text", value: "문서" }] },
    ]);
    const evil = "[x](javascript:alert(1))";
    expect(parseInlineMarkdown(evil)).toEqual([{ kind: "text", value: evil }]);
  });

  it("strips markers for plain-text surfaces (rail titles, tooltips)", () => {
    expect(stripInlineMarkdown("**계획** 하나 `code`")).toBe("계획 하나 code");
  });
});

describe("<InlineMarkdown>", () => {
  it("emits real <strong>/<code> elements instead of literal markers", () => {
    const { container } = render(<InlineMarkdown text="필터는 **전량** `flattenToDirMap`" />);
    expect(container.querySelector("strong")?.textContent).toBe("전량");
    expect(container.querySelector("code")?.textContent).toBe("flattenToDirMap");
    expect(container.textContent).not.toContain("**");
  });

  it("does not emit an anchor when it sits inside a button (linkable=false)", () => {
    render(
      <button type="button">
        <InlineMarkdown text="[문서](https://oculpm.com)" linkable={false} />
      </button>,
    );
    expect(screen.getByRole("button").querySelector("a")).toBeNull();
    expect(screen.getByRole("button").textContent).toBe("문서");
  });
});
