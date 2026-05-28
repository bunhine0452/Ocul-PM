import React from "react";
import { ChevronLeft, Sun, Moon, Monitor } from "./Icons";
import { useTheme } from "../lib/theme";
import { GitBranchChip } from "./GitBranchChip";

interface TitleBarProps {
  projectName?: string | null;
  projectId?: number | null;
  onBackToDashboard?: () => void;
}

/**
 * TitleBar — OS-native chrome 기반 (MASTER-GUIDE §6.2)
 *
 * - macOS: decorations=true + titleBarStyle=Overlay → 네이티브 traffic light 위에 콘텐츠 겹침
 *   좌측 80px 공백으로 traffic light 양보
 * - Windows/Linux: 네이티브 chrome 100%, 우리 TitleBar는 제목+breadcrumb만
 *
 * - JS startDragging 제거 → data-tauri-drag-region 표준 사용
 * - focus:outline-none 제거 → 접근성 유지
 */
export function TitleBar({ projectName, projectId, onBackToDashboard }: TitleBarProps) {
  const { theme, setTheme } = useTheme();
  const isMac = navigator.platform.toUpperCase().includes("MAC");

  const toggleTheme = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (theme === "light") setTheme("dark");
    else if (theme === "dark") setTheme("system");
    else setTheme("light");
  };

  return (
    <header
      data-tauri-drag-region
      className="h-11 shrink-0 border-b border-border bg-background/80 backdrop-blur-md flex items-center justify-between select-none z-50"
      style={{
        paddingLeft: isMac ? 80 : 16,
        paddingRight: isMac ? 16 : 12,
      }}
    >
      {/* Left Area: Navigation Breadcrumbs */}
      <div className="flex items-center space-x-2">
        {projectName ? (
          <div className="flex items-center space-x-2">
            {onBackToDashboard && (
              <button
                onClick={onBackToDashboard}
                className="flex items-center space-x-1 px-2 py-0.5 rounded hover:bg-accent hover:text-foreground text-muted-foreground transition-all border border-transparent hover:border-border duration-150"
                aria-label="대시보드로 돌아가기"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span className="text-xs font-semibold">대시보드</span>
              </button>
            )}
            <span className="text-border text-xs">/</span>
            <span className="text-foreground font-bold text-xs tracking-tight bg-secondary/80 px-2 py-0.5 rounded border border-border">
              {projectName}
            </span>
            {projectId != null && <GitBranchChip projectId={projectId} />}
          </div>
        ) : (
          <span className="text-foreground/90 font-heading text-sm tracking-wide">
            ai-pm
          </span>
        )}
      </div>

      {/* Right Area: Theme Toggle */}
      <div className="flex items-center">
        <button
          onClick={toggleTheme}
          className="p-1.5 rounded-lg border border-transparent hover:border-border hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-all duration-200 cursor-pointer flex items-center justify-center"
          title={`Theme: ${theme.charAt(0).toUpperCase() + theme.slice(1)}`}
          aria-label={`테마 전환: ${theme}`}
        >
          {theme === "light" && <Sun className="w-4 h-4" />}
          {theme === "dark" && <Moon className="w-4 h-4" />}
          {theme === "system" && <Monitor className="w-4 h-4" />}
        </button>
      </div>
    </header>
  );
}
