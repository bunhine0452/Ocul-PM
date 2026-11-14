// 두벌식 · 맥의 ⌃ (11-15) — readChord 가 한글 자판에서도 라틴 글자를 주고, 입력칸 · 터미널 면의 ⌃ 는 그 자리에 양보한다.
import { afterEach, describe, expect, it } from "vitest";

import { isModalOpen, isTextEntry, readChord } from "@/lib/kbd";
import { __setPlatformForTests } from "@/lib/platform";

type Init = Partial<KeyboardEvent> & { key: string };

function ev(init: Init, target: EventTarget | null = document.body): KeyboardEvent {
  return {
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    getModifierState: () => false,
    target,
    ...init,
  } as unknown as KeyboardEvent;
}

function attach<T extends HTMLElement>(el: T): T {
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
  __setPlatformForTests(null);
});

describe("readChord on macOS — the Korean 2-set layout", () => {
  it("gives back the Latin letter from `code`, punctuation as typed", () => {
    __setPlatformForTests("mac");
    // i18n-ignore-next-line -- 두벌식 자판이 보내는 key 값이 검사 재료다
    expect(readChord(ev({ key: "ㅓ", code: "KeyJ" })).key).toBe("j");
    // i18n-ignore-next-line -- 두벌식 자판이 보내는 key 값이 검사 재료다
    expect(readChord(ev({ key: "ㅍ", code: "KeyV", metaKey: true }))).toMatchObject({ mod: true, key: "v" });
    expect(readChord(ev({ key: "/", code: "Slash" })).key).toBe("/");
    expect(readChord(ev({ key: "Process", code: "KeyK" })).key).toBe("k");
    expect(readChord(ev({ key: "ArrowDown", code: "ArrowDown" })).key).toBe("ArrowDown");
  });

  it("⌃ in a text field is the field's own key (⌃K kills to end of line) — ⌘ is still the app's", () => {
    __setPlatformForTests("mac");
    const input = attach(document.createElement("input"));
    expect(readChord(ev({ key: "k", code: "KeyK", ctrlKey: true }, input)).mod).toBe(false);
    expect(readChord(ev({ key: "k", code: "KeyK", metaKey: true }, input)).mod).toBe(true);
    const area = attach(document.createElement("textarea"));
    expect(readChord(ev({ key: "e", code: "KeyE", ctrlKey: true }, area)).mod).toBe(false);
    const editable = attach(document.createElement("div"));
    editable.setAttribute("contenteditable", "true");
    const inner = editable.appendChild(document.createElement("span"));
    expect(readChord(ev({ key: "a", code: "KeyA", ctrlKey: true }, inner)).mod).toBe(false);
  });

  it("⌃ on the terminal surface belongs to the shell (⌃/ · ⌃2 were the palette and a screen switch)", () => {
    __setPlatformForTests("mac");
    const wrap = attach(document.createElement("div"));
    wrap.className = "term-wrap";
    const button = wrap.appendChild(document.createElement("button"));
    expect(readChord(ev({ key: "/", code: "Slash", ctrlKey: true }, button)).mod).toBe(false);
    expect(readChord(ev({ key: "2", code: "Digit2", ctrlKey: true }, button)).mod).toBe(false);
    expect(readChord(ev({ key: "2", code: "Digit2", metaKey: true }, button)).mod).toBe(true);
  });

  it("elsewhere ⌃ still reads as ⌘ — a checkbox or the page body is not a text field", () => {
    __setPlatformForTests("mac");
    expect(readChord(ev({ key: "k", code: "KeyK", ctrlKey: true })).mod).toBe(true);
    const box = attach(document.createElement("input"));
    box.type = "checkbox";
    expect(isTextEntry(box)).toBe(false);
    expect(readChord(ev({ key: "k", code: "KeyK", ctrlKey: true }, box)).mod).toBe(true);
  });
});

describe("readChord on Windows · Linux — plain letters from a Korean layout", () => {
  it.each(["windows", "linux"] as const)("%s: j · k come back Latin without a modifier", (os) => {
    __setPlatformForTests(os);
    // i18n-ignore-next-line -- 두벌식 자판이 보내는 key 값이 검사 재료다
    expect(readChord(ev({ key: "ㅏ", code: "KeyK" }))).toMatchObject({ mod: false, key: "k" });
    expect(readChord(ev({ key: "Process", code: "KeyJ" }))).toMatchObject({ mod: false, key: "j" });
  });
});

describe("isModalOpen", () => {
  it("is true only while an aria-modal element is in the document", () => {
    expect(isModalOpen()).toBe(false);
    const dialog = attach(document.createElement("div"));
    dialog.setAttribute("aria-modal", "true");
    expect(isModalOpen()).toBe(true);
    dialog.remove();
    expect(isModalOpen()).toBe(false);
  });
});
