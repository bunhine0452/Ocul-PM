/**
 * 네이티브(HTML5) 드래그를 **기본 끄기**로 뒤집는다 — 창 하나에 한 번.
 *
 * 증상: 트랙패드 세손가락 드래그로 탭이나 세션 카드를 끌면, 물체 대신 반투명한
 * **텍스트 스냅샷**이 커서를 따라다닌다. 그 순간 우리 포인터 드래그는
 * `pointercancel` 로 끊겨 탭은 제자리에 남는다.
 *
 * 원인은 두 겹이다. ① `user-select: none` 은 **선택**만 막고 드래그는 못 막는다.
 * ② `-webkit-user-drag: none` 은 요소마다 걸어야 하는데(상속되지 않는다), 끌 수
 * 있는 표면은 탭·레일·페인 손잡이·사이드바로 계속 늘어난다 — 한 군데를 빠뜨리면
 * 거기서 그대로 샌다. 실제로 두 번 고치고 두 번 다시 샜다.
 *
 * 그래서 판정을 표면마다가 아니라 **한 곳**에서 한다: 창에 캡처 단계로 한 번
 * 걸고, 스스로 `draggable="true"` 라고 밝힌 요소에서 시작한 것만 통과시킨다
 * (코드 탭·파일 트리가 실제로 네이티브 DnD 를 쓴다). 나머지는 전부 취소다.
 *
 * `dragstart` 를 `preventDefault` 하면 OS 드래그 세션 자체가 열리지 않으므로
 * `pointercancel` 도 오지 않는다 — CSS 로는 닿지 않던 뿌리다.
 */

/** 네이티브 드래그를 **직접 쓰겠다**고 밝힌 요소 (코드 탭 바 · 파일 트리). */
const OPT_IN = '[draggable="true"]';

let installed = false;

export function installNativeDragGuard(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener(
    "dragstart",
    (e) => {
      const el = e.target instanceof Element ? e.target : null;
      // 조상까지 본다 — 드래그 소스는 보통 자식 텍스트 노드이고, 네이티브 DnD 를
      // 쓰는 쪽은 껍데기에 `draggable` 을 단다.
      if (el?.closest(OPT_IN)) return;
      e.preventDefault();
    },
    true,
  );
}
