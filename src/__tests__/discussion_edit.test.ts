/**
 * 문제 해결 편집기의 순수 마크다운 수술 계약.
 *
 * 여기 한글은 UI 카피가 아니라 **검사 재료**다 — 파서(`parse.rs::section_of`)가
 * 인식하는 섹션 제목이 한국어이고, 그 인식을 프런트가 같은 규칙으로 따라가는지가
 * 이 스위트의 요지다.
 */
import { describe, expect, it } from "vitest";

import {
  appendLogRowOp,
  insertInSectionOp,
  linePrefixOp,
  linkOp,
  localIsoWithOffset,
  LOG_BEGIN,
  LOG_END,
  nextOptionId,
  nextStepId,
  sectionOf,
  unknownSections,
  wrapOp,
  type EditOp,
} from "@/features/discussion/mdEdit";

/** 에디터가 트랜잭션으로 하는 일을 문자열로 재현한다. */
function apply(doc: string, op: EditOp): string {
  return doc.slice(0, op.from) + op.insert + doc.slice(op.to);
}

const DOC = [
  "## 문제 정의",
  "",
  "캐시 경로를 어디에 둘지.",
  "",
  "## 후보 해결 방안",
  "",
  "### 방안 A — 절대경로 {#opt-a}",
  "",
  "- 장점: CWD 무관",
  "",
  "## 토의 / 메모",
  "",
  LOG_BEGIN,
  LOG_END,
  "",
  "## 다음 단계",
  "",
  "- [ ] 절대경로 적용 {#next-1}",
  "",
].join("\n");

describe("sectionOf — 파서와 같은 키워드 표", () => {
  it("한국어 제목 여섯 종을 인식한다", () => {
    expect(sectionOf("문제 정의")).toBe("problem");
    expect(sectionOf("배경 / 조사 자료")).toBe("background");
    expect(sectionOf("후보 해결 방안")).toBe("options");
    expect(sectionOf("토의 / 메모")).toBe("log");
    expect(sectionOf("결론")).toBe("conclusion");
    expect(sectionOf("다음 단계")).toBe("next");
  });

  it("영어 제목도 같은 종으로 접힌다 (파서가 양쪽을 받는다)", () => {
    expect(sectionOf("Problem")).toBe("problem");
    expect(sectionOf("Background / research")).toBe("background");
    expect(sectionOf("Options")).toBe("options");
    expect(sectionOf("Discussion / notes")).toBe("log");
    expect(sectionOf("Conclusion")).toBe("conclusion");
    expect(sectionOf("Next steps")).toBe("next");
  });

  it("그 밖의 제목은 unknown", () => {
    expect(sectionOf("리스크")).toBe("unknown");
    expect(sectionOf("Timeline")).toBe("unknown");
  });
});

describe("unknownSections — 저장 후 사라질 본문을 미리 알린다", () => {
  it("인식하지 못하는 `## ` 제목만 모은다", () => {
    const md = "## 문제 정의\nx\n\n## 리스크\ny\n\n## Timeline\nz\n";
    expect(unknownSections(md)).toEqual(["리스크", "Timeline"]);
  });

  it("`### ` 후보안 제목은 섹션이 아니라 세지 않는다", () => {
    expect(unknownSections(DOC)).toEqual([]);
  });
});

describe("안정 id 자동 부여", () => {
  it("다음 방안 id 는 쓰이지 않은 알파벳", () => {
    expect(nextOptionId(DOC)).toBe("opt-b");
    expect(nextOptionId("{#opt-a} {#opt-b} {#opt-d}")).toBe("opt-c");
    expect(nextOptionId("")).toBe("opt-a");
  });

  it("다음 단계 id 는 최대 번호 + 1 (구멍이 있어도 겹치지 않는다)", () => {
    expect(nextStepId(DOC)).toBe("next-2");
    expect(nextStepId("- [ ] a {#next-1}\n- [ ] b {#next-7}")).toBe("next-8");
    expect(nextStepId("")).toBe("next-1");
  });
});

describe("서식 토글", () => {
  it("선택을 감싸고 선택 범위를 안쪽 텍스트에 남긴다", () => {
    const doc = "hello world";
    const op = wrapOp(doc, 0, 5, "**");
    const next = apply(doc, op);
    expect(next).toBe("**hello** world");
    // 선택 오프셋은 **반영된 뒤** 문서 기준이다.
    expect(next.slice(op.selFrom, op.selTo)).toBe("hello");
  });

  it("이미 감싸인 선택은 벗긴다", () => {
    const doc = "**hello** world";
    expect(apply(doc, wrapOp(doc, 0, 9, "**"))).toBe("hello world");
  });

  it("마커 안쪽만 선택해도 마커째 벗긴다", () => {
    const doc = "**hello** world";
    expect(apply(doc, wrapOp(doc, 2, 7, "**"))).toBe("hello world");
  });

  it("빈 선택은 마커만 넣고 커서를 사이에 둔다", () => {
    const op = wrapOp("", 0, 0, "`");
    expect(apply("", op)).toBe("``");
    expect(op.selFrom).toBe(1);
    expect(op.selTo).toBe(1);
  });

  it("줄 접두사는 걸친 모든 줄에 붙고, 전부 붙어 있으면 뗀다", () => {
    const doc = "a\nb";
    const added = apply(doc, linePrefixOp(doc, 0, 3, "- "));
    expect(added).toBe("- a\n- b");
    expect(apply(added, linePrefixOp(added, 0, added.length, "- "))).toBe("a\nb");
  });

  it("링크는 url 자리를 선택해 둔다", () => {
    const doc = "docs";
    const op = linkOp(doc, 0, 4, "url");
    const next = apply(doc, op);
    expect(next).toBe("[docs](url)");
    expect(next.slice(op.selFrom, op.selTo)).toBe("url");
  });
});

