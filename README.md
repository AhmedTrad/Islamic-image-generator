# Islamic Image Generator

Arabic-inspired text-to-image generator with ornamental frames, calligraphy fonts, and live preview.

## Project Structure

```
islamic-image-generator/
├── index.html          # Entry point
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
