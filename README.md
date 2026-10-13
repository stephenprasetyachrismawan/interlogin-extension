# interlogin

The Odoo tab in front of you, signed in as someone else.

interlogin by [stephenprasetyachrismawan](https://github.com/stephenprasetyachrismawan)

Keep the logins in a JSON file. Click the icon, pick a name, and interlogin signs out of the open session, signs in as that account, and opens `/web`. The panel sits under the extension icon. It only signs in when the active tab is Odoo.

```
interlogin                          Import
Administrator · mydb

AD   Administrator
     admin@example.com · current

DU   Demo User
     demo@example.com
```

On any other site the names stay visible and the buttons stay off.

## Install

1. Open `chrome://extensions` or `edge://extensions`.
2. Turn on Developer mode.
3. Choose **Load unpacked** and select this folder.
4. Open an Odoo tab, then click the interlogin icon.

## Account file

`email` and `password` are required. `name` is optional. That name is what the list shows.

```json
[
  {
    "name": "Administrator",
    "email": "admin@example.com",
    "password": "admin"
  },
  {
    "name": "Demo User",
    "email": "demo@example.com",
    "password": "demo"
  }
]
```

`users.example.json` is a starter. Importing the same email again replaces that account. The `×` on a row removes it from this browser.

Passwords stay in the extension storage of this browser profile. The database comes from the Odoo tab you are switching, so the file does not need a database name.

## Sign-in

interlogin calls `/web/session/logout` on that tab, then `/web/session/authenticate` with the email and password you stored. A wrong password leaves you on the Odoo login page, because the previous session was already signed out.
