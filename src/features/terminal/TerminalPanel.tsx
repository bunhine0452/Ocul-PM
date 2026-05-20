import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { commands } from "@/lib/bindings";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import "xterm/css/xterm.css";
import { Terminal as TerminalIcon, Loader2, Play, Plus, X, Maximize2, Minimize2, ExternalLink } from "@/components/Icons";
import { Button } from "@/components/ui/button";

interface TerminalSessionData {
  id: string;
  name: string;
  projectRoot: string;
}

interface TerminalPanelProps {
  projectRoot: string | null;
  isPip: boolean;
  onTogglePip: () => void;
  activeTab: string;
  isDetachedWindow?: boolean;
}

export function TerminalPanel({ projectRoot, isPip, onTogglePip, activeTab, isDetachedWindow = false }: TerminalPanelProps) {
  // 1. Sessions State Management
  const [sessions, setSessions] = useState<TerminalSessionData[]>(() => {
    const saved = localStorage.getItem("terminalSessions");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.length > 0) return parsed;
      } catch (e) {
        console.warn("Failed to parse saved terminal sessions", e);
      }
    }
    return [];
  });

  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    return localStorage.getItem("terminalActiveSessionId") || "";
  });

  const [statusMap, setStatusMap] = useState<Record<string, "connecting" | "connected" | "disconnected" | "error">>({});

  // 2. Initialize default session if none exist
  useEffect(() => {
    if (sessions.length === 0) {
      const newId = Math.random().toString(36).substring(2, 10);
      const defaultSession = {
        id: newId,
        name: "Shell 1",
        projectRoot: projectRoot || "",
      };
      setSessions([defaultSession]);
      setActiveSessionId(newId);
    }
  }, [sessions, projectRoot]);

  // Sync session state changes
  useEffect(() => {
    if (sessions.length > 0) {
      localStorage.setItem("terminalSessions", JSON.stringify(sessions));
    }
  }, [sessions]);

  useEffect(() => {
    if (activeSessionId) {
      localStorage.setItem("terminalActiveSessionId", activeSessionId);
    }
  }, [activeSessionId]);

  // Update session projectRoot if it was created empty and a project is selected
  useEffect(() => {
    if (projectRoot && sessions.length === 1 && !sessions[0].projectRoot) {
      setSessions(prev => prev.map((s, idx) => idx === 0 ? { ...s, projectRoot } : s));
    }
  }, [projectRoot]);

  // 3. Floating Overlay Drag Management
  const [position, setPosition] = useState(() => {
    const savedX = localStorage.getItem("terminalPipX");
    const savedY = localStorage.getItem("terminalPipY");
    return {
      x: savedX ? parseInt(savedX, 10) : 24,
      y: savedY ? parseInt(savedY, 10) : 24,
    };
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const posStart = useRef({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isPip) return;
    const target = e.target as HTMLElement;
    // Don't drag if clicking buttons or tabs
    if (target.closest("button") || target.closest(".terminal-tab")) return;

    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    posStart.current = { ...position };
    e.preventDefault();
  };

  useEffect(() => {
    if (!isDragging || !isPip) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      
      const newX = Math.max(10, posStart.current.x - dx);
      const newY = Math.max(10, posStart.current.y - dy);
      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, isPip]);

  // Save float position
  useEffect(() => {
    localStorage.setItem("terminalPipX", String(position.x));
    localStorage.setItem("terminalPipY", String(position.y));
  }, [position]);

  // 4. Session Action Handlers
  const handleAddSession = () => {
    const newId = Math.random().toString(36).substring(2, 10);
    const numbers = sessions.map(s => {
      const match = s.name.match(/Shell (\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    });
    const nextNumber = Math.max(0, ...numbers) + 1;

    setSessions(prev => [
      ...prev,
      {
        id: newId,
        name: `Shell ${nextNumber}`,
        projectRoot: projectRoot || "",
      },
    ]);
    setActiveSessionId(newId);
  };

  const handleCloseSession = (e: React.MouseEvent, idToClose: string) => {
    e.stopPropagation();
    const index = sessions.findIndex(s => s.id === idToClose);
    if (index === -1) return;

    const newSessions = sessions.filter(s => s.id !== idToClose);
    setSessions(newSessions);

    // If we closed the active tab, switch to another tab
    if (activeSessionId === idToClose) {
      const nextActiveIndex = index === 0 ? 0 : index - 1;
      const nextActive = newSessions[nextActiveIndex];
      if (nextActive) {
        setActiveSessionId(nextActive.id);
      }
    }

    // Clean up status map
    setStatusMap(prev => {
      const next = { ...prev };
      delete next[idToClose];
      return next;
    });

    // If no sessions remain, the empty sessions useEffect will spawn a new one
  };

  const isVisible = isDetachedWindow || isPip || activeTab === "terminal";
  const activeStatus = statusMap[activeSessionId] || "connecting";

  const handleDetachWindow = async () => {
    try {
      if (isPip) {
        onTogglePip();
      }
      await commands.openTerminalWindow();
    } catch (e) {
      console.error("Failed to open terminal window:", e);
    }
  };

  return (
    <div
      className={
        isDetachedWindow
          ? "flex-1 h-full flex flex-col overflow-hidden bg-stone-950 font-sans"
          : isPip
          ? "absolute z-50 rounded-xl border border-stone-800 shadow-2xl bg-stone-950 flex flex-col overflow-hidden resize min-w-[380px] min-h-[220px] w-[600px] h-[360px] select-none text-stone-100 border-border"
          : isVisible
          ? "flex-1 h-full flex flex-col overflow-hidden bg-stone-950 font-sans"
          : "hidden"
      }
      style={isPip && !isDetachedWindow ? { bottom: `${position.y}px`, right: `${position.x}px` } : { width: "100%", height: "100%" }}
    >
      {/* Header bar */}
      <div
        onMouseDown={handleMouseDown}
        className={`h-12 border-b border-stone-900 flex items-center justify-between px-3 bg-stone-900/60 shrink-0 select-none ${
          isPip && !isDetachedWindow ? "cursor-grab active:cursor-grabbing" : "cursor-default"
        }`}
      >
        <div className="flex items-center space-x-2 overflow-hidden flex-1 mr-4">
          <TerminalIcon className="w-4 h-4 text-stone-400 shrink-0" />
          
          {/* Tab bar list */}
          <div className="flex items-center space-x-1.5 overflow-x-auto max-w-[85%] scrollbar-none py-1">
            {sessions.map(session => (
              <div
                key={session.id}
                onClick={() => setActiveSessionId(session.id)}
                className={`terminal-tab flex items-center px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer transition-colors max-w-[110px] shrink-0 ${
                  session.id === activeSessionId
                    ? "bg-stone-800 text-stone-100 border border-stone-700"
                    : "text-stone-400 hover:text-stone-200 hover:bg-stone-800/40"
                }`}
              >
                <span className="truncate">{session.name}</span>
                {sessions.length > 1 && (
                  <button
                    onClick={(e) => handleCloseSession(e, session.id)}
                    className="ml-2 hover:bg-stone-700 rounded-full p-0.5 text-stone-400 hover:text-stone-200 transition-colors"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Add session plus button */}
          <button
            onClick={handleAddSession}
            className="p-1 hover:bg-stone-800 rounded-md text-stone-400 hover:text-stone-200 cursor-pointer flex items-center justify-center shrink-0 transition-colors"
            title="새 터미널 추가"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Right side controls */}
        <div className="flex items-center space-x-2 shrink-0">
          <div className="flex items-center space-x-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                activeStatus === "connected"
                  ? "bg-emerald-500 animate-pulse"
                  : activeStatus === "connecting"
                  ? "bg-amber-500 animate-pulse"
                  : activeStatus === "disconnected"
                  ? "bg-stone-500"
                  : "bg-red-500"
              }`}
            />
            {(!isPip || isDetachedWindow) && (
              <span className="text-[11px] text-stone-400 font-medium select-none mr-2">
                {activeStatus === "connected"
                  ? "연결됨"
                  : activeStatus === "connecting"
                  ? "연결 중..."
                  : activeStatus === "disconnected"
                  ? "종료됨"
                  : "오류"}
              </span>
            )}
          </div>

          {!isDetachedWindow && (
            <button
              onClick={handleDetachWindow}
              className="p-1.5 hover:bg-stone-800 rounded-md text-stone-400 hover:text-stone-200 cursor-pointer flex items-center justify-center transition-colors"
              title="새 창으로 분리 (창 밖으로 이동)"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}

          {!isDetachedWindow && (
            <button
              onClick={onTogglePip}
              className="p-1.5 hover:bg-stone-800 rounded-md text-stone-400 hover:text-stone-200 cursor-pointer flex items-center justify-center transition-colors"
              title={isPip ? "도킹 모드" : "PiP 모드 (화면 분할)"}
            >
              {isPip ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Sessions Container */}
      <div className="flex-1 min-h-0 relative bg-stone-950">
        {sessions.map(session => (
          <div
            key={session.id}
            className={session.id === activeSessionId ? "w-full h-full flex flex-col" : "hidden"}
          >
            <TerminalInstance
              sessionId={session.id}
              projectRoot={session.projectRoot}
              isPip={isPip}
              visible={session.id === activeSessionId && isVisible}
              onStatusChange={(status) => {
                setStatusMap(prev => ({ ...prev, [session.id]: status }));
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// 5. Terminal Instance Child Component
interface TerminalInstanceProps {
  sessionId: string;
  projectRoot: string;
  visible: boolean;
  isPip: boolean;
  onStatusChange: (status: "connecting" | "connected" | "disconnected" | "error") => void;
}

function TerminalInstance({ sessionId, projectRoot, visible, isPip, onStatusChange }: TerminalInstanceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected" | "error">("connecting");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [restartKey, setRestartKey] = useState(0);

  // Notify parent of status changes
  useEffect(() => {
    onStatusChange(status);
  }, [status]);

  useEffect(() => {
    let isMounted = true;

    const term = new Terminal({
      theme: {
        background: "#0c0a09", // stone-950
        foreground: "#f5f5f4", // stone-100
        cursor: "#f5f5f4",
        selectionBackground: "rgba(255, 255, 255, 0.15)",
        black: "#0c0a09",
        red: "#ef4444",
        green: "#22c55e",
        yellow: "#eab308",
        blue: "#3b82f6",
        magenta: "#d946ef",
        cyan: "#06b6d4",
        white: "#f5f5f4",
        brightBlack: "#78716c",
        brightRed: "#f87171",
        brightGreen: "#4ade80",
        brightYellow: "#facc15",
        brightBlue: "#60a5fa",
        brightMagenta: "#f472b6",
        brightCyan: "#22d3ee",
        brightWhite: "#ffffff",
      },
      cursorBlink: true,
      fontFamily: "JetBrains Mono, Fira Code, Menlo, Monaco, Consolas, monospace",
      fontSize: 12.5,
      allowProposedApi: true,
    });
    termRef.current = term;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);

    if (containerRef.current) {
      term.open(containerRef.current);
      setTimeout(() => {
        if (!isMounted) return;
        try {
          fitAddon.fit();
        } catch (e) {
          console.warn("Failed to fit terminal on init", e);
        }
      }, 50);
    }

    let unlistenData: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;
    let isTermDataHandlerAdded = false;

    async function initPty() {
      try {
        if (!isMounted) return;
        setStatus("connecting");

        unlistenData = await listen<string>(`pty-data-${sessionId}`, (event) => {
          if (isMounted) {
            term.write(event.payload);
          }
        });

        unlistenExit = await listen<void>(`pty-exit-${sessionId}`, () => {
          if (isMounted) {
            setStatus("disconnected");
            term.write("\r\n\r\n[프로세스가 종료되었습니다. 재시작하려면 우측 상단의 재시작 버튼을 누르세요.]\r\n");
          }
        });

        setTimeout(async () => {
          if (!isMounted) return;
          try {
            const startRes = await commands.startPtySession(sessionId, projectRoot, term.rows, term.cols);
            if (startRes.status === "error") {
              throw new Error(startRes.error);
            }
            if (isMounted) {
              setStatus("connected");
              if (!isTermDataHandlerAdded) {
                term.onData((data) => {
                  commands.writeToPty(sessionId, data);
                });
                isTermDataHandlerAdded = true;
              }
            }
          } catch (err: any) {
            console.error("PTY 시작 실패:", err);
            if (isMounted) {
              setStatus("error");
              setErrorMsg(err.message || "터미널 세션을 시작할 수 없습니다.");
            }
          }
        }, 100);

      } catch (err: any) {
        console.error("PTY 리스너 등록 실패:", err);
        if (isMounted) {
          setStatus("error");
          setErrorMsg(err.message || "이벤트 채널을 개설할 수 없습니다.");
        }
      }
    }

    initPty();

    const handleResize = () => {
      if (fitAddonRef.current && termRef.current && status === "connected" && visible) {
        try {
          fitAddonRef.current.fit();
          commands.resizePty(sessionId, termRef.current.rows, termRef.current.cols);
        } catch (e) {
          console.warn("Resize fit failed", e);
        }
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      isMounted = false;
      window.removeEventListener("resize", handleResize);
      if (unlistenData) unlistenData();
      if (unlistenExit) unlistenExit();
      commands.killPtySession(sessionId);
      term.dispose();
    };
  }, [projectRoot, restartKey, sessionId]);

  // Fit terminal when visibility or isPip changes
  useEffect(() => {
    if (visible && fitAddonRef.current && termRef.current) {
      setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
          const r = termRef.current?.rows || 24;
          const c = termRef.current?.cols || 80;
          commands.resizePty(sessionId, r, c);
        } catch (e) {
          console.warn("Visibility change fit failed", e);
        }
      }, 100);
    }
  }, [visible, isPip]);

  return (
    <div className="w-full h-full relative p-3 bg-stone-950 flex flex-col min-h-0 select-text">
      {status === "connecting" && (
        <div className="absolute inset-0 bg-stone-950/80 backdrop-blur-xs flex flex-col items-center justify-center space-y-2 z-10 select-none">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <span className="text-sm text-stone-400 font-medium">터미널 세션을 시작하는 중...</span>
        </div>
      )}

      {status === "error" && errorMsg && (
        <div className="absolute inset-0 bg-stone-950/90 flex flex-col items-center justify-center p-6 space-y-4 z-10 text-center select-none">
          <span className="text-red-500 text-sm font-semibold">터미널 시작 오류</span>
          <p className="text-xs text-stone-400 max-w-md font-mono bg-stone-900 p-3 rounded border border-stone-800">
            {errorMsg}
          </p>
          <Button
            onClick={() => setRestartKey(k => k + 1)}
            className="px-4 py-2 bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-700 rounded-lg text-xs cursor-pointer"
          >
            다시 시도
          </Button>
        </div>
      )}

      {status === "disconnected" && (
        <div className="absolute top-3 right-3 z-10 flex items-center bg-stone-900/90 border border-stone-800 rounded-lg px-2.5 py-1 select-none shadow-lg backdrop-blur-xs">
          <span className="text-[11px] text-stone-400 mr-2">세션 종료됨</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRestartKey(k => k + 1)}
            className="h-6 px-2 rounded bg-stone-800 hover:bg-stone-700 border-stone-700 text-[10px] text-stone-200 flex items-center cursor-pointer font-sans"
          >
            <Play className="w-2.5 h-2.5 mr-1 text-emerald-500 fill-emerald-500" />
            재시작
          </Button>
        </div>
      )}

      <div ref={containerRef} className="w-full h-full text-left flex-1 min-h-0" />
    </div>
  );
}
