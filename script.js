// --- Configuration: Real RSS Feeds ---
const PROXY_BASE = "https://api.allorigins.win/get?url=";
const API_BASE = "http://localhost:3000/api"; // Backend API base URL

const CHANNELS = [
    { name: "RT (Russian)", url: "https://russian.rt.com/rss" },
    { name: "Channel One", url: "https://www.1tv.ru/rss/" },
    { name: "Vesti", url: "https://www.vesti.ru/vesti.rss" },
    { name: "NTV", url: "https://www.ntv.ru/export/news.xml" },
    { name: "Ren TV", url: "https://ren.tv/rss" },
    { name: "Zvezda", url: "https://tvzvezda.ru/export/rss.xml" },
    { name: "Mir TV", url: "https://mirtv.ru/rss/" },
    { name: "TVC", url: "https://www.tvc.ru/rss/" }
];

const RUSSIAN_CHANNELS = CHANNELS.map(ch => ch.name);

// --- State Management ---
const state = {
    mode: 'today',
    newsCache: [],
    lastFetchTime: 0,
    earliestDate: null,
    latestDate: null,
    translationCache: {},  // Cache for translated titles
    summaryCache: {},      // Cache for article summaries
    openSummaries: new Set(), // Track which summaries are open
    useMongoHistory: true  // Flag to use MongoDB for history
};

// --- DOM Elements ---
const newsFeed = document.getElementById('news-feed');
const btnHistory = document.getElementById('btn-history');
const btnBack = document.getElementById('btn-back-today');
const historyControls = document.getElementById('history-controls');
const historyDateInput = document.getElementById('history-date');
const newsTitle = document.getElementById('news-title');
const summaryText = document.getElementById('summary-text');

// --- Helper: Format Date ---
function getLocalDateString(dateObj) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// --- Helper: Compare Dates by Day ---
function isSameDay(d1, d2) {
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getDate() === d2.getDate();
}

