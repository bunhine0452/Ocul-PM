/**
 * 「Claude 에게 보내기」 대화상자 — 프로젝트 창마다 하나. 맥락 · 할 말 · 받는 곳(지금 도는 claude
 * 세션 또는 새 세션)을 고르고 ⌘↩ 로 보낸다. 넣는 일은 `sendToClaude.ts`.
 *
 * 받는 곳은 열린 동안 계속 따라간다(`useWindowTermsState`) — 한 번만 읽던 때는 읽기 전에 ⌘↩ 를 누르면 조용히
 * 새 claude 세션이 열렸고, 열린 사이 Claude 가 일을 시작해도 「일하는 중」 안내가 그대로였다. 목록을 읽기 전에는
 * 보내지 않고, 못 읽었으면 새 세션으로 간다고 말한다. 받는 곳의 이름은 탭과 같은 번호 · 이름이다.
 *
 * 쓰던 말은 맥락(종류 + 자리)마다 앱이 켜 있는 동안 남는다 — Esc 한 번에 길게 쓴 지시가 사라지지 않게.
 * 보내면 지운다.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { toAppError } from "@/api/invoke";
import { AppDialog } from "@/components/ui/AppDialog";
import { useT } from "@/i18n";
import { blocked } from "@/lib/blocked";
import { tError } from "@/i18n/errors";
import { kbd } from "@/lib/kbd";
import { NAV_BUS } from "@/lib/navRegistry";
import { toast } from "@/lib/toast";
import { terminalApi } from "@/api/terminal";
import { requestTermFocus } from "./focusRequest";
import { useRace } from "./race";
import { runPromptInTerminal } from "./runPrompt";
import {
  composeMessage,
  defaultReceiver,
  flushQueue,
  onSendToClaude,
  queuedStore,
  readinessOf,
  receiversOf,
  sendOrQueue,
  toastQueued,
  type SendContext,
} from "./sendToClaude";
import { numberSessions, sessionName, sessionNumber, sessionWord, useWindowTermsState } from "./status";
import "./send.css";

const NEW = "new";

/** 쓰던 말 — 맥락(종류 + 자리)마다, 앱이 켜 있는 동안(창의 웹뷰). */
const drafts = new Map<string, string>();
const draftKey = (ctx: SendContext) => `${ctx.kind}:${ctx.ref}`;

/** 테스트 전용. */
export function __resetSendDraftsForTests() {
  drafts.clear();
}

