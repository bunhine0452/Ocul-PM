// 컴포저 — 지시를 적는 자리 (대기줄·붙임·자동완성·노브·보내기).
//
// `AcpConversation.tsx` 에서 갈라 나온 **순수 뷰**다 (v3-surface {#acp-split}).
// 동작 변경은 없다: 상태는 전부 위가 들고 있고 여기는 그리기와 이벤트 전달만
// 한다. 그래서 props 가 많다 — 줄이려고 상태를 이리로 내리면 "어느 대화의
// 것인가"를 판정하는 자리가 둘이 되고, 그 이중화가 이 화면이 겪은 오배송
// 사고의 뿌리였다.

import type React from "react";
import { ArrowUp, Clock, Paperclip, Square, Terminal, X } from "@/components/Icons";
import { useT } from "@/i18n";
import type { AcpCommand, AcpConfigOption, AcpImage } from "@/lib/bindings";
import type { UsageState } from "./useSessionMaps";
import {
  supportsUltracode,
  PRIMARY_CONFIG_IDS,
  ConfigControl,
  MoreSettings,
  EffortControl,
} from "./ConfigControls";
import { ImageAttachment } from "./Attachments";

/**
 * 아직 안 보낸 이미지 — 프로토콜 몫(`block`) + 화면 몫(이름·픽셀 크기).
 *
 * 이름과 크기를 어댑터에 보낼 자리가 없어서 따로 든다. 화면에는 필요하다:
 * "image.png 1104×172" 가 있어야 무엇을 붙였는지 열어 보지 않고 안다.
 */
export interface PendingImage {
  block: AcpImage;
  name: string;
  width: number;
  height: number;
}

/** 아직 안 보낸 대기줄 한 줄 — 어느 대화 몫인지 함께 든다. */
export interface QueuedPrompt {
  text: string;
  sessionId: string | null;
}

export interface ComposerProps {
  /** 지금 보고 있는 대화 — 대기줄 칩을 제 대화 것만 그리는 잣대. */
  activeId: string;
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  /**
   * 사용자가 **손으로 고쳤다**. `setDraft` 와 갈라 두는 이유는 되부르기(↑) 때문:
   * 불러온 문장을 한 글자라도 고치면 그 순간 되부르기는 끝난 것이고, 그 판단은
   * 원장(`promptHistory`)을 든 위에서만 할 수 있다.
   */
  onEdit: (next: string) => void;
  busy: boolean;
  dropActive: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  queue: QueuedPrompt[];
  setQueue: React.Dispatch<React.SetStateAction<QueuedPrompt[]>>;
  images: PendingImage[];
  setImages: React.Dispatch<React.SetStateAction<PendingImage[]>>;
  attachments: string[];
  setAttachments: React.Dispatch<React.SetStateAction<string[]>>;
  attach: () => void;
  slash: AcpCommand[] | null;
  slashIndex: number;
  setSlashIndex: React.Dispatch<React.SetStateAction<number>>;
  pickCommand: (command: AcpCommand) => void;
  mentions: string[] | null;
  mentionIndex: number;
  setMentionIndex: React.Dispatch<React.SetStateAction<number>>;
  pickMention: (path: string) => void;
  usage: UsageState | null;
  options: AcpConfigOption[];
  ultracode: boolean;
  setUltracode: (on: boolean) => void;
  setOption: (configId: string, value: string) => void;
  onUsagePanel: () => void;
  cancel: () => void;
  send: () => void;
}

