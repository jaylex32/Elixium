/**
 * The API token this browser uses.
 *
 * The server exempts loopback, so a browser on the machine running Elixium
 * never needs one and never sees a prompt. Opening the UI from a phone or
 * another desktop does need one, and that is what this stores.
 *
 * localStorage rather than a cookie: the token is also appended to <audio> and
 * download URLs, so it has to be readable by script anyway, and a cookie would
 * add CSRF surface without adding protection.
 */

const STORAGE_KEY = 'elixium-api-token';

let cached: string | null = null;

export const getToken = (): string => {
  if (cached !== null) return cached;
  try {
    cached = localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    // Private browsing or a blocked origin: behave as if unpaired.
    cached = '';
  }
  return cached;
};

export const setToken = (token: string): void => {
  cached = token.trim();
  try {
    if (cached) localStorage.setItem(STORAGE_KEY, cached);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Non-fatal: the token still applies for this page's lifetime.
  }
};

export const clearToken = (): void => setToken('');

/**
 * Append the token to a URL the browser loads directly.
 *
 * `<audio src>` and anchor downloads cannot carry headers, so those URLs need
 * the token in the query string. Returns the URL untouched when unpaired, so
 * the loopback case stays clean.
 */
export const withToken = (url: string): string => {
  const token = getToken();
  if (!token) return url;
  return url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
};

/**
 * Whether a failure means "this browser needs to be paired".
 *
 * Distinguishes a genuine auth refusal from an unreachable server, so the UI
 * can show a token prompt instead of a generic connection error.
 */
export const isAuthFailure = (status: number | undefined, message?: string): boolean =>
  status === 401 || message === 'auth_required' || message === 'auth_invalid';

/**
 * Broadcast that the server refused this browser.
 *
 * A plain subscriber list rather than store state: the refusal originates in
 * the axios interceptor and the socket handler, neither of which is a React
 * context, and both need to reach the same prompt.
 */
type AuthListener = () => void;
const listeners = new Set<AuthListener>();

export const onAuthRequired = (listener: AuthListener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const notifyAuthRequired = (): void => {
  for (const listener of listeners) listener();
};
