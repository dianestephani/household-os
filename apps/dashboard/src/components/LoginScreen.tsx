import { useEffect, useRef, useState } from 'react';
import { GOOGLE_OAUTH_CLIENT_ID, type AuthSession } from '../auth.js';

interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleAccountsId {
  initialize: (config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    auto_select?: boolean;
    use_fedcm_for_prompt?: boolean;
  }) => void;
  renderButton: (
    parent: HTMLElement,
    options: {
      type?: 'standard' | 'icon';
      theme?: 'outline' | 'filled_blue' | 'filled_black';
      size?: 'large' | 'medium' | 'small';
      shape?: 'rectangular' | 'pill';
      text?: 'signin_with' | 'signup_with' | 'continue_with';
    },
  ) => void;
  prompt: () => void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: GoogleAccountsId;
      };
    };
  }
}

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

export default function LoginScreen({
  onLogin,
}: {
  onLogin: (session: AuthSession) => void;
}) {
  const buttonRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exchanging, setExchanging] = useState(false);

  useEffect(() => {
    // Poll briefly for the GIS script (loaded async/defer in index.html).
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (window.google?.accounts?.id) {
        clearInterval(timer);
        window.google.accounts.id.initialize({
          client_id: GOOGLE_OAUTH_CLIENT_ID,
          callback: async (resp) => {
            setExchanging(true);
            setError(null);
            try {
              const res = await fetch(`${API_BASE}/auth/google`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ credential: resp.credential }),
              });
              if (!res.ok) {
                const body = (await res.json().catch(() => ({}))) as {
                  error?: string;
                };
                throw new Error(body.error ?? `${res.status}`);
              }
              const data = (await res.json()) as AuthSession;
              onLogin(data);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setExchanging(false);
            }
          },
        });
        if (buttonRef.current) {
          window.google.accounts.id.renderButton(buttonRef.current, {
            type: 'standard',
            theme: 'filled_black',
            size: 'large',
            shape: 'rectangular',
            text: 'continue_with',
          });
        }
      } else if (attempts > 50) {
        clearInterval(timer);
        setError('Could not load Google sign-in. Check your network + ad-blocker.');
      }
    }, 100);
    return () => clearInterval(timer);
  }, [onLogin]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
      }}
    >
      <div
        className="panel"
        style={{
          maxWidth: '420px',
          width: '100%',
          textAlign: 'center',
          marginBottom: 0,
        }}
      >
        <h1
          style={{
            margin: '0 0 0.4rem',
            fontSize: '1.85rem',
          }}
        >
          Household OS
        </h1>
        <p className="muted" style={{ marginTop: 0, marginBottom: '1.5rem' }}>
          Diane's personal household management system. Sign in with the
          allowlisted Google account to continue.
        </p>
        <div
          ref={buttonRef}
          style={{ display: 'flex', justifyContent: 'center', minHeight: '40px' }}
        />
        {exchanging && (
          <div className="muted" style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}>
            Signing in…
          </div>
        )}
        {error && (
          <div
            style={{
              marginTop: '0.75rem',
              fontSize: '0.85rem',
              color: 'var(--bad)',
            }}
          >
            {error === 'email_not_allowed'
              ? "That Google account isn't on the allowlist."
              : error === 'email_not_verified'
                ? 'Google says that email is not verified.'
                : error === 'invalid_credential'
                  ? 'Google sign-in credential was rejected. Try again.'
                  : `Sign-in error: ${error}`}
          </div>
        )}
      </div>
    </div>
  );
}
