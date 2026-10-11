const PRE_LOGIN_URL_KEY = "preLoginUrl";

/**
 * Save the current URL so login/register can redirect back to it afterward.
 * Only saves when the URL carries meaningful state (not just the origin root).
 */
export function savePreLoginUrl(): void {
  try {
    const href = window.location.href;
    if (href && href !== `${window.location.origin}/`) {
      sessionStorage.setItem(PRE_LOGIN_URL_KEY, href);
    }
  } catch {
    // ignore
  }
}

/**
 * Read and clear the saved pre-login URL (one-shot).
 * Returns null if nothing was saved.
 */
export function consumePreLoginUrl(): string | null {
  try {
    const url = sessionStorage.getItem(PRE_LOGIN_URL_KEY);
    sessionStorage.removeItem(PRE_LOGIN_URL_KEY);
    return url;
  } catch {
    return null;
  }
}
