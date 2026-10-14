const SITES_KEY = "sites";
const LEGACY_KEY = "accounts";

const sessionLine = document.querySelector("#session-line");
const statusLine = document.querySelector("#status");
const accountList = document.querySelector("#account-list");
const accountForm = document.querySelector("#account-form");
const moreButton = document.querySelector("#more-button");
const morePanel = document.querySelector("#more-panel");
const addButton = document.querySelector("#add-button");
const importButton = document.querySelector("#import-button");
const importFile = document.querySelector("#import-file");
const cancelAdd = document.querySelector("#cancel-add");
const odooTools = document.querySelector("#odoo-tools");
const debugSwitch = document.querySelector("#debug-switch");
const fetchButton = document.querySelector("#fetch-button");
const resetForm = document.querySelector("#reset-form");
const resetConfirm = document.querySelector("#reset-confirm");
const resetConfirmText = document.querySelector("#reset-confirm-text");
const resetConfirmOk = document.querySelector("#reset-confirm-ok");
const resetConfirmCancel = document.querySelector("#reset-confirm-cancel");

let sites = {};
let odooTab = null;
let busy = false;
let moreOpen = false;
let othersOpen = false;
let pendingReset = "";
let debugClicks = 0;
let debugTimer = null;

document.addEventListener("DOMContentLoaded", init);
moreButton.addEventListener("click", toggleMore);
addButton.addEventListener("click", toggleForm);
cancelAdd.addEventListener("click", closeForm);
accountForm.addEventListener("submit", saveFromForm);
importButton.addEventListener("click", () => importFile.click());
importFile.addEventListener("change", importAccounts);
accountList.addEventListener("click", onListClick);
debugSwitch.addEventListener("click", onDebugClick);
fetchButton.addEventListener("click", fetchUsers);
resetForm.addEventListener("submit", askReset);
resetConfirmOk.addEventListener("click", confirmReset);
resetConfirmCancel.addEventListener("click", closeReset);

async function init() {
  const stored = await chrome.storage.local.get([SITES_KEY, LEGACY_KEY]);
  sites = normalizeSites(stored[SITES_KEY]);
  const legacy = Array.isArray(stored[LEGACY_KEY]) ? stored[LEGACY_KEY] : [];
  odooTab = await detectActiveOdooTab();
  if (legacy.length && odooTab && odooTab.origin) {
    const moved = collectIncoming(legacy, odooTab.origin);
    applyIncoming(moved.grouped);
    await chrome.storage.local.set({ [SITES_KEY]: sites });
    await chrome.storage.local.remove(LEGACY_KEY);
  }
  render();
}

async function runOnPage(command, payload) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    return null;
  }
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: odooBridge,
    args: [command, payload == null ? null : payload],
  });
  return injection ? injection.result : null;
}

async function detectActiveOdooTab() {
  try {
    return (await runOnPage("detect", null)) || { isOdoo: false };
  } catch (error) {
    return { isOdoo: false };
  }
}

function toggleMore() {
  moreOpen = !moreOpen;
  if (!moreOpen) {
    closeForm();
    closeReset();
  }
  render();
}

function toggleForm() {
  if (!odooTab || !odooTab.isOdoo || !odooTab.origin) {
    setStatus("Open an Odoo tab before adding someone.", "error");
    return;
  }
  moreOpen = true;
  if (!accountForm.hidden) {
    closeForm();
    render();
    return;
  }
  render();
  accountForm.hidden = false;
  accountForm.elements.username.focus();
}

function closeForm() {
  accountForm.reset();
  accountForm.hidden = true;
}

async function saveFromForm(event) {
  event.preventDefault();
  if (!odooTab || !odooTab.origin) {
    setStatus("Open an Odoo tab before adding a login.", "error");
    return;
  }
  const username = accountForm.elements.username.value.trim();
  const email = accountForm.elements.email.value.trim();
  const password = accountForm.elements.password.value;
  if (!email || !password) {
    setStatus("Email and password are required.", "error");
    return;
  }
  const origin = odooTab.origin;
  sites[origin] = mergeAccounts(sites[origin] || [], [{ username, email, password }]);
  await chrome.storage.local.set({ [SITES_KEY]: sites });
  closeForm();
  render();
  setStatus(`Saved ${displayName({ username, email })} for ${siteLabel(origin)}.`);
}

