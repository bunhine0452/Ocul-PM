/**
 * ⌘K 「지금 화면」 묶음의 재료 (11-23, love-round P1) — 지금 화면이 **이미 그려 둔 단추**를 읽는다.
 *
 * 새 동작도, 손으로 적는 등록 표도 만들지 않는다. 두 곳을 읽을 뿐이다:
 *   1. 윗줄의 화면 동작 자리(`.topbar-actions`) — 각 화면의 `<Toolbar>` 가 포털한 단추(새 세션 · 영수증 · 메모 보내기 …).
 *      좁은 창에서 「⋯」 안으로 접혀도 같은 요소라 그대로 읽힌다.
 *   2. 화면 본문의 단추 가운데 `data-palette-action` 을 단 것 — 화면 하나에 한 번 서는 동작(계획의 「다음」 ·
 *      「셸에서 돌리기」). 줄마다 서는 단추(오늘의 「확인함」)는 달지 않는다 — 그건 줄을 고르고 키(v · r)로 한다.
 *
 * 누를 수 없는 것(disabled · aria-disabled)과 메뉴를 여는 것(aria-haspopup — 고른 뒤 또 고르게 된다), 대화상자 안의
 * 것은 뺀다. 이름은 단추의 접근명(aria-label → 보이는 글자, 키캡 글자는 빼고 → title), 키는 단추 안 키캡 글자다.
 * 고르면 그 단추를 누른다 — 단추가 하던 일 그대로다.
 */
export const SCREEN_ACTION_ATTR = "data-palette-action";

export interface ScreenAction {
  /** 그 묶음 안에서만 쓰는 순번 id — 이름이 같은 단추는 하나로 모은다. */
  id: string;
  label: string;
  /** 단추 안 키캡의 글자(있으면) — 팔레트 줄 끝에 그대로 선다. */
  shortcut?: string;
  el: HTMLElement;
}

const SELECTOR = `.topbar-actions button, [${SCREEN_ACTION_ATTR}]`;

function usable(el: HTMLElement): boolean {
  if (el.matches(":disabled") || el.getAttribute("aria-disabled") === "true") return false;
  if (el.hasAttribute("aria-haspopup")) return false;
  // 라디오 묶음(변경 화면의 기준)은 지금 고른 것을 뺀다 — 다시 고르면 아무 일도 없다.
  if (el.getAttribute("role") === "radio" && el.getAttribute("aria-checked") === "true") return false;
  if (el.closest('[aria-modal="true"], [hidden], [inert]')) return false;
  return true;
}

function ownLabel(el: HTMLElement): string {
  const aria = el.getAttribute("aria-label")?.trim();
  if (aria) return aria;
  const copy = el.cloneNode(true) as HTMLElement;
  for (const k of copy.querySelectorAll("kbd, .sr-only")) k.remove();
  const text = (copy.textContent ?? "").replace(/\s+/g, " ").trim();
  return text || (el.getAttribute("title") ?? "").trim();
}

/** 라디오 하나는 제 글자만으로는 무엇을 고르는지 모른다(「마지막 커밋」) — 묶음 이름을 앞에 붙인다. */
function labelOf(el: HTMLElement): string {
  const own = ownLabel(el);
  if (el.getAttribute("role") !== "radio") return own;
  const group = el.closest('[role="radiogroup"]')?.getAttribute("aria-label")?.trim();
  return group && own ? `${group} · ${own}` : own;
}

function shortcutOf(el: HTMLElement): string | undefined {
  const k = el.querySelector("kbd")?.textContent?.trim();
  return k || undefined;
}

export function collectScreenActions(root: ParentNode = document): ScreenAction[] {
  const seen = new Set<string>();
  const out: ScreenAction[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(SELECTOR)) {
    if (!usable(el)) continue;
    const label = labelOf(el);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push({ id: `screen-${out.length}`, label, shortcut: shortcutOf(el), el });
  }
  return out;
}

/**
 * 고른 단추를 누른다 — 팔레트가 닫히고 포커스를 돌려준 **뒤에**. 바로 누르면 그 단추가 여는 확인 창(「셸에서
 * 돌리기」)이 팔레트와 겹쳐 서고, 팔레트가 닫히며 돌려준 포커스가 그 확인 창의 포커스를 빼앗았다.
 */
export function pressScreenAction(a: ScreenAction): void {
  window.setTimeout(() => {
    if (a.el.isConnected && usable(a.el)) a.el.click();
  }, 0);
}
