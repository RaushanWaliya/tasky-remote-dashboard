// Main dashboard screen: machine list + the selected machine's detail
// panel (overview, remote command console, live screen, file transfer).
// Kept as one file since the app is small; each render* function owns
// one piece of the DOM so re-renders stay cheap and easy to follow.

if (!RemoteAdminConfig.getToken()) {
  window.location.href = "index.html";
}

const state = {
  machines: new Map(),
  selectedMachineId: null,
  activeTab: "overview",
  screenStreaming: false,
  commandType: "0"
};

// Lets the operator exit the live screen's full screen mode with Escape
// instead of having to find and click the button again. Registered once
// here (not inside renderScreenTab) so repeated tab switches don't pile up
// duplicate document level listeners.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const wrap = document.getElementById("screenFrameWrap");
  if (wrap && wrap.classList.contains("fullscreen-mode")) {
    exitScreenFullscreen();
  }
});

function exitScreenFullscreen() {
  const wrap = document.getElementById("screenFrameWrap");
  const btn = document.getElementById("fullscreenBtn");
  if (wrap) wrap.classList.remove("fullscreen-mode");
  document.body.classList.remove("screen-fullscreen-active");
  if (btn) btn.textContent = "Full screen";
}

// Rolling frame arrival timestamps for the live screen's fps indicator —
// a simple, backend free stand in for "connection quality" since screen
// frames (unlike tiny mouse/key events) are large enough that how often
// they actually arrive is a decent proxy for how the connection is doing.
let frameTimestamps = [];
function recordFrameTimingAndGetFps() {
  const now = performance.now();
  frameTimestamps.push(now);
  if (frameTimestamps.length > 6) frameTimestamps.shift();
  if (frameTimestamps.length < 2) return null;
  const spanMs = frameTimestamps[frameTimestamps.length - 1] - frameTimestamps[0];
  if (spanMs <= 0) return null;
  return ((frameTimestamps.length - 1) / spanMs) * 1000;
}

document.getElementById("whoami").textContent = RemoteAdminConfig.getUsername() || "";

document.getElementById("logoutBtn").addEventListener("click", () => {
  RemoteAdminConfig.clearSession();
  window.location.href = "index.html";
});

// ---------- Enrollment key modal ----------

