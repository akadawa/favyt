import sqlite3
import json
import os
from datetime import datetime

DATA_DIR = os.getenv("DATA_DIR", os.path.dirname(os.path.abspath(__file__)))
os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = os.getenv("DB_PATH", os.path.join(DATA_DIR, "favyt.db"))

def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=20.0)
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.row_factory = sqlite3.Row
    return conn

def init_db(reset: bool = False):
    conn = get_db()
    cursor = conn.cursor()
    
    if reset:
        cursor.execute("DROP TABLE IF EXISTS videos")
        cursor.execute("DROP TABLE IF EXISTS playlists")
        cursor.execute("DROP TABLE IF EXISTS settings")

    # Playlists table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS playlists (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        icon TEXT NOT NULL DEFAULT 'folder',
        is_system INTEGER NOT NULL DEFAULT 0,
        is_visible INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        last_modified TEXT NOT NULL,
        last_viewed TEXT NOT NULL
    )
    """)
    
    # Check if is_visible exists in existing tables
    cursor.execute("PRAGMA table_info(playlists)")
    columns = [col[1] for col in cursor.fetchall()]
    if "is_visible" not in columns:
        cursor.execute("ALTER TABLE playlists ADD COLUMN is_visible INTEGER NOT NULL DEFAULT 1")
    
    # Videos table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS videos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        playlist_id TEXT NOT NULL,
        video_id TEXT NOT NULL,
        title TEXT NOT NULL,
        channel_title TEXT,
        thumbnail_url TEXT,
        duration TEXT,
        added_at TEXT NOT NULL,
        notes TEXT,
        is_watched INTEGER NOT NULL DEFAULT 0,
        watch_progress REAL NOT NULL DEFAULT 0.0,
        last_position_seconds REAL NOT NULL DEFAULT 0.0,
        FOREIGN KEY (playlist_id) REFERENCES playlists (id) ON DELETE CASCADE,
        UNIQUE(playlist_id, video_id)
    )
    """)
    
    # Check if is_watched and watch_progress exist in existing tables
    cursor.execute("PRAGMA table_info(videos)")
    v_cols = [col[1] for col in cursor.fetchall()]
    if "is_watched" not in v_cols:
        cursor.execute("ALTER TABLE videos ADD COLUMN is_watched INTEGER NOT NULL DEFAULT 0")
    if "watch_progress" not in v_cols:
        cursor.execute("ALTER TABLE videos ADD COLUMN watch_progress REAL NOT NULL DEFAULT 0.0")
    if "last_position_seconds" not in v_cols:
        cursor.execute("ALTER TABLE videos ADD COLUMN last_position_seconds REAL NOT NULL DEFAULT 0.0")
    if "published_at" not in v_cols:
        cursor.execute("ALTER TABLE videos ADD COLUMN published_at TEXT")
    
    # Settings table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )
    """)
    
    # Insert default system playlist if not present
    now = datetime.utcnow().isoformat() + "Z"
    cursor.execute("SELECT COUNT(*) FROM playlists WHERE id = 'favorites'")
    if cursor.fetchone()[0] == 0:
        cursor.execute(
            "INSERT INTO playlists (id, title, icon, is_system, is_visible, created_at, last_modified, last_viewed) VALUES (?, ?, ?, 1, 1, ?, ?, ?)",
            ("favorites", "Favorites", "star", now, now, now)
        )
    else:
        # Ensure English name if it was German
        cursor.execute("UPDATE playlists SET title = 'Favorites' WHERE id = 'favorites' AND title = 'Favoriten'")
        
    # Default settings
    default_settings = {
        "default_startup_view": "favorites",
        "last_selected_tab": "favorites",
        "player_mode": "modal",
        "player_modal_size": "large",
        "sleep_timer_minutes": "0",
        "theme": "dark"
    }
    for k, v in default_settings.items():
        cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (k, v))
        
    conn.commit()
    conn.close()

def reset_all_data():
    """Completely resets database to a fresh, clean state."""
    init_db(reset=True)

if __name__ == "__main__":
    init_db()
    print("Database initialized successfully at:", DB_PATH)
