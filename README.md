# Austin & Kelsey Grace · Save the Date

Our save-the-date website for **Sunday, April 18, 2027**, made for phones first.

**Live site:** https://cappuccino4.github.io/CappuccioSaveTheDate/

Here's what guests see:

1. **"We are getting married!"** A photo-booth strip of the two of us prints out of the holder.
2. **The invitation.** An envelope opens, our photo slides out, the date is spelled out in plain type ("Sunday · April 18 · 2027"), and a live countdown to 4:00 PM Eastern on April 18, 2027 ticks away.
3. **Share your details.** A short form asks for their full name, then whether they already know they can't make it. If they can come, it asks for their mailing address and, if they're married, their first dance song.

Very old browsers (an iPhone or iPad still on iOS 14 or older, or Chrome older than version 88) show a simple card instead, with the date and a note to open the link on a newer phone or computer.

Every reply goes straight into **your own Google Sheet**. Guests don't need an account. You can see answers live, download them for Excel, or open the private [responses page](#3-on-your-private-responses-page).

This README walks you through everything, one click at a time:

- [Preview it on your computer](#preview-it-on-your-computer)
- [Put it online with GitHub Pages](#put-it-online-with-github-pages)
- [Collect responses in Google Sheets](#collect-responses-in-google-sheets) ← do this before you send the link
- [Test it](#test-it) (with a short checklist for before you send the link)
- [See everyone's answers](#see-everyones-answers)
- [Updating the script later](#updating-the-script-later)
- [Customizing](#customizing)
- [Privacy & safety](#privacy--safety)
- [Troubleshooting](#troubleshooting)
- [What's in this folder](#whats-in-this-folder)

---

## Preview it on your computer

The site has to be opened through a little local web server. Double-clicking `index.html` won't work: browsers block parts of a page that's opened straight from a file, so you'd get a blank page and then a card asking you to turn on JavaScript.

You need **Python 3**. It's free from https://www.python.org/downloads/ (on Windows, tick **Add python.exe to PATH** in the installer). To check that you have it, run `python --version` in a terminal.

1. Open a terminal in this folder (in VS Code: **Terminal → New Terminal**).
2. Start the server:

   ```bash
   python -m http.server 8000 --bind 127.0.0.1
   ```

   On a Mac, type `python3` instead of `python`. On Windows, `py` also works. The `--bind 127.0.0.1` part keeps the preview on this computer only, which also avoids a Windows Firewall pop-up.
3. Open **http://localhost:8000/** in your browser.
   - The terminal should say *"Serving HTTP on 127.0.0.1 port 8000"*. An error instead (such as *"Address already in use"*, or on Windows *WinError 10013* or *10048*) means something else is using port 8000. Run the same command with `8080` instead of `8000`, and open **http://localhost:8080/**.
4. Press <kbd>Ctrl</kbd>+<kbd>C</kbd> in the terminal to stop the server when you're done.

> **Tip:** to see it at phone size, open your browser's developer tools (<kbd>F12</kbd>) and click the phone/tablet icon.

**Preview mode.** Until you connect Google Sheets (that is, while `formEndpoint` in `assets/js/config.js` is empty), the form runs in **preview mode** on your computer. You can click through every step, but nothing is sent or saved, and the thank-you card says so: *"Preview mode — this response wasn't saved."*

Preview mode only ever happens on your own computer. On the live site, an empty `formEndpoint` makes the form say *"Replies aren't being collected just yet — please let Austin or Kelsey know."* instead of pretending to save, so a forgotten step can't quietly lose replies.

---

## Put it online with GitHub Pages

You only do this once. After that, every push to `main` updates the live site.

1. Commit and push everything to GitHub:

   ```bash
   git add -A
   git commit -m "Save the date website"
   git push -u origin main
   ```

2. On GitHub, open the repository → **Settings** → **Pages** (left sidebar).
3. Under **Build and deployment**:
   - **Source:** *Deploy from a branch*
   - **Branch:** `main` and folder **/ (root)** → **Save**
4. Wait a minute or two, then refresh the page. It will say **"Your site is live at https://cappuccino4.github.io/CappuccioSaveTheDate/"**.

Good to know:

- On a free GitHub account, Pages needs the repository to be **Public**. That's fine, because there are no secrets in this repo. The passphrase for viewing replies lives in Google, not here. (It also means anyone can read this README, so never copy a passphrase out of it.)
- The empty `.nojekyll` file is there on purpose. It tells GitHub to serve the files exactly as they are.
- **Updates take a few minutes to show up.** After each push, GitHub needs 1–2 minutes to publish, and a phone or browser that already opened the site can keep the old files for up to **10 minutes**. To see the newest version right away, open the link in a **private/incognito tab**.
- **The address is case-sensitive.** The `CappuccioSaveTheDate` part must have exactly these capitals (and the account name before `.github.io` is *cappuccino4*, with an "n"). With different capitals, GitHub shows its "404" page. So share the link by copy-paste. If you'll print it or say it aloud, consider a custom domain or a short link.
- If you ever edit a file directly on github.com, run `git pull` before your next push.

---

## Collect responses in Google Sheets

This connects the form to a Google Sheet that only you (and anyone you share it with) can see. It's free and takes about 10 minutes. You'll create a Sheet, add a small script to it, and paste one URL into the website.

### Step 1: Create the Sheet

1. Go to **https://sheets.google.com** and open a **Blank spreadsheet**. Use a **personal Gmail account**: work or school accounts often aren't allowed to publish to *Anyone*, which this needs.
2. Name it something like **Wedding Responses** (click "Untitled spreadsheet" at the top left).
3. **Share it with your partner:** click **Share** (top right) → type their Gmail address → choose **Editor** → **Send**.
   - Leave **General access** on **Restricted**. This Sheet will hold your guests' home addresses, so never switch it to *Anyone with the link*.
   - Editors can also open the script and see the responses-page passphrase, so give anyone else (parents, a planner) **Viewer** instead.

### Step 2: Add the script

1. In the Sheet, click **Extensions → Apps Script**. A new tab opens with a file called `Code.gs` that contains `function myFunction() {}`.
2. Click **Untitled project** at the top and rename it **Save the Date responses**.
3. Delete everything in `Code.gs`. Then paste in the entire contents of [`apps-script/Code.gs`](apps-script/Code.gs) from this repo. On GitHub, open the file and use the copy icon at the top right of the file (**Copy raw content**).
4. Click the **Save** icon (💾) or press <kbd>Ctrl</kbd>+<kbd>S</kbd>.
5. *(Optional, recommended)* Add the settings file:
   - Click **Project Settings** (⚙️ gear in the left sidebar) and tick **Show "appsscript.json" manifest file in editor**.
   - Go back to the **Editor** (`< >` in the left sidebar) and open `appsscript.json`.
   - Replace its contents with [`apps-script/appsscript.json`](apps-script/appsscript.json) and **Save**.

   This sets the script's time zone to Eastern and limits its access to this one spreadsheet.

### Step 3: Run `setup` once, and say "yes" to Google

1. In the toolbar above the code, pick **setup** in the function dropdown, then click **▶ Run**.
2. Google asks for permission. This is normal for any script you write yourself:
   1. **Authorization required** → **Review permissions** → choose your Google account.
   2. You *may* see **"Google hasn't verified this app."** Don't worry. This is **your own script**, running in your own account, and Google shows this warning for personal scripts that haven't been through its app review. Click **Advanced** → **Go to Save the Date responses (unsafe)**.
   3. Google lists what the script can do: work with **this one spreadsheet** only. Tick the checkbox (or **Select all**), then click **Continue**. (Older screens say **Allow**.)
3. The **Execution log** at the bottom should say *"All set: the "Responses" tab … is ready for replies."*
4. Switch back to your Sheet. There's now a **Responses** tab with a bold, frozen header row.

`setup` also saves your Sheet's ID as a script property called `SPREADSHEET_ID` (you'll see it under **Project Settings → Script Properties**). Leave it there: it's the script's backup way to find its Sheet (see [Troubleshooting](#troubleshooting)).

### Step 4: Deploy it as a web app

1. Click the blue **Deploy** button (top right) → **New deployment**.
2. Click the ⚙️ gear next to **Select type** → **Web app**.
3. Fill in:
   - **Description:** `Save the date`
   - **Execute as:** **Me** (your email)
   - **Who has access:** **Anyone**. It must be plain *Anyone*, **not** *Anyone with Google account*, or guests would be asked to sign in.
4. Click **Deploy**. If Google asks you to authorize again, repeat the same steps as above.
5. Under **Web app**, click **Copy** next to the **URL**. (Not the *Deployment ID* above it, which is only a code.) The URL looks like `https://script.google.com/macros/s/AKfy…long…/exec` and **ends in `/exec`**.

### Step 5: Paste the URL into the website

1. Open [`assets/js/config.js`](assets/js/config.js) and paste the URL between the quotes:

   ```js
   window.SAVE_THE_DATE_CONFIG = {
     formEndpoint: 'https://script.google.com/macros/s/AKfy…/exec',
     weddingDateISO: '2027-04-18T16:00:00-04:00',
     weddingWebsiteURL: 'https://www.zola.com/wedding/kelseygraceandaustin',
   };
   ```

2. Save, then commit and push:

   ```bash
   git add assets/js/config.js
   git commit -m "Connect the form to Google Sheets"
   git push
   ```

3. GitHub needs a minute or two to publish. A phone or browser that already opened the site can keep the old files for up to 10 minutes, so test in a **private/incognito tab** (or wait 10 minutes). Then go to [Test it](#test-it). That's it. You're collecting replies!

---

## Test it

1. **Check the script:** open a **private/incognito window**, so you're signed out of Google, and paste your `/exec` URL. You should see:

   ```json
   {"ok":true,"service":"save-the-date","version":1}
   ```

   Why a private window? In a normal window you're signed in as the script's owner, and Google lets the owner in even when *Who has access* is set wrong. Guests are never signed in. If you see a Google sign-in page, an error, or *"can't open its Google Sheet"* instead, jump to [Troubleshooting](#troubleshooting).
2. **Send a test reply:** open the live site on your phone (in a private tab if you opened the site in the last 10 minutes) → **Open your invitation** → **Share your details** → fill it in → **Submit**. You should get *"Thank you, {your name}!"* and **no** "Preview mode" note.
   - Your phone now remembers that you replied, so from then on the form opens on *"You're all set"*. Tap **Submit another response** to test again, and try the "can't make it" path too.
3. **Look at the Sheet:** your reply appears as a new row in the **Responses** tab within a second or two.
4. Delete your test rows when you're done: right-click the row number → **Delete row**.

> The very first reply after a quiet period can take a few seconds while Google wakes the script up. That's normal.

### Before you send the link to guests

- [ ] Your `/exec` URL shows `{"ok":true,…}` in a **private window**.
- [ ] A test reply showed up in the **Responses** tab, and you deleted it afterwards.
- [ ] You texted the link to yourself and the preview card looks right (photo + names).
- [ ] You opened the site on an iPhone *and* an Android phone if you can, and tapped through all three pages.
- [ ] You'll share the link by copy-paste. The part after `github.io` is case-sensitive (`CappuccioSaveTheDate`), and with different capitals it shows GitHub's 404 page.
- [ ] *(Optional)* `ADMIN_PASSPHRASE` is set and **responses.html** opens with it.

---

## See everyone's answers

### 1. Live, in the Google Sheet

Open your Sheet and go to the **Responses** tab. Each reply is one row:

| Column | What's in it |
|---|---|
| Submitted At (Eastern time) | When they replied, e.g. `2026-10-18 14:03:22` (sorts correctly) |
| Full Name | As they typed it |
| Can't Make It | `Yes` / `No` |
| Mailing Address | One tidy line, e.g. `123 Main St, Apt 4B, Boston, MA 02134, United States` |
| Street Address · Apt / Suite · City · State / Province · ZIP / Postal Code · Country | The same address, split up (handy for mail merge). The form asks for the country first, and only US addresses must have a state, so State can be blank for guests abroad (the UK, for example, has none). |
| Married | `Yes` / `No` (blank if they can't make it) |
| First Dance Song · First Dance Artist | Only if they're married and chose to share |
| Submission ID | A behind-the-scenes code that stops the same reply from being saved twice |

Things you can safely do:

- Sort, filter, color rows, and add your own columns, for example an **Invitation mailed** checkbox column. New replies still land in the right columns.
- ZIP codes keep their leading zeros (`02134`). Everything guests type is stored as plain text, so nothing turns into a formula.

Please **don't rename the "Responses" tab or the header cells**. The script uses them to find its columns. If one goes missing, the script adds it back at the end, so no reply is ever lost.

**A "Filtered" tab?** The form has a hidden anti-spam field that people never see but bots tend to fill in. A reply with that field filled in never reaches **Responses**. It goes to a separate **Filtered** tab instead, with whatever was typed into the hidden field in the last column, and the sender still sees the normal thank-you. That tab is almost always bots, but glance at it before you mail the invitations: if a real guest ended up there (an autofill tool can occasionally fill the hidden field), copy columns A to N of their row into the next empty row of **Responses**. The columns line up. The Filtered tab keeps at most 500 rows.

**Two rows for one guest?** If a guest's connection drops while their reply is sending, the form keeps their answers and offers **Try again**. Trying again with the same answers reuses the same Submission ID, so the Sheet never gets a duplicate row. But if the guest *changes* an answer before trying again, that counts as a new reply with a new Submission ID. So if the first attempt did reach the Sheet after all, you'll see two rows for that guest. The later one (newest *Submitted At*) is the corrected one, and you can delete the earlier row.

### 2. In Excel, or as a CSV file

**For Excel, download the Sheet as an Excel file:** in the Sheet, choose **File → Download → Microsoft Excel (.xlsx)**. Every answer stays plain text there: ZIP codes keep their leading zeros (`02134`), apartments like `3-4` stay as typed instead of turning into dates, accents and emoji survive, and nothing a guest typed can run as a formula on your computer.

Don't double-click the Sheet's own **File → Download → Comma-separated values (.csv)** to open it in Excel. Excel would drop leading zeros, turn `3-4` into a date, garble accents, and treat an answer that starts with `=` as a formula. That CSV is fine for Google Sheets, Numbers, or a mail-merge service.

The **Download CSV** button on the [responses page](#3-on-your-private-responses-page) makes a file that's safe for Excel: no formulas can run, and accents survive. Excel still drops leading zeros from ZIP codes when you double-click *any* CSV, though. To keep them, open Excel and use **Data → From Text/CSV**, pick the file, set **Data Type Detection** to **Do not detect data types**, then click **Load**. ZIP codes stay exactly as typed.

### 3. On your private responses page

**https://cappuccino4.github.io/CappuccioSaveTheDate/responses.html**

This page isn't linked from the site and is hidden from search engines. It shows every reply in a phone-friendly list:

- **Totals** for responses, addresses, can't make it, and married. Tap a total to show just those guests.
- **Search** across names, cities, songs, and everything else.
- **Sort** by newest, oldest, or name.
- **Copy address** on each card copies a ready-to-paste mailing label.
- **Download CSV** gives you exactly what's on screen. Tap **Addresses** and then Download for a clean mailing list.
- It flags **"Duplicate?"** when two replies share a name.
- If the Sheet ever holds more than 2,000 rows (only a flood of junk could do that), the page shows the newest 2,000 and says so. The Sheet always has everything.

To turn the page on, give it a passphrase (once):

1. **Make up your own passphrase: four random words**, for example by opening a book at four random pages and taking one word from each. It must be at least **16 characters**. Don't copy anything from this README (it's public), and don't use your names or the wedding date. If it's too short, the page stays off and tells you so.
2. In the Apps Script editor, open **Project Settings** (⚙️).
3. Scroll to **Script Properties** → **Add script property**. (`SPREADSHEET_ID` is already there from `setup`. Leave it.)
4. Enter **Property:** `ADMIN_PASSPHRASE` and **Value:** your four words.
5. Click **Save script properties**. You don't need to redeploy.

Then open the responses page and enter the passphrase. It stays unlocked until you close the tab, and **Lock** forgets it right away. To change the passphrase later, go back to **Project Settings** and click **Edit script properties**.

- After **5 wrong tries**, the page pauses for **15 minutes**, for everyone. That's a safety brake against guessing. Because the web app's URL is public, an outsider could keep the page paused by guessing over and over. That's annoying but harmless: your **Google Sheet always works**, and every wrong try shows up as a warning in Apps Script's **Executions** (☰ list icon in the left sidebar), so you can tell if someone is guessing.
- Want to see the page before setting anything up? Open **responses.html?demo** for made-up sample replies.

---

## Updating the script later

If you ever paste a newer `Code.gs`, Google keeps serving the **old version** until you publish a new one:

1. Paste the new code → **Save**.
2. **Deploy → Manage deployments**.
3. Select your web app deployment → click the ✏️ **pencil (Edit)**.
4. **Version:** choose **New version** → **Deploy**.

The URL stays the same, so `config.js` doesn't change. Don't use *New deployment* for updates: that creates a **different** URL, and you'd have to paste it into `config.js` again.

---

## Customizing

| I want to change… | Where |
|---|---|
| The Zola link on the thank-you card | `assets/js/config.js` → `weddingWebsiteURL`. Every guest sees a **Visit our Zola page** button once they've replied, whether or not they can come (and on the *"You're all set"* card when they come back). Set it to `''` to hide the button; its wording is in `assets/js/form.js` (`COPY.website` / `COPY.websiteButton`). |
| The wedding date/time | `assets/js/config.js` → `weddingDateISO`. Keep the format. `-04:00` means Eastern *Daylight* Time (spring to fall); use `-05:00` for a winter date. It drives the countdown and its *"It's wedding day!"* / *"Just married!"* messages. The date is also *written out* as text in a few places, so change those too: `index.html` (the script "04.18.27" on the invitation, the plain "Sunday · April 18 · 2027" line, the hidden text for screen readers, the no-JavaScript card, and in the link-preview tags at the top, "April 18, 2027" in `description`, `og:description` and `twitter:description` and "04.18.27" in the picture descriptions `og:image:alt` and `twitter:image:alt`), `responses.html` ("Save the Date · 04.18.27"), and the link-preview picture (`tools/share-card.html`, then re-render it, see below). In `index.html`, searching for `April` and `04.18.27` finds every spot. |
| The words on the pages (headings, buttons, "04.18.27") | `index.html` |
| The wording of the form's questions | `assets/js/form.js` (the `COPY` and `ERRORS` lists near the top of the file) |
| Colors | The four main colors are in `assets/css/tokens.css` (`#d6dee3`, `#839aad`, `#31505e`, `#b4c3ce`), next to the same colors written as numbers (`--c-ink-rgb` and friends) that the softer tints in the other stylesheets are made from. A few places spell a color out on their own: `theme-color` in `index.html` and `responses.html`, the Sheet's header and tab colors in `apps-script/Code.gs` (`headerTextColor`, `headerFillColor`, `tabColor`, `filteredTabColor`), and the pictures with colors baked in. The wax seal, the icons and the share card are redrawn by `python tools/render-images.py` (see below). The envelope liner and the soft shadows behind the photo-booth holder, the photo and the envelope are drawn by `tools/process-images.py`. The shadows' color is `SHADOW_RGB` in that script (the same numbers as `--c-shadow-rgb` in `tokens.css`), so to recolor them, change both, run `python tools/process-images.py` again (it needs `python -m pip install pillow numpy` once), then re-render the share card. |
| Fonts | `assets/fonts/fonts.css` (the font files sit next to it) and the `--font-…` names in `assets/css/tokens.css`. |
| Font 1 → the real **New Icon Script** | It's a paid font, so the site uses the free look-alike **Imperial Script**. Buy a *web* license, and check that it allows the font file to sit in a **public** GitHub repository, because anyone can download the files in this repo. If it doesn't, ask the seller, or keep Imperial Script. Then save the file as `assets/fonts/new-icon-script.woff2` and un-comment the ready-made slot at the bottom of `assets/fonts/fonts.css`. Everything switches over automatically, except one line: in `index.html`, change the preload link's `href="assets/fonts/imperial-script-400-latin.woff2"` to `href="assets/fonts/new-icon-script.woff2"`, so phones fetch the new font first instead of the old one. Two things to check afterwards: the script headings have extra `word-spacing` (in `assets/css/styles.css`, `assets/css/form.css` and `assets/css/responses.css`) because Imperial Script's spaces are narrow, and the icons, wax seal and share card are pictures, so they keep the old lettering until you re-render them with `python tools/render-images.py` (see below). |
| A photo or illustration | The site doesn't show the original JPGs in `public/images/` (they're never edited). It shows transparent cut-outs in `public/images/cutouts/`, made from the originals by `tools/process-images.py`, which also draws the soft shadows behind the holder, the photo and the envelope. That script is **tuned to these five pictures**. Re-running it on the same originals reproduces the current files exactly, but a picture with a different size or framing makes it stop with an error message, or comes out wrong. On top of that, `assets/css/styles.css` copies the cut-outs' measurements (from `public/images/cutouts/geometry.json`), so swapping a picture is a job for someone comfortable with CSS. To try anyway, keep the file name and match the old size and framing exactly: `PhotoStripHolder.jpg` 260 × 626 px (the dark photo-booth slot, upright), `PhotoStrip.jpg` 115 × 419 px (four black-and-white frames, straight), `OpenEnvelope.jpg` 551 × 412 px (the back of an open cream envelope, tilted about 8° clockwise), `EnvelopePicture.jpg` 515 × 435 px (a black-and-white print with a cream border, tilted about 10° clockwise) and `Animals.jpg` 202 × 252 px (a line drawing), each on a pure white background. Then run `python -m pip install pillow numpy` once and `python tools/process-images.py`, and check http://localhost:8000/#/invitation before you push. |
| The picture shown when you text the link | `public/images/share-card.jpg` (1200 × 630). It's drawn from the small web page `tools/share-card.html`: after changing that page, or the fonts and cut-outs it uses, run `python tools/render-images.py` (next row). Messaging apps cache previews, so a changed image may take a while to show up in old conversations. |
| The tab and home-screen icons, or the wax seal | These are pictures drawn from small web pages in `tools/`: `tools/icon.html` makes the three files in `public/images/icons/`, and `tools/seal.html` makes `public/images/cutouts/seal.webp`. After changing those pages, or the fonts and cut-outs they use, run `python tools/render-images.py`. It needs Pillow (`python -m pip install pillow`) and Google Chrome or Microsoft Edge on the computer. It rewrites `public/images/share-card.jpg`, the three files in `public/images/icons/` and `public/images/cutouts/seal.webp`. Preview, then commit and push. |
| The site's address (a renamed repository or your own domain) | `index.html`: the link-preview tags `og:url`, `og:image` and `twitter:image` hold the full address (`https://cappuccino4.github.io/CappuccioSaveTheDate/…`), because messaging apps need it spelled out. Change them to the new address. Everything else uses relative links. |

After any change, preview locally, then commit and push.

---

## Privacy & safety

- **Out of search engines.** Every page has a `noindex` tag, so the site won't show up on Google. Anyone you send the link to can open it, of course.
- **Replies live only in your Google account.** The form sends them straight to your Google Sheet. GitHub never sees them. There are no trackers, analytics, or cookies.
- **Keep the Sheet's sharing tight.** General access stays **Restricted**. Your partner is an **Editor**, and anyone else gets **Viewer** (editors can also open the script and see the passphrase).
- **The web-app URL is public by nature.** It's in `config.js`, so a curious person could find it. That's why the script protects itself:
  - it checks every reply and caps every answer's length;
  - it stores answers as plain text, so nothing becomes a formula;
  - it keeps bots out of **Responses** with a hidden "honeypot" field (their replies go to the [Filtered tab](#1-live-in-the-google-sheet) instead, at most 500 of them);
  - it never saves the same reply twice;
  - it accepts at most **120 new replies per 10 minutes** and **3,000 in total**, far more than any wedding needs, so a script can't bury your Sheet. Beyond that, the form asks guests to try again in a moment (their answers stay in the form), and Apps Script's **Executions** shows an error that says why.

  If junk ever shows up, just delete those rows. In the worst case, make a *New deployment* (new URL), paste it into `config.js` and push. Then go to **Deploy → Manage deployments**, select the **old** deployment and click **Archive deployment**. Otherwise the old URL keeps accepting replies.
- **The passphrase stays in Google.** Keep `ADMIN_PASSPHRASE` only in Apps Script's Script Properties. Never put it in the code or this repo, and don't share it. You can change it there any time (**Edit script properties**). Make it four random words of your own: anything shorter than 16 characters, or copied from this README, keeps the responses page turned off.
- **On guests' phones:** while a guest fills in the form, their answers are kept in that browser tab, so a reload or a quick trip to another app doesn't wipe them. They're cleared when the reply is sent, or when the tab is closed. After replying, the guest's own browser remembers their first name and that they've replied, so it can greet them with "You're all set" if they come back. Their address and other answers are not kept on the device.

---

## Troubleshooting

**The form says it couldn't send.**
1. Open a **private/incognito window** and paste your `/exec` URL. You should see `{"ok":true,…}`. (A normal window doesn't count: you're signed in as the script's owner, and Google lets you in even when the access setting is wrong.)
   - **A Google sign-in page instead?** The deployment isn't public. Go to **Deploy → Manage deployments → ✏️ Edit** and set **Who has access: Anyone**. Then **Version: New version** → **Deploy**.
2. Is the URL in `config.js` the one that **ends in `/exec`**? The editor's URL, the *Deployment ID* and a `/dev` "test deployment" URL won't work for guests.
3. Did you change `Code.gs` recently? Then [deploy a new version](#updating-the-script-later).
4. Still stuck? In Apps Script, open **Executions** (☰ list icon in the left sidebar). Errors show up there with details.

**The form says "Replies aren't being collected just yet".**
`formEndpoint` in `assets/js/config.js` is still empty on the live site. Paste your `/exec` URL ([Step 5](#step-5-paste-the-url-into-the-website)), push, and test in a private tab.

**There's no "Anyone" option in "Who has access".**
You're probably signed in with a work or school (Google Workspace) account whose admin blocks public web apps. Use a personal Gmail account for the Sheet and script.

**I edited the script but nothing changed.**
Google serves the version you deployed. See [Updating the script later](#updating-the-script-later).

**The browser console says "blocked by CORS policy".**
This almost always means Google sent back an error page or a sign-in page instead of the script's answer. Run through the first two checks above: *Anyone* access and the `/exec` URL. The site deliberately sends plain-text requests, which Apps Script supports without any extra setup.

**Replies say "Thank you" but nothing shows up in the Responses tab.**
- Trying it on your own computer? There the form runs in [preview mode](#preview-it-on-your-computer) until `formEndpoint` is filled in, and nothing is saved (the thank-you card says so).
- Look in the **Filtered** tab: a reply whose hidden anti-spam field was filled in lands there instead ([what to do](#1-live-in-the-google-sheet)).
- Make sure you're looking at the Sheet you created the script from.

**The `/exec` URL says "can't open its Google Sheet", or Executions shows "You do not have permission to call SpreadsheetApp.getActiveSpreadsheet" (or "…openById").**
1. The script has to be created *from the Sheet* (**Extensions → Apps Script**), not from script.google.com, and `setup` must have been run and allowed. Run **setup** again (it also saves the Sheet's ID as `SPREADSHEET_ID`), [deploy a new version](#updating-the-script-later), and check the `/exec` URL again in a private window.
2. Still failing? Then Google isn't handing the Sheet to the web app directly. The script can open it by its saved ID instead, but that needs slightly broader Sheets access:
   1. Delete the first line of `Code.gs` (`/** @OnlyCurrentDoc */`).
   2. If you added `appsscript.json`, change `https://www.googleapis.com/auth/spreadsheets.currentonly` to `https://www.googleapis.com/auth/spreadsheets` in it.
   3. **Save**, run **setup** again and approve the new permission (Google will say the script can see all your spreadsheets; it only ever opens this one). Then [deploy a new version](#updating-the-script-later).

**The responses page says…**
- *"turned off"*: add the `ADMIN_PASSPHRASE` script property ([how](#3-on-your-private-responses-page)).
- *"too short"*: your `ADMIN_PASSPHRASE` has fewer than 16 characters, or it's an example from this README. Make up four random words and save them with **Edit script properties**.
- *"doesn't match"*: check for typos. Passphrases are case-sensitive.
- *"Too many incorrect tries"*: wait 15 minutes. The Sheet still works. If it keeps happening, someone may be guessing (each wrong try shows up as a warning in **Executions**), so [change the passphrase](#3-on-your-private-responses-page).
- *"Couldn't reach your Google Apps Script"*: if your internet works, open your `/exec` link in a **private window**. A Google sign-in page there means **Who has access** isn't set to **Anyone** (fix it as in the first entry above). For anything else besides `{"ok":true,…}`, see the entries above.
- *"didn't recognize this request"*: your deployed script is older than this page. Paste the latest `Code.gs` and [deploy a new version](#updating-the-script-later).
- *"Not connected yet"*: `config.js` doesn't have the `/exec` URL yet, or it isn't pushed, or your browser still has the old copy (try a private tab).
- *"shows only the last 2,000"*: the Sheet has more than 2,000 rows, which only a flood of junk replies could cause. Delete the junk rows in the Sheet. The Sheet itself always has everything.

**The countdown shows the wrong time.**
Check `weddingDateISO` in `assets/js/config.js`. 4:00 PM Eastern on April 18, 2027 is `2027-04-18T16:00:00-04:00`.

**The live site still shows the old version.**
GitHub Pages needs 1–2 minutes after a push, and browsers may keep the old copy for up to 10 minutes. Open the link in a **private/incognito tab** to see the newest version right away. (Closing and reopening a normal tab isn't enough.)

**On my computer the page is blank, then only asks me to turn on JavaScript.**
- You probably double-clicked `index.html`. Use the [local server](#preview-it-on-your-computer) instead.
- If you did use the server, your computer may be sending JavaScript files with the wrong type. Run `python -c "import mimetypes; print(mimetypes.guess_type('app.js'))"` in a terminal. If it doesn't print `text/javascript` or `application/javascript`, your Windows registry maps `.js` files to something else. Open **regedit**, go to `HKEY_CLASSES_ROOT\.js`, and set **Content Type** to `text/javascript`. (Or preview with VS Code's **Live Server** extension instead.) The live site isn't affected.

---

## What's in this folder

```
index.html              the website: three screens (home → invitation → share details)
responses.html          your private responses page (unlinked, noindex)
assets/
  js/config.js          ← the one settings file: your /exec URL + wedding date/time
  js/app.js             screens and animations
  js/countdown.js       the live countdown
  js/form.js            the "Share your details" form
  js/responses.js       the responses page
  css/tokens.css        colors, fonts, shared button styles
  css/styles.css        the site's look and layout
  css/form.css          the form's look
  css/responses.css     the responses page's look
  fonts/                self-hosted fonts (Imperial Script, Poppins, Beth Ellen)
public/images/          original photos (never edited)
  cutouts/              transparent versions the site uses (made by tools/process-images.py)
  icons/                favicon + home-screen icon (drawn by tools/icon.html)
  share-card.jpg        the link-preview picture (drawn by tools/share-card.html)
apps-script/
  Code.gs               the Google Apps Script you paste into your Sheet
  appsscript.json       its settings (Eastern time, access to this one Sheet)
tools/                  helpers for rebuilding images (not needed to run the site)
  process-images.py     makes the cut-outs and their soft shadows from the originals
  render-images.py      re-draws the share card, icons and wax seal (needs Chrome or Edge)
  icon.html             draws the icons
  share-card.html       draws the link-preview picture
  seal.html             draws the wax seal on the envelope flap
.nojekyll               tells GitHub Pages to serve files as-is
```

How a reply travels:

```
Guest's phone ──(Share your details)──▶ your Apps Script web app ──▶ your Google Sheet ("Responses" tab)
                         responses.html ◀──(with your passphrase)──┘
```

**Fonts:** Poppins, Beth Ellen, and Imperial Script are free fonts under the SIL Open Font License, served from this site (no Google Fonts calls). *New Icon Script* by Set Sail Studios is a paid font and isn't included.

With love, for April 18, 2027.
