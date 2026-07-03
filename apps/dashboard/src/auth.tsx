import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { get, hasToken, setIdToken, setUnauthorizedHandler } from "./api/client.js";
import type { Me } from "./api/types.js";

/**
 * Google Identity Services sign-in. The ID token authenticates every API
 * call; access is only granted to users provisioned (with a role) in the
 * users table server-side.
 */

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }): void;
          renderButton(el: HTMLElement, options: Record<string, unknown>): void;
        };
      };
    };
  }
}

interface AuthState {
  me: Me | null;
  signOut(): void;
}

const AuthContext = createContext<AuthState>({ me: null, signOut: () => undefined });

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID as string | undefined;

export function AuthProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [me, setMe] = useState<Me | null>(null);
  const [checking, setChecking] = useState(hasToken());
  const [error, setError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLDivElement>(null);

  const loadMe = useCallback(async () => {
    try {
      setMe(await get<Me>("/me"));
      setError(null);
    } catch (err) {
      setMe(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setMe(null));
    if (hasToken()) void loadMe();
  }, [loadMe]);

  useEffect(() => {
    if (me || checking) return;
    const timer = setInterval(() => {
      if (!window.google || !buttonRef.current || !GOOGLE_CLIENT_ID) return;
      clearInterval(timer);
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response) => {
          setIdToken(response.credential);
          void loadMe();
        },
      });
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: "filled_black",
        size: "large",
        text: "signin_with",
      });
    }, 200);
    return () => clearInterval(timer);
  }, [me, checking, loadMe]);

  const signOut = useCallback(() => {
    setIdToken(null);
    setMe(null);
  }, []);

  if (checking) {
    return <div className="signin-screen">Loading…</div>;
  }

  if (!me) {
    return (
      <div className="signin-screen">
        <div className="signin-card">
          <h1>QAme</h1>
          <p>Call QA &amp; Conversation Intelligence</p>
          {!GOOGLE_CLIENT_ID && (
            <p className="error">VITE_GOOGLE_OAUTH_CLIENT_ID is not configured.</p>
          )}
          {error && <p className="error">{error}</p>}
          <div ref={buttonRef} />
        </div>
      </div>
    );
  }

  return <AuthContext.Provider value={{ me, signOut }}>{children}</AuthContext.Provider>;
}
