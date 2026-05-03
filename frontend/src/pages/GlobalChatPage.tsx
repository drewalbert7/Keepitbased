import React from 'react';
import { ChatConversation } from '../components/chat/ChatConversation';

/**
 * Full-page chat (same data as floating dock — single ChatProvider in App).
 */
const GlobalChatPage: React.FC = () => {
  return (
    <div className="mx-auto flex h-[calc(100dvh-3.5rem)] max-w-4xl flex-col px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-4 sm:px-6">
      <ChatConversation />
    </div>
  );
};

export default GlobalChatPage;
