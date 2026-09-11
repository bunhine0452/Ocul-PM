/**
 * Monaco 클립보드 서비스 — WKWebView 용 (감사 라운드 2026-09-11 A3).
 *
 * Monaco 의 `BrowserClipboardService` 는 Safari/WebKit 을 감지하면
 * `installWebKitWriteTextWorkaround` 로 편집기 컨테이너의 **click·keydown
 * 마다** `navigator.clipboard.write([ClipboardItem(deferred)])` 를 미리 걸어
 * 둔다 — 확장 호스트(웹워커)의 비동기 복사가 사용자 제스처로 인정받게 하는
 * VS Code 웹의 장치다. 이 앱엔 확장 호스트가 없고, WKWebView 는 그 write 를
 * 매번 `NotAllowedError` 로 거절한다. 그래서 키 하나에 ERROR 두 줄이 남았다
 * (`NotAllowedError` + 직전 deferred 를 취소한 `unhandled rejection: Canceled`,
 * 하루 251건) — 진짜 오류가 그 소음에 묻혔다.
 *
 * 우회를 **설치하지 않는** 서브클래스다. `writeText` 는 그대로 `navigator.
 * clipboard.writeText` 를 먼저 시도하고 실패하면 textarea+execCommand 로 —
 * 다만 실패를 console.error 로 남기지 않는다. 그 실패는 정상 경로다.
 *
 * `StandaloneServices.initialize` 는 **첫 호출만** 오버라이드를 받으므로
 * (`monaco.languages.register` 같은 첫 `get` 이 `initialize({})` 를 부른다)
 * `setup.ts` 가 언어를 등록하기 **전에** 이 함수를 부른다.
 */
import { BrowserClipboardService } from "monaco-editor/platform/clipboard/browser/clipboardService";
import { SyncDescriptor } from "monaco-editor/platform/instantiation/common/descriptors";
import { StandaloneServices } from "monaco-editor/editor/standalone/browser/standaloneServices";

class WebviewClipboardService extends BrowserClipboardService {
  override installWebKitWriteTextWorkaround(): void {
    // 의도적으로 비움 — 머리말 참고.
  }

  override async writeText(text: string, type?: string): Promise<void> {
    if (type) return super.writeText(text, type);
    this.clearResourcesState();
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // WKWebView 가 제스처 밖 쓰기를 거절했다 — 조용히 대체 경로로.
    }
    this.fallbackWriteText(text);
  }
}

let installed = false;

/** 첫 편집기보다 먼저, 한 번만. 되풀이 호출은 no-op. */
export function installClipboardService(): void {
  if (installed) return;
  installed = true;
  StandaloneServices.initialize({
    clipboardService: new SyncDescriptor(WebviewClipboardService, [], true),
  });
}
