// AI 패널 대화 기록 커맨드 래퍼 (2026-10-01 `{#api-facades}`).
//
// 대화·메시지·플래너 제안 카드의 적용 상태는 SQLite 에 산다 — 다시 연 대화가
// 이미 적용한 제안을 「적용됨」 으로 보여 줄 수 있게.
import {
  commands,
  type ChatMessage,
  type Conversation,
  type ConversationAction,
} from "@/lib/bindings";
import { call } from "./invoke";

export const conversationsApi = {
  /** 이 프로젝트의 대화 (`null` = 프로젝트 밖 대화). */
  list: (projectId: number | null): Promise<Conversation[]> =>
    call("conversation_list", commands.conversationList(projectId)),
  create: (
    title: string,
    provider: string | null,
    model: string | null,
    projectId: number | null,
  ): Promise<Conversation> =>
    call("conversation_create", commands.conversationCreate(title, provider, model, projectId)),
  delete: (conversationId: number): Promise<null> =>
    call("conversation_delete", commands.conversationDelete(conversationId)),

  messages: (conversationId: number): Promise<ChatMessage[]> =>
    call("chat_message_list", commands.chatMessageList(conversationId)),
  appendMessage: (
    conversationId: number,
    role: string,
    content: string,
    provider: string | null,
    model: string | null,
  ): Promise<ChatMessage> =>
    call("chat_message_append", commands.chatMessageAppend(conversationId, role, content, provider, model)),

  /** 제안 카드의 적용 기록 (메시지 위치별). */
  actions: (conversationId: number): Promise<ConversationAction[]> =>
    call("list_conversation_actions", commands.listConversationActions(conversationId)),
  recordAction: (
    conversationId: number,
    messageIndex: number,
    status: string | null,
  ): Promise<ConversationAction> =>
    call("record_conversation_action", commands.recordConversationAction(conversationId, messageIndex, status)),
};
