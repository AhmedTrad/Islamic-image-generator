# Islamic Image Generator

Daily Hadith cards, plus an Arabic-inspired text-to-image studio with ornamental frames, calligraphy fonts, and live preview.

## Project Structure

```
islamic-image-generator/
├── index.html          # Main page: daily Hadith card (standalone, single file)
├── studio.html         # Text-to-image studio (React app)
├── package.json        # Node tooling for the dorar.net importer
├── tools/
│   ├── dorar.mjs           # CLI: search dorar.net, add hadiths to the card
│   ├── dorar-lib.mjs       # Page parsing, authenticity checks, card data block
│   └── dorar-lib.test.mjs  # Parser tests (npm test)
├── README.md
└── assets/             # Studio files
    ├── css/
    │   └── styles.css      # Custom styles (scrollbar, range, color inputs)
    ├── js/
    │   ├── app.js          # React components & app logic (JSX)
    │   ├── data.js         # App constants (palette, presets, default settings)
    │   └── utils.js        # Canvas utilities (text wrapping, image download)
    ├── lib/
    │   ├── babel.min.js    # In-browser JSX transform
    │   ├── react-dom.development.js
    │   └── react.development.js
    └── img/                # Place any image assets here
```

## Daily Hadith Card (`index.html`)

A self-contained page that renders a minimalist card for an authentic (صحيح) hadith and exports it as a PNG. It links to the studio for free-text cards.

- **Content:** 21 narrations from Sahih al-Bukhari, Sahih Muslim and Jami' at-Tirmidhi (graded حسن صحيح), each with full tashkeel, takhrij (collection and number, plus «واللفظ لـ…» where the two Sahihs differ), narrator, and a one-line benefit (الفائدة).
- **Categories:** العبادات والأركان · مكارم الأخلاق · الإيمان والإخلاص · الأذكار وفضائل الأعمال. The daily pick rotates through them by date, so consecutive days change theme.
- **Formats:** square 1080 × 1080 and landscape 1200 × 900. The matn font size is fitted automatically so long narrations never overflow.
- **Export:** "تنزيل الصورة" paints the laid-out card onto a canvas word by word, so Arabic shaping, tashkeel and the web fonts (Amiri, Readex Pro) match the preview.
- **Links:** each hadith has its own URL hash, e.g. `index.html#muslim-2594`.

The hadith list lives in the `<script id="hadith-data">` JSON block inside the page. Each entry has `id`, `cat`, `matn`, `source`, `refs`, `narrator` and `sharh`. Add entries by hand, or import them from dorar.net (below).

### Importing hadiths from dorar.net

`tools/dorar.mjs` searches [الموسوعة الحديثية on dorar.net](https://dorar.net/hadith) and adds results to the card. It needs Node.js 18.17 or newer.

```bash
npm install
```

```bash
npm run dorar -- search "إنما الأعمال بالنيات"
```

```bash
npm run dorar -- add 1 --cat iman
```

- **search** lists Dorar's results with the source book and number, the grading scholar, the grade and the narrator. ✓ marks a sahih hadith from one of the main collections (al-Bukhari, Muslim, Abu Dawud, at-Tirmidhi, an-Nasa'i, Ibn Majah, Riyad as-Salihin).
- **add** takes a result number from the last search, or a `dorar.net/h/…` link. It refuses weak or non-sahih hadiths unless you pass `--force`, and refuses hadiths already on the card. It fills `source`, `refs` and `narrator` from Dorar. It takes `sharh` from the «وفي الحديث» lessons in Dorar's explanation and credits it on the card as «من شرح الدرر السنية».
- `--dry-run` shows the entry without changing the page; `--cat` is one of `ibadat`, `akhlaq`, `iman`, `dhikr`.
- The tool warns when the matn isn't fully vocalized (Dorar's texts often aren't) or is very long. Read each new entry before publishing.
- It sends one request at a time with a pause between them and caches pages for a day in `tools/.cache/`. If dorar.net refuses a request (HTTP 403, common from cloud servers), the tool stops instead of trying to get around it. Run it from a normal home connection.

`npm test` runs the parser tests. Page structure follows the MIT-licensed [dorar-hadith-api](https://github.com/AhmedElTabarani/dorar-hadith-api).

## Running the App

The Hadith card (`index.html`) works when opened directly in a browser. The studio (`studio.html`) does not: Babel loads `assets/js/app.js` over HTTP, so serve the project through a local server to use both.

### Option 1 — Python (no install needed)

```bash
cd islamic-image-generator
python -m http.server 5500
```

Then open <http://localhost:5500> for the Hadith card, or <http://localhost:5500/studio.html> for the studio.

### Option 2 — VS Code Live Server extension

1. Install the **Live Server** extension in VS Code.  
2. Right-click `index.html` → **Open with Live Server**.

### Option 3 — Node.js `serve`

```bash
npx serve .
```

## Internet Requirements

| Resource | Required? |
|---|---|
| React, ReactDOM, Babel (studio) | ✅ Local (`assets/lib/`) |
| Tailwind CSS | 🌐 CDN |
| Arabic fonts (Amiri, Readex Pro, Scheherazade New, Noto Naskh Arabic) | 🌐 Google Fonts |
