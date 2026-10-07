import requests
import urllib.parse
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from .database import get_db

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3"

SCOPES = [
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/youtube",
    "https://www.googleapis.com/auth/userinfo.profile"
]

def get_oauth_config():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT key, value FROM settings WHERE key IN ('google_client_id', 'google_client_secret', 'google_redirect_uri')")
    rows = dict(cursor.fetchall())
    conn.close()
    
    return {
        "client_id": rows.get("google_client_id", "").strip(),
        "client_secret": rows.get("google_client_secret", "").strip(),
        "redirect_uri": rows.get("google_redirect_uri", "http://localhost:8245/api/auth/callback").strip()
    }

def get_auth_url():
    config = get_oauth_config()
    if not config["client_id"]:
        return None
        
    params = {
        "client_id": config["client_id"],
        "redirect_uri": config["redirect_uri"],
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent select_account",
        "include_granted_scopes": "true"
    }
    return f"{GOOGLE_AUTH_URL}?{urllib.parse.urlencode(params)}"

def exchange_code_for_tokens(code: str):
    config = get_oauth_config()
    data = {
        "code": code,
        "client_id": config["client_id"],
        "client_secret": config["client_secret"],
        "redirect_uri": config["redirect_uri"],
        "grant_type": "authorization_code"
    }
    
    res = requests.post(GOOGLE_TOKEN_URL, data=data, timeout=15)
    if res.status_code != 200:
        raise Exception(f"Error fetching Google OAuth token: {res.text}")
        
    token_data = res.json()
    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")
    
    headers = {"Authorization": f"Bearer {access_token}"}
    chan_res = requests.get(
        f"{YOUTUBE_API_BASE}/channels?part=snippet,contentDetails&mine=true",
        headers=headers,
        timeout=10
    )
    
    channel_name = "YouTube User"
    channel_avatar = ""
    liked_playlist_id = "LL"
    
    if chan_res.status_code == 200:
        chan_data = chan_res.json()
        items = chan_data.get("items", [])
        if items:
            snippet = items[0].get("snippet", {})
            channel_name = snippet.get("title", channel_name)
            channel_avatar = snippet.get("thumbnails", {}).get("default", {}).get("url", "")
            related = items[0].get("contentDetails", {}).get("relatedPlaylists", {})
            liked_playlist_id = related.get("likes", "LL")
            
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('google_access_token', ?)", (access_token,))
    if refresh_token:
        cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('google_refresh_token', ?)", (refresh_token,))
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('google_user_name', ?)", (channel_name,))
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('google_user_avatar', ?)", (channel_avatar,))
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('google_liked_playlist_id', ?)", (liked_playlist_id,))
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('google_auth_connected', 'true')")
    conn.commit()
    conn.close()
    
    return {
        "channel_name": channel_name,
        "channel_avatar": channel_avatar
    }

def get_valid_access_token():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT key, value FROM settings WHERE key IN ('google_access_token', 'google_refresh_token')")
    tokens = dict(cursor.fetchall())
    conn.close()
    
    access_token = tokens.get("google_access_token")
    refresh_token = tokens.get("google_refresh_token")
    
    if not access_token and not refresh_token:
        return None
        
    config = get_oauth_config()
    headers = {"Authorization": f"Bearer {access_token}"}
    try:
        test_res = requests.get(f"{YOUTUBE_API_BASE}/channels?part=id&mine=true", headers=headers, timeout=5)
        if test_res.status_code == 200:
            return access_token
    except Exception:
        pass
        
    if refresh_token and config["client_id"] and config["client_secret"]:
        refresh_data = {
            "client_id": config["client_id"],
            "client_secret": config["client_secret"],
            "refresh_token": refresh_token,
            "grant_type": "refresh_token"
        }
        try:
            ref_res = requests.post(GOOGLE_TOKEN_URL, data=refresh_data, timeout=10)
            if ref_res.status_code == 200:
                new_data = ref_res.json()
                new_access_token = new_data.get("access_token")
                conn = get_db()
                cursor = conn.cursor()
                cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('google_access_token', ?)", (new_access_token,))
                conn.commit()
                conn.close()
                return new_access_token
        except Exception:
            pass
            
    return None

def fetch_all_playlist_items(headers: dict, playlist_id: str, max_items: int = 500) -> list[dict]:
    """Fetch all items from a playlist using YouTube pagination."""
    items = []
    page_token = None
    
    while len(items) < max_items:
        url = f"{YOUTUBE_API_BASE}/playlistItems?part=snippet,contentDetails&playlistId={playlist_id}&maxResults=50"
        if page_token:
            url += f"&pageToken={page_token}"
            
        try:
            res = requests.get(url, headers=headers, timeout=10)
            if res.status_code != 200:
                break
            data = res.json()
            page_items = data.get("items", [])
            if not page_items:
                break
            items.extend(page_items)
            page_token = data.get("nextPageToken")
            if not page_token:
                break
        except Exception:
            break
            
    return items

