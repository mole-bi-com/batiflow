import json
import sys
from youtube_transcript_api import YouTubeTranscriptApi

if len(sys.argv) < 2:
    print(json.dumps({"error": "No video ID provided"}))
    sys.exit(1)

video_id = sys.argv[1]

try:
    api = YouTubeTranscriptApi()
    # Prioritize Korean, fallback to English or whatever default language is active
    transcript = api.fetch(video_id, languages=['ko', 'en'])
    
    formatted = []
    for entry in transcript:
        offset_sec = entry.start
        minutes = int(offset_sec // 60)
        seconds = int(offset_sec % 60)
        timestamp = f"[{minutes:02d}:{seconds:02d}]"
        
        # Clean up HTML entities
        text = entry.text.replace('&amp;', '&').replace('&quot;', '"').replace('&#39;', "'").replace('&apos;', "'")
        formatted.append(f"{timestamp} {text}")
        
    print(json.dumps(formatted, ensure_ascii=False))
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
