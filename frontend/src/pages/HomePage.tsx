import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const HomePage: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [currentPrice, setCurrentPrice] = useState(236.45);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard');
      return;
    }

    const interval = setInterval(() => {
      setIsAnimating(true);
      setCurrentPrice((prev) => {
        const change = (Math.random() - 0.5) * 5;
        return Math.max(200, Math.min(300, prev + change));
      });
      setTimeout(() => setIsAnimating(false), 500);
    }, 3000);

    return () => clearInterval(interval);
  }, [isAuthenticated, navigate]);

  return (
    <div className="min-h-screen relative kib-mesh-bg overflow-x-hidden">
      {/* Subtle vignette */}
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-60"
        style={{
          background: 'radial-gradient(ellipse 70% 60% at 50% 0%, transparent 0%, #030712 75%)'
        }}
      />

      <header className="relative z-10 border-b border-kib-line/80 bg-kib-surface/75 backdrop-blur-md">
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center gap-3">
              <span className="hidden sm:inline-flex font-mono text-[10px] text-kib-cyber/80 border border-kib-cyber/40 px-1.5 py-0.5 rounded tracking-widest uppercase">
                v1_live
              </span>
              <Link to="/" className="font-mono text-xl font-semibold text-kib-fg tracking-tight">
                <span className="text-kib-cyber">{'>'}</span> KeepItBased
              </Link>
            </div>
            <div className="flex items-center space-x-4">
              <a
                href="https://app.keepitbased.com/login"
                className="text-kib-muted hover:text-kib-cyber font-medium transition-colors duration-200 text-sm"
              >
                Sign In
              </a>
              <a
                href="https://app.keepitbased.com/register"
                className="btn-primary py-2 px-4 text-sm font-semibold shadow-terminal"
              >
                Get Started
              </a>
            </div>
          </div>
        </nav>
      </header>

      <div className="relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative pt-16 pb-16 sm:pb-24">
            <div className="lg:grid lg:grid-cols-12 lg:gap-8 items-center">
              <div className="sm:text-center md:max-w-2xl md:mx-auto lg:col-span-6 lg:text-left lg:flex lg:items-center">
                <div>
                  <p className="font-mono text-xs text-kib-cyber mb-4 tracking-[0.2em] uppercase">
                    Signal stack · Stocks & Crypto
                  </p>
                  <h1 className="text-4xl font-bold text-kib-fg sm:text-5xl md:text-6xl leading-tight">
                    Never Miss a
                    <span className="block hero-gradient pb-1">Buy the Dip</span>
                    Opportunity
                  </h1>
                  <p className="mt-6 text-xl text-kib-muted sm:max-w-xl">
                    Get instant alerts when your favorite stocks and crypto hit your buy zones. Structured signals for
                    disciplined entries — not hype.
                  </p>
                  <div className="mt-8 sm:max-w-lg sm:mx-auto sm:text-center lg:text-left">
                    <div className="flex flex-col sm:flex-row gap-4">
                      <a
                        href="https://app.keepitbased.com/register"
                        className="btn-primary text-center text-lg py-4 px-8 inline-flex items-center justify-center gap-2"
                      >
                        <span className="font-mono text-sm opacity-80">$ </span>
                        Start Investing Smarter
                      </a>
                      <a
                        href="https://app.keepitbased.com/charts"
                        className="btn-secondary text-center text-lg py-4 px-8 inline-flex items-center justify-center"
                      >
                        View Charts
                      </a>
                    </div>
                    <p className="mt-4 text-sm font-mono text-kib-muted/90">
                      <span className="text-robinhood-green mr-2">●</span>
                      Free forever · No hidden fees · No commitments.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-12 relative lg:mt-0 lg:col-span-6 lg:flex lg:items-center lg:justify-end">
                <div className="relative mx-auto w-full max-w-md lg:max-w-none">
                  <div className="absolute -inset-1 rounded-[2rem] bg-gradient-to-br from-kib-cyber/20 via-transparent to-robinhood-green/10 blur-xl opacity-80" />
                  <div className="relative rounded-3xl p-8 border border-kib-cyber/25 bg-kib-card shadow-terminal-lg backdrop-blur-sm">
                    <div className="absolute top-4 right-4 font-mono text-[10px] text-kib-cyber/70">SIG_OK</div>
                    <div className="text-center mb-6">
                      <h3 className="text-lg font-semibold font-mono text-kib-fg">AAPL</h3>
                      <p className="text-xs text-kib-muted uppercase tracking-wider">Apple Inc.</p>
                    </div>

                    <div className="space-y-4">
                      <div className="rounded-xl p-4 border border-robinhood-green/30 bg-[linear-gradient(135deg,rgba(0,200,5,0.12),transparent)]">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs font-mono text-kib-muted uppercase">Last px</p>
                            <p
                              className={`text-2xl font-bold tabular-nums font-mono text-kib-fg transition-all duration-500 ${isAnimating ? 'scale-110 text-kib-cyber' : ''}`}
                            >
                              ${currentPrice.toFixed(2)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-mono text-kib-muted uppercase">Δ session</p>
                            <p className="text-lg font-bold font-mono text-robinhood-green">-12.5%</p>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl p-4 border border-amber-500/35 bg-kib-raise/90">
                        <div className="flex items-center">
                          <div className="w-2 h-2 bg-amber-400 rounded-full mr-3 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.8)]" />
                          <p className="text-sm font-mono font-medium text-amber-200">MEDIUM_BUY_SIGNAL</p>
                        </div>
                        <p className="text-xs text-amber-200/75 mt-2 font-mono">
                          px &lt; threshold_10pct // baseline_watch
                        </p>
                      </div>

                      <button
                        type="button"
                        className="w-full py-3 px-4 rounded-lg font-mono text-sm font-semibold text-kib-bg bg-kib-cyber hover:bg-kib-glow transition-colors shadow-[0_0_16px_rgba(34,211,238,0.25)]"
                      >
                        open_app ──▶
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="border-y border-kib-line bg-kib-surface/90 py-14">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-10 text-center">
              {[
                ['10K+', 'active_users'],
                ['50M+', 'alerts_sent'],
                ['2.5K+', 'assets_tracked'],
                ['94%', 'signal_accuracy']
              ].map(([n, lab]) => (
                <div key={lab}>
                  <p className="text-3xl font-bold font-mono text-kib-cyber tabular-nums">{n}</p>
                  <p className="text-xs font-mono text-kib-muted uppercase tracking-wider mt-2">{lab.replace('_', ' ')}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Features */}
        <div className="py-20 relative">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-kib-fg sm:text-4xl">Smart Alerts for Smart Investors</h2>
              <p className="mt-4 text-lg text-kib-muted font-mono text-sm uppercase tracking-[0.15em]">
                Three configurable trigger tiers
              </p>
            </div>

            <div className="mt-16 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
              <div className="group relative rounded-2xl p-8 border border-amber-500/25 bg-kib-card hover:border-amber-400/45 transition-all duration-300 hover:shadow-[0_0_32px_rgba(251,191,36,0.06)]">
                <div className="w-12 h-12 rounded-lg flex items-center justify-center mb-6 bg-amber-500/15 border border-amber-500/30 font-mono text-amber-300 text-lg">
                  L1
                </div>
                <h3 className="text-xl font-semibold text-kib-fg mb-3">Small Dip Alert</h3>
                <p className="text-kib-muted mb-4">
                  Notified when price drops ~5% from your baseline — steady accumulation cadence.
                </p>
                <ul className="space-y-2 text-sm text-kib-muted font-mono">
                  <li className="flex items-center gap-2">
                    <span className="text-amber-400">▸</span> threshold: 5%
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-amber-400">▸</span> email + push
                  </li>
                </ul>
              </div>

              <div className="group relative rounded-2xl p-8 border border-orange-400/35 bg-kib-card hover:border-orange-300/55 transition-all duration-300 hover:shadow-[0_0_36px_rgba(251,146,60,0.1)] lg:scale-[1.02]">
                <div className="absolute -top-3 -right-3 font-mono text-[10px] font-bold px-3 py-1 rounded-full bg-kib-cyber text-kib-bg border border-kib-glow">
                  HOT
                </div>
                <div className="w-12 h-12 rounded-lg flex items-center justify-center mb-6 bg-orange-500/15 border border-orange-400/35 font-mono text-orange-300 text-lg">
                  L2
                </div>
                <h3 className="text-xl font-semibold text-kib-fg mb-3">Medium Dip Alert</h3>
                <p className="text-kib-muted mb-4">
                  ~10% drawdown signals stronger mean-reversion potential with priority routing.
                </p>
                <ul className="space-y-2 text-sm text-kib-muted font-mono">
                  <li className="flex items-center gap-2">
                    <span className="text-orange-400">▸</span> threshold: 10%
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-orange-400">▸</span> priority notify
                  </li>
                </ul>
              </div>

              <div className="group relative rounded-2xl p-8 border border-red-500/30 bg-kib-card hover:border-red-400/45 transition-all duration-300 hover:shadow-[0_0_32px_rgba(248,113,113,0.08)] sm:col-span-2 lg:col-span-1">
                <div className="w-12 h-12 rounded-lg flex items-center justify-center mb-6 bg-red-500/15 border border-red-400/35 font-mono text-red-300 text-lg">
                  L3
                </div>
                <h3 className="text-xl font-semibold text-kib-fg mb-3">Large Dip Alert</h3>
                <p className="text-kib-muted mb-4">
                  Major 15%+ dislocations flagged for conviction-sized entries with instant paths.
                </p>
                <ul className="space-y-2 text-sm text-kib-muted font-mono">
                  <li className="flex items-center gap-2">
                    <span className="text-red-400">▸</span> threshold: 15%+
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-red-400">▸</span> instant_alert
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* How */}
        <div className="py-20 bg-kib-surface/80 border-y border-kib-line">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-kib-fg sm:text-4xl">How KeepItBased Works</h2>
              <p className="mt-4 text-kib-muted">Deploy your watch pipeline in minutes</p>
            </div>

            <div className="mt-16 grid grid-cols-1 gap-12 md:grid-cols-3">
              {[
                {
                  step: '01',
                  title: 'Add Your Favorites',
                  body: 'Search tickers and set custom thresholds per symbol.',
                  icon: '+'
                },
                {
                  step: '02',
                  title: 'We Monitor 24/7',
                  body: 'Price streams and alert engine run continuously.',
                  icon: '~'
                },
                {
                  step: '03',
                  title: 'Get Instant Alerts',
                  body: 'Email and push the moment triggers fire.',
                  icon: '▸'
                }
              ].map((s) => (
                <div key={s.step} className="text-center">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl mb-6 font-mono text-kib-cyber bg-kib-card border border-kib-cyber/35 shadow-terminal">
                    {s.step}
                  </div>
                  <p className="font-mono text-xs text-kib-cyber/80 mb-2">{s.icon} init</p>
                  <h3 className="text-xl font-semibold text-kib-fg mb-3">{s.title}</h3>
                  <p className="text-kib-muted">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Testimonials */}
        <div className="py-20">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-center text-3xl font-bold text-kib-fg sm:text-4xl mb-14">Trusted by Smart Investors</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {[
                {
                  initials: 'S',
                  name: 'Sarah Chen',
                  role: 'Day Trader',
                  quote:
                    "\"KeepItBased changed how I size dips. The TSLA -18% week didn’t sneak past — alerts hit before I opened Twitter.\""
                },
                {
                  initials: 'M',
                  name: 'Mike Rodriguez',
                  role: 'Long-term Investor',
                  quote:
                    "\"I can’t watch tape all day. This is the disciplined nudge layer I needed — no noise, just thresholds.\""
                }
              ].map((t) => (
                <div key={t.name} className="rounded-2xl p-8 border border-kib-line bg-kib-card hover:border-kib-cyber/25 transition-colors">
                  <div className="flex items-center mb-4">
                    <div className="w-12 h-12 rounded-lg flex items-center justify-center font-mono font-bold text-kib-bg bg-gradient-to-br from-kib-cyber to-teal-600 mr-4">
                      {t.initials}
                    </div>
                    <div>
                      <p className="font-semibold text-kib-fg">{t.name}</p>
                      <p className="text-sm font-mono text-kib-muted">{t.role}</p>
                    </div>
                  </div>
                  <p className="text-slate-300 italic leading-relaxed">{t.quote}</p>
                  <div className="flex text-robinhood-green mt-4 tracking-widest">★★★★★</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="relative py-20 overflow-hidden border-t border-kib-cyber/20">
          <div className="absolute inset-0 bg-gradient-to-br from-teal-900/40 via-kib-card to-kib-bg" />
          <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_30%_50%,rgba(34,211,238,0.2),transparent_55%)]" />
          <div className="relative max-w-4xl mx-auto text-center px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-bold text-kib-fg sm:text-4xl font-mono tracking-tight">execute_on_opportunity()</h2>
            <p className="mt-6 text-lg text-kib-muted">Join investors who refuse to chase green candles.</p>
            <div className="mt-10">
              <a
                href="https://app.keepitbased.com/register"
                className="btn-primary inline-block text-lg py-4 px-10 rounded-xl shadow-terminal-lg font-semibold"
              >
                Get Started Free
              </a>
            </div>
            <p className="mt-6 text-sm font-mono text-kib-muted">no_card_required · cancel_anytime</p>
          </div>
        </div>

        {/* Footer */}
        <footer className="bg-kib-surface border-t border-kib-line py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
              {[
                {
                  title: 'Product',
                  links: [
                    ['Charts', 'https://app.keepitbased.com/charts'],
                    ['Dashboard', 'https://app.keepitbased.com/dashboard']
                  ]
                },
                {
                  title: 'Company',
                  links: [
                    ['About', '#'],
                    ['Careers', '#']
                  ]
                },
                {
                  title: 'Support',
                  links: [
                    ['Help', '#'],
                    ['Contact', '#']
                  ]
                },
                {
                  title: 'Legal',
                  links: [
                    ['Privacy', '#'],
                    ['Terms', '#']
                  ]
                }
              ].map((col) => (
                <div key={col.title}>
                  <h3 className="font-mono font-semibold text-kib-fg text-sm uppercase tracking-wider mb-4">{col.title}</h3>
                  <ul className="space-y-2 text-sm text-kib-muted">
                    {col.links.map(([label, href]) => (
                      <li key={label}>
                        <a href={href} className="hover:text-kib-cyber transition-colors">
                          {label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="border-t border-kib-line mt-12 pt-8 text-center font-mono text-xs text-kib-muted">
              © {new Date().getFullYear()} KeepItBased · <span className="text-robinhood-green">online</span> · never_miss_a_dip
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default HomePage;
