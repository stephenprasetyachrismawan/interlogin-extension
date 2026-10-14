# interlogin

The open Odoo tab, signed in as someone else.

interlogin by [stephenprasetyachrismawan](https://github.com/stephenprasetyachrismawan)

<p align="center">
  <a href="https://github.com/stephenprasetyachrismawan/interlogin-extension/releases/tag/v1.2.0"><img alt="version 1.2.0" src="https://img.shields.io/badge/version-1.2.0-714B67"></a>
  <img alt="Manifest V3" src="https://img.shields.io/badge/manifest-V3-4C3146">
  <img alt="Chrome and Edge" src="https://img.shields.io/badge/browser-Chrome%20%7C%20Edge-1F6B3A">
  <a href="https://github.com/stephenprasetyachrismawan/interlogin-extension/releases"><img alt="GitHub release" src="https://img.shields.io/github/v/release/stephenprasetyachrismawan/interlogin-extension?color=714B67"></a>
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#sites">Sites</a> ·
  <a href="#add-a-login">Add a login</a> ·
  <a href="#debug">Debug</a> ·
  <a href="#fetch">Fetch</a> ·
  <a href="#reset">Reset</a> ·
  <a href="#json">JSON</a>
</p>

![interlogin, from the open site to reset](assets/interlogin.gif)

The panel sits under the extension icon. It signs out of the Odoo session on that tab and signs in as the account you pick. Another website does nothing.

## Install

Download [interlogin-1.2.0.zip](https://github.com/stephenprasetyachrismawan/interlogin-extension/releases/download/v1.2.0/interlogin-1.2.0.zip) and unzip it.

1. Open `chrome://extensions` or `edge://extensions`.
2. Turn on Developer mode.
3. Choose **Load unpacked** and select the unzipped `interlogin` folder.
4. Open an Odoo tab, then click the interlogin icon.

To use this repository directly, load this folder the same way.

## Sites

Each Odoo origin keeps its own list. The open tab is marked `this tab`, and only those buttons can sign in. Other sites stay visible with their buttons off until that site is the active tab.

## Add a login

On an Odoo tab, choose **Add**.

- Username is optional. When it is set, the list shows it above the email.
- Email and password are required. Email is the Odoo login.
- The account is stored for that site only.

The same email on the same site replaces the stored password. The `×` on a row removes that account from that site. A row with no password cannot sign in.

## Debug

One switch on an Odoo tab.

- Click once: debug mode on, or back off. If assets debug is on, one click returns to ordinary debug.
- Click twice: assets debug.

The Odoo tab reloads so the session actually changes. Fetch stays disabled until debug mode is on.

## Fetch

Fetch is shown only when the signed-in account can manage every user (`base.group_erp_manager` in Odoo 17). It also requires debug mode.

Fetch reads `id`, name, and login for the users that account can see, including archived ones, and updates the cache for that site.

- A saved email keeps its password.
- The Odoo name and id replace the stored name and id.
- A user that was not in the list is added with no password.

## Reset

The same manager account can set one new password on every user it can manage: internal, portal, and public.

The panel asks first. Nothing is written until **Reset all passwords** is clicked in the confirmation. The account you are using is included, so Odoo signs that session out. Passwords already cached for that site are updated to the new value when the reset succeeds.

## JSON

Import is optional. `email` and `password` are required. `username` is optional. `site` chooses the group. Without `site`, the account joins the Odoo tab that is open.

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

`users.example.json` is a starter. Passwords stay in this browser's extension storage. The database comes from the open Odoo tab.

## Sign-in

interlogin calls `/web/session/logout` on that tab, then `/web/session/authenticate` with the stored email and password. A wrong password leaves you on the Odoo login page, because the previous session was already signed out.
