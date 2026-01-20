import os
import time
from flask import Flask, request, jsonify
from flask_cors import CORS
from youtube_transcript_api import YouTubeTranscriptApi
from deep_translator import GoogleTranslator
import re

app = Flask(__name__)
CORS(app)

print("Server is ready!")

UPLOAD_FOLDER = 'temp_downloads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def extract_video_id(url):
    """Extract YouTube video ID from URL"""
    patterns = [
        r'(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)',
        r'youtube\.com\/embed\/([^&\n?#]+)',
        r'youtube\.com\/v\/([^&\n?#]+)'
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None

def format_timestamp(seconds):
    """Convert seconds to SRT timestamp format"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"

def create_srt(transcript):
    """Generate SRT format from transcript"""
    srt_lines = []
    for i, entry in enumerate(transcript, 1):
        start = format_timestamp(entry['start'])
        end = format_timestamp(entry['start'] + entry['duration'])
        text = entry['text'].strip()
        srt_lines.append(f"{i}\n{start} --> {end}\n{text}\n")
    return "\n".join(srt_lines)

def translate_text(text, source='ru', target='en'):
    """Translate text using deep-translator"""
    try:
        translator = GoogleTranslator(source=source, target=target)
        # Split long text into chunks if needed (Google Translate has limits)
        if len(text) > 4500:
            # Split by sentences and translate in chunks
            chunks = [text[i:i+4500] for i in range(0, len(text), 4500)]
            translated = ' '.join([translator.translate(chunk) for chunk in chunks])
            return translated
        return translator.translate(text)
    except Exception as e:
        print(f"Translation error: {e}")
        return text

@app.route('/generate-captions', methods=['POST'])
def generate_captions():
    try:
        url = request.json.get('url', '')
        
        if not url:
            return jsonify({"error": "No URL provided"}), 400
        
        # Extract video ID
        video_id = extract_video_id(url)
        if not video_id:
            return jsonify({"error": "Invalid YouTube URL"}), 400
        
        print(f"Fetching transcript for video: {video_id}")
        
        # Fetch Russian transcript
        try:
            transcript = YouTubeTranscriptApi.get_transcript(video_id, languages=['ru'])
        except Exception as e:
            return jsonify({"error": f"Could not fetch transcript: {str(e)}"}), 404
        
        # Create Russian SRT
        russian_srt = create_srt(transcript)
        
        # Translate each caption entry
        print("Translating captions...")
        english_transcript = []
        for entry in transcript:
            translated_text = translate_text(entry['text'], source='ru', target='en')
            english_transcript.append({
                'start': entry['start'],
                'duration': entry['duration'],
                'text': translated_text
            })
        
        # Create English SRT
        english_srt = create_srt(english_transcript)
        
        return jsonify({
            "status": "success",
            "video_id": video_id,
            "russian_srt": russian_srt,
            "english_srt": english_srt,
            "transcript_count": len(transcript)
        })
        
    except Exception as e:
        print(f"Error: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/translate', methods=['POST'])
def translate_audio():
    return jsonify({"error": "Audio transcription not available. Use YouTube transcript feature instead."}), 501

if __name__ == '__main__':
    app.run(port=5000, debug=True)