# interlogin

The Odoo tab in front of you, signed in as someone else.

interlogin by [stephenprasetyachrismawan](https://github.com/stephenprasetyachrismawan)

Click the icon, add a login, or import a JSON file. Each Odoo site keeps its own list. Pick a name on the site that is open, and interlogin signs out of that session, signs in as that account, and opens `/web`.

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

Buttons for another site stay off until that site is the active tab.

## Install

1. Open `chrome://extensions` or `edge://extensions`.
2. Turn on Developer mode.
3. Choose **Load unpacked** and select this folder.
4. Open an Odoo tab, then click the interlogin icon.

## Add a login

On an Odoo tab, choose **Add**. Username is optional. Email and password are required. The account is stored for that site only.

## Account file

JSON is optional. `email` and `password` are required. `username` is optional and is what the list shows when it is set. `site` chooses the group. Without `site`, the open Odoo tab is the group.

```json
[
  {
    "site": "https://odoo.example.com",
    "username": "Administrator",
    "email": "admin@example.com",
    "password": "admin"
  },
  {
    "site": "https://odoo.example.com",
    "username": "Demo User",
    "email": "demo@example.com",
    "password": "demo"
  }
]
```

`users.example.json` is a starter. Importing the same email again replaces that account on the same site. The `×` on a row removes it from that site.

Passwords stay in the extension storage of this browser profile. The database comes from the Odoo tab you are switching, so the file does not need a database name.

## Sign-in

interlogin calls `/web/session/logout` on that tab, then `/web/session/authenticate` with the email and password you stored. A wrong password leaves you on the Odoo login page, because the previous session was already signed out.
