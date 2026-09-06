// 말 걸기 — 로컬 명령 갈래, 세션 만들기, 대기줄, 스트림 페이싱, 뒷정리.
//
// `AcpConversation.tsx` 에서 갈라 나온 조각이다 (v3-surface {#acp-split}).
// 순수 이동이며 동작 변경은 없다.
//
// 인자가 많은 것은 줄일 수 있는 종류의 복잡도가 아니다. 이 함수의 어려움은
// **어느 대화로 가는가**를 한순간도 놓치지 않는 것이고(`aim` → `into`), 그
// 판정에 필요한 재료가 실제로 이만큼이다. 상태를 이리로 내리면 같은 판정을
// 두 곳에서 하게 되고, 그 이중화가 이 화면이 겪은 오배송 사고의 뿌리였다.

import { useCallback, useEffect, useRef } from "react";
import type React from "react";
import { Channel } from "@tauri-apps/api/core";

import { commands, type AcpCommand, type AcpEvent, type AcpImage, type AcpSession } from "@/lib/bindings";
// 사전은 **모듈 스토어**에서 바로 읽는다 — 이 훅이 돌려주는 `send` 는 클릭
// 시점에 불리는 콜백이라 언어가 바뀌어도 다시 만들 이유가 없다. `useT()` 를
// 쓰면 `t` 가 렌더마다 새 참조가 되어 `send` 가 굳지 못하고, 그 아이덴티티는
// 대기줄 배출 effect 까지 타고 흘러 같은 문장을 두 번 보낸다.
import { t } from "@/i18n";
import { tError } from "@/i18n/errors";
import { applyAcpEvent, closeTurn, openTurn, type AcpTurn } from "../acpTurns";
import { acpWorkingKey, noteAcpSignal } from "../acpBusyBus";
import { markSpoken, type ActivityLedger } from "../acpHistory";
import { titleFromPrompt } from "../acpTitle";
import { revealCount, splitAt } from "../streamPacer";
import { withUltracode } from "../ultracode";
import { requestUsagePanel } from "../usageBus";
import type { RecallState } from "../promptHistory";
import type { PermissionState } from "./shared";
import type { UsageState } from "./useSessionMaps";
import type { PendingImage, QueuedPrompt } from "./Composer";

/** 아직 안 만든 새 대화의 기록이 머무는 자리 (`session_id` 가 아직 없다). */
const SLATE = "";

export interface AcpSendArgs {
  projectId: number;
  provider: "claude" | "codex";
  codex: boolean;
  /** 지금 보고 있는 대화. `SLATE` 면 아직 안 만든 새 대화다. */
  activeId: string;
  currentSessionId: string | null;
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  attachments: string[];
  setAttachments: React.Dispatch<React.SetStateAction<string[]>>;
  images: PendingImage[];
  setImages: React.Dispatch<React.SetStateAction<PendingImage[]>>;
  setMentions: React.Dispatch<React.SetStateAction<string[] | null>>;
  setSlash: React.Dispatch<React.SetStateAction<AcpCommand[] | null>>;
  ultracode: boolean;
  queue: QueuedPrompt[];
  setQueue: React.Dispatch<React.SetStateAction<QueuedPrompt[]>>;
  busySessions: ReadonlySet<string>;
  markBusy: (id: string, on: boolean) => void;
  putError: (id: string, message: string | null) => void;
  putUsage: (id: string, usage: UsageState | null) => void;
  putPermission: (id: string, value: PermissionState | null) => void;
  editTurns: (id: string, update: (prev: AcpTurn[]) => AcpTurn[]) => void;
  setTranscripts: React.Dispatch<React.SetStateAction<Record<string, AcpTurn[]>>>;
  setSession: React.Dispatch<React.SetStateAction<AcpSession | null>>;
  setError: (message: string | null) => void;
  addTab: (id: string | null, title: string | null) => void;
  openSession: (sessionId: string) => Promise<void>;
  newConversation: () => void;
  openInTerminal: (prefill?: string) => void;
  /** 목록 순서를 잡아 두는 원장 — "실제로 말을 건" 시각만 올린다. */
  activityRef: React.RefObject<ActivityLedger>;
  /** 지금 화면이 그리는 대화의 세대 — 지난 로드의 재생분을 걸러 내는 표. */
  loadSeqRef: React.RefObject<number>;
  /** 마지막으로 보낸(보내려던) 지시 — 오류 뒤 "다시 보내기"가 쓴다. */
  lastSentRef: React.RefObject<string | null>;
  recallRef: React.RefObject<RecallState | null>;
  /** "이제부터 바닥이 관심사다" (`useThreadScroll`). */
  followBottom: () => void;
}

