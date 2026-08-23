export type User = {
  id: string;
  name: string;
  email: string;
  isSeller: boolean;
  emailVerified: boolean;
  /** Public URL of the stored avatar, or null to fall back to initials. */
  avatarUrl: string | null;
  createdAt: string;
};

export class ApiError extends Error {
  code?: string;
  field?: string;

  constructor(message: string, code?: string, field?: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.field = field;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    // FormData sets its own multipart Content-Type with a boundary; overriding
    // it would make the body unparseable.
    headers:
      options.body instanceof FormData
        ? options.headers
        : { "Content-Type": "application/json", ...options.headers },
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(body.error ?? "Something went wrong. Please try again.", body.code, body.field);
  }

  return body as T;
}

export function signup(input: { name: string; email: string; password: string }) {
  return request<{ message: string; email: string }>("/auth/signup", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function login(input: { email: string; password: string }) {
  return request<{ user: User }>("/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function logout() {
  return request<void>("/auth/logout", { method: "POST" });
}

export function me() {
  return request<{ user: User }>("/auth/me");
}

export function verifyEmail(token: string) {
  return request<{ user: User }>("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export function resendVerification(email: string) {
  return request<{ message: string }>("/auth/resend-verification", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function becomeSeller() {
  return request<{ user: User }>("/auth/become-seller", { method: "POST" });
}

export function uploadAvatar(file: File) {
  const form = new FormData();
  form.append("avatar", file);
  return request<{ user: User }>("/profile/avatar", { method: "POST", body: form });
}

export function removeAvatar() {
  return request<{ user: User }>("/profile/avatar", { method: "DELETE" });
}