// --- Translate Russian -> English using LibreTranslate ---
async function translateToEnglish(text) {
    if (state.translationCache[text]) return state.translationCache[text];

    const translators = [
        async () => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            try {
                const res = await fetch('https://translate.argosopentech.com/translate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        q: text,
                        source: 'ru',
                        target: 'en'
                    }),
                    signal: controller.signal
                });
                clearTimeout(timeout);
                const data = await res.json();
                return data?.translatedText;
            } catch (err) {
                clearTimeout(timeout);
                throw err;
            }
        },
        async () => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            try {
                const res = await fetch(`https://lingva.ml/api/v1/ru/en/${encodeURIComponent(text)}`, {
                    signal: controller.signal
                });
                clearTimeout(timeout);
                const data = await res.json();
                return data?.translation;
            } catch (err) {
                clearTimeout(timeout);
                throw err;
            }
        },
        async () => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            try {
                const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=ru|en`, {
                    signal: controller.signal
                });
                clearTimeout(timeout);
                const data = await res.json();
                return data?.responseData?.translatedText;
            } catch (err) {
                clearTimeout(timeout);
                throw err;
            }
        }
    ];

    for (const translator of translators) {
        try {
            const translated = await translator();
            if (translated && translated.length > 0 && !translated.includes('ERROR') && !translated.includes('LIMIT')) {
                state.translationCache[text] = translated;
                return translated;
            }
        } catch (err) {
            console.warn('Translation attempt failed:', err);
            continue;
        }
    }
    return text;
}

// --- Extract article content from webpage ---
async function extractArticleContent(url) {
    try {
        const res = await fetch(PROXY_BASE + encodeURIComponent(url));
        if (!res.ok) throw new Error('Failed to fetch article');
        const data = await res.json();
        const html = data.contents;

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const unwanted = doc.querySelectorAll('script, style, nav, footer, .ad, .advertisement, .sidebar');
        unwanted.forEach(el => el.remove());

        const contentSelectors = [
            'article', '.article-content', '.article-body', '.post-content',
            '.entry-content', 'main', '[itemprop="articleBody"]'
        ];

        let content = '';
        for (const selector of contentSelectors) {
            const element = doc.querySelector(selector);
            if (element) {
                content = element.textContent;
                break;
            }
        }

        if (!content || content.length < 100) {
            const paragraphs = Array.from(doc.querySelectorAll('p'));
            content = paragraphs.map(p => p.textContent).join(' ');
        }

        content = content.replace(/\s+/g, ' ').trim();
        return content.substring(0, 3000);
    } catch (err) {
        console.error('Error extracting article:', err);
        return null;
    }
}

// --- Generate summary using Claude API ---
async function generateSummary(articleText, articleTitle) {
    try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "claude-sonnet-4-20250514",
                max_tokens: 1000,
                messages: [{
                    role: "user",
                    content: `You are a news summarization assistant. Translate the following Russian news article to English and provide a concise 2-3 sentence factual summary.

Title: ${articleTitle}
Article text:
${articleText}

Provide ONLY the translated summary, nothing else.`
                }]
            })
        });
        const data = await response.json();
        if (data.content && data.content[0] && data.content[0].text) {
            return data.content[0].text.trim();
        }
        throw new Error('Invalid API response');
    } catch (err) {
        console.error('Summary generation failed:', err);
        return null;
    }
}

// --- Get or generate summary ---
async function getArticleSummary(url, title) {
    if (state.summaryCache[url]) return state.summaryCache[url];

    const articleText = await extractArticleContent(url);
    if (!articleText || articleText.length < 50) return "Summary unavailable - could not extract article content.";

    const summary = await generateSummary(articleText, title);
    if (!summary) return "Summary unavailable - generation failed.";

    state.summaryCache[url] = summary;
    return summary;
}

// --- Toggle summary dropdown ---
async function toggleSummary(event, newsItem) {
    event.preventDefault();
    event.stopPropagation();

    const itemId = `news-${newsItem.url.replace(/[^a-zA-Z0-9]/g, '')}`;
    const summaryDiv = document.getElementById(`summary-${itemId}`);
    const summaryBtn = event.currentTarget;

    if (state.openSummaries.has(itemId)) {
        summaryDiv.style.maxHeight = '0';
        summaryDiv.style.opacity = '0';
        summaryBtn.textContent = '📄 Summary';
        summaryBtn.classList.remove('active');
        state.openSummaries.delete(itemId);
        return;
    }

    state.openSummaries.add(itemId);
    summaryBtn.textContent = '📄 Loading...';
    summaryBtn.disabled = true;

    const summary = await getArticleSummary(newsItem.url, newsItem.title);
    summaryDiv.querySelector('.summary-content').textContent = summary;

    summaryDiv.style.maxHeight = summaryDiv.scrollHeight + 'px';
    summaryDiv.style.opacity = '1';
    summaryBtn.textContent = '📄 Hide';
    summaryBtn.classList.add('active');
    summaryBtn.disabled = false;
}

// --- Parse RSS and translate ---
async function parseRSS(xmlText, channelName) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, "text/xml");
    if (xmlDoc.querySelector("parsererror")) return [];

    const items = Array.from(xmlDoc.querySelectorAll("item"));

    const parsedItems = await Promise.all(items.map(async item => {
        try {
            const title = item.querySelector("title")?.textContent?.trim();
            const link = item.querySelector("link")?.textContent?.trim() ||
                         item.querySelector("guid")?.textContent?.trim();
            const pubDateStr = item.querySelector("pubDate")?.textContent?.trim() ||
                               item.querySelector("dc\\:date")?.textContent?.trim();
            if (!title || !link) return null;

            const dateObj = pubDateStr ? new Date(pubDateStr) : new Date();
            let finalTitle = title;

            if (RUSSIAN_CHANNELS.includes(channelName)) {
                finalTitle = await translateToEnglish(title);
            }

            return {
                title: finalTitle,
                originalTitle: title,
                url: link,
                channel: channelName,
                dateObj,
                dateStr: getLocalDateString(dateObj),
                timeStr: dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };
        } catch (err) {
            console.warn("Error parsing item:", err);
            return null;
        }
    }));

    return parsedItems.filter(item => item !== null);
}

// --- Generate daily news summary using AI ---
async function generateDailySummary(newsItems) {
    if (!newsItems || newsItems.length === 0) {
        return "No news available for summary.";
    }

    // Update summary box to show loading
    if (summaryText) {
        summaryText.textContent = "Analyzing today's headlines...";
    }

    try {
        // Call backend API for summarization
        const response = await fetch(`${API_BASE}/news/summarize`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                headlines: newsItems.slice(0, 30).map(item => ({
                    title: item.title,
                    channel: item.channel
                }))
            })
        });

        if (!response.ok) {
            throw new Error('API summarization failed');
        }

        const data = await response.json();
        return data.summary || "Summary generation failed.";

    } catch (error) {
        console.error('Error generating summary:', error);
        
        // Fallback: Create a simple summary from headlines
        return generateSimpleSummary(newsItems);
    }
}

// --- Generate simple summary (fallback) ---
function generateSimpleSummary(newsItems) {
    if (!newsItems || newsItems.length === 0) {
        return "No news available today.";
    }

    const channels = [...new Set(newsItems.map(item => item.channel))];
    const topStories = newsItems.slice(0, 3);
    
    let summary = `Today's news from ${channels.length} Russian channels features ${newsItems.length} headlines. `;
    summary += `Top stories include: ${topStories.map(item => item.title.split(':')[0] || item.title.substring(0, 50)).join('; ')}.`;
    
    return summary;
}

