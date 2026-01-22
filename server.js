const express = require('express');
const cors = require('cors');
const path = require('path');
const { YoutubeTranscript } = require('youtube-transcript');
const translate = require('@vitalets/google-translate-api');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcrypt');

const app = express();
const PORT = 3000;

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/news_aggregator';

mongoose.connect(MONGODB_URI)
.then(() => console.log('✅ MongoDB Connected'))
.catch(err => console.error('❌ MongoDB Connection Error:', err));

// News Schema
const newsSchema = new mongoose.Schema({
    title: { type: String, required: true },
    originalTitle: { type: String, required: true },
    url: { type: String, required: true },
    channel: { type: String, required: true },
    fetchDate: { type: String, required: true, index: true }, // YYYY-MM-DD format
    fetchTime: { type: String },
    timestamp: { type: Date, default: Date.now, index: true }
});

// Compound index to prevent duplicates for same headline+link on same date
newsSchema.index({ url: 1, fetchDate: 1 }, { unique: true });

const News = mongoose.model('News', newsSchema);

// User credentials (in production, store hashed passwords in database)
const USERS = {
    admin: bcrypt.hashSync('admin123', 10),
    user: bcrypt.hashSync('user123', 10)
};

// Middleware
app.use(cors());
app.use(express.json());

// Session configuration
app.use(session({
    secret: 'news-aggregator-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // Set to true in production with HTTPS
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Authentication middleware
function isAuthenticated(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    }
    res.redirect('/login.html');
}

// Serve login page (unprotected)
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// Serve CSS (unprotected - needed for login page)
app.get('/style.css', (req, res) => {
    res.sendFile(path.join(__dirname, 'style.css'));
});

// Serve channel images (unprotected)
app.use('/channel_images', express.static(path.join(__dirname, 'channel_images')));

// Protect main pages with authentication
app.get('/index.html', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/script.js', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'script.js'));
});

// Redirect root to login or index based on auth status
app.get('/', (req, res) => {
    if (req.session && req.session.user) {
        res.redirect('/index.html');
    } else {
        res.redirect('/login.html');
    }
});

console.log("Server is ready!");

// ==================== AUTHENTICATION API ENDPOINTS ====================

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: "Username and password required" });
        }
        
        // Check if user exists
        if (!USERS[username]) {
            return res.status(401).json({ error: "Invalid username or password" });
        }
        
        // Verify password
        const isValid = await bcrypt.compare(password, USERS[username]);
        
        if (!isValid) {
            return res.status(401).json({ error: "Invalid username or password" });
        }
        
        // Create session
        req.session.user = username;
        
        return res.json({
            status: "success",
            message: "Login successful",
            user: username
        });
        
    } catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({ error: "Login failed" });
    }
});

// Logout endpoint
app.post('/api/auth/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: "Logout failed" });
        }
        res.json({ status: "success", message: "Logged out successfully" });
    });
});

// Check auth status
app.get('/api/auth/status', (req, res) => {
    if (req.session && req.session.user) {
        res.json({ authenticated: true, user: req.session.user });
    } else {
        res.json({ authenticated: false });
    }
});

// ==================== NEWS HISTORY API ENDPOINTS ====================

// Route: Generate summary of news headlines
app.post('/api/news/summarize', async (req, res) => {
    try {
        const { headlines } = req.body;
        
        if (!headlines || !Array.isArray(headlines)) {
            return res.status(400).json({ error: "Invalid headlines format" });
        }
        
        // Create a simple summary based on headlines
        const channels = [...new Set(headlines.map(h => h.channel))];
        const headlineTexts = headlines.slice(0, 5).map(h => h.title);
        
        // Extract key topics (simple keyword extraction)
        const allText = headlines.map(h => h.title).join(' ').toLowerCase();
        const commonWords = ['the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'but'];
        const words = allText.split(/\s+/).filter(w => w.length > 4 && !commonWords.includes(w));
        const wordFreq = {};
        words.forEach(w => wordFreq[w] = (wordFreq[w] || 0) + 1);
        const topTopics = Object.entries(wordFreq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([word]) => word);
        
        let summary = `Today's Russian news covers ${headlines.length} headlines from ${channels.length} sources. `;
        
        if (topTopics.length > 0) {
            summary += `Key topics include ${topTopics.join(', ')}. `;
        }
        
        summary += `Major stories: ${headlineTexts.slice(0, 2).map(h => h.split('.')[0]).join('; ')}.`;
        
        return res.json({
            status: "success",
            summary
        });
        
    } catch (error) {
        console.error('Error in /api/news/summarize:', error);
        return res.status(500).json({ error: error.message });
    }
});

// Route: Save news items to MongoDB
app.post('/api/news/save', async (req, res) => {
    try {
        const { newsItems } = req.body;
        
        if (!newsItems || !Array.isArray(newsItems)) {
            return res.status(400).json({ error: "Invalid news items format" });
        }
        
        const results = {
            saved: 0,
            duplicates: 0,
            errors: 0
        };
        
        for (const item of newsItems) {
            try {
                const newsDoc = new News({
                    title: item.title,
                    originalTitle: item.originalTitle,
                    url: item.url,
                    channel: item.channel,
                    fetchDate: item.fetchDate,
                    fetchTime: item.fetchTime
                });
                
                await newsDoc.save();
                results.saved++;
            } catch (error) {
                // Duplicate key error (same URL on same date)
                if (error.code === 11000) {
                    results.duplicates++;
                } else {
                    console.error('Error saving news item:', error);
                    results.errors++;
                }
            }
        }
        
        return res.json({
            status: "success",
            results
        });
        
    } catch (error) {
        console.error('Error in /api/news/save:', error);
        return res.status(500).json({ error: error.message });
    }
});

// Route: Get today's news from MongoDB
app.get('/api/news/today', async (req, res) => {
    try {
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
        
        const news = await News.find({ fetchDate: dateStr })
            .sort({ timestamp: -1 })
            .lean();
        
        return res.json({
            status: "success",
            date: dateStr,
            count: news.length,
            news
        });
        
    } catch (error) {
        console.error('Error in /api/news/today:', error);
        return res.status(500).json({ error: error.message });
    }
});

// Route: Get news for a specific date
app.get('/api/news/date/:date', async (req, res) => {
    try {
        const { date } = req.params;
        
        // Validate date format (YYYY-MM-DD)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
        }
        
        const news = await News.find({ fetchDate: date })
            .sort({ timestamp: -1 })
            .lean();
        
        return res.json({
            status: "success",
            date,
            count: news.length,
            news
        });
        
    } catch (error) {
        console.error('Error in /api/news/date:', error);
        return res.status(500).json({ error: error.message });
    }
});

