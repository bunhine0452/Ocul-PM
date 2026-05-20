import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { commands } from "../lib/bindings";
import { Save, Check, Loader2, X, FileCode } from "./Icons";
import { useSettings } from "@/contexts/SettingsContext";

import hljs from "highlight.js";

interface CodeEditorProps {
  projectId: number;
  filePath: string;
  initialScrollLine?: number | null;
  onClose: () => void;
}

const PAD_Y = 16;

const LANGUAGE_LABELS: Record<string, string> = {
  rs: "Rust",
  ts: "TypeScript",
  tsx: "TSX",
  js: "JavaScript",
  jsx: "JSX",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  go: "Go",
  java: "Java",
  kt: "Kotlin",
  kts: "Kotlin",
  swift: "Swift",
  rb: "Ruby",
  php: "PHP",
  cs: "C#",
  c: "C",
  h: "C Header",
  cpp: "C++",
  cc: "C++",
  cxx: "C++",
  hpp: "C++ Header",
  json: "JSON",
  md: "Markdown",
  mdx: "MDX",
  html: "HTML",
  css: "CSS",
  scss: "SCSS",
  sass: "Sass",
  sql: "SQL",
  sh: "Shell",
  bash: "Bash",
  zsh: "Zsh",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
};

const VALID_HLJS_LANGS = new Set([
  "js", "jsx", "ts", "tsx", "rs", "json", "md", "html", "css",
  "py", "go", "sql", "sh", "yaml", "yml", "java", "kotlin", "swift",
  "ruby", "php", "csharp", "c", "cpp", "bash",
]);

const HLJS_ALIASES: Record<string, string> = {
  kt: "kotlin",
  kts: "kotlin",
  rb: "ruby",
  cs: "csharp",
  h: "c",
  hpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  mjs: "js",
  cjs: "js",
};

