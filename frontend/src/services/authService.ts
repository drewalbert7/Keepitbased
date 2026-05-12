import axios from 'axios';
import { User } from '../types';
import { getApiBaseUrl } from '../config/apiBase';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One retry after deploy blips / nginx upstream gaps (502/503/504) or brief network loss. */
function isAuthTransientError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') return true;
  const s = error.response?.status;
  return s === 502 || s === 503 || s === 504;
}

interface LoginResponse {
  message: string;
  token: string;
  user: User;
}

interface RegisterResponse {
  message: string;
  token: string;
  user: User;
}

class AuthService {
  private token: string | null = null;

  constructor() {
    // Set up axios defaults
    axios.defaults.baseURL = getApiBaseUrl();
    
    // Add request interceptor to include auth token
    axios.interceptors.request.use((cfg) => {
      if (this.token) {
        cfg.headers.Authorization = `Bearer ${this.token}`;
      }
      const method = cfg.method?.toLowerCase();
      const url = String(cfg.url || '');
      if (
        method === 'delete' &&
        (url.includes('/alerts/') || url.includes('/watchlist/symbols/'))
      ) {
        cfg.headers['X-Confirm-Delete'] = '1';
      }
      return cfg;
    });

    // Add response interceptor to handle auth errors
    axios.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          const url = String(error.config?.url || '');
          const isCredentialAttempt =
            url.includes('/auth/login') || url.includes('/auth/register');
          if (!isCredentialAttempt) {
            this.clearToken();
            localStorage.removeItem('token');
            window.location.href = '/login';
          }
        }
        return Promise.reject(error);
      }
    );
  }

  setToken(token: string) {
    this.token = token;
  }

  clearToken() {
    this.token = null;
  }

  async login(email: string, password: string): Promise<LoginResponse> {
    const post = () =>
      axios.post<LoginResponse>('/auth/login', { email, password }).then((r) => r.data);
    try {
      return await post();
    } catch (e) {
      if (!isAuthTransientError(e)) throw e;
      await sleep(1000);
      return await post();
    }
  }

  async register(
    username: string,
    email: string,
    password: string,
    inviteCode: string
  ): Promise<RegisterResponse> {
    const body = { username, email, password, inviteCode };
    const post = () =>
      axios.post<RegisterResponse>('/auth/register', body).then((r) => r.data);
    try {
      return await post();
    } catch (e) {
      if (!isAuthTransientError(e)) throw e;
      await sleep(1000);
      return await post();
    }
  }

  async getCurrentUser(): Promise<User> {
    const get = () => axios.get<User>('/auth/me').then((r) => r.data);
    try {
      return await get();
    } catch (e) {
      if (!isAuthTransientError(e)) throw e;
      await sleep(1000);
      return await get();
    }
  }

  async updateProfile(userData: {
    username?: string;
    notificationPreferences?: Partial<User['notificationPreferences']>;
  }): Promise<User> {
    const response = await axios.put<User>('/users/profile', userData);
    return response.data;
  }

  async getSignupPasscodeStatus(): Promise<{ active: boolean }> {
    const { data } = await axios.get<{ active: boolean }>('/users/profile/signup-passcode');
    return data;
  }

  /** Host-only flags (JWT). Not returned from public GET /api/health/config. */
  async getHostNotificationFlags(): Promise<{
    smtpConfigured: boolean;
    dailyWatchlistDigestEnabled: boolean;
    dailyWatchlistDigestCron?: string;
  }> {
    const { data } = await axios.get<{
      smtpConfigured: boolean;
      dailyWatchlistDigestEnabled: boolean;
      dailyWatchlistDigestCron?: string;
    }>('/users/profile/host-notification-flags');
    return data;
  }

  async setSignupPasscode(passcode: string): Promise<{ message: string; lastPasscodeShown: string | null }> {
    const { data } = await axios.put<{ message: string; lastPasscodeShown: string | null }>(
      '/users/profile/signup-passcode',
      { passcode }
    );
    return data;
  }

  async clearSignupPasscode(): Promise<{ message: string }> {
    const { data } = await axios.put<{ message: string; lastPasscodeShown: null }>(
      '/users/profile/signup-passcode',
      { clear: true }
    );
    return data;
  }

  async getUserStats(): Promise<{
    alerts: { total: number; active: number };
    notifications: { total: number; today: number; week: number };
    topSymbols: Array<{ symbol: string; asset_type: string; count: number }>;
  }> {
    const response = await axios.get('/users/stats');
    return response.data;
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<{ message: string }> {
    const response = await axios.post<{ message: string }>('/auth/change-password', {
      currentPassword,
      newPassword
    });
    return response.data;
  }

  async recoverUsername(email: string): Promise<{ message: string }> {
    const response = await axios.post<{ message: string }>('/auth/recover-username', {
      email
    });
    return response.data;
  }

  async recoverPassword(email: string): Promise<{ message: string }> {
    const response = await axios.post<{ message: string }>('/auth/recover-password', {
      email
    });
    return response.data;
  }

  async resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
    const response = await axios.post<{ message: string }>('/auth/reset-password', {
      token,
      newPassword
    });
    return response.data;
  }

  async getAdminSignupInviteStatus(): Promise<{ configured: boolean; updatedAt: string | null }> {
    const response = await axios.get<{ configured: boolean; updatedAt: string | null }>(
      '/admin/signup-invite'
    );
    return response.data;
  }

  async rotateSignupInvite(newInviteCode: string, currentPassword: string): Promise<{
    message: string;
    configured: boolean;
    updatedAt: string | null;
  }> {
    const response = await axios.put<{
      message: string;
      configured: boolean;
      updatedAt: string | null;
    }>('/admin/signup-invite', { newInviteCode, currentPassword });
    return response.data;
  }
}

export const authService = new AuthService();