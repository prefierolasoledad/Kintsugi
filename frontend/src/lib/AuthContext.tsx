"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import * as api from "@/lib/api";
import type { User } from "@/lib/api";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  signup: (input: { name: string; email: string; password: string }) => Promise<{ email: string }>;
  login: (input: { email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  verifyEmail: (token: string) => Promise<void>;
  resendVerification: (email: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const signup = useCallback(async (input: { name: string; email: string; password: string }) => {
    // Signup no longer logs the user in — the account is unverified until
    // they click the link sent to their email.
    const { email } = await api.signup(input);
    return { email };
  }, []);

  const login = useCallback(async (input: { email: string; password: string }) => {
    const { user } = await api.login(input);
    setUser(user);
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  const verifyEmail = useCallback(async (token: string) => {
    const { user } = await api.verifyEmail(token);
    setUser(user);
  }, []);

  const resendVerification = useCallback(async (email: string) => {
    await api.resendVerification(email);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, signup, login, logout, verifyEmail, resendVerification }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
