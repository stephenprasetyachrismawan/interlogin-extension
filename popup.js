const SITES_KEY = "sites";
const LEGACY_KEY = "accounts";

const sessionLine = document.querySelector("#session-line");
const statusLine = document.querySelector("#status");
const accountList = document.querySelector("#account-list");
const accountForm = document.querySelector("#account-form");
const addButton = document.querySelector("#add-button");
const importButton = document.querySelector("#import-button");
const importFile = document.querySelector("#import-file");
const cancelAdd = document.querySelector("#cancel-add");

let sites = {};
let odooTab = null;
let busy = false;

document.addEventListener("DOMContentLoaded", init);
addButton.addEventListener("click", toggleForm);
cancelAdd.addEventListener("click", closeForm);
accountForm.addEventListener("submit", saveFromForm);
importButton.addEventListener("click", () => importFile.click());
importFile.addEventListener("change", importAccounts);
accountList.addEventListener("click", onListClick);

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

async function detectActiveOdooTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    return { isOdoo: false };
  }
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: odooBridge,
      args: ["detect", null],
    });
    return injection && injection.result ? injection.result : { isOdoo: false };
  } catch (error) {
    return { isOdoo: false };
  }
}

function toggleForm() {
  if (!accountForm.hidden) {
    closeForm();
    return;
  }
  if (!odooTab || !odooTab.isOdoo || !odooTab.origin) {
    setStatus("Open an Odoo tab before adding a login.", "error");
    return;
  }
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

function accountFromRow(row, siteHint) {
  if (!row || typeof row !== "object") {
    return null;
  }
  const email = String(row.email || row.login || "").trim();
  const password = row.password == null ? "" : String(row.password);
  const site = normalizeOrigin(siteHint);
  if (!email || !password || !site) {
    return null;
  }
  return {
    site,
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
    const accounts = rows.map((row) => accountFromRow(row, site)).filter(Boolean);
    if (accounts.length) {
      next[site] = mergeAccounts(next[site] || [], accounts);
    }
  }
  return next;
}

function mergeAccounts(current, incoming) {
  const next = current.map((account) => ({
    username: account.username || "",
    email: account.email,
    password: account.password,
  }));
  const indexByEmail = new Map(next.map((account, index) => [account.email.toLowerCase(), index]));
  for (const account of incoming) {
    const stored = {
      username: account.username || "",
      email: account.email,
      password: account.password,
    };
    const key = stored.email.toLowerCase();
    if (indexByEmail.has(key)) {
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
  const session = odooTab && odooTab.session;
  const origin = odooTab && odooTab.origin;
  if (!odooTab || !odooTab.isOdoo) {
    sessionLine.textContent = "Active tab is not Odoo";
  } else if (session && session.name) {
    sessionLine.textContent = session.db ? `${session.name} · ${session.db}` : session.name;
  } else if (session && session.db) {
    sessionLine.textContent = `Signed out · ${session.db}`;
  } else {
    sessionLine.textContent = origin ? siteLabel(origin) : "Odoo tab";
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
    empty.textContent = "Open an Odoo tab, then add a login.";
    accountList.appendChild(empty);
    return;
  }

  const currentEmail = session && session.username ? session.username.toLowerCase() : "";
  for (const site of ordered) {
    const group = document.createElement("li");
    const heading = document.createElement("p");
    const isCurrent = site === origin;
    heading.className = "site-name";
    heading.dataset.current = isCurrent ? "true" : "false";
    heading.textContent = isCurrent ? `${siteLabel(site)} · this tab` : siteLabel(site);
    group.appendChild(heading);

    const accounts = sites[site] || [];
    if (!accounts.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "No logins for this site yet.";
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
      button.disabled = busy || !isCurrent;
      button.title = isCurrent ? `Sign in as ${account.email}` : `Open ${siteLabel(site)} to sign in`;

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
      email.textContent = isSignedIn ? `${account.email} · current` : account.email;
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

  const button = event.target.closest(".account");
  if (!button || button.disabled || busy) {
    return;
  }
  const account = (sites[button.dataset.site] || []).find((item) => item.email === button.dataset.email);
  if (!account) {
    return;
  }
  await switchTo(button.dataset.site, account);
}

async function switchTo(site, account) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !odooTab || !odooTab.isOdoo || odooTab.origin !== site) {
    setStatus("Open that site's Odoo tab, then choose the login.", "error");
    return;
  }
  busy = true;
  render();
  setStatus(`Signing out and opening ${displayName(account)}…`);
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: odooBridge,
      args: ["switch", { email: account.email, password: account.password }],
    });
    const result = injection && injection.result;
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
    const session = (await readSession()) || { db: null, username: null, name: null };
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

  if (command !== "switch") {
    return { ok: false, error: "Unknown command." };
  }

  const email = payload && payload.email;
  const password = payload && payload.password;
  if (!email || !password) {
    return { ok: false, error: "Email and password are required." };
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
  if (!db) {
    db = readDatabase(loginHtml);
  }
  if (!db) {
    return { ok: false, error: "Select a database in Odoo before switching users." };
  }

  try {
    const result = await rpc("/web/session/authenticate", {
      db: db,
      login: email,
      password: password,
    });
    if (!result || !result.uid) {
      window.location.assign("/web/login");
      return { ok: false, error: "Login failed. This account may require an extra verification step." };
    }
    window.location.assign("/web");
    return { ok: true, name: result.name || email };
  } catch (error) {
    window.location.assign("/web/login");
    const message = /access denied/i.test(error.message) ? "Wrong email or password." : error.message;
    return { ok: false, error: message || "Login failed." };
  }
}
