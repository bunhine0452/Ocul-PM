import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2,
  Sparkles,
  Copy,
  ScanSearch,
  FileDiff,
  Search,
  Check,
} from "@/components/Icons";
import { Markdown } from "@/components/Markdown";
import {
  commands,
  type ChunkSearchResult,
  type FileChange,
  type EditPromptResult,
} from "@/lib/bindings";

const PROVIDERS = ["anthropic", "gemini", "openai"] as const;
type Provider = (typeof PROVIDERS)[number];

const FALLBACK_MODEL: Record<Provider, string> = {
  anthropic: "claude-sonnet-4-6",
  gemini: "gemini-2.5-flash",
  openai: "gpt-4o-mini",
};

interface AssistPanelProps {
  activeProjectId: number | null;
}

export function AssistPanel({ activeProjectId }: AssistPanelProps) {
  // Input state
  const [userRequest, setUserRequest] = useState("");
  const [provider, setProvider] = useState<Provider>("gemini");
  const [model, setModel] = useState("");

  // Processing states
  const [searching, setSearching] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [scanning, setScanning] = useState(false);

  // Results
  const [relatedChunks, setRelatedChunks] = useState<ChunkSearchResult[]>([]);
  const [promptResult, setPromptResult] = useState<EditPromptResult | null>(null);
  const [fileChanges, setFileChanges] = useState<FileChange[]>([]);
  const [copied, setCopied] = useState(false);

  // Error
  const [error, setError] = useState<string | null>(null);

  // Refs
  const promptRef = useRef<HTMLDivElement>(null);

  // Load saved model on mount
  useEffect(() => {
    (async () => {
      const saved = await commands.settingsGet("default_model");
      if (saved.status === "ok" && saved.data) setModel(saved.data);
    })();
  }, []);

  // Load today's changes on mount / project change
  useEffect(() => {
    if (activeProjectId != null) {
      loadTodayChanges();
    } else {
      setFileChanges([]);
    }
  }, [activeProjectId]);

  async function loadTodayChanges() {
    if (activeProjectId == null) return;
    const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
    const res = await commands.listFileChanges(activeProjectId, todayStart);
    if (res.status === "ok") {
      setFileChanges(res.data);
    }
  }

  // Step 1: Search related code when user types (debounced preview)
  async function handleSearch() {
    if (!userRequest.trim() || activeProjectId == null) return;
    setSearching(true);
    setError(null);
    try {
      const res = await commands.searchChunks(activeProjectId, userRequest, 5);
      if (res.status === "ok") {
        setRelatedChunks(res.data);
      } else {
        setError(res.error);
      }
    } catch (err: any) {
      setError(err.toString());
    } finally {
      setSearching(false);
    }
  }

  // Step 2: Generate prompt
  async function handleGeneratePrompt() {
    if (!userRequest.trim() || activeProjectId == null) return;
    setGenerating(true);
    setError(null);
    setPromptResult(null);
    try {
      const effectiveModel = model || FALLBACK_MODEL[provider];
      const res = await commands.generateEditPrompt(
        activeProjectId,
        userRequest,
        provider,
        effectiveModel
      );
      if (res.status === "ok") {
        setPromptResult(res.data);
        // Scroll to prompt result
        setTimeout(() => {
          promptRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 100);
      } else {
        setError(res.error);
      }
    } catch (err: any) {
      setError(err.toString());
    } finally {
      setGenerating(false);
    }
  }

  // Copy to clipboard
  async function handleCopy() {
    if (!promptResult) return;
    try {
      await navigator.clipboard.writeText(promptResult.english_prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const textarea = document.createElement("textarea");
      textarea.value = promptResult.english_prompt;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  // Scan for file changes
  async function handleScanChanges() {
    if (activeProjectId == null) return;
    setScanning(true);
    setError(null);
    try {
      const res = await commands.detectFileChanges(activeProjectId);
      if (res.status === "ok") {
        setFileChanges(res.data);
      } else {
        setError(res.error);
      }
    } catch (err: any) {
      setError(err.toString());
    } finally {
      setScanning(false);
    }
  }

  const changeTypeLabel: Record<string, { label: string; color: string; icon: string }> = {
    created: { label: "생성", color: "text-emerald-500", icon: "+" },
    modified: { label: "수정", color: "text-amber-500", icon: "~" },
    deleted: { label: "삭제", color: "text-red-500", icon: "-" },
  };

  if (activeProjectId == null) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center select-none">
        <Sparkles className="w-12 h-12 text-primary/30 mb-4" strokeWidth={1.5} />
        <h2 className="text-lg font-bold font-heading mb-1.5 text-muted-foreground">
          프로젝트를 먼저 선택하세요
        </h2>
        <p className="text-xs text-muted-foreground/60 max-w-sm leading-relaxed">
          AI 코드 어시스턴트를 사용하려면 인덱싱된 프로젝트가 필요합니다.
        </p>
      </div>
    );
  }

  return (
    <section className="w-full h-full flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="h-12 border-b border-border flex items-center justify-between px-5 bg-secondary/20 shrink-0">
        <div className="flex items-center space-x-2.5">
          <Sparkles className="w-4.5 h-4.5 text-primary" strokeWidth={2} />
          <span className="text-sm font-bold text-foreground">AI 코드 어시스턴트</span>
          <span className="text-[10px] text-muted-foreground bg-primary/10 text-primary px-2 py-0.5 rounded-full font-semibold">
            Beta
          </span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={provider}
            onChange={(e) => setProvider(e.currentTarget.value as Provider)}
            className="h-7 rounded-md border border-border bg-background px-2 text-[11px] font-medium"
            disabled={generating}
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <input
            value={model}
            onChange={(e) => setModel(e.currentTarget.value)}
            placeholder={FALLBACK_MODEL[provider]}
            className="h-7 w-36 rounded-md border border-border bg-background px-2 text-[11px] font-mono"
            disabled={generating}
          />
        </div>
      </div>

      {/* Main content area — scrollable */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5 scrollbar-thin">
        {/* Step 1: User Input */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[11px] font-bold text-primary shrink-0">
              1
            </div>
            <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
              수정 요구사항 입력
            </h3>
          </div>

          <Textarea
            value={userRequest}
            onChange={(e) => setUserRequest(e.currentTarget.value)}
            placeholder="어떤 부분을 수정하고 싶은지 한국어로 설명해주세요. 예: '로그인 페이지에 소셜 로그인 버튼을 추가하고 싶어'"
            rows={3}
            className="resize-none rounded-xl bg-background border-border/60 focus-visible:ring-primary shadow-sm p-3.5 text-xs leading-relaxed"
            disabled={generating}
          />

          <div className="flex gap-2">
            <Button
              onClick={handleSearch}
              disabled={!userRequest.trim() || searching || generating}
              className="flex-1 border border-border bg-secondary/80 hover:bg-accent text-muted-foreground hover:text-foreground rounded-xl h-9 font-semibold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer"
            >
              {searching ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>검색 중...</span>
                </>
              ) : (
                <>
                  <Search className="w-3 h-3" />
                  <span>관련 코드 미리보기</span>
                </>
              )}
            </Button>

            <Button
              onClick={handleGeneratePrompt}
              disabled={!userRequest.trim() || generating}
              className="flex-[2] bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl h-9 font-semibold text-[11px] flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
            >
              {generating ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>프롬프트 생성 중...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3 h-3" />
                  <span>프롬프트 생성하기</span>
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Related code chunks preview */}
        {relatedChunks.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-accent flex items-center justify-center text-[11px] font-bold text-muted-foreground shrink-0">
                <Search className="w-3 h-3" />
              </div>
              <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
                관련 코드 ({relatedChunks.length}개 청크)
              </h3>
            </div>

            <div className="space-y-1.5 max-h-48 overflow-y-auto scrollbar-thin">
              {relatedChunks.map((chunk) => (
                <details
                  key={chunk.chunk_id}
                  className="group rounded-lg border border-border/60 bg-card/50 overflow-hidden"
                >
                  <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer text-[11px] hover:bg-accent/30 transition-colors">
                    <span className="font-mono text-primary font-semibold truncate flex-1">
                      {chunk.file_path}
                    </span>
                    <span className="text-muted-foreground/60 font-mono shrink-0">
                      L{chunk.start_line}–{chunk.end_line}
                    </span>
                    {chunk.distance != null && (
                      <span className="text-[10px] text-muted-foreground/40">
                        d={chunk.distance.toFixed(3)}
                      </span>
                    )}
                  </summary>
                  <div className="px-3 pb-2 pt-1 border-t border-border/30">
                    <pre className="text-[10px] font-mono text-muted-foreground whitespace-pre-wrap break-all leading-relaxed max-h-32 overflow-y-auto scrollbar-thin">
                      {chunk.content}
                    </pre>
                  </div>
                </details>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Generated Prompt Result */}
        {promptResult && (
          <div ref={promptRef} className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[11px] font-bold text-primary shrink-0">
                2
              </div>
              <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
                생성된 프롬프트
              </h3>
            </div>

            {/* Korean Summary */}
            <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 space-y-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                  🇰🇷 한국어 요약 (모니터링용)
                </span>
              </div>
              <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">
                {promptResult.korean_summary}
              </p>
            </div>

            {/* Related Files */}
            {promptResult.related_files.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {promptResult.related_files.map((file) => (
                  <span
                    key={file}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-secondary text-[10px] font-mono text-muted-foreground border border-border/40"
                  >
                    <FileDiff className="w-2.5 h-2.5" />
                    {file}
                  </span>
                ))}
              </div>
            )}

            {/* English Prompt */}
            <div className="relative rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60 bg-secondary/30">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  🇺🇸 English Prompt (고급 모델에 전달)
                </span>
                <Button
                  onClick={handleCopy}
                  className={`h-7 px-3 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer transition-all duration-200 ${
                    copied
                      ? "bg-emerald-500 text-white hover:bg-emerald-600"
                      : "bg-primary text-primary-foreground hover:bg-primary/90"
                  }`}
                >
                  {copied ? (
                    <>
                      <Check className="w-3 h-3" />
                      <span>복사 완료!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>클립보드 복사</span>
                    </>
                  )}
                </Button>
              </div>
              <div className="p-4 max-h-72 overflow-y-auto scrollbar-thin">
                <div className="prose prose-sm dark:prose-invert text-xs leading-relaxed">
                  <Markdown>{promptResult.english_prompt}</Markdown>
                </div>
              </div>
            </div>

            {/* Step 3: Instructions */}
            <div className="p-3.5 rounded-xl bg-accent/40 border border-border/40 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[11px] font-bold text-primary shrink-0">
                  3
                </div>
                <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
                  다음 단계
                </h3>
              </div>
              <ol className="text-[11px] text-muted-foreground space-y-1.5 pl-8 list-decimal leading-relaxed">
                <li>위의 <strong className="text-foreground">영어 프롬프트</strong>를 클립보드에 복사하세요.</li>
                <li>Claude Code, Cursor, 또는 사용하는 <strong className="text-foreground">고급 AI 코딩 도구</strong>에 붙여넣기 하세요.</li>
                <li>코드 수정이 완료되면 아래의 <strong className="text-foreground">"변경사항 스캔"</strong> 버튼을 눌러 변경 내역을 기록하세요.</li>
              </ol>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-xl text-xs font-semibold">
            {error}
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-border/50 pt-4">
          {/* Step 4: Today's Changes */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-accent flex items-center justify-center text-[11px] font-bold text-muted-foreground shrink-0">
                  <FileDiff className="w-3 h-3" />
                </div>
                <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
                  오늘 변경사항
                </h3>
                {fileChanges.length > 0 && (
                  <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-bold">
                    {fileChanges.length}
                  </span>
                )}
              </div>
              <Button
                onClick={handleScanChanges}
                disabled={scanning}
                className="h-8 px-3 border border-border bg-secondary hover:bg-accent text-muted-foreground hover:text-foreground rounded-lg text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                {scanning ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>스캔 중...</span>
                  </>
                ) : (
                  <>
                    <ScanSearch className="w-3 h-3" />
                    <span>변경사항 스캔</span>
                  </>
                )}
              </Button>
            </div>

            {fileChanges.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/50">
                <ScanSearch className="w-8 h-8 mb-2" strokeWidth={1.5} />
                <p className="text-[11px] text-center font-medium leading-relaxed">
                  아직 감지된 변경사항이 없습니다.
                  <br />
                  코드 수정 후 "변경사항 스캔" 버튼을 눌러 확인하세요.
                </p>
              </div>
            ) : (
              <div className="space-y-1 max-h-64 overflow-y-auto scrollbar-thin">
                {fileChanges.map((change) => {
                  const ct = changeTypeLabel[change.change_type] || {
                    label: change.change_type,
                    color: "text-muted-foreground",
                    icon: "?",
                  };
                  return (
                    <div
                      key={change.id}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border/40 bg-card/50 hover:bg-accent/30 transition-colors"
                    >
                      <span
                        className={`w-5 h-5 rounded flex items-center justify-center text-[11px] font-bold font-mono ${ct.color} bg-current/10`}
                        style={{ backgroundColor: "transparent" }}
                      >
                        <span className={ct.color}>{ct.icon}</span>
                      </span>
                      <span className="text-[11px] font-mono text-foreground truncate flex-1">
                        {change.file_path}
                      </span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${ct.color}`}>
                        {ct.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground/50">
                        {new Date(change.detected_at * 1000).toLocaleTimeString("ko-KR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
