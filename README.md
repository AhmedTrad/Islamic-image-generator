# Islamic Image Generator

Arabic-inspired text-to-image generator with ornamental frames, calligraphy fonts, and live preview.

## Project Structure

```
islamic-image-generator/
├── index.html          # Entry point
├── hadith-card.html    # Daily Hadith card generator (standalone, single file)
├── README.md
└── assets/
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

## Daily Hadith Card (`hadith-card.html`)

A self-contained page that renders a minimalist card for an authentic (صحيح) hadith and exports it as a PNG.

- **Content:** 21 narrations from Sahih al-Bukhari, Sahih Muslim and Jami' at-Tirmidhi (graded حسن صحيح), each with full tashkeel, takhrij (collection and number, plus «واللفظ لـ…» where the two Sahihs differ), narrator, and a one-line benefit (الفائدة).
- **Categories:** العبادات والأركان · مكارم الأخلاق · الإيمان والإخلاص · الأذكار وفضائل الأعمال. The daily pick rotates through them by date, so consecutive days change theme.
- **Formats:** square 1080 × 1080 and landscape 1200 × 900. The matn font size is fitted automatically so long narrations never overflow.
- **Export:** "تنزيل الصورة" paints the laid-out card onto a canvas word by word, so Arabic shaping, tashkeel and the web fonts (Amiri, Readex Pro) match the preview.
- **Links:** each hadith has its own URL hash, e.g. `hadith-card.html#muslim-2594`.

To add a hadith, append an entry to the `HADITHS` array in the page's script with `id`, `cat`, `matn`, `source`, `refs`, `narrator` and `sharh`.

Serve it the same way as the main app (below), then open <http://localhost:5500/hadith-card.html>.

## Running the App

> **Important:** Because Babel loads `assets/js/app.js` via HTTP, you must serve the project through a local server — opening `index.html` directly as a `file://` URL will not work.

### Option 1 — Python (no install needed)

```bash
cd islamic-image-generator
python -m http.server 5500
```

Then open <http://localhost:5500> in your browser.

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
| React, ReactDOM, Babel | ✅ Local (`assets/lib/`) |
| Tailwind CSS | 🌐 CDN |
| Arabic fonts (Amiri, Scheherazade New, Noto Naskh Arabic) | 🌐 Google Fonts |
