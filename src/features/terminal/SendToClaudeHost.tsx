/**
 * 「Claude 에게 보내기」 대화상자 — 프로젝트 창마다 하나. 맥락 · 할 말 · 받는 곳(지금 도는 claude
 * 세션 또는 새 세션)을 고르고 ⌘↩ 로 보낸다. 넣는 일은 `sendToClaude.ts`.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { toAppError } from "@/api/invoke";
import { terminalApi, type TermInfo } from "@/api/terminal";
import { AppDialog } from "@/components/ui/AppDialog";
import { useT } from "@/i18n";
import { blocked } from "@/lib/blocked";
import { tError } from "@/i18n/errors";
import { kbd } from "@/lib/kbd";
import { NAV_BUS } from "@/lib/navRegistry";
import { toast } from "@/lib/toast";
import { requestTermFocus } from "./focusRequest";
import { runPromptInTerminal } from "./runPrompt";
import {
  composeMessage,
  defaultReceiver,
  deliverToSession,
  onSendToClaude,
  receiversOf,
  type SendContext,
} from "./sendToClaude";
import { sessionWord } from "./status";
import "./send.css";

const NEW = "new";

export function SendToClaudeHost({ projectId }: { projectId: number }) {
  const { t } = useT();
  const [ctx, setCtx] = useState<SendContext | null>(null);
  const [text, setText] = useState("");
  const [sessions, setSessions] = useState<TermInfo[]>([]);
  const [target, setTarget] = useState<string>(NEW);
  const [busy, setBusy] = useState(false);
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(
    () =>
      onSendToClaude((next) => {
        setCtx(next);
        setText(next.prefill ?? "");
        setSessions([]);
        setTarget(NEW);
        void terminalApi
          .list()
          .then((all) => {
            const list = receiversOf(Array.isArray(all) ? all : []);
            setSessions(list);
            const first = defaultReceiver(list);
            setTarget(first ? String(first.id) : NEW);
          })
          .catch(() => {});
      }),
    [],
  );

  const close = () => setCtx(null);
  const order = (id: number) => sessions.findIndex((s) => s.id === id) + 1;

  const send = async () => {
    if (!ctx || busy || !text.trim()) return;
    const message = composeMessage(t, ctx, text);
    setBusy(true);
    try {
      if (target === NEW) {
        await runPromptInTerminal(projectId, message);
      } else {
        const id = Number(target);
        await deliverToSession(id, message);
        toast.info(t("send.sent", { n: order(id) }), {
          actions: [
            {
              label: t("send.view"),
              onClick: () => {
                requestTermFocus(id);
                window.dispatchEvent(new CustomEvent(NAV_BUS.setView, { detail: "terminal" }));
              },
            },
          ],
        });
      }
      ctx.onSent?.();
      close();
    } catch (e) {
      toast.destructive(t("send.failed", { error: tError(toAppError(e)) }));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  const kindWord = ctx ? t(`send.kind.${ctx.kind}` as const) : "";
  return (
    <AppDialog open={ctx != null} onClose={close} label={t("send.title")} width={480} initialFocusRef={textRef}>
      {ctx ? (
        <div className="send">
          <div className="send-head">
            <b>{t("send.title")}</b>
            <kbd className="kbd">{kbd("⌘↩")}</kbd>
          </div>
          <p className="send-ctx">
            <span className="send-ctx-k">{t("send.context")}</span> {kindWord} 「{ctx.label}」
            {ctx.note ? ` · ${ctx.note}` : ""}
          </p>
          <textarea
            ref={textRef}
            className="send-text"
            rows={4}
            value={text}
            placeholder={t("send.placeholder")}
            aria-label={t("send.placeholder")}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <div className="send-foot">
            <label className="send-target">
              <span>{t("send.target")}</span>
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                {sessions.map((s, i) => (
                  <option key={s.id} value={String(s.id)}>
                    {t("send.session", { n: i + 1, label: s.label, word: sessionWord(t, s) })}
                  </option>
                ))}
                <option value={NEW}>{t("send.newSession")}</option>
              </select>
            </label>
            <span className="send-sp" />
            <button type="button" className="btn sm" onClick={close}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn primary sm"
              {...blocked(text.trim() ? null : t("send.needsText"))}
              disabled={busy}
              onClick={() => void send()}
            >
              {t("send.submit")}
            </button>
          </div>
        </div>
      ) : null}
    </AppDialog>
  );
}
