/* ─── Canvas Utilities ─── */

/**
 * Wraps text to fit within maxWidth on the given canvas context.
 * Respects '\n' line breaks.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxWidth
 * @returns {string[]}
 */
window.wrapCanvasText = function wrapCanvasText(ctx, text, maxWidth) {
    const lines = [];
    text.split('\n').forEach((para) => {
        if (!para.trim()) { lines.push(''); return; }
        const words = para.split(' ');
        let line = '';
        words.forEach((word) => {
            const test = line ? `${line} ${word}` : word;
            if (ctx.measureText(test).width > maxWidth && line) {
                lines.push(line);
                line = word;
            } else {
                line = test;
            }
        });
        if (line) lines.push(line);
    });
    return lines.length ? lines : [''];
};

/**
 * Draws a rounded rectangle path on the canvas context (does NOT stroke/fill).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r  corner radius
 */
window.drawRoundedRect = function drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);  ctx.arcTo(x + w, y,       x + w, y + r,     r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);  ctx.arcTo(x,     y + h,   x,     y + h - r, r);
    ctx.lineTo(x, y + r);      ctx.arcTo(x,     y,       x + r, y,          r);
    ctx.closePath();
};

/**
 * Generates a 1200×800 PNG canvas from the textToImg settings and triggers download.
 * @param {object} textToImg
 */
window.downloadTextImage = async function downloadTextImage(textToImg) {
    await document.fonts.ready;

    const W = 1200, H = 800;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    const { bgColor, fontColor, borderColor, accentColor, fontSize, fontFamily, text, direction, narrator, source } = textToImg;
    const drawRR = (x, y, w, h, r) => window.drawRoundedRect(ctx, x, y, w, h, r);

    // Background
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, W, H);
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, 'rgba(255,255,255,0.28)');
    bgGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Dot texture
    ctx.fillStyle = 'rgba(34,19,15,0.04)';
    for (let x = 9; x < W; x += 18) {
        for (let y = 9; y < H; y += 18) {
            ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI * 2); ctx.fill();
        }
    }

    // Outer border
    const pad = 28;
    ctx.strokeStyle = borderColor; ctx.lineWidth = 10;
    drawRR(pad, pad, W - pad * 2, H - pad * 2, 28); ctx.stroke();

    // Middle border
    const pad2 = 48;
    ctx.strokeStyle = accentColor; ctx.lineWidth = 3;
    drawRR(pad2, pad2, W - pad2 * 2, H - pad2 * 2, 20); ctx.stroke();

    // Inner border
    const pad3 = 60;
    ctx.strokeStyle = borderColor + '44'; ctx.lineWidth = 1.5;
    drawRR(pad3, pad3, W - pad3 * 2, H - pad3 * 2, 14); ctx.stroke();

    // Corner ornaments
    const cs = 90, cp = pad + 5;
    [[cp, cp], [W - cp - cs, cp], [cp, H - cp - cs], [W - cp - cs, H - cp - cs]].forEach(([x, y], i) => {
        ctx.strokeStyle = i % 2 === 0 ? accentColor : borderColor;
        ctx.lineWidth = 6; drawRR(x, y, cs, cs, 14); ctx.stroke();
    });

    // Main text
    const px = Math.min(fontSize, 120);
    ctx.font = `bold ${px}px ${fontFamily}`;
    ctx.fillStyle = fontColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction = direction;
    const maxW = W - pad3 * 2 - 60;
    const lines = window.wrapCanvasText(ctx, text, maxW);
    const lh = px * 1.45;
    const totalTextH = lines.length * lh;
    const startY = H / 2 - totalTextH / 2 + lh / 2;
    lines.forEach((line, i) => ctx.fillText(line, W / 2, startY + i * lh));

    // Narrator badge — colored rounded-rect pinned near top inner border
    if (narrator) {
        const narPx = Math.max(Math.round(px * 0.38), 18);
        ctx.font = `bold ${narPx}px ${fontFamily}`;
        ctx.direction = direction;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const narW = ctx.measureText(narrator).width + narPx * 2.4;
        const narH = narPx * 2.2;
        const narX = W / 2 - narW / 2;
        const narY = pad3 + 18;
        ctx.fillStyle = borderColor;
        drawRR(narX, narY, narW, narH, narH / 3); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillText(narrator, W / 2, narY + narH / 2);
    }

    // Source — small attribution pinned near bottom inner border
    if (source) {
        const srcPx = Math.max(Math.round(px * 0.32), 16);
        ctx.font = `${srcPx}px ${fontFamily}`;
        ctx.fillStyle = fontColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.direction = direction;
        ctx.globalAlpha = 0.75;
        ctx.fillText(source, W / 2, H - pad3 - srcPx);
        ctx.globalAlpha = 1;
    }

    const link = document.createElement('a');
    link.download = 'text-image.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
};
