// 메뉴 액셀러레이터의 "화면이 고르는" 사슬 (⌘W · ⌘T 공용).
//
// macOS 는 앱 메뉴 액셀러레이터를 웹뷰보다 **먼저** 소비한다 — 프런트에서
// keydown 을 잡아도 이벤트가 오지 않는다. 그래서 Rust 가 곧장 처리하는 대신
// 의도(intent)만 쏘고, 무엇이 열려 있는지 아는 프런트가 대상을 고른다.
//
// 겹쳐 있는 것들이 순서대로 답한다: 나중에 등록한 것이 더 안쪽이라는 뜻이다.
// 다만 등록 순서만으로는 부족한 자리가 있다 — **겹쳐 떠 있는** 면(터미널
// 도크는 다른 화면 위에 얹힌다)에서는 "가장 나중에 등록된 것" 이 사용자가
// 지금 보고 있는 것과 무관하다. 그래서 포커스를 아는 등록자는 `scope` 를 함께
// 준다: 그 안에 포커스가 있으면 순서를 건너뛰고 먼저 답한다.

/** 처리했으면 `true` (소비). 아니면 `false` — 다음 차례로 넘어간다. */
export type IntentHandler = () => boolean;

/** 이 요소 **안에 포커스가 있을 때만** 우선권을 갖는다. */
export type IntentScope = () => HTMLElement | null;

interface Entry {
  handler: IntentHandler;
  scope?: IntentScope;
}

export interface IntentChain {
  /** 사슬에 넣는다. 반환값을 부르면 빠진다 (effect cleanup 에 그대로 쓴다). */
  register(handler: IntentHandler, scope?: IntentScope): () => void;
  /**
   * 안쪽부터 물어본다. 아무도 안 받으면 `false` — 부르는 쪽이 기본 동작을 한다.
   *
   * 두 바퀴를 돈다: ① 지금 포커스를 품은 등록, ② 나머지. 둘 다 나중에 등록된
   * 것부터다. 포커스를 아는 쪽이 없으면 ②만 도므로 순서 규칙 그대로다.
   *
   * 사본을 뒤집어 도는 이유: 처리기가 자기 자신을 빼는 경우가 있어(마지막
   * 세션 탭을 닫으면 더 닫을 것이 없어진다) 원본을 순회하면 건너뛰게 된다.
   */
  run(): boolean;
}

export function createIntentChain(): IntentChain {
  const entries: Entry[] = [];

  /** 지금 포커스를 품고 있는 등록인가. scope 가 없으면 판단할 수 없다(= 아니다). */
  const holdsFocus = (entry: Entry): boolean => {
    const el = entry.scope?.();
    const active = typeof document === "undefined" ? null : document.activeElement;
    return el != null && active != null && el.contains(active);
  };

  return {
    register(handler, scope) {
      const entry: Entry = { handler, scope };
      entries.push(entry);
      return () => {
        const at = entries.lastIndexOf(entry);
        if (at !== -1) entries.splice(at, 1);
      };
    },
    run() {
      const snapshot = [...entries].reverse();
      for (const entry of snapshot) {
        if (holdsFocus(entry) && entry.handler()) return true;
      }
      for (const entry of snapshot) {
        if (!holdsFocus(entry) && entry.handler()) return true;
      }
      return false;
    },
  };
}
