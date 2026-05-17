const path = require('path');
const fs = require('fs');

// Load environment variables with multiple fallback paths
function loadEnvironment() {
  const possibleEnvPaths = [
    path.join(__dirname, '../.env'),
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), 'backend/.env'),
    path.join(process.env.HOME || '/home', 'keepitbased', 'backend', '.env')
  ];

  for (const envPath of possibleEnvPaths) {
    if (fs.existsSync(envPath)) {
      require('dotenv').config({ path: envPath });
      console.log(`✅ Loaded environment from: ${envPath}`);
      break;
    }
  }
}

// Load environment
loadEnvironment();

// Configuration with robust defaults
const config = {
  // Server
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT) || 3001,
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',

  // Database - with fallback for development
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://keepitbased:password@localhost:5432/keepitbased',
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',

  // Python Service
  PYTHON_SERVICE_URL: process.env.PYTHON_SERVICE_URL || 'http://127.0.0.1:5001',

  /**
   * Optional Quant AGI sidecar (`quant_agi` FastAPI): base URL without trailing slash, e.g. http://127.0.0.1:8844
   * When set, opportunity toasts / stored rows get additive `quantAgi` JSON from POST /webhook/swarm-enhance.
   */
  QUANT_AGI_ENHANCE_URL: (process.env.QUANT_AGI_ENHANCE_URL || '').trim(),
  QUANT_AGI_TIMEOUT_MS: (() => {
    const n = parseInt(process.env.QUANT_AGI_TIMEOUT_MS, 10);
    return Number.isFinite(n) && n > 200 ? n : 3500;
  })(),

  // JWT - CRITICAL: Always have a fallback secret
  JWT_SECRET: process.env.JWT_SECRET || 'fallback-jwt-secret-change-in-production-' + Date.now(),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',

  /** One-time bootstrap: plaintext invite code seeded into DB `app_settings` if unset. Remove after first deploy / admin rotates. */
  INVITE_SIGNUP_CODE: process.env.INVITE_SIGNUP_CODE || '',
  /** Comma-separated user emails allowed to rotate invite code (`GET|PUT /api/admin/signup-invite`). */
  ADMIN_SIGNUP_EMAILS: process.env.ADMIN_SIGNUP_EMAILS || '',

  // API Keys
  ALPHA_VANTAGE_API_KEY: process.env.ALPHA_VANTAGE_API_KEY || 'demo',
  MASSIVE_API_KEY: process.env.MASSIVE_API_KEY || '',
  POLYGON_API_KEY: process.env.POLYGON_API_KEY || process.env.MASSIVE_API_KEY || '',

  /** X / Twitter API v2 app-only bearer — read recent tweets from monitored accounts */
  X_API_BEARER_TOKEN: process.env.X_API_BEARER_TOKEN || '',
  /**
   * REST host for Polygon-compatible aggregates (same paths as Massive docs).
   * Use https://api.massive.com if your key comes from the Massive dashboard;
   * legacy Polygon keys often still work on https://api.polygon.io
   */
  MARKET_DATA_API_URL: (process.env.MARKET_DATA_API_URL || 'https://api.polygon.io').replace(/\/$/, ''),

  /** iTick — non-US equities (Taiwan TWSE first). https://docs.itick.io */
  ITICK_API_TOKEN: (process.env.ITICK_API_TOKEN || process.env.ITICK_TOKEN || '').trim(),
  ITICK_API_BASE_URL: (process.env.ITICK_API_BASE_URL || 'https://api.itick.io').replace(/\/$/, ''),
  ITICK_TW_ENABLED: process.env.ITICK_TW_ENABLED !== 'false',
  ITICK_REQUEST_TIMEOUT_MS: (() => {
    const n = parseInt(process.env.ITICK_REQUEST_TIMEOUT_MS, 10);
    return Number.isFinite(n) && n >= 2000 ? Math.min(n, 60000) : 15000;
  })(),

  /**
   * Optional OpenBB ODP REST hub (Polygon + other connectors). AGPL-3.0 — legal review advised.
   * Run: `./openbb-service/start.sh` or `pm2 start ecosystem.openbb.config.js`
   * Docs: https://docs.openbb.co/odp/python/extensions/interface/openbb-api
   */
  OPENBB_ENABLED: process.env.OPENBB_ENABLED === 'true',
  OPENBB_API_URL: (process.env.OPENBB_API_URL || 'http://127.0.0.1:6900').replace(/\/$/, ''),
  OPENBB_API_PREFIX: (process.env.OPENBB_API_PREFIX || '/api/v1').replace(/\/$/, ''),
  /** Provider for `/equity/price/historical` via OpenBB (polygon uses your POLYGON/MASSIVE key in OpenBB .env). */
  OPENBB_EQUITY_PROVIDER: process.env.OPENBB_EQUITY_PROVIDER || 'polygon',

  /**
   * Crypto routes via OpenBB `crypto/price/historical` (typically yfinance — install `openbb-yfinance` in openbb-service).
   * See: https://docs.openbb.co/odp/python/reference/crypto/price/historical
   */
  OPENBB_CRYPTO_PROVIDER: process.env.OPENBB_CRYPTO_PROVIDER || 'yfinance',

  /** When true, flip all OpenBB exclusive toggles below to on. */
  OPENBB_EXCLUSIVE_ALL: process.env.OPENBB_EXCLUSIVE_ALL === 'true',

  /**
   * Stock quote: OpenBB only (no Node snapshot/aggs). Aliases + OPENBB_EXCLUSIVE_ALL.
   */
  OPENBB_STOCK_QUOTE_EXCLUSIVE:
    process.env.OPENBB_STOCK_QUOTE_EXCLUSIVE === 'true' ||
    process.env.OPENBB_EXCLUSIVE === 'true' ||
    process.env.OPENBB_EXCLUSIVE_ALL === 'true',

  /**
   * Stock `/charts/history` + `/charts/technical`: OpenBB only after cache miss (no Node Massive aggs).
   */
  OPENBB_STOCK_HISTORY_EXCLUSIVE:
    process.env.OPENBB_STOCK_HISTORY_EXCLUSIVE === 'true' ||
    process.env.OPENBB_EXCLUSIVE_ALL === 'true',

  /** Crypto `/crypto/ticker` + `/crypto/ohlc`: OpenBB only after OpenBB path misses (no Polygon/Binance/CG in Node). */
  OPENBB_CRYPTO_EXCLUSIVE:
    process.env.OPENBB_CRYPTO_EXCLUSIVE === 'true' || process.env.OPENBB_EXCLUSIVE_ALL === 'true',
  COINAPI_KEY: process.env.COINAPI_KEY || '',
  
  // Email
  SMTP_HOST: process.env.SMTP_HOST || 'smtp.gmail.com',
  SMTP_PORT: parseInt(process.env.SMTP_PORT) || 587,
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
  RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  CHARTS_QUOTE_RATE_WINDOW_MS: parseInt(process.env.CHARTS_QUOTE_RATE_WINDOW_MS) || 60000,
  CHARTS_QUOTE_RATE_MAX: parseInt(process.env.CHARTS_QUOTE_RATE_MAX) || 120,
  CHARTS_HISTORY_RATE_WINDOW_MS: parseInt(process.env.CHARTS_HISTORY_RATE_WINDOW_MS) || 60000,
  CHARTS_HISTORY_RATE_MAX: parseInt(process.env.CHARTS_HISTORY_RATE_MAX) || 60,

  /**
   * Massive/Polygon REST retries on 429 / transient 5xx (charts quote + history).
   * Spreads burst load from parallel watchlist quote polling.
   */
  POLYGON_UPSTREAM_MAX_ATTEMPTS: (() => {
    const n = parseInt(process.env.POLYGON_UPSTREAM_MAX_ATTEMPTS, 10);
    return Number.isFinite(n) && n >= 1 ? Math.min(n, 8) : 4;
  })(),
  /** Longer Redis key: last good stock quote when live fetch fails (still 200 to client). */
  CHARTS_QUOTE_STALE_TTL_SEC: (() => {
    const n = parseInt(process.env.CHARTS_QUOTE_STALE_TTL_SEC, 10);
    return Number.isFinite(n) && n >= 60 ? Math.min(n, 604800) : 259200;
  })(),

  /** POST /api/agent/apply — per-user alert creation */
  AGENT_APPLY_RATE_WINDOW_MS: parseInt(process.env.AGENT_APPLY_RATE_WINDOW_MS) || 60000,
  AGENT_APPLY_RATE_MAX: parseInt(process.env.AGENT_APPLY_RATE_MAX) || 15,
  /** GET /api/agent/audit */
  AGENT_AUDIT_RATE_WINDOW_MS: parseInt(process.env.AGENT_AUDIT_RATE_WINDOW_MS) || 60000,
  AGENT_AUDIT_RATE_MAX: parseInt(process.env.AGENT_AUDIT_RATE_MAX) || 60,
  /** Node → Python `POST /agent/opportunities` for `/api/agent/chat` (ms). */
  AGENT_PYTHON_TIMEOUT_MS: (() => {
    const n = parseInt(process.env.AGENT_PYTHON_TIMEOUT_MS, 10);
    if (Number.isFinite(n) && n >= 15000) return Math.min(n, 180000);
    return 120000;
  })(),
  /** GET /api/internal/agent/alerts (Python tools) */
  INTERNAL_AGENT_READ_WINDOW_MS: parseInt(process.env.INTERNAL_AGENT_READ_WINDOW_MS) || 60000,
  INTERNAL_AGENT_READ_MAX: parseInt(process.env.INTERNAL_AGENT_READ_MAX) || 120,
  /** POST /api/internal/agent/alerts */
  INTERNAL_AGENT_WRITE_WINDOW_MS: parseInt(process.env.INTERNAL_AGENT_WRITE_WINDOW_MS) || 60000,
  INTERNAL_AGENT_WRITE_MAX: parseInt(process.env.INTERNAL_AGENT_WRITE_MAX) || 30,

  // Features
  PRICE_CHECK_INTERVAL_MS: parseInt(process.env.PRICE_CHECK_INTERVAL_MS) || 60000,
  MAX_ALERTS_PER_USER: parseInt(process.env.MAX_ALERTS_PER_USER) || 50,

  /**
   * Legacy 5/10/15% threshold "BUY SIGNAL" emails (alertService). Default off — use opportunity
   * emails (overreaction/capitulation) for watchlist dip alerts instead; saves SES quota.
   */
  ENABLE_LEGACY_THRESHOLD_ALERT_EMAILS:
    process.env.ENABLE_LEGACY_THRESHOLD_ALERT_EMAILS === 'true',

  /**
   * Marketing SMTP budget (opportunity, digest, legacy alerts). Transactional auth mail bypasses.
   * Sandbox SES ≈200/day — default 80 leaves headroom; raise after production access.
   */
  SES_GLOBAL_DAILY_EMAIL_CAP: (() => {
    const n = parseInt(process.env.SES_GLOBAL_DAILY_EMAIL_CAP, 10);
    return Number.isFinite(n) && n >= 0 ? Math.min(n, 50_000) : 80;
  })(),
  SES_GLOBAL_HOURLY_EMAIL_CAP: (() => {
    const n = parseInt(process.env.SES_GLOBAL_HOURLY_EMAIL_CAP, 10);
    return Number.isFinite(n) && n >= 0 ? Math.min(n, 5000) : 12;
  })(),
  /**
   * Daily Grok watchlist briefing pool — separate from dip/opportunity caps so one digest/user/day
   * does not compete with `opportunityMaxEmailsPerDay` or the tight opportunity global budget.
   */
  SES_DIGEST_DAILY_EMAIL_CAP: (() => {
    const n = parseInt(process.env.SES_DIGEST_DAILY_EMAIL_CAP, 10);
    return Number.isFinite(n) && n >= 0 ? Math.min(n, 50_000) : 150;
  })(),
  /** Min seconds between any two marketing emails to the same address. */
  EMAIL_MIN_INTERVAL_PER_RECIPIENT_SEC: (() => {
    const n = parseInt(process.env.EMAIL_MIN_INTERVAL_PER_RECIPIENT_SEC, 10);
    return Number.isFinite(n) && n >= 0 ? Math.min(n, 86400) : 1800;
  })(),
  /** After SES 454 quota error, pause marketing sends (seconds). */
  SES_THROTTLE_PAUSE_SEC: (() => {
    const n = parseInt(process.env.SES_THROTTLE_PAUSE_SEC, 10);
    return Number.isFinite(n) && n >= 60 ? Math.min(n, 86400) : 3600;
  })(),

  /** When true, optional Grok dip briefing email replaces plain opportunity email (see notification_preferences.dipInsightEmail). */
  ENABLE_DIP_INSIGHT_EMAIL: process.env.ENABLE_DIP_INSIGHT_EMAIL === 'true',
  /** Emergency kill switch: when true, never send Grok dip briefing emails (plain opportunity email still allowed). */
  DISABLE_DIP_INSIGHT_EMAIL: process.env.DISABLE_DIP_INSIGHT_EMAIL === 'true',

  /**
   * UltimateDipBuyer AI: only send the rich Grok email when verdict is Strong Buy or Buy (not Hold/Pass).
   * Assessment is still stored on `opportunity_signals.ai_assessment` when insight succeeds.
   */
  DIP_INSIGHT_EMAIL_REQUIRE_BUY_VERDICT: process.env.DIP_INSIGHT_EMAIL_REQUIRE_BUY_VERDICT === 'true',
  /**
   * When > 0, require Grok `confidence` >= this (0–100) to send the dip insight email.
   * Works together with DIP_INSIGHT_EMAIL_REQUIRE_BUY_VERDICT when both set.
   */
  DIP_INSIGHT_MIN_CONFIDENCE_FOR_EMAIL: (() => {
    const n = parseInt(process.env.DIP_INSIGHT_MIN_CONFIDENCE_FOR_EMAIL, 10);
    return Number.isFinite(n) && n >= 0 ? Math.min(n, 100) : 0;
  })(),

  /** Phase 4 — Grok dip insight only when flags include overreaction or capitulation (not on_sale alone). */
  DIP_INSIGHT_REQUIRE_OVERREACTION_TIER:
    process.env.DIP_INSIGHT_REQUIRE_OVERREACTION_TIER !== 'false',

  /**
   * Run dip-insight Grok call via email_outbox worker (non-blocking for price cron).
   * Default on when ENABLE_EMAIL_OUTBOX is on.
   */
  DIP_INSIGHT_ASYNC_VIA_OUTBOX: (() => {
    if (process.env.DIP_INSIGHT_ASYNC_VIA_OUTBOX === 'false') return false;
    if (process.env.DIP_INSIGHT_ASYNC_VIA_OUTBOX === 'true') return true;
    return process.env.ENABLE_EMAIL_OUTBOX !== 'false';
  })(),

  DIP_INSIGHT_OUTBOX_PER_TICK: (() => {
    const n = parseInt(process.env.DIP_INSIGHT_OUTBOX_PER_TICK, 10);
    return Number.isFinite(n) && n >= 1 && n <= 10 ? n : 2;
  })(),

  /**
   * Scheduled daily Grok watchlist briefing (separate from critical dip opportunity emails).
   * Default on; set ENABLE_DAILY_WATCHLIST_DIGEST_EMAIL=false to disable cron.
   */
  ENABLE_DAILY_WATCHLIST_DIGEST_EMAIL: process.env.ENABLE_DAILY_WATCHLIST_DIGEST_EMAIL !== 'false',
  DISABLE_DAILY_WATCHLIST_DIGEST_EMAIL: process.env.DISABLE_DAILY_WATCHLIST_DIGEST_EMAIL === 'true',
  /** Cron for digest send (default 07:00 UTC daily). */
  DAILY_WATCHLIST_DIGEST_CRON: process.env.DAILY_WATCHLIST_DIGEST_CRON || '0 7 * * *',
  /** Delay between users when sending digests (rate limits / Grok). */
  DAILY_WATCHLIST_DIGEST_STAGGER_MS: (() => {
    const n = parseInt(process.env.DAILY_WATCHLIST_DIGEST_STAGGER_MS, 10);
    return Number.isFinite(n) && n >= 0 ? Math.min(n, 120_000) : 2500;
  })(),
  /** Hours of Polygon-ingested headlines attached to daily digest payloads (symbols on user watchlist). */
  DAILY_DIGEST_RESEARCH_LOOKBACK_HOURS: (() => {
    const n = parseInt(process.env.DAILY_DIGEST_RESEARCH_LOOKBACK_HOURS, 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 168) : 72;
  })(),

  /**
   * §11 Phase B — Polygon/Massive reference news → research_artifacts (scheduled worker).
   * Set ENABLE_RESEARCH_INGESTION=true after POLYGON/MASSIVE key is configured.
   */
  ENABLE_RESEARCH_INGESTION: process.env.ENABLE_RESEARCH_INGESTION === 'true',
  /** Cron expression for news ingestion (default: every 10 minutes). */
  RESEARCH_NEWS_CRON: process.env.RESEARCH_NEWS_CRON || '*/10 * * * *',
  /** Max distinct stock tickers to poll per cron tick (rate-limit friendly). */
  RESEARCH_NEWS_MAX_SYMBOLS_PER_RUN: (() => {
    const n = parseInt(process.env.RESEARCH_NEWS_MAX_SYMBOLS_PER_RUN, 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 500) : 30;
  })(),
  /** Polygon /v2/reference/news limit per symbol. */
  RESEARCH_NEWS_PER_SYMBOL_LIMIT: (() => {
    const n = parseInt(process.env.RESEARCH_NEWS_PER_SYMBOL_LIMIT, 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 50) : 10;
  })(),
  /** Gap between symbol requests (ms) to avoid burst rate limits (0 allowed). */
  RESEARCH_NEWS_SYMBOL_DELAY_MS: (() => {
    const n = parseInt(process.env.RESEARCH_NEWS_SYMBOL_DELAY_MS, 10);
    return Number.isFinite(n) && n >= 0 ? n : 600;
  })(),

  /** §11 Phase D — hours of `research_artifacts` to count for dip+research fusion (Profile `researchDigestEmail`). */
  RESEARCH_FUSION_LOOKBACK_HOURS: (() => {
    const n = parseInt(process.env.RESEARCH_FUSION_LOOKBACK_HOURS, 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 168) : 24;
  })(),

  /**
   * Watchlist opportunity signals: `atr` = distance below baseline in units of 14-day Wilder ATR (daily);
   * `pct` = legacy fixed % vs baseline. If ATR cannot be fetched, `atr` falls back to `pct` for that tick.
   */
  OPPORTUNITY_TRIGGER_MODE: (() => {
    const m = String(process.env.OPPORTUNITY_TRIGGER_MODE || 'atr')
      .trim()
      .toLowerCase();
    return m === 'pct' ? 'pct' : 'atr';
  })(),
  /** Fire `on_sale` when (baseline − price) / ATR14 ≥ this (price below baseline). */
  OPPORTUNITY_ON_SALE_ATR_MULT: (() => {
    const n = parseFloat(process.env.OPPORTUNITY_ON_SALE_ATR_MULT, 10);
    return Number.isFinite(n) && n > 0 ? n : 1.25;
  })(),
  /** Fire `overreaction` when (baseline − price) / ATR14 ≥ this, or via legacy / vol rules in pct mode. */
  OPPORTUNITY_OVERREACTION_ATR_MULT: (() => {
    const n = parseFloat(process.env.OPPORTUNITY_OVERREACTION_ATR_MULT, 10);
    return Number.isFinite(n) && n > 0 ? n : 2.5;
  })(),
  /** % vs baseline — used in pct mode or when daily ATR cannot be computed */
  OPPORTUNITY_ON_SALE_DROP_PCT: (() => {
    const n = parseFloat(process.env.OPPORTUNITY_ON_SALE_DROP_PCT, 10);
    return Number.isFinite(n) && n > 0 && n < 100 ? n : 5;
  })(),
  OPPORTUNITY_OVERREACTION_DROP_PCT: (() => {
    const n = parseFloat(process.env.OPPORTUNITY_OVERREACTION_DROP_PCT, 10);
    return Number.isFinite(n) && n > 0 && n < 100 ? n : 12;
  })(),
  /** |day change| vs “typical” move for vol-spike overreaction (when typical move is available) */
  OPPORTUNITY_VOL_SPIKE_MULT: (() => {
    const n = parseFloat(process.env.OPPORTUNITY_VOL_SPIKE_MULT, 10);
    return Number.isFinite(n) && n > 0 ? n : 2;
  })(),
  /** Redis dedupe TTL for opportunity socket/email per user+symbol bucket */
  OPPORTUNITY_DEDUPE_TTL_SEC: (() => {
    const n = parseInt(process.env.OPPORTUNITY_DEDUPE_TTL_SEC, 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 7 * 24 * 3600) : 3600;
  })(),

  /** Phase 2 — require N qualifying minute polls before opportunity email (toasts unaffected). */
  OPPORTUNITY_EMAIL_CONFIRM_ENABLED: process.env.OPPORTUNITY_EMAIL_CONFIRM_ENABLED !== 'false',
  OPPORTUNITY_EMAIL_CONFIRM_HITS: (() => {
    const n = parseInt(process.env.OPPORTUNITY_EMAIL_CONFIRM_HITS, 10);
    return Number.isFinite(n) && n >= 1 && n <= 5 ? n : 2;
  })(),
  OPPORTUNITY_EMAIL_CONFIRM_POLLS: (() => {
    const n = parseInt(process.env.OPPORTUNITY_EMAIL_CONFIRM_POLLS, 10);
    return Number.isFinite(n) && n >= 2 && n <= 10 ? n : 3;
  })(),
  /** Capitulation-tier emails skip 2-of-3 confirmation (major moves). */
  OPPORTUNITY_EMAIL_CONFIRM_SKIP_CAPITULATION:
    process.env.OPPORTUNITY_EMAIL_CONFIRM_SKIP_CAPITULATION !== 'false',

  /** US stocks: poll every N minutes outside RTH (crypto always every minute). */
  OPPORTUNITY_STOCK_OFFHOURS_POLL_MIN: (() => {
    const n = parseInt(process.env.OPPORTUNITY_STOCK_OFFHOURS_POLL_MIN, 10);
    return Number.isFinite(n) && n >= 1 && n <= 60 ? n : 5;
  })(),

  /** Queue stock opportunity emails outside RTH; flush once at session open. */
  OPPORTUNITY_EMAIL_MORNING_BATCH_ENABLED:
    process.env.OPPORTUNITY_EMAIL_MORNING_BATCH_ENABLED !== 'false',

  /** Phase 3 — durable outbox + worker (instant queue or hourly digest batches). */
  ENABLE_EMAIL_OUTBOX: process.env.ENABLE_EMAIL_OUTBOX !== 'false',
  EMAIL_OUTBOX_CRON: process.env.EMAIL_OUTBOX_CRON || '*/1 * * * *',
  EMAIL_OUTBOX_BATCH_SIZE: (() => {
    const n = parseInt(process.env.EMAIL_OUTBOX_BATCH_SIZE, 10);
    return Number.isFinite(n) && n >= 1 && n <= 100 ? n : 8;
  })(),
  /** Max instant opportunity rows processed per outbox cron tick (plus dip-insight cap). */
  EMAIL_OUTBOX_INSTANT_MAX_PER_TICK: (() => {
    const n = parseInt(process.env.EMAIL_OUTBOX_INSTANT_MAX_PER_TICK, 10);
    return Number.isFinite(n) && n >= 0 && n <= 50 ? n : 3;
  })(),
  EMAIL_OUTBOX_MAX_ATTEMPTS: (() => {
    const n = parseInt(process.env.EMAIL_OUTBOX_MAX_ATTEMPTS, 10);
    return Number.isFinite(n) && n >= 1 && n <= 20 ? n : 5;
  })(),

  /** Long-term “Major Capitulation” tier — parallel to short/medium ATR tiers */
  OPPORTUNITY_CAPITULATION_ATR14_MULT: (() => {
    const n = parseFloat(process.env.OPPORTUNITY_CAPITULATION_ATR14_MULT);
    return Number.isFinite(n) && n > 0 ? n : 4;
  })(),
  OPPORTUNITY_CAPITULATION_ATR50_MULT: (() => {
    const n = parseFloat(process.env.OPPORTUNITY_CAPITULATION_ATR50_MULT);
    return Number.isFinite(n) && n > 0 ? n : 3;
  })(),
  /** Drawdown from trailing ~52-week daily high (percent points, e.g. 20 = 20%) */
  OPPORTUNITY_CAPITULATION_FROM_52W_PCT: (() => {
    const n = parseFloat(process.env.OPPORTUNITY_CAPITULATION_FROM_52W_PCT, 10);
    return Number.isFinite(n) && n > 0 && n < 100 ? n : 20;
  })(),
  /** Fallback when ATR/structure ambiguous — vs ~52w high (percent drawdown) */
  OPPORTUNITY_CAPITULATION_FALLBACK_52W_PCT: (() => {
    const n = parseFloat(process.env.OPPORTUNITY_CAPITULATION_FALLBACK_52W_PCT, 10);
    return Number.isFinite(n) && n > 0 && n < 100 ? n : 18;
  })(),
  /** Mega-cap optional rule — vs session ATH proxy from daily highs (percent drawdown) */
  OPPORTUNITY_CAPITULATION_MEGA_CAP_ATH_PCT: (() => {
    const n = parseFloat(process.env.OPPORTUNITY_CAPITULATION_MEGA_CAP_ATH_PCT, 10);
    return Number.isFinite(n) && n > 0 && n < 100 ? n : 15;
  })(),
  /** Comma-separated tickers for mega-cap ATH rule (stocks only). Set to NONE to disable. */
  OPPORTUNITY_MEGA_CAP_SYMBOLS: (() => {
    const raw = process.env.OPPORTUNITY_MEGA_CAP_SYMBOLS;
    const src =
      raw === undefined || raw === null
        ? 'AAPL,MSFT,NVDA,META,GOOGL,GOOG,AMZN,TSLA'
        : String(raw);
    const t = src.trim().toUpperCase();
    if (t === '' || t === 'NONE' || t === '-') return [];
    return src
      .split(/[, \t]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  })(),
  /** Dedupe window for capitulation tier (default 24h; use 604800 for weekly) */
  OPPORTUNITY_CAPITULATION_DEDUPE_TTL_SEC: (() => {
    const n = parseInt(process.env.OPPORTUNITY_CAPITULATION_DEDUPE_TTL_SEC, 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 14 * 24 * 3600) : 86400;
  })(),

  /**
   * Short-tier trend filter: require last price above N-day SMA of closes (fail-open if SMA missing).
   * Capitulation tier ignores this. Set OPPORTUNITY_SHORT_TREND_FILTER_ENABLED=true to enable.
   */
  OPPORTUNITY_SHORT_TREND_FILTER_ENABLED: process.env.OPPORTUNITY_SHORT_TREND_FILTER_ENABLED === 'true',
  OPPORTUNITY_SHORT_TREND_SMA_DAYS: (() => {
    const n = parseInt(process.env.OPPORTUNITY_SHORT_TREND_SMA_DAYS, 10);
    return Number.isFinite(n) && n >= 20 && n <= 300 ? n : 200;
  })(),

  /**
   * Drop ATR14/ATR50 for rules when ATR is tiny vs price (penny / broken quotes). Percent of price, e.g. 0.05 = 0.05%.
   * 0 = disabled.
   */
  OPPORTUNITY_ATR_MIN_PCT_OF_PRICE: (() => {
    const n = parseFloat(process.env.OPPORTUNITY_ATR_MIN_PCT_OF_PRICE);
    return Number.isFinite(n) && n >= 0 && n < 50 ? n : 0;
  })(),

  /** Supabase (global live chat) — service role server-side only */
  SUPABASE_URL: String(process.env.SUPABASE_URL || '').replace(/\/$/, ''),
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',

  // Development mode settings
  ENABLE_TEST_USER: process.env.NODE_ENV === 'development' || process.env.ENABLE_TEST_USER === 'true',
  GRACEFUL_DB_FAILURE: process.env.GRACEFUL_DB_FAILURE !== 'false',

  // HTTPS Configuration
  HTTPS_ENABLED: process.env.HTTPS_ENABLED === 'true',
  HTTPS_PORT: parseInt(process.env.HTTPS_PORT) || 3443,
  SSL_KEY_PATH: process.env.SSL_KEY_PATH || path.join(__dirname, '../ssl/server.key'),
  SSL_CERT_PATH: process.env.SSL_CERT_PATH || path.join(__dirname, '../ssl/server.crt')
};

