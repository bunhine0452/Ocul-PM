import { commands } from "@/lib/bindings";

// 바깥 링크는 **기본 브라우저로 나간다** (2026-08-16).
//
// 웹뷰에는 뒤로 가기가 없다. 대화에 섞여 온 `https://…` 를 눌러 그 자리에서
// 열리면 앱이 통째로 그 페이지가 되고 돌아올 길이 없다 — 세션도 스크롤도
// 그대로 날아간다. 실제로 Claude Code 화면에서 그렇게 됐다.
//
// 화면마다 `a` 렌더러를 다는 대신 **창 하나에 한 번** 문서에 건다: 마크다운
// 링크든 손으로 쓴 앵커든 통로가 하나뿐이라 새는 곳이 없다.
//
// 버블 단계인 것이 중요하다 — 캡처로 걸면 문서 뷰어처럼 자기 링크를 직접
// 처리하는 화면(상대경로 `./foo.md` 로 위키 내 이동)의 손을 먼저 뺏는다.
// 버블이면 React 핸들러가 먼저 돌고, 그쪽이 `preventDefault()` 했으면 우리는
// 비켜선다.

/** 밖으로 내보낼 스킴. 백엔드 `open_url` 이 받는 것과 같은 목록이다. */
const EXTERNAL = /^(?:https?|mailto):/i;

/** 클릭 지점에서 가장 가까운 앵커 (없으면 null). */
function anchorOf(target: EventTarget | null): HTMLAnchorElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest("a[href]");
}

function handle(e: MouseEvent): void {
  // 이미 누군가 처리했다 — 두 번 열지 않는다.
  if (e.defaultPrevented) return;
  const anchor = anchorOf(e.target);
  if (!anchor) return;
  const href = anchor.getAttribute("href")?.trim() ?? "";
  if (!EXTERNAL.test(href)) return;
  e.preventDefault();
  void commands.openUrl(href);
}

/**
 * 창에 가드를 설치한다. 반환값을 부르면 해제된다(테스트용).
 *
 * `auxclick` 까지 받는 이유: 가운데 클릭은 `click` 을 내지 않는데, 웹뷰는
 * 그것도 내비게이션으로 받는다.
 */
export function installExternalLinkGuard(doc: Document = document): () => void {
  doc.addEventListener("click", handle);
  doc.addEventListener("auxclick", handle);
  return () => {
    doc.removeEventListener("click", handle);
    doc.removeEventListener("auxclick", handle);
  };
}
