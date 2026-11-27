import { createContext, useContext, useEffect, useMemo, useState } from "react";

const AuthContext = createContext(null);

function readCookie(name) {
  const prefix = `${name}=`;
  const entry = document.cookie.split("; ").find((cookie) => cookie.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : "";
}

async function getCsrfToken() {
  const response = await fetch("/api/auth/csrf/", { credentials: "same-origin" });
  if (!response.ok) throw new Error("Could not initialize secure account requests.");
  const data = await response.json();
  return data.csrfToken || readCookie("csrftoken");
}

export async function apiFetch(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});
  if (!["GET", "HEAD", "OPTIONS", "TRACE"].includes(method)) {
    const csrfToken = await getCsrfToken();
    if (csrfToken) headers.set("X-CSRFToken", csrfToken);
  }
  const response = await fetch(url, {
    ...options,
    method,
    headers,
    credentials: "same-origin",
  });
  const body = await response.text();
  let data = {};
  if (body) {
    try {
      data = JSON.parse(body);
    } catch {
      throw new Error(body.trim().slice(0, 240) || `HTTP ${response.status}`);
    }
  }
  if (!response.ok) {
    const detail = data.error || data.detail || data.message;
    const message = Array.isArray(detail)
      ? detail.join(" ")
      : detail && typeof detail === "object"
        ? Object.values(detail).flat().join(" ")
        : detail;
    throw new Error(message || `HTTP ${response.status}`);
  }
  return data;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    let active = true;
    apiFetch("/api/auth/me/")
      .then((data) => {
        if (active) {
          setUser(data.user);
          setAuthError("");
        }
      })
      .catch((error) => {
        if (active) {
          setUser(null);
          setAuthError(error instanceof Error ? error.message : "Could not check the account session.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function submit(path, payload) {
    const data = await apiFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (Object.hasOwn(data, "user")) setUser(data.user);
    setAuthError("");
    return data;
  }

  const value = useMemo(() => ({
    user,
    loading,
    login: (payload) => submit("/api/auth/login/", payload),
    register: (payload) => submit("/api/auth/register/", payload),
    logout: () => submit("/api/auth/logout/", {}),
    updateProfile: async (payload) => {
      const data = await apiFetch("/api/auth/profile/", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setUser(data.user);
      setAuthError("");
      return data;
    },
  }), [user, loading, authError]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider.");
  return value;
}
