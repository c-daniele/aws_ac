/**
 * Session Configuration
 *
 * Controls session timeout behavior
 */

/**
 * Session timeout in minutes
 * After this period of inactivity, a new session will be started automatically
 *
 * Set to 0 to disable timeout (session persists indefinitely)
 */
export const SESSION_TIMEOUT_MINUTES: number = 20

/**
 * LocalStorage key for tracking last activity time
 */
export const LAST_ACTIVITY_KEY = 'chat-last-activity'

/**
 * SessionStorage key for current session ID
 */
export const SESSION_ID_KEY = 'chat-session-id'

/**
 * Check if session has timed out
 * @param lastActivityTime - Unix timestamp in milliseconds
 * @returns true if session has timed out
 */
export function isSessionTimedOut(lastActivityTime: number): boolean {
  if (SESSION_TIMEOUT_MINUTES === 0) {
    return false // Timeout disabled
  }

  const now = Date.now()
  const minutesSinceActivity = (now - lastActivityTime) / 1000 / 60
  return minutesSinceActivity > SESSION_TIMEOUT_MINUTES
}

/**
 * Update last activity timestamp
 */
export function updateLastActivity(): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString())
  }
}

/**
 * Get last activity timestamp
 * @returns Unix timestamp in milliseconds, or null if not found
 */
export function getLastActivity(): number | null {
  if (typeof window === 'undefined') {
    return null
  }

  const stored = localStorage.getItem(LAST_ACTIVITY_KEY)
  if (!stored) {
    return null
  }

  const timestamp = parseInt(stored, 10)
  return isNaN(timestamp) ? null : timestamp
}

/**
 * Clear session data (on timeout or new chat)
 */
export function clearSessionData(): void {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem(SESSION_ID_KEY)
    localStorage.removeItem(LAST_ACTIVITY_KEY)
  }
}
