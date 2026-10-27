// Thin wrapper around the REST API. Every call reads the base URL and
// token fresh from RemoteAdminConfig so the Settings box on the login
// page can change them without a page reload.
const RemoteAdminApi = {
  async request(path, options = {}) {
    const baseUrl = RemoteAdminConfig.getApiBaseUrl();
    const token = RemoteAdminConfig.getToken();

    const headers = Object.assign({}, options.headers || {});
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (options.body && !(options.body instanceof FormData) && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(`${baseUrl}${path}`, { ...options, headers });

    if (response.status === 401) {
      RemoteAdminConfig.clearSession();
      window.location.href = "index.html";
      throw new Error("Session expired. Please log in again.");
    }

    if (!response.ok) {
      let message = `Request failed (${response.status}).`;
      try {
        const body = await response.json();
        if (body.error) message = body.error;
      } catch { /* non JSON error body, keep default message */ }
      throw new Error(message);
    }

    if (response.status === 204) return null;
    const contentType = response.headers.get("Content-Type") || "";
    return contentType.includes("application/json") ? response.json() : response;
  },

  login(username, password) {
    return this.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });
  },

  getMachines() {
    return this.request("/api/machines");
  },

  getMachine(id) {
    return this.request(`/api/machines/${id}`);
  },

  // Looks a machine up by a hosting app's own id (e.g. Tasky's machineId),
  // so that app can deep link straight to a specific machine without
  // keeping its own id mapping.
  getMachineByExternalId(externalId) {
    return this.request(`/api/machines/by-external/${encodeURIComponent(externalId)}`);
  },

  createEnrollmentKey(label) {
    return this.request("/api/machines/enrollment-keys", {
      method: "POST",
      body: JSON.stringify({ label })
    });
  },

  getCommandHistory(machineId) {
    return this.request(`/api/machines/${machineId}/commands`);
  },

  sendCommand(machineId, type, payload) {
    return this.request(`/api/machines/${machineId}/commands`, {
      method: "POST",
      body: JSON.stringify({ type, payload })
    });
  },

  getFileHistory(machineId) {
    return this.request(`/api/machines/${machineId}/files`);
  },

  async uploadFile(machineId, file, remotePath) {
    const form = new FormData();
    form.append("file", file);
    form.append("remotePath", remotePath);
    return this.request(`/api/machines/${machineId}/files/upload`, { method: "POST", body: form });
  },

  requestDownload(machineId, remotePath) {
    return this.request(`/api/machines/${machineId}/files/request-download`, {
      method: "POST",
      body: JSON.stringify({ remotePath })
    });
  },

  downloadUrl(machineId, transferGuid) {
    const baseUrl = RemoteAdminConfig.getApiBaseUrl();
    const token = RemoteAdminConfig.getToken();
    // This link is opened as a plain <a href> so the browser can download
    // it directly, which means it can't carry an Authorization header like
    // a normal API call does. The token is passed as a query parameter
    // instead, which the server's download endpoint accepts for this
    // exact reason (see RemoteAdminServiceExtensions.cs).
    return `${baseUrl}/api/machines/${machineId}/files/download/${transferGuid}?access_token=${encodeURIComponent(token || "")}`;
  }
};
