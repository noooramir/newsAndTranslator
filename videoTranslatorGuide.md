# YouTube Caption Translator - Setup Guide

## What You Get

A complete system that:
- ✅ Takes YouTube URL as input
- ✅ Extracts Russian captions (even when "captions disabled")
- ✅ Translates to English automatically (free, no API key)
- ✅ Displays video with synced English captions
- ✅ Caches results for instant re-access

## Installation Steps

### 1. Install Python Requirements

Create a file called `requirements.txt`:

```
flask==3.0.0
flask-cors==4.0.0
youtube-transcript-api==0.6.1
deep-translator==1.11.4
```

Install dependencies:
```bash
pip install -r requirements.txt
```

### 2. Backend Setup

Save the Flask backend code as `app.py` and run:

```bash
python app.py
```

Server will start at `http://localhost:5000`

### 3. Frontend Setup

The React frontend is already created above! To connect it to your backend:

Update the `handleSubmit` function to call your actual backend:

```javascript
const handleSubmit = async () => {
  setError('');
  setVideoData(null);
  setCaptions([]);
  
  const videoId = extractVideoId(url);
  if (!videoId) {
    setError('Invalid YouTube URL. Please enter a valid YouTube link.');
    return;
  }

  setLoading(true);

  try {
    // Call your Flask backend
    const response = await fetch('http://localhost:5000/api/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to fetch captions');
    }

    const data = await response.json();
    
    setVideoData({
      videoId: data.video_id,
      title: "Video with Translated Captions"
    });
    setCaptions(data.captions);
    
  } catch (err) {
    setError(err.message || 'Failed to fetch captions. The video might not have Russian audio.');
  } finally {
    setLoading(false);
  }
};
```

## How It Works (No Whisper!)

### Backend Process:

1. **Extract Video ID** from YouTube URL
2. **Get Russian Transcript** using `youtube-transcript-api`
   - This library accesses YouTube's auto-generated transcripts
   - Works even when captions appear "disabled" on the video
   - Gets the Russian audio transcription
3. **Translate** using Google Translate (via `deep-translator`)
   - No API key needed
   - Free and unlimited
   - Translates Russian → English
4. **Cache Results** as JSON files
   - Stored locally in `caption_cache/` folder
   - Instant access for previously translated videos
5. **Return JSON** with timestamps and translated text

### Frontend Process:

1. User enters YouTube URL
2. Sends URL to Flask backend
3. Displays video in iframe
4. Shows synchronized English captions below
5. Full transcript available for scrolling

## Testing

Try with a Russian YouTube video:

Example Russian videos (some may have captions):
- Any Russian news channel video
- Russian educational content
- Russian music videos

Paste URL → Click "Translate Captions" → Watch!

## Advantages Over Whisper

✅ **Faster** - Uses existing YouTube transcripts
✅ **No installation** - No AI models to download
✅ **Lightweight** - No GPU needed
✅ **Free** - No compute costs
✅ **Better quality** - YouTube's transcription is often very good

## Limitations

⚠️ Video must have Russian audio
⚠️ YouTube must have generated auto-captions (most videos do)
⚠️ Translation quality depends on Google Translate
⚠️ Rate limiting on free Google Translate (but unlikely to hit)

## Deployment Options

### Free Hosting:

**Backend:**
- Render.com (free tier)
- Railway.app (free trial)
- PythonAnywhere (free tier)

**Frontend:**
- Vercel (free)
- Netlify (free)
- GitHub Pages (free)

## Cache Management

Captions are stored in `caption_cache/` folder:
- One JSON file per video
- Named by video ID (e.g., `dQw4w9WgXcQ.json`)
- Delete folder to clear cache
- No size limit (JSON files are small)

## Troubleshooting

**"No Russian captions available"**
- Video doesn't have Russian audio
- YouTube hasn't generated auto-captions yet (new videos)
- Try a different video

**CORS errors**
- Make sure Flask-CORS is installed
- Backend must be running on localhost:5000

**Translation fails**
- Internet connection required
- Google Translate might be temporarily unavailable
- Try again in a few seconds

## Next Steps

1. Test with a Russian YouTube video
2. Deploy to free hosting if you want it online
3. Add more languages (modify translator source/target)
4. Improve UI/UX as needed

Enjoy your free YouTube caption translator! 🎉