/**
 * Generates a QR code URL for self-order session
 * @param {string} sessionId - The bill session ID
 * @param {string} baseUrl - Optional base URL for the self-order app
 * @returns {string} The QR code data URL
 */
export function generateSelfOrderQRCode(sessionId, baseUrl = null) {
  const url = baseUrl || `${window.location.origin}/selforder.html`;
  const sessionUrl = `selforder://session/${sessionId}`;
  
  // For simplicity, we'll return a data URL with a placeholder
  // In production, you might want to use a proper QR code library
  return `data:text/plain;charset=utf-8,${encodeURIComponent(sessionUrl)}`;
}

/**
 * Gets the self-order URL for a session
 * @param {string} sessionId - The bill session ID
 * @param {string} baseUrl - Optional base URL
 * @returns {string} The full self-order URL
 */
export function getSelfOrderUrl(sessionId, baseUrl = null) {
  const url = baseUrl || `${window.location.origin}/selforder.html`;
  return `${url}#/session/${sessionId}`;
}