// --- Update summary box ---
async function updateSummaryBox(newsItems) {
    if (!summaryText) return;
    
    if (!newsItems || newsItems.length === 0) {
        summaryText.textContent = "No news available for today.";
        summaryText.classList.remove('loading');
        return;
    }

    // Show loading state
    summaryText.classList.add('loading');

    // Generate and display summary
    const summary = await generateDailySummary(newsItems);
    summaryText.textContent = summary;
    summaryText.classList.remove('loading');
}

// --- Save news to MongoDB ---
async function saveNewsToMongo(newsItems) {
    try {
        const response = await fetch(`${API_BASE}/news/save`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                newsItems: newsItems.map(item => ({
                    title: item.title,
                    originalTitle: item.originalTitle,
                    url: item.url,
                    channel: item.channel,
                    fetchDate: item.dateStr,
                    fetchTime: item.timeStr
                }))
            })
        });

        if (!response.ok) throw new Error('Failed to save news to database');
        
        const result = await response.json();
        console.log(`✅ Saved to DB: ${result.results.saved} new, ${result.results.duplicates} duplicates`);
        return result;
    } catch (error) {
        console.error('Error saving to MongoDB:', error);
        return null;
    }
}

// --- Fetch news from MongoDB for specific date ---
async function fetchNewsFromMongo(date) {
    try {
        const endpoint = date ? `${API_BASE}/news/date/${date}` : `${API_BASE}/news/today`;
        const response = await fetch(endpoint);
        
        if (!response.ok) throw new Error('Failed to fetch news from database');
        
        const data = await response.json();
        
        if (data.status === 'success' && data.news) {
            // Convert MongoDB format to our app format
            return data.news.map(item => ({
                title: item.title,
                originalTitle: item.originalTitle,
                url: item.url,
                channel: item.channel,
                dateObj: new Date(item.timestamp),
                dateStr: item.fetchDate,
                timeStr: item.fetchTime || new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            }));
        }
        
        return [];
    } catch (error) {
        console.error('Error fetching from MongoDB:', error);
        return [];
    }
}

// --- Fetch all news ---
async function fetchAllNews() {
    const now = Date.now();
    
    // For today's news, fetch from RSS and save to MongoDB
    if (state.mode === 'today') {
        // Use cache if recent
        if (state.newsCache.length > 0 && (now - state.lastFetchTime < 300000)) {
            return state.newsCache;
        }

        newsFeed.innerHTML = '<div class="loading">Fetching latest feeds and translating...</div>';

        const allNews = [];

        for (const channel of CHANNELS) {
            try {
                const bustCache = `&t=${now}`;
                const res = await fetch(PROXY_BASE + encodeURIComponent(channel.url) + bustCache);
                if (!res.ok) continue;
                const data = await res.json();
                if (data?.contents) {
                    const items = await parseRSS(data.contents, channel.name);
                    allNews.push(...items);
                }
            } catch (err) {
                console.warn(`Failed to fetch ${channel.name}:`, err);
            }
        }

        allNews.sort((a, b) => b.dateObj - a.dateObj);
        state.newsCache = allNews;
        state.lastFetchTime = Date.now();

        if (allNews.length > 0) {
            state.latestDate = allNews[0].dateObj;
            state.earliestDate = allNews[allNews.length - 1].dateObj;
            
            // Save today's news to MongoDB
            await saveNewsToMongo(allNews);
            
            // Generate and update summary
            await updateSummaryBox(allNews);
        }

        renderNews();
        return allNews;
    }
    
    // For history mode, always fetch from MongoDB
    return state.newsCache;
}

