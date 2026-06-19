import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChatBubbleLeftRightIcon, MinusIcon, ArrowsPointingOutIcon } from '@heroicons/react/24/outline';
import { useChat } from '../../contexts/ChatContext';
import { ChatConversation } from './ChatConversation';

const STORAGE_KEY = 'kib-chat-dock-v1';
const DEFAULT_W = 380;
const DEFAULT_H = 480;

type DockState = {
  x: number;
  y: number;
  w: number;
  h: number;
  minimized: boolean;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function loadState(): Partial<DockState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<DockState>;
  } catch {
    return {};
  }
}

function saveState(s: DockState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

function defaultPosition(): { x: number; y: number } {
  if (typeof window === 'undefined') return { x: 24, y: 96 };
  const w = DEFAULT_W;
  const h = DEFAULT_H;
  return {
    x: clamp(window.innerWidth - w - 16, 8, window.innerWidth - w - 8),
    y: clamp(window.innerHeight - h - 24, 72, window.innerHeight - h - 8)
  };
}

export const FloatingChatDock: React.FC = () => {
  const { configured, onlineCount } = useChat();
  const saved = loadState();
  const def = defaultPosition();
  const [minimized, setMinimized] = useState(() => saved.minimized ?? true);
  const [pos, setPos] = useState(() => ({
    x: typeof saved.x === 'number' ? saved.x : def.x,
    y: typeof saved.y === 'number' ? saved.y : def.y,
    w: typeof saved.w === 'number' ? clamp(saved.w, 300, 560) : DEFAULT_W,
    h: typeof saved.h === 'number' ? clamp(saved.h, 320, 720) : DEFAULT_H
  }));

  useEffect(() => {
    saveState({ ...pos, minimized });
  }, [pos.x, pos.y, pos.w, pos.h, minimized]);

  useEffect(() => {
    const onResize = () => {
      setPos((p) => ({
        ...p,
        x: clamp(p.x, 8, window.innerWidth - p.w - 8),
        y: clamp(p.y, 8, window.innerHeight - p.h - 8)
      }));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !minimized) setMinimized(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [minimized]);

  const onHeaderMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-chat-dock-control]')) return;
    e.preventDefault();
    const startX = pos.x;
    const startY = pos.y;
    const mx0 = e.clientX;
    const my0 = e.clientY;
    const move = (ev: MouseEvent) => {
      setPos((p) => ({
        ...p,
        x: clamp(startX + ev.clientX - mx0, 8, window.innerWidth - p.w - 8),
        y: clamp(startY + ev.clientY - my0, 8, window.innerHeight - p.h - 8)
      }));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = pos.w;
    const startH = pos.h;
    const topY = pos.y;
    const move = (ev: MouseEvent) => {
      const dw = ev.clientX - startX;
      const dh = ev.clientY - startY;
      setPos((p) => ({
        ...p,
        w: clamp(startW + dw, 300, 560),
        h: clamp(startH + dh, 320, Math.min(720, window.innerHeight - topY - 16))
      }));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  if (minimized) {
    return (
      <div className="pointer-events-none fixed inset-0 z-[100] flex items-end justify-end p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pr-[max(1rem,env(safe-area-inset-right))]">
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/[0.12] bg-kib-card/95 px-4 py-2.5 text-sm font-semibold text-kib-fg shadow-xl backdrop-blur-md transition hover:border-kib-cyber/40 hover:bg-kib-surface"
        >
          <ChatBubbleLeftRightIcon className="h-5 w-5 text-kib-cyber" aria-hidden />
          Chat
          {configured && onlineCount > 0 ? (
            <span className="rounded-full bg-white/[0.1] px-2 py-0.5 text-[11px] font-medium tabular-nums text-kib-muted">
              {onlineCount} online
            </span>
          ) : null}
        </button>
      </div>
    );
  }

  return (
    <div
      className="fixed z-[100] flex flex-col overflow-hidden rounded-xl border border-white/[0.1] bg-[#0d1117]/98 shadow-2xl shadow-black/60 backdrop-blur-md"
      style={{
        left: pos.x,
        top: pos.y,
        width: pos.w,
        height: pos.h,
        maxHeight: 'min(85vh, 720px)'
      }}
    >
      <header
        className="flex shrink-0 cursor-move select-none items-center gap-2 border-b border-white/[0.08] bg-kib-surface/95 px-2 py-2 sm:px-3"
        onMouseDown={onHeaderMouseDown}
        role="banner"
      >
        <ChatBubbleLeftRightIcon className="h-4 w-4 shrink-0 text-kib-cyber" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-kib-fg">Live chat</p>
          {configured ? (
            <p className="truncate text-[10px] text-kib-muted">
              <span className="tabular-nums text-kib-fg/90">{onlineCount}</span> online · drag header to move
            </p>
          ) : (
            <p className="truncate text-[10px] text-kib-muted">Not configured</p>
          )}
        </div>
        <button
          type="button"
          data-chat-dock-control
          className="rounded-md p-1.5 text-kib-muted hover:bg-white/[0.08] hover:text-kib-fg"
          title="Minimize (Esc)"
          onClick={() => setMinimized(true)}
        >
          <MinusIcon className="h-5 w-5" aria-hidden />
        </button>
        <Link
          to="/chat"
          data-chat-dock-control
          className="rounded-md p-1.5 text-kib-muted hover:bg-white/[0.08] hover:text-kib-cyber"
          title="Open full chat"
        >
          <ArrowsPointingOutIcon className="h-5 w-5" aria-hidden />
        </Link>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col px-2 pb-2 pt-1">
        <ChatConversation compact />
        <div
          className="absolute bottom-0 right-0 z-10 cursor-nwse-resize p-2 text-kib-muted hover:text-kib-fg"
          data-chat-dock-control
          title="Resize"
          onMouseDown={onResizeMouseDown}
        >
          <ArrowsPointingOutIcon className="h-4 w-4 rotate-90" aria-hidden />
        </div>
      </div>
    </div>
  );
};
