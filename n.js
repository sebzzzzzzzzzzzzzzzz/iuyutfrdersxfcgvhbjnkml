const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const { createCanvas, registerFont } = require('canvas');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3005;

// Register font
registerFont(path.join(__dirname, 'georgia.ttf'), { family: 'Georgia' });

// CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Headers
const defaultHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Referer': 'https://novlove.com/',
  'Connection': 'keep-alive',
};

// Helper URLs
const LIST_URL = 'https://novlove.com/sort/nov-love-popular?page=';
const SEARCH_URL = 'https://novlove.com/search?keyword=';

async function fetchHTML(url) {
  const { data } = await axios.get(url, { headers: defaultHeaders });
  return cheerio.load(data);
}

async function getNovelList(page = 1, query) {
  const fullUrl = query ? `${SEARCH_URL}${encodeURIComponent(query)}&page=${page}` : `${LIST_URL}${page}`;
  const $ = await fetchHTML(fullUrl);
  const novels = [];

  $('h3.novel-title a').each((i, el) => {
    const title = $(el).text().trim();
    const url = $(el).attr('href');
    if (title && url) novels.push({ title, url });
  });

  return novels;
}

async function fetchNovelDetails(novelUrl) {
  try {
    const { data } = await axios.get(novelUrl, { headers: defaultHeaders });
    const $ = cheerio.load(data);

    const title = $('h3.title').first().text().trim();
    const rating = $('#rateVal').attr('value') || null;
    const cover = $('img.lazy').first().attr('data-src') || $('img.lazy').first().attr('src') || null;
    const author = $('.info-meta li:has(h3:contains("Author")) a').text().trim();
    const genres = $('.info-meta li:has(h3:contains("Genre")) a').map((i, el) => $(el).text().trim()).get();
    const status = $('.info-meta li:has(h3:contains("Status")) a').text().trim();
    const tags = $('.tag-container a').map((i, el) => $(el).text().trim()).get();

    let description = $('.desc-text[itemprop="description"]').text().replace(/\s*\n\s*/g, '\n').replace(/\n{2,}/g, '\n\n').trim();
    if (!description) {
      description = $('#tab-description-title').text().replace(/\s*\n\s*/g, '\n').replace(/\n{2,}/g, '\n\n').trim();
    }

    return { title, rating, author, cover, genres, status, tags, description, url: novelUrl };
  } catch (err) {
    console.error('Fetch novel details error:', err.message);
    return null;
  }
}

const imageCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function setCache(key, value) {
  imageCache.set(key, {
    value,
    expiry: Date.now() + CACHE_TTL,
  });
}

function getCache(key) {
  const cached = imageCache.get(key);
  if (!cached) return null;
  if (Date.now() > cached.expiry) {
    imageCache.delete(key);
    return null;
  }
  return cached.value;
}


app.get('/api/popular', async (req, res) => {
  const page = req.query.page || 1;
  try {
    const novels = await getNovelList(page);
    const novelsWithDetails = await Promise.all(novels.map(async (novel) => {
      const details = await fetchNovelDetails(novel.url);
      return { ...novel, ...details };
    }));
    res.json({ page: Number(page), novels: novelsWithDetails });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch popular novels' });
  }
});

app.get('/api/search', async (req, res) => {
  const word = req.query.q;
  const page = req.query.page || 1;
  try {
    const novels = await getNovelList(page, word);
    const novelsWithDetails = await Promise.all(novels.map(async (novel) => {
      const details = await fetchNovelDetails(novel.url);
      return { ...novel, ...details };
    }));
    res.json({ page: Number(page), novels: novelsWithDetails });
  } catch (err) {
    res.status(500).json({ error: `Failed to search novels for "${word}"` });
  }
});

async function getFullChapterList(novelId) {
  try {
    const { data } = await axios.get(`https://novlove.com/ajax/chapter-archive?novelId=${novelId}`, { headers: defaultHeaders });
    const $ = cheerio.load(data);
    const chapters = [];

    $('ul.list-chapter li a').each((i, el) => {
      const fullText = $(el).text().trim();
      const match = fullText.match(/^Chapter\s+(\d+)/i);
      const chapter = match ? match[1] : null;
      const url = $(el).attr('href') || '';
      chapters.push({ chapter, url });
    });

    return chapters;
  } catch (err) {
    console.error('Error fetching chapters:', err.message);
    return [];
  }
}

