/**
 * Generates a self-order URL for a session (for QR code generation)
 * @param {string} sessionId - The bill session ID
 * @param {string} baseUrl - Optional base URL for the self-order app
 * @param {string} accessToken - Optional JWT token for Directus auth
 * @returns {string} The full self-order URL for QR code
 */
export function generateSelfOrderQRCode(sessionId, baseUrl = null, accessToken = null) {
  const url = baseUrl || `${window.location.origin}/selforder.html`;
  let sessionUrl = `${url}#/session/${sessionId}`;
  
  // Add token if provided for authenticated access
  if (accessToken) {
    sessionUrl += `?access_token=${encodeURIComponent(accessToken)}`;
  }
  
  return sessionUrl;
}

/**
 * Gets the self-order URL for a session
 * @param {string} sessionId - The bill session ID
 * @param {string} baseUrl - Optional base URL
 * @param {string} accessToken - Optional JWT token
 * @returns {string} The full self-order URL
 */
export function getSelfOrderUrl(sessionId, baseUrl = null, accessToken = null) {
  const url = baseUrl || `${window.location.origin}/selforder.html`;
  let fullUrl = `${url}#/session/${sessionId}`;
  
  if (accessToken) {
    fullUrl += `?access_token=${encodeURIComponent(accessToken)}`;
  }
  
  return fullUrl;
}
