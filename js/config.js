// Backend base URL. Change this if your server runs somewhere other than
// the default local https profile, or ask the person testing to set it
// from the Settings box on the login page (saved to localStorage).
const RemoteAdminConfig = {
  defaultApiBaseUrl: "https://taskyremoteapi-hjfvaygegacwg3a5.centralindia-01.azurewebsites.net",

  getApiBaseUrl() {
    return localStorage.getItem("ra_apiBaseUrl") || this.defaultApiBaseUrl;
  },

  setApiBaseUrl(url) {
    localStorage.setItem("ra_apiBaseUrl", url.replace(/\/+$/, ""));
  },

  getToken() {
    return localStorage.getItem("ra_token");
  },

  setSession(token, username, role) {
    localStorage.setItem("ra_token", token);
    localStorage.setItem("ra_username", username);
    localStorage.setItem("ra_role", role);
  },

  getUsername() {
    return localStorage.getItem("ra_username");
  },

  clearSession() {
    localStorage.removeItem("ra_token");
    localStorage.removeItem("ra_username");
    localStorage.removeItem("ra_role");
  }
};
