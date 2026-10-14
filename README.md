<p align="center">
  <img src="icons/icon128.png" width="96" alt="interlogin icon">
</p>

<h1 align="center">interlogin</h1>

<p align="center">The open Odoo tab, signed in as someone else.</p>

<p align="center">interlogin by <a href="https://github.com/stephenprasetyachrismawan">stephenprasetyachrismawan</a></p>

<p align="center">
  <a href="https://github.com/stephenprasetyachrismawan/interlogin-extension/releases/tag/v1.2.2"><img alt="version 1.2.2" src="https://img.shields.io/badge/version-1.2.2-714B67?style=for-the-badge"></a>
  <img alt="Manifest V3" src="https://img.shields.io/badge/manifest-V3-4C3146?style=for-the-badge">
  <img alt="Chrome and Edge" src="https://img.shields.io/badge/browser-Chrome%20%7C%20Edge-1F6B3A?style=for-the-badge">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-C4A0C4?style=for-the-badge"></a>
  <a href="#security"><img alt="Security: passwords stay in this browser" src="https://img.shields.io/badge/security-passwords%20stay%20local-8C2433?style=for-the-badge"></a>
</p>

<p align="center">
  <a href="#install">📦 Install</a> ·
  <a href="#sites">🌐 Sites</a> ·
  <a href="#add-a-login">➕ Add a login</a> ·
  <a href="#debug">🐞 Debug</a> ·
  <a href="#fetch">🔄 Fetch</a> ·
  <a href="#reset">🔐 Reset</a> ·
  <a href="#json">📄 JSON</a> ·
  <a href="#security">🛡️ Security</a> ·
  <a href="LICENSE">📜 License</a> ·
  <a href="#stargazers">⭐ Stargazers</a>
</p>

<p align="center">
  <img alt="interlogin, from this tab to reset" src="assets/interlogin.gif">
</p>

<p align="center">
  <a href="assets/interlogin.mp4">Film · 1920×1080 · 60 fps</a>
</p>

👆 The panel sits under the extension icon. It signs out of the Odoo session on that tab and signs in as the account you pick. 🚫 Another website does nothing.

## 📦 Install

⬇️ Download [interlogin-1.2.2.zip](https://github.com/stephenprasetyachrismawan/interlogin-extension/releases/download/v1.2.2/interlogin-1.2.2.zip) and unzip it.

1. 🧭 Open `chrome://extensions` or `edge://extensions`.
2. 🛠️ Turn on Developer mode.
3. 📂 Choose **Load unpacked** and select the unzipped `interlogin` folder.
4. 🖥️ Open an Odoo tab, then click the interlogin icon.

💡 To use this repository directly, load this folder the same way.

## 🌐 Sites

🏠 Each Odoo origin keeps its own list. The panel shows the open site. 🔒 Other sites stay behind **N saved on other sites** until you open that list.

## ➕ Add a login

On an Odoo tab, choose **More**, then **Add**.

- 👤 Username is optional. When it is set, the list shows it above the email.
- 📧 Email and password are required. Email is the Odoo login.
- 💾 The account is stored for that site only.

🔁 The same email on the same site replaces the stored password. ❌ The `×` on a row removes that account from that site. 🔑 A row with no password asks you to add one.

## 🐞 Debug

🎛️ One switch on an Odoo tab.

- 👆 Click once: debug mode on, or back off. If assets debug is on, one click returns to ordinary debug.
- 👆👆 Click twice: assets debug.

🔄 The Odoo tab reloads so the session actually changes. ⛔ Fetch stays disabled until debug mode is on.

## 🔄 Fetch

👮 Fetch is shown only when the signed-in account can manage every user (`base.group_erp_manager` in Odoo 17). 🐞 It also requires debug mode.

Fetch reads `id`, name, and login for the users that account can see, including archived ones, and updates the cache for that site.

- 🔑 A saved email keeps its password.
- 🏷️ The Odoo name and id replace the stored name and id.
- 🆕 A user that was not in the list is added with no password.

## 🔐 Reset

👮 The same manager account can set one new password on every user it can manage: internal, portal, and public.

⚠️ The panel asks first. Nothing is written until **Reset all passwords** is clicked in the confirmation. 🚪 The account you are using is included, so Odoo signs that session out. 🔄 Passwords already cached for that site are updated to the new value when the reset succeeds.

## 📄 JSON

📎 Import is optional. `email` and `password` are required. `username` is optional. `site` chooses the group. Without `site`, the account joins the Odoo tab that is open.

```json
[
  {
    "site": "https://odoo.example.com",
    "username": "Administrator",
    "email": "admin@example.com",
    "password": "admin"
  },
  {
    "site": "https://staging.example.com",
    "username": "Demo User",
    "email": "demo@example.com",
    "password": "demo"
  }
]
```

🌱 `users.example.json` is a starter. 🔒 Passwords stay in this browser's extension storage. 🗄️ The database comes from the open Odoo tab.

## 🔑 Sign-in

interlogin calls `/web/session/logout` on that tab, then signs in with the stored email and password. ❌ A wrong password leaves you on the Odoo login page, because the previous session was already signed out.

## 🛡️ Security

🏠 interlogin does not send saved logins to a server of its own. The list stays in this browser profile, in extension storage.

- 👀 Anyone who can open this profile can read the saved passwords.
- 👮 Fetch and reset run only on the open Odoo tab, and only for an account that can manage users.
- ⚠️ Reset writes nothing until the confirmation is clicked. It then changes every user that account can manage, and Odoo signs that session out.
- 📄 Import a JSON file only when you trust the file. Its passwords are stored the same way.

The security badge above means that. It is not a third-party audit.

## ⭐ Stargazers

<p align="center">
  <a href="https://www.star-history.com/#stephenprasetyachrismawan/interlogin-extension&Date">
    <img alt="Star history of interlogin" src="https://api.star-history.com/svg?repos=stephenprasetyachrismawan/interlogin-extension&type=Date">
  </a>
</p>

## 📜 License

[MIT](LICENSE). Copyright (c) 2026 stephenprasetyachrismawan.