export function Composer({
  activeId,
  draft,
  setDraft,
  onEdit,
  busy,
  dropActive,
  inputRef,
  onKeyDown,
  onPaste,
  queue,
  setQueue,
  images,
  setImages,
  attachments,
  setAttachments,
  attach,
  slash,
  slashIndex,
  setSlashIndex,
  pickCommand,
  mentions,
  mentionIndex,
  setMentionIndex,
  pickMention,
  usage,
  options,
  ultracode,
  setUltracode,
  setOption,
  onUsagePanel,
  cancel,
  send,
}: ComposerProps) {
  const { t } = useT();
  return (
  <div className="ai-compose agent">
    <div className={"composer agent" + (dropActive ? " dropping" : "")}>
      {dropActive ? (
        <div className="composer-drop" aria-hidden="true">
          <Paperclip size={14} />
          {t("acp.dropHint")}
        </div>
      ) : null}
      {queue.length ? (
        <div className="queue-row">
          {/* 이 대화 몫만 보인다 — 다른 대화의 대기분이 여기 떠 있으면
              "내가 보낸 적 없는 문장"이 붙어 있는 것처럼 읽힌다. */}
          {queue.map((item, i) =>
            (item.sessionId ?? "") !== activeId ? null : (
              <span key={i} className="queue-chip">
                <Clock size={11} />
                {/* 본문 클릭 = **입력창으로 회수** — 잘못 큐에 넣었을 때의
                    정답은 삭제가 아니라 이어서 고치는 것이다. X 만 폐기. */}
                <button
                  type="button"
                  className="queue-chip-text"
                  title={t("acp.queue.restore")}
                  onClick={() => {
                    setQueue((prev) => prev.filter((_, at) => at !== i));
                    setDraft((prev) => (prev.trim() ? prev : item.text));
                    inputRef.current?.focus();
                  }}
                >
                  {item.text}
                </button>
                <button
                  type="button"
                  className="queue-chip-x"
                  aria-label={t("acp.queue.remove")}
                  title={t("acp.queue.remove")}
                  onClick={() => setQueue((prev) => prev.filter((_, at) => at !== i))}
                >
                  <X size={11} />
                </button>
              </span>
            ),
          )}
        </div>
      ) : null}

      {images.length ? (
        <div className="image-row">
          {/* 보낸 뒤 대화에 남는 칩과 **같은 모양**이다 — 붙일 때와 보낸
              뒤가 다르게 생기면 같은 것인지 매번 다시 확인해야 한다.
              누르면 크게 보이고, 지우기는 호버해야 나오는 X 로. */}
          {images.map((image, i) => (
            <span key={i} className="pending-image">
              <ImageAttachment
                image={{
                  src: `data:${image.block.mime_type};base64,${image.block.data_base64}`,
                  name: image.name,
                  width: image.width,
                  height: image.height,
                }}
              />
              <button
                type="button"
                className="pending-image-x"
                aria-label={t("acp.image.remove")}
                title={t("acp.image.remove")}
                onClick={() => setImages((prev) => prev.filter((_, at) => at !== i))}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {attachments.length ? (
        <div className="attach-row">
          {attachments.map((path) => (
            <button
              key={path}
              type="button"
              className="attach-chip"
              title={t("acp.attach.remove")}
              onClick={() => setAttachments((prev) => prev.filter((p) => p !== path))}
            >
              <span className="attach-chip-name">{path.split("/").pop()}</span>
              <X size={11} />
            </button>
          ))}
        </div>
      ) : null}

      <div style={{ position: "relative" }}>
        {slash ? (
          <div className="mention" role="listbox" aria-label={t("acp.slash.aria")}>
            {slash.length ? (
              slash.map((command, i) => (
                <button
                  key={command.name}
                  type="button"
                  role="option"
                  aria-selected={i === slashIndex}
                  className={"settings-row" + (i === slashIndex ? " active" : "")}
                  onMouseEnter={() => setSlashIndex(i)}
                  onClick={() => pickCommand(command)}
                >
                  <span className="settings-row-icon">
                    <Terminal size={13} />
                  </span>
                  <span className="settings-row-body">
                    <span className="settings-row-name">
                      /{command.name}
                      {command.hint ? (
                        <span className="slash-hint"> {command.hint}</span>
                      ) : null}
                    </span>
                    {command.description ? (
                      <span className="settings-row-desc">{command.description}</span>
                    ) : null}
                  </span>
                </button>
              ))
            ) : (
              <div className="mention-empty">{t("acp.slash.empty")}</div>
            )}
          </div>
        ) : null}

        {mentions ? (
          <div className="mention" role="listbox" aria-label={t("acp.mention.aria")}>
            {mentions.length ? (
              mentions.map((path, i) => {
                const name = path.split("/").pop() ?? path;
                return (
                  <button
                    key={path}
                    type="button"
                    role="option"
                    aria-selected={i === mentionIndex}
                    className={"mention-item" + (i === mentionIndex ? " active" : "")}
                    onMouseEnter={() => setMentionIndex(i)}
                    onClick={() => pickMention(path)}
                  >
                    <span className="mention-name">{name}</span>
                    <span>{path}</span>
                  </button>
                );
              })
            ) : (
              <div className="mention-empty">{t("acp.mention.empty")}</div>
            )}
          </div>
        ) : null}

        {/* `.composer-input` 은 **래퍼** 클래스다 — textarea 에 직접 걸면
            스타일이 하나도 먹지 않는다(초기 구현의 실수). */}
        <div className="composer-input">
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          placeholder={busy ? t("acp.placeholderBusy") : t("acp.placeholder")}
          aria-label={t("acp.inputAria")}
          onChange={(e) => onEdit(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        </div>
      </div>

      <div className="composer-foot">
        <button
          type="button"
          className="btn icon ghost"
          onClick={() => attach()}
          aria-label={t("acp.attach.add")}
          title={t("acp.attach.add")}
        >
          <Paperclip size={14} />
        </button>
        <span style={{ flex: 1 }} />
        {/* 노브 묶음은 **한 덩어리로 접힌다**.
            창을 좁히면 이 줄이 압착되면서 "7% · $0.30" 이 두 줄로 꺾이고
            보내기 버튼이 카드 밖으로 밀려났다. 클립·중지·보내기는 자리를
            지키고, 가운데만 가로로 도망가게 한다 (툴바와 같은 수법). */}
        <div className="composer-knobs">
        {/* 사용량 표시가 곧 버튼이다 — 숫자를 보다가 "자세히"를 누르고
            싶어지는 자리가 바로 여기다. */}
        {/* 이 대화가 컨텍스트를 얼마나 먹었는지. 계정 한도는 툴바 계기의
            몫이라 여기서는 **이 대화 이야기만** 한다. */}
        {usage ? (
          <button
            type="button"
            className="usage-btn"
            onClick={() => onUsagePanel()}
            title={t("acp.usageTitle")}
          >
            {Math.round((usage.used / Math.max(usage.size, 1)) * 100)}%
            {usage.costUsd != null ? ` · $${usage.costUsd.toFixed(2)}` : ""}
          </button>
        ) : null}
        {PRIMARY_CONFIG_IDS.map((id) => {
          const option = options.find((o) => o.id === id);
          if (!option) return null;
          // Effort 만 슬라이더다 — 값에 **순서**가 있기 때문. 순서 있는
          // 값을 목록으로 고르게 하면 "지금이 어느 정도인지"가 안 보인다.
          return id === "effort" ? (
            <EffortControl
              key={id}
              option={option}
              onChange={setOption}
              ultracode={ultracode}
              onUltracode={setUltracode}
              ultraReady={supportsUltracode(
                options.find((o) => o.id === "model")?.current,
              )}
            />
          ) : (
            <ConfigControl key={id} option={option} onChange={setOption} />
          );
        })}
        <MoreSettings
          options={options.filter(
            (o) => !PRIMARY_CONFIG_IDS.includes(o.id as (typeof PRIMARY_CONFIG_IDS)[number]),
          )}
          onChange={setOption}
        />
        </div>
        {busy ? (
          <button
            type="button"
            className="btn icon composer-stop"
            onClick={cancel}
            aria-label={t("acp.cancelEsc")}
            title={t("acp.cancelEsc")}
          >
            <Square size={13} fill="currentColor" />
          </button>
        ) : null}
        <button
          type="button"
          className="btn icon composer-send"
          disabled={!draft.trim()}
          onClick={() => send()}
          aria-label={busy ? t("acp.queueSend") : t("acp.send")}
          title={busy ? t("acp.queueSend") : t("acp.send")}
        >
          <ArrowUp size={13} />
        </button>
      </div>
    </div>
  </div>
  );
}