const keyModal = document.getElementById("keyModal");
document.getElementById("newKeyBtn").addEventListener("click", () => {
  document.getElementById("keyLabel").value = "";
  document.getElementById("keyResult").classList.add("hidden");
  keyModal.classList.remove("hidden");
});
document.getElementById("closeKeyModalBtn").addEventListener("click", () => keyModal.classList.add("hidden"));
document.getElementById("generateKeyBtn").addEventListener("click", async () => {
  const label = document.getElementById("keyLabel").value.trim() || "Unlabeled";
  try {
    const result = await RemoteAdminApi.createEnrollmentKey(label);
    document.getElementById("keyPlainValue").value = result.plainKey;
    document.getElementById("keyResult").classList.remove("hidden");
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Machine list ----------

function renderMachineList() {
  const container = document.getElementById("machineList");
  container.innerHTML = "";

  const machines = Array.from(state.machines.values()).sort((a, b) => a.hostName.localeCompare(b.hostName));
  if (machines.length === 0) {
    container.innerHTML = '<div class="empty-state small">No machines have enrolled yet.</div>';
    return;
  }

  for (const m of machines) {
    const row = document.createElement("div");
    row.className = "machine-row" + (m.id === state.selectedMachineId ? " selected" : "");
    row.innerHTML = `
      <span class="status-dot ${m.isOnline ? "online" : "offline"}"></span>
      <div class="machine-row-text">
        <div class="machine-row-name">${escapeHtml(m.hostName)}</div>
        <div class="machine-row-sub">${m.isOnline ? "Online" : "Offline"} ${m.location ? "· " + escapeHtml(m.location) : ""}${m.externalMachineId ? " · ID: " + escapeHtml(m.externalMachineId) : ""}</div>
      </div>
      <button class="remote-access-btn" data-id="${m.id}" title="Open live screen and take control of this machine">Remote Access</button>
    `;
    row.addEventListener("click", () => selectMachine(m.id));
    row.querySelector(".remote-access-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      openRemoteAccess(m.id);
    });
    container.appendChild(row);
  }
}

// One click "take over" entry point: used by the Remote Access button on
// each machine row, and is what a hosting app (e.g. Tasky) should land an
// admin on too — select the machine, jump straight to the live screen
// tab, and start streaming with remote control already turned on, so
// there is no extra tab hopping once a machine has been picked.
function openRemoteAccess(id) {
  if (state.selectedMachineId !== id) {
    stopScreenStreamIfActive();
  }
  state.selectedMachineId = id;
  state.activeTab = "screen";
  renderMachineList();
  renderDetail();

  document.getElementById("startScreenBtn")?.click();
  const toggle = document.getElementById("remoteControlToggle");
  if (toggle) {
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
  }
}

function selectMachine(id) {
  if (state.selectedMachineId !== id) {
    stopScreenStreamIfActive();
  }
  state.selectedMachineId = id;
  state.activeTab = "overview";
  renderMachineList();
  renderDetail();
}

// ---------- Machine detail panel ----------

function renderDetail() {
  const el = document.getElementById("machineDetail");
  const machine = state.machines.get(state.selectedMachineId);

  if (!machine) {
    el.innerHTML = '<div class="empty-state">Select a machine on the left to monitor or manage it.</div>';
    return;
  }

  el.innerHTML = `
    <div class="detail-header">
      <h2>${escapeHtml(machine.hostName)}</h2>
      <span class="status-pill ${machine.isOnline ? "online" : "offline"}">${machine.isOnline ? "Online" : "Offline"}</span>
    </div>
    <div class="tabs">
      <button class="tab-btn" data-tab="overview">Overview</button>
      <button class="tab-btn" data-tab="command">Remote command</button>
      <button class="tab-btn" data-tab="screen">Live screen</button>
      <button class="tab-btn" data-tab="files">Files</button>
    </div>
    <div id="tabContent" class="tab-content"></div>
  `;

  el.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === state.activeTab);
    btn.addEventListener("click", () => {
      if (state.activeTab === "screen" && btn.dataset.tab !== "screen") {
        stopScreenStreamIfActive();
        exitScreenFullscreen();
      }
      state.activeTab = btn.dataset.tab;
      renderDetail();
    });
  });

  const tabContent = document.getElementById("tabContent");
  if (state.activeTab === "overview") renderOverviewTab(tabContent, machine);
  else if (state.activeTab === "command") renderCommandTab(tabContent, machine);
  else if (state.activeTab === "screen") renderScreenTab(tabContent, machine);
  else if (state.activeTab === "files") renderFilesTab(tabContent, machine);
}

