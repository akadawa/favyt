import os
import uuid
from datetime import datetime
from typing import Optional, List
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import RedirectResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .database import get_db, init_db, reset_all_data
from .youtube_helper import extract_video_id, fetch_video_metadata, import_public_playlist
from .google_auth import (
    get_oauth_config,
    get_auth_url,
    exchange_code_for_tokens,
    sync_youtube_account,
    get_valid_access_token,
    delete_video_from_youtube,
    delete_playlist_from_youtube
)

# Ensure DB exists
init_db()

app = FastAPI(title="FAVYT")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_no_cache_headers(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

class PlaylistCreate(BaseModel):
    title: str
    icon: Optional[str] = "folder"
    import_url: Optional[str] = None

class PlaylistUpdate(BaseModel):
    title: Optional[str] = None
    icon: Optional[str] = None

class VideoAdd(BaseModel):
    url_or_id: str
    notes: Optional[str] = None
    playlist_id: Optional[str] = None

class SettingUpdate(BaseModel):
    key: str
    value: str

class BulkSettingsPayload(BaseModel):
    default_startup_view: Optional[str] = None
    player_mode: Optional[str] = None
    player_modal_size: Optional[str] = None
    sleep_timer_minutes: Optional[int] = None
    visibility_map: Optional[dict] = None

class WatchStatusPayload(BaseModel):
    progress: Optional[float] = 0.0
    last_position_seconds: Optional[float] = 0.0
    is_watched: Optional[bool] = None

class GoogleCredentials(BaseModel):
    client_id: str
    client_secret: str

@app.get("/api/playlists")
def get_playlists():
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT p.*, COUNT(v.id) as video_count 
        FROM playlists p 
        LEFT JOIN videos v ON p.id = v.playlist_id 
        GROUP BY p.id
    """)
    rows = cursor.fetchall()
    playlists = [dict(row) for row in rows]
    
    for p in playlists:
        cursor.execute("""
            SELECT * FROM videos 
            WHERE playlist_id = ? 
            ORDER BY id DESC
        """, (p["id"],))
        p["videos"] = [dict(v) for v in cursor.fetchall()]
        
    conn.close()
    return playlists

@app.post("/api/playlists")
def create_playlist(data: PlaylistCreate):
    title = data.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title cannot be empty.")
        
    p_id = "pl_" + uuid.uuid4().hex[:8]
    now = datetime.utcnow().isoformat() + "Z"
    
    conn = get_db()
    cursor = conn.cursor()
    
    imported_videos = []
    if data.import_url:
        import_title, videos = import_public_playlist(data.import_url)
        if not title or title == "New Playlist":
            title = import_title
        imported_videos = videos
        
    cursor.execute(
        "INSERT INTO playlists (id, title, icon, is_system, created_at, last_modified, last_viewed) VALUES (?, ?, ?, 0, ?, ?, ?)",
        (p_id, title, data.icon or "folder", now, now, now)
    )
    
    for v in imported_videos:
        try:
            cursor.execute("""
                INSERT OR IGNORE INTO videos (playlist_id, video_id, title, channel_title, thumbnail_url, duration, added_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (p_id, v["video_id"], v["title"], v["channel_title"], v["thumbnail_url"], v.get("duration", ""), now))
        except Exception:
            pass
            
    conn.commit()
    conn.close()
    
    return {"id": p_id, "title": title, "imported_count": len(imported_videos)}

@app.put("/api/playlists/{playlist_id}")
def update_playlist(playlist_id: str, data: PlaylistUpdate):
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM playlists WHERE id = ?", (playlist_id,))
    existing = cursor.fetchone()
    if not existing:
        conn.close()
        raise HTTPException(status_code=404, detail="Playlist not found.")
        
    new_title = data.title if data.title is not None else existing["title"]
    new_icon = data.icon if data.icon is not None else existing["icon"]
    
    cursor.execute(
        "UPDATE playlists SET title = ?, icon = ? WHERE id = ?",
        (new_title, new_icon, playlist_id)
    )
    conn.commit()
    conn.close()
    return {"status": "success"}

@app.post("/api/playlists/toggle-visibility")
def toggle_playlist_visibility(data: dict):
    playlist_id = data.get("playlist_id")
    is_visible = 1 if data.get("is_visible", True) else 0
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("UPDATE playlists SET is_visible = ? WHERE id = ?", (is_visible, playlist_id))
    conn.commit()
    conn.close()
    return {"status": "updated", "playlist_id": playlist_id, "is_visible": is_visible}

@app.post("/api/playlists/set-all-visibility")
def set_all_visibility(data: dict):
    is_visible = 1 if data.get("is_visible", True) else 0
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("UPDATE playlists SET is_visible = ?", (is_visible,))
    conn.commit()
    conn.close()
    return {"status": "updated", "is_visible": is_visible}

@app.delete("/api/playlists/{playlist_id}")
def delete_playlist(playlist_id: str):
    if playlist_id == "favorites":
        raise HTTPException(status_code=400, detail="System playlists cannot be deleted.")
        
    yt_res = None
    if playlist_id.startswith("yt_"):
        try:
            yt_res = delete_playlist_from_youtube(playlist_id)
        except Exception as e:
            print(f"Error deleting playlist on YouTube: {e}")

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM videos WHERE playlist_id = ?", (playlist_id,))
    cursor.execute("DELETE FROM playlists WHERE id = ?", (playlist_id,))
    conn.commit()
    conn.close()
    return {"status": "deleted", "yt_result": yt_res}

@app.post("/api/playlists/{playlist_id}/touch")
def touch_playlist(playlist_id: str):
    now = datetime.utcnow().isoformat() + "Z"
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("UPDATE playlists SET last_viewed = ? WHERE id = ?", (now, playlist_id))
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_selected_tab', ?)", (playlist_id,))
    conn.commit()
    conn.close()
    return {"status": "touched", "last_viewed": now}

@app.post("/api/playlists/{playlist_id}/videos")
def add_video_to_playlist(playlist_id: str, data: VideoAdd):
    video_id = extract_video_id(data.url_or_id)
    if not video_id:
        raise HTTPException(status_code=400, detail="Invalid YouTube Video URL or ID.")
        
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("SELECT id FROM playlists WHERE id = ?", (playlist_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Playlist does not exist.")
        
    meta = fetch_video_metadata(video_id)
    now = datetime.utcnow().isoformat() + "Z"
    
    try:
        cursor.execute("""
            INSERT INTO videos (playlist_id, video_id, title, channel_title, thumbnail_url, duration, added_at, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (playlist_id, video_id, meta["title"], meta["channel_title"], meta["thumbnail_url"], meta.get("duration", ""), now, data.notes or ""))
    except Exception:
        cursor.execute("""
            UPDATE videos SET added_at = ?, notes = COALESCE(?, notes) 
            WHERE playlist_id = ? AND video_id = ?
        """, (now, data.notes, playlist_id, video_id))
        
    cursor.execute("UPDATE playlists SET last_modified = ?, last_viewed = ? WHERE id = ?", (now, now, playlist_id))
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_selected_tab', ?)", (playlist_id,))
    
    conn.commit()
    conn.close()
    
    return {"status": "added", "video": meta}

@app.delete("/api/playlists/{playlist_id}/videos/{video_id}")
def delete_video_from_playlist(playlist_id: str, video_id: str):
    yt_res = None
    try:
        yt_res = delete_video_from_youtube(playlist_id, video_id)
    except Exception as e:
        print(f"Error removing video from YouTube: {e}")

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM videos WHERE playlist_id = ? AND video_id = ?", (playlist_id, video_id))
    now = datetime.utcnow().isoformat() + "Z"
    cursor.execute("UPDATE playlists SET last_modified = ? WHERE id = ?", (now, playlist_id))
    conn.commit()
    conn.close()
    return {"status": "deleted", "yt_result": yt_res}

@app.post("/api/videos/{video_id}/watch-status")
def update_video_watch_status(video_id: str, data: WatchStatusPayload):
    conn = get_db()
    cursor = conn.cursor()
    
    pos_sec = round(data.last_position_seconds or 0.0, 1)
    if data.is_watched is not None:
        is_w = 1 if data.is_watched else 0
        prog = 100.0 if data.is_watched else 0.0
        final_pos = 0.0 if not data.is_watched else pos_sec
        cursor.execute("UPDATE videos SET is_watched = ?, watch_progress = ?, last_position_seconds = ? WHERE video_id = ?", (is_w, prog, final_pos, video_id))
    else:
        prog = round(data.progress or 0.0, 1)
        is_w = 1 if prog >= 70.0 else 0
        cursor.execute("UPDATE videos SET is_watched = MAX(is_watched, ?), watch_progress = MAX(watch_progress, ?), last_position_seconds = ? WHERE video_id = ?", (is_w, prog, pos_sec, video_id))
        
    conn.commit()
    conn.close()
    return {"status": "updated", "video_id": video_id, "is_watched": is_w, "watch_progress": prog, "last_position_seconds": pos_sec}

@app.post("/api/import-playlist")
def import_playlist_endpoint(data: dict):
    url = data.get("url", "")
    target_playlist_id = data.get("target_playlist_id")
    
    title, videos = import_public_playlist(url)
    if not videos:
        raise HTTPException(status_code=400, detail="Could not load videos from playlist. Is it public or unlisted?")
        
    conn = get_db()
    cursor = conn.cursor()
    now = datetime.utcnow().isoformat() + "Z"
    
    if not target_playlist_id:
        p_id = "pl_" + uuid.uuid4().hex[:8]
        cursor.execute(
            "INSERT INTO playlists (id, title, icon, is_system, created_at, last_modified, last_viewed) VALUES (?, ?, 'list-video', 0, ?, ?, ?)",
            (p_id, title, now, now, now)
        )
        target_playlist_id = p_id
    else:
        cursor.execute("UPDATE playlists SET last_modified = ?, last_viewed = ? WHERE id = ?", (now, now, target_playlist_id))
        
    for v in videos:
        try:
            cursor.execute("""
                INSERT OR IGNORE INTO videos (playlist_id, video_id, title, channel_title, thumbnail_url, duration, added_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (target_playlist_id, v["video_id"], v["title"], v["channel_title"], v["thumbnail_url"], v.get("duration", ""), now))
        except Exception:
            pass
            
    conn.commit()
    conn.close()
    
    return {"playlist_id": target_playlist_id, "title": title, "imported_count": len(videos)}

# --- Google / YouTube OAuth2 Endpoints ---

@app.get("/api/auth/status")
def get_auth_status():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT key, value FROM settings WHERE key LIKE 'google_%'")
    settings = dict(cursor.fetchall())
    conn.close()
    
    token = get_valid_access_token()
    is_connected = bool(token)
    
    return {
        "connected": is_connected,
        "channel_name": settings.get("google_user_name", ""),
        "channel_avatar": settings.get("google_user_avatar", ""),
        "last_sync": settings.get("google_last_sync", ""),
        "has_client_credentials": bool(settings.get("google_client_id") and settings.get("google_client_secret"))
    }

@app.post("/api/auth/save-credentials")
def save_google_credentials(data: GoogleCredentials):
    cid = data.client_id.strip()
    csec = data.client_secret.strip()
    if not cid or not csec:
        raise HTTPException(status_code=400, detail="Client ID and Client Secret are required.")
        
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('google_client_id', ?)", (cid,))
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('google_client_secret', ?)", (csec,))
    conn.commit()
    conn.close()
    
    auth_url = get_auth_url()
    return {"status": "saved", "auth_url": auth_url}

@app.get("/api/auth/login")
def google_login_redirect():
    url = get_auth_url()
    if not url:
        raise HTTPException(status_code=400, detail="Google API credentials missing. Please configure them in Settings.")
    return RedirectResponse(url)

@app.get("/api/auth/callback")
def google_oauth_callback(code: Optional[str] = None, error: Optional[str] = None):
    if error or not code:
        return HTMLResponse(f"<h3>Login cancelled or failed: {error}</h3><p><a href='/'>Back to App</a></p>")
        
    try:
        exchange_code_for_tokens(code)
        # Trigger initial sync
        sync_youtube_account()
        return RedirectResponse("/?login_success=1")
    except Exception as e:
        return HTMLResponse(f"<h3>Error during YouTube login:</h3><p>{e}</p><p><a href='/'>Back</a></p>")

@app.post("/api/auth/sync")
def trigger_sync():
    try:
        res = sync_youtube_account()
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/auth/logout")
def google_logout():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM settings WHERE key LIKE 'google_%' AND key NOT IN ('google_client_id', 'google_client_secret')")
    conn.commit()
    conn.close()
    return {"status": "logged_out"}

# Settings
@app.get("/api/settings")
def get_settings():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT key, value FROM settings")
    settings = {row["key"]: row["value"] for row in cursor.fetchall()}
    conn.close()
    return settings

@app.post("/api/settings")
def update_setting(data: SettingUpdate):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (data.key, data.value))
    conn.commit()
    conn.close()
    return {"status": "saved"}

@app.post("/api/settings/save-all")
def save_all_settings(data: BulkSettingsPayload):
    conn = get_db()
    cursor = conn.cursor()
    
    if data.default_startup_view:
        cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('default_startup_view', ?)", (data.default_startup_view,))
    if data.player_mode:
        cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('player_mode', ?)", (data.player_mode,))
    if data.player_modal_size:
        cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('player_modal_size', ?)", (data.player_modal_size,))
    if data.sleep_timer_minutes is not None:
        cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('sleep_timer_minutes', ?)", (str(data.sleep_timer_minutes),))
        
    if data.visibility_map is not None:
        for p_id, is_vis in data.visibility_map.items():
            val = 1 if is_vis else 0
            cursor.execute("UPDATE playlists SET is_visible = ? WHERE id = ?", (val, p_id))
            
    conn.commit()
    conn.close()
    return {"status": "saved"}

@app.post("/api/settings/factory-reset")
def factory_reset():
    reset_all_data()
    return {"status": "success", "message": "All data and settings have been reset to factory defaults."}

# Static Frontend
frontend_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
if os.path.exists(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
