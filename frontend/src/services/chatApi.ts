import axios from 'axios';

/** Must match server allowlist in `backend/routes/chat.js` */
export const CHAT_REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '🔥', '👀', '🙏', '💯'] as const;

export type ChatReactionAgg = {
  emoji: string;
  count: number;
  userIds: number[];
};

export type ChatMessage = {
  id: string;
  userId: number;
  displayName: string;
  body: string;
  createdAt: string;
  reactions: ChatReactionAgg[];
  optimistic?: boolean;
};

export async function fetchChatMessages(params?: { limit?: number; before?: string }): Promise<ChatMessage[]> {
  const { data } = await axios.get<{ messages: ChatMessage[] }>('/chat/messages', {
    params: { limit: params?.limit ?? 50, before: params?.before }
  });
  return data.messages || [];
}

export async function postChatMessage(body: string): Promise<ChatMessage> {
  const { data } = await axios.post<{ message: ChatMessage }>('/chat/messages', { body });
  return data.message;
}

export async function toggleChatReaction(messageId: string, emoji: string): Promise<{ toggled: 'on' | 'off' }> {
  const { data } = await axios.post<{ toggled: 'on' | 'off' }>('/chat/reactions/toggle', { messageId, emoji });
  return data;
}
