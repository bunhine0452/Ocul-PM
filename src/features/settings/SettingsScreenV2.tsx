import { useCallback, useEffect, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Toolbar } from "@/components/Toolbar";
import {
  SunIcon,
  MoonIcon,
  ShieldCheck,
  ShieldAlert,
  Activity,
  FolderOpen,
  RefreshCw,
  RotateCcw,
  Trash2,
  Sparkles,
  X,
} from "@/components/Icons";
import {
  commands,
  type AppInfo,
  type IndexProgress,
  type OculpmConfig,
  type WatcherStatus,
} from "@/lib/bindings";
import { useSettings } from "@/contexts/SettingsContext";
import { useTheme } from "@/lib/theme";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import type { Provider } from "@/lib/settings";
import { toast } from "@/lib/toast";
import { useUpdater, releaseHighlights } from "@/lib/updater";
import { Markdown } from "@/components/Markdown";
// The app's own changelog, bundled at build time so "체인지로그 보기" works
// offline and independent of GitHub.
import changelogRaw from "../../../CHANGELOG.md?raw";

// Final UI Update (ui_v2) — Settings 화면 (02-screen-specs §8). The 1.0 minimal
// settings: every control wires to an EXISTING backend (Decision F lineage — no
// new command, no migration). Deep knobs (per-provider models, chunk size,
// watcher debounce, agents) stay in the flag-off legacy SettingsPanel until
// PR-UI 7.
//
// Decision §0.12 (Option A — honest-minimal): the mockup's 기록 & 보안 toggles
// (자동 일지 작성 / 시크릿 자동 마스킹 / 익명 통계) have no clean single-boolean
// backend — auto-journal is the watcher, redaction is a pattern LIST, telemetry
// doesn't exist. Wiring them would either touch the .oculpm/ pipeline
// (UI-MASTER-PROMPT §1) or destroy the user's patterns. So they render as
// READ-ONLY status chips + an "config.toml 에서 관리 →" link (openInEditor on
// .oculpm/config.toml); 익명 통계 is dropped (local-first product has no
// telemetry — a dead toggle is dishonest).

declare const __BUILD_HASH__: string;
// __BUILD_HASH__ is a vite `define` (git short SHA); vitest has no define, so
// guard the reference to avoid a ReferenceError under jsdom.
const BUILD_HASH = typeof __BUILD_HASH__ !== "undefined" ? __BUILD_HASH__ : "dev";

const PROVIDER_META: { id: Provider; label: string; env: string }[] = [
  { id: "anthropic", label: "Anthropic", env: "ANTHROPIC_API_KEY" },
  { id: "openai", label: "OpenAI", env: "OPENAI_API_KEY" },
  { id: "gemini", label: "Google AI", env: "GEMINI_API_KEY" },
  { id: "nim", label: "NVIDIA NIM", env: "NVIDIA_API_KEY" },
  { id: "openrouter", label: "OpenRouter", env: "OPENROUTER_API_KEY" },
];

function secretName(p: Provider): string {
  return `${p}_api_key`;
}

const ACCENT_CHIP: React.CSSProperties = {
  color: "var(--accent-text)",
  background: "var(--accent-soft)",
};

interface SettingsScreenV2Props {
  projectId: number | null;
  projectRoot: string | null;
}

