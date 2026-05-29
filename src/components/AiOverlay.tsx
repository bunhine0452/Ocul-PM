/**
 * AiOverlay — Workspace-level AI sheet (Lite-W6 PR9).
 *
 * Spec: docs/Lite-update/03-feature-revisions.md §2. Hosts the existing
 * `AiWorkbench` (Chat + Quick Edit) at the App root so every view
 * (Today / Plan / Code) can summon it with ⌘\. The Code view's right-side
 * panel mount is retired; this overlay is the single home for the AI
 * panel inside the main window.
 *
 * Surface:
 *   - Centered on viewport with a 32 px margin all around. Width caps at
 *     720 px so large monitors keep the chrome readable.
 *   - Closes on ESC, on outside click, on ✕, or on a second ⌘\.
 *   - Header has a "↗ 분리" button that fires `commands.openAiWindow` and
 *     closes the overlay. The detached window is idempotent server-side
 *     (focus + unminimise the existing instance), so repeated clicks just
 *     bring the window to the front.
 *
 * The detached `?window=ai` entry mounts `AiWorkbench` directly — no
 * overlay chrome — so users can resize/move the system window freely.
 */

import { useEffect, useState } from "react";
import { commands } from "@/lib/bindings";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { AiWorkbench } from "@/features/code/AiWorkbench";
import { Button } from "@/components/ui/button";
import { X, ExternalLink, Sparkles } from "@/components/Icons";
import { toast } from "@/lib/toast";

interface AiOverlayProps {
  activeProjectId: number | null;
  activeFile: string | null;
}

export function AiOverlay({ activeProjectId, activeFile }: AiOverlayProps) {
  const { state, setAiOverlayOpen } = useWorkspace();
  const { aiOverlayOpen } = state;
  const [detaching, setDetaching] = useState(false);

  // ESC closes the overlay. We register the listener while open so the
  // global ⌘\ handler stays the canonical toggle path.
  useEffect(() => {
    if (!aiOverlayOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setAiOverlayOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aiOverlayOpen, setAiOverlayOpen]);

  if (!aiOverlayOpen) return null;

  const onDetach = async () => {
    setDetaching(true);
    try {
      const res = await commands.openAiWindow();
      if (res.status === "error") {
        toast.destructive(`AI 윈도우 열기 실패: ${res.error}`);
      } else {
        setAiOverlayOpen(false);
      }
    } finally {
      setDetaching(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="AI 패널"
      onClick={(e) => {
        // Outside-click close — bail when the click is inside the sheet.
        if (e.target === e.currentTarget) setAiOverlayOpen(false);
      }}
      className="fixed inset-0 z-[80] bg-background/55 backdrop-blur-sm flex items-stretch justify-center p-4 animate-in fade-in duration-150"
    >
      <div
        className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-[720px] h-full max-h-[calc(100vh-80px)] my-auto overflow-hidden flex flex-col animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <header className="px-4 py-2.5 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold font-heading">AI 패널</h2>
            <span className="text-[10px] text-muted-foreground font-mono">⌘\</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onDetach}
              disabled={detaching}
              className="h-7 px-2 text-[11px] font-medium"
              title="분리 윈도우로 열기 (⌘⇧\)"
            >
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
              분리
            </Button>
            <button
              onClick={() => setAiOverlayOpen(false)}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title="닫기 (Esc · ⌘\)"
              aria-label="AI 패널 닫기"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </header>

        {/* Body — hosts the existing AiWorkbench so we don't rewrite Chat / Quick Edit. */}
        <div className="flex-1 overflow-hidden">
          <AiWorkbench activeProjectId={activeProjectId} activeFile={activeFile} />
        </div>
      </div>
    </div>
  );
}