function renderOverviewTab(container, machine) {
  container.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">External ID (e.g. Tasky)</div><div class="stat-value">${escapeHtml(machine.externalMachineId || "-")}</div></div>
      <div class="stat-card"><div class="stat-label">Operating system</div><div class="stat-value">${escapeHtml(machine.osVersion || "-")}</div></div>
      <div class="stat-card"><div class="stat-label">Agent version</div><div class="stat-value">${escapeHtml(machine.agentVersion || "-")}</div></div>
      <div class="stat-card"><div class="stat-label">IP address</div><div class="stat-value">${escapeHtml(machine.lastKnownIp || "-")}</div></div>
      <div class="stat-card"><div class="stat-label">Last seen</div><div class="stat-value">${machine.lastSeenUtc ? new Date(machine.lastSeenUtc).toLocaleString() : "-"}</div></div>
      <div class="stat-card"><div class="stat-label">CPU usage</div><div class="stat-value">${machine.cpuUsagePercent != null ? machine.cpuUsagePercent.toFixed(1) + "%" : "-"}</div></div>
      <div class="stat-card"><div class="stat-label">Memory usage</div><div class="stat-value">${machine.memoryUsagePercent != null ? machine.memoryUsagePercent.toFixed(1) + "%" : "-"}</div></div>
    </div>
  `;
}

// ---------- Remote command tab ----------

function renderCommandTab(container, machine) {
  container.innerHTML = `
    <div class="command-form">
      <label>Command type</label>
      <select id="commandType">
        <option value="0">Run shell command</option>
        <option value="1">Install app (winget package id)</option>
        <option value="2">Uninstall app (winget package id)</option>
        <option value="3">Kill process (pid or name)</option>
        <option value="4">List running processes</option>
      </select>
      <label>Payload</label>
      <textarea id="commandPayload" rows="3" placeholder="e.g. ipconfig /all, or Google.Chrome for install"></textarea>
      <button id="runCommandBtn">Run on ${escapeHtml(machine.hostName)}</button>
      <div id="commandFeedback" class="error-text"></div>
    </div>
    <h4>Output</h4>
    <pre id="commandOutput" class="console-output">Run a command to see its output here.</pre>
    <h4>History</h4>
    <div id="commandHistory" class="history-list"></div>
  `;

  document.getElementById("commandType").value = state.commandType;
  document.getElementById("commandType").addEventListener("change", (e) => (state.commandType = e.target.value));
  document.getElementById("commandPayload").addEventListener("keydown", (e) => {
    document.getElementById("commandType").value = state.commandType;
  });

  document.getElementById("runCommandBtn").addEventListener("click", async () => {
    const type = document.getElementById("commandType").value;
    const payload = document.getElementById("commandPayload").value.trim();
    const feedback = document.getElementById("commandFeedback");
    feedback.textContent = "";

    if (type !== "4" && !payload) {
      feedback.textContent = "Payload is required for this command type.";
      return;
    }

    try {
      document.getElementById("commandOutput").textContent = "Running...";
      await RemoteAdminApi.sendCommand(machine.id, Number(type), payload || "");
    } catch (err) {
      feedback.textContent = err.message;
      document.getElementById("commandOutput").textContent = "";
    }
  });

  loadCommandHistory(machine.id);
}

async function loadCommandHistory(machineId) {
  try {
    const history = await RemoteAdminApi.getCommandHistory(machineId);
    renderCommandHistory(history);
    const latest = history.find((c) => c.status === 2 || c.status === 3);
    if (latest) showCommandResult(latest);
  } catch {
    /* machine may have no history yet; nothing to show */
  }
}

function renderCommandHistory(history) {
  const box = document.getElementById("commandHistory");
  if (!box) return;
  if (history.length === 0) {
    box.innerHTML = '<div class="empty-state small">No commands have been run yet.</div>';
    return;
  }
  box.innerHTML = history
    .map(
      (c) => `
      <div class="history-row">
        <span class="history-type">${commandTypeLabel(c.type)}</span>
        <span class="history-status status-${c.status}">${commandStatusLabel(c.status)}</span>
        <span class="history-time">${new Date(c.createdAtUtc).toLocaleString()}</span>
      </div>`
    )
    .join("");
}

function commandTypeLabel(type) {
  return ["Run shell command", "Install app", "Uninstall app", "Kill process", "List processes"][type] ?? "Unknown";
}

function commandStatusLabel(status) {
  return ["Queued", "Sent", "Completed", "Failed", "Machine offline"][status] ?? "Unknown";
}

function showCommandResult(command) {
  const out = document.getElementById("commandOutput");
  if (!out) return;
  const lines = [];
  if (command.resultOutput) lines.push(command.resultOutput);
  if (command.resultError) lines.push("--- error ---\n" + command.resultError);
  out.textContent = lines.join("\n") || "(no output)";
}

// ---------- Live screen tab ----------

function renderScreenTab(container, machine) {
  frameTimestamps = [];
  const startedAt = new Date().toLocaleTimeString();

  container.innerHTML = `
    <div class="session-banner">
      <span>Connected to <strong>${escapeHtml(machine.hostName)}</strong> · viewing since ${startedAt}</span>
      <span id="qualityIndicator" class="quality-indicator">-- fps</span>
    </div>
    <div class="screen-controls">
      <button id="startScreenBtn">Start live view</button>
      <button id="stopScreenBtn" class="secondary-btn">Stop</button>
      <button id="fullscreenBtn" class="secondary-btn" title="Expand the live view to full screen">Full screen</button>
      <label class="control-toggle">
        <input type="checkbox" id="remoteControlToggle" />
        Enable remote control (mouse and keyboard act on the real machine)
      </label>
    </div>
    <div class="quick-actions">
      <button id="ctrlAltDelBtn" class="secondary-btn" title="Best effort: only works while the agent runs as a Windows service with the Secure Attention Sequence policy enabled, see README">Ctrl+Alt+Del</button>
      <button id="lockBtn" class="secondary-btn">Lock machine</button>
      <button id="restartBtn" class="secondary-btn">Restart machine</button>
      <button id="taskMgrBtn" class="secondary-btn">Open Task Manager</button>
    </div>
    <div class="clipboard-box">
      <label>Shared clipboard</label>
      <textarea id="clipboardText" rows="2" placeholder="Type or paste text here, then send it to the remote machine, or pull its clipboard into here."></textarea>
      <div class="clipboard-actions">
        <button id="pushClipboardBtn" class="secondary-btn">Send to remote clipboard</button>
        <button id="pullClipboardBtn" class="secondary-btn">Get remote clipboard</button>
      </div>
    </div>
    <div class="screen-frame-wrap" id="screenFrameWrap">
      <img id="screenFrame" alt="Live screen will appear here once streaming starts." />
    </div>
  `;

  document.getElementById("startScreenBtn").addEventListener("click", async () => {
    state.screenStreaming = true;
    frameTimestamps = [];
    await realtime.startScreenStream(machine.id, 1000);
  });
  document.getElementById("stopScreenBtn").addEventListener("click", () => {
    stopScreenStreamIfActive();
    // Give visible feedback: otherwise the last frame just sits there and
    // it looks like the Stop button did nothing.
    const img = document.getElementById("screenFrame");
    if (img) img.removeAttribute("src");
    const toggle = document.getElementById("remoteControlToggle");
    if (toggle) toggle.checked = false;
    const q = document.getElementById("qualityIndicator");
    if (q) q.textContent = "-- fps";
  });

  const toggle = document.getElementById("remoteControlToggle");
  toggle.addEventListener("change", () => {
    if (toggle.checked) enableRemoteControl(machine.id);
    else disableRemoteControl();
  });

  document.getElementById("fullscreenBtn").addEventListener("click", () => {
    const wrap = document.getElementById("screenFrameWrap");
    const btn = document.getElementById("fullscreenBtn");
    const goingFull = !wrap.classList.contains("fullscreen-mode");
    wrap.classList.toggle("fullscreen-mode", goingFull);
    document.body.classList.toggle("screen-fullscreen-active", goingFull);
    btn.textContent = goingFull ? "Exit full screen (Esc)" : "Full screen";
  });

  document.getElementById("ctrlAltDelBtn").addEventListener("click", () => {
    realtime.sendCtrlAltDel(machine.id);
  });

  document.getElementById("lockBtn").addEventListener("click", async () => {
    try {
      await RemoteAdminApi.sendCommand(machine.id, 0, "rundll32.exe user32.dll,LockWorkStation");
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById("restartBtn").addEventListener("click", async () => {
    if (!confirm(`Restart ${machine.hostName} now? Any unsaved work on that machine will be lost.`)) return;
    try {
      await RemoteAdminApi.sendCommand(machine.id, 0, "shutdown /r /t 5");
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById("taskMgrBtn").addEventListener("click", async () => {
    try {
      await RemoteAdminApi.sendCommand(machine.id, 0, "taskmgr.exe");
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById("pushClipboardBtn").addEventListener("click", () => {
    const text = document.getElementById("clipboardText").value;
    realtime.setClipboardText(machine.id, text);
  });

  document.getElementById("pullClipboardBtn").addEventListener("click", () => {
    realtime.requestClipboardText(machine.id);
  });
}

// ---------- Remote control (mouse + keyboard replay on the agent) ----------

let remoteControlCleanup = null;
let lastMouseMoveSentAt = 0;

function enableRemoteControl(machineId) {
  disableRemoteControl();

  const img = document.getElementById("screenFrame");
  if (!img) return;

  const toRatio = (e) => {
    const rect = img.getBoundingClientRect();
    const xRatio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    const yRatio = Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1);
    return { xRatio, yRatio };
  };

  const onMouseMove = (e) => {
    const now = Date.now();
    if (now - lastMouseMoveSentAt < 60) return; // throttle, SignalR does not need every pixel
    lastMouseMoveSentAt = now;
    const { xRatio, yRatio } = toRatio(e);
    realtime.sendMouseEvent(machineId, "move", xRatio, yRatio, 0, 0);
  };

  const onMouseDown = (e) => {
    e.preventDefault();
    const { xRatio, yRatio } = toRatio(e);
    realtime.sendMouseEvent(machineId, "down", xRatio, yRatio, e.button, 0);
  };

  const onMouseUp = (e) => {
    e.preventDefault();
    const { xRatio, yRatio } = toRatio(e);
    realtime.sendMouseEvent(machineId, "up", xRatio, yRatio, e.button, 0);
  };

  const onWheel = (e) => {
    e.preventDefault();
    const { xRatio, yRatio } = toRatio(e);
    // Windows wheel delta is the opposite sign of the browser's deltaY.
    realtime.sendMouseEvent(machineId, "wheel", xRatio, yRatio, 0, -e.deltaY);
  };

  const onContextMenu = (e) => e.preventDefault();

  const onKeyDown = (e) => {
    e.preventDefault();
    realtime.sendKeyEvent(machineId, "down", e.keyCode);
  };

  const onKeyUp = (e) => {
    e.preventDefault();
    realtime.sendKeyEvent(machineId, "up", e.keyCode);
  };

  img.addEventListener("mousemove", onMouseMove);
  img.addEventListener("mousedown", onMouseDown);
  img.addEventListener("mouseup", onMouseUp);
  img.addEventListener("wheel", onWheel, { passive: false });
  img.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  remoteControlCleanup = () => {
    img.removeEventListener("mousemove", onMouseMove);
    img.removeEventListener("mousedown", onMouseDown);
    img.removeEventListener("mouseup", onMouseUp);
    img.removeEventListener("wheel", onWheel);
    img.removeEventListener("contextmenu", onContextMenu);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
  };
}

function disableRemoteControl() {
  if (remoteControlCleanup) {
    remoteControlCleanup();
    remoteControlCleanup = null;
  }
}

function stopScreenStreamIfActive() {
  disableRemoteControl();
  if (state.screenStreaming && state.selectedMachineId != null) {
    realtime.stopScreenStream(state.selectedMachineId);
  }
  state.screenStreaming = false;
  exitScreenFullscreen();
}

// ---------- Files tab ----------

function renderFilesTab(container, machine) {
  container.innerHTML = `
    <div class="files-section">
      <h4>Send a file to this machine</h4>
      <input type="file" id="uploadFileInput" />
      <input type="text" id="uploadRemotePath" placeholder="Destination path on the machine, e.g. C:\\Temp\\file.exe" />
      <button id="uploadFileBtn">Send</button>
    </div>
    <div class="files-section">
      <h4>Pull a file from this machine</h4>
      <input type="text" id="downloadRemotePath" placeholder="Path on the machine, e.g. C:\\Logs\\app.log" />
      <button id="requestDownloadBtn">Request</button>
    </div>
    <h4>Transfer history</h4>
    <div id="fileHistory" class="history-list"></div>
  `;

  document.getElementById("uploadFileBtn").addEventListener("click", async () => {
    const fileInput = document.getElementById("uploadFileInput");
    const remotePath = document.getElementById("uploadRemotePath").value.trim();
    if (!fileInput.files[0] || !remotePath) {
      alert("Choose a file and a destination path first.");
      return;
    }
    try {
      await RemoteAdminApi.uploadFile(machine.id, fileInput.files[0], remotePath);
      loadFileHistory(machine.id);
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById("requestDownloadBtn").addEventListener("click", async () => {
    const remotePath = document.getElementById("downloadRemotePath").value.trim();
    if (!remotePath) {
      alert("Enter a path on the machine first.");
      return;
    }
    try {
      await RemoteAdminApi.requestDownload(machine.id, remotePath);
      loadFileHistory(machine.id);
    } catch (err) {
      alert(err.message);
    }
  });

  loadFileHistory(machine.id);
}

async function loadFileHistory(machineId) {
  try {
    const history = await RemoteAdminApi.getFileHistory(machineId);
    renderFileHistory(machineId, history);
  } catch {
    /* no transfers yet */
  }
}

function renderFileHistory(machineId, history) {
  const box = document.getElementById("fileHistory");
  if (!box) return;
  if (history.length === 0) {
    box.innerHTML = '<div class="empty-state small">No file transfers yet.</div>';
    return;
  }
  box.innerHTML = history
    .map((f) => {
      const directionLabel = f.direction === 0 ? "To machine" : "From machine";
      const canDownload = f.direction === 1 && f.status === 2;
      const downloadLink = canDownload
        ? `<a href="${RemoteAdminApi.downloadUrl(machineId, f.transferGuid)}" target="_blank">Download</a>`
        : "";
      return `
        <div class="history-row">
          <div>
            <div class="history-type">${escapeHtml(f.fileName)}</div>
            <div class="history-time">${escapeHtml(f.remotePath)}</div>
          </div>
          <span class="history-status">${directionLabel}</span>
          <span class="history-status status-${f.status}">${fileStatusLabel(f.status)}</span>
          ${downloadLink}
        </div>`;
    })
    .join("");
}

function fileStatusLabel(status) {
  return ["Pending", "In progress", "Completed", "Failed"][status] ?? "Unknown";
}

// ---------- Realtime wiring ----------

const realtime = new RemoteAdminRealtime({
  onMachineOnline: (m) => {
    state.machines.set(m.id, m);
    renderMachineList();
    if (m.id === state.selectedMachineId) renderDetail();
  },
  onMachineOffline: (id) => {
    const m = state.machines.get(id);
    if (m) m.isOnline = false;
    renderMachineList();
    if (id === state.selectedMachineId) renderDetail();
  },
  onMachineUpdated: (m) => {
    state.machines.set(m.id, m);
    renderMachineList();
    if (m.id === state.selectedMachineId && state.activeTab === "overview") renderDetail();
  },
  onCommandUpdated: (c) => {
    if (c.machineId === state.selectedMachineId && state.activeTab === "command") {
      showCommandResult(c);
      loadCommandHistory(c.machineId);
    }
  },
  onScreenFrame: (machineId, base64Jpeg) => {
    if (machineId === state.selectedMachineId && state.activeTab === "screen" && state.screenStreaming) {
      const img = document.getElementById("screenFrame");
      if (img) img.src = `data:image/jpeg;base64,${base64Jpeg}`;

      const fps = recordFrameTimingAndGetFps();
      const q = document.getElementById("qualityIndicator");
      if (q && fps != null) q.textContent = `${fps.toFixed(1)} fps`;
    }
  },
  onFileTransferUpdated: (f) => {
    if (f.machineId === state.selectedMachineId && state.activeTab === "files") {
      loadFileHistory(f.machineId);
    }
  },
  onClipboardTextReceived: (machineId, text) => {
    if (machineId === state.selectedMachineId && state.activeTab === "screen") {
      const box = document.getElementById("clipboardText");
      if (box) box.value = text;
      // Also hand it to the admin's own OS clipboard as a convenience, best
      // effort since the browser may withhold permission.
      navigator.clipboard?.writeText(text).catch(() => {});
    }
  }
});

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}

// ---------- Boot ----------

async function boot() {
  try {
    const machines = await RemoteAdminApi.getMachines();
    machines.forEach((m) => state.machines.set(m.id, m));
    renderMachineList();

    // Deep link support: dashboard.html?externalMachineId=... lets a
    // hosting app (e.g. Tasky) open this dashboard already scoped to one
    // specific machine, straight into the live screen/remote control view,
    // instead of the admin having to find it in the list themselves.
    const externalId = new URLSearchParams(window.location.search).get("externalMachineId");
    if (externalId) {
      const match = Array.from(state.machines.values()).find((m) => m.externalMachineId === externalId);
      if (match) openRemoteAccess(match.id);
    }
  } catch (err) {
    document.getElementById("machineList").innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }

  try {
    await realtime.start();
  } catch (err) {
    console.error("Could not connect to the realtime hub.", err);
  }
}

boot();
