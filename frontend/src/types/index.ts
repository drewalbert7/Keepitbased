// User types
export interface User {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  notificationPreferences?: {
    email: boolean;
    push: boolean;
  };
  createdAt: string;
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
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
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