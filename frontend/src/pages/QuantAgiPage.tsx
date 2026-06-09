import React, { useCallback, useEffect, useRef } from 'react';

function terminalSrc(): string {
  if (typeof window === 'undefined') return '/quant-agi-terminal/?embed=1';
  const host = window.location.hostname;
  if (host === 'keepitbased.com' || host === 'www.keepitbased.com') {
    return 'https://app.keepitbased.com/quant-agi-terminal/?embed=1';
  }
  return '/quant-agi-terminal/?embed=1';
}

const TERMINAL_IFRAME_TITLE = 'Quant AGI Terminal';
const TERMINAL_ORIGIN = 'https://app.keepitbased.com';

function pushAuthTokenToIframe(iframe: HTMLIFrameElement | null): void {
  if (!iframe?.contentWindow) return;
  const token = localStorage.getItem('token');
  const targetOrigin =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? window.location.origin
      : TERMINAL_ORIGIN;
  iframe.contentWindow.postMessage({ type: 'KIB_AUTH_TOKEN', token }, targetOrigin);
}

const QuantAgiPage: React.FC = () => {
  const src = terminalSrc();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const onAuthBridgeRequest = useCallback((event: MessageEvent) => {
    const data = event.data as { type?: string } | null;
    if (data?.type !== 'KIB_REQUEST_AUTH_TOKEN') return;
    const allowed = new Set([window.location.origin, TERMINAL_ORIGIN]);
    if (!allowed.has(event.origin)) return;
    pushAuthTokenToIframe(iframeRef.current);
  }, []);

  useEffect(() => {
    // Fail-safe: if this page is ever loaded inside an iframe, force the terminal endpoint.
    if (window.self !== window.top) {
      window.location.replace(src);
    }
  }, [src]);

  useEffect(() => {
    window.addEventListener('message', onAuthBridgeRequest);
    return () => window.removeEventListener('message', onAuthBridgeRequest);
  }, [onAuthBridgeRequest]);

  return (
    <div className="h-[calc(100vh-88px)] min-h-[720px] bg-kib-bg">
      <iframe
        ref={iframeRef}
        title={TERMINAL_IFRAME_TITLE}
        src={src}
        className="h-full w-full border-0"
        referrerPolicy="same-origin"
        onLoad={() => pushAuthTokenToIframe(iframeRef.current)}
      />
      <div className="px-4 py-2 text-xs text-kib-muted border-t border-white/[0.08]">
        If the terminal fails to load, open <a href={src} className="text-kib-cyber underline">Quant AGI Terminal</a> directly.
      </div>
    </div>
  );
};

export default QuantAgiPage;
