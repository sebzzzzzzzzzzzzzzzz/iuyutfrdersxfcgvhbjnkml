const express = require('express');
const { createCanvas, registerFont } = require('canvas');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Register Georgia font from local file (adjust path if needed)
registerFont(path.join(__dirname, 'georgia.ttf'), { family: 'Georgia' });

function stripHtmlTagsExceptP(html) {
  const regex = /<p>(.*?)<\/p>/gis;
  const paragraphs = [];
  let match;
  while ((match = regex.exec(html)) !== null) {
    const cleanText = match[1].replace(/<\/?[^>]+(>|$)/g, '').replace(/\s+/g, ' ').trim();
    if (cleanText.length > 0) paragraphs.push(cleanText);
  }
  return paragraphs;
}

app.get('/api/html-to-image', async (req, res) => {
  try {
    const html = req.query.html;
    if (!html) return res.status(400).send('Missing html query parameter');

    const paragraphs = stripHtmlTagsExceptP(html);

    const dpr = 3;              // Device Pixel Ratio for crisp rendering
    const width = 390;
    const padding = 30;
    const maxHeight = 10000;
    const maxWidth = width - padding * 2;
    const fontSize = 20;
    const lineHeight = fontSize * 1.6;

    // Create large canvas scaled by DPR
    const canvas = createCanvas(width * dpr, maxHeight * dpr);
    const ctx = canvas.getContext('2d');

    // Scale drawing ops for DPR
    ctx.scale(dpr, dpr);

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, maxHeight);

    // Font style
    ctx.fillStyle = '#000000';
    ctx.font = `${fontSize}px Georgia`;
    ctx.textBaseline = 'top';

    let y = padding;

    function drawWrappedText(text, x, y) {
      const words = text.split(' ');
      let line = '';
      let startY = y;

      for (let n = 0; n < words.length; n++) {
        const testLine = line + (line ? ' ' : '') + words[n];
        const metrics = ctx.measureText(testLine);

        if (metrics.width > maxWidth && line) {
          ctx.fillText(line, x, startY);
          startY += lineHeight;
          line = words[n];
        } else {
          line = testLine;
        }
      }
      if (line) {
        ctx.fillText(line, x, startY);
        startY += lineHeight;
      }
      return startY;
    }

    for (const para of paragraphs) {
      y = drawWrappedText(para, padding, y);
      y += lineHeight * 0.3;
      if (y > maxHeight - lineHeight) break;
    }

    const actualHeight = y + padding;

    // Create cropped canvas at DPR scale
    const croppedCanvas = createCanvas(width * dpr, actualHeight * dpr);
    const croppedCtx = croppedCanvas.getContext('2d');

    // Scale for DPR
    croppedCtx.scale(dpr, dpr);

    // Copy from original canvas to cropped canvas
    // getImageData / putImageData works at pixel level so no scaling here:
    const imgData = ctx.getImageData(0, 0, width * dpr, actualHeight * dpr);
    croppedCtx.putImageData(imgData, 0, 0);

    const buffer = croppedCanvas.toBuffer('image/png');
    res.set('Content-Type', 'image/png');
    res.send(buffer);

  } catch (err) {
    console.error('Image generation failed:', err);
    res.status(500).send('Internal server error');
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
