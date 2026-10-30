# Islamic Image Generator

Daily Hadith cards from the hadith encyclopedia of [dorar.net](https://dorar.net/hadith), with a daily Pin on Pinterest.

Live site: <https://ahmedtrad.github.io/Islamic-image-generator/>

## Project Structure

```
islamic-image-generator/
├── index.html          # Main page: daily Hadith card and its hadith list (standalone, single file)
├── PRIVACY.md          # Privacy policy
├── package.json        # Node tooling: dorar.net importer, card renderer, Pinterest poster
├── .github/workflows/
│   └── daily-pin.yml           # Sends the day's card to Pinterest through Make at 06:00 Paris time
├── tools/
│   ├── render-card.mjs         # Renders the card to a PNG in headless Chrome
│   ├── check-cards.mjs         # Checks that every hadith fits the card in both formats
│   ├── post-make.mjs           # Prepares the day's Pin and sends it to Make (run by the workflow)
│   ├── post-make.test.mjs      # Make webhook tests against a stand-in server
│   ├── post-daily.mjs          # Pins through Pinterest's own API, for an approved API app
│   ├── pinterest.mjs           # Pinterest API v5: tokens, duplicate check, Pin creation, Pin text
│   ├── pinterest-auth.mjs      # One-time Pinterest API sign-in; saves the GitHub secrets
│   ├── pinterest.test.mjs      # Pinterest API tests against a stand-in server
│   ├── dorar.mjs               # CLI: search dorar.net, add one hadith or import in bulk
│   ├── dorar-topics.mjs        # Search words for the bulk import, by card category
│   ├── dorar-sources.mjs       # Where hadiths come from: dorar-hadith-api or dorar.net pages
│   ├── dorar-lib.mjs           # Page and JSON parsing, authenticity checks, card data block
│   ├── dorar-lib.test.mjs      # Parser tests (npm test)
│   └── dorar-sources.test.mjs  # Source and CLI tests against a stub API server
└── README.md
```

## Daily Hadith Card (`index.html`)

A self-contained page that renders a minimalist card for an authentic (صحيح) hadith and exports it as a PNG.

- **Content:** 881 sahih hadiths.
  - 21 were written by hand from Sahih al-Bukhari, Sahih Muslim and Jami' at-Tirmidhi. Each has full tashkeel, takhrij with «واللفظ لـ…» where the two Sahihs differ, and a one-line benefit (الفائدة).
  - 860 come from al-Bukhari and Muslim through dorar.net's official API (`npm run dorar -- bulk`). They keep dorar's own vocalization. The API has no explanations, so these cards have no الفائدة.
- **Narrations:** «قال رسول الله ﷺ:» is printed only above the Prophet's own words. A text that tells what he did, or quotes him inside a companion's account, appears without it.
- **Search:** the box under the arrows finds hadiths by words from the text, the narrator or the book. It ignores tashkeel and the different forms of alif.
- **Categories:** العبادات والأركان · مكارم الأخلاق · الإيمان والإخلاص · الأذكار وفضائل الأعمال. The daily pick rotates through them by date, so consecutive days change theme.
- **Formats:** square 1080 × 1080 and landscape 1200 × 900. The matn font size is fitted automatically so long narrations never overflow.
- **Export:** "تنزيل الصورة" paints the laid-out card onto a canvas word by word, so Arabic shaping, tashkeel and the web fonts (Amiri, Readex Pro) match the preview.
- **Links:** each hadith has its own URL hash, e.g. `index.html#muslim-2594`.

The hadith list lives in the `<script id="hadith-data">` JSON block inside the page. Each entry has `id`, `cat`, `matn`, `source`, `refs`, `narrator` and `sharh`. Add entries by hand, or import them from dorar.net (below).

### Importing hadiths from dorar.net

`tools/dorar.mjs` searches [الموسوعة الحديثية on dorar.net](https://dorar.net/hadith) and adds results to the card. It needs Node.js 18.17 or newer.

It reads dorar.net's pages directly. It can also go through [dorar-hadith-api](https://github.com/AhmedElTabarani/dorar-hadith-api), a small server that turns dorar.net's pages into JSON, if you run one (see [Fetching through dorar-hadith-api](#fetching-through-dorar-hadith-api)).

```bash
npm install
```

```bash
npm run dorar -- search "إنما الأعمال بالنيات"
```

```bash
npm run dorar -- add 1 --cat iman
```

To import many hadiths at once:

```bash
npm run dorar -- bulk
```

- **bulk** searches dorar.net's [official API](https://dorar.net/article/389) for each topic in `tools/dorar-topics.mjs`, two pages of 15 results each, limited to Sahih al-Bukhari and Sahih Muslim. It sends about 100 requests, paced and cached like the other commands.
- **What bulk keeps:** hadiths graded plainly «صحيح» with a hadith number, complete rather than abridged with «...», free of notes on other chains, at least partly vocalized, at most 700 characters, and not on the card yet. That includes hadiths already there under their other book's number.
- **After a bulk import,** `npm run check-cards` lays out every hadith in Chrome and confirms it fits the card in both formats.

- **search** lists Dorar's results with the source book and number, the grading scholar, the grade and the narrator. ✓ marks a sahih hadith from one of the main collections (al-Bukhari, Muslim, Abu Dawud, at-Tirmidhi, an-Nasa'i, Ibn Majah, Riyad as-Salihin).
- **add** takes a result number from the last search, or a `dorar.net/h/…` link. It refuses weak or non-sahih hadiths unless you pass `--force`, and refuses hadiths already on the card. It fills `source`, `refs` and `narrator` from Dorar. It takes `sharh` from the «وفي الحديث» lessons in Dorar's explanation and credits it on the card as «من شرح الدرر السنية».
- `--dry-run` shows the entry without changing the page; `--cat` is one of `ibadat`, `akhlaq`, `iman`, `dhikr`.
- The tool warns when the matn isn't fully vocalized (Dorar's texts often aren't) or is very long. Read each new entry before publishing.
- Answers are cached for a day in `tools/.cache/`. Requests to dorar.net itself go one at a time with a pause between them. If dorar.net refuses a request (HTTP 403, common from cloud servers), the tool stops instead of trying to get around it. Run it from a normal home connection.

`npm test` runs the parser and source tests. The source tests use a stub API server, not the network. Page structure follows the MIT-licensed [dorar-hadith-api](https://github.com/AhmedElTabarani/dorar-hadith-api).

### Fetching through dorar-hadith-api

[dorar-hadith-api](https://github.com/AhmedElTabarani/dorar-hadith-api) (MIT, by Ahmed El-Tabarani) is an Express server that fetches dorar.net's pages and answers in JSON. The importer uses three of its endpoints: `/v1/site/hadith/search`, `/v1/site/hadith/:id` and `/v1/site/sharh/:id`. There is no public instance, so run it on your own machine:

```bash
git clone https://github.com/AhmedElTabarani/dorar-hadith-api
cd dorar-hadith-api
npm install
cp .env.example .env
npm start
```

It listens on <http://localhost:5000>. Point the importer at it with `--api http://localhost:5000`, or set `DORAR_API_URL` to use it for every run.

- Its `package.json` asks for Node.js 24.16 or newer.
- When an API address is set, the importer uses only the API and reports an error if it doesn't answer. `--direct` reads dorar.net for one run even when `DORAR_API_URL` is set.
- It allows 100 requests a day per IP (`RATE_LIMIT_MAX` in its `.env`). The importer needs about two per hadith added, and caches answers for a day.
- When dorar.net answers it with HTTP 403, it retries through Chromium. On Windows and macOS that needs `CHROMIUM_EXECUTABLE_PATH` in its `.env`, pointing at an installed Chrome. `DORAR_FETCH_MODE=http` turns the retry off.

The Dart package [dorar_hadith](https://pub.dev/packages/dorar_hadith) reads the same site for Dart and Flutter apps. The importer doesn't use it because it runs on Node.js.

## Posting to Pinterest every day

[`.github/workflows/daily-pin.yml`](.github/workflows/daily-pin.yml) renders the day's card at 06:00 Paris time and sends it to [Make](https://www.make.com), which pins it to your board. Make uses its own approved Pinterest connection, so you don't need a Pinterest developer app. The Pin's description is the hadith, its reference, narrator and الفائدة. It all runs in the cloud, so your computer can be off.

Each day the workflow publishes the card on the `daily-pin` branch of this repository. That branch only ever holds the latest card, and it gives the image the public address Pinterest needs to fetch it.

`npm run render` renders the card on your own computer, into `out/`. It uses your installed Chrome or Edge.

### 1. Create the Make scenario

1. Sign up at [make.com](https://www.make.com). The free plan is enough: each day uses a few operations.
2. Create a scenario. Its first module is **Webhooks → Custom webhook**. Add a webhook and copy its address.
3. Store the address as a secret of this repository. This needs the [GitHub CLI](https://cli.github.com), signed in with `gh auth login`:

   ```bash
   gh secret set MAKE_WEBHOOK_URL
   ```

### 2. Show Make what the job sends

The schedule only runs from the default branch, so merge the workflow into `main` first.

1. In the webhook module, choose to redetermine the data structure, so Make waits for a sample.
2. Run the workflow once:

   ```bash
   gh workflow run daily-pin.yml
   ```

Make then knows these fields: `title`, `description`, `alt_text`, `link`, `image_url`, plus `id` and `date`.

### 3. Pin it

1. Add **Pinterest → Create a Pin** after the webhook. Connect your Pinterest account and choose the board.
2. Map the webhook's `title`, `description`, `link` and `alt_text` to the Pin fields with the same names. Map `image_url` to the Pin's image address.
3. Optional: add **Webhooks → Webhook response** after it, with the body `{"id": "…"}` holding the new Pin's id. The job's log then shows each Pin's address. Without it, Make answers "Accepted" and the job can't confirm the Pin.
4. Save the scenario and switch it on, set to run as soon as data arrives.

The sample run counted as today's post, so send today's card again:

```bash
gh workflow run daily-pin.yml -f force=true
```

### Optional settings

Set these as repository variables with `gh variable set <name> --body "<value>"`.

| Variable | Effect |
| --- | --- |
| `PIN_LINK` | Address the Pin links to. The hadith id is added as `#id`. |
| `CAPTION_FOOTER` | Text after the description, such as hashtags. |
| `CARD_CREDIT` | Replaces the credit line at the bottom of the card. |
| `CARD_SHOW_DATE` | `true` prints the Hijri date on the card. It is left off by default because a Pin keeps circulating for months. |

### Good to know

- A second run on the same day doesn't send the same card twice. Run the workflow with `force` to send it again.
- Each run keeps the card and the Pin text for 14 days as an artifact.
- If Make answers "Accepted" but no Pin appears, the scenario is probably off. Make queues the data until you switch it on. Check the scenario's history in Make.
- GitHub can start scheduled runs a few minutes late when it is busy.
- GitHub turns off scheduled workflows in a public repository after 60 days without activity. It emails you first, and you can turn it back on from the Actions tab.
- The card holds 881 hadiths, so the daily Pin doesn't repeat for about two and a half years. Add more with `npm run dorar`.

### Posting through Pinterest's API instead

If Pinterest later approves a developer app, `npm run pinterest:auth` signs in once and `npm run post` pins through Pinterest's API directly. The settings are listed at the top of [tools/post-daily.mjs](tools/post-daily.mjs). The workflow would then need to call that script instead of the Make steps.

## Running the App

Open `index.html` directly in a browser, or use the live site. GitHub Pages publishes the main branch at <https://ahmedtrad.github.io/Islamic-image-generator/> and updates it after every push.

## Internet Requirements

| Resource | Required? |
|---|---|
| Tailwind CSS | 🌐 CDN |
| Arabic fonts (Amiri, Readex Pro) | 🌐 Google Fonts |
| Chrome or Edge (`npm run render`, `npm run post`) | 💻 Installed browser |
