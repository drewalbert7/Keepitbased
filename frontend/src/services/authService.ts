import axios from 'axios';
import { User } from '../types';

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
    axios.defaults.baseURL = process.env.REACT_APP_API_URL || '/api';
    
    // Add request interceptor to include auth token
    axios.interceptors.request.use((config) => {
      if (this.token) {
        config.headers.Authorization = `Bearer ${this.token}`;
      }
      return config;
    });

    // Add response interceptor to handle auth errors
    axios.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          this.clearToken();
          localStorage.removeItem('token');
          window.location.href = '/login';
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
    const response = await axios.post<LoginResponse>('/auth/login', {
      email,
      password
    });
    return response.data;
  }

  async register(
    firstName: string, 
    lastName: string, 
    email: string, 
    password: string
  ): Promise<RegisterResponse> {
    const response = await axios.post<RegisterResponse>('/auth/register', {
      firstName,
      lastName,
      email,
      password
    });
    return response.data;
  }

  async getCurrentUser(): Promise<User> {
    const response = await axios.get<User>('/auth/me');
    return response.data;
  }

  async updateProfile(userData: {
    firstName?: string;
    lastName?: string;
    notificationPreferences?: {
      email: boolean;
      push: boolean;
    };
  }): Promise<User> {
    const response = await axios.put<User>('/users/profile', userData);
    return response.data;
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
}

export const authService = new AuthService();