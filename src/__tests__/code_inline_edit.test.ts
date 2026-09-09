// ⌘K 인라인 편집의 순수 모델 (Phase 5 `{#agent-cmdk}` · `{#agent-hunk}`).
//
// 여기서 틀리면 **사용자 코드가 조용히 망가진다** — 펜스가 박히거나, 빈 줄이
// 하나 늘거나, 조각을 껐는데 원문이 안 돌아온다. 전부 화면으로는 미묘하고
// diff 로는 시끄러운 종류라 편집기를 띄우지 않고 규칙만 본다.
import { describe, expect, it } from "vitest";

import {
  buildMessages,
  contextAfter,
  contextBefore,
  extractCode,
  matchTrailingNewline,
} from "@/features/code/inlineEdit/prompt";
import { compose, joinLines, prepare, toHunks } from "@/features/code/inlineEdit/hunks";
import { addEdit, buildDraft, draftSlug } from "@/features/code/inlineEdit/attribution";
import { diffLines } from "@/features/chat/lineDiff";

describe("buildMessages", () => {
  const req = {
    path: "src/a.ts",
    languageId: "typescript",
    selection: "const x = 1;",
    before: "// head",
    after: "// tail",
    instruction: "let 으로 바꿔",
  };

  it("규칙은 system, 자료는 user — 섞으면 규칙이 자료에 밀린다", () => {
    const [sys, user] = buildMessages(req);
    expect(sys.role).toBe("system");
    expect(sys.content).toContain("SELECTION only");
    expect(user.role).toBe("user");
    expect(user.content).toContain("const x = 1;");
    expect(user.content).toContain("let 으로 바꿔");
  });

  it("경로와 언어를 알려 준다", () => {
    const [, user] = buildMessages(req);
    expect(user.content).toContain("File: src/a.ts");
    expect(user.content).toContain("Language: typescript");
  });

  it("plaintext 는 언어 줄을 안 쓴다 — 모를 때 아는 척하지 않는다", () => {
    const [, user] = buildMessages({ ...req, languageId: "plaintext" });
    expect(user.content).not.toContain("Language:");
  });
});

describe("extractCode — 모델은 시켜도 펜스를 붙인다", () => {
  it("전체를 감싼 펜스를 걷는다 (언어 태그 포함)", () => {
    expect(extractCode("```ts\nconst x = 1;\n```")).toBe("const x = 1;");
    expect(extractCode("```\nconst x = 1;\n```")).toBe("const x = 1;");
  });

  it("펜스 앞뒤의 빈 줄도 함께 걷는다", () => {
    expect(extractCode("\n\n```ts\nconst x = 1;\n```\n\n")).toBe("const x = 1;");
  });

  it("펜스가 여러 개면 건드리지 않는다 — 마크다운 본문을 지우는 게 더 나쁘다", () => {
    const md = "설명\n\n```ts\na\n```\n\n또\n\n```ts\nb\n```";
    expect(extractCode(md)).toBe(md);
  });

  it("펜스가 없으면 앞뒤 빈 줄만 걷는다", () => {
    expect(extractCode("\nconst x = 1;\n\n")).toBe("const x = 1;");
  });

  it("들여쓰기는 **안 건드린다** — 첫 줄의 공백이 곧 자리다", () => {
    expect(extractCode("```ts\n    return 1;\n```")).toBe("    return 1;");
    expect(extractCode("    return 1;")).toBe("    return 1;");
  });

  it("CRLF 는 LF 로 눕힌다", () => {
    expect(extractCode("a\r\nb")).toBe("a\nb");
  });
});

describe("matchTrailingNewline", () => {
  it("원문이 개행으로 끝나면 제안도 그렇게", () => {
    expect(matchTrailingNewline("a\n", "b")).toBe("b\n");
    expect(matchTrailingNewline("a\n", "b\n\n\n")).toBe("b\n");
  });
  it("원문이 안 끝나면 제안도 안 끝난다 — 안 그러면 빈 줄이 하나 는다", () => {
    expect(matchTrailingNewline("a", "b\n")).toBe("b");
    expect(matchTrailingNewline("a", "b")).toBe("b");
  });
});

describe("문맥 자르기", () => {
  const doc = ["1", "2", "3", "4", "5"].join("\n");
  it("앞은 **끝에서** 센다 — 선택 직전이 중요하다", () => {
    expect(contextBefore(doc, 2)).toBe("4\n5");
  });
  it("뒤는 앞에서 센다", () => {
    expect(contextAfter(doc, 2)).toBe("1\n2");
  });
});

describe("toHunks", () => {
  it("ctx 가 끼면 조각이 끊긴다", () => {
    const diff = diffLines(["a", "b", "c", "d"].join("\n"), ["a", "B", "c", "D"].join("\n"));
    const hunks = toHunks(diff);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatchObject({ index: 0, removed: ["b"], added: ["B"] });
    expect(hunks[1]).toMatchObject({ index: 1, removed: ["d"], added: ["D"] });
  });

  it("변경이 없으면 조각도 없다", () => {
    expect(toHunks(diffLines("a\nb", "a\nb"))).toEqual([]);
  });

  it("순수 삭제·순수 추가도 조각이다", () => {
    expect(toHunks(diffLines("a\nb\nc", "a\nc"))).toMatchObject([{ removed: ["b"], added: [] }]);
    expect(toHunks(diffLines("a\nc", "a\nb\nc"))).toMatchObject([{ removed: [], added: ["b"] }]);
  });
});