export function SettingsScreenV2({ projectId, projectRoot }: SettingsScreenV2Props) {
  const { settings, set } = useSettings();
  const { theme, setTheme } = useTheme();
  const { resetWorkspace } = useWorkspace();

  const { config, update } = useOculpmConfig(projectId);
  const [watcher, setWatcher] = useState<WatcherStatus | null>(null);
  const [hasKey, setHasKey] = useState<Partial<Record<Provider, boolean | null>>>({});
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [keyModal, setKeyModal] = useState<{ provider: Provider; label: string } | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const updater = useUpdater();
  const [changelogOpen, setChangelogOpen] = useState(false);

  // --- keyring presence (cached check — does NOT unlock the keychain) ---
  const refreshKey = useCallback(async (p: Provider) => {
    const res = await commands.secretHas(secretName(p));
    if (res.status === "ok") setHasKey((prev) => ({ ...prev, [p]: res.data }));
  }, []);

  useEffect(() => {
    PROVIDER_META.forEach((m) => void refreshKey(m.id));
  }, [refreshKey]);

  // --- watcher state (read-only chip for "자동 일지 작성") ---
  useEffect(() => {
    if (projectId == null) {
      setWatcher(null);
      return;
    }
    let cancelled = false;
    void commands.oculpmWatcherStatus(projectId).then((res) => {
      if (!cancelled && res.status === "ok") setWatcher(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // --- app info (About) ---
  useEffect(() => {
    void commands.appInfo().then((res) => {
      if (res.status === "ok") setInfo(res.data);
    });
  }, []);

  const openConfigToml = useCallback(async () => {
    if (projectRoot == null) return;
    const res = await commands.openInEditor(
      projectRoot,
      ".oculpm/config.toml",
      settings.externalEditorCommand,
    );
    if (res.status === "error") toast.destructive(`config.toml 열기 실패: ${res.error}`);
  }, [projectRoot, settings.externalEditorCommand]);

  // --- data folder reveal (mirrors OculpmSettings.LogsSection's fallback) ---
  const openDataFolder = useCallback(async () => {
    const res = await commands.appInfo();
    if (res.status !== "ok") return;
    const dir = res.data.app_data_dir;
    try {
      await revealItemInDir(dir);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      try {
        await navigator.clipboard.writeText(dir);
        toast.warning(`Finder 를 열 수 없어 경로를 클립보드에 복사했습니다.\n${msg}`, {
          title: "데이터 폴더 열기 실패",
        });
      } catch {
        toast.destructive(`데이터 폴더 열기 실패: ${msg}`);
      }
    }
  }, []);

  // --- rebuild the code-search index (⌘5 Search) ---
  const reindex = useCallback(async () => {
    if (projectId == null || reindexing) return;
    setReindexing(true);
    const channel = new Channel<IndexProgress>();
    const res = await commands.indexProject(projectId, channel);
    setReindexing(false);
    if (res.status === "ok") toast.info("코드 검색 인덱스를 다시 만들었어요.");
    else toast.destructive(`인덱스 재구축 실패: ${res.error}`);
  }, [projectId, reindexing]);

  const doReset = useCallback(() => {
    resetWorkspace();
    setConfirmReset(false);
    toast.info("작업 공간 상태를 초기화했어요.");
  }, [resetWorkspace]);

  const redactCount = config?.git.auto_redact_patterns.length ?? null;
  const watcherRunning = watcher?.state === "running";

  return (
    <>
      <Toolbar title="설정" sub="모든 데이터는 이 기기에만 저장됩니다" />
      <div className="scroll">
        <div className="page fade-in" style={{ maxWidth: 760 }}>
          {/* ── 일반 ──────────────────────────────────────────────── */}
          <div className="section-title" style={{ margin: "4px 2px 10px" }}>
            일반
          </div>
          <div className="card set-section">
            <div className="set-row">
              <div>
                <div className="set-label">테마</div>
                <div className="set-desc">라이트 · 다크 모드 전환</div>
              </div>
              <div className="set-ctl" style={{ gap: 6 }}>
                {(["light", "dark"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={"scope-chip" + (theme === t ? " on" : "")}
                    onClick={() => setTheme(t)}
                  >
                    {t === "light" ? <SunIcon size={13} /> : <MoonIcon size={13} />}{" "}
                    {t === "light" ? "라이트" : "다크"}
                  </button>
                ))}
              </div>
            </div>

            <div className="set-row">
              <div>
                <div className="set-label">컬러 테마</div>
                <div className="set-desc">강조 색(accent)을 고르세요 — 라이트·다크와 별개로 적용</div>
              </div>
              <div className="set-ctl" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {(
                  [
                    { id: "green", label: "그린", sw: "#12a06b" },
                    { id: "blue", label: "블루", sw: "#2570e0" },
                    { id: "purple", label: "퍼플", sw: "#7c5cdb" },
                    { id: "orange", label: "오렌지", sw: "#e07b12" },
                    { id: "rose", label: "로즈", sw: "#e0524b" },
                    { id: "teal", label: "틸", sw: "#0e9aa0" },
                  ] as const
                ).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={"scope-chip" + (settings.colorTheme === c.id ? " on" : "")}
                    onClick={() => void set("colorTheme", c.id)}
                    title={c.label}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 11,
                        height: 11,
                        borderRadius: 99,
                        background: c.sw,
                        display: "inline-block",
                        flexShrink: 0,
                      }}
                    />
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="set-row">
              <div>
                <div className="set-label">워크데이 시작 시각</div>
                <div className="set-desc">
                  이 시각을 기준으로 'Today'가 롤오버됩니다
                  {config ? ` (${config.workday.timezone})` : ""}
                </div>
              </div>
              <div className="set-ctl">
                <input
                  className="set-input"
                  style={{ minWidth: 90 }}
                  value={config?.workday.day_starts_at ?? ""}
                  disabled={!config}
                  placeholder="00:00"
                  aria-label="워크데이 시작 시각"
                  onChange={(e) =>
                    update((d) => ({
                      ...d,
                      workday: { ...d.workday, day_starts_at: e.target.value },
                    }))
                  }
                />
              </div>
            </div>

            <div className="set-row">
              <div>
                <div className="set-label">외부 에디터 명령</div>
                <div className="set-desc">
                  변경 diff·검색 결과를 열 때 실행됩니다. %path 는 파일 경로로 치환
                </div>
              </div>
              <div className="set-ctl">
                <input
                  className="set-input"
                  value={settings.externalEditorCommand}
                  placeholder={'code "%path"'}
                  aria-label="외부 에디터 명령"
                  onChange={(e) => void set("externalEditorCommand", e.target.value)}
                />
              </div>
            </div>

            <div className="set-row">
              <div>
                <div className="set-label">자정 자동 롤오버</div>
                <div className="set-desc">워크데이 경계를 넘기면 자동으로 일지를 정리</div>
              </div>
              <div className="set-ctl">
                <Toggle
                  on={config?.session.auto_close_on_workday_boundary ?? false}
                  disabled={!config}
                  label="자정 자동 롤오버"
                  onClick={() =>
                    update((d) => ({
                      ...d,
                      session: {
                        ...d.session,
                        auto_close_on_workday_boundary:
                          !d.session.auto_close_on_workday_boundary,
                      },
                    }))
                  }
                />
              </div>
            </div>
          </div>

          {/* ── 기록 & 보안 (read-only status + config.toml 위임) ──────── */}
          <div className="section-title" style={{ margin: "4px 2px 10px" }}>
            기록 & 보안
          </div>
          <div className="card set-section">
            <div className="set-row">
              <div>
                <div className="set-label">시크릿 자동 마스킹</div>
                <div className="set-desc">
                  API 키·토큰을 일지 작성 전 정규식 패턴으로 감지·치환
                </div>
              </div>
              <div className="set-ctl">
                {redactCount == null ? (
                  <span className="chip">확인 중…</span>
                ) : redactCount > 0 ? (
                  <span className="chip" style={ACCENT_CHIP}>
                    <ShieldCheck size={13} /> 패턴 {redactCount}개 활성
                  </span>
                ) : (
                  <span className="chip">
                    <ShieldAlert size={13} /> 미설정
                  </span>
                )}
                <button
                  type="button"
                  className="set-link"
                  onClick={openConfigToml}
                  disabled={projectRoot == null}
                >
                  config.toml 에서 관리 →
                </button>
              </div>
            </div>

            <div className="set-row">
              <div>
                <div className="set-label">자동 일지 작성</div>
                <div className="set-desc">에이전트 실행을 감지해 trigger별로 분류·기록</div>
              </div>
              <div className="set-ctl">
                {watcher == null ? (
                  <span className="chip">확인 중…</span>
                ) : (
                  <span className="chip" style={watcherRunning ? ACCENT_CHIP : undefined}>
                    <Activity size={13} />{" "}
                    {watcherRunning
                      ? "감시 중"
                      : watcher.state === "error"
                        ? "오류"
                        : "중지됨"}
                  </span>
                )}
                <button
                  type="button"
                  className="set-link"
                  onClick={openConfigToml}
                  disabled={projectRoot == null}
                >
                  config.toml 에서 관리 →
                </button>
              </div>
            </div>
          </div>

          {/* ── API 키 · 키체인 저장 ─────────────────────────────────── */}
          <div className="section-title" style={{ margin: "4px 2px 10px" }}>
            API 키 · 키체인 저장
          </div>
          <div className="card set-section">
            {PROVIDER_META.map((k) => {
              const present = hasKey[k.id];
              return (
                <div className="set-row" key={k.id}>
                  <div>
                    <div className="set-label">{k.label}</div>
                    <div className="set-desc mono">{k.env}</div>
                  </div>
                  <div className="set-ctl">
                    {present == null ? (
                      <span className="chip">확인 중…</span>
                    ) : present ? (
                      <span className="chip" style={ACCENT_CHIP}>
                        <ShieldCheck size={13} /> 키체인에 저장됨
                      </span>
                    ) : (
                      <span className="chip">
                        <ShieldAlert size={13} /> 미설정
                      </span>
                    )}
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => setKeyModal({ provider: k.id, label: k.label })}
                    >
                      {present ? "변경" : "추가"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── 모델 · 폴백 ───────────────────────────────────────── */}
          <div className="section-title" style={{ margin: "4px 2px 10px" }}>
            모델 · 폴백
          </div>
          <div className="card set-section">
            {(
              [
                { key: "modelAnthropic", label: "Anthropic", ph: "claude-sonnet-4-6" },
                { key: "modelOpenai", label: "OpenAI", ph: "gpt-4o-mini" },
                { key: "modelGemini", label: "Gemini", ph: "gemini-2.5-flash" },
                { key: "modelNim", label: "NVIDIA NIM", ph: "meta/llama-3.3-70b-instruct" },
                { key: "modelOpenrouter", label: "OpenRouter", ph: "openai/gpt-4o-mini" },
              ] as const
            ).map((m) => (
              <div className="set-row" key={m.key}>
                <div>
                  <div className="set-label">{m.label}</div>
                  <div className="set-desc">비우면 내장 기본값 사용</div>
                </div>
                <div className="set-ctl">
                  <input
                    className="set-input"
                    value={settings[m.key]}
                    placeholder={m.ph}
                    aria-label={`${m.label} 모델`}
                    onChange={(e) => void set(m.key, e.target.value)}
                  />
                </div>
              </div>
            ))}
            <div className="set-row">
              <div>
                <div className="set-label">폴백 체인</div>
                <div className="set-desc">
                  호출 실패 시 차례로 재시도할 모델. 한 줄에 하나씩{" "}
                  <span className="mono">provider:model</span>
                </div>
              </div>
              <div className="set-ctl">
                <textarea
                  className="set-input"
                  style={{ minHeight: 64, resize: "vertical", fontFamily: "var(--mono)" }}
                  value={settings.fallbackModels}
                  placeholder={"openai:gpt-4o-mini\nanthropic:claude-3.5-haiku-latest"}
                  aria-label="폴백 체인"
                  spellCheck={false}
                  onChange={(e) => void set("fallbackModels", e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* ── 고급 ──────────────────────────────────────────────── */}
          <div className="section-title" style={{ margin: "4px 2px 10px" }}>
            고급
          </div>
          <div className="card set-section">
            <div className="set-row">
              <div>
                <div className="set-label">데이터 폴더 열기</div>
                <div className="set-desc">프로젝트·인덱스·대화가 저장된 폴더를 엽니다</div>
              </div>
              <div className="set-ctl">
                <button type="button" className="btn sm" onClick={openDataFolder}>
                  <FolderOpen size={14} /> 열기
                </button>
              </div>
            </div>

            <div className="set-row">
              <div>
                <div className="set-label">자동 인덱싱</div>
                <div className="set-desc">
                  파일이 바뀌면 워처가 곧바로 인덱스를 갱신합니다 — 직접 재구축하지 않아도 검색에
                  반영돼요. (이미 인덱싱된 프로젝트에만 적용)
                </div>
              </div>
              <div className="set-ctl">
                <Toggle
                  on={settings.autoIndex}
                  label="자동 인덱싱"
                  onClick={() => void set("autoIndex", !settings.autoIndex)}
                />
              </div>
            </div>

            <div className="set-row">
              <div>
                <div className="set-label">인덱스 재구축</div>
                <div className="set-desc">코드 검색 인덱스를 처음부터 다시 만듭니다</div>
              </div>
              <div className="set-ctl">
                <button
                  type="button"
                  className="btn sm"
                  onClick={reindex}
                  disabled={projectId == null || reindexing}
                >
                  <RefreshCw size={14} /> {reindexing ? "재구축 중…" : "재구축"}
                </button>
              </div>
            </div>

            <div className="set-row">
              <div>
                <div className="set-label">작업 공간 상태 초기화</div>
                <div className="set-desc">
                  열어둔 화면·필터·탭 등 이 기기의 UI 상태를 기본값으로 되돌립니다
                </div>
              </div>
              <div className="set-ctl">
                {confirmReset ? (
                  <>
                    <span className="set-desc" style={{ color: "var(--t-bug)", marginTop: 0 }}>
                      되돌릴 수 없어요.
                    </span>
                    <button type="button" className="btn sm danger" onClick={doReset}>
                      초기화
                    </button>
                    <button type="button" className="btn sm" onClick={() => setConfirmReset(false)}>
                      취소
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn sm danger"
                    onClick={() => setConfirmReset(true)}
                  >
                    <RotateCcw size={14} /> 초기화
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ── 업데이트 ──────────────────────────────────────────── */}
          <div className="section-title" style={{ margin: "4px 2px 10px" }}>
            업데이트
          </div>
          <div className="card set-section">
            <div className="set-row">
              <div>
                <div className="set-label">버전</div>
                <div className="set-desc">
                  현재 v{info?.version ?? "…"} · {BUILD_HASH}
                </div>
              </div>
              <div className="set-ctl">
                {updater.status.kind === "available" ? (
                  <button
                    type="button"
                    className="btn sm primary"
                    onClick={() => void updater.install()}
                  >
                    <Sparkles size={13} /> v{updater.status.version} 설치 후 재시작
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => void updater.check()}
                    disabled={updater.status.kind === "checking" || updater.status.kind === "installing"}
                  >
                    <RefreshCw size={13} />{" "}
                    {updater.status.kind === "checking" ? "확인 중…" : "업데이트 확인"}
                  </button>
                )}
              </div>
            </div>

            {updater.status.kind === "uptodate" ? (
              <div className="set-row">
                <div className="set-desc" style={{ marginTop: 0 }}>최신 버전을 사용 중입니다.</div>
              </div>
            ) : updater.status.kind === "installing" ? (
              <div className="set-row">
                <div className="set-desc" style={{ marginTop: 0 }}>다운로드 후 설치 중…</div>
              </div>
            ) : updater.status.kind === "error" ? (
              <div className="set-row">
                <div className="set-desc" style={{ marginTop: 0, color: "var(--t-bug)" }}>
                  업데이트 확인 실패: {updater.status.message}
                </div>
              </div>
            ) : null}

            {updater.status.kind === "available" && releaseHighlights(updater.status.notes) ? (
              <div className="set-row">
                <div style={{ width: "100%" }}>
                  <div className="set-label" style={{ marginBottom: 6 }}>새 버전 변경사항</div>
                  <div
                    style={{
                      maxHeight: 180,
                      overflowY: "auto",
                      fontSize: 12.5,
                      lineHeight: 1.6,
                      background: "var(--bg-inset)",
                      borderRadius: 8,
                      padding: "8px 12px",
                    }}
                  >
                    <Markdown>{releaseHighlights(updater.status.notes)}</Markdown>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="set-row">
              <div>
                <div className="set-label">변경 로그</div>
                <div className="set-desc">이 앱의 버전별 변경 내역을 봅니다</div>
              </div>
              <div className="set-ctl">
                <button type="button" className="btn sm" onClick={() => setChangelogOpen(true)}>
                  <Sparkles size={13} /> 체인지로그 보기
                </button>
              </div>
            </div>
          </div>

          {/* ── 정보 ──────────────────────────────────────────────── */}
          <div className="section-title" style={{ margin: "4px 2px 10px" }}>
            정보
          </div>
          <div className="card set-section">
            <div className="set-row">
              <div>
                <div className="set-label">버전</div>
                <div className="set-desc">Ocul-PM</div>
              </div>
              <div className="set-ctl">
                <span className="set-desc mono" style={{ marginTop: 0 }}>
                  {info?.version ?? "…"} · {BUILD_HASH}
                </span>
              </div>
            </div>
            <div className="set-row">
              <div>
                <div className="set-label">데이터 경로</div>
                <div className="set-desc mono">{info?.app_data_dir ?? "…"}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {keyModal ? (
        <KeyModal
          provider={keyModal.provider}
          label={keyModal.label}
          hasKey={hasKey[keyModal.provider] === true}
          onClose={() => setKeyModal(null)}
          onSaved={() => void refreshKey(keyModal.provider)}
        />
      ) : null}

      {changelogOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
          onClick={() => setChangelogOpen(false)}
        >
          <div
            className="card"
            style={{
              width: "min(720px, 92vw)",
              maxHeight: "82vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-head">
              <Sparkles size={16} color="var(--accent-text)" />
              <h3>체인지로그</h3>
              <button
                type="button"
                className="btn ghost sm right"
                onClick={() => setChangelogOpen(false)}
                aria-label="닫기"
              >
                <X size={15} />
              </button>
            </div>
            <div style={{ overflowY: "auto", padding: "14px 18px", fontSize: 13, lineHeight: 1.65 }}>
              <Markdown>{changelogRaw}</Markdown>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

// ── Per-project .oculpm/config.toml — load + 400ms-debounced save. Mirrors the
// legacy OculpmSettings flow; uses existing oculpmGetConfig / oculpmSetConfig
// (no command change). ──────────────────────────────────────────────────────
function useOculpmConfig(projectId: number | null) {
  const [config, setConfig] = useState<OculpmConfig | null>(null);
  const lastSaved = useRef<string | null>(null);

  useEffect(() => {
    if (projectId == null) {
      setConfig(null);
      lastSaved.current = null;
      return;
    }
    let cancelled = false;
    void commands.oculpmGetConfig(projectId).then((res) => {
      if (cancelled) return;
      if (res.status === "ok") {
        lastSaved.current = JSON.stringify(res.data);
        setConfig(res.data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (projectId == null || !config) return;
    const serialized = JSON.stringify(config);
    if (lastSaved.current === serialized) return;
    const handle = window.setTimeout(() => {
      lastSaved.current = serialized;
      void commands.oculpmSetConfig(projectId, config).then((res) => {
        if (res.status === "error") toast.destructive(`설정 저장 실패: ${res.error}`);
      });
    }, 400);
    return () => window.clearTimeout(handle);
  }, [config, projectId]);

  const update = useCallback((mut: (draft: OculpmConfig) => OculpmConfig) => {
    setConfig((prev) => (prev ? mut(structuredClone(prev)) : prev));
  }, []);

  return { config, update };
}

function Toggle({
  on,
  onClick,
  label,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={"toggle" + (on ? " on" : "")}
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <i />
    </button>
  );
}

// First ui_v2 modal pattern (PR-UI 6). The key is write-only — the field never
// shows the stored value; the user can only set a new one or delete it.
function KeyModal({
  provider,
  label,
  hasKey,
  onClose,
  onSaved,
}: {
  provider: Provider;
  label: string;
  hasKey: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = `keymodal-${provider}`;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Esc closes the modal; stop propagation so the global shortcut handler
  // doesn't also fire (01-ia-and-shell §3 — screen-local keys).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const res = await commands.secretSet(secretName(provider), trimmed);
    setBusy(false);
    if (res.status === "ok") {
      onSaved();
      onClose();
      toast.info(`${label} 키를 저장했어요.`);
    } else {
      toast.destructive(`키 저장 실패: ${res.error}`);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    const res = await commands.secretDelete(secretName(provider));
    setBusy(false);
    if (res.status === "ok") {
      onSaved();
      onClose();
      toast.info(`${label} 키를 삭제했어요.`);
    } else {
      toast.destructive(`키 삭제 실패: ${res.error}`);
    }
  };

  return (
    <div className="set-modal-backdrop" onMouseDown={onClose}>
      <div
        className="set-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="set-modal-title" id={titleId}>
          {label} API 키 {hasKey ? "변경" : "추가"}
        </div>
        <div className="set-modal-desc">
          키는 OS 키체인에 저장되며 다시 표시되지 않습니다. 새 값만 입력하세요.
        </div>
        <input
          ref={inputRef}
          className="set-modal-input"
          type="password"
          value={value}
          placeholder="API 키 붙여넣기…"
          aria-label={`${label} API 키`}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
          }}
        />
        <div className="set-modal-actions">
          {hasKey ? (
            <button
              type="button"
              className="btn sm danger"
              onClick={() => void remove()}
              disabled={busy}
              style={{ marginRight: "auto" }}
            >
              <Trash2 size={14} /> 삭제
            </button>
          ) : null}
          <button type="button" className="btn sm" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button
            type="button"
            className="btn sm primary"
            onClick={() => void save()}
            disabled={!value.trim() || busy}
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
