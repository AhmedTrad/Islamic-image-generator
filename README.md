# Islamic Image Generator

Daily Hadith cards from the hadith encyclopedia of [dorar.net](https://dorar.net/hadith), with a daily image post on a LinkedIn company Page.

Live site: <https://ahmedtrad.github.io/Islamic-image-generator/>

## Project Structure

```
islamic-image-generator/
├── index.html          # Main page: daily Hadith card and its hadith list (standalone, single file)
├── PRIVACY.md          # Privacy policy
├── package.json        # Node tooling: dorar.net importer, card renderer, social posting
├── .github/workflows/
│   └── daily-linkedin.yml      # Posts the day's card to a LinkedIn Page at 06:00 Paris time
├── tools/
│   ├── render-card.mjs         # Renders the card to a PNG in headless Chrome
│   ├── check-cards.mjs         # Checks that every hadith fits the card in both formats
│   ├── post-linkedin.mjs       # Uploads a PNG and publishes it through LinkedIn's API
│   ├── post-linkedin.test.mjs  # LinkedIn API request and failure tests
│   ├── post-make.mjs           # Prepares a Pin and sends it to Make (manual use)
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

## Posting to LinkedIn every day

[`.github/workflows/daily-linkedin.yml`](.github/workflows/daily-linkedin.yml) replaces the Pinterest schedule. It renders a square card at **06:00 Europe/Paris** (including daylight-saving changes), uploads the PNG directly to LinkedIn, waits for processing, and publishes a public image post on your **company/organization Page**. The caption contains the hadith, reference, narrator and any الفائدة. Your computer can be off; no Make webhook or public image host is needed.

The previous "Daily Hadith Pin" Action failed because `MAKE_WEBHOOK_URL` was not configured. The LinkedIn workflow does not use that secret.

### 1. Authorize LinkedIn Page posting

1. Create an app in the [LinkedIn Developer Portal](https://www.linkedin.com/developers/) and obtain access to the **Community Management API**. LinkedIn approval may be required; creating an app alone does not grant organization posting access.
2. Authorize a Page administrator through LinkedIn's OAuth flow with **`w_organization_social`** permission. A token with only `w_member_social` posts to a personal profile and is not sufficient. Use an administrator account that can also upload Page-owned images.
3. Find the Page's **numeric organization ID** in its admin URL, for example `12345678` in `https://www.linkedin.com/company/12345678/admin/`. Do not use the Page's public slug or your personal member ID.
4. Configure this repository (or use **Settings > Secrets and variables > Actions**):

   ```bash
   gh secret set LINKEDIN_ACCESS_TOKEN
   gh variable set LINKEDIN_ORGANIZATION_ID --body "12345678"
   ```

   The first command prompts for the token. Never put it in source code, a repository variable, a command-line argument, or chat.

Access tokens expire. This integration does **not** automatically refresh them: replace the secret after reauthorization when LinkedIn returns HTTP 401. Fully unattended long-term operation requires a LinkedIn-approved refresh-token setup. API versions also expire; the default is `202610`, and `LINKEDIN_API_VERSION` can select another supported `YYYYMM` version. See LinkedIn's [Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api) and [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api).

### 2. Deploy and test

Commit and push these changes to `main` to replace the old schedule; local edits do not change GitHub Actions. Scheduled workflows only run from the default branch. Allow Actions **read and write** repository contents permissions and allow the workflow to create/update the `daily-linkedin` state branch.

First render without posting or requiring any LinkedIn credentials:

```bash
npm run linkedin -- --dry-run
# Or, after pushing:
gh workflow run daily-linkedin.yml -f dry_run=true
```

Inspect the PNG and caption in `out/` locally or in the run's **hadith-linkedin** artifact. Then publish:

```bash
gh workflow run daily-linkedin.yml
```

The run summary and `linkedin-post.json` artifact contain the confirmed LinkedIn post URL. A local `npm run linkedin` also renders and publishes, but **does not use the workflow's duplicate guard**; prefer the workflow for daily posting. Local rendering requires Chrome or Edge and Node.js 22.12 or newer.

### Duplicate protection and failures

- The workflow saves the date and Page ID on the `daily-linkedin` branch, so another run on the same day skips an already confirmed post.
- Before calling LinkedIn, it records a **pending** attempt. If a timeout or interrupted run leaves the result uncertain, another same-day run stops instead of risking a duplicate. Check the Page and the previous run's artifacts first. If no post exists, retry with `gh workflow run daily-linkedin.yml -f force=true`. If the post exists, leave it alone; the next day's run can proceed normally.
- Do not delete the state branch or run with `force` unless another post is intended. Each update replaces its single-commit state, so the branch does not grow daily.
- Missing configuration fails before rendering. HTTP 401 means renew the token; HTTP 403 means check app permissions and Page role; HTTP 426 means select a supported API version. Captions longer than 3000 characters fail instead of truncating the hadith.
- Artifacts are retained for 14 days, including on failed posting attempts. API error bodies and access tokens are not printed.
- GitHub schedules can start late. Public-repository schedules are disabled after 60 days without activity; re-enable them in Actions if necessary.

### Optional repository variables

Set these with `gh variable set <name> --body "<value>"`.

| Variable | Effect |
| --- | --- |
| `LINKEDIN_API_VERSION` | Supported LinkedIn API version; default `202610`. |
| `CAPTION_FOOTER` | Text after the caption, such as hashtags; keep the whole caption within 3000 characters. |
| `CARD_CREDIT` | Replaces the credit line at the bottom of the card. |
| `CARD_SHOW_DATE` | `true` prints the Hijri date; off by default. |
| `CARD_FORMAT` | `square` (default, 1080 x 1080) or `landscape` (1200 x 900). |

### Manual Pinterest posting

The Pinterest tools remain available, but are no longer scheduled. For an approved Pinterest API app, `npm run pinterest:auth` signs in and `npm run post` publishes; settings are listed at the top of [tools/post-daily.mjs](tools/post-daily.mjs). For Make, [tools/post-make.mjs](tools/post-make.mjs) provides `prepare` and `send` commands; configure `MAKE_WEBHOOK_URL`, publish the PNG to an HTTPS address, and connect the webhook to Pinterest's "Create a Pin" module yourself.

## Running the App

Open `index.html` directly in a browser, or use the live site. GitHub Pages publishes the main branch at <https://ahmedtrad.github.io/Islamic-image-generator/> and updates it after every push.

## Internet Requirements

| Resource | Required? |
|---|---|
| Tailwind CSS | 🌐 CDN |
| Arabic fonts (Amiri, Readex Pro) | 🌐 Google Fonts |
| Chrome or Edge (`npm run render`, `npm run post`) | 💻 Installed browser |
