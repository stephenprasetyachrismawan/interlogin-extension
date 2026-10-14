importScripts("bridge.js");

const JOB_KEY = "resetJob";
const SITES_KEY = "sites";
const NORMAL_ICON = {
  16: "icons/icon16.png",
  32: "icons/icon32.png",
  48: "icons/icon48.png",
  128: "icons/icon128.png",
};
const BUSY_ICON = {
  16: "icons/icon16-busy.png",
  32: "icons/icon32-busy.png",
  48: "icons/icon48-busy.png",
  128: "icons/icon128-busy.png",
};

let running = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return;
  }
  if (message.type === "reset-status") {
    sendResponse({ running: running });
    return;
  }
  if (message.type === "reset") {
    startReset(message);
    sendResponse({ running: true });
  }
});

async function setBusyIcon(busy) {
  await chrome.action.setIcon({ path: busy ? BUSY_ICON : NORMAL_ICON });
  await chrome.action.setTitle({ title: busy ? "Resetting passwords…" : "interlogin" });
}

async function rememberPasswords(origin, password, result) {
  const stored = await chrome.storage.local.get(SITES_KEY);
  const sites = stored[SITES_KEY] && typeof stored[SITES_KEY] === "object" ? stored[SITES_KEY] : {};
  const ids = new Set(result.ids || []);
  const logins = new Set((result.logins || []).map((login) => String(login).toLowerCase()));
  sites[origin] = (sites[origin] || []).map((account) => {
    const email = String(account.email || "");
    if ((account.id && ids.has(account.id)) || logins.has(email.toLowerCase())) {
      return { ...account, password: password };
    }
    return account;
  });
  await chrome.storage.local.set({ [SITES_KEY]: sites });
}

async function startReset(job) {
  const tabId = job && job.tabId;
  const origin = job && job.origin;
  const password = job && job.password;
  if (running || !tabId || !origin || !String(password || "").trim()) {
    return;
  }
  running = true;
  let result = { ok: false, error: "Reset failed." };
  try {
    await chrome.storage.session.set({ [JOB_KEY]: { tabId: tabId, origin: origin, password: password } });
    await setBusyIcon(true);
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: "MAIN",
      func: odooBridge,
      args: ["reset", { password: password }],
    });
    result = (injection && injection.result) || result;
    if (result.ok) {
      try {
        await rememberPasswords(origin, password, result);
      } catch (error) {
        // The Odoo write already finished.
      }
      try {
        await chrome.tabs.reload(tabId);
      } catch (error) {
        // The tab can close before the refresh.
      }
    }
  } catch (error) {
    result = { ok: false, error: "Could not reach the Odoo tab." };
  } finally {
    running = false;
    await chrome.storage.session.remove(JOB_KEY);
    await setBusyIcon(false);
    try {
      await chrome.runtime.sendMessage({ type: "reset-finished", result: result });
    } catch (error) {
      // The popup is already closed.
    }
  }
}

async function resumeReset() {
  const stored = await chrome.storage.session.get(JOB_KEY);
  if (running) {
    return;
  }
  if (!stored[JOB_KEY]) {
    await setBusyIcon(false);
    return;
  }
  await startReset(stored[JOB_KEY]);
}

resumeReset();