async function importAccounts() {
  const [file] = importFile.files || [];
  importFile.value = "";
  if (!file) {
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch (error) {
    setStatus("The file is not valid JSON.", "error");
    return;
  }
  const fallback = odooTab && odooTab.origin ? odooTab.origin : "";
  const incoming = collectIncoming(parsed, fallback);
  const imported = [...incoming.grouped.values()].reduce((count, rows) => count + rows.length, 0);
  if (!imported) {
    setStatus("No accounts found. Each item needs an email, a password, and a site.", "error");
    return;
  }
  applyIncoming(incoming.grouped);
  await chrome.storage.local.set({ [SITES_KEY]: sites });
  render();
  const skipped = incoming.skipped ? ` ${incoming.skipped} skipped.` : "";
  setStatus(`Imported ${imported} account${imported === 1 ? "" : "s"}.${skipped}`);
}

function collectIncoming(parsed, fallbackSite) {
  const grouped = new Map();
  let skipped = 0;

  function add(row, siteHint) {
    const account = accountFromRow(row, siteHint || fallbackSite);
    if (!account) {
      skipped += 1;
      return;
    }
    const rows = grouped.get(account.site) || [];
    rows.push(account);
    grouped.set(account.site, rows);
  }

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.sites && typeof parsed.sites === "object") {
    for (const [origin, rows] of Object.entries(parsed.sites)) {
      if (!Array.isArray(rows)) {
        skipped += 1;
        continue;
      }
      for (const row of rows) {
        add(row, origin);
      }
    }
    return { grouped, skipped };
  }

  const rows = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.users) ? parsed.users : [parsed];
  for (const row of rows) {
    add(row, row && (row.site || row.url || row.origin));
  }
  return { grouped, skipped };
}

function applyIncoming(grouped) {
  for (const [origin, rows] of grouped) {
    sites[origin] = mergeAccounts(sites[origin] || [], rows);
  }
}

function accountFromRow(row, siteHint, requirePassword = true) {
  if (!row || typeof row !== "object") {
    return null;
  }
  const email = String(row.email || row.login || "").trim();
  const password = row.password == null ? "" : String(row.password);
  const site = normalizeOrigin(siteHint);
  if (!email || !site || (requirePassword && !password)) {
    return null;
  }
  const id = Number(row.id);
  return {
    site,
    id: Number.isInteger(id) && id > 0 ? id : null,
    username: String(row.username || row.name || "").trim(),
    email,
    password,
  };
}

function normalizeSites(value) {
  const next = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return next;
  }
  for (const [origin, rows] of Object.entries(value)) {
    const site = normalizeOrigin(origin);
    if (!site || !Array.isArray(rows)) {
      continue;
    }
    const accounts = rows.map((row) => accountFromRow(row, site, false)).filter(Boolean);
    if (accounts.length) {
      next[site] = mergeAccounts(next[site] || [], accounts);
    }
  }
  return next;
}

function copyAccount(account) {
  const id = Number(account.id);
  return {
    id: Number.isInteger(id) && id > 0 ? id : null,
    username: account.username || "",
    email: account.email,
    password: account.password || "",
  };
}

function mergeAccounts(current, incoming) {
  const next = current.map(copyAccount);
  const indexByEmail = new Map(next.map((account, index) => [account.email.toLowerCase(), index]));
  for (const account of incoming) {
    const key = account.email.toLowerCase();
    const existing = indexByEmail.has(key) ? next[indexByEmail.get(key)] : null;
    const id = Number(account.id);
    const stored = {
      id: Number.isInteger(id) && id > 0 ? id : existing && existing.id,
      username: account.username != null ? account.username : (existing && existing.username) || "",
      email: account.email,
      password: account.password || (existing && existing.password) || "",
    };
    if (existing) {
      next[indexByEmail.get(key)] = stored;
    } else {
      indexByEmail.set(key, next.length);
      next.push(stored);
    }
  }
  return next;
}

