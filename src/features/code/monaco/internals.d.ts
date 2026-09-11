// Monaco 0.56 의 esm 내부 모듈에는 `.d.ts` 가 없다 (`editor.api` 만 있다). 우리가
// 만지는 넷만 최소로 선언한다 — 모양이 Monaco 와 어긋나면 `clipboard.ts` 의
// 런타임이 아니라 여기가 틀린 것이다.
declare module "monaco-editor/platform/clipboard/browser/clipboardService" {
  export class BrowserClipboardService {
    constructor(...args: unknown[]);
    installWebKitWriteTextWorkaround(): void;
    writeText(text: string, type?: string): Promise<void>;
    fallbackWriteText(text: string): void;
    clearResourcesState(): void;
  }
}

declare module "monaco-editor/platform/instantiation/common/descriptors" {
  export class SyncDescriptor<T = unknown> {
    constructor(
      ctor: new (...args: never[]) => T,
      staticArguments?: unknown[],
      supportsDelayedInstantiation?: boolean,
    );
  }
}

declare module "monaco-editor/editor/standalone/browser/standaloneServices" {
  export const StandaloneServices: {
    initialize(overrides: Record<string, unknown>): unknown;
  };
}
