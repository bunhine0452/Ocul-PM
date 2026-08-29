// ⌘W 의 "안쪽부터 닫기" 사슬.
//
// 브라우저에서 ⌘W 는 늘 **가장 안쪽에 열린 것**을 닫는다. 우리 창도 그렇게
// 겹쳐 있다: 창 → 프로젝트 탭 → (Claude Code 화면이면) 세션 탭. 어느 것이
// 열려 있는지는 화면만 알기 때문에, Rust 가 곧장 탭을 닫는 대신 이 사슬에
// 먼저 묻는다.
//
// 나중에 등록한 것이 먼저 답한다 — 나중에 열린 것이 더 안쪽이라는 뜻이다.
//
// 등록 순서만으로는 부족한 자리가 하나 있다 (2026-08-29). **겹쳐 떠 있는** 면 —
// 터미널 도크는 다른 화면 위에 얹히고, 그 화면도 자기 닫을 것을 들고 있다.
// 그때 "가장 나중에 등록된 것" 은 사용자가 지금 **보고 있는 것**과 무관하다.
// 그래서 포커스를 아는 등록자는 `scope` 를 함께 준다: 그 안에 포커스가 있으면
// 순서를 건너뛰고 먼저 답한다. 사용자가 터미널에 타이핑하다 ⌘W 를 누르면
// 터미널이 닫혀야지, 뒤에 있던 화면의 탭이 닫히면 안 된다.

/** 닫을 것이 있었으면 `true` (소비). 없으면 `false` — 다음 차례로 넘어간다. */
type CloseHandler = () => boolean;

interface Entry {
  handler: CloseHandler;
  /** 이 요소 **안에 포커스가 있을 때만** 우선권을 갖는다. 없으면 순서만 따른다. */
  scope?: () => HTMLElement | null;
}

const entries: Entry[] = [];

/** 사슬에 넣는다. 반환값을 부르면 빠진다 (effect cleanup 에 그대로 쓴다). */
export function registerCloseHandler(
  handler: CloseHandler,
  scope?: () => HTMLElement | null,
): () => void {
  const entry: Entry = { handler, scope };
  entries.push(entry);
  return () => {
    const at = entries.lastIndexOf(entry);
    if (at !== -1) entries.splice(at, 1);
  };
}

/** 지금 포커스를 품고 있는 등록인가. scope 가 없으면 판단할 수 없다(= 아니다). */
function holdsFocus(entry: Entry): boolean {
  const el = entry.scope?.();
  const active = typeof document === "undefined" ? null : document.activeElement;
  return el != null && active != null && el.contains(active);
}

/**
 * 안쪽부터 물어본다. 아무도 안 받으면 `false` — 부르는 쪽이 탭을 닫는다.
 *
 * 두 바퀴를 돈다: ① 지금 포커스를 품은 등록, ② 나머지. 둘 다 나중에 등록된
 * 것부터다. 포커스를 아는 쪽이 없으면 ②만 도므로 예전 동작 그대로다.
 *
 * 사본을 뒤집어 도는 이유: 처리기가 자기 자신을 빼는 경우가 있어(마지막 세션
 * 탭을 닫으면 더 닫을 것이 없어진다) 원본을 순회하면 건너뛰게 된다.
 */
export function runCloseIntent(): boolean {
  const snapshot = [...entries].reverse();
  for (const entry of snapshot) {
    if (holdsFocus(entry) && entry.handler()) return true;
  }
  for (const entry of snapshot) {
    if (!holdsFocus(entry) && entry.handler()) return true;
  }
  return false;
}