function normalizeOrigin(value) {
  if (!value) {
    return "";
  }
  try {
    const raw = String(value).trim();
    return new URL(raw.includes("://") ? raw : `https://${raw}`).origin;
  } catch (error) {
    return "";
  }
}

function siteLabel(origin) {
  try {
    return new URL(origin).host;
  } catch (error) {
    return origin;
  }
}

function displayName(account) {
  return account.username || account.email;
}

function render() {
  renderTools();
  const session = odooTab && odooTab.session;
  const origin = odooTab && odooTab.origin;
  if (!odooTab || !odooTab.isOdoo) {
    sessionLine.textContent = "Open an Odoo tab";
  } else if (session && session.name) {
    sessionLine.textContent = `Signed in as ${session.name}`;
  } else if (origin) {
    sessionLine.textContent = siteLabel(origin);
  } else {
    sessionLine.textContent = "Odoo";
  }

  accountList.replaceChildren();
  const origins = new Set(Object.keys(sites));
  if (origin) {
    origins.add(origin);
  }
  const ordered = [...origins].sort((left, right) => {
    if (left === origin) {
      return -1;
    }
    if (right === origin) {
      return 1;
    }
    return siteLabel(left).localeCompare(siteLabel(right));
  });

  if (!ordered.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "Open an Odoo tab, then add someone.";
    accountList.appendChild(empty);
    return;
  }

  const currentEmail = session && session.username ? session.username.toLowerCase() : "";
  const visible = othersOpen ? ordered : ordered.filter((site) => site === origin);
  const hiddenCount = ordered.length - visible.length;
  if (!visible.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = origin ? "No one saved for this site yet." : "Open an Odoo tab to see its people.";
    accountList.appendChild(empty);
  }
  for (const site of visible) {
    const group = document.createElement("li");
    const heading = document.createElement("p");
    const isCurrent = site === origin;
    heading.className = "site-name";
    heading.dataset.current = isCurrent ? "true" : "false";
    heading.textContent = isCurrent ? `${siteLabel(site)} · this tab` : siteLabel(site);
    if (othersOpen) {
      group.appendChild(heading);
    }

    const accounts = sites[site] || [];
    if (!accounts.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "No one saved for this site yet.";
      group.appendChild(empty);
      accountList.appendChild(group);
      continue;
    }

    for (const account of accounts) {
      const row = document.createElement("div");
      row.className = "row";
      const button = document.createElement("button");
      const isSignedIn = isCurrent && currentEmail && currentEmail === account.email.toLowerCase();
      button.className = "account";
      button.type = "button";
      button.dataset.site = site;
      button.dataset.email = account.email;
      button.dataset.current = isSignedIn ? "true" : "false";
      button.disabled = busy;
      if (!account.password) {
        button.title = "No password saved yet";
      } else if (!isCurrent) {
        button.title = `Open ${siteLabel(site)} first`;
      } else {
        button.title = `Sign in as ${displayName(account)}`;
      }

      const stamp = document.createElement("span");
      stamp.className = "stamp";
      stamp.textContent = initials(displayName(account));

      const meta = document.createElement("span");
      meta.className = "meta";
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = displayName(account);
      const email = document.createElement("span");
      email.className = "email";
      email.textContent = isSignedIn ? "Signed in" : account.email;
      meta.append(name, email);

      const remove = document.createElement("button");
      remove.className = "remove";
      remove.type = "button";
      remove.dataset.remove = account.email;
      remove.dataset.site = site;
      remove.textContent = "×";
      remove.title = `Remove ${account.email}`;
      remove.setAttribute("aria-label", `Remove ${account.email} from ${siteLabel(site)}`);

      button.append(stamp, meta);
      row.append(button, remove);
      group.appendChild(row);
    }
    accountList.appendChild(group);
  }
  if (hiddenCount > 0 || othersOpen) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.className = "others";
    button.type = "button";
    button.dataset.others = "true";
    button.textContent = othersOpen ? "Hide other sites" : `${hiddenCount} saved on other sites`;
    item.appendChild(button);
    accountList.appendChild(item);
  }
}