app.get('/api/novel/:slug', async (req, res) => {
  const slug = req.params.slug;
  const novelUrl = `https://novlove.com/novel/${slug}`;
  try {
    const details = await fetchNovelDetails(novelUrl);
    const chapters = await getFullChapterList(slug);
    if (!details) return res.status(404).json({ error: 'Novel not found' });
    res.json({ ...details, chapters });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch novel' });
  }
});

async function fetchChapterContent(chapterUrl) {
  try {
    const { data } = await axios.get(chapterUrl, { headers: defaultHeaders });
    const $ = cheerio.load(data);
    $('.unlock-buttons').remove();

    const title = $('.novel-title').text().trim();
    const paragraphs = [];

    $('p').each((i, el) => {
      const text = $(el).text().trim();
      if (
        text.startsWith('Source:') ||
        text.includes('Total Responses') ||
        text === '' ||
        text === '\u00A0'
      ) return;
      paragraphs.push(`<p>${text}</p>`);
    });

    return { title, content: paragraphs.join('') };
  } catch (err) {
    console.error(`Failed to fetch chapter content from ${chapterUrl}:`, err.message);
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
    if (!content) return res.status(404).json({ error: 'Chapter content not found' });

    res.json({
      title: content.title,
      slug: slug,
      img: `${protocol}://${host}/api/img/${slug}/${chapter}`,
      chapter: chapter,
      url: chapterUrl,
      content: content.content,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch chapter' });
  }
});

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

app.get('/api/img/:slug/:chapterNum', async (req, res) => {
  const { slug, chapterNum } = req.params;
  const page = parseInt(req.query.page || '1', 10);
  const apiUrl = `${req.protocol}://${req.get('host')}/api/novel/${slug}/${chapterNum}`;
  const cacheKey = `${slug}-${chapterNum}-page${page}`;

  const cached = getCache(cacheKey);
  if (cached) {
    res.set('Content-Type', 'image/jpeg');
    res.set('X-Cache', 'HIT');
    return res.send(cached);
  }

  try {
    const { data } = await axios.get(apiUrl);
    const paragraphs = stripHtmlTagsExceptP(data.content);

    const dpr = 2;
    const width = 390;
    const padding = 30;
    const fontSize = 20;
    const lineHeight = fontSize * 1.6;
    const maxWidth = width - padding * 2;
    const linesPerPage = 100;

    const height = 1800;
    const canvas = createCanvas(width * dpr, height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#000000';
    ctx.font = `${fontSize}px Georgia`;
    ctx.textBaseline = 'top';

    let allLines = [];
    for (const para of paragraphs) {
      const words = para.split(' ');
      let line = '';
      for (let word of words) {
        const testLine = line + (line ? ' ' : '') + word;
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && line) {
          allLines.push(line);
          line = word;
        } else {
          line = testLine;
        }
      }
      if (line) allLines.push(line);
      allLines.push('');
    }

    const maxPages = Math.ceil(allLines.length / linesPerPage);
    if (page > maxPages) {
      return res.status(404).json({ error: 'Page out of range' });
    }

    const pageLines = allLines.slice((page - 1) * linesPerPage, page * linesPerPage);
    let y = padding;
    for (let line of pageLines) {
      ctx.fillText(line, padding, y);
      y += lineHeight;
    }

    const jpegBuffer = canvas.toBuffer('image/jpeg', { quality: 0.85 });
    setCache(cacheKey, jpegBuffer);

    res.set('Content-Type', 'image/jpeg');
    res.set('X-Max-Pages', maxPages);
    res.set('X-Cache', 'MISS');
    res.send(jpegBuffer);
  } catch (err) {
    console.error('Image generation failed:', err.message);
    res.status(500).send('Internal server error');
  }
});


app.get('/', (req, res) => {
  res.send('📖 Novel API is running.');
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
  console.log(`✅ Server listening on port ${PORT}`);
});
