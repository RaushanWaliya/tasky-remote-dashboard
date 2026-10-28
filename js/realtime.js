// Wraps the SignalR connection to the dashboard hub. The hub itself
// requires a valid JWT, passed as a query string parameter because the
// browser's WebSocket API cannot set an Authorization header.
class RemoteAdminRealtime {
  constructor(handlers) {
    this.handlers = handlers || {};
    this.connection = null;
  }

  async start() {
    const baseUrl = RemoteAdminConfig.getApiBaseUrl();
    const token = RemoteAdminConfig.getToken();

    this.connection = new signalR.HubConnectionBuilder()
      .withUrl(`${baseUrl}/hubs/dashboard`, { accessTokenFactory: () => token })
      .withAutomaticReconnect()
      .build();

    this.connection.on("MachineOnline", (m) => this.handlers.onMachineOnline?.(m));
    this.connection.on("MachineOffline", (id) => this.handlers.onMachineOffline?.(id));
    this.connection.on("MachineUpdated", (m) => this.handlers.onMachineUpdated?.(m));
    this.connection.on("CommandUpdated", (c) => this.handlers.onCommandUpdated?.(c));
    this.connection.on("ScreenFrame", (machineId, base64Jpeg) => this.handlers.onScreenFrame?.(machineId, base64Jpeg));
    this.connection.on("FileTransferUpdated", (f) => this.handlers.onFileTransferUpdated?.(f));
    this.connection.on("ClipboardTextReceived", (machineId, text) => this.handlers.onClipboardTextReceived?.(machineId, text));

    await this.connection.start();
  }

  startScreenStream(machineId, intervalMs = 1000) {
    return this.connection?.invoke("StartScreenStream", machineId, intervalMs);
  }

  stopScreenStream(machineId) {
    return this.connection?.invoke("StopScreenStream", machineId);
  }

  sendMouseEvent(machineId, eventType, xRatio, yRatio, button, wheelDelta) {
    return this.connection?.invoke("SendMouseEvent", machineId, eventType, xRatio, yRatio, button, wheelDelta);
  }

  sendKeyEvent(machineId, eventType, virtualKeyCode) {
    return this.connection?.invoke("SendKeyEvent", machineId, eventType, virtualKeyCode);
  }

  sendCtrlAltDel(machineId) {
    return this.connection?.invoke("SendCtrlAltDel", machineId);
  }

  setClipboardText(machineId, text) {
    return this.connection?.invoke("SetClipboardText", machineId, text);
  }

  requestClipboardText(machineId) {
    return this.connection?.invoke("RequestClipboardText", machineId);
  }

  stop() {
    return this.connection?.stop();
  }
}
