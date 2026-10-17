import type { ITerminalAddon, Terminal } from "@xterm/xterm";
import { oculpmLog } from "@/lib/oculpmLog";

// GPU 렌더러 승격 (TerminalInstanceImpl 에서 분리, 2026-09-11 — 파일 크기 래칫).
// 렌더러 선택은 터미널 본체와 무관한 관심사라 따로 두어도 잃는 맥락이 없다.
//
// ── 안 보이는 동안은 컨텍스트를 반납한다 (2026-10-18) ──────────────────────
// 설치본 3.5일 가동에서 WebContent 그래픽 메모리가 1.2~1.5GB 였다. 터미널은
// 숨어도 마운트를 유지한다 — 비활성 터미널 탭(`display: none`), 다른 프로젝트
// 탭(`.tabpane[hidden]`), 확대에 가려진 페인. 그리고 종전에는 한 번 열린 페인이
// 언마운트될 때까지 WebGL 컨텍스트를 쥐고 있었다. 컨텍스트 하나가 드로잉 버퍼
// (캔버스 장치 픽셀 × 4B, WebKit 은 여러 벌)와 **아틀라스 페이지마다 텍스처
// 사본**(1024² 4MB · 2048² 16MB — 아틀라스 캔버스는 터미널끼리 공유하지만
// 텍스처는 컨텍스트마다 따로 올린다)을 든다. 세션이 8개면 그 곱이다.
//
// xterm 은 숨은 터미널의 렌더를 멈출 뿐(IntersectionObserver) 메모리는 놓지
// 않는다. 그래서 숨은 지 `HIDE_RELEASE_MS` 가 지나면 애드온을 dispose 해 DOM
// 렌더러로 내려 두고(숨어 있으니 그리지도 않는다), 다시 보이면 새로 붙인다.
// 새 렌더러는 붙는 순간 지금 cols×rows·DPR 로 캔버스와 아틀라스를 만든다 —
// 크기를 다루는 `planFit` 과는 만나는 데가 없다. 마지막 소유자가 놓으면 공유
// 아틀라스도 함께 버려져, 며칠 쌓인 글리프 페이지가 그때 비워진다.
//
// 덤: WebKit 은 페이지당 활성 컨텍스트 수에 상한이 있어(넘으면 오래된 것부터
// 잃는다) 숨은 페인이 자리를 차지하면 보이는 페인이 DOM 으로 떨어질 수 있었다.
// 잃은 컨텍스트는 예전엔 영영 DOM 이었지만, 이제 다음에 보일 때 되살린다.

/** 숨은 뒤 컨텍스트를 반납하기까지 — 탭을 잠깐 오가는 정도로는 재생성하지 않는다. */
export const HIDE_RELEASE_MS = 15_000;

/** 슬롯이 쓰는 애드온 표면 — 테스트에서 가짜를 세우기 위해. */
export interface WebglAddonLike extends ITerminalAddon {
  onContextLoss(cb: () => void): { dispose(): void };
}

type SlotTerm = Pick<Terminal, "loadAddon"> & { element?: HTMLElement | undefined };
type AddonFactory = () => Promise<WebglAddonLike>;

const importWebgl: AddonFactory = async () => {
  const { WebglAddon } = await import("@xterm/addon-webgl");
  return new WebglAddon();
};

/**
 * 터미널 하나의 WebGL 애드온 자리. `show` 는 보일 때, `hide` 는 숨을 때 부른다.
 * 애드온 청크는 첫 `show` 에서 지연 로드해 터미널을 안 여는 세션에 비용을
 * 지우지 않는다. 미지원/차단/컨텍스트 소실이면 xterm 이 DOM 렌더러로 남는다.
 */
export class WebglSlot {
  private addon: WebglAddonLike | null = null;
  private term: SlotTerm | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** 불러오는 중인 요청의 세대 — 그 사이 반납·정리되면 결과를 버린다. */
  private gen = 0;
  private loading = false;

  constructor(private readonly factory: AddonFactory = importWebgl) {}

  /** GPU 렌더러가 붙어 있는가 (링크 밑줄을 누가 그릴지 판정). */
  get active(): boolean {
    return this.addon !== null;
  }

  show(term: SlotTerm): void {
    this.cancelRelease();
    if (this.addon || this.loading || !term.element) return;
    const gen = ++this.gen;
    this.loading = true;
    void this.factory()
      .then((addon) => {
        // 로드 중 dispose·반납된 경우, 또는 터미널이 정리된 경우.
        if (gen !== this.gen || !term.element) return void addon.dispose();
        addon.onContextLoss(() => {
          // 핸들도 함께 비운다 — xterm 은 DOM 렌더러로 되돌아가고, 그때부터는
          // 링크 밑줄을 저쪽이 그린다 (겹쳐 그으면 두 줄이 된다).
          if (this.addon === addon) this.addon = null;
          this.safeDispose(addon);
        });
        term.loadAddon(addon);
        this.addon = addon;
        this.term = term;
      })
      .catch((err: unknown) => {
        // WebGL2 미지원/차단 — DOM 렌더러 그대로 (동작엔 문제 없음).
        // i18n-ignore-next-line -- 진단 로그(oculpm.log)는 한 언어로 남긴다
        console.warn("[TerminalInstance] WebGL 렌더러 사용 불가, DOM 렌더러로 진행:", err);
      })
      .finally(() => {
        if (gen === this.gen) this.loading = false;
      });
  }

  /** 숨었다 — 곧 다시 보이지 않으면 컨텍스트를 반납한다. */
  hide(): void {
    if (this.timer !== null || (!this.addon && !this.loading)) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.release();
    }, HIDE_RELEASE_MS);
  }

  /** 정리 — 코어 `term.dispose()` 보다 **먼저** 부른다. 다시 `show` 할 수 있다. */
  dispose(): void {
    this.cancelRelease();
    this.release();
  }

  private release(): void {
    this.gen++;
    this.loading = false;
    const addon = this.addon;
    this.addon = null;
    if (!addon) return;
    // 애드온은 텍스처·버퍼는 지우지만 컨텍스트(드로잉 버퍼)는 캔버스가 GC 될
    // 때까지 남는다 — 떼어 내기 전에 캔버스를 쥐어 두었다가 바로 잃게 한다.
    // 2D 캔버스(링크 층)에는 `getContext("webgl2")` 가 null 이라 건드리지 않는다.
    const canvases = Array.from(this.term?.element?.querySelectorAll?.("canvas") ?? []);
    this.term = null;
    this.safeDispose(addon);
    for (const c of canvases) {
      try {
        c.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
      } catch {
        /* 이미 잃었거나 미지원 — 캔버스 GC 에 맡긴다 */
      }
    }
  }

  private cancelRelease(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  /**
   * A0d 근본 원인 — 정리에서 throw 금지: addon-webgl 0.19 가 xterm 5.5 코어에
   * 없는 내부(_core._store)를 dispose 에서 만져 언마운트 커밋을 통째로
   * 무너뜨렸다(앱 전체 빈 화면). 버전은 0.18 로 정합했고, 여기는 미래의 어떤
   * dispose 예외도 앱을 죽이지 못하게 가드한다.
   */
  private safeDispose(addon: WebglAddonLike): void {
    try {
      addon.dispose();
    } catch (err) {
      // i18n-ignore-next-line -- 진단 로그(oculpm.log)는 한 언어로 남긴다
      oculpmLog.error("terminal", `webgl dispose 실패 (무시): ${String(err)}`);
    }
  }
}
