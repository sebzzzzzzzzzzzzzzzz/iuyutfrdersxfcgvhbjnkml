const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const cors = require('cors');

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));


app.get('/:htmlContent', async (req, res) => {
  const { htmlContent} = req.params;

  try {

    const width = 390; // iPhone screen width
    const padding = 30; // extra space at bottom

    // Launch Puppeteer
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();

    await page.setViewport({
      width,
      height: 1000, // initial height
      deviceScaleFactor: 3,
    });

    // Set the HTML content
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    // Get the full height of the rendered content
    const bodyHandle = await page.$('body');
    const boundingBox = await bodyHandle.boundingBox();
    await bodyHandle.dispose();

    const fullHeight = Math.ceil(boundingBox.height) + padding;

    // Resize viewport to full content height
    await page.setViewport({
      width,
      height: fullHeight,
      deviceScaleFactor: 3,
    });

    // Take a screenshot of the full content
    const screenshotBuffer = await page.screenshot({
      clip: { x: 0, y: 0, width, height: fullHeight },
      type: 'png',
    });

    await browser.close();

    // Set response headers and send image
    res.set('Content-Type', 'image/png');
    res.send(screenshotBuffer);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error generating image');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
