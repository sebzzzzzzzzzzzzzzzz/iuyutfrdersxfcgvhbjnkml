const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');


const app = express();
const PORT = process.env.PORT || 3000;
const cors = require('cors');
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));


const LIST_URL = 'https://novlove.com/sort/nov-love-popular';
const SEARCH_URL = 'https://novlove.com/search?keyword=';
// Helper: fetch HTML from a URL
async function fetchHTML(url) {
  const { data } = await axios.get(url);
  return cheerio.load(data);
}

// Fetch list of novels (title + url)
async function getNovelList(page = 1, query) {
  if (!query) {
    fullUrl = LIST_URL + page;
  } else {
    fullUrl = SEARCH_URL + query + "&page=", page;
  }
  const novels = [];

  const $ = await fetchHTML(fullUrl);

  $('h3.novel-title a').each((i, el) => {
    const title = $(el).text().trim();
    const url = $(el).attr('href');
    if (title && url) {
      novels.push({ title, url });
    }
  });

  return novels;
}



async function fetchNovelDetails(novelUrl) {
  try {
    const { data } = await axios.get(novelUrl);
    const $ = cheerio.load(data);

    const title = $('h3.title').first().text().trim();
    const rating = $('#rateVal').attr('value') || null;
    const cover = $('img.lazy').first().attr('data-src') || $('img.lazy').first().attr('src') || null;
    const author = $('.info-meta li:has(h3:contains("Author")) a').text().trim();
    const genres = $('.info-meta li:has(h3:contains("Genre")) a')
      .map((i, el) => $(el).text().trim())
      .get();
    const status = $('.info-meta li:has(h3:contains("Status")) a').text().trim();
    const tags = $('.tag-container a')
      .map((i, el) => $(el).text().trim())
      .get();

    let description = $('.desc-text[itemprop="description"]').text()
        .replace(/\s*\n\s*/g, '\n')
        .replace(/\n{2,}/g, '\n\n')
        .trim();

    if (!description) {
      description = $('#tab-description-title')
        .text()
        .replace(/\s*\n\s*/g, '\n')
        .replace(/\n{2,}/g, '\n\n')
        .trim();
    }




    return {
      title,
      rating,
      author,
      cover,
      genres,
      status,
      tags,
      description,
      url: novelUrl
    };
  } catch (error) {
    console.error(`Failed to fetch novel details: ${error.message}`);
    return null;
  }
}


app.get('/api/popular', async (req, res) => {
  try {
    const page = req.query.page || 1;
    const novels = await getNovelList(page);

    // For each novel, get details by visiting its URL
    const novelsWithDetails = await Promise.all(
      novels.map(async (novel) => {
        try {
          const details = await fetchNovelDetails(novel.url);
          return {
            title: novel.title,
            url: novel.url,
            author: details.author,
            cover: details.cover,
            status: details.status,
            genres: details.genres,
            description: details.description,
          };
        } catch (err) {
          console.error(`Failed to fetch details for ${novel.url}:`, err.message);
          // Return basic info if details fail
          return { ...novel };
        }
      })
    );

    res.json({ page: Number(page), novels: novelsWithDetails });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch popular novels' });
  }
});



app.get('/api/search', async (req, res) => {
  try {
    const word = req.query.q
    const page = req.query.page || 1;
    const novels = await getNovelList(page, word);

    // For each novel, get details by visiting its URL
    const novelsWithDetails = await Promise.all(
      novels.map(async (novel) => {
        try {
          const details = await fetchNovelDetails(novel.url);
          return {
            title: novel.title,
            url: novel.url,
            author: details.author,
            cover: details.cover,
            status: details.status,
            genres: details.genres,
            description: details.description,
          };
        } catch (err) {
          console.error(`Failed to fetch details for ${novel.url}:`, err.message);
          // Return basic info if details fail
          return { ...novel };
        }
      })
    );

    res.json({ page: Number(page), novels: novelsWithDetails });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: `Failed to search ${word} novels` });
  }
});



async function getFullChapterList(novelId) {
  const ajaxUrl = `https://novlove.com/ajax/chapter-archive?novelId=${novelId}`;
  try {
    const { data } = await axios.get(ajaxUrl);

    const $ = cheerio.load(data);

    const chapters = [];

    $('ul.list-chapter li a').each((i, el) => {
      const fullText = $(el).text().trim();

      // Extract chapter number (e.g., "Chapter 12", "Chapter 12:")
      const chapterMatch = fullText.match(/^Chapter\s+(\d+)/i);
      const chapter = chapterMatch ? chapterMatch[1] : null;
      const url = $(el).attr('href') || '';
      chapters.push({ chapter, url});
    });

    return chapters;
  } catch (err) {
    console.error('Error fetching chapters:', err.message || err);
    return [];
  }
}

