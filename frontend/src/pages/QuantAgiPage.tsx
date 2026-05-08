import React, { useEffect } from 'react';

function terminalSrc(): string {
  if (typeof window === 'undefined') return '/quant-agi-terminal/?embed=1';
  const host = window.location.hostname;
  if (host === 'keepitbased.com' || host === 'www.keepitbased.com') {
    return 'https://app.keepitbased.com/quant-agi-terminal/?embed=1';
  }
  return '/quant-agi-terminal/?embed=1';
}

const QuantAgiPage: React.FC = () => {
  const src = terminalSrc();

  useEffect(() => {
    // Fail-safe: if this page is ever loaded inside an iframe, force the terminal endpoint.
    if (window.self !== window.top) {
      window.location.replace(src);
    }
  }, [src]);

  return (
    <div className="h-[calc(100vh-88px)] min-h-[720px] bg-kib-bg">
      <iframe
        title="Quant AGI Terminal"
        src={src}
        className="h-full w-full border-0"
        referrerPolicy="same-origin"
      />
      <div className="px-4 py-2 text-xs text-kib-muted border-t border-white/[0.08]">
        If the terminal fails to load, open <a href={src} className="text-kib-cyber underline">Quant AGI Terminal</a> directly.
      </div>
    </div>
  );
};

export default QuantAgiPage;
