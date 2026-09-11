import { describe, expect, it, vi } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { blocked } from "@/lib/blocked";
import { ROOT, walk } from "./designFs";

// {#fix-disabled-reason} (2026-09-10) — 감사의 처방(title·aria-describedby)은
// `disabled` 요소가 마우스도 포커스도 안 받아 **둘 다 사용자에게 도달하지
// 않는다**. 그래서 요소를 살려 두고(aria-disabled) 클릭만 막는다. 여기서
// 지키는 것은 그 계약이다.
describe("blocked()", () => {
  it("이유가 없으면 비활성 신호를 만들지 않는다", () => {
    expect(blocked(null)).toEqual({});
    expect(blocked(undefined)).toEqual({});
    expect(blocked("")).toEqual({});
  });

  it("이유가 없고 평소 툴팁만 있으면 툴팁만 준다", () => {
    expect(blocked(null, "무엇을 하는 버튼인지")).toEqual({ title: "무엇을 하는 버튼인지" });
  });

  it("막히면 이유가 툴팁을 **이긴다** — 같은 자리를 두고 다투는 다른 문장이다", () => {
    const props = blocked("프로젝트를 먼저 고르세요", "무엇을 하는 버튼인지");
    expect(props).toMatchObject({ "aria-disabled": true, title: "프로젝트를 먼저 고르세요" });
  });

  it("`disabled` 를 내보내지 않는다 — 그걸 쓰면 이유가 다시 도달하지 않는다", () => {
    expect(blocked("이유")).not.toHaveProperty("disabled");
  });

  it("클릭을 capture 단계에서 막는다 — 조상의 위임 핸들러까지", () => {
    const props = blocked("이유");
    expect("onClickCapture" in props).toBe(true);
    const e = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    (props as { onClickCapture: (e: unknown) => void }).onClickCapture(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.stopPropagation).toHaveBeenCalled();
  });
});