async function onListClick(event) {
  const removeButton = event.target.closest("[data-remove]");
  if (removeButton) {
    event.preventDefault();
    event.stopPropagation();
    const site = removeButton.dataset.site;
    const email = removeButton.dataset.remove.toLowerCase();
    sites[site] = (sites[site] || []).filter((account) => account.email.toLowerCase() !== email);
    if (!sites[site].length) {
      delete sites[site];
    }
    await chrome.storage.local.set({ [SITES_KEY]: sites });
    render();
    setStatus("Account removed.");
    return;
  }

  if (event.target.closest("[data-others]")) {
    othersOpen = !othersOpen;
    render();
    return;
  }
  const button = event.target.closest(".account");
  if (!button || button.disabled || busy) {
    return;
  }
  const account = (sites[button.dataset.site] || []).find((item) => item.email.toLowerCase() === button.dataset.email.toLowerCase());
  if (!account) {
    setStatus("That person is no longer in the list.", "error");
    return;
  }
  if (!account.password) {
    moreOpen = true;
    render();
    accountForm.hidden = false;
    accountForm.elements.username.value = account.username || "";
    accountForm.elements.email.value = account.email;
    accountForm.elements.password.focus();
    setStatus(`Add a password for ${displayName(account)}.`, "error");
    return;
  }
  await switchTo(button.dataset.site, account);
}

async function switchTo(site, account) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !odooTab || !odooTab.isOdoo || odooTab.origin !== site) {
    setStatus(`Open ${siteLabel(site)} first, then choose ${displayName(account)}.`, "error");
    return;
  }
  busy = true;
  render();
  setStatus(`Signing in as ${displayName(account)}…`);
  try {
    const result = await runOnPage("switch", { email: account.email, password: account.password });
    if (!result || !result.ok) {
      busy = false;
      render();
      setStatus((result && result.error) || "Login failed.", "error");
      return;
    }
    setStatus(`Opening Odoo as ${result.name || displayName(account)}.`);
  } catch (error) {
    busy = false;
    render();
    setStatus("Could not reach the Odoo tab.", "error");
  }
}

function setStatus(message, tone) {
  statusLine.hidden = false;
  statusLine.dataset.tone = tone || "info";
  statusLine.textContent = message;
}

function initials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function currentSession() {
  return (odooTab && odooTab.session) || {};
}

function debugValue() {
  return String(currentSession().debug || "");
}

function debugModes(value) {
  return String(value || "")
    .split(",")
    .map((mode) => mode.trim())
    .filter((mode) => mode && mode !== "0" && mode !== "false");
}

function debugIsSimple(value) {
  const modes = debugModes(value);
  return modes.includes("1") && !modes.includes("assets");
}

function debugIsOn(value) {
  return debugModes(value).length > 0;
}

function renderTools() {
  const isOdoo = Boolean(odooTab && odooTab.isOdoo);
  const isAdmin = Boolean(currentSession().isAdmin);
  const debug = debugValue();
  morePanel.hidden = !moreOpen;
  moreButton.textContent = moreOpen ? "Done" : "More";
  moreButton.setAttribute("aria-expanded", moreOpen ? "true" : "false");
  debugSwitch.disabled = busy || !isOdoo;
  debugSwitch.dataset.state = debugModes(debug).includes("assets") ? "assets" : debugIsOn(debug) ? "on" : "off";
  debugSwitch.textContent = debugModes(debug).includes("assets") ? "Assets" : debugIsOn(debug) ? "Debug on" : "Debug";
  fetchButton.hidden = !isAdmin;
  fetchButton.disabled = busy || !isOdoo || !debugIsOn(debug);
  resetConfirmOk.disabled = busy;
  fetchButton.title = debugIsOn(debug) ? "Update people from Odoo" : "Turn debug on first";
  resetForm.hidden = !isAdmin;
  if (!isAdmin) {
    closeReset();
  }
}