export function useAcpSend({
  projectId,
  provider,
  codex,
  activeId,
  currentSessionId,
  draft,
  setDraft,
  attachments,
  setAttachments,
  images,
  setImages,
  setMentions,
  setSlash,
  ultracode,
  queue,
  setQueue,
  busySessions,
  markBusy,
  putError,
  putUsage,
  putPermission,
  editTurns,
  setTranscripts,
  setSession,
  setError,
  addTab,
  openSession,
  newConversation,
  openInTerminal,
  activityRef,
  loadSeqRef,
  lastSentRef,
  recallRef,
  followBottom,
}: AcpSendArgs) {
  const send = useCallback(
    /**
     * `target` 은 **말을 걸 대화**다. 생략하면 지금 보고 있는 대화.
     *
     * 대기줄이 이걸 쓴다 — 뒤에 있는 대화의 줄이 풀릴 때 그 순간 화면이 어디를
     * 보고 있든 제 대화로 가야 한다. 예전에는 백엔드의 "활성 대화" 장부로
     * 보냈기 때문에 **턴이 끝나는 순간의 화면**이 수신자였다.
     */
    async (override?: string, target?: string) => {
      const text = (override ?? draft).trim();
      if (!text) return;
      /** 이 전송이 향하는 대화. `SLATE` 면 아직 만들지 않은 새 대화다. */
      const aim = target ?? activeId;
      /** 입력창에서 곧장 보내는가 — 스크롤·첨부·초안은 그때만 건드린다. */
      const fromComposer = override === undefined;

      // `/usage` 는 대화가 아니라 **계기판**이다. 채팅에 남기면 긴 표가 대화를
      // 밀어내고, 다시 보려면 스크롤을 거슬러 올라가야 한다 — 위젯으로 보낸다.
      if (text === "/usage") {
        setDraft("");
        setSlash(null);
        requestUsagePanel();
        return;
      }

      // `/clear` 를 그냥 보내면 CLI 쪽 문맥만 비고 **화면은 그대로** 남아 둘이
      // 어긋난다. 우리 쪽에서 세션을 새로 여는 것이 같은 의도의 정확한 실행이다.
      if (text === "/clear") {
        setDraft("");
        setSlash(null);
        newConversation();
        return;
      }

      // `/continue` — CLI 의 `--continue` 와 같은 뜻: 최근 대화로 돌아간다.
      //
      // **지금 열려 있는 것은 후보에서 뺀다.** 이 명령을 치는 이유가 "여기 말고
      // 아까 거기"이기 때문이다. 앱을 켜면 빈 세션이 자동으로 열리는데, 그것이
      // 목록에 실리든 안 실리든 이 규칙이면 둘 다 원하는 결과가 나온다.
      if (text === "/continue") {
        setDraft("");
        setSlash(null);
        void (async () => {
          const res = await commands.acpListSessions(projectId, provider);
          if (res.status !== "ok") {
            setError(tError(res.error));
            return;
          }
          const previous = res.data.filter((item) => item.id !== currentSessionId);
          if (!previous.length) {
            setError(t("acp.continueNone"));
            return;
          }
          await openSession(previous[0].id);
        })();
        return;
      }

      // `/remote-control` (`/rc`) — 어댑터가 광고하는 명령은 아니지만 통로는 있다.
      //
      // 어댑터가 `session/new` 의 `_meta.claudeCode.options.extraArgs` 를 CLI
      // 플래그로 그대로 흘려보내고, CLI 에 `--remote-control` 이 있다. 다만
      // 질의를 만들 때 정해지는 값이라 **켜져 있는 대화에는 못 붙인다** — 새
      // 대화를 열어야 한다. 실패하면 백엔드가 원래 대화를 되돌려 놓는다.
      // `/remote-control` (`/rc`) — **터미널로 보낸다.**
      //
      // ACP 안에서도 해 봤다(2026-08-15): `_meta.claudeCode.options.extraArgs` 로
      // `--remote-control` 을 넘기면 어댑터가 CLI 플래그로 흘려 주고, 세션은
      // 오류 없이 열린다. 그런데 **짝짓기 안내가 어디에도 안 나온다** — 대화에도,
      // 어댑터 stderr(앱 로그)에도. 그 안내는 CLI 가 자기 화면에 그리는 것이라
      // 프로토콜로 옮겨질 데이터가 애초에 없다.
      //
      // 터미널에서는 그 화면이 곧 우리 화면이라 그냥 된다.
      if (!codex && (text === "/remote-control" || text === "/rc")) {
        setDraft("");
        setSlash(null);
        openInTerminal("/remote-control");
        return;
      }

      // **그 대화가** 도는 중일 때만 줄을 선다. 옆 대화가 도는 것은 상관없다 —
      // 예전에는 화면에 하나뿐인 표시를 봤기 때문에, A 가 도는 동안 B 에 친 말이
      // A 가 끝날 때까지 멎어 있었다.
      if (busySessions.has(aim)) {
        setQueue((prev) => [...prev, { text, sessionId: aim === SLATE ? null : aim }]);
        if (fromComposer) setDraft("");
        recallRef.current = null;
        return;
      }

      // 보내는 순간부터 이 화면은 새 세대다 — 아직 흐르고 있는 재생분이 내
      // 질문 위에 지난 대화를 덧그리면 안 된다. **보고 있는 대화일 때만** 올린다:
      // 뒤에 있는 대화의 대기줄이 풀린 것이라면, 지금 화면에서 읽고 있는 대화의
      // `session/load` 재생을 남의 사정으로 끊는 셈이 된다.
      if (aim === activeId) loadSeqRef.current += 1;
      // 아직 안 만든 새 대화라면 **지금** 만든다 (새 대화 버튼은 화면만 비운다).
      // 만들어야만 보낼 id 가 생긴다 — `acp_prompt` 는 이제 대화를 인자로 받고,
      // 인자가 없으면 백엔드 장부를 따르는데 그 장부는 **직전 대화**를 가리킨다.
      let resolved: string | null = aim === SLATE ? null : aim;
      if (!resolved) {
        // 세션을 만드는 동안에도 이 자리는 이미 "보내는 중"이다 — 표시가 없으면
        // 사용자가 한 번 더 누른다.
        markBusy(SLATE, true);
        const opened = await commands.acpNewSession(projectId, provider);
        markBusy(SLATE, false);
        if (opened.status !== "ok") {
          putError(SLATE, tError(opened.error));
          return;
        }
        setSession(opened.data);
        resolved = opened.data.session_id;
        // 빈 자리에 있던 기록은 이제 이 대화의 것이다.
        if (resolved) {
          const id = resolved;
          setTranscripts((prev) => ({ ...prev, [id]: prev[SLATE] ?? [], [SLATE]: [] }));
        }
      }
      // 여기까지 왔는데 id 가 없으면 보낼 곳이 없다 — 조용히 나가면 입력만
      // 사라지고 아무 일도 안 일어난 것처럼 보인다.
      if (!resolved) {
        putError(SLATE, t("acp.sendNoSession"));
        return;
      }
      const into = resolved;

      // 이 대화에 실제로 말을 걸었다 — 이제 진짜로 가장 최근이다.
      markSpoken(activityRef.current, into, new Date().toISOString());
      // 어댑터의 제목은 턴이 끝난 뒤에야 온다. 그때까지 "제목 없는 대화"로 두지
      // 않는다 — 첫 마디가 곧 그 대화가 무엇인지다(CLI 도 그렇게 연다). 이미
      // 있는 탭은 `addTab` 이 건드리지 않으므로, 이어 가는 대화의 이름은 그대로다.
      addTab(into, titleFromPrompt(text));
      const outgoing = withUltracode(text, ultracode);
      // 첨부는 **입력창의 것**이다 — 대기줄에서 꺼낸 문장에 지금 얹혀 있는 파일을
      // 딸려 보내면, 다른 대화에 붙여 두었던 것이 엉뚱한 대화로 간다.
      const sending = fromComposer ? attachments : [];
      const sendingImages = fromComposer ? images : [];
      const sendingBlocks: AcpImage[] = sendingImages.map((image) => image.block);
      lastSentRef.current = text;
      recallRef.current = null;
      if (fromComposer) {
        setDraft("");
        setAttachments([]);
        setImages([]);
        setMentions(null);
        setSlash(null);
      }
      putError(into, null);
      editTurns(into, (prev) =>
        openTurn(
          prev,
          text,
          {
            attachments: sending,
            images: sendingImages.map((image) => ({
              src: `data:${image.block.mime_type};base64,${image.block.data_base64}`,
              name: image.name,
              width: image.width,
              height: image.height,
            })),
          },
          Date.now(),
        ),
      );
      // 내가 방금 말을 걸었다 — 이제 바닥이 관심사다. 단 **보고 있는 대화일
      // 때만**: 뒤에 있는 대화의 대기줄이 풀린 것이라면, 화면에 있지도 않은
      // 대화 때문에 지금 읽던 자리가 바닥으로 끌려간다.
      if (aim === activeId) followBottom();
      markBusy(into, true);

      /**
       * **도착과 표시를 끊는다.**
       *
       * 예전에는 프레임마다 "그 사이 도착한 것"을 통째로 얹었다. 그래서 화면의
       * 리듬이 곧 네트워크의 리듬이었다 — 한 덩어리가 오면 한 덩어리가 툭
       * 튀어나오고 조용하면 화면도 멈춘다. rAF 는 *언제* 그릴지만 골랐지
       * *얼마나* 그릴지는 안 골랐다.
       *
       * 이제 도착분은 대기줄에 쌓고, 매 프레임 대기줄에서 **자기 속도로** 꺼내
       * 쓴다. 밀릴수록 빨라지므로 뒤처지지도 않는다 (streamPacer.ts).
       */
      const queue = { text: "", thought: "", frame: null as number | null, done: false };

      const pump = () => {
        queue.frame = null;
        const takeText = queue.done ? queue.text.length : revealCount(queue.text.length);
        const takeThought = queue.done ? queue.thought.length : revealCount(queue.thought.length);
        if (!takeText && !takeThought) return;

        const [shownText, restText] = splitAt(queue.text, takeText);
        const [shownThought, restThought] = splitAt(queue.thought, takeThought);
        queue.text = restText;
        queue.thought = restThought;

        editTurns(into, (prev) => {
          let next = prev;
          const now = Date.now();
          if (shownText) next = applyAcpEvent(next, { kind: "chunk", text: shownText }, false, now);
          if (shownThought) {
            next = applyAcpEvent(next, { kind: "thought", text: shownThought }, false, now);
          }
          return next;
        });

        // 남았으면 계속 돈다 — 도착이 멎어도 대기줄이 빌 때까지 흐른다.
        if (queue.text || queue.thought) queue.frame = requestAnimationFrame(pump);
      };

      const schedule = () => {
        if (queue.frame === null) queue.frame = requestAnimationFrame(pump);
      };

      /** 남은 것을 즉시 다 내보낸다 (순서가 중요한 사건 앞·턴 종료). */
      const drain = () => {
        if (queue.frame !== null) {
          cancelAnimationFrame(queue.frame);
          queue.frame = null;
        }
        queue.done = true;
        if (queue.text || queue.thought) pump();
        queue.done = false;
      };

      const channel = new Channel<AcpEvent>();
      /** 이 대화의 바쁨 신호가 붙는 자리 (`acpBusyBus` 와 같은 키 규칙). */
      const busyKey = acpWorkingKey(projectId, into === SLATE ? null : into, provider);
      channel.onmessage = (event) => {
        // **살아 있다는 근거를 남긴다** ({#working-source}).
        //
        // "도는 중"만으로는 스트림이 끊긴 것과 진짜 도는 것을 구별할 수 없다.
        // 이벤트가 하나 올 때마다 출처를 갱신하고, 멎으면 버스의 침묵 타이머가
        // 「모른다」로 내린다 — 화면은 그때 모른다고 말한다.
        noteAcpSignal(busyKey, event.kind === "chunk" || event.kind === "thought");

        // 이미 다른 대화로 넘어갔어도 **이 대화의 기록에는 계속 쌓인다** —
        // `target` 이 고정돼 있어서, 돌아오면 그 자리에 그대로 있다.
        if (event.kind === "chunk" || event.kind === "thought") {
          if (event.kind === "chunk") queue.text += event.text;
          else queue.thought += event.text;
          schedule();
          return;
        }

        // 텍스트가 아닌 사건(툴콜·승인·종료)은 순서가 중요하다 — 대기줄을 먼저
        // 비우고 나서 적용해야 카드가 문장 앞으로 튀지 않는다.
        drain();
        editTurns(into, (prev) => applyAcpEvent(prev, event, false, Date.now()));
        if (event.kind === "usage") {
          putUsage(into, { used: event.used, size: event.size, costUsd: event.cost_usd });
        } else if (event.kind === "failed") {
          putError(into, event.message);
        } else if (event.kind === "permission") {
          putPermission(into, event);
        } else if (event.kind === "config_changed") {
          // 설정은 **그 대화의 것**이다 — 뒤에서 도는 대화가 모델을 바꿨다고
          // 보고 있던 대화의 셀렉터를 갈아 끼우면 화면이 거짓을 말한다.
          setSession((prev) =>
            prev && (prev.session_id ?? SLATE) === into ? { ...prev, options: event.options } : prev,
          );
        }
      };

      try {
        const res = await commands.acpPrompt(
          projectId,
          provider,
          into,
          outgoing,
          sending,
          sendingBlocks,
          channel,
        );
        if (res.status === "error") putError(into, tError(res.error));
      } finally {
        drain();
        // 커맨드가 끝났으면 턴도 끝났다 — 이후 도착하는 청크는 받지 않는다.
        // 승인 카드도 함께 치운다: 백엔드가 미결 요청을 취소로 닫았으므로
        // 남겨 두면 눌러도 아무 일이 안 일어나는 유령 카드가 된다.
        editTurns(into, (prev) => closeTurn(prev, Date.now()));
        putPermission(into, null);
        markBusy(into, false);
      }
    },
    // eslint 의존성 목록: 위 인자 전부. 하나라도 빠지면 이 함수가 지난 대화·
    // 지난 초안을 들고 굳는다.
    [
      draft, busySessions, codex, projectId, provider, attachments, images, ultracode,
      activeId, currentSessionId, openSession, newConversation, addTab, editTurns,
      openInTerminal, markBusy, putError, putUsage, putPermission, setDraft, setSlash,
      setQueue, setAttachments, setImages, setMentions, setSession, setTranscripts,
      setError, activityRef, loadSeqRef, lastSentRef, recallRef, followBottom,
    ],
  );

  // 턴이 끝나면 그 대화의 큐에서 맨 앞을 꺼내 보낸다. **대화마다 하나씩** —
  // 한 대화 안에서 한꺼번에 밀어 넣으면 사용자가 중간에서 멈출 수 없다.
  //
  // 예전에는 "지금 열려 있는 대화의 것만" 나갔다. 대화가 하나만 돌던 때는 그게
  // 유일하게 안전한 규칙이었다 — 보낼 곳을 백엔드 장부가 정했으니 다른 대화
  // 몫을 꺼내면 오배송이었다. 이제 `send` 가 대화를 직접 짚으므로, 뒤에 있는
  // 대화도 제 턴이 끝나는 대로 줄이 풀린다.
  //
  // `drainingRef` 가 대화별 집합인 이유: 이 effect 는 `send` 의 아이덴티티(=입력할
  // 때마다 바뀐다)에도 걸려 있고 StrictMode 는 effect 를 두 번 돌린다. 가드가
  // 없으면 같은 문장이 두 번 나간다.
  const drainingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const item of queue) {
      const id = item.sessionId ?? SLATE;
      // 아직 만들지 않은 대화(빈 자리)의 줄은 **그 화면을 보고 있을 때만** 푼다 —
      // 안 보는 사이에 세션이 생기고 화면이 그리로 끌려가면 안 된다.
      if (id === SLATE && activeId !== SLATE) continue;
      if (busySessions.has(id) || drainingRef.current.has(id)) continue;
      drainingRef.current.add(id);
      setQueue((prev) => prev.filter((queued) => queued !== item));
      void send(item.text, id).finally(() => {
        drainingRef.current.delete(id);
      });
    }
  }, [busySessions, queue, send, activeId, setQueue]);

  return send;
}
