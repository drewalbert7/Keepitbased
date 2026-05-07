import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const HomePage: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [demoPx, setDemoPx] = useState(178.42);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard');
      return;
    }

    const interval = setInterval(() => {
      setPulse(true);
      setDemoPx((prev) => {
        const drift = (Math.random() - 0.55) * 0.8;
        return Math.round((prev + drift) * 100) / 100;
      });
      setTimeout(() => setPulse(false), 400);
    }, 3200);

    return () => clearInterval(interval);
  }, [isAuthenticated, navigate]);

  return (
    <div className="relative min-h-screen overflow-x-hidden app-shell">
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-60"
        style={{
          background: 'radial-gradient(ellipse 70% 55% at 50% -10%, rgba(34, 211, 238, 0.08) 0%, transparent 50%), radial-gradient(ellipse 60% 50% at 80% 60%, rgba(0, 200, 5, 0.04) 0%, transparent 45%), #0d1117'
        }}
      />

      <header className="relative z-10 nav-shell">
        <nav className="mx-auto max-w-[1360px] px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center gap-3">
              <span className="hidden sm:inline-flex font-mono text-[10px] text-kib-cyber/80 border border-kib-cyber/40 px-1.5 py-0.5 rounded tracking-widest uppercase">
                research · alerts
              </span>
              <Link to="/" className="font-mono text-xl font-semibold text-kib-fg tracking-tight">
                <span className="text-kib-cyber">{'>'}</span> KeepItBased
              </Link>
            </div>
            <div className="flex items-center space-x-4">
              <Link
                to="/login"
                className="text-kib-muted hover:text-kib-cyber font-medium transition-colors duration-200 text-sm"
              >
                Sign in
              </Link>
              <Link to="/register" className="btn-primary py-2 px-4 text-sm font-semibold">
                Create account
              </Link>
            </div>
          </div>
        </nav>
      </header>

      <div className="relative z-10">
        <div className="mx-auto max-w-[1360px] px-4 sm:px-6 lg:px-8">
          <div className="relative pt-14 pb-20 sm:pb-28">
            <div className="lg:grid lg:grid-cols-12 lg:gap-10 lg:items-center">
              <div className="sm:text-center md:max-w-2xl md:mx-auto lg:col-span-6 lg:text-left lg:mx-0 lg:max-w-none">
                <p className="font-mono text-xs text-kib-cyber mb-4 tracking-[0.2em] uppercase">
                  Watchlist · Charts · AI agent
                </p>
                <p className="mb-5 inline-flex flex-wrap items-center gap-2 rounded-lg border border-kib-cyber/35 bg-kib-cyber/10 px-3 py-2 font-mono text-xs text-kib-cyber/95 sm:text-sm">
                  <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-kib-cyber shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
                  Invite-only access
                </p>
                <h1 className="text-4xl font-bold text-kib-fg sm:text-5xl md:text-6xl leading-[1.08] tracking-tight">
                  Spot dips with{' '}
                  <span className="hero-gradient bg-clip-text text-transparent">signal discipline</span>
                  <span className="block mt-1 text-kib-fg">— context when you want it</span>
                </h1>
                <p className="mt-6 text-lg sm:text-xl text-kib-muted sm:max-w-xl lg:max-w-none leading-relaxed">
                  Deterministic opportunity tiers vs <strong className="font-medium text-kib-fg/90">your</strong> alert
                  baselines, plus a dashboard <strong className="font-medium text-kib-fg/90">AI agent</strong> that scans
                  your watchlist and explains setups with{' '}
                  <strong className="font-medium text-kib-fg/90">tool-backed numbers</strong> — not invented prices.
                  Optional Grok-powered dip briefings and a daily market briefing when your host enables them.
                </p>
                <div className="mt-9 sm:max-w-lg sm:mx-auto lg:mx-0 sm:text-center lg:text-left">
                  <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                    <Link
                      to="/register"
                      className="btn-primary text-center text-base sm:text-lg py-3.5 px-7 inline-flex items-center justify-center gap-2"
                    >
                      <span className="font-mono text-sm opacity-80">&gt;_</span>
                      Start with your invite
                    </Link>
                    <Link
                      to="/charts"
                      className="btn-secondary text-center text-base sm:text-lg py-3.5 px-7 inline-flex items-center justify-center"
                    >
                      Open charts
                    </Link>
                  </div>
                  <p className="mt-5 text-sm text-kib-muted/90 leading-relaxed">
                    Educational tooling only — not investment advice. You control email, toasts, and tiers in
                    Profile.
                  </p>
                </div>
              </div>

              <div className="mt-14 relative lg:mt-0 lg:col-span-6 lg:flex lg:items-center lg:justify-end">
                <div className="relative mx-auto w-full max-w-md lg:max-w-none">
                  <div className="absolute -inset-1 rounded-[2rem] bg-gradient-to-br from-kib-cyber/25 via-transparent to-emerald-500/10 blur-xl opacity-90" />
                  <div className="relative rounded-2xl border border-white/[0.08] bg-kib-card/95 p-7 sm:p-8 shadow-soft backdrop-blur-sm">
                    <div className="flex items-start justify-between gap-3 mb-6">
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-wider text-kib-muted">Illustrative</p>
                        <h3 className="text-lg font-semibold font-mono text-kib-fg">NVDA</h3>
                        <p className="text-xs text-kib-muted">Example signal card</p>
                      </div>
                      <span className="font-mono text-[10px] text-kib-cyber/80 border border-kib-cyber/30 px-2 py-1 rounded">
                        opportunity_signal
                      </span>
                    </div>

                    <div className="space-y-4">
                      <div className="rounded-xl p-4 border border-white/[0.06] bg-black/25">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="text-xs font-mono text-kib-muted uppercase">Last vs your baseline</p>
                            <p
                              className={`text-2xl font-bold tabular-nums font-mono text-kib-fg transition-transform duration-300 ${pulse ? 'scale-[1.02] text-kib-cyber' : ''}`}
                            >
                              ${demoPx.toFixed(2)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-mono text-kib-muted uppercase">Flags</p>
                            <p className="text-sm font-mono text-amber-200/95">overreaction</p>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl p-4 border border-kib-cyber/25 bg-kib-cyber/5">
                        <p className="text-xs font-mono text-kib-muted uppercase mb-2">Engine</p>
                        <p className="text-sm text-kib-fg/90 leading-snug">
                          Tiers use volatility-aware rules vs baseline (e.g. ATR-style depth on the host). Crypto runs
                          24/7; US stocks can be limited to regular session — your choice.
                        </p>
                      </div>

                      <Link
                        to="/register"
                        className="block w-full py-3 px-4 rounded-lg font-mono text-sm font-semibold text-center text-kib-bg bg-kib-cyber hover:bg-kib-glow transition-colors shadow-[0_0_16px_rgba(34,211,238,0.2)]"
                      >
                        Create account ──▶
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Honest pillars — no vanity metrics */}
        <div className="border-y border-kib-line bg-kib-surface/80 py-12 sm:py-14">
          <div className="mx-auto max-w-[1360px] px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-10">
              {[
                {
                  title: 'Deterministic dips',
                  body: 'Opportunity flags are computed from live quotes and your per-symbol baseline — auditable and consistent for everyone on the same host config.'
                },
                {
                  title: 'AI agent & research',
                  body: 'Dashboard assistant for watchlist scans and Q&A; dip briefings can layer Grok + live search when enabled. Numbers in emails come from tools and your snapshot, not model memory.'
                },
                {
                  title: 'Notifications you own',
                  body: 'Email and in-app toasts, separate tiers for inbox vs toasts, optional daily briefing — all in Profile.'
                }
              ].map((item) => (
                <div key={item.title} className="text-center md:text-left">
                  <p className="font-mono text-xs text-kib-cyber uppercase tracking-wider mb-2">{item.title}</p>
                  <p className="text-sm text-kib-muted leading-relaxed">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Signal tiers — aligned with product vocabulary */}
        <div className="py-20 relative">
          <div className="mx-auto max-w-[1360px] px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto text-center lg:mx-0 lg:text-left lg:max-w-2xl">
              <h2 className="text-3xl font-bold text-kib-fg sm:text-4xl tracking-tight">Three opportunity tiers</h2>
              <p className="mt-4 text-kib-muted leading-relaxed">
                Short labels in the app: <span className="font-mono text-kib-fg/80">on_sale</span>,{' '}
                <span className="font-mono text-kib-fg/80">overreaction</span>, and long-horizon{' '}
                <span className="font-mono text-kib-fg/80">capitulation</span>. Depth is measured vs{' '}
                <strong className="text-kib-fg/90">your</strong> baseline using host rules (typically volatility-aware, not
                one-size-fits-all percentages). You choose which tiers notify by email vs in-app.
              </p>
            </div>

            <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-2xl p-7 border border-amber-500/20 bg-kib-card hover:border-amber-400/35 transition-colors">
                <div className="w-11 h-11 rounded-lg flex items-center justify-center mb-5 bg-amber-500/12 border border-amber-500/25 font-mono text-amber-300 text-sm">
                  ①
                </div>
                <h3 className="text-lg font-semibold text-kib-fg mb-2">Smaller dislocation</h3>
                <p className="text-sm text-kib-muted leading-relaxed">
                  First meaningful dip vs baseline — steady accumulation zone when your rules say so.
                </p>
              </div>

              <div className="relative rounded-2xl p-7 border border-orange-400/30 bg-kib-card hover:border-orange-300/45 transition-colors lg:scale-[1.02] shadow-[0_0_40px_rgba(251,146,60,0.06)]">
                <div className="absolute -top-2.5 right-5 font-mono text-[10px] font-semibold px-2.5 py-1 rounded-full bg-kib-cyber/90 text-kib-bg">
                  common
                </div>
                <div className="w-11 h-11 rounded-lg flex items-center justify-center mb-5 bg-orange-500/12 border border-orange-400/30 font-mono text-orange-300 text-sm">
                  ②
                </div>
                <h3 className="text-lg font-semibold text-kib-fg mb-2">Larger flush</h3>
                <p className="text-sm text-kib-muted leading-relaxed">
                  Deeper move vs baseline — often where email defaults focus so your inbox stays meaningful.
                </p>
              </div>

              <div className="rounded-2xl p-7 border border-red-500/25 bg-kib-card hover:border-red-400/35 transition-colors sm:col-span-2 lg:col-span-1 relative">
                <div className="w-11 h-11 rounded-lg flex items-center justify-center mb-5 bg-red-500/12 border border-red-400/25 font-mono text-red-300 text-sm">
                  ③
                </div>
                <h3 className="text-lg font-semibold text-kib-fg mb-2">Major long-term setup</h3>
                <p className="text-sm text-kib-muted leading-relaxed">
                  Capitulation-style context: stricter structural checks (e.g. drawdown vs range) — rarest tier, separate
                  dedupe so it does not spam.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* AI & notifications */}
        <div className="py-20 bg-kib-surface/85 border-y border-kib-line">
          <div className="mx-auto max-w-[1360px] px-4 sm:px-6 lg:px-8">
            <div className="lg:grid lg:grid-cols-2 lg:gap-16 lg:items-start">
              <div>
                <h2 className="text-3xl font-bold text-kib-fg sm:text-4xl tracking-tight">AI agent & research</h2>
                <p className="mt-4 text-kib-muted leading-relaxed">
                  From the dashboard: scan and rank watchlist names, ask questions in plain language, or let Smart route
                  intent. Outputs emphasize structured candidates, risk notes, and reasoning tied to data we pass in —
                  not standalone price targets from the model.
                </p>
                <ul className="mt-8 space-y-4 text-sm text-kib-fg/90">
                  <li className="flex gap-3">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-kib-cyber" />
                    <span>
                      <strong className="text-kib-fg">Watchlist context</strong> — agent calls include your live table and
                      snapshot fields (quotes, baselines where configured).
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-kib-cyber" />
                    <span>
                      <strong className="text-kib-fg">Dip insight path</strong> — optional richer email when a tier fires,
                      if your operator enables Grok and you opt in; fusion can require ingested headlines when you choose
                      that stricter mode.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-kib-cyber" />
                    <span>
                      <strong className="text-kib-fg">Daily briefing</strong> — optional digest-style email summarizing
                      macro, tape, and watchlist themes when the server schedules it and SMTP is configured.
                    </span>
                  </li>
                </ul>
              </div>
              <div className="mt-12 lg:mt-2 rounded-2xl border border-white/[0.07] bg-black/20 p-8">
                <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-kib-cyber mb-4">Notifications</h3>
                <ul className="space-y-4 text-sm text-kib-muted leading-relaxed">
                  <li className="flex gap-3">
                    <span className="font-mono text-robinhood-green shrink-0">✓</span>
                    Master email switch; separate “email me dip alerts” and tier filters for inbox vs smallest tier.
                  </li>
                  <li className="flex gap-3">
                    <span className="font-mono text-robinhood-green shrink-0">✓</span>
                    In-app toasts on opportunity signals (socket-delivered when you are logged in).
                  </li>
                  <li className="flex gap-3">
                    <span className="font-mono text-robinhood-green shrink-0">✓</span>
                    Optional US regular session only for stocks (crypto unaffected).
                  </li>
                  <li className="flex gap-3">
                    <span className="font-mono text-robinhood-green shrink-0">✓</span>
                    Every signal row can be reviewed later — emails may be suppressed by policy without deleting history.
                  </li>
                </ul>
                <p className="mt-6 text-xs text-kib-muted/80 border-t border-white/[0.06] pt-6 leading-relaxed">
                  Availability of Grok, news ingestion, and digest cron depends on your deployment and API keys — not
                  guaranteed by the client alone.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* How */}
        <div className="py-20">
          <div className="mx-auto max-w-[1360px] px-4 sm:px-6 lg:px-8">
            <h2 className="text-center text-3xl font-bold text-kib-fg sm:text-4xl">How it flows</h2>
            <p className="text-center mt-3 text-kib-muted max-w-2xl mx-auto">
              From baseline to inbox — you stay in control of noise.
            </p>

            <div className="mt-14 grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  step: '01',
                  title: 'Set baselines',
                  body: 'Active alerts with a baseline price per symbol — that is the anchor the engine compares on each poll.'
                },
                {
                  step: '02',
                  title: 'Engine evaluates',
                  body: 'Deterministic tiers vs baseline and volatility context. Rows land in Opportunity signals with flags and reasons.'
                },
                {
                  step: '03',
                  title: 'Optional AI layer',
                  body: 'Agent chat, dip briefings, or daily digest when enabled server-side — prose explains; numbers stay tool-backed.'
                },
                {
                  step: '04',
                  title: 'You decide',
                  body: 'Notifications respect Profile. Nothing here places trades; educational output only.'
                }
              ].map((s) => (
                <div key={s.step} className="relative rounded-2xl border border-white/[0.06] bg-kib-card/50 p-6 text-left">
                  <span className="font-mono text-xs text-kib-cyber">{s.step}</span>
                  <h3 className="text-lg font-semibold text-kib-fg mt-2 mb-2">{s.title}</h3>
                  <p className="text-sm text-kib-muted leading-relaxed">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Principles instead of fake reviews */}
        <div className="py-16 sm:py-20 border-t border-kib-line bg-gradient-to-b from-kib-surface/40 to-transparent">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-2xl sm:text-3xl font-bold text-kib-fg tracking-tight">What we optimize for</h2>
            <p className="mt-6 text-kib-muted leading-relaxed">
              Clear thresholds over hype. Traceable signals over black-box tips. Invite-only access so the product can stay
              focused and supportable — we do not publish paid testimonials or user counts we have not earned yet.
            </p>
            <p className="mt-6 text-sm font-mono text-kib-muted/90">
              Educational software · not a broker · not personalized investment advice
            </p>
          </div>
        </div>

        {/* CTA */}
        <div className="relative py-20 overflow-hidden border-t border-kib-cyber/15">
          <div className="absolute inset-0 bg-gradient-to-br from-teal-950/50 via-kib-card/80 to-kib-bg" />
          <div className="absolute inset-0 opacity-50 bg-[radial-gradient(ellipse_80%_60% at 50% 0%,rgba(34,211,238,0.12),transparent_55%)]" />
          <div className="relative max-w-3xl mx-auto text-center px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl sm:text-3xl font-bold text-kib-fg font-mono tracking-tight">
              Ready when your invite is
            </h2>
            <p className="mt-5 text-lg text-kib-muted leading-relaxed">
              Same stack: charts, watchlist, dashboard agent, and notification controls — one account.
            </p>
            <div className="mt-10 flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center sm:items-center sm:gap-4">
              <Link
                to="/login"
                className="btn-primary inline-block rounded-xl px-10 py-3.5 text-base font-semibold text-center"
              >
                Sign in
              </Link>
              <Link
                to="/register"
                className="btn-secondary inline-block rounded-xl px-10 py-3.5 text-base font-semibold text-center"
              >
                Create account
              </Link>
            </div>
            <p className="mt-8 text-sm font-mono text-kib-muted">invite_only · ask your host for a code</p>
          </div>
        </div>

        {/* Footer */}
        <footer className="bg-kib-surface border-t border-kib-line py-12">
          <div className="mx-auto max-w-[1360px] px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-8">
              <div>
                <p className="font-mono font-semibold text-kib-fg">KeepItBased</p>
                <p className="mt-1 text-sm text-kib-muted max-w-md leading-relaxed">
                  Stocks, crypto charts, watchlist opportunity engine, and dashboard AI — invite-only.
                </p>
              </div>
              <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
                <Link to="/charts" className="text-kib-muted hover:text-kib-cyber transition-colors">
                  Charts
                </Link>
                <Link to="/dashboard" className="text-kib-muted hover:text-kib-cyber transition-colors">
                  Dashboard
                </Link>
                <Link to="/login" className="text-kib-muted hover:text-kib-cyber transition-colors">
                  Sign in
                </Link>
                <Link to="/register" className="text-kib-muted hover:text-kib-cyber transition-colors">
                  Register
                </Link>
              </div>
            </div>
            <div className="border-t border-kib-line mt-10 pt-8 text-center font-mono text-xs text-kib-muted">
              © {new Date().getFullYear()} KeepItBased ·{' '}
              <span className="text-robinhood-green/90">signal_discipline</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default HomePage;