export function SendToClaudeHost({ projectId }: { projectId: number }) {
  const { t } = useT();
  const [ctx, setCtx] = useState<SendContext | null>(null);
  const [text, setText] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const terms = useWindowTermsState(ctx != null);
  useRace(); // 시도(레인) 세션의 이름 「시도 n」 이 바뀌면 다시 그린다
  numberSessions(terms.list);
  const sessions = useMemo(() => receiversOf(terms.list), [terms.list]);
  // 목록을 읽기 전 — 받는 곳을 모르니 보내지 않는다(곧 풀리는 진행 중).
  const loading = terms.state === "loading";

  useEffect(
    () =>
      onSendToClaude((next) => {
        setCtx(next);
        setText(drafts.get(draftKey(next)) ?? next.prefill ?? "");
        setTarget(null);
      }),
    [],
  );

  // 받는 곳 — 목록이 처음 서면 쉬는 세션을, 고른 세션이 사라지면 다시 고른다. 사람이 고른 것은 그대로 둔다.
  useEffect(() => {
    if (!ctx || terms.state === "loading") return;
    if (target === NEW || (target != null && sessions.some((s) => String(s.id) === target))) return;
    const first = defaultReceiver(sessions);
    setTarget(first ? String(first.id) : NEW);
  }, [ctx, terms.state, target, sessions]);

  useSendQueueFlusher();

  const close = () => setCtx(null);
  const chosen = target ?? NEW;
  const picked = chosen === NEW ? null : sessions.find((s) => String(s.id) === chosen);
  const readiness = picked ? readinessOf(picked.status) : "ready";
  const edit = (value: string) => {
    setText(value);
    if (!ctx) return;
    if (value.trim()) drafts.set(draftKey(ctx), value);
    else drafts.delete(draftKey(ctx));
  };

  const send = async (now = false) => {
    if (!ctx || busy || loading || !text.trim()) return;
    const message = composeMessage(t, ctx, text);
    setBusy(true);
    try {
      if (chosen === NEW) {
        await runPromptInTerminal(projectId, message);
        ctx.onSent?.();
      } else {
        const id = Number(chosen);
        const n = sessionNumber(id);
        const res = await sendOrQueue(id, message, { now, onDelivered: ctx.onSent });
        if (res.outcome === "sent") {
          toast.info(t("send.sent", { n }), { actions: [viewAction(t("send.view"), id)] });
        } else {
          toastQueued(t, n, res.key);
        }
      }
      drafts.delete(draftKey(ctx));
      close();
    } catch (e) {
      toast.destructive(t("send.failed", { error: tError(toAppError(e)) }));
    } finally {
      setBusy(false);
    }
  };

  // ⌘↩ 보내기(쉬지 않으면 줄 세우기) · ⇧⌘↩ 지금 끼워 넣기(일하는 중일 때만 — 묻는 중엔 여전히 줄로).
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(e.shiftKey);
    }
  };

  const kindWord = ctx ? t(`send.kind.${ctx.kind}` as const) : "";
  // 경로 맥락(파일)은 이름이 곧 자리다 — 고정폭 한 번만. 일지 · 계획 항목은 사람이 쓴 이름 + 자리(고정폭).
  const refIsLabel = ctx != null && ctx.ref === ctx.label;
  return (
    <AppDialog open={ctx != null} onClose={close} label={t("send.title")} width={480} initialFocusRef={textRef}>
      {ctx ? (
        <div className="send">
          <div className="send-head">
            <b>{t("send.title")}</b>
          </div>
          <div className="send-ctx">
            <span className="send-ctx-k">{t("send.context")}</span>{" "}
            {refIsLabel ? kindWord : t("send.ctxLine", { kind: kindWord, label: ctx.label })}
            {ctx.note ? ` · ${ctx.note}` : ""}
            {ctx.ref ? <span className="send-ref mono">{ctx.ref}</span> : null}
          </div>
          <textarea
            ref={textRef}
            className="send-text"
            rows={4}
            value={text}
            placeholder={t("send.placeholder")}
            aria-label={t("send.placeholder")}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            onChange={(e) => edit(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {terms.state === "failed" ? (
            <p className="send-hint" role="status">
              {t("send.listFailed")}
            </p>
          ) : readiness !== "ready" ? (
            <p className="send-hint" role="status">
              {t(readiness === "working" ? "send.hint.working" : "send.hint.blocked")}
            </p>
          ) : null}
          <div className="send-foot">
            <label className="send-target">
              <span>{t("send.target")}</span>
              <span className="select-wrap inline sm">
                <select value={chosen} disabled={loading} onChange={(e) => setTarget(e.target.value)}>
                  {sessions.map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {t("send.session", { n: sessionNumber(s.id), label: sessionName(t, s), word: sessionWord(t, s) })}
                    </option>
                  ))}
                  <option value={NEW}>{t("send.newSession")}</option>
                </select>
              </span>
            </label>
            <span className="send-sp" />
            <button type="button" className="btn sm" onClick={close}>
              {t("common.cancel")}
            </button>
            {readiness === "working" ? (
              <button
                type="button"
                className="btn sm"
                aria-keyshortcuts="Shift+Meta+Enter Shift+Control+Enter"
                {...blocked(text.trim() ? null : t("send.needsText"), t("send.nowTitle"))}
                disabled={busy}
                onClick={() => void send(true)}
              >
                {t("send.now")}
                <kbd className="kbd" aria-hidden="true">
                  {kbd("⇧⌘↩")}
                </kbd>
              </button>
            ) : null}
            <button
              type="button"
              className="btn primary sm"
              aria-keyshortcuts="Meta+Enter Control+Enter"
              {...blocked(text.trim() ? null : t("send.needsText"))}
              disabled={busy || loading}
              onClick={() => void send()}
            >
              {t(readiness === "ready" ? "send.submit" : "send.submitQueue")}
              <kbd className="kbd" aria-hidden="true">
                {kbd("⌘↩")}
              </kbd>
            </button>
          </div>
        </div>
      ) : null}
    </AppDialog>
  );
}

function viewAction(label: string, id: number) {
  return {
    label,
    onClick: () => {
      requestTermFocus(id);
      window.dispatchEvent(new CustomEvent(NAV_BUS.setView, { detail: "terminal" }));
    },
  };
}

/**
 * 줄을 비우는 쪽 — 줄에 무언가 있을 때만, 이 창의 세션이 바뀌거나 상태가 바뀔 때마다 목록을 읽어
 * 손을 놓은 세션에 넣는다. 창마다 하나(대화상자와 함께 산다).
 */
function useSendQueueFlusher() {
  const { t } = useT();
  const tRef = useRef(t);
  tRef.current = t;
  useEffect(() => {
    let alive = true;
    const run = async () => {
      if (queuedStore.get().length === 0) return;
      const all = await terminalApi.list().catch(() => []);
      const list = Array.isArray(all) ? all : [];
      const { delivered, dropped } = await flushQueue(list);
      if (!alive) return;
      const tr = tRef.current;
      numberSessions(list);
      for (const id of new Set(delivered.map((q) => q.sessionId))) {
        toast.info(tr("send.queueDelivered", { n: sessionNumber(id) }), { actions: [viewAction(tr("send.view"), id)] });
      }
      if (dropped.length > 0) toast.warning(tr("send.queueDropped", { n: dropped.length }));
    };
    const off = terminalApi.onSessionsChanged(() => void run());
    // 줄에 세우는 사이 세션이 이미 손을 놓았을 수 있다 — 그 뒤엔 사건이 없으니 세울 때도 한 번 본다.
    const offQueue = queuedStore.subscribe(() => void run());
    return () => {
      alive = false;
      offQueue();
      void off.then((fn) => fn());
    };
  }, []);
}
