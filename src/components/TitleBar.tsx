import React from "react";
import { commands } from "../lib/bindings";
import { ChevronLeft, Maximize2, Minimize2, X } from "lucide-react";

interface TitleBarProps {
  projectName?: string | null;
  onBackToDashboard?: () => void;
}

export function TitleBar({ projectName, onBackToDashboard }: TitleBarProps) {
  const handleMinimize = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await commands.minimizeWindow();
    } catch (err) {
      console.error("Failed to minimize window:", err);
    }
  };

  const handleMaximize = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await commands.toggleMaximizeWindow();
    } catch (err) {
      console.error("Failed to toggle maximize window:", err);
    }
  };

  const handleClose = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await commands.closeWindow();
    } catch (err) {
      console.error("Failed to close window:", err);
    }
  };

  const handleDoubleClick = async (e: React.MouseEvent) => {
    // Check if double click was on the drag region itself, not on buttons/interactive elements
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("a")) return;
    try {
      await commands.toggleMaximizeWindow();
    } catch (err) {
      console.error("Failed to maximize on double click:", err);
    }
  };

  return (
    <div
      className="h-11 border-b border-border bg-background/80 backdrop-blur-md flex items-center justify-between px-4 select-none fixed top-0 left-0 right-0 z-50"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      data-tauri-drag-region
      onDoubleClick={handleDoubleClick}
    >
      {/* Left Area: macOS Traffic Light Window Controls */}
      <div className="flex items-center space-x-2 mr-4" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
        <button
          onClick={handleClose}
          className="group flex items-center justify-center w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] cursor-default focus:outline-none transition-all duration-150 active:brightness-90"
          title="Close"
        >
          <X className="w-1.5 h-1.5 opacity-0 group-hover:opacity-100 text-[#4c0002] stroke-[3]" />
        </button>
        <button
          onClick={handleMinimize}
          className="group flex items-center justify-center w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dfa223] cursor-default focus:outline-none transition-all duration-150 active:brightness-90"
          title="Minimize"
        >
          <Minimize2 className="w-1.5 h-1.5 opacity-0 group-hover:opacity-100 text-[#5c3e00] stroke-[3]" />
        </button>
        <button
          onClick={handleMaximize}
          className="group flex items-center justify-center w-3 h-3 rounded-full bg-[#27c93f] border border-[#1a9c2b] cursor-default focus:outline-none transition-all duration-150 active:brightness-90"
          title="Maximize"
        >
          <Maximize2 className="w-1.5 h-1.5 opacity-0 group-hover:opacity-100 text-[#006505] stroke-[3]" />
        </button>
      </div>

      {/* Middle Area: Title & Navigation Breadcrumbs */}
      <div className="flex-1 flex items-center justify-center text-xs font-semibold text-muted-foreground truncate">
        {projectName ? (
          <div className="flex items-center space-x-2" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
            {onBackToDashboard && (
              <button
                onClick={onBackToDashboard}
                className="flex items-center space-x-1 px-2 py-0.5 rounded hover:bg-accent hover:text-foreground text-muted-foreground transition-all border border-transparent hover:border-border duration-150"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Dashboard</span>
              </button>
            )}
            <span className="text-border">/</span>
            <span className="text-foreground font-bold tracking-tight bg-secondary/80 px-2 py-0.5 rounded border border-border">
              {projectName}
            </span>
          </div>
        ) : (
          <span className="text-foreground/90 font-heading text-sm tracking-wide">
            AI-PM Dashboard
          </span>
        )}
      </div>

      {/* Right Area: Empty spacer to balance layout */}
      <div className="w-16 flex items-center justify-end" />
    </div>
  );
}