export function CodeEditor({ projectId, filePath, initialScrollLine, onClose }: CodeEditorProps) {
  const [content, setContent] = useState("");
  const [editContent, setEditContent] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showSavedToast, setShowSavedToast] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorCol, setCursorCol] = useState(1);
  const [scrollTop, setScrollTop] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const highlightPreRef = useRef<HTMLPreElement>(null);
  const indentGuidesRef = useRef<HTMLDivElement>(null);

  const { settings } = useSettings();
  const CODE_FONT_SIZE = settings.editorFontSize;
  const GUTTER_FONT_SIZE = Math.max(10, settings.editorFontSize - 2);
  const LINE_HEIGHT = Math.round(settings.editorFontSize * 1.7);
  const editorFontStack = useMemo(() => {
    const fam = settings.editorFontFamily?.trim();
    return fam
      ? `'${fam}', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`
      : "var(--editor-font)";
  }, [settings.editorFontFamily]);
  const tabIndent = useMemo(
    () => " ".repeat(Math.max(1, Math.min(8, settings.editorTabWidth))),
    [settings.editorTabWidth]
  );

  const fileName = useMemo(() => filePath.split("/").pop() || filePath, [filePath]);
  const fileDir = useMemo(() => {
    const parts = filePath.split("/");
    parts.pop();
    return parts.join("/");
  }, [filePath]);

  const fileExt = useMemo(() => (fileName.split(".").pop() || "").toLowerCase(), [fileName]);

  const languageLabel = useMemo(
    () => LANGUAGE_LABELS[fileExt] || (fileExt ? fileExt.toUpperCase() : "Plain Text"),
    [fileExt]
  );

  const handleScroll = useCallback((e: React.UIEvent<HTMLTextAreaElement>) => {
    const top = e.currentTarget.scrollTop;
    const left = e.currentTarget.scrollLeft;
    setScrollTop(top);
    if (gutterRef.current) gutterRef.current.scrollTop = top;
    if (highlightPreRef.current) {
      highlightPreRef.current.scrollTop = top;
      highlightPreRef.current.scrollLeft = left;
    }
    if (indentGuidesRef.current) {
      indentGuidesRef.current.scrollTop = top;
      indentGuidesRef.current.scrollLeft = left;
    }
  }, []);

  const updateCursor = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const before = ta.value.substring(0, pos);
    const newlineIdx = before.lastIndexOf("\n");
    const line = (before.match(/\n/g) || []).length + 1;
    const col = pos - (newlineIdx + 1) + 1;
    setCursorLine(line);
    setCursorCol(col);
  }, []);

  useEffect(() => {
    let active = true;
    const fetchContent = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await commands.readProjectFile(projectId, filePath);
        if (active) {
          if (res.status === "ok") {
            setContent(res.data);
            setEditContent(res.data);
            setCursorLine(1);
            setCursorCol(1);
          } else {
            setError(res.error);
          }
        }
      } catch (err: any) {
        if (active) setError(err.toString());
      } finally {
        if (active) setIsLoading(false);
      }
    };

    fetchContent();
    return () => {
      active = false;
    };
  }, [projectId, filePath]);

  const highlightedCode = useMemo(() => {
    if (!editContent) return "";
    const lang = HLJS_ALIASES[fileExt] || fileExt;
    try {
      if (VALID_HLJS_LANGS.has(lang)) {
        return hljs.highlight(editContent, { language: lang }).value;
      }
      return hljs.highlightAuto(editContent).value;
    } catch (e) {
      return editContent
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }
  }, [editContent, fileExt]);

  const lineCount = useMemo(() => editContent.split("\n").length, [editContent]);
  const byteSize = useMemo(() => new Blob([editContent]).size, [editContent]);

  const rawLines = useMemo(() => editContent.split("\n"), [editContent]);

  const indentGuides = useMemo(() => {
    return rawLines.map((line, index) => {
      let leadingSpaces = 0;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === " ") {
          leadingSpaces++;
        } else if (char === "\t") {
          leadingSpaces += settings.editorTabWidth;
        } else {
          break;
        }
      }

      const indentLevel = Math.floor(leadingSpaces / settings.editorTabWidth);
      if (indentLevel <= 0) {
        return (
          <div
            key={index}
            style={{ height: LINE_HEIGHT }}
            className="w-full relative shrink-0"
          />
        );
      }

      const guides = [];
      for (let i = 0; i < indentLevel; i++) {
        guides.push(
          <div
            key={i}
            className="absolute top-0 bottom-0 border-l"
            style={{
              left: `${i * settings.editorTabWidth}ch`,
              borderColor: "var(--editor-indent-guide)",
            }}
          />
        );
      }

      return (
        <div
          key={index}
          style={{ height: LINE_HEIGHT }}
          className="w-full relative shrink-0"
        >
          {guides}
        </div>
      );
    });
  }, [rawLines, settings.editorTabWidth, LINE_HEIGHT]);

  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      const res = await commands.writeProjectFile(projectId, filePath, editContent);
      if (res.status === "ok") {
        setContent(editContent);
        setIsSaving(false);
        setShowSavedToast(true);
        setTimeout(() => setShowSavedToast(false), 2000);
      } else {
        setError(res.error);
        setIsSaving(false);
      }
    } catch (err: any) {
      setError(err.toString());
      setIsSaving(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        e.stopPropagation();
        handleSave();
      }
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editContent, isSaving]);

  const handleTabPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const val = textarea.value;
      const indent = tabIndent;
      const newVal = val.substring(0, start) + indent + val.substring(end);
      setEditContent(newVal);

      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + indent.length;
        updateCursor();
      }, 0);
    }
  };

  useEffect(() => {
    if (!isLoading && initialScrollLine !== undefined && initialScrollLine !== null && textareaRef.current) {
      const lineIndex = Math.max(0, initialScrollLine - 1);
      const targetScrollTop = lineIndex * LINE_HEIGHT;

      const timer = setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.scrollTop = targetScrollTop;
          setScrollTop(targetScrollTop);
          if (highlightPreRef.current && gutterRef.current) {
            highlightPreRef.current.scrollTop = targetScrollTop;
            gutterRef.current.scrollTop = targetScrollTop;
          }
          setCursorLine(initialScrollLine);
          setCursorCol(1);
        }
      }, 50);

      return () => clearTimeout(timer);
    }
  }, [isLoading, initialScrollLine, filePath]);

  const isDirty = content !== editContent;

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-background text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin mb-3 text-primary" />
        <span className="text-sm">Reading file content...</span>
      </div>
    );
  }

  const gutterWidth = Math.max(48, String(lineCount).length * 9 + 24);
  const activeLineTop = (cursorLine - 1) * LINE_HEIGHT + PAD_Y - scrollTop;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden relative editor-surface">
      {/* Tab-style file header */}
      <div className="editor-tab-bar h-9 flex items-stretch select-none">
        <div className="flex items-center gap-2 h-full px-3 border-r border-[color:var(--editor-rule)] bg-[color:var(--editor-bg)] min-w-0 max-w-md">
          <FileCode className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          <span
            className="text-xs font-medium text-foreground truncate"
            style={{ fontFamily: editorFontStack }}
            title={filePath}
          >
            {fileName}
          </span>
          {isDirty && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0"
              title="Unsaved changes"
            />
          )}
        </div>

        <div className="flex items-center gap-2 px-3 text-[11px] text-muted-foreground min-w-0 flex-1">
          {fileDir && (
            <span className="truncate font-mono" title={filePath} style={{ fontFamily: editorFontStack }}>
              {fileDir}/
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 pr-2 pl-3 border-l border-[color:var(--editor-rule)]">
          <button
            onClick={handleSave}
            disabled={isSaving || !isDirty}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:brightness-105 active:brightness-95 cursor-pointer shadow-sm"
          >
            {isSaving ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Save className="w-3 h-3" />
            )}
            <span>Save</span>
          </button>

          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-all cursor-pointer"
            title="Close file"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-3 py-1.5 bg-destructive/10 border-b border-destructive/20 text-destructive text-xs font-medium flex items-center justify-between">
          <span>Error: {error}</span>
          <button onClick={() => setError(null)} className="font-bold hover:opacity-80 px-1">×</button>
        </div>
      )}

      {/* Editor body */}
      <div className="flex-1 flex overflow-hidden relative editor-surface">
        {/* Gutter — per-line divs so we can highlight the active line */}
        {settings.editorShowLineNumbers && (
          <div
            ref={gutterRef}
            className="editor-gutter overflow-hidden flex-shrink-0"
            style={{
              width: gutterWidth,
              minWidth: gutterWidth,
              paddingTop: PAD_Y,
              paddingBottom: PAD_Y,
              fontSize: GUTTER_FONT_SIZE,
              lineHeight: `${LINE_HEIGHT}px`,
              fontFamily: editorFontStack,
            }}
          >
            {Array.from({ length: lineCount }, (_, i) => {
              const ln = i + 1;
              const isActive = ln === cursorLine;
              return (
                <div
                  key={ln}
                  className="text-right tabular-nums pr-3 pl-2"
                  style={{
                    height: LINE_HEIGHT,
                    lineHeight: `${LINE_HEIGHT}px`,
                    color: isActive ? "var(--editor-gutter-active-fg)" : undefined,
                    fontWeight: isActive ? 600 : 400,
                  }}
                >
                  {ln}
                </div>
              );
            })}
          </div>
        )}

        {/* Code area */}
        <div className="flex-1 relative overflow-hidden h-full">
          {/* Active line highlight band — scroll-adjusted */}
          {settings.editorActiveLineHighlight && cursorLine >= 1 && activeLineTop > -LINE_HEIGHT && (
            <div
              className="editor-active-line"
              style={{
                top: activeLineTop,
                height: LINE_HEIGHT,
              }}
            />
          )}

          {/* Indent Guides Layer */}
          {settings.editorIndentGuides && (
            <div
              ref={indentGuidesRef}
              className="absolute inset-0 pointer-events-none overflow-hidden"
              style={{
                fontSize: CODE_FONT_SIZE,
                lineHeight: `${LINE_HEIGHT}px`,
                fontFamily: editorFontStack,
                padding: `${PAD_Y}px 16px`,
                margin: 0,
                border: 0,
                boxSizing: "border-box",
                width: "100%",
                height: "100%",
                background: "transparent",
              }}
            >
              {indentGuides}
            </div>
          )}

          {/* Underlay: syntax-highlighted pre */}
          <pre
            ref={highlightPreRef}
            className={`absolute inset-0 pointer-events-none overflow-hidden bg-transparent ${
              settings.editorWordWrap ? "whitespace-pre-wrap" : "whitespace-pre"
            }`}
            style={{
              fontSize: CODE_FONT_SIZE,
              lineHeight: `${LINE_HEIGHT}px`,
              fontFamily: editorFontStack,
              padding: `${PAD_Y}px 16px`,
              margin: 0,
              border: 0,
              boxSizing: "border-box",
              width: "100%",
              height: "100%",
              background: "transparent",
              tabSize: settings.editorTabWidth,
            }}
          >
            <code
              className={`hljs block bg-transparent ${
                settings.editorWordWrap ? "whitespace-pre-wrap" : "whitespace-pre"
              }`}
              style={{
                fontSize: CODE_FONT_SIZE,
                lineHeight: `${LINE_HEIGHT}px`,
                fontFamily: editorFontStack,
                padding: 0,
                margin: 0,
                border: 0,
                background: "transparent",
              }}
              dangerouslySetInnerHTML={{ __html: highlightedCode }}
            />
          </pre>

          {/* Overlay: editable textarea */}
          <textarea
            ref={textareaRef}
            value={editContent}
            onChange={(e) => {
              setEditContent(e.target.value);
            }}
            onKeyDown={handleTabPress}
            onKeyUp={updateCursor}
            onClick={updateCursor}
            onSelect={updateCursor}
            onFocus={updateCursor}
            onScroll={handleScroll}
            className={`absolute inset-0 bg-transparent focus:ring-0 overflow-auto resize-none outline-none code-editor-textarea text-transparent selection:bg-primary/25 border-0 ${
              settings.editorWordWrap ? "whitespace-pre-wrap" : "whitespace-pre"
            }`}
            style={{
              fontSize: CODE_FONT_SIZE,
              lineHeight: `${LINE_HEIGHT}px`,
              fontFamily: editorFontStack,
              padding: `${PAD_Y}px 16px`,
              margin: 0,
              boxSizing: "border-box",
              width: "100%",
              height: "100%",
              background: "transparent",
              tabSize: settings.editorTabWidth,
            }}
            placeholder="Type code here..."
            spellCheck={false}
          />
        </div>
      </div>

      {/* Status bar */}
      <div
        className="editor-statusbar h-6 flex items-center justify-between text-[11px] select-none px-3 gap-4"
        style={{ fontFamily: editorFontStack }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex items-center gap-1.5">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: "var(--editor-statusbar-accent)" }}
            />
            <span className="font-medium">{languageLabel}</span>
          </span>
          <span className="opacity-30">·</span>
          <span>UTF-8</span>
          <span className="opacity-30">·</span>
          <span>LF</span>
          <span className="opacity-30">·</span>
          <span className="tabular-nums">{lineCount.toLocaleString()} lines</span>
          {byteSize > 0 && (
            <>
              <span className="opacity-30">·</span>
              <span className="tabular-nums">{formatBytes(byteSize)}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          {isDirty && (
            <>
              <span className="text-[color:var(--editor-statusbar-accent)] font-medium">● Modified</span>
              <span className="opacity-30">·</span>
            </>
          )}
          <span className="tabular-nums">
            Ln <span className="font-semibold text-foreground">{cursorLine}</span>, Col{" "}
            <span className="font-semibold text-foreground">{cursorCol}</span>
          </span>
          <span className="opacity-30">·</span>
          <span>Spaces: 2</span>
        </div>
      </div>

      {/* Save Toast */}
      {showSavedToast && (
        <div className="absolute bottom-9 right-4 bg-[color:var(--editor-statusbar-accent)] text-white px-3 py-2 rounded-lg text-xs font-semibold flex items-center space-x-2 shadow-lg animate-fade-in-up">
          <Check className="w-4 h-4" />
          <span>File saved (⌘S)</span>
        </div>
      )}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