function onDebugClick() {
  debugClicks += 1;
  if (debugTimer) {
    clearTimeout(debugTimer);
  }
  debugTimer = setTimeout(() => {
    const clicks = debugClicks;
    debugClicks = 0;
    debugTimer = null;
    if (clicks >= 2) {
      setDebug("assets");
      return;
    }
    setDebug(debugIsSimple(debugValue()) ? "0" : "1");
  }, 280);
}

async function setDebug(mode) {
  if (!odooTab || !odooTab.isOdoo) {
    setStatus("Open an Odoo tab before changing debug mode.", "error");
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    return;
  }
  await runOnPage("debug", { mode: mode });
}

async function fetchUsers() {
  if (!currentSession().isAdmin) {
    setStatus("Only an account that can manage users can fetch.", "error");
    return;
  }
  if (!debugIsOn(debugValue())) {
    setStatus("Turn on debug mode before fetching users.", "error");
    return;
  }
  const origin = odooTab && odooTab.origin;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!origin || !tab || !tab.id) {
    setStatus("Open an Odoo tab before fetching users.", "error");
    return;
  }
  busy = true;
  render();
  setStatus("Fetching users…");
  try {
    const result = await runOnPage("fetch", null);
    if (!result || !result.ok) {
      busy = false;
      render();
      setStatus((result && result.error) || "Fetch failed.", "error");
      return;
    }
    applyFetchedUsers(origin, result.users || []);
    await chrome.storage.local.set({ [SITES_KEY]: sites });
    busy = false;
    render();
    setStatus(`Updated ${result.users.length} user${result.users.length === 1 ? "" : "s"} for ${siteLabel(origin)}.`);
  } catch (error) {
    busy = false;
    render();
    setStatus("Could not reach the Odoo tab.", "error");
  }
}

function applyFetchedUsers(origin, users) {
  const current = sites[origin] || [];
  const byEmail = new Map(current.map((account) => [account.email.toLowerCase(), copyAccount(account)]));
  const seen = new Set(current.map((account) => account.email.toLowerCase()));
  for (const user of users) {
    const email = String(user.login || "").trim();
    const id = Number(user.id);
    if (!email || !Number.isInteger(id) || id <= 0) {
      continue;
    }
    const key = email.toLowerCase();
    const existing = byEmail.get(key);
    byEmail.set(key, {
      id: id,
      username: String(user.name || (existing && existing.username) || "").trim(),
      email: existing ? existing.email : email,
      password: (existing && existing.password) || "",
    });
  }
  const kept = current.map((account) => byEmail.get(account.email.toLowerCase())).filter(Boolean);
  const added = [...byEmail.values()].filter((account) => !seen.has(account.email.toLowerCase()));
  sites[origin] = [...kept, ...added];
}

function askReset(event) {
  event.preventDefault();
  if (busy) {
    return;
  }
  if (!currentSession().isAdmin) {
    setStatus("Only an account that can manage users can reset passwords.", "error");
    return;
  }
  const password = resetForm.elements.password.value;
  if (!password.trim()) {
    setStatus("Enter the new password first.", "error");
    return;
  }
  pendingReset = password;
  resetConfirmText.textContent = `This sets every user this account can manage to “${password}”, including internal, portal, and public users. The account you are using is included, so Odoo will sign this session out. This cannot be undone.`;
  resetConfirm.hidden = false;
  resetConfirmCancel.focus();
}

function closeReset() {
  pendingReset = "";
  resetConfirm.hidden = true;
}

