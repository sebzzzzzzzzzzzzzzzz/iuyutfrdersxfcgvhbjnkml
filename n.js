const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

const defaultHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Referer': 'https://novlove.com/',
  'Connection': 'keep-alive',
};

const BASE_URL = 'https://novlove.com';
const LIST_URL = `${BASE_URL}/sort/nov-love-popular?page=`;
const SEARCH_URL = `${BASE_URL}/search?keyword=`;

// Utility to fetch HTML and parse with Cheerio
async function fetchHTML(url) {
  const { data } = await axios.get(url, { headers: defaultHeaders });
  return cheerio.load(data);
}

async function getNovelList(page = 1, query) {
  const url = query ? `${SEARCH_URL}${encodeURIComponent(query)}&page=${page}` : `${LIST_URL}${page}`;
  const $ = await fetchHTML(url);
  return $('h3.novel-title a').map((i, el) => ({
    title: $(el).text().trim(),
    url: $(el).attr('href'),
  })).get();
}

async function fetchNovelDetails(novelUrl) {
  try {
    const { data } = await axios.get(novelUrl, { headers: defaultHeaders });
    const $ = cheerio.load(data);

    const title = $('h3.title').first().text().trim();
    const rating = $('#rateVal').attr('value') || null;
    const cover = $('img.lazy').first().attr('data-src') || $('img.lazy').first().attr('src');
    const author = $('.info-meta li:has(h3:contains("Author")) a').text().trim();
    const genres = $('.info-meta li:has(h3:contains("Genre")) a').map((i, el) => $(el).text().trim()).get();
    const status = $('.info-meta li:has(h3:contains("Status")) a').text().trim();
    const tags = $('.tag-container a').map((i, el) => $(el).text().trim()).get();

    let description = $('.desc-text[itemprop="description"]').text().trim() ||
      $('#tab-description-title').text().trim();

    return { title, rating, author, cover, genres, status, tags, description, url: novelUrl };
  } catch (error) {
    console.error(`Error fetching novel details: ${error.message}`);
    return null;
  }
}

async function getFullChapterList(slug) {
  const ajaxUrl = `${BASE_URL}/ajax/chapter-archive?novelId=${slug}`;
  try {
    const { data } = await axios.get(ajaxUrl, { headers: defaultHeaders });
    const $ = cheerio.load(data);

    return $('ul.list-chapter li a').map((i, el) => {
      const text = $(el).text().trim();
      const match = text.match(/^Chapter\s+(\d+)/i);
      return { chapter: match?.[1] || null, url: $(el).attr('href') };
    }).get();
  } catch (err) {
    console.error('Error fetching chapters:', err.message);
    return [];
  }
}

async function fetchChapterContent(chapterUrl) {
  try {
    const { data } = await axios.get(chapterUrl, { headers: defaultHeaders });
    const $ = cheerio.load(data);
    $('.unlock-buttons').remove();

    const title = $('.novel-title').text().trim();
    const paragraphs = $('p').map((i, el) => {
      const text = $(el).text().trim();
      if (!text || text.includes('Total Responses') || text.startsWith('Source:')) return null;
      return $.html(el).trim();
    }).get().filter(Boolean);

    return { title, content: paragraphs.join('') };
  } catch (error) {
    console.error(`Error fetching chapter: ${error.message}`);
    return null;
  }
}

app.get('/api/popular', async (req, res) => {
  const page = req.query.page || 1;
  try {
    const novels = await getNovelList(page);
    const enriched = await Promise.all(novels.map(async (novel) => {
      const details = await fetchNovelDetails(novel.url);
      return details ? {
        ...novel,
        author: details.author,
        cover: details.cover,
        status: details.status,
        genres: details.genres,
        description: details.description,
      } : novel;
    }));
    res.json({ page: Number(page), novels: enriched });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch popular novels' });
  }
});

app.get('/api/search', async (req, res) => {
  const word = req.query.q;
  const page = req.query.page || 1;
  if (!word) return res.status(400).json({ error: 'Missing search query' });

  try {
    const novels = await getNovelList(page, word);
    const enriched = await Promise.all(novels.map(async (novel) => {
      const details = await fetchNovelDetails(novel.url);
      return details ? {
        ...novel,
        author: details.author,
        cover: details.cover,
        status: details.status,
        genres: details.genres,
        description: details.description,
      } : novel;
    }));
    res.json({ page: Number(page), novels: enriched });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Search failed' });
  }
});

app.get('/api/novel/:slug', async (req, res) => {
  const { slug } = req.params;
  const novelUrl = `${BASE_URL}/novel/${slug}`;
  try {
    const details = await fetchNovelDetails(novelUrl);
    if (!details) return res.status(404).json({ error: 'Novel not found' });
    const chapters = await getFullChapterList(slug);
    res.json({ ...details, chapters });
  } catch (error) {
    console.error(`Error fetching novel ${slug}:`, error.message);
    res.status(500).json({ error: 'Failed to fetch novel' });
  }
});

app.get('/api/novel/:slug/:chapter', async (req, res) => {
  const { slug, chapter } = req.params;
  const chapterUrl = `${BASE_URL}/novel/${slug}/chapter-${chapter}`;
  try {
    const content = await fetchChapterContent(chapterUrl);
    if (!content) return res.status(404).json({ error: 'Chapter not found' });

    const imgUrl = `${req.protocol}://${req.get('host')}/api/img/${slug}/${chapter}`;
    res.json({ title: content.title, slug, chapter, url: chapterUrl, content: content.content, img: imgUrl });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch chapter content' });
  }
});

app.get('/api/img/:slug/:chapterNum', async (req, res) => {
  const { slug, chapterNum } = req.params;
  const chapterApiUrl = `${req.protocol}://${req.get('host')}/api/novel/${slug}/${chapterNum}`;

  try {
    const apiResponse = await fetch(chapterApiUrl);
    if (!apiResponse.ok) return res.status(apiResponse.status).send('Error fetching chapter data');
    const data = await apiResponse.json();

    if (!data?.content) return res.status(400).send('No content available');

    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 1000, deviceScaleFactor: 3 });

    await page.setContent(`
      <html>
        <head><style>
          body { font-size: 18px; padding: 20px; line-height: 1.6; font-family: sans-serif; }
        </style></head>
        <body>${data.content}</body>
      </html>
    `, { waitUntil: 'networkidle0' });

    const bodyHandle = await page.$('body');
    const box = await bodyHandle.boundingBox();
    await bodyHandle.dispose();

    const height = Math.ceil(box.height) + 30;
    await page.setViewport({ width: 390, height, deviceScaleFactor: 3 });

    const buffer = await page.screenshot({ fullPage: true });
    await browser.close();

    res.set('Content-Type', 'image/png');
    res.send(buffer);
  } catch (err) {
    console.error(`Image generation failed: ${err.message}`);
    res.status(500).send('Internal server error');
  }
});

app.get('/', (req, res) => {
  res.send('Novel API is running.');
});

app.get('/api', (req, res) => {
  res.json({
    message: 'Welcome to the Novel API',
    endpoints: {
      popular: '/api/popular?page=1',
      search: '/api/search?q=keyword&page=1',
      novelDetails: '/api/novel/:slug',
      chapterContent: '/api/novel/:slug/:chapter',
      img: '/api/img/:slug/:chapterNum',
    },
  });
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
