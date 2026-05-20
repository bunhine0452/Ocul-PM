import React, { useState, useEffect, useMemo, useRef } from "react";
import { commands } from "../lib/bindings";
import { Save, Check, Loader2, X } from "./Icons";

import hljs from "highlight.js";

interface CodeEditorProps {
  projectId: number;
  filePath: string;
  initialScrollLine?: number | null;
  onClose: () => void;
}

export function CodeEditor({ projectId, filePath, initialScrollLine, onClose }: CodeEditorProps) {
  const [content, setContent] = useState("");
  const [editContent, setEditContent] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showSavedToast, setShowSavedToast] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLPreElement>(null);
  const highlightPreRef = useRef<HTMLPreElement>(null);

  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    const scrollTop = e.currentTarget.scrollTop;
    const scrollLeft = e.currentTarget.scrollLeft;

    if (gutterRef.current) {
      gutterRef.current.scrollTop = scrollTop;
    }
    if (highlightPreRef.current) {
      highlightPreRef.current.scrollTop = scrollTop;
      highlightPreRef.current.scrollLeft = scrollLeft;
    }
  };

  // Fetch file content on load or path change
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

  // Highlight code on the fly for Edit Mode (real-time overlay)
  const highlightedCode = useMemo(() => {
    if (!editContent) return "";
    const ext = filePath.split(".").pop() || "";
    const validLanguages = ["js", "jsx", "ts", "tsx", "rs", "json", "md", "html", "css", "py", "go", "sql", "sh", "yaml", "yml"];
    const lang = validLanguages.includes(ext) ? ext : undefined;

    try {
      if (lang) {
        return hljs.highlight(editContent, { language: lang }).value;
      }
      return hljs.highlightAuto(editContent).value;
    } catch (e) {
      // Fallback: escape basic HTML characters
      return editContent
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }
  }, [editContent, filePath]);

  // Compute line numbers
  const lineCount = useMemo(() => {
    return editContent.split("\n").length;
  }, [editContent]);

  const lineNumbers = useMemo(() => {
    return Array.from({ length: lineCount }, (_, i) => i + 1).join("\n");
  }, [lineCount]);

  // Handle file saving
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

  // Bind Ctrl+S / Cmd+S
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
  }, [editContent, isSaving]);

  // Handle Tab key in Textarea (insert 2 spaces instead of shifting focus)
  const handleTabPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const val = textarea.value;

      // Insert 2 spaces for tab
      const newVal = val.substring(0, start) + "  " + val.substring(end);
      setEditContent(newVal);

      // Reset selection coordinates
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      }, 0);
    }
  };

  // Scroll to initial line once loading is finished
  useEffect(() => {
    if (!isLoading && initialScrollLine !== undefined && initialScrollLine !== null && textareaRef.current) {
      const lineIndex = Math.max(0, initialScrollLine - 1);
      const targetScrollTop = lineIndex * 22; // 22px precise line height

      const timer = setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.scrollTop = targetScrollTop;
          if (highlightPreRef.current && gutterRef.current) {
            highlightPreRef.current.scrollTop = targetScrollTop;
            gutterRef.current.scrollTop = targetScrollTop;
          }
        }
      }, 50);

      return () => clearTimeout(timer);
    }
  }, [isLoading, initialScrollLine, filePath]);

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-background text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin mb-3 text-primary" />
        <span className="text-sm">Reading file content...</span>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-[#faf9f5] dark:bg-[#181715] overflow-hidden relative">
      {/* Editor Controls Bar */}
      <div className="h-10 border-b border-border flex items-center justify-between px-4 bg-secondary/40 select-none">
        <div className="flex items-center space-x-2 truncate mr-4">
          <span className="text-xs font-semibold font-mono text-muted-foreground truncate">
            {filePath}
          </span>
          {content !== editContent && (
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" title="Unsaved changes" />
          )}
        </div>

        <div className="flex items-center space-x-2">
          {/* Save Button */}
          <button
            onClick={handleSave}
            disabled={isSaving || content === editContent}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground disabled:opacity-50 transition-all hover:brightness-105 active:brightness-95 cursor-pointer shadow-sm"
          >
            {isSaving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            <span>Save</span>
          </button>

          {/* Close File button */}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-accent/80 text-muted-foreground hover:text-foreground transition-all cursor-pointer border border-transparent hover:border-border"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Editor Error Message */}
      {error && (
        <div className="p-3 bg-destructive/10 border-b border-destructive/20 text-destructive text-xs font-medium flex items-center justify-between">
          <span>Error: {error}</span>
          <button onClick={() => setError(null)} className="font-bold hover:opacity-80">×</button>
        </div>
      )}

      {/* Workspace Text Editor */}
      <div 
        className="flex-1 flex overflow-hidden relative bg-[#faf9f5] dark:bg-[#181715]" 
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        }}
      >
        {/* Line Numbers gutter */}
        <pre
          ref={gutterRef}
          className="select-none text-right bg-transparent text-muted-foreground/30 border-r border-border/40 overflow-hidden"
          style={{
            fontSize: "11px",
            lineHeight: "22px",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            paddingTop: "16px",
            paddingBottom: "16px",
            paddingLeft: "12px",
            paddingRight: "8px",
            margin: 0,
            borderTop: 0,
            borderBottom: 0,
            borderLeft: 0,
            boxSizing: "border-box",
            height: "100%",
            minWidth: "40px",
          }}
        >
          {lineNumbers}
        </pre>

        {/* Textarea & Code Overlay area */}
        <div className="flex-1 relative overflow-hidden h-full">
          {/* Underlay: Syntax Highlighted representation */}
          <pre
            ref={highlightPreRef}
            className="absolute inset-0 pointer-events-none overflow-hidden whitespace-pre bg-transparent"
            style={{
              fontSize: "13px",
              lineHeight: "22px",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              padding: "16px",
              margin: 0,
              border: 0,
              boxSizing: "border-box",
              width: "100%",
              height: "100%",
              background: "transparent",
            }}
          >
            <code
              className="hljs block whitespace-pre bg-transparent"
              style={{
                fontSize: "13px",
                lineHeight: "22px",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                padding: 0,
                margin: 0,
                border: 0,
                background: "transparent",
              }}
              dangerouslySetInnerHTML={{ __html: highlightedCode }}
            />
          </pre>

          {/* Overlay: Actual editable textarea */}
          <textarea
            ref={textareaRef}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            onKeyDown={handleTabPress}
            onScroll={handleScroll}
            className="absolute inset-0 bg-transparent focus:ring-0 overflow-auto resize-none outline-none whitespace-pre code-editor-textarea text-transparent selection:bg-primary/25 border-0"
            style={{
              fontSize: "13px",
              lineHeight: "22px",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              padding: "16px",
              margin: 0,
              boxSizing: "border-box",
              width: "100%",
              height: "100%",
              background: "transparent",
            }}
            placeholder="Type code here..."
            spellCheck={false}
          />
        </div>
      </div>

      {/* Save Success Toast overlay */}
      {showSavedToast && (
        <div className="absolute bottom-4 right-4 bg-emerald-600 text-white px-3 py-2 rounded-xl text-xs font-semibold flex items-center space-x-2 shadow-lg animate-fade-in-up">
          <Check className="w-4 h-4" />
          <span>File saved successfully! (Cmd+S)</span>
        </div>
      )}
    </div>
  );
}