// ─── 이유 없는 비활성 — 래칫 ────────────────────────────────────────────────
//
// 실측 131곳에서 시작했다. 감사는 35곳이라 했는데 그건 `title`·
// `aria-describedby` 가 없는 것만 센 수이고, 있던 16곳도 전부 **아이콘 버튼의
// 이름**(이름 바꾸기·삭제·위로)이지 막힌 이유가 아니었다 — 이유를 말하는 곳은
// 처음부터 0 이었다.
//
// **자가 있으면 자부터 본다 (2026-09-10 2차).** 이 스캐너의 첫 판은 "진행 중"
// 을 낱말 아홉 개로만 알아서, 같은 뜻의 다른 낱말(`installing`·`deleting`·
// `renaming`·`scanning`…)과 `busy != null` 같은 **표현 형태**를 전부 부채로
// 셌다. 부채가 아닌 것을 부채로 세면 숫자를 갚아도 화면은 안 좋아지고, 갚을
// 수 없는 자리(프리미티브의 `disabled` 통과)까지 목록에 남는다.
//
// 그래서 세는 규칙을 넷으로 나눈다:
//
//   1. **진행 중** — 스스로 설명되고 곧 풀린다. 사용자가 물을 것이 없다.
//      낱말 목록은 아래 `TRANSIENT` 이고, 늘릴 때는 "곧 저절로 풀리는가" 만
//      본다. `!story || exporting` 처럼 **한 조각이라도** 조건이면 부채다.
//   2. **통과** — `disabled={disabled}` · `item.disabled` 는 프리미티브가
//      호출자의 값을 나르는 자리다. 이유는 호출자가 알고, 호출자 쪽은 어차피
//      따로 세어진다. 여기서 세면 고칠 수 없는 항목이 목록에 남는다.
//      `!onOpenEntry` 처럼 **콜백 prop 의 부재**도 같다 — 호출자가 그 능력을
//      안 준 것이지 사용자가 고칠 조건이 아니다.
//   3. **이 패턴의 자리가 아닌 요소** (2026-09-11 5차) — 속성만 보면 같은
//      `disabled=` 지만 `blocked()` 가 들어갈 수 없는 자리다:
//      - 입력 필드(`input`·`textarea`·`select`·`Input`…): 비활성은 동작이 아니라
//        **필드 상태**다. `aria-disabled` 는 타이핑을 막지 못하므로 이 헬퍼를
//        쓸 수 없고, 이유는 placeholder·hint·곁 문장이 말한다.
//      - cmdk `Command.Item`: cmdk 가 `aria-disabled` 와 키보드 건너뛰기를
//        스스로 한다. 우리가 덧씌우면 두 손이 된다.
//      - `aria-expanded` 를 가진 펼침 버튼: 펼칠 것이 없는 펼침은 막힌 동작이
//        아니다 — 사용자가 고쳐서 생길 내용이 아니다.
//   4. 나머지가 진짜 부채 — 조건이 안 맞아 막혔고 **무엇을 고쳐야 하는지**를
//      사용자가 알아야 풀린다.
//
// 131 → 0 (2026-09-11). 새 비활성은 `blocked()` 를 거치거나 (lib/blocked.ts)
// `AutomationEditor` 처럼 곁에 보이는 문장을 두는 쪽이다 — 이 숫자는 다시
// 오르지 않는다.
describe("이유 없는 비활성 (래칫)", () => {
  /** 곧 저절로 풀리는 상태의 낱말. 늘릴 때 보는 것은 그 하나뿐이다. */
  const TRANSIENT = [
    "busy",
    "loading",
    "saving",
    "pending",
    "running",
    "sending",
    "submitting",
    "inflight",
    "working",
    "installing",
    "starting",
    "stopping",
    "deleting",
    "renaming",
    "creating",
    "importing",
    "exporting",
    "verifying",
    "coercing",
    "checking",
    "scanning",
    "refreshing",
    "applying",
    "recording",
    "opening",
    "backfilling",
    "picking",
    "compacting",
    "rebuilding",
    "reindexing",
    "revealing",
    "streaming",
    "drafting",
    "syncing",
    "restoring",
    "connecting",
    "uploading",
    "indexing",
    "generating",
  ];
  // 접미형(`isSaving`)과 접두형(`savingBody`) 둘 다 — 낱말이 어느 쪽에 붙든
  // "진행 중"이다.
  const isTransientWord = (w: string) =>
    TRANSIENT.some((t) => new RegExp(`(?:(?:^|[A-Za-z])${t}|^${t}[A-Z]\\w*)$`, "i").test(w));

  /**
   * 이 조각을 세지 않아도 되는가.
   *
   * 표현 형태를 먼저 벗긴다 — `busy != null` · `state === "applying"` ·
   * `ledger.scanning` 은 전부 "진행 중" 인데, 낱말만 보면 셋 다 안 걸린다.
   */
  function skippable(raw: string): boolean {
    let p = raw.trim().replace(/^!+/, "").trim();
    // `X === "리터럴"` → 리터럴이 상태 이름이다 (`updater.kind === "checking"`).
    const lit = /(?:={2,3}|!={1,2})\s*["'`](\w+)["'`]\s*$/.exec(p);
    if (lit) return isTransientWord(lit[1]);
    // `X != null` · `X !== undefined` → X 가 상태다.
    p = p.replace(/\s*(?:!={1,2}|={2,3})\s*(?:null|undefined)\s*$/, "").trim();
    if (!/^[\w.?[\]]+$/.test(p)) return false;
    const last = p.split(/[.?[\]]+/).filter(Boolean).pop() ?? "";
    // 프리미티브가 호출자의 값을 나르는 자리 — 이유는 호출자가 안다.
    if (last.toLowerCase() === "disabled") return true;
    // 콜백 prop 의 부재(`!onOpenEntry`) — 능력을 안 준 것은 호출자다.
    if (/^on[A-Z]\w*$/.test(p)) return true;
    return isTransientWord(last);
  }

  /** `blocked()` 가 들어갈 수 없는 요소 — 규칙 3. */
  const FIELD_TAGS = /^(?:input|textarea|select|Input|Textarea|Select|Checkbox|Switch|Slider)$/;
  const CMDK_TAGS = /^(?:Command\.Item|CommandItem)$/;

  /**
   * 속성이 속한 여는 태그 `<Tag …>` 를 돌려준다. `{}` 깊이 0 의 `>` 가 태그의
   * 끝이다 — `onClick={() => …}` 의 `=>` 는 깊이 1 이라 걸리지 않는다.
   */
  function enclosingTag(src: string, attrIndex: number): { name: string; text: string } | null {
    const start = src.lastIndexOf("<", attrIndex);
    if (start < 0) return null;
    const name = /^<([A-Za-z][\w.]*)/.exec(src.slice(start, start + 80))?.[1];
    if (!name) return null;
    let depth = 0;
    for (let i = start + 1; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) return { name, text: src.slice(start, i + 1) };
    }
    return null;
  }

  function notThisPattern(tag: { name: string; text: string } | null): boolean {
    if (!tag) return false;
    if (FIELD_TAGS.test(tag.name) || CMDK_TAGS.test(tag.name)) return true;
    return /\saria-expanded=/.test(tag.text);
  }

  it("이유 없이 막는 버튼이 **늘지** 않는다", () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT))) {
      if (!/\.tsx$/.test(file)) continue;
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/disabled=\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g)) {
        const parts = m[1].split(/\|\||&&/);
        if (parts.every(skippable)) continue;
        if (notThisPattern(enclosingTag(src, m.index!))) continue;
        offenders.push(`${file.slice(ROOT.length + 1)}:${src.slice(0, m.index).split("\n").length}`);
      }
    }
    expect(offenders, "이유 없는 비활성 — blocked() 를 거치거나 곁에 문장을 둘 것").toEqual([]);
  });

  // 자를 바꿨으면 자가 맞는지도 본다 (프로브).
  it("진행 중과 통과를 안 세고, 조건은 센다", () => {
    expect(skippable("busy != null")).toBe(true);
    expect(skippable("ledger.scanning")).toBe(true);
    expect(skippable('updater.kind === "installing"')).toBe(true);
    expect(skippable("item.disabled")).toBe(true);
    expect(skippable("!draft.trim()")).toBe(false);
    expect(skippable("projectId == null")).toBe(false);
    expect(skippable("!stopped")).toBe(false);
    expect(skippable('state !== "ready"')).toBe(false);
    expect(skippable("savingBody")).toBe(true);
    expect(skippable("!onOpenEntry")).toBe(true);
    expect(skippable("!onOpen.enabled")).toBe(false);
  });

  it("입력 필드·cmdk 항목·펼침 버튼은 이 패턴의 자리가 아니다", () => {
    const at = (src: string) => enclosingTag(src, src.indexOf("disabled="));
    expect(notThisPattern(at('<textarea value={v} disabled={p == null} />'))).toBe(true);
    expect(notThisPattern(at('<Input value={id} disabled={!isNew} />'))).toBe(true);
    expect(notThisPattern(at('<Command.Item value="x" disabled={sym.path == null}>'))).toBe(true);
    expect(
      notThisPattern(at('<button onClick={() => go()} disabled={!expandable} aria-expanded={open}>')),
    ).toBe(true);
    // 화살표의 `>` 는 태그 끝이 아니다 — 그 뒤의 aria-expanded 까지 읽는다.
    expect(at('<button onClick={() => go()} disabled={!x} aria-expanded={o}>')?.text).toContain("aria-expanded");
    expect(notThisPattern(at('<button disabled={!draft.trim()}>'))).toBe(false);
    expect(notThisPattern(at('<Button disabled={projectId == null}>'))).toBe(false);
  });
});
