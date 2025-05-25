const express = require('express');
const { createCanvas } = require('canvas');
const app = express();

const PORT = process.env.PORT || 3000;

app.get('/api/html-to-image', async (req, res) => {
  try {
    const html = req.query.html;
    if (!html) return res.status(400).send('Missing html query parameter');

    // Strip HTML tags for plain text
    const plainText = html.replace(/<\/?[^>]+(>|$)/g, '').replace(/\s+/g, ' ').trim();

    const width = 390 * 3;
    const maxHeight = 5000 * 3;
    const canvas = createCanvas(width, maxHeight);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, maxHeight);

    ctx.fillStyle = '#000';
    ctx.font = 'bold 54px sans-serif';
    ctx.textBaseline = 'top';

    const lineHeight = 60;
    const maxWidth = width - 40;
    const words = plainText.split(' ');
    let line = '';
    let y = 20;

    for (let n = 0; n < words.length; n++) {
      const testLine = line + words[n] + ' ';
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && n > 0) {
        ctx.fillText(line, 20, y);
        line = words[n] + ' ';
        y += lineHeight;
        if (y > maxHeight - lineHeight) break;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, 20, y);

    const actualHeight = y + lineHeight + 20;
    const croppedCanvas = createCanvas(width, actualHeight);
    const croppedCtx = croppedCanvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, width, actualHeight);
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
