/* ─── Islamic Palette Template Studio — React App ─── */

const { useState } = React;

/* ── Swatch color picker ── */
function Swatch({ label, value, onChange }) {
    return (
        <label className="group flex items-center gap-3 rounded-2xl border border-black/10 bg-white/55 p-3 shadow-sm backdrop-blur-sm transition hover:shadow-md">
            <input
                type="color"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="h-10 w-10 cursor-pointer rounded-lg border border-black/10 bg-transparent p-0"
                aria-label={label}
            />
            <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-600">{label}</div>
                <div className="mt-1 font-mono text-sm text-stone-800">{value}</div>
            </div>
        </label>
    );
}

/* ── Text-to-Image generator section ── */
function TextToImageGenerator() {
    const [cfg, setCfg] = useState(window.defaultTextToImg);
    const update = (key) => (val) => setCfg((c) => ({ ...c, [key]: val }));

    return (
        <section className="mb-6 overflow-hidden rounded-[2rem] border border-black/10 bg-white/55 shadow-sm backdrop-blur-md">
            {/* Header */}
            <div className="border-b border-black/10 px-6 py-4">
                <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-stone-600">
                    <span>◈</span> Text to Image Generator
                </div>
                <p className="mt-1 text-xs text-stone-500">
                    Type your text, choose colours, then download as a high-resolution PNG (1200 × 800).
                </p>
            </div>

            <div className="grid lg:grid-cols-[300px_minmax(0,1fr)]">
                {/* ── Controls ── */}
                <div className="space-y-4 border-b border-black/10 p-6 lg:border-b-0 lg:border-r">
                    {/* Narrator */}
                    <div>
                        <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-stone-600">Narrator</label>
                        <input
                            type="text"
                            value={cfg.narrator}
                            onChange={(e) => setCfg((c) => ({ ...c, narrator: e.target.value }))}
                            dir="auto"
                            className="w-full rounded-2xl border border-black/10 bg-white/80 px-4 py-3 text-sm outline-none focus:ring-2"
                            placeholder="rasulullah (ﷺ)"
                        />
                    </div>

                    {/* Text */}
                    <div>
                        <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-stone-600">Text</label>
                        <textarea
                            value={cfg.text}
                            onChange={(e) => setCfg((c) => ({ ...c, text: e.target.value }))}
                            rows={4} dir="auto"
                            className="w-full rounded-2xl border border-black/10 bg-white/80 px-4 py-3 text-xl leading-relaxed outline-none focus:ring-2"
                            placeholder="Type your text…"
                        />
                    </div>

                    {/* Source */}
                    <div>
                        <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-stone-600">Source</label>
                        <input
                            type="text"
                            value={cfg.source}
                            onChange={(e) => setCfg((c) => ({ ...c, source: e.target.value }))}
                            dir="auto"
                            className="w-full rounded-2xl border border-black/10 bg-white/80 px-4 py-3 text-sm outline-none focus:ring-2"
                            placeholder="e.g. — رواه البخاري"
                        />
                    </div>

                    {/* Colour swatches */}
                    <div className="grid grid-cols-2 gap-3">
                        <Swatch label="Font Color"  value={cfg.fontColor}   onChange={update('fontColor')} />
                        <Swatch label="Background"  value={cfg.bgColor}     onChange={update('bgColor')} />
                        <Swatch label="Border"      value={cfg.borderColor} onChange={update('borderColor')} />
                        <Swatch label="Accent"      value={cfg.accentColor} onChange={update('accentColor')} />
                    </div>

                    {/* Font size */}
                    <div>
                        <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-stone-600">
                            Font Size — <span className="font-mono normal-case">{cfg.fontSize}px</span>
                        </label>
                        <input type="range" min={24} max={120} step={2} value={cfg.fontSize}
                            onChange={(e) => setCfg((c) => ({ ...c, fontSize: Number(e.target.value) }))}
                            className="w-full" />
                    </div>

                    {/* Font family */}
                    <div>
                        <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-stone-600">Font Family</label>
                        <select value={cfg.fontFamily} onChange={(e) => setCfg((c) => ({ ...c, fontFamily: e.target.value }))}
                            className="w-full rounded-2xl border border-black/10 bg-white/80 px-4 py-2.5 outline-none">
                            <option value="Georgia, serif">Georgia (Serif)</option>
                            <option value="'Times New Roman', serif">Times New Roman</option>
                            <option value="Amiri, serif">Amiri (Arabic)</option>
                            <option value="'Scheherazade New', serif">Scheherazade New (Arabic)</option>
                            <option value="'Noto Naskh Arabic', serif">Noto Naskh Arabic</option>
                            <option value="cursive">Cursive</option>
                        </select>
                    </div>

                    {/* Text direction */}
                    <div>
                        <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-stone-600">Text Direction</label>
                        <div className="flex gap-3">
                            {[['rtl', '← RTL (Arabic)'], ['ltr', 'LTR (Latin) →']].map(([dir, label]) => (
                                <button key={dir} onClick={() => setCfg((c) => ({ ...c, direction: dir }))}
                                    className={`flex-1 rounded-2xl border px-3 py-2 text-xs font-medium transition ${cfg.direction === dir ? 'border-[#B9964B] bg-[#F4E8C9] shadow-sm' : 'border-black/10 bg-white/70 hover:shadow-sm'}`}>
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Download button */}
                    <button
                        onClick={() => window.downloadTextImage(cfg)}
                        className="w-full rounded-2xl px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:scale-[1.02] active:scale-100"
                        style={{ background: `linear-gradient(135deg, ${cfg.borderColor}, ${cfg.accentColor})` }}>
                        ⬇ Download PNG
                    </button>
                </div>

                {/* ── Live Preview ── */}
                <div className="flex items-center justify-center p-6">
                    <div className="relative w-full overflow-hidden rounded-[1.4rem] p-[7px] shadow-[0_16px_40px_rgba(34,19,15,0.18)]"
                        style={{ background: `linear-gradient(135deg, ${cfg.borderColor}, ${cfg.accentColor})` }}>
                        <div className="relative flex min-h-[340px] items-center justify-center overflow-hidden rounded-[1rem]"
                            style={{ background: cfg.bgColor }}>
                            {/* Dot texture */}
                            <div className="absolute inset-0 opacity-50"
                                style={{ backgroundImage: 'radial-gradient(rgba(34,19,15,0.06) 0.7px, transparent 0.7px)', backgroundSize: '18px 18px' }} />
                            {/* Gradient overlay */}
                            <div className="absolute inset-0"
                                style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.22), rgba(0,0,0,0))' }} />
                            {/* Inner borders */}
                            <div className="absolute inset-4 rounded-[0.75rem] border-2 border-black/10" />
                            <div className="absolute inset-7 rounded-[0.5rem] border border-black/[0.06]" />
                            {/* Corner ornaments */}
                            {[['left-2 top-2', cfg.accentColor], ['right-2 top-2', cfg.borderColor], ['bottom-2 left-2', cfg.borderColor], ['bottom-2 right-2', cfg.accentColor]].map(([pos, color]) => (
                                <div key={pos} className={`absolute ${pos} h-14 w-14 rounded-[0.75rem] border-[5px] opacity-90`} style={{ borderColor: color }} />
                            ))}
                            {/* Main text (centred) */}
                            <div className="relative z-10 w-full flex flex-col items-center justify-center px-20 py-10" style={{ minHeight: '340px' }}>
                                <p className="max-w-full break-words text-center leading-relaxed"
                                    style={{
                                        color: cfg.fontColor,
                                        fontSize: `${Math.min(Math.round(cfg.fontSize * 0.65), 56)}px`,
                                        fontFamily: cfg.fontFamily,
                                        fontWeight: 'bold',
                                        direction: cfg.direction,
                                        whiteSpace: 'pre-wrap',
                                    }}>
                                    {cfg.text}
                                </p>
                            </div>
                            {/* Narrator — colored badge pinned to top */}
                            {cfg.narrator && (
                                <div className="absolute top-6 left-0 right-0 z-10 flex justify-center">
                                    <span className="rounded-xl px-5 py-1.5 text-sm font-bold text-white"
                                        style={{ backgroundColor: cfg.borderColor, fontFamily: cfg.fontFamily, direction: cfg.direction }}>
                                        {cfg.narrator}
                                    </span>
                                </div>
                            )}
                            {/* Source — small attribution pinned to bottom */}
                            {cfg.source && (
                                <p className="absolute bottom-6 left-0 right-0 z-10 text-center text-xs font-semibold"
                                    style={{ color: cfg.fontColor, fontFamily: cfg.fontFamily, direction: cfg.direction, opacity: 0.75 }}>
                                    {cfg.source}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}

/* ── Root App ── */
function App() {
    return (
        <div className="min-h-screen bg-[#f7f0dd] text-stone-900">
            <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">

                {/* Header */}
                <header className="mb-8 flex flex-col gap-4 rounded-[2rem] border border-black/10 bg-white/40 p-6 shadow-sm backdrop-blur-md lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <div className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-stone-600">
                            <span>✦</span> Arabic-inspired template studio
                        </div>
                        <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
                            Build elegant templates using the palette from your artwork.
                        </h1>
                        <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-600">
                            Swap colors, preview layouts, and use the same heritage-inspired palette for invitations, quote cards, certificates, or branding mockups.
                        </p>
                    </div>
                    <a href="index.html"
                        className="inline-flex items-center gap-2 self-start rounded-full border border-black/10 bg-white/70 px-4 py-2 text-sm font-semibold text-stone-700 shadow-sm transition hover:shadow-md lg:self-center">
                        ← Daily Hadith card · <span dir="rtl" lang="ar">حديث اليوم</span>
                    </a>
                </header>

                {/* Text to Image Generator */}
                <TextToImageGenerator />

            </main>
        </div>
    );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
