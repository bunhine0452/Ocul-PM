import type { Terminal } from "@xterm/xterm";

// GPU 렌더러 승격 (TerminalInstanceImpl 에서 분리, 2026-09-11 — 파일 크기 래칫).
// 렌더러 선택은 터미널 본체와 무관한 관심사라 따로 두어도 잃는 맥락이 없다.

/**
 * GPU 렌더러로 승격. open() 이후에만 붙일 수 있고, 컨텍스트를 잃으면 dispose 해
 * xterm 이 DOM 렌더러로 되돌아가게 한다. 애드온 청크는 여기서 지연 로드해
 * 터미널을 안 여는 세션에 비용을 지우지 않는다.
 */
export async function loadWebglRenderer(
  term: Terminal,
  handle: { current: { dispose(): void } | null },
): Promise<void> {
  try {
    const { WebglAddon } = await import("@xterm/addon-webgl");
    if (!term.element) return; // 로드 중 dispose 된 경우
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => {
      // 핸들도 함께 비운다 — xterm 은 DOM 렌더러로 되돌아가고, 그때부터는
      // 링크 밑줄을 저쪽이 그린다 (겹쳐 그으면 두 줄이 된다).
      handle.current = null;
      webgl.dispose();
    });
    term.loadAddon(webgl);
    handle.current = webgl;
  } catch (err) {
    // WebGL2 미지원/차단 — DOM 렌더러 그대로 (동작엔 문제 없음).
    // i18n-ignore-next-line -- 진단 로그(oculpm.log)는 한 언어로 남긴다
    console.warn("[TerminalInstance] WebGL 렌더러 사용 불가, DOM 렌더러로 진행:", err);
  }
}
