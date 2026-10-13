# interlogin

The Odoo tab in front of you, signed in as someone else.

interlogin by [stephenprasetyachrismawan](https://github.com/stephenprasetyachrismawan)

Each Odoo site keeps its own logins. Add one from the panel, or import a JSON file. Pick a name on the site that is open. interlogin signs out of that session, signs in as that account, and opens `/web`.

```
interlogin                     Add  Import
Administrator · mydb

odoo.example.com · this tab
AD   Administrator
     admin@example.com · current

other.odoo.com
DU   Demo User
     demo@example.com
```

## Install

Download [interlogin-1.1.0.zip](https://github.com/stephenprasetyachrismawan/interlogin-extension/releases/download/v1.1.0/interlogin-1.1.0.zip) and unzip it.

1. Open `chrome://extensions` or `edge://extensions`.
2. Turn on Developer mode.
3. Choose **Load unpacked** and select the unzipped `interlogin` folder.
4. Open an Odoo tab, then click the interlogin icon.

To use this repository directly, load this folder the same way.

## Sites

Accounts are grouped by site. The open Odoo tab is marked `this tab`, and only those buttons can sign in. Other sites stay in the list, with their buttons off, until that site is the active tab.

## Add a login

On an Odoo tab, choose **Add**.

- Username is optional. When it is filled in, the list shows it above the email.
- Email and password are required. Email is the Odoo login.
- The account is saved for that site only.

Saving the same email on the same site replaces the stored password. The `×` on a row removes that account from that site.

## JSON import

Import is optional. `email` and `password` are required. `username` is optional. `site` chooses the group. Without `site`, the account is added to the Odoo tab that is open.

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

`users.example.json` is a starter. Passwords stay in this browser's extension storage. The database comes from the open Odoo tab, so the file does not need one.

## Sign-in

interlogin calls `/web/session/logout` on that tab, then `/web/session/authenticate` with the stored email and password. A wrong password leaves you on the Odoo login page, because the previous session was already signed out.
