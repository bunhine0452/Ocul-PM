import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { commands } from "@/lib/bindings";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import "xterm/css/xterm.css";
import { Terminal as TerminalIcon, Loader2, Play } from "@/components/Icons";
import { Button } from "@/components/ui/button";

interface TerminalPanelProps {
  projectRoot: string | null;
}

export function TerminalPanel({ projectRoot }: TerminalPanelProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected" | "error">("connecting");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [restartKey, setRestartKey] = useState(0);

  useEffect(() => {
    if (!projectRoot) {
      setStatus("error");
      setErrorMsg("선택된 프로젝트가 없거나 경로가 유효하지 않습니다.");
      return;
    }

    const sessionId = Math.random().toString(36).substring(2, 10);

    let cols = 80;
    let rows = 24;

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
      fontSize: 13,
      allowProposedApi: true,
    });
    xtermRef.current = term;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);

    if (terminalRef.current) {
      term.open(terminalRef.current);
      // Wait a microtask to let the browser compute layout dimensions
      setTimeout(() => {
        try {
          fitAddon.fit();
          cols = term.cols;
          rows = term.rows;
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
        setStatus("connecting");

        unlistenData = await listen<string>(`pty-data-${sessionId}`, (event) => {
          term.write(event.payload);
        });

        unlistenExit = await listen<void>(`pty-exit-${sessionId}`, () => {
          setStatus("disconnected");
          term.write("\r\n\r\n[프로세스가 종료되었습니다. 재시작하려면 상단의 재생 버튼을 누르세요.]\r\n");
        });

        // Use custom setTimeout to delay startPtySession just slightly to let xterm fit completes
        setTimeout(async () => {
          try {
            const startRes = await commands.startPtySession(sessionId, projectRoot, term.rows, term.cols);
            if (startRes.status === "error") {
              throw new Error(startRes.error);
            }
            setStatus("connected");

            if (!isTermDataHandlerAdded) {
              term.onData((data) => {
                commands.writeToPty(sessionId, data);
              });
              isTermDataHandlerAdded = true;
            }
          } catch (err: any) {
            console.error("PTY 시작 실패:", err);
            setStatus("error");
            setErrorMsg(err.message || "터미널 세션을 시작할 수 없습니다.");
          }
        }, 100);

      } catch (err: any) {
        console.error("PTY 리스너 등록 실패:", err);
        setStatus("error");
        setErrorMsg(err.message || "이벤트 채널을 개설할 수 없습니다.");
      }
    }

    initPty();

    const handleResize = () => {
      if (fitAddonRef.current && xtermRef.current && status === "connected") {
        try {
          fitAddonRef.current.fit();
          const r = xtermRef.current.rows;
          const c = xtermRef.current.cols;
          commands.resizePty(sessionId, r, c);
        } catch (e) {
          console.warn("Resize fit failed", e);
        }
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (unlistenData) unlistenData();
      if (unlistenExit) unlistenExit();
      commands.killPtySession(sessionId);
      term.dispose();
    };
  }, [projectRoot, restartKey]);

  return (
    <div className="w-full h-full flex flex-col bg-stone-950 overflow-hidden select-text text-stone-100">
      {/* Header bar */}
      <div className="h-12 border-b border-stone-900 flex items-center justify-between px-4 bg-stone-900/60 shrink-0 select-none">
        <div className="flex items-center space-x-2">
          <TerminalIcon className="w-4 h-4 text-stone-400" />
          <span className="text-sm font-bold text-stone-200">로컬 터미널 (Local Shell)</span>
          <span className="text-xs text-stone-400 bg-stone-900 px-2 py-0.5 rounded font-mono truncate max-w-xs sm:max-w-md">
            {projectRoot}
          </span>
        </div>
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5">
            <span className={`w-2 h-2 rounded-full ${
              status === "connected" ? "bg-emerald-500 animate-pulse" :
              status === "connecting" ? "bg-amber-500 animate-pulse" :
              status === "disconnected" ? "bg-stone-500" : "bg-red-500"
            }`} />
            <span className="text-xs text-stone-400 font-medium">
              {status === "connected" ? "연결됨" :
               status === "connecting" ? "연결 중..." :
               status === "disconnected" ? "종료됨" : "오류"}
            </span>
          </div>

          {(status === "disconnected" || status === "error") && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRestartKey(k => k + 1)}
              className="h-7 px-2.5 rounded-lg border-stone-700 bg-stone-800 hover:bg-stone-700 text-xs text-stone-200 flex items-center cursor-pointer"
            >
              <Play className="w-3 h-3 mr-1" />
              재시작
            </Button>
          )}
        </div>
      </div>

      {/* Terminal View Area */}
      <div className="flex-1 min-h-0 relative p-3 overflow-hidden bg-stone-950">
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

        <div ref={terminalRef} className="w-full h-full text-left" />
      </div>
    </div>
  );
}
