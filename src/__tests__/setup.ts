import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Lite-W6 PR6.4: components that render `<WorkspaceProvider>` register
// `events.oculpm*.listen(...)` handlers on mount. Outside the Tauri runtime
// (jsdom) those calls dereference an undefined `__TAURI_INTERNALS__` and
// throw, which floods the test output without failing assertions. Stub
// `@tauri-apps/api/event` with no-op subscribers so the listeners install
// quietly. Tests that need to fire payloads can override per-test.
vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
  once: () => Promise.resolve(() => {}),
  emit: () => Promise.resolve(),
  TauriEvent: {},
}));
