const axios = require('axios').default;
const cheerio = require('cheerio');
const tough = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

const cookieJar = new tough.CookieJar();
const client = wrapper(axios.create({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                  '(KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://novlove.com/',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Connection': 'keep-alive',
    'DNT': '1',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'sec-ch-ua': '"Chromium";v="115", "Not)A;Brand";v="8"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
  },
  jar: cookieJar,
  withCredentials: true,
}));

function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}

async function fetchHTML(url) {
  try {
    // Delay to avoid hammering server
    await delay(300 + Math.random() * 200);
    const response = await client.get(url);
    return cheerio.load(response.data);
  } catch (err) {
    console.error(`Failed to fetch ${url}: ${err.message}`);
    throw err;
  }
}

async function getNovelDetails(novelUrl) {
  const $ = await fetchHTML(novelUrl);

  // Example selectors, adjust if site layout changes:
  const title = $('h1.entry-title').text().trim();
  const cover = $('div.post-thumbnail img').attr('src') || null;
  const author = $('span[itemprop="author"]').text().trim();
  const summary = $('div.entry-content > p').first().text().trim();

  // Extract chapters list
  const chapters = [];
  $('ul.chapters-list li a').each((_, el) => {
    const chapterTitle = $(el).text().trim();
    const chapterUrl = $(el).attr('href');
    chapters.push({ title: chapterTitle, url: chapterUrl });
  });

  return { title, cover, author, summary, chapters };
}

async function getChapterContent(chapterUrl) {
  const $ = await fetchHTML(chapterUrl);

  // The chapter content container selector (adjust if necessary)
  const content = $('div.chapter-content').html();

  return content;
}

(async () => {
  try {
    const novelUrl = 'https://novlove.com/novel/example-novel'; // Replace with actual novel URL

    console.log('Fetching novel details...');
    const novelDetails = await getNovelDetails(novelUrl);
    console.log('Novel:', novelDetails.title);
    console.log('Author:', novelDetails.author);
    console.log('Summary:', novelDetails.summary);
    console.log(`Found ${novelDetails.chapters.length} chapters.`);

    if (novelDetails.chapters.length > 0) {
      console.log('Fetching first chapter content...');
      const firstChapter = novelDetails.chapters[0];
      const chapterContent = await getChapterContent(firstChapter.url);
      console.log(`Chapter: ${firstChapter.title}`);
      console.log(chapterContent.substring(0, 500)); // print first 500 chars of content
    }
  } catch (error) {
    console.error('Error:', error);
  }
})();
