const STORAGE_KEY = "accounts";

const sessionLine = document.querySelector("#session-line");
const statusLine = document.querySelector("#status");
const accountList = document.querySelector("#account-list");
const importButton = document.querySelector("#import-button");
const importFile = document.querySelector("#import-file");

let accounts = [];
let odooTab = null;
let busy = false;

document.addEventListener("DOMContentLoaded", init);
importButton.addEventListener("click", () => importFile.click());
importFile.addEventListener("change", importAccounts);
accountList.addEventListener("click", onListClick);

async function init() {
  accounts = await loadAccounts();
  odooTab = await detectActiveOdooTab();
  render();
}

async function loadAccounts() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
}

async function saveAccounts(nextAccounts) {
  accounts = nextAccounts;
  await chrome.storage.local.set({ [STORAGE_KEY]: accounts });
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
  const incoming = normalizeAccounts(parsed);
  if (!incoming.length) {
    setStatus("No accounts found. Each item needs email and password.", "error");
    return;
  }
  const merged = mergeAccounts(accounts, incoming);
  await saveAccounts(merged);
  setStatus(`Imported ${incoming.length} account${incoming.length === 1 ? "" : "s"}.`);
}

function normalizeAccounts(parsed) {
  const rows = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.users) ? parsed.users : [parsed];
  const accountsByEmail = new Map();
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const email = String(row.email || row.login || "").trim();
    const password = row.password == null ? "" : String(row.password);
    if (!email || !password) {
      continue;
    }
    const name = String(row.name || email).trim() || email;
    accountsByEmail.set(email.toLowerCase(), { name, email, password });
  }
  return [...accountsByEmail.values()];
}

function mergeAccounts(current, incoming) {
  const next = current.map((account) => ({ ...account }));
  const indexByEmail = new Map(next.map((account, index) => [account.email.toLowerCase(), index]));
  for (const account of incoming) {
    const key = account.email.toLowerCase();
    if (indexByEmail.has(key)) {
      next[indexByEmail.get(key)] = account;
    } else {
      indexByEmail.set(key, next.length);
      next.push(account);
    }
  }
  return next;
}

function render() {
  const session = odooTab && odooTab.session;
  if (!odooTab || !odooTab.isOdoo) {
    sessionLine.textContent = "Active tab is not Odoo";
  } else if (session && session.name) {
    sessionLine.textContent = session.db ? `${session.name} · ${session.db}` : session.name;
  } else if (session && session.db) {
    sessionLine.textContent = `Signed out · ${session.db}`;
  } else {
    sessionLine.textContent = "Odoo tab · database not selected";
  }

  accountList.replaceChildren();
  if (!accounts.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "Import a JSON file to add logins.";
    accountList.appendChild(empty);
    return;
  }

  const currentEmail = session && session.username ? session.username.toLowerCase() : "";
  for (const account of accounts) {
    const item = document.createElement("li");
    const row = document.createElement("div");
    row.className = "row";
    const button = document.createElement("button");
    const isCurrent = currentEmail && currentEmail === account.email.toLowerCase();
    button.className = "account";
    button.type = "button";
    button.dataset.email = account.email;
    button.dataset.current = isCurrent ? "true" : "false";
    button.disabled = busy || !odooTab || !odooTab.isOdoo;
    button.title = odooTab && odooTab.isOdoo ? `Sign in as ${account.email}` : "Open an Odoo tab first";

    const stamp = document.createElement("span");
    stamp.className = "stamp";
    stamp.textContent = initials(account.name);

    const meta = document.createElement("span");
    meta.className = "meta";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = account.name;
    const email = document.createElement("span");
    email.className = "email";
    email.textContent = isCurrent ? `${account.email} · current` : account.email;
    meta.append(name, email);

    const remove = document.createElement("button");
    remove.className = "remove";
    remove.type = "button";
    remove.dataset.remove = account.email;
    remove.textContent = "×";
    remove.title = `Remove ${account.email}`;
    remove.setAttribute("aria-label", `Remove ${account.email}`);

    button.append(stamp, meta);
    row.append(button, remove);
    item.appendChild(row);
    accountList.appendChild(item);
  }
}

async function onListClick(event) {
  const removeButton = event.target.closest("[data-remove]");
  if (removeButton) {
    event.preventDefault();
    event.stopPropagation();
    const email = removeButton.dataset.remove.toLowerCase();
    await saveAccounts(accounts.filter((account) => account.email.toLowerCase() !== email));
    setStatus("Account removed.");
    return;
  }
  const button = event.target.closest(".account");
  if (!button || button.disabled || busy) {
    return;
  }
  const account = accounts.find((item) => item.email === button.dataset.email);
  if (!account) {
    return;
  }
  await switchTo(account);
}

async function switchTo(account) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !odooTab || !odooTab.isOdoo) {
    setStatus("Open the Odoo tab you want to switch, then click the extension.", "error");
    return;
  }
  busy = true;
  render();
  setStatus(`Signing out and opening ${account.name}…`);
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
    setStatus(`Opening Odoo as ${result.name || account.name}.`);
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
    return { isOdoo: true, session: session };
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