// Example: /api/novel/super-gene
app.get('/api/novel/:slug', async (req, res) => {
  const slug = req.params.slug;
  const novelUrl = `https://novlove.com/novel/${slug}`;

  try {
    const details = await fetchNovelDetails(novelUrl);
    const chapters = await getFullChapterList(slug);

    if (!details) {
      return res.status(404).json({ error: 'Novel not found or failed to fetch details' });
    }

    res.json({ ...details, chapters });
  } catch (error) {
    console.error(`Failed to fetch novel at ${novelUrl}:`, error.message);
    res.status(500).json({ error: 'Internal server error while fetching novel details' });
  }
});


async function fetchChapterContent(chapterUrl) {
  try {
    const { data } = await axios.get(chapterUrl);
    const $ = cheerio.load(data);
    $('.unlock-buttons').remove();

    const paragraphs = [];

    const title = $('.novel-title').text().trim(); // Extract title text

    $('p').each((i, el) => {
      let html = $.html(el).trim();
      html = html.replace(/(\n)?<\/p>/g, '</p>');
      const text = $(el).text().trim();

      // Skip unwanted paragraphs
      if (
        text.startsWith('Source:') ||
        text.includes('Total Responses') ||
        text === '' ||
        text === '\u00A0' // non-breaking space
      ) {
        return;
      }

      paragraphs.push(html);
    });

    return {
      title,
      content: paragraphs.join(''), // remove \n and just concatenate
    };
  } catch (error) {
    console.error(`Failed to fetch chapter content from ${chapterUrl}:`, error.message);
    return null;
  }
}






app.get('/api/novel/:slug/:chapter', async (req, res) => {
  const { slug, chapter } = req.params;
  const chapterUrl = `https://novlove.com/novel/${slug}/chapter-${chapter}`;
  const protocol = req.protocol;
  const host = req.get('host');
  try {
    const content = await fetchChapterContent(chapterUrl);
    if (!content) {
      return res.status(404).json({ error: 'Chapter content not found' });
    }

    res.json({
      title: content.title,
      slug: slug,
      img: `${protocol}://${host}/api/img/${slug}/${chapter}`,
      chapter: `${chapter}`,
      url: chapterUrl,
      content: content.content,
    });

  } catch (error) {
    console.error(`Failed to fetch chapter ${slug}/${chapter}:`, error.message);
    res.status(500).json({ error: 'Failed to fetch chapter content' });
  }
});

app.get('/api/img/:slug/:chapterNum', async (req, res) => {
  const { slug, chapterNum } = req.params;


  const protocol = req.protocol;
  const host = req.get('host');

  const apiUrl = `${protocol}://${host}/api/novel/${slug}/${chapterNum}`;


  try {
    const apiResponse = await fetch(apiUrl);
    if (!apiResponse.ok) {
      return res.status(apiResponse.status).send('Error fetching novel data');
    }

    const novelData = await apiResponse.json();
    const htmlContent = novelData.content;

    if (!htmlContent || htmlContent.trim() === '') {
      return res.status(400).send('No content available');
    }

    const width = 390;
    const padding = 30;

    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();

    await page.setViewport({ width, height: 1000, deviceScaleFactor: 3 });

    await page.setContent(`
      <html>
        <head><style>body { font-size: 18px; padding: 20px; }</style></head>
        <body>${htmlContent}</body>
      </html>
    `, { waitUntil: 'networkidle0' });

    const bodyHandle = await page.$('body');
    const boundingBox = await bodyHandle.boundingBox();
    await bodyHandle.dispose();

    const fullHeight = Math.ceil(boundingBox.height) + padding;

    await page.setViewport({ width, height: fullHeight, deviceScaleFactor: 3 });

    const screenshotBuffer = await page.screenshot({ fullPage: true });
    await browser.close();

    res.set('Content-Type', 'image/png');
    res.send(screenshotBuffer);
  } catch (err) {
    console.error(`Error generating image: ${err.message}`);
    res.status(500).send('Internal server error');
  }
});


app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