async function confirmReset() {
  const password = pendingReset;
  const origin = odooTab && odooTab.origin;
  if (!password || !origin) {
    closeReset();
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    return;
  }
  busy = true;
  render();
  setStatus("Resetting passwords…");
  try {
    const result = await runOnPage("reset", { password: password });
    if (!result || !result.ok) {
      busy = false;
      closeReset();
      render();
      setStatus((result && result.error) || "Reset failed.", "error");
      return;
    }
    const ids = new Set(result.ids || []);
    const logins = new Set((result.logins || []).map((login) => String(login).toLowerCase()));
    sites[origin] = (sites[origin] || []).map((account) => {
      if ((account.id && ids.has(account.id)) || logins.has(account.email.toLowerCase())) {
        return { ...copyAccount(account), password: password };
      }
      return account;
    });
    await chrome.storage.local.set({ [SITES_KEY]: sites });
    resetForm.reset();
    closeReset();
    busy = false;
    render();
    setStatus(`Reset ${result.count} password${result.count === 1 ? "" : "s"}.`);
  } catch (error) {
    busy = false;
    closeReset();
    render();
    setStatus("Could not reach the Odoo tab.", "error");
  }
}

async function odooBridge(command, payload) {
  async function rpc(path, params) {
    const response = await fetch(path, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        params: params || {},
        id: Date.now(),
      }),
    });
    const body = await response.json();
    if (body.error) {
      const data = body.error.data || {};
      const message = data.message || body.error.message || "Odoo request failed";
      const error = new Error(message);
      error.code = data.name || "";
      throw error;
    }
    return body.result;
  }

  function readDatabase(html) {
    const input = html.match(/<input\b[^>]*\bname=["']db["'][^>]*>/i);
    if (input) {
      const value = input[0].match(/\bvalue=["']([^"']*)["']/i);
      if (value && value[1]) {
        return value[1];
      }
    }
    const logo = html.match(/[?&]dbname=([^"'&\s]+)/i);
    return logo ? decodeURIComponent(logo[1]) : null;
  }

  function readDatabaseFromPage() {
    const field = document.querySelector('input[name="db"], select[name="db"]');
    if (field && field.value) {
      return field.value;
    }
    const logo = document.querySelector('img[src*="dbname="]');
    if (!logo) {
      return null;
    }
    const match = (logo.getAttribute("src") || "").match(/[?&]dbname=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  async function readSession() {
    try {
      const info = await rpc("/web/session/get_session_info", {});
      return {
        db: info.db || null,
        username: info.uid ? info.username || null : null,
        name: info.uid ? info.name || null : null,
        isAdmin: Boolean(info.uid && info.is_admin),
        debug: (info.bundle_params && info.bundle_params.debug) || "",
      };
    } catch (error) {
      return null;
    }
  }

  if (command === "detect") {
    try {
      const version = await rpc("/web/webclient/version_info", {});
      if (!version || !version.server_version) {
        return { isOdoo: false };
      }
    } catch (error) {
      return { isOdoo: false };
    }
    const session = (await readSession()) || { db: null, username: null, name: null, isAdmin: false, debug: "" };
    if (!session.debug) {
      session.debug = new URLSearchParams(location.search).get("debug") || "";
    }
    if (!session.db) {
      session.db = readDatabaseFromPage();
    }
    if (!session.db) {
      try {
        const loginPage = await fetch("/web/login", { credentials: "include", cache: "no-store" });
        session.db = readDatabase(await loginPage.text());
      } catch (error) {
        session.db = null;
      }
    }
    return { isOdoo: true, origin: location.origin, session: session };
  }

  if (command === "debug") {
    const url = new URL(location.href);
    const mode = payload && payload.mode ? String(payload.mode) : "0";
    url.searchParams.set("debug", mode);
    location.assign(url.toString());
    return { ok: true };
  }

  if (command === "fetch" || command === "reset") {
    const session = await readSession();
    if (!session || !session.isAdmin) {
      return { ok: false, error: "Only an account that can manage users can do this." };
    }
    const debugModes = String(session.debug || "")
      .split(",")
      .map((mode) => mode.trim())
      .filter((mode) => mode && mode !== "0" && mode !== "false");
    if (command === "fetch" && !debugModes.length) {
      return { ok: false, error: "Turn on debug mode before fetching users." };
    }
    try {
      if (command === "fetch") {
        const users = await rpc("/web/dataset/call_kw/res.users/search_read", {
          model: "res.users",
          method: "search_read",
          args: [],
          kwargs: {
            domain: [],
            fields: ["id", "name", "login"],
            context: { active_test: false },
          },
        });
        return { ok: true, users: users || [] };
      }
      const password = payload && payload.password ? String(payload.password) : "";
      if (!password.trim()) {
        return { ok: false, error: "Enter the new password first." };
      }
      const rows = await rpc("/web/dataset/call_kw/res.users/search_read", {
        model: "res.users",
        method: "search_read",
        args: [],
        kwargs: {
          domain: [],
          fields: ["id", "login"],
          context: { active_test: false },
        },
      });
      const ids = (rows || []).map((row) => row.id).filter((id) => id);
      if (!ids.length) {
        return { ok: false, error: "No users were found." };
      }
      await rpc("/web/dataset/call_kw/res.users/write", {
        model: "res.users",
        method: "write",
        args: [ids, { password: password }],
        kwargs: { context: { active_test: false } },
      });
      return {
        ok: true,
        count: ids.length,
        ids: ids,
        logins: (rows || []).map((row) => row.login).filter(Boolean),
      };
    } catch (error) {
      return { ok: false, error: error.message || "Odoo request failed." };
    }
  }

  if (command !== "switch") {
    return { ok: false, error: "Unknown command." };
  }

  const email = payload && payload.email;
  const password = payload && payload.password;
  if (!email || !password) {
    return { ok: false, error: "Email and password are required." };
  }

  function leave(path) {
    setTimeout(() => window.location.assign(path), 60);
  }

  let db = null;
  const current = await readSession();
  if (current && current.db) {
    db = current.db;
  }
  if (!db) {
    db = readDatabaseFromPage();
  }

  let loginHtml = "";
  try {
    const logoutResponse = await fetch("/web/session/logout?redirect=/web/login", {
      credentials: "include",
      cache: "no-store",
      redirect: "follow",
    });
    loginHtml = await logoutResponse.text();
  } catch (error) {
    return { ok: false, error: "Could not sign out of the current Odoo session." };
  }
  if (!loginHtml.includes("csrf_token")) {
    try {
      const loginPage = await fetch("/web/login", { credentials: "include", cache: "no-store" });
      loginHtml = await loginPage.text();
    } catch (error) {
      leave("/web/login");
      return { ok: false, error: "Could not open the Odoo login page." };
    }
  }
  const csrfMatch = loginHtml.match(/name="csrf_token"\s+value="([^"]+)"/)
    || loginHtml.match(/value="([^"]+)"\s+name="csrf_token"/);
  if (!csrfMatch) {
    leave("/web/login");
    return { ok: false, error: "Could not open the Odoo login page." };
  }
  if (!db) {
    db = readDatabase(loginHtml);
  }
  if (!db) {
    leave("/web/login");
    return { ok: false, error: "Select a database in Odoo before switching users." };
  }

  const body = new URLSearchParams();
  body.set("csrf_token", csrfMatch[1]);
  body.set("login", email);
  body.set("password", password);
  body.set("db", db);
  body.set("redirect", "/web");
  try {
    const response = await fetch("/web/login", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      redirect: "follow",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const resultHtml = await response.text();
    let stillOnLogin = false;
    try {
      stillOnLogin = new URL(response.url).pathname.replace(/\/$/, "") === "/web/login";
    } catch (error) {
      stillOnLogin = /\/web\/login/.test(response.url || "");
    }
    if (stillOnLogin) {
      leave("/web/login");
      const wrong = /wrong login\/password/i.test(resultHtml);
      return { ok: false, error: wrong ? "Wrong email or password." : "Could not sign in as this person." };
    }
  } catch (error) {
    leave("/web/login");
    return { ok: false, error: "Could not sign in as this person." };
  }
  leave("/web");
  return { ok: true, name: email };
}
