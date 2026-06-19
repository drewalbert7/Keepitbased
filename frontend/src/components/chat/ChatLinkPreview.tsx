import React, { useEffect, useState } from 'react';
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import { fetchLinkPreview, type ChatLinkPreviewData } from '../../services/chatApi';

type Props = {
  url: string;
  compact?: boolean;
};

export const ChatLinkPreview: React.FC<Props> = ({ url, compact = false }) => {
  const [preview, setPreview] = useState<ChatLinkPreviewData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setFailed(false);
    void fetchLinkPreview(url)
      .then((data) => {
        if (!cancelled) setPreview(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (failed) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-black/25 px-2.5 py-2 text-xs text-sky-300 hover:border-sky-500/30 hover:bg-sky-950/40"
      >
        <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">{url}</span>
      </a>
    );
  }

  if (!preview) {
    return (
      <div
        className={`mt-2 animate-pulse rounded-lg border border-white/[0.06] bg-black/20 ${
          compact ? 'h-14' : 'h-[72px]'
        }`}
        aria-hidden
      />
    );
  }

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group mt-2 flex overflow-hidden rounded-lg border border-white/[0.1] bg-[#0a0e14]/90 transition hover:border-sky-500/35 hover:bg-[#0d1520]"
    >
      {preview.image ? (
        <div
          className={`shrink-0 bg-black/40 ${compact ? 'h-[72px] w-[72px]' : 'h-[88px] w-[88px]'}`}
          style={{
            backgroundImage: `url(${preview.image})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center'
          }}
          role="presentation"
        />
      ) : null}
      <div className="min-w-0 flex-1 px-2.5 py-2">
        <p className="truncate text-[10px] font-medium uppercase tracking-wide text-kib-muted">
          {preview.siteName || 'Link'}
        </p>
        <p className="mt-0.5 line-clamp-2 text-xs font-semibold leading-snug text-kib-fg group-hover:text-sky-100">
          {preview.title}
        </p>
        {preview.description ? (
          <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-kib-muted">{preview.description}</p>
        ) : null}
      </div>
    </a>
  );
};
