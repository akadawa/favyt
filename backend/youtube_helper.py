import re
import urllib.parse
import requests
import json

def extract_video_id(url_or_id: str) -> str:
    """Extract YouTube 11-char video ID from various URL formats or raw ID."""
    url_or_id = url_or_id.strip()
    if len(url_or_id) == 11 and re.match(r'^[a-zA-Z0-9_-]{11}$', url_or_id):
        return url_or_id
        
    patterns = [
        r'(?:v=|\/v\/|youtu\.be\/|\/embed\/|\/shorts\/|\/e\/|watch\?v=|\&v=)([a-zA-Z0-9_-]{11})',
        r'youtu\.be\/([a-zA-Z0-9_-]{11})',
        r'youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})',
        r'youtube\.com\/live\/([a-zA-Z0-9_-]{11})'
    ]
    
    for pattern in patterns:
        match = re.search(pattern, url_or_id)
        if match:
            return match.group(1)
            
    # Try parsing query param
    parsed = urllib.parse.urlparse(url_or_id)
    if 'v' in urllib.parse.parse_qs(parsed.query):
        v = urllib.parse.parse_qs(parsed.query)['v'][0]
        if len(v) == 11:
            return v
            
    return ""

def fetch_video_metadata(video_id: str) -> dict:
    """
    Fetches title, author, thumbnail for a YouTube video using oEmbed and fallback.
    Does not require a YouTube API key.
    """
    video_url = f"https://www.youtube.com/watch?v={video_id}"
    oembed_url = f"https://www.youtube.com/oembed?url={urllib.parse.quote(video_url)}&format=json"
    
    metadata = {
        "video_id": video_id,
        "title": f"YouTube Video ({video_id})",
        "channel_title": "YouTube",
        "thumbnail_url": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
        "duration": ""
    }
    
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        res = requests.get(oembed_url, headers=headers, timeout=5)
        if res.status_code == 200:
            data = res.json()
            metadata["title"] = data.get("title", metadata["title"])
            metadata["channel_title"] = data.get("author_name", metadata["channel_title"])
            if "thumbnail_url" in data:
                # Use maxres or hq default
                metadata["thumbnail_url"] = data["thumbnail_url"]
    except Exception as e:
        print(f"Error fetching oEmbed for {video_id}: {e}")
        
    # High-res thumbnail preference
    metadata["thumbnail_url_high"] = f"https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg"
    metadata["thumbnail_url_hq"] = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
    
    return metadata

def extract_playlist_id(url_or_id: str) -> str:
    url_or_id = url_or_id.strip()
    if url_or_id.startswith("PL") or url_or_id.startswith("UU") or url_or_id.startswith("FL") or url_or_id.startswith("RD"):
        return url_or_id
    match = re.search(r'[?&]list=([a-zA-Z0-9_-]+)', url_or_id)
    if match:
        return match.group(1)
    return ""

def import_public_playlist(playlist_id_or_url: str) -> tuple[str, list[dict]]:
    """
    Attempts to extract videos from a public YouTube playlist page without API key.
    Returns (playlist_title, list_of_video_objects)
    """
    playlist_id = extract_playlist_id(playlist_id_or_url)
    if not playlist_id:
        return "Unbekannte Playlist", []
        
    url = f"https://www.youtube.com/playlist?list={playlist_id}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.8"
    }
    
    try:
        res = requests.get(url, headers=headers, timeout=10)
        if res.status_code != 200:
            return f"Playlist {playlist_id}", []
            
        html = res.text
        # Look for ytInitialData JSON in HTML
        match = re.search(r'var ytInitialData = ({.*?});</script>', html)
        if not match:
            match = re.search(r'window\["ytInitialData"\] = ({.*?});', html)
            
        if not match:
            return f"Playlist {playlist_id}", []
            
        data = json.loads(match.group(1))
        
        # Extract title
        title = f"Playlist {playlist_id}"
        try:
            title = data.get("metadata", {}).get("playlistMetadataRenderer", {}).get("title", title)
        except Exception:
            pass
            
        videos = []
        try:
            # Traverse tabs -> tabRenderer -> content -> sectionListRenderer -> contents
            tabs = data.get("contents", {}).get("twoColumnBrowseResultsRenderer", {}).get("tabs", [])
            for tab in tabs:
                tab_content = tab.get("tabRenderer", {}).get("content", {})
                section_list = tab_content.get("sectionListRenderer", {}).get("contents", [])
                for section in section_list:
                    item_section = section.get("itemSectionRenderer", {}).get("contents", [])
                    for item in item_section:
                        pl_video_list = item.get("playlistVideoListRenderer", {}).get("contents", [])
                        for pl_video in pl_video_list:
                            renderer = pl_video.get("playlistVideoRenderer", {})
                            vid_id = renderer.get("videoId")
                            if vid_id:
                                vid_title = renderer.get("title", {}).get("runs", [{}])[0].get("text", f"Video {vid_id}")
                                channel = renderer.get("shortBylineText", {}).get("runs", [{}])[0].get("text", "")
                                duration = renderer.get("lengthText", {}).get("simpleText", "")
                                thumb = f"https://i.ytimg.com/vi/{vid_id}/hqdefault.jpg"
                                videos.append({
                                    "video_id": vid_id,
                                    "title": vid_title,
                                    "channel_title": channel,
                                    "thumbnail_url": thumb,
                                    "duration": duration
                                })
        except Exception as e:
            print(f"Error parsing playlist contents: {e}")
            
        return title, videos
    except Exception as e:
        print(f"Error requesting playlist: {e}")
        return f"Playlist {playlist_id}", []
