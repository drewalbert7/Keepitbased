import React, { createContext, useContext, useReducer, useEffect } from 'react';
import axios from 'axios';
import { AuthState, User } from '../types';
import { authService } from '../services/authService';

export type AuthActionResult =
  | { ok: true }
  | { ok: false; message: string };

function authErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') {
      return 'Cannot reach the server. Check your connection or try again shortly.';
    }
    const status = error.response?.status;
    if (status === 502 || status === 503 || status === 504) {
      return 'Sign-in service is temporarily unavailable. Please try again in a few minutes.';
    }
    if (status === 429) {
      const data = error.response?.data as { message?: string };
      if (typeof data?.message === 'string') return data.message;
      return 'Too many attempts. Please wait before trying again.';
    }
    const data = error.response?.data as { message?: string; errors?: Array<{ msg?: string }> };
    if (typeof data?.message === 'string') return data.message;
    if (Array.isArray(data?.errors) && data.errors.length > 0) {
      const first = data.errors[0];
      if (typeof first?.msg === 'string') return first.msg;
    }
  }
  return fallback;
}

interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<AuthActionResult>;
  register: (
    firstName: string,
    lastName: string,
    email: string,
    password: string,
    inviteCode: string
  ) => Promise<AuthActionResult>;
  logout: () => void;
  updateUser: (userData: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

type AuthAction = 
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_USER'; payload: { user: User; token: string } }
  | { type: 'CLEAR_AUTH' }
  | { type: 'UPDATE_USER'; payload: Partial<User> };

const authReducer = (state: AuthState, action: AuthAction): AuthState => {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_USER':
      return {
        ...state,
        user: action.payload.user,
        token: action.payload.token,
        isAuthenticated: true,
        loading: false
      };
    case 'CLEAR_AUTH':
      return {
        user: null,
        token: null,
        isAuthenticated: false,
        loading: false
      };
    case 'UPDATE_USER':
      return {
        ...state,
        user: state.user ? { ...state.user, ...action.payload } : null
      };
    default:
      return state;
  }
};

const initialState: AuthState = {
  user: null,
  token: null,
  isAuthenticated: false,
  loading: true
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(authReducer, initialState);

  useEffect(() => {
    // Check for existing token on mount
    const initializeAuth = async () => {
      const token = localStorage.getItem('token');
      if (token) {
        try {
          authService.setToken(token);
          const user = await authService.getCurrentUser();
          dispatch({ type: 'SET_USER', payload: { user, token } });
        } catch (error) {
          console.error('Failed to initialize auth:', error);
          localStorage.removeItem('token');
          dispatch({ type: 'CLEAR_AUTH' });
        }
      } else {
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    };

    initializeAuth();
  }, []);

  const login = async (email: string, password: string): Promise<AuthActionResult> => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      const { user, token } = await authService.login(email, password);
      
      localStorage.setItem('token', token);
      authService.setToken(token);
      
      dispatch({ type: 'SET_USER', payload: { user, token } });
      return { ok: true };
    } catch (error) {
      console.error('Login failed:', error);
      dispatch({ type: 'SET_LOADING', payload: false });
      return {
        ok: false,
        message: authErrorMessage(error, 'Invalid email or password'),
      };
    }
  };

  const register = async (
    firstName: string,
    lastName: string,
    email: string,
    password: string,
    inviteCode: string
  ): Promise<AuthActionResult> => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      const { user, token } = await authService.register(
        firstName,
        lastName,
        email,
        password,
        inviteCode
      );
      
      localStorage.setItem('token', token);
      authService.setToken(token);
      
      dispatch({ type: 'SET_USER', payload: { user, token } });
      return { ok: true };
    } catch (error) {
      console.error('Registration failed:', error);
      dispatch({ type: 'SET_LOADING', payload: false });
      return {
        ok: false,
        message: authErrorMessage(error, 'Registration failed. Please try again.'),
      };
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    authService.clearToken();
    dispatch({ type: 'CLEAR_AUTH' });
  };

  const updateUser = (userData: Partial<User>) => {
    dispatch({ type: 'UPDATE_USER', payload: userData });
  };

  const value: AuthContextType = {
    ...state,
    login,
    register,
    logout,
    updateUser
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};