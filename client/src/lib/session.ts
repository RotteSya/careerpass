/**
 * Session token management via localStorage.
 *
 * The app uses localStorage + Authorization: Bearer header as the primary
 * authentication mechanism instead of HTTP-only cookies, to avoid SameSite /
 * Secure cookie restrictions in reverse-proxy environments.
 */

export const SESSION_TOKEN_KEY = "cp_session_token";

export function saveSessionToken(token: string): void {
  localStorage.setItem(SESSION_TOKEN_KEY, token);
}

export function getSessionToken(): string | null {
  return localStorage.getItem(SESSION_TOKEN_KEY);
}

export function clearSessionToken(): void {
  localStorage.removeItem(SESSION_TOKEN_KEY);
}
