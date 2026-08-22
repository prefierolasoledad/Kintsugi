"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import * as api from "@/lib/api";
import type { User } from "@/lib/api";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  signup: (input: { name: string; email: string; password: string }) => Promise<void>;
  login: (input: { email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
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
    const { user } = await api.signup(input);
    setUser(user);
  }, []);

  const login = useCallback(async (input: { email: string; password: string }) => {
    const { user } = await api.login(input);
    setUser(user);
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signup, login, logout }}>
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
