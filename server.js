const express = require('express');
const cors = require('cors');
const path = require('path');
const { YoutubeTranscript } = require('youtube-transcript');
const translate = require('@vitalets/google-translate-api');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // Serve static files from root directory

console.log("Server is ready!");

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