def _fetch_playlist_worker(args):
    """Worker function to fetch videos for a single playlist in parallel."""
    headers, yt_pl_id, local_id, pl_title, max_videos_per_pl, now = args
    v_items = fetch_all_playlist_items(headers, yt_pl_id, max_items=max_videos_per_pl)
    
    parsed_videos = []
    for v in v_items:
        snippet = v.get("snippet", {})
        content_details = v.get("contentDetails", {})
        v_id = snippet.get("resourceId", {}).get("videoId") or content_details.get("videoId")
        title = snippet.get("title", "")
        if v_id and title and title != "Private video" and title != "Deleted video":
            channel = snippet.get("videoOwnerChannelTitle", snippet.get("channelTitle", ""))
            thumb = snippet.get("thumbnails", {}).get("high", {}).get("url", f"https://i.ytimg.com/vi/{v_id}/hqdefault.jpg")
            added = snippet.get("publishedAt", now)
            published = content_details.get("videoPublishedAt") or added
            parsed_videos.append((local_id, v_id, title, channel, thumb, added, published))
            
    return local_id, pl_title, parsed_videos

def sync_youtube_account(max_videos_per_pl: int = 500):
    """
    Fast, parallelized sync of Liked Videos (Favoriten) and all user playlists.
    Uses ThreadPoolExecutor for high-speed concurrent fetching.
    """
    token = get_valid_access_token()
    if not token:
        raise Exception("Not authenticated with YouTube or session expired.")
        
    headers = {"Authorization": f"Bearer {token}"}
    now = datetime.utcnow().isoformat() + "Z"
    
    # 1. Sync Liked Videos -> "favorites"
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM settings WHERE key = 'google_liked_playlist_id'")
    row = cursor.fetchone()
    liked_pl_id = row[0] if row else "LL"
    conn.close()
    
    liked_items = fetch_all_playlist_items(headers, liked_pl_id, max_items=max_videos_per_pl)
    
    # 2. Fetch list of all user playlists
    all_playlists = []
    pl_page_token = None
    while True:
        pl_url = f"{YOUTUBE_API_BASE}/playlists?part=snippet,contentDetails&mine=true&maxResults=50"
        if pl_page_token:
            pl_url += f"&pageToken={pl_page_token}"
        try:
            pl_res = requests.get(pl_url, headers=headers, timeout=10)
            if pl_res.status_code != 200:
                break
            pl_data = pl_res.json()
            all_playlists.extend(pl_data.get("items", []))
            pl_page_token = pl_data.get("nextPageToken")
            if not pl_page_token:
                break
        except Exception:
            break

    # 3. Parallel fetch video items for all playlists
    worker_args = []
    for pl_item in all_playlists:
        yt_pl_id = pl_item.get("id")
        pl_title = pl_item.get("snippet", {}).get("title", f"Playlist {yt_pl_id}")
        local_id = f"yt_{yt_pl_id}"
        worker_args.append((headers, yt_pl_id, local_id, pl_title, max_videos_per_pl, now))

    playlist_results = []
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(_fetch_playlist_worker, arg) for arg in worker_args]
        for f in as_completed(futures):
            try:
                playlist_results.append(f.result())
            except Exception as e:
                print(f"Error fetching playlist videos: {e}")

    # 4. Save everything to SQLite in a single transaction
    conn = get_db()
    cursor = conn.cursor()
    
    # Save favorites
    imported_favorites = 0
    for item in liked_items:
        snippet = item.get("snippet", {})
        content_details = item.get("contentDetails", {})
        vid_id = snippet.get("resourceId", {}).get("videoId") or content_details.get("videoId")
        title = snippet.get("title", "")
        if vid_id and title and title != "Private video" and title != "Deleted video":
            channel = snippet.get("videoOwnerChannelTitle", snippet.get("channelTitle", ""))
            thumb = snippet.get("thumbnails", {}).get("high", {}).get("url", f"https://i.ytimg.com/vi/{vid_id}/hqdefault.jpg")
            added = snippet.get("publishedAt", now)
            published = content_details.get("videoPublishedAt") or added
            try:
                cursor.execute("""
                    INSERT OR IGNORE INTO videos (playlist_id, video_id, title, channel_title, thumbnail_url, duration, added_at, published_at)
                    VALUES ('favorites', ?, ?, ?, ?, '', ?, ?)
                """, (vid_id, title, channel, thumb, added, published))
                cursor.execute("""
                    UPDATE videos SET published_at = COALESCE(published_at, ?) WHERE playlist_id = 'favorites' AND video_id = ?
                """, (published, vid_id))
                imported_favorites += 1
            except Exception:
                pass
                
    if imported_favorites > 0:
        cursor.execute("UPDATE playlists SET last_modified = ? WHERE id = 'favorites'", (now,))

    # Save user playlists and their videos
    total_videos_synced = imported_favorites
    for local_id, pl_title, parsed_videos in playlist_results:
        cursor.execute("SELECT id FROM playlists WHERE id = ?", (local_id,))
        if not cursor.fetchone():
            cursor.execute("""
                INSERT INTO playlists (id, title, icon, is_system, is_visible, created_at, last_modified, last_viewed)
                VALUES (?, ?, 'list-video', 0, 1, ?, ?, ?)
            """, (local_id, pl_title, now, now, now))
        else:
            cursor.execute("UPDATE playlists SET title = ? WHERE id = ?", (pl_title, local_id))

        for (pl_id, v_id, v_title, v_channel, v_thumb, v_added, v_published) in parsed_videos:
            try:
                cursor.execute("""
                    INSERT OR IGNORE INTO videos (playlist_id, video_id, title, channel_title, thumbnail_url, duration, added_at, published_at)
                    VALUES (?, ?, ?, ?, ?, '', ?, ?)
                """, (pl_id, v_id, v_title, v_channel, v_thumb, v_added, v_published))
                cursor.execute("""
                    UPDATE videos SET published_at = COALESCE(published_at, ?) WHERE playlist_id = ? AND video_id = ?
                """, (v_published, pl_id, v_id))
                total_videos_synced += 1
            except Exception:
                pass
                
        cursor.execute("UPDATE playlists SET last_modified = ? WHERE id = ?", (now, local_id))

    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('google_last_sync', ?)", (now,))
    conn.commit()
    conn.close()

    return {
        "status": "success",
        "favorites_synced": imported_favorites,
        "playlists_synced": len(all_playlists),
        "total_videos_synced": total_videos_synced,
        "synced_at": now
    }

