import React from 'react';
import { extractUrls, splitTextWithLinks } from '../../utils/chatLinkUtils';
import { ChatLinkPreview } from './ChatLinkPreview';

type Props = {
  body: string;
  compact?: boolean;
};

export const ChatMessageBody: React.FC<Props> = ({ body, compact = false }) => {
  const parts = splitTextWithLinks(body);
  const previewUrls = extractUrls(body, 2);

  return (
    <div className="min-w-0">
      <p className="whitespace-pre-wrap break-words text-xs leading-relaxed sm:text-sm">
        {parts.map((part, idx) =>
          part.type === 'link' ? (
            <a
              key={`${part.href}-${idx}`}
              href={part.href}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all font-medium text-sky-300 underline decoration-sky-500/40 underline-offset-2 hover:text-sky-200"
            >
              {part.value}
            </a>
          ) : (
            <span key={`t-${idx}`}>{part.value}</span>
          )
        )}
      </p>
      {previewUrls.map((url) => (
        <ChatLinkPreview key={url} url={url} compact={compact} />
      ))}
    </div>
  );
};