describe("섹션 삽입", () => {
  it("후보안은 그 섹션 끝(다음 제목 앞)에 들어간다", () => {
    const op = insertInSectionOp(DOC, "options", "### 방안 B {#opt-b}", {
      heading: "후보 해결 방안",
      selectText: "방안 B",
    });
    const next = apply(DOC, op);
    const optionsAt = next.indexOf("### 방안 B");
    expect(optionsAt).toBeGreaterThan(next.indexOf("### 방안 A"));
    expect(optionsAt).toBeLessThan(next.indexOf("## 토의 / 메모"));
    expect(next.slice(op.selFrom, op.selTo)).toBe("방안 B");
  });

  it("섹션이 없으면 문서 끝에 제목과 함께 만든다", () => {
    const md = "## 문제 정의\n\nx\n";
    const next = apply(md, insertInSectionOp(md, "next", "- [ ] 할 일 {#next-1}", {
      heading: "다음 단계",
    }));
    expect(next).toContain("## 다음 단계");
    expect(next.indexOf("## 다음 단계")).toBeGreaterThan(next.indexOf("## 문제 정의"));
  });
});

describe("토의 로그 append", () => {
  const columns = ["시각", "작성자", "내용"] as const;

  it("빈 managed block 에는 표 머리와 함께 한 줄이 들어간다", () => {
    const next = apply(
      DOC,
      appendLogRowOp(DOC, {
        author: "user",
        ts: "2026-06-29T14:03:00+09:00",
        body: "A 가 낫다",
        heading: "토의 / 메모",
        columns,
      }),
    );
    expect(next).toContain("| 시각 | 작성자 | 내용 |");
    expect(next).toContain("| 2026-06-29T14:03:00+09:00 | user | A 가 낫다 |");
    // 행은 반드시 닫는 주석 **앞**에 있어야 파서가 읽는다.
    expect(next.indexOf("| user |")).toBeLessThan(next.indexOf(LOG_END));
  });

  it("기존 행은 건드리지 않고 뒤에 붙인다 (규격 §3)", () => {
    const withRow = DOC.replace(
      LOG_END,
      "| 시각 | 작성자 | 내용 |\n|---|---|---|\n| 2026-06-01T09:00:00+09:00 | claude-code | 먼저 한 말 |\n" +
        LOG_END,
    );
    const next = apply(
      withRow,
      appendLogRowOp(withRow, {
        author: "user",
        ts: "2026-06-29T14:03:00+09:00",
        body: "나중 말",
        heading: "토의 / 메모",
        columns,
      }),
    );
    expect(next).toContain("| 2026-06-01T09:00:00+09:00 | claude-code | 먼저 한 말 |");
    expect(next.indexOf("먼저 한 말")).toBeLessThan(next.indexOf("나중 말"));
    // 표 머리는 두 번 들어가지 않는다.
    expect(next.split("| 시각 | 작성자 | 내용 |").length - 1).toBe(1);
  });

  it("빈 메모는 커서를 내용 칸에 둔다 (편집기에서 바로 타이핑되게)", () => {
    const op = appendLogRowOp(DOC, {
      author: "user",
      ts: "2026-06-29T14:03:00+09:00",
      body: "",
      heading: "토의 / 메모",
      columns,
    });
    const next = apply(DOC, op);
    expect(next.slice(op.selFrom, op.selFrom + 2)).toBe(" |");
    expect(op.selTo).toBe(op.selFrom);
  });

  it("파이프와 줄바꿈은 한 행을 깨뜨리므로 순화한다", () => {
    const next = apply(
      DOC,
      appendLogRowOp(DOC, {
        author: "user",
        ts: "T",
        body: "a | b\n둘째 줄",
        heading: "토의 / 메모",
        columns,
      }),
    );
    expect(next).toContain("| T | user | a \\| b 둘째 줄 |");
  });
});

describe("localIsoWithOffset", () => {
  it("오프셋을 포함한 로컬 ISO 를 만든다", () => {
    const s = localIsoWithOffset(new Date(2026, 5, 29, 14, 3, 7));
    expect(s).toMatch(/^2026-06-29T14:03:07[+-]\d{2}:\d{2}$/);
  });
});