def delete_video_from_youtube(playlist_id: str, video_id: str) -> dict:
    """
    Deletes a video from the corresponding YouTube playlist or unlikes it if in Favorites.
    """
    token = get_valid_access_token()
    if not token:
        return {"success": False, "reason": "No valid YouTube token"}

    headers = {"Authorization": f"Bearer {token}"}

    # 1. Favorites: Remove 'Like' rating
    if playlist_id == "favorites":
        try:
            url = f"{YOUTUBE_API_BASE}/videos/rate?id={video_id}&rating=none"
            res = requests.post(url, headers=headers, timeout=10)
            if res.status_code in (200, 204):
                return {"success": True, "type": "favorite_unliked"}
            return {"success": False, "status_code": res.status_code, "error": res.text}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # 2. Custom YouTube Playlist (yt_<id>)
    if playlist_id.startswith("yt_"):
        yt_pl_id = playlist_id[3:]
        try:
            # Query the specific playlistItemId for this video in the playlist
            find_url = f"{YOUTUBE_API_BASE}/playlistItems?part=id,snippet&playlistId={yt_pl_id}&videoId={video_id}&maxResults=10"
            res = requests.get(find_url, headers=headers, timeout=10)
            items = []
            if res.status_code == 200:
                items = res.json().get("items", [])
            
            # If not found via videoId filter, scan playlist items
            if not items:
                scan_url = f"{YOUTUBE_API_BASE}/playlistItems?part=id,snippet&playlistId={yt_pl_id}&maxResults=50"
                res_scan = requests.get(scan_url, headers=headers, timeout=10)
                if res_scan.status_code == 200:
                    for it in res_scan.json().get("items", []):
                        if it.get("snippet", {}).get("resourceId", {}).get("videoId") == video_id:
                            items.append(it)

            deleted_count = 0
            for it in items:
                item_id = it.get("id")
                if item_id:
                    del_url = f"{YOUTUBE_API_BASE}/playlistItems?id={item_id}"
                    del_res = requests.delete(del_url, headers=headers, timeout=10)
                    if del_res.status_code in (200, 204):
                        deleted_count += 1

            if deleted_count > 0:
                return {"success": True, "type": "playlist_item_deleted", "deleted_count": deleted_count}
            return {"success": False, "reason": "Playlist item not found on YouTube"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    return {"success": False, "reason": "Local-only playlist"}

def delete_playlist_from_youtube(playlist_id: str) -> dict:
    """
    Deletes a playlist from the user's YouTube account.
    """
    if not playlist_id.startswith("yt_"):
        return {"success": False, "reason": "Not a YouTube playlist"}

    token = get_valid_access_token()
    if not token:
        return {"success": False, "reason": "No valid YouTube token"}

    yt_pl_id = playlist_id[3:]
    headers = {"Authorization": f"Bearer {token}"}
    try:
        url = f"{YOUTUBE_API_BASE}/playlists?id={yt_pl_id}"
        res = requests.delete(url, headers=headers, timeout=10)
        if res.status_code in (200, 204):
            return {"success": True}
        return {"success": False, "status_code": res.status_code, "error": res.text}
    except Exception as e:
        return {"success": False, "error": str(e)}

