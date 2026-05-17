// User types
export interface User {
  id: number;
  email: string;
  /** Public handle (unique, lowercase in API). */
  username?: string | null;
  /** Legacy — new signups use `username` only. */
  firstName: string | null;
  lastName: string | null;
  notificationPreferences?: {
    email: boolean;
    push: boolean;
    /** In-app toast when deterministic opportunity signals fire (Socket `opportunitySignal`). Default true. */
    opportunityToasts?: boolean;
    /** §11 fused research+dip digest emails (Phase D). Default on unless opted out. */
    researchDigestEmail?: boolean;
    researchMaxEmailsPerDay?: number;
    /** Requires backend ENABLE_DIP_INSIGHT_EMAIL; Grok dip briefing vs plain opportunity email. */
    dipInsightEmail?: boolean;
    /** Caps suggested tranche % in dip briefing emails (1–50). */
    agentMaxPositionSizePct?: number;
    /** Opportunity dip emails; requires email master switch. Default true. */
    opportunityEmail?: boolean;
    /** In-app toasts: `overreaction_only` skips on_sale-only (still in Signals). */
    opportunityNotifyLevel?: 'all' | 'overreaction_only';
    /**
     * Opportunity **emails** only. Default `overreaction_only`; use `all` for every qualifying tier.
     * `capitulation_only` = major long-term tier only.
     */
    opportunityEmailNotifyLevel?: 'all' | 'overreaction_only' | 'capitulation_only';

    /** Max opportunity dip emails per UTC day (plain + Grok briefing). */
    opportunityMaxEmailsPerDay?: number;

    /** IANA timezone for quiet hours (e.g. America/New_York). */
    timezone?: string;
    /** Local quiet window start (HH:mm). */
    quietHoursStart?: string;
    /** Local quiet window end (HH:mm). */
    quietHoursEnd?: string;
    /** When true (default), no opportunity emails during quiet hours. */
    opportunityRespectQuietHours?: boolean;

    /** `instant` = send soon via outbox; `hourly_digest` = one combined email per UTC hour. */
    opportunityEmailDeliveryMode?: 'instant' | 'hourly_digest';

    /** Daily batched Grok email (server flag + Python Grok). Default on unless opted out. */
    dailyWatchlistDigestEmail?: boolean;
    /**
     * When true (default), US stock opportunity toasts/emails only during regular session. Crypto is always 24/7.
     */
    opportunityStockMarketHoursOnly?: boolean;
  };
  createdAt?: string;
  /** True when backend lists this user's email under ADMIN_SIGNUP_EMAILS — can rotate signup invite code. */
  isSignupInviteAdmin?: boolean;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  loading: boolean;
}

// Price types
export interface PriceData {
  symbol: string;
  price: number;
  change24h?: number;
  changePercent?: number;
  timestamp: number;
  type: 'crypto' | 'stock';
}

export interface Symbol {
  symbol: string;
  name: string;
  type: 'crypto' | 'stock';
}

// Alert types
export interface Alert {
  id: number;
  userId: number;
  symbol: string;
  assetType: 'crypto' | 'stock';
  smallThreshold: number;
  mediumThreshold: number;
  largeThreshold: number;
  baselinePrice?: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AlertHistory {
  id: number;
  userId: number;
  symbol: string;
  assetType: 'crypto' | 'stock';
  alertLevel: 'small' | 'medium' | 'large';
  currentPrice: number;
  baselinePrice: number;
  dropPercentage: number;
  thresholdPercentage: number;
  message: string;
  createdAt: string;
}

export interface CreateAlertRequest {
  symbol: string;
  assetType: 'crypto' | 'stock';
  smallThreshold?: number;
  mediumThreshold?: number;
  largeThreshold?: number;
}

export interface UpdateAlertRequest {
  smallThreshold?: number;
  mediumThreshold?: number;
  largeThreshold?: number;
  active?: boolean;
}

// Notification types
export interface LiveAlert {
  id: number;
  userId: number;
  symbol: string;
  assetType: 'crypto' | 'stock';
  level: 'small' | 'medium' | 'large';
  currentPrice: number;
  baselinePrice: number;
  dropPercentage: string;
  threshold: number;
  message: string;
  timestamp: string;
}

// Form types
export interface LoginFormData {
  email: string;
  password: string;
}

export interface RegisterFormData {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  inviteCode: string;
}

// API Response types
export interface ApiResponse<T = any> {
  message?: string;
  data?: T;
  error?: string;
  errors?: Array<{
    field?: string;
    message: string;
  }>;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}

// Chart types
export interface ChartDataPoint {
  timestamp: number;
  price: number;
  volume?: number;
}

// Socket events
export interface SocketEvents {
  connect: () => void;
  disconnect: () => void;
  priceUpdate: (prices: PriceData[]) => void;
  priceDrop: (drop: {
    symbol: string;
    type: 'crypto' | 'stock';
    currentPrice: number;
    previousPrice: number;
    dropPercentage: number;
    timestamp: number;
  }) => void;
  alert: (alert: LiveAlert) => void;
}