// Route: Get available dates with news
app.get('/api/news/available-dates', async (req, res) => {
    try {
        const dates = await News.distinct('fetchDate').sort();
        
        return res.json({
            status: "success",
            dates
        });
        
    } catch (error) {
        console.error('Error in /api/news/available-dates:', error);
        return res.status(500).json({ error: error.message });
    }
});

// Route: Get date range of stored news
app.get('/api/news/date-range', async (req, res) => {
    try {
        const oldest = await News.findOne().sort({ timestamp: 1 }).select('fetchDate timestamp');
        const newest = await News.findOne().sort({ timestamp: -1 }).select('fetchDate timestamp');
        
        return res.json({
            status: "success",
            oldest: oldest ? { date: oldest.fetchDate, timestamp: oldest.timestamp } : null,
            newest: newest ? { date: newest.fetchDate, timestamp: newest.timestamp } : null
        });
        
    } catch (error) {
        console.error('Error in /api/news/date-range:', error);
        return res.status(500).json({ error: error.message });
    }
});

// ==================== YOUTUBE CAPTION ENDPOINTS ====================


// Helper: Extract YouTube video ID from URL
function extractVideoId(url) {
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/,
        /youtube\.com\/embed\/([^&\n?#]+)/,
        /youtube\.com\/v\/([^&\n?#]+)/
    ];
    
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
}

// Helper: Format timestamp for SRT
function formatTimestamp(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const millis = Math.floor((seconds % 1) * 1000);
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${millis.toString().padStart(3, '0')}`;
}

// Helper: Create SRT format from transcript
function createSrt(transcript) {
    const srtLines = [];
    
    transcript.forEach((entry, i) => {
        const start = formatTimestamp(entry.offset / 1000);
        const end = formatTimestamp((entry.offset + entry.duration) / 1000);
        const text = entry.text.trim();
        
        srtLines.push(`${i + 1}\n${start} --> ${end}\n${text}\n`);
    });
    
    return srtLines.join('\n');
}

// Helper: Translate text
async function translateText(text, sourceLang = 'ru', targetLang = 'en') {
    try {
        // Split long text into chunks if needed
        if (text.length > 4500) {
            const chunks = [];
            for (let i = 0; i < text.length; i += 4500) {
                chunks.push(text.substring(i, i + 4500));
            }
            
            const translatedChunks = await Promise.all(
                chunks.map(chunk => translate(chunk, { from: sourceLang, to: targetLang }))
            );
            
            return translatedChunks.map(result => result.text).join(' ');
        }
        
        const result = await translate(text, { from: sourceLang, to: targetLang });
        return result.text;
    } catch (error) {
        console.error('Translation error:', error.message);
        return text; // Return original text if translation fails
    }
}

// Route: Generate captions
app.post('/generate-captions', async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: "No URL provided" });
        }
        
        // Extract video ID
        const videoId = extractVideoId(url);
        if (!videoId) {
            return res.status(400).json({ error: "Invalid YouTube URL" });
        }
        
        console.log(`Fetching transcript for video: ${videoId}`);
        
        // Fetch Russian transcript
        let transcript;
        try {
            transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'ru' });
        } catch (error) {
            return res.status(404).json({ 
                error: `Could not fetch transcript: ${error.message}` 
            });
        }
        
        // Create Russian SRT
        const russianSrt = createSrt(transcript);
        
        // Translate each caption entry
        console.log("Translating captions...");
        const englishTranscript = [];
        
        for (const entry of transcript) {
            const translatedText = await translateText(entry.text, 'ru', 'en');
            englishTranscript.push({
                offset: entry.offset,
                duration: entry.duration,
                text: translatedText
            });
            
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Create English SRT
        const englishSrt = createSrt(englishTranscript);
        
        return res.json({
            status: "success",
            video_id: videoId,
            russian_srt: russianSrt,
            english_srt: englishSrt,
            transcript_count: transcript.length
        });
        
    } catch (error) {
        console.error(`Error: ${error.message}`);
        return res.status(500).json({ error: error.message });
    }
});

// Route: Translate audio (not available)
app.post('/translate', (req, res) => {
    return res.status(501).json({ 
        error: "Audio transcription not available. Use YouTube transcript feature instead." 
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`\n🚀 Server running at http://localhost:${PORT}`);
    console.log(`📰 News feed: http://localhost:${PORT}/index.html`);
    console.log(`🎥 Caption generator ready\n`);
});