// Validation function
function validateConfig() {
  const errors = [];
  const warnings = [];
  const isJwtFallback = config.JWT_SECRET.startsWith('fallback-jwt-secret-change-in-production-');

  // Critical validations
  if (!config.JWT_SECRET || config.JWT_SECRET === 'your-super-secret-jwt-key-change-in-production' || isJwtFallback) {
    warnings.push('⚠️  Using default JWT_SECRET - change this in production!');
  }

  if (config.DATABASE_URL === 'postgresql://keepitbased:password@localhost:5432/keepitbased') {
    warnings.push('⚠️  Using default database credentials');
  }

  // Port validation
  if (isNaN(config.PORT) || config.PORT < 1 || config.PORT > 65535) {
    errors.push('❌ Invalid PORT number');
  }

  // Environment specific validations
  if (config.NODE_ENV === 'production') {
    if (!process.env.JWT_SECRET) {
      errors.push('❌ JWT_SECRET must be set in production');
    }
    if (isJwtFallback) {
      errors.push('❌ Fallback JWT secret is not allowed in production');
    }
    if (!process.env.MASSIVE_API_KEY && !process.env.POLYGON_API_KEY) {
      errors.push('❌ MASSIVE_API_KEY (or POLYGON_API_KEY) must be set in production');
    }
    if (!process.env.DATABASE_URL) {
      warnings.push('⚠️  DATABASE_URL not explicitly set in production');
    }
    if (config.HTTPS_ENABLED && (!config.SSL_KEY_PATH || !config.SSL_CERT_PATH)) {
      warnings.push('⚠️  HTTPS enabled but SSL certificates not configured');
    }
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      warnings.push('⚠️  SMTP credentials are not fully configured in production');
    }
  }

  // Log results
  if (warnings.length > 0) {
    console.log('\n🟡 Configuration Warnings:');
    warnings.forEach(warning => console.log(`   ${warning}`));
  }

  if (errors.length > 0) {
    console.log('\n🔴 Configuration Errors:');
    errors.forEach(error => console.log(`   ${error}`));
    return false;
  }

  console.log('\n✅ Configuration validated successfully');
  return true;
}

// Export config and validation
module.exports = {
  ...config,
  validate: validateConfig,
  
  // Helper functions
  isDevelopment: () => config.NODE_ENV === 'development',
  isProduction: () => config.NODE_ENV === 'production',
  
  // Database helpers
  getDatabaseConfig: () => ({
    connectionString: config.DATABASE_URL,
    ssl: config.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  })
};