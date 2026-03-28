/**
 * ══════════════════════════════════════════════════════
 *  Indie Film Shot Tracker — static/js/script.js
 *  IndexedDB + UI logic — zero dependencies
 * ══════════════════════════════════════════════════════
 */

class ShotDB {
  constructor() {
    this.DB_NAME    = "ShotTrackerDB";
    this.DB_VERSION = 2;
    this.STORE_NAME = "shots";
    this.db         = null;
  }

  openDatabase() {
    return new Promise((resolve, reject) => {
      if (this.db) { resolve(this.db); return; }

      const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          const store = db.createObjectStore(this.STORE_NAME, {
            keyPath: "id", autoIncrement: true
          });
          store.createIndex("scene",  "scene",  { unique: false });
          store.createIndex("status", "status", { unique: false });
          store.createIndex("projectId", "projectId", { unique: false });
        } else {
          const store = e.target.transaction.objectStore(this.STORE_NAME);
          if (!store.indexNames.contains("projectId")) {
            store.createIndex("projectId", "projectId", { unique: false });
          }
        }
      };

      req.onsuccess = (e) => { this.db = e.target.result; resolve(this.db); };
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  async addShot(shotData) {
    const db = await this.openDatabase();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(this.STORE_NAME, "readwrite");
      const req = tx.objectStore(this.STORE_NAME).add({
        ...shotData, createdAt: Date.now()
      });
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  async getAllShots() {
    const db = await this.openDatabase();
    return new Promise((resolve, reject) => {
      const req = db.transaction(this.STORE_NAME, "readonly")
                    .objectStore(this.STORE_NAME).getAll();
      req.onsuccess = (e) =>
        resolve(e.target.result.sort((a, b) => b.createdAt - a.createdAt));
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async getShotsByProject(projectId) {
    const db = await this.openDatabase();
    return new Promise((resolve, reject) => {
      const req = db.transaction(this.STORE_NAME, "readonly")
                    .objectStore(this.STORE_NAME)
                    .index("projectId")
                    .getAll(projectId);
      req.onsuccess = (e) => {
        const rows = e.target.result.sort((a, b) => {
          if (a.scene === b.scene) return (a.order ?? 0) - (b.order ?? 0);
          return a.createdAt - b.createdAt;
        });
        resolve(rows);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async getShot(id) {
    const db = await this.openDatabase();
    return new Promise((resolve, reject) => {
      const req = db.transaction(this.STORE_NAME, "readonly")
                    .objectStore(this.STORE_NAME).get(id);
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  async updateShot(shotData) {
    const db = await this.openDatabase();
    return new Promise((resolve, reject) => {
      const req = db.transaction(this.STORE_NAME, "readwrite")
                    .objectStore(this.STORE_NAME).put(shotData);
      req.onsuccess = () => resolve();
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  async updateTake(shotId, takeIndex, newText) {
    const shot = await this.getShot(shotId);
    if (!shot) throw new Error(`Shot ${shotId} not found`);
    shot.takes[takeIndex] = newText;
    await this.updateShot(shot);
    return shot;
  }

  async deleteShot(id) {
    const db = await this.openDatabase();
    return new Promise((resolve, reject) => {
      const req = db.transaction(this.STORE_NAME, "readwrite")
                    .objectStore(this.STORE_NAME).delete(id);
      req.onsuccess = () => resolve();
      req.onerror   = (e) => reject(e.target.error);
    });
  }
}

const db          = new ShotDB();
let   allShots    = [];
let   takesInForm = [];
let   editModal   = null;
let   currentProjectId = "";
let   projects = [];
let   currentRole = "director";
let   currentReferenceImage = "";
let   currentLocation = { name: "", lat: null, lng: null };
let   draggedShotId = null;
let   notifications = [];
let   shotMap = null;
let   shotMarker = null;

const PROJECTS_KEY = "shotTracker.projects.v1";
const CURRENT_PROJECT_KEY = "shotTracker.currentProject.v1";
const ROLE_KEY = "shotTracker.role.v1";

const ROLE_CLASSES = {
  director: "role-director",
  ad: "role-ad",
  camera: "role-camera",
};

const STATUS_OPTIONS = ["Pending", "Rolling", "Printed", "Completed", "No Good"];
const PRIORITY_OPTIONS = ["Low", "Medium", "High", "Critical"];
const ASSIGNMENT_TARGETS = {
  all: "All Crew",
  director: "Director",
  ad: "AD",
  camera: "Camera",
};

const NOTIFICATIONS_KEY = "shotTracker.notifications.v1";
const LOCATION_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const LOCATION_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";

const MOVEMENT_TIME = {
  Static: { setup: 8, shoot: 6 },
  Pan: { setup: 11, shoot: 8 },
  Tilt: { setup: 11, shoot: 8 },
  Dolly: { setup: 16, shoot: 12 },
  Steadicam: { setup: 18, shoot: 13 },
  Handheld: { setup: 10, shoot: 9 },
};

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function showToast(msg, variant = "success") {
  const el  = document.getElementById("appToast");
  const txt = document.getElementById("toastMessage");
  el.className   = `toast align-items-center border-0 text-bg-${variant}`;
  txt.textContent = msg;
  bootstrap.Toast.getOrCreateInstance(el, { delay: 2800 }).show();
}

function loadNotifications() {
  const stored = localStorage.getItem(NOTIFICATIONS_KEY);
  if (!stored) {
    notifications = [];
    return;
  }

  try {
    const parsed = JSON.parse(stored);
    notifications = Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    notifications = [];
  }
}

function persistNotifications() {
  localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(notifications.slice(0, 50)));
}

function getProjectNotifications(projectId = currentProjectId) {
  return notifications
    .filter((item) => item.projectId === projectId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function getUnreadNotificationCount(projectId = currentProjectId) {
  return getProjectNotifications(projectId).filter((item) => !item.read).length;
}

function updateNotificationBadge() {
  const badge = document.getElementById("notificationCount");
  if (!badge) return;

  const unread = getUnreadNotificationCount();
  badge.textContent = unread;
  badge.style.display = unread > 0 ? "inline-flex" : "none";
}

function setNotificationPanelOpen(isOpen) {
  const panel = document.getElementById("notificationPanel");
  const button = document.getElementById("notificationBtn");
  if (!panel || !button) return;

  panel.classList.toggle("is-open", isOpen);
  button.setAttribute("aria-expanded", String(isOpen));
}

function markNotificationsRead() {
  let changed = false;
  notifications = notifications.map((item) => {
    if (item.projectId !== currentProjectId || item.read) return item;
    changed = true;
    return { ...item, read: true };
  });

  if (changed) {
    persistNotifications();
    renderNotifications();
    updateNotificationBadge();
  }
}

function addNotification(notification) {
  const entry = {
    id: crypto.randomUUID(),
    projectId: currentProjectId,
    createdAt: Date.now(),
    read: false,
    ...notification,
  };

  notifications = [entry, ...notifications].slice(0, 50);
  persistNotifications();
  renderNotifications();
  updateNotificationBadge();
  setNotificationPanelOpen(true);
  return entry;
}

function renderNotifications() {
  const feed = document.getElementById("notificationFeed");
  const notificationsForProject = getProjectNotifications();

  if (!feed) return;

  if (!notificationsForProject.length) {
    feed.innerHTML = `
      <div class="notification-empty">
        Director assignments will appear here as soon as they are logged.
      </div>
    `;
    return;
  }

  feed.innerHTML = notificationsForProject.map((item) => {
    const targetLabel = item.target ? ASSIGNMENT_TARGETS[item.target] ?? item.target : "Crew";
    return `
      <button type="button" class="notification-item ${item.read ? "" : "is-unread"}" data-id="${item.id}">
        <span class="notification-dot"></span>
        <span class="notification-copy">
          <span class="notification-title">${escHtml(item.title)}</span>
          <span class="notification-message">${escHtml(item.message)}</span>
        </span>
        <span class="notification-meta">
          <span class="notification-target">${escHtml(targetLabel)}</span>
          <span class="notification-time">${formatTime(item.createdAt)}</span>
        </span>
      </button>
    `;
  }).join("");

  feed.querySelectorAll(".notification-item").forEach((itemEl) => {
    itemEl.addEventListener("click", () => {
      const id = itemEl.dataset.id;
      const item = notifications.find((row) => row.id === id);
      if (!item || item.read) return;
      item.read = true;
      persistNotifications();
      itemEl.classList.remove("is-unread");
      updateNotificationBadge();
    });
  });
}

function statusBadgeClass(status) {
  return {
    Pending: "badge-pending",
    Rolling: "badge-rolling",
    Printed: "badge-printed",
    Completed: "badge-completed",
    "No Good": "badge-nogood"
  }[status] ?? "badge-pending";
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function normalizeScene(scene) {
  return String(scene || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function formatMinutes(mins) {
  const total = Math.max(0, Math.round(mins));
  if (total < 60) return `${total}m`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}h ${m}m`;
}

function getCurrentProjectName() {
  return projects.find((p) => p.id === currentProjectId)?.name ?? "Project";
}

function ensureProjects() {
  const stored = localStorage.getItem(PROJECTS_KEY);
  if (stored) {
    try {
      projects = JSON.parse(stored);
    } catch (_) {
      projects = [];
    }
  }

  if (!projects.length) {
    const id = crypto.randomUUID();
    projects = [{ id, name: "Main Unit", createdAt: Date.now() }];
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
    localStorage.setItem(CURRENT_PROJECT_KEY, id);
  }

  const storedCurrent = localStorage.getItem(CURRENT_PROJECT_KEY);
  currentProjectId = projects.some((p) => p.id === storedCurrent)
    ? storedCurrent
    : projects[0].id;
}

function persistProjects() {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  localStorage.setItem(CURRENT_PROJECT_KEY, currentProjectId);
}

function renderProjectSelect() {
  const select = document.getElementById("projectSelect");
  select.innerHTML = projects.map((p) =>
    `<option value="${escHtml(p.id)}" ${p.id === currentProjectId ? "selected" : ""}>${escHtml(p.name)}</option>`
  ).join("");
}

function applyRole(role) {
  currentRole = ROLE_CLASSES[role] ? role : "director";
  localStorage.setItem(ROLE_KEY, currentRole);

  document.body.classList.remove("role-director", "role-ad", "role-camera");
  document.body.classList.add(ROLE_CLASSES[currentRole]);

  const roleView = document.getElementById("roleView");
  roleView.value = currentRole;
}

function estimateShotTime(shotData) {
  const base = MOVEMENT_TIME[shotData.movement] ?? MOVEMENT_TIME.Static;
  let setup = base.setup;
  let shoot = base.shoot;

  if (shotData.shotSize?.includes("Extreme")) setup += 3;
  if (shotData.cameraAngle === "Dutch Angle") setup += 3;

  const takesCount = shotData.takes?.length ?? 0;
  shoot += Math.max(0, takesCount - 1) * 2;

  return {
    estimatedSetupMin: setup,
    estimatedShootMin: shoot,
    estimatedTotalMin: setup + shoot,
  };
}

function getSceneShots(scene) {
  return allShots
    .filter((s) => s.scene === scene)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function getShotByCode(shotCode) {
  const code = String(shotCode || "").trim().toUpperCase();
  if (!code) return null;
  return allShots.find((s) => String(s.shotCode || "").trim().toUpperCase() === code) ?? null;
}

function getDependencyState(shot) {
  const dependencyCode = String(shot.dependsOnCode || "").trim().toUpperCase();
  if (!dependencyCode) {
    return { state: "none", label: "No blocker" };
  }

  const blocker = getShotByCode(dependencyCode);
  if (!blocker) {
    return { state: "missing", label: `Missing ${dependencyCode}` };
  }

  if (blocker.status !== "Printed") {
    return { state: "blocked", label: `Blocked by ${dependencyCode}` };
  }

  return { state: "ready", label: `Ready after ${dependencyCode}` };
}

function isOverdue(shot) {
  if (!shot.targetDate || shot.status === "Printed") return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${shot.targetDate}T00:00:00`);
  return Number.isFinite(target.getTime()) && target.getTime() < today.getTime();
}

function generateShotCode(scene) {
  const normalized = normalizeScene(scene);
  if (!normalized) return "";

  const prefix = `${normalized}-`;
  const sceneShots = getSceneShots(normalized);

  let maxSeq = 0;
  for (const shot of sceneShots) {
    const code = String(shot.shotCode || "").toUpperCase();
    if (!code.startsWith(prefix)) continue;
    const seq = parseInt(code.slice(prefix.length), 10);
    if (!Number.isNaN(seq)) maxSeq = Math.max(maxSeq, seq);
  }
  return `${normalized}-${String(maxSeq + 1).padStart(2, "0")}`;
}

function updateSmartShotCode() {
  const sceneNumber = document.getElementById("sceneNumber").value;
  document.getElementById("shotCode").value = generateShotCode(sceneNumber);
}

function renderImagePreview(dataUrl) {
  const wrap = document.getElementById("imagePreviewWrap");
  const img = document.getElementById("imagePreview");
  if (!dataUrl) {
    wrap.style.display = "none";
    img.src = "";
    return;
  }
  img.src = dataUrl;
  wrap.style.display = "block";
}

function formatCoord(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "";
  return value.toFixed(5);
}

function updateLocationInputs() {
  document.getElementById("locationName").value = currentLocation.name || "";
  document.getElementById("locationLat").value =
    typeof currentLocation.lat === "number" ? String(currentLocation.lat) : "";
  document.getElementById("locationLng").value =
    typeof currentLocation.lng === "number" ? String(currentLocation.lng) : "";
}

function renderLocationReadout() {
  const readout = document.getElementById("locationReadout");
  if (!readout) return;

  if (typeof currentLocation.lat !== "number" || typeof currentLocation.lng !== "number") {
    readout.textContent = "No location selected yet. Click the map or search above.";
    return;
  }

  const label = currentLocation.name || "Pinned location";
  readout.textContent = `${label} (${formatCoord(currentLocation.lat)}, ${formatCoord(currentLocation.lng)})`;
}

function setShotLocation(location, shouldCenter = true) {
  currentLocation = {
    name: String(location.name || "").trim(),
    lat: typeof location.lat === "number" ? location.lat : null,
    lng: typeof location.lng === "number" ? location.lng : null,
  };

  updateLocationInputs();
  renderLocationReadout();

  if (!shotMap || typeof currentLocation.lat !== "number" || typeof currentLocation.lng !== "number") {
    return;
  }

  const latLng = [currentLocation.lat, currentLocation.lng];
  if (!shotMarker) {
    shotMarker = L.marker(latLng).addTo(shotMap);
  } else {
    shotMarker.setLatLng(latLng);
  }

  if (currentLocation.name) {
    shotMarker.bindPopup(escHtml(currentLocation.name));
  }

  if (shouldCenter) {
    shotMap.setView(latLng, Math.max(shotMap.getZoom(), 14));
  }
}

function clearShotLocation(resetMapView = false) {
  currentLocation = { name: "", lat: null, lng: null };
  updateLocationInputs();
  renderLocationReadout();

  if (shotMarker) {
    shotMap.removeLayer(shotMarker);
    shotMarker = null;
  }

  if (resetMapView && shotMap) {
    shotMap.setView([20, 0], 2);
  }
}

async function reverseGeocode(lat, lng) {
  const url = `${LOCATION_REVERSE_URL}?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18`;
  const resp = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });
  if (!resp.ok) {
    throw new Error(`Reverse geocode failed: ${resp.status}`);
  }
  const row = await resp.json();
  return String(row.display_name || "").trim();
}

async function handleSearchLocation() {
  const input = document.getElementById("locationSearch");
  const query = String(input.value || "").trim();
  if (!query) {
    showToast("Type a location to search.", "warning");
    return;
  }

  const url = `${LOCATION_SEARCH_URL}?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
  try {
    const resp = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });
    if (!resp.ok) throw new Error(`Search failed: ${resp.status}`);

    const rows = await resp.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      showToast("No map result found. Try a broader place name.", "warning");
      return;
    }

    const best = rows[0];
    const lat = Number(best.lat);
    const lng = Number(best.lon);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      showToast("Location result missing coordinates.", "danger");
      return;
    }

    setShotLocation({
      name: String(best.display_name || query),
      lat,
      lng,
    });
    showToast("Location pinned from search.");
  } catch (err) {
    console.error(err);
    showToast("Location search unavailable right now.", "danger");
  }
}

function initShotMap() {
  const mapEl = document.getElementById("shotMap");
  if (!mapEl || typeof L === "undefined") return;

  shotMap = L.map("shotMap").setView([20, 0], 2);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(shotMap);

  shotMap.on("click", async (e) => {
    setShotLocation({ lat: e.latlng.lat, lng: e.latlng.lng, name: "" });
    try {
      const name = await reverseGeocode(e.latlng.lat, e.latlng.lng);
      if (name) {
        setShotLocation({ lat: e.latlng.lat, lng: e.latlng.lng, name }, false);
      }
      showToast("Location pinned from map.");
    } catch (err) {
      console.error(err);
      showToast("Pinned coordinates, but address lookup failed.", "warning");
    }
  });

  renderLocationReadout();
}

function readImageAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Image read failed"));
    reader.readAsDataURL(file);
  });
}

async function fetchMLSuggestion() {
  const payload = {
    shotSize    : document.getElementById("shotSize").value,
    cameraAngle : document.getElementById("cameraAngle").value,
    movement    : document.getElementById("movement").value,
    takes       : takesInForm,
  };

  const strip = document.getElementById("mlSuggestion");
  const text  = document.getElementById("mlSuggestionText");

  try {
    let serverSuggestion = "";
    const resp = await fetch("/predict", {
      method  : "POST",
      headers : { "Content-Type": "application/json" },
      body    : JSON.stringify(payload),
    });
    if (resp.ok) {
      const data = await resp.json();
      serverSuggestion = String(data.suggestion || "");
    }

    const localMatch = allShots.filter((s) =>
      s.shotSize === payload.shotSize &&
      s.cameraAngle === payload.cameraAngle &&
      s.movement === payload.movement
    );

    const counts = { Pending: 0, Rolling: 0, Printed: 0, "No Good": 0 };
    for (const row of localMatch) counts[row.status] = (counts[row.status] ?? 0) + 1;

    const sortedStatuses = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const bestLocalStatus = sortedStatuses[0][1] > 0 ? sortedStatuses[0][0] : null;
    const sample = localMatch.length;

    let suggestedStatus = bestLocalStatus;
    if (!suggestedStatus) {
      if (/no good/i.test(serverSuggestion)) suggestedStatus = "No Good";
      else if (/pending/i.test(serverSuggestion)) suggestedStatus = "Pending";
      else suggestedStatus = "Printed";
    }

    let confidence = sample >= 3
      ? Math.min(92, 50 + Math.round((sortedStatuses[0][1] / sample) * 42))
      : 56;

    if (payload.takes.length >= 5) confidence = Math.min(95, confidence + 15);

    const reasons = [];
    if (sample >= 3) {
      reasons.push(`History: ${sortedStatuses[0][1]}/${sample} similar shots ended as ${suggestedStatus}.`);
    } else {
      reasons.push("History is still small, using base model and movement heuristics.");
    }
    if (payload.takes.length >= 5) {
      reasons.push(`${payload.takes.length} takes logged already; risk of schedule slip is high.`);
    }
    if (payload.movement === "Dolly" || payload.movement === "Steadicam") {
      reasons.push(`${payload.movement} movement usually needs more setup + rehearsal.`);
    }
    if (serverSuggestion) reasons.push(`Model says: ${serverSuggestion}`);

    text.innerHTML = [
      `<strong>Suggested status:</strong> ${escHtml(suggestedStatus)}`,
      `<strong>Confidence:</strong> ${confidence}%`,
      `<strong>Why:</strong> ${escHtml(reasons.slice(0, 3).join(" "))}`,
    ].join("<br>");
    strip.style.display = "flex";
  } catch (_) {
    text.textContent = "ML hint unavailable at the moment.";
    strip.style.display = "flex";
  }
}

["shotSize", "cameraAngle", "movement"].forEach(id =>
  document.getElementById(id).addEventListener("change", fetchMLSuggestion)
);

function renderTakesInForm() {
  const container = document.getElementById("takesContainer");
  if (takesInForm.length === 0) {
    container.innerHTML =
      '<div class="take-empty-hint">No takes yet — click "Add Take" above</div>';
    return;
  }
  container.innerHTML = takesInForm.map((t, i) => `
    <div class="take-row" data-index="${i}">
      <span class="take-badge">T${i + 1}</span>
      <input class="form-control fc-custom take-input flex-grow-1"
             type="text" value="${escHtml(t)}"
             oninput="takesInForm[${i}] = this.value" />
      <button type="button" class="btn btn-take-del"
              onclick="removeTakeFromForm(${i})">
        <i class="bi bi-x"></i>
      </button>
    </div>
  `).join("");
}

function removeTakeFromForm(index) {
  takesInForm.splice(index, 1);
  renderTakesInForm();
  fetchMLSuggestion();
}

window.removeTakeFromForm = removeTakeFromForm;

document.getElementById("addTakeBtn").addEventListener("click", () => {
  takesInForm.push(`Take ${takesInForm.length + 1}: `);
  renderTakesInForm();
  fetchMLSuggestion();
  const inputs = document.querySelectorAll(".take-input");
  if (inputs.length) inputs[inputs.length - 1].focus();
});

document.getElementById("shotForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const sceneNumber = normalizeScene(document.getElementById("sceneNumber").value);
  const shotName    = document.getElementById("shotName").value.trim();
  const shotCode    = document.getElementById("shotCode").value.trim();
  const dependsOnCode = document.getElementById("dependsOnCode").value.trim().toUpperCase();

  if (!sceneNumber || !shotName || !shotCode) {
    showToast("Scene # and Shot Name are required.", "danger");
    return;
  }

  if (dependsOnCode && dependsOnCode === shotCode.toUpperCase()) {
    showToast("A shot cannot depend on itself.", "warning");
    return;
  }

  if (allShots.some((s) => String(s.shotCode).toUpperCase() === shotCode.toUpperCase())) {
    showToast(`Shot code ${shotCode} already exists in this project.`, "warning");
    return;
  }

  const timeEstimate = estimateShotTime({
    shotSize: document.getElementById("shotSize").value,
    cameraAngle: document.getElementById("cameraAngle").value,
    movement: document.getElementById("movement").value,
    takes: takesInForm,
  });

  const nextOrder = getSceneShots(sceneNumber).reduce((m, s) => Math.max(m, s.order ?? 0), 0) + 1;

  const shotData = {
    projectId      : currentProjectId,
    scene         : sceneNumber,
    shotCode,
    order         : nextOrder,
    shotName,
    shotSize      : document.getElementById("shotSize").value,
    cameraAngle   : document.getElementById("cameraAngle").value,
    movement      : document.getElementById("movement").value,
    status        : document.getElementById("shotStatus").value,
    priority      : document.getElementById("priority").value,
    targetDate    : document.getElementById("targetDate").value,
    dependsOnCode,
    assignedTo    : document.getElementById("assignedTo").value,
    directorNotes : document.getElementById("directorNotes").value.trim(),
    locationName  : currentLocation.name || "",
    locationLat   : typeof currentLocation.lat === "number" ? currentLocation.lat : null,
    locationLng   : typeof currentLocation.lng === "number" ? currentLocation.lng : null,
    takes         : [...takesInForm.filter(t => t.trim())],
    referenceImage: currentReferenceImage,
    ...timeEstimate,
  };

  try {
    const createdAt = Date.now();
    const newId = await db.addShot(shotData);
    allShots.push({ ...shotData, id: newId, createdAt });
    allShots.sort((a, b) => {
      if (a.scene === b.scene) return (a.order ?? 0) - (b.order ?? 0);
      return a.createdAt - b.createdAt;
    });

    renderDashboard();
    updateCounters();

    const sessionRole = window.SESSION_ROLE || currentRole;
    if (sessionRole === "director") {
      const targetLabel = ASSIGNMENT_TARGETS[shotData.assignedTo] ?? "Crew";
      addNotification({
        kind: "assignment",
        level: "info",
        target: shotData.assignedTo || "all",
        title: "Director assignment posted",
        message: `${shotName} assigned to ${targetLabel} in scene ${sceneNumber}.`,
      });
      showToast(`Assignment sent to ${targetLabel}.`, "info");
    }

    document.getElementById("shotForm").reset();
    takesInForm = [];
    currentReferenceImage = "";
    clearShotLocation();
    renderTakesInForm();
    renderImagePreview("");
    document.getElementById("mlSuggestion").style.display = "none";
    updateSmartShotCode();

    showToast(`Shot "${shotName}" logged ✔`);
  } catch (err) {
    console.error("addShot error:", err);
    showToast("Failed to save shot. Check console.", "danger");
  }
});

function buildShotCard(shot) {
  const assignedToLabel = shot.assignedTo ? (ASSIGNMENT_TARGETS[shot.assignedTo] ?? shot.assignedTo) : "Unassigned";
  const dependency = getDependencyState(shot);
  const priority = PRIORITY_OPTIONS.includes(shot.priority) ? shot.priority : "Medium";
  const priorityClass = `meta-chip-priority-${priority.toLowerCase()}`;
  const dependencyClass = {
    none: "meta-chip-dep-none",
    ready: "meta-chip-dep-ready",
    blocked: "meta-chip-dep-blocked",
    missing: "meta-chip-dep-missing",
  }[dependency.state] ?? "meta-chip-dep-none";

  const dueText = shot.targetDate
    ? (isOverdue(shot) ? `Overdue: ${shot.targetDate}` : `Due: ${shot.targetDate}`)
    : "No due date";
  const dueClass = isOverdue(shot) ? "meta-chip-overdue" : "";

  const parsedLat = Number(shot.locationLat);
  const parsedLng = Number(shot.locationLng);
  const hasMapPoint = Number.isFinite(parsedLat) && Number.isFinite(parsedLng);
  const locationName = String(shot.locationName || "").trim();
  const locationLabel = locationName || (hasMapPoint ? `Lat ${formatCoord(parsedLat)}, Lng ${formatCoord(parsedLng)}` : "No location");
  const mapUrl = hasMapPoint
    ? `https://www.openstreetmap.org/?mlat=${encodeURIComponent(parsedLat)}&mlon=${encodeURIComponent(parsedLng)}#map=16/${encodeURIComponent(parsedLat)}/${encodeURIComponent(parsedLng)}`
    : "";

  const imgHtml = shot.referenceImage
    ? `<a href="${escHtml(shot.referenceImage)}" target="_blank" rel="noopener" class="ref-image-link director-camera-only" title="Open reference image">
         <img class="ref-image-thumb" src="${escHtml(shot.referenceImage)}" alt="Reference" />
       </a>`
    : "";

  const takesHtml = shot.takes?.length
    ? shot.takes.map((t, i) => `
        <span class="take-pill" title="Click to edit"
              onclick="openEditTake(${shot.id}, ${i})">
          <i class="bi bi-camera me-1"></i>${escHtml(t)}
        </span>`).join("")
    : '<span class="no-takes-label">No takes logged</span>';

  const notesHtml = shot.directorNotes
    ? `<div class="shot-notes director-only">
         <i class="bi bi-chat-quote me-1 opacity-50"></i>${escHtml(shot.directorNotes)}
       </div>`
    : "";

  return `
    <div class="shot-card" draggable="true" data-id="${shot.id}" data-scene="${escHtml(shot.scene)}" data-status="${escHtml(shot.status)}">
      <div class="shot-card-header">
        <div class="d-flex align-items-center gap-2 flex-wrap">
          <span class="scene-tag">SC ${escHtml(shot.scene)}</span>
          <span class="scene-tag">${escHtml(shot.shotCode || "")}</span>
          <span class="shot-title">${escHtml(shot.shotName)}</span>
        </div>
        <div class="d-flex align-items-center gap-2">
          <span class="drag-handle ad-only" title="Drag to reorder in scene"><i class="bi bi-grip-vertical"></i></span>
          <select class="form-select fc-custom status-inline"
                  onchange="handleStatusChange(${shot.id}, this.value, this)">
            ${STATUS_OPTIONS.map(s =>
              `<option value="${s}" ${s === shot.status ? "selected" : ""}>${s}</option>`
            ).join("")}
          </select>
          <!-- Only one badge for the current status -->
          <span class="shot-badge ${statusBadgeClass(shot.status)}" id="badge-${shot.id}">
            ${escHtml(shot.status)}
          </span>
          <button class="btn btn-card-del" onclick="handleDeleteShot(${shot.id})"
                  title="Delete shot">
            <i class="bi bi-trash3"></i>
          </button>
        </div>
      </div>

      <div class="shot-meta">
        <span class="meta-chip camera-only"><i class="bi bi-aspect-ratio me-1"></i>${escHtml(shot.shotSize)}</span>
        <span class="meta-chip camera-only"><i class="bi bi-camera2 me-1"></i>${escHtml(shot.cameraAngle)}</span>
        <span class="meta-chip camera-only"><i class="bi bi-arrows-move me-1"></i>${escHtml(shot.movement)}</span>
        <span class="meta-chip ${priorityClass}"><i class="bi bi-flag-fill me-1"></i>${escHtml(priority)}</span>
        <span class="meta-chip ${dueClass}"><i class="bi bi-calendar-event me-1"></i>${escHtml(dueText)}</span>
        <span class="meta-chip ${dependencyClass}"><i class="bi bi-diagram-2-fill me-1"></i>${escHtml(dependency.label)}</span>
        <span class="meta-chip"><i class="bi bi-geo-alt-fill me-1"></i>${escHtml(locationLabel)}</span>
        <span class="meta-chip director-only"><i class="bi bi-bullseye me-1"></i>${escHtml(assignedToLabel)}</span>
        <span class="meta-chip ad-only"><i class="bi bi-hourglass-split me-1"></i>${formatMinutes(shot.estimatedTotalMin || 0)}</span>
        <span class="meta-time ms-auto">${formatTime(shot.createdAt)}</span>
      </div>

      ${mapUrl ? `<div class="mb-2"><a href="${escHtml(mapUrl)}" target="_blank" rel="noopener" class="map-open-link"><i class="bi bi-map me-1"></i>Open pinned location</a></div>` : ""}

      ${imgHtml}

      ${notesHtml}

      <div class="shot-takes director-camera-only">
        <div class="takes-label">TAKES</div>
        <div class="takes-pills">${takesHtml}</div>
      </div>
    </div>
  `;
}

function renderDashboard() {
  const list      = getFilteredShots();
  const dashboard = document.getElementById("shotDashboard");
  const empty     = document.getElementById("emptyState");

  if (!dashboard) {
    console.error("renderDashboard error: #shotDashboard element not found");
    return;
  }
  if (!empty) {
    console.error("renderDashboard error: #emptyState element not found");
    return;
  }

  if (list.length === 0) {
    dashboard.innerHTML = "";
    dashboard.appendChild(empty);
    empty.style.display = "flex";
    return;
  }

  empty.style.display = "none";

  const byScene = list.reduce((acc, s) => {
    (acc[s.scene] = acc[s.scene] || []).push(s);
    return acc;
  }, {});

  const sceneOrder = Object.keys(byScene).sort((a, b) => {
    const aTime = Math.min(...byScene[a].map((s) => s.createdAt));
    const bTime = Math.min(...byScene[b].map((s) => s.createdAt));
    return aTime - bTime;
  });

  dashboard.innerHTML = sceneOrder.map((scene) => {
    const shots = byScene[scene].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return `
    <div class="scene-group">
      <div class="scene-group-header">
        <i class="bi bi-camera-reels me-2"></i>SCENE ${escHtml(scene)}
        <span class="scene-count ms-2">${shots.length} shot${shots.length > 1 ? "s" : ""}</span>
      </div>
      ${shots.map(buildShotCard).join("")}
    </div>
  `;
  }).join("");

  wireDragDrop();
}

function getFilteredShots() {
  const q  = document.getElementById("searchInput").value.toLowerCase();
  const sf = document.getElementById("filterStatus").value;
  return allShots.filter(s =>
    (!q  || s.scene.toLowerCase().includes(q) || s.shotName.toLowerCase().includes(q) || String(s.shotCode || "").toLowerCase().includes(q) || String(s.priority || "").toLowerCase().includes(q) || String(s.dependsOnCode || "").toLowerCase().includes(q) || String(s.locationName || "").toLowerCase().includes(q)) &&
    (!sf || s.status === sf)
  );
}

async function handleStatusChange(id, newStatus, selectEl) {
  const shot = allShots.find(s => s.id === id);
  if (!shot) return;

  const previousStatus = shot.status;
  if (newStatus === "Rolling" || newStatus === "Printed") {
    const dependency = getDependencyState(shot);
    if (dependency.state === "blocked" || dependency.state === "missing") {
      if (selectEl) selectEl.value = previousStatus;
      showToast(`${dependency.label}. Resolve dependency first.`, "warning");
      return;
    }
  }

  shot.status = newStatus;
  try {
    await db.updateShot(shot);
    renderDashboard();
    updateCounters();
  } catch (err) {
    console.error("updateShot error:", err);
    shot.status = previousStatus;
    if (selectEl) selectEl.value = previousStatus;
    showToast("Failed to update status.", "danger");
  }
}

window.handleStatusChange = handleStatusChange;

async function handleDeleteShot(id) {
  if (!confirm("Delete this shot? This cannot be undone.")) return;
  try {
    await db.deleteShot(id);
    allShots = allShots.filter(s => s.id !== id);
    renderDashboard();
    updateCounters();
    showToast("Shot deleted.", "warning");
  } catch (err) {
    console.error("deleteShot error:", err);
    showToast("Failed to delete shot.", "danger");
  }
}

window.handleDeleteShot = handleDeleteShot;

function openEditTake(shotId, takeIndex) {
  const shot = allShots.find(s => s.id === shotId);
  if (!shot) return;
  document.getElementById("editShotId").value    = shotId;
  document.getElementById("editTakeIndex").value = takeIndex;
  document.getElementById("editTakeText").value  = shot.takes[takeIndex];
  editModal.show();
}

window.openEditTake = openEditTake;

document.getElementById("saveEditTakeBtn").addEventListener("click", async () => {
  const shotId    = parseInt(document.getElementById("editShotId").value, 10);
  const takeIndex = parseInt(document.getElementById("editTakeIndex").value, 10);
  const newText   = document.getElementById("editTakeText").value.trim();
  if (!newText) { showToast("Take note cannot be empty.", "warning"); return; }

  try {
    await db.updateTake(shotId, takeIndex, newText);
    const shot = allShots.find(s => s.id === shotId);
    if (shot) shot.takes[takeIndex] = newText;
    editModal.hide();
    renderDashboard();
    showToast("Take updated ✔");
  } catch (err) {
    console.error("updateTake error:", err);
    showToast("Failed to update take.", "danger");
  }
});

function updateCounters() {
  const shotCount = allShots.length;
  const sceneCount = new Set(allShots.map(s => s.scene)).size;
  const remainingMin = allShots
    .filter((s) => s.status === "Pending" || s.status === "Rolling")
    .reduce((sum, s) => sum + (s.estimatedTotalMin || 0), 0);

  document.getElementById("totalShotsCount").textContent  = shotCount;
  document.getElementById("totalScenesCount").textContent =
    sceneCount;
  document.getElementById("remainingMinutesCount").textContent = formatMinutes(remainingMin);
  renderOpsSummary();
}

function renderOpsSummary() {
  const host = document.getElementById("opsSummary");
  if (!host) return;

  if (!allShots.length) {
    host.innerHTML = `
      <div class="ops-metric muted">No shots yet. Add your first shot to see production analytics.</div>
    `;
    return;
  }

  const printed = allShots.filter((s) => s.status === "Printed").length;
  const completion = Math.round((printed / allShots.length) * 100);
  const blocked = allShots.filter((s) => getDependencyState(s).state === "blocked").length;
  const overdue = allShots.filter((s) => isOverdue(s)).length;
  const highRisk = allShots.filter((s) => ["High", "Critical"].includes(s.priority || "Medium") && s.status !== "Printed").length;
  const mapped = allShots.filter((s) => Number.isFinite(Number(s.locationLat)) && Number.isFinite(Number(s.locationLng))).length;

  host.innerHTML = `
    <div class="ops-metric"><span class="label">Completion</span><span class="value">${completion}%</span></div>
    <div class="ops-metric ${blocked ? "warn" : "ok"}"><span class="label">Blocked</span><span class="value">${blocked}</span></div>
    <div class="ops-metric ${overdue ? "danger" : "ok"}"><span class="label">Overdue</span><span class="value">${overdue}</span></div>
    <div class="ops-metric ${mapped ? "ok" : "warn"}"><span class="label">Mapped</span><span class="value">${mapped}</span></div>
    <div class="ops-metric ${highRisk ? "warn" : "ok"}"><span class="label">High Priority Open</span><span class="value">${highRisk}</span></div>
  `;
}

document.getElementById("searchInput").addEventListener("input",  () => renderDashboard());
document.getElementById("filterStatus").addEventListener("change", () => renderDashboard());

document.getElementById("exportBtn").addEventListener("click", async () => {
  if (!allShots.length) { showToast("No shots to export yet.", "warning"); return; }
  try {
    const resp = await fetch("/export", {
      method  : "POST",
      headers : { "Content-Type": "application/json" },
      body    : JSON.stringify({
        projectName: getCurrentProjectName(),
        roleView: currentRole,
        shots: allShots,
      }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement("a"),
                               { href: url, download: "call_sheet.txt" });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Call sheet downloaded ✔");
  } catch (err) {
    console.error("export error:", err);
    showToast("Export failed. Are you online?", "danger");
  }
});

function wireDragDrop() {
  const q = document.getElementById("searchInput").value.trim();
  const sf = document.getElementById("filterStatus").value;

  document.querySelectorAll(".shot-card").forEach((card) => {
    card.addEventListener("dragstart", (e) => {
      if (q || sf) {
        e.preventDefault();
        showToast("Clear search/filter to reorder shots.", "warning");
        return;
      }
      draggedShotId = Number(card.dataset.id);
      card.classList.add("is-dragging");
    });

    card.addEventListener("dragend", () => {
      draggedShotId = null;
      card.classList.remove("is-dragging");
      document.querySelectorAll(".shot-card.drag-over").forEach((el) => el.classList.remove("drag-over"));
    });

    card.addEventListener("dragover", (e) => {
      if (!draggedShotId) return;
      e.preventDefault();
      card.classList.add("drag-over");
    });

    card.addEventListener("dragleave", () => card.classList.remove("drag-over"));

    card.addEventListener("drop", async (e) => {
      e.preventDefault();
      card.classList.remove("drag-over");
      if (!draggedShotId) return;

      const targetId = Number(card.dataset.id);
      if (targetId === draggedShotId) return;

      const draggedShot = allShots.find((s) => s.id === draggedShotId);
      const targetShot = allShots.find((s) => s.id === targetId);
      if (!draggedShot || !targetShot || draggedShot.scene !== targetShot.scene) {
        showToast("You can reorder only within the same scene.", "warning");
        return;
      }

      const sceneShots = getSceneShots(draggedShot.scene);
      const from = sceneShots.findIndex((s) => s.id === draggedShotId);
      const to = sceneShots.findIndex((s) => s.id === targetId);
      if (from < 0 || to < 0) return;

      const [moved] = sceneShots.splice(from, 1);
      sceneShots.splice(to, 0, moved);

      try {
        for (let i = 0; i < sceneShots.length; i += 1) {
          sceneShots[i].order = i + 1;
          await db.updateShot(sceneShots[i]);
        }
        renderDashboard();
        showToast("Scene order updated ✔");
      } catch (err) {
        console.error("reorder error:", err);
        showToast("Could not save reorder.", "danger");
      }
    });
  });
}

async function hydrateLegacyRows() {
  const rows = await db.getAllShots();
  const updates = [];
  for (const row of rows) {
    let changed = false;
    if (!row.projectId) {
      row.projectId = currentProjectId;
      changed = true;
    }
    if (!row.scene) {
      row.scene = "1";
      changed = true;
    }
    row.scene = normalizeScene(row.scene);
    if (!row.shotCode) {
      row.shotCode = `${row.scene}-${String((row.order ?? 1)).padStart(2, "0")}`;
      changed = true;
    }
    if (typeof row.order !== "number") {
      row.order = 1;
      changed = true;
    }
    if (typeof row.estimatedTotalMin !== "number") {
      Object.assign(row, estimateShotTime(row));
      changed = true;
    }
    if (!row.assignedTo) {
      row.assignedTo = "all";
      changed = true;
    }
    if (!PRIORITY_OPTIONS.includes(row.priority)) {
      row.priority = "Medium";
      changed = true;
    }
    if (typeof row.targetDate !== "string") {
      row.targetDate = "";
      changed = true;
    }
    if (typeof row.locationName !== "string") {
      row.locationName = "";
      changed = true;
    }
    if (row.locationLat === undefined || row.locationLat === "") {
      if (row.locationLat !== null) {
        row.locationLat = null;
        changed = true;
      }
    } else {
      const lat = Number(row.locationLat);
      const normalizedLat = Number.isFinite(lat) ? lat : null;
      if (normalizedLat !== row.locationLat) {
        row.locationLat = normalizedLat;
        changed = true;
      }
    }
    if (row.locationLng === undefined || row.locationLng === "") {
      if (row.locationLng !== null) {
        row.locationLng = null;
        changed = true;
      }
    } else {
      const lng = Number(row.locationLng);
      const normalizedLng = Number.isFinite(lng) ? lng : null;
      if (normalizedLng !== row.locationLng) {
        row.locationLng = normalizedLng;
        changed = true;
      }
    }
    const rawDependency = typeof row.dependsOnCode === "string" ? row.dependsOnCode : "";
    const normalizedDependency = rawDependency.trim().toUpperCase();
    if (normalizedDependency !== rawDependency) {
      row.dependsOnCode = normalizedDependency;
      changed = true;
    }
    if (changed) updates.push(db.updateShot(row));
  }
  await Promise.all(updates);
}

async function loadProject(projectId) {
  currentProjectId = projectId;
  persistProjects();
  allShots = await db.getShotsByProject(projectId);
  renderDashboard();
  updateCounters();
  renderNotifications();
  updateNotificationBadge();
  updateSmartShotCode();
}

async function init() {
  editModal = new bootstrap.Modal(document.getElementById("editTakeModal"));

  ensureProjects();
  loadNotifications();
  renderProjectSelect();

  const savedRole = window.SESSION_ROLE || localStorage.getItem(ROLE_KEY) || "director";
  applyRole(savedRole);
  initShotMap();

  document.getElementById("searchLocationBtn").addEventListener("click", handleSearchLocation);
  document.getElementById("clearLocationBtn").addEventListener("click", () => {
    clearShotLocation(true);
    document.getElementById("locationSearch").value = "";
    showToast("Location cleared.", "warning");
  });
  document.getElementById("locationSearch").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    handleSearchLocation();
  });

  document.getElementById("notificationBtn").addEventListener("click", () => {
    const panel = document.getElementById("notificationPanel");
    const isOpen = !panel.classList.contains("is-open");
    setNotificationPanelOpen(isOpen);
    if (isOpen) markNotificationsRead();
  });

  document.getElementById("markNotificationsReadBtn").addEventListener("click", () => {
    markNotificationsRead();
    showToast("Notifications cleared.");
  });

  document.getElementById("sceneNumber").addEventListener("input", () => {
    document.getElementById("sceneNumber").value = normalizeScene(document.getElementById("sceneNumber").value);
    updateSmartShotCode();
  });

  document.getElementById("projectSelect").addEventListener("change", async (e) => {
    await loadProject(e.target.value);
    showToast(`Project: ${getCurrentProjectName()}`);
  });

  document.getElementById("addProjectBtn").addEventListener("click", async () => {
    const name = prompt("New project name:")?.trim();
    if (!name) return;
    const id = crypto.randomUUID();
    projects.push({ id, name, createdAt: Date.now() });
    currentProjectId = id;
    persistProjects();
    renderProjectSelect();
    await loadProject(currentProjectId);
    showToast(`Project "${name}" created ✔`);
  });

  document.getElementById("roleView").addEventListener("change", (e) => applyRole(e.target.value));

  document.getElementById("referenceImage").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) {
      currentReferenceImage = "";
      renderImagePreview("");
      return;
    }
    if (file.size > 2_500_000) {
      showToast("Image too large. Use one under 2.5MB.", "warning");
      e.target.value = "";
      currentReferenceImage = "";
      renderImagePreview("");
      return;
    }
    try {
      currentReferenceImage = await readImageAsDataUrl(file);
      renderImagePreview(currentReferenceImage);
    } catch (err) {
      console.error(err);
      showToast("Could not read image.", "danger");
    }
  });

  try {
    await db.openDatabase();
    await hydrateLegacyRows();
    await loadProject(currentProjectId);
    document.getElementById("recIndicator").classList.add("db-ready");
    renderNotifications();
    updateNotificationBadge();
    updateSmartShotCode();
  } catch (err) {
    console.error("DB init error:", err);
    showToast("Could not open local database.", "danger");
  }
}

document.addEventListener("DOMContentLoaded", init);
