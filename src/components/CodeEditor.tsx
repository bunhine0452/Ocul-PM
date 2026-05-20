import React, { useState, useEffect, useMemo, useRef } from "react";
import { commands } from "../lib/bindings";
import { Save, Edit3, Eye, Check, Loader2, X } from "lucide-react";
import hljs from "highlight.js";

interface CodeEditorProps {
  projectId: number;
  filePath: string;
  onClose: () => void;
}

export function CodeEditor({ projectId, filePath, onClose }: CodeEditorProps) {
  const [content, setContent] = useState("");
  const [editContent, setEditContent] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showSavedToast, setShowSavedToast] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  // Highlight code for View Mode
  const highlightedCode = useMemo(() => {
    if (!content) return "";
    const ext = filePath.split(".").pop() || "";
    const validLanguages = ["js", "jsx", "ts", "tsx", "rs", "json", "md", "html", "css", "py", "go", "sql", "sh", "yaml", "yml"];
    const lang = validLanguages.includes(ext) ? ext : undefined;

    try {
      if (lang) {
        return hljs.highlight(content, { language: lang }).value;
      }
      return hljs.highlightAuto(content).value;
    } catch (e) {
      return content;
    }
  }, [content, filePath]);

  // Compute line numbers
  const lineCount = useMemo(() => {
    const text = isEditing ? editContent : content;
    return text.split("\n").length;
  }, [isEditing, editContent, content]);

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
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (isEditing) {
          handleSave();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isEditing, editContent, isSaving]);

  // Handle Tab key in Textarea
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
          {/* View / Edit Toggle */}
          <div className="flex bg-secondary/80 rounded-lg p-0.5 border border-border">
            <button
              onClick={() => setIsEditing(false)}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                !isEditing
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>View</span>
            </button>
            <button
              onClick={() => setIsEditing(true)}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                isEditing
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Edit</span>
            </button>
          </div>

          {/* Save Button */}
          {isEditing && (
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
          )}

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
      <div className="flex-1 flex overflow-hidden font-mono text-sm leading-relaxed">
        {/* Line Numbers gutter */}
        <pre className="select-none text-right px-3 py-4 bg-secondary/20 text-muted-foreground/40 border-r border-border/50 text-[11px] leading-[1.62] min-w-10 overflow-hidden">
          {lineNumbers}
        </pre>

        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            onKeyDown={handleTabPress}
            className="flex-1 resize-none p-4 bg-transparent text-foreground border-none outline-none font-mono text-xs focus:ring-0 leading-[1.62] overflow-y-auto"
            placeholder="Type code here..."
            spellCheck={false}
          />
        ) : (
          <pre className="flex-1 p-4 overflow-y-auto leading-[1.62] text-xs">
            <code
              className="hljs block whitespace-pre bg-transparent p-0"
              dangerouslySetInnerHTML={{ __html: highlightedCode }}
            />
          </pre>
        )}
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