describe("compose — 조각을 켠 대로 다시 만든다", () => {
  const original = ["a", "b", "c", "d"].join("\n");
  const proposal = ["a", "B", "c", "D"].join("\n");
  const diff = diffLines(original, proposal);

  it("전부 켜면 제안 그대로", () => {
    expect(compose(diff, [true, true]).lines.join("\n")).toBe(proposal);
  });

  it("전부 끄면 **원문 그대로** — 되돌리기가 정확해야 한다", () => {
    expect(compose(diff, [false, false]).lines.join("\n")).toBe(original);
  });

  it("섞으면 그 조각만 바뀐다", () => {
    expect(compose(diff, [true, false]).lines.join("\n")).toBe(["a", "B", "c", "d"].join("\n"));
    expect(compose(diff, [false, true]).lines.join("\n")).toBe(["a", "b", "c", "D"].join("\n"));
  });

  it("받은 조각의 줄 범위를 함께 준다 — 화면이 좌표를 다시 세면 어긋난다", () => {
    const { spans } = compose(diff, [true, true]);
    expect(spans[0]).toEqual({ start: 1, end: 1 });
    expect(spans[1]).toEqual({ start: 3, end: 3 });
  });

  it("끈 조각은 그릴 것이 없다 (span 이 null)", () => {
    expect(compose(diff, [false, true]).spans[0]).toBeNull();
  });

  it("순수 삭제를 받으면 그 줄이 사라지고 span 은 null 이다", () => {
    const d = diffLines("a\nb\nc", "a\nc");
    expect(compose(d, [true]).lines).toEqual(["a", "c"]);
    expect(compose(d, [true]).spans[0]).toBeNull();
    expect(compose(d, [false]).lines).toEqual(["a", "b", "c"]);
  });

  it("여러 줄 조각의 span 은 처음부터 끝까지 덮는다", () => {
    const d = diffLines("a\nx\nz", "a\np\nq\nr\nz");
    expect(compose(d, [true]).spans[0]).toEqual({ start: 1, end: 3 });
  });
});

describe("prepare · joinLines", () => {
  it("처음에는 전부 받은 상태다 — ⌘K 를 누른 것이 곧 고쳐 달라는 뜻이다", () => {
    const { hunks, accepted } = prepare("a\nb", "a\nB");
    expect(hunks).toHaveLength(1);
    expect(accepted).toEqual([true]);
  });

  it("원문의 끝 개행 규약을 지킨다", () => {
    expect(joinLines(["a", "b"], "x\n")).toBe("a\nb\n");
    expect(joinLines(["a", "b"], "x")).toBe("a\nb");
  });

  it("바뀐 것이 없으면 조각이 없다 — 화면이 '그대로다' 라고 말할 근거", () => {
    expect(prepare("a\nb", "a\nb").hunks).toEqual([]);
  });
});

describe("귀속 — 누가 고쳤는지 남는다", () => {
  const at = new Date(2026, 8, 9, 14, 5);

  it("누적은 곳 수와 줄 수를 함께 센다", () => {
    const one = addEdit(undefined, { added: 3, removed: 1 }, "anthropic", "claude-opus-5");
    const two = addEdit(one, { added: 2, removed: 0 }, "anthropic", "claude-opus-5");
    expect(two).toMatchObject({ edits: 2, added: 5, removed: 1, model: "claude-opus-5" });
  });

  it("마지막에 답한 모델이 남는다 — 중간에 폴백이 답했으면 그쪽이다", () => {
    const one = addEdit(undefined, { added: 1, removed: 0 }, "anthropic", "a");
    expect(addEdit(one, { added: 1, removed: 0 }, "openai", "b")).toMatchObject({
      provider: "openai",
      model: "b",
    });
  });

  it("슬러그는 ASCII kebab · 40자 이내 (일지 규격)", () => {
    const slug = draftSlug("src/features/code/CodePane.tsx", at);
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.startsWith("ai-edit-")).toBe(true);
  });

  it("한글 파일명도 슬러그가 된다 — 확장자는 살아남는다", () => {
    expect(draftSlug("문서/한글.md", at)).toBe("ai-edit-md-1405");
  });

  it("ASCII 가 하나도 안 남으면 `file` 로 떨어진다 — 빈 슬러그는 거절당한다", () => {
    expect(draftSlug("문서/한글", at)).toBe("ai-edit-file-1405");
  });

  it("초안에 **모델**이 실린다 — 이것이 귀속의 알맹이다", () => {
    const tally = addEdit(undefined, { added: 4, removed: 2 }, "anthropic", "claude-opus-5");
    const draft = buildDraft("src/a.ts", tally, at, "ko");
    expect(draft.agent).toMatchObject({ id: "anthropic", version: "claude-opus-5" });
    expect(draft.files_touched).toMatchObject([{ path: "src/a.ts", op: "update" }]);
  });

  it("사람의 확인을 사칭하지 않는다 (verified_by_user=false)", () => {
    const tally = addEdit(undefined, { added: 1, removed: 0 }, "anthropic", "m");
    expect(buildDraft("src/a.ts", tally, at, "ko").verified_by_user).toBe(false);
  });

  it("앱이 아는 것만 적고 나머지는 빈칸으로 둔다 — 지어내면 기록이 거짓이 된다", () => {
    const tally = addEdit(undefined, { added: 4, removed: 2 }, "anthropic", "m");
    const body = buildDraft("src/a.ts", tally, at, "ko").body_markdown;
    expect(body).toContain("+4 −2");
    expect(body).toContain("## 검증");
    expect(body).toContain("적어 주세요");
  });

  it("작성 언어를 따른다 — 일지는 디스크 산출물이지 UI 카피가 아니다", () => {
    const tally = addEdit(undefined, { added: 1, removed: 0 }, "anthropic", "m");
    expect(buildDraft("src/a.ts", tally, at, "en").body_markdown).toContain("## Summary");
    expect(buildDraft("src/a.ts", tally, at, "en").title).toContain("Edits made with AI");
  });
});