// --- Create news card ---
function createNewsCard(item) {
    const itemId = `news-${item.url.replace(/[^a-zA-Z0-9]/g, '')}`;

    const cardWrapper = document.createElement('div');
    cardWrapper.className = 'news-card-wrapper';

    const card = document.createElement('div');
    card.className = 'news-card-container';

    const encodedUrl = encodeURIComponent(item.url);
    const translateUrl = `https://translate.google.com/translate?sl=ru&tl=en&u=${encodedUrl}`;

    const headlineLink = document.createElement('a');
    headlineLink.href = translateUrl;
    headlineLink.target = "_blank";
    headlineLink.className = 'news-card';
    headlineLink.innerHTML = `
        <div class="news-meta">
            <span class="channel-tag">${item.channel}</span>
            <span class="news-time">${item.timeStr}</span>
        </div>
        <div class="news-title">${item.title}</div>
    `;

    card.appendChild(headlineLink);
    cardWrapper.appendChild(card);

    return cardWrapper;
}

// --- Render news ---
function renderNews(filterDate = null) {
    const today = new Date();
    const filteredItems = state.newsCache.filter(item => {
        if (state.mode === 'today') return isSameDay(item.dateObj, today);
        if (state.mode === 'history' && filterDate) {
            return isSameDay(item.dateObj, new Date(filterDate + 'T00:00'));
        }
        return false;
    });

    newsFeed.innerHTML = '';

    if (filteredItems.length === 0) {
        const dateInfo = filterDate || 'this date';
        let msg = `<div class="loading" style="color:#d32f2f;">No news found for ${dateInfo}.</div>`;
        
        if (state.mode === 'history') {
            msg += `<div style="margin-top:10px; font-size:0.85rem; color:#e8eef3; padding:10px; background:rgba(255,255,255,0.1); border-radius:5px;">
                        <strong>Tip:</strong> News is stored in the database when fetched. Visit a date after news has been collected.
                    </div>`;
        }
        newsFeed.innerHTML = msg;
        return;
    }

    filteredItems.forEach(item => {
        newsFeed.appendChild(createNewsCard(item));
    });
}

// --- View Controllers ---
async function loadToday() {
    state.mode = 'today';
    state.openSummaries.clear();
    newsTitle.textContent = "Today's News";
    btnHistory.style.display = 'block';
    btnBack.style.display = 'none';
    historyControls.style.display = 'none';

    await fetchAllNews();
}

async function loadHistory() {
    state.mode = 'history';
    state.openSummaries.clear();
    newsTitle.textContent = "News Archive";
    btnHistory.style.display = 'none';
    btnBack.style.display = 'block';
    historyControls.style.display = 'block';

    if (!historyDateInput.value) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        historyDateInput.value = getLocalDateString(yesterday);
    }

    // Fetch from MongoDB for selected date
    const selectedDate = historyDateInput.value;
    newsFeed.innerHTML = '<div class="loading">Loading news from database...</div>';
    
    const mongoNews = await fetchNewsFromMongo(selectedDate);
    
    if (mongoNews.length > 0) {
        state.newsCache = mongoNews;
        renderNews(selectedDate);
    } else {
        newsFeed.innerHTML = `<div class="loading" style="color:#d32f2f;">No news found for ${selectedDate}.</div>
            <div style="margin-top:10px; font-size:0.85rem; color:#e8eef3; padding:10px; background:rgba(255,255,255,0.1); border-radius:5px;">
                <strong>Note:</strong> News is stored when fetched from RSS feeds. Select a date when news was collected.
            </div>`;
    }
}

// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', loadToday);
btnHistory.addEventListener('click', loadHistory);
btnBack.addEventListener('click', loadToday);
historyDateInput.addEventListener('change', async () => {
    if (state.mode === 'history') {
        state.openSummaries.clear();
        const selectedDate = historyDateInput.value;
        
        newsFeed.innerHTML = '<div class="loading">Loading news from database...</div>';
        const mongoNews = await fetchNewsFromMongo(selectedDate);
        
        if (mongoNews.length > 0) {
            state.newsCache = mongoNews;
            renderNews(selectedDate);
        } else {
            newsFeed.innerHTML = `<div class="loading" style="color:#d32f2f;">No news found for ${selectedDate}.</div>
                <div style="margin-top:10px; font-size:0.85rem; color:#e8eef3; padding:10px; background:rgba(255,255,255,0.1); border-radius:5px;">
                    <strong>Note:</strong> News is stored when fetched from RSS feeds. Select a date when news was collected.
                </div>`;
        }
    }
});

// --- Logout Handler ---
const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        try {
            const response = await fetch(`${API_BASE}/auth/logout`, {
                method: 'POST'
            });
            
            if (response.ok) {
                window.location.href = '/login.html';
            }
        } catch (error) {
            console.error('Logout error:', error);
            // Redirect anyway
            window.location.href = '/login.html';
        }
    });
}
