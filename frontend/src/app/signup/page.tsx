"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Logo from "@/components/Logo";
import { IMAGES } from "@/lib/images";
import { useAuth } from "@/lib/AuthContext";

export default function SignupPage() {
  const router = useRouter();
  const { signup } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signup({ name, email, password });
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-1">
      <div className="relative hidden w-1/2 lg:block">
        <Image
          src={IMAGES.heroFleaMarket}
          alt="Table of vintage and secondhand items at an outdoor market"
          fill
          className="object-cover"
        />
        <div className="absolute inset-0 bg-linear-to-t from-ink from-10% via-ink/75 via-45% to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-10">
          <p className="font-serif text-2xl text-paper">
            Every piece has a past. Yours is next.
          </p>
        </div>
      </div>

      <div className="flex w-full flex-1 items-center justify-center px-6 py-16 lg:w-1/2">
        <div className="w-full max-w-sm">
          <Link href="/" className="flex items-center gap-2.5">
            <Logo size={28} />
            <span className="font-serif text-lg font-medium tracking-tight text-ink">
              金継ぎ <span className="text-gradient-gold">Kintsugi</span>
            </span>
          </Link>

          <h1 className="mt-10 font-serif text-3xl font-medium tracking-tight text-ink">
            Create your account
          </h1>
          <p className="mt-2 text-sm text-ink-dim">
            One account to buy or sell — you can list your first item right after.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <div>
              <label htmlFor="name" className="text-sm font-medium text-ink">
                Name
              </label>
              <input
                id="name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1.5 w-full rounded-2xl border border-line bg-paper-card px-3.5 py-2.5 text-sm text-ink outline-none focus:border-gold"
              />
            </div>

            <div>
              <label htmlFor="email" className="text-sm font-medium text-ink">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5 w-full rounded-2xl border border-line bg-paper-card px-3.5 py-2.5 text-sm text-ink outline-none focus:border-gold"
              />
            </div>

            <div>
              <label htmlFor="password" className="text-sm font-medium text-ink">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5 w-full rounded-2xl border border-line bg-paper-card px-3.5 py-2.5 text-sm text-ink outline-none focus:border-gold"
              />
              <p className="mt-1.5 text-xs text-ink-dim">At least 8 characters.</p>
            </div>

            {error && <p className="text-sm text-red-700">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="seam-glow w-full rounded-full bg-gold-dim px-6 py-3 text-sm font-semibold text-paper transition hover:brightness-90 disabled:opacity-60"
            >
              {submitting ? "Creating account…" : "Create account"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-ink-dim">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-gold-dim hover:text-gold">
              Log in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
