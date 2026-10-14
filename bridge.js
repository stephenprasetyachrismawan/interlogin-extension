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
    const next = url.toString();
    setTimeout(() => window.location.assign(next), 60);
    return { ok: true, debug: mode };
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
