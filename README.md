# FAVYT 📺

**FAVYT** (Favorite YouTube) is a clean, dark-mode, personal YouTube favorites and custom playlist manager web application. 

**What does this project do?**
YouTube's native interface is heavily optimized to keep you scrolling through an endless feed of recommendations. FAVYT takes a different approach: it provides a minimal, distraction-free environment where you can focus *only* on the content you have explicitly chosen to save. It uses the official YouTube Data API to securely sync your 'Liked Videos' and custom playlists into a local, self-hosted interface. You can watch videos in a theater-like focus mode, organize your playlists, and automatically sync any deletions back to your YouTube account—all without ever seeing a single algorithmically generated recommendation.

*(Note: This entire project was **vibe coded**! Built seamlessly through iterative AI collaboration and natural language prompting.)*

---

## 📸 Screenshots

*(Add your screenshots here later)*
<!-- Example: ![Home Screen](docs/home.png) -->
<!-- Example: ![Focus Player](docs/player.png) -->

---

## ✨ Features

- **Collapsible Sidebar (☰):** Smooth drawer navigation with prominent, easy-to-read typography.
- **Smart Sorting:** *Favorites* pinned at the top, followed by your custom playlists sorted chronologically by the newest added video.
- **High-Speed Parallel YouTube Sync:** Uses multi-threaded fetching to sync hundreds of videos and dozens of playlists in seconds.
- **Two-Way Delete Synchronization:** Deleting a video in FAVYT automatically removes it from the playlist or unlikes it on YouTube.
- **Playlist Visibility Manager:** Easily choose and filter which playlists appear in your sidebar.
- **Distraction-Free Focus Player:** Built-in modal player with keyboard navigation (`Esc` to close, `Alt+Arrow` for next/previous).
- **Smart Watch Timer:** Automatically tracks your playback time. Pauses when the video is paused, and stops playback after your set time limit.
- **Persistent Local Database:** Stores all metadata in a local SQLite database (`favyt.db`).

---

## 🐳 Deployment (Docker)

The easiest and recommended way to deploy FAVYT is using Docker. By default, the application runs on port **8245** (to avoid conflicts with standard ports like 8080 or 3000).

### Option 1: Docker Compose (Recommended)

You can run the application easily using `docker-compose`. 
Here is the configuration used in the `docker-compose.yml` file:

```yaml
version: '3.8'

services:
  favyt:
    build: .
    image: favyt:latest
    container_name: favyt
    restart: unless-stopped
    ports:
      - "8245:8245"
    volumes:
      - ./data:/app/data
    environment:
      - DATA_DIR=/app/data
      - TZ=Europe/Berlin
```

**Steps to start:**
1. Clone or download this repository.
2. Open a terminal in the project directory.
3. Run the following command:

```bash
docker compose up -d --build
```

The application will be built and started in the background. 
You can now access it at `http://localhost:8245`.

To stop the container, run:
```bash
docker compose down
```

### Option 2: Manual Docker Build & Run

If you don't want to use Docker Compose, you can build and run the image manually:

```bash
# 1. Build the image
docker build -t favyt:latest .

# 2. Run the container with a mounted volume for data persistence
docker run -d \
  --name favyt \
  -p 8245:8245 \
  -v $(pwd)/data:/app/data \
  favyt:latest
```

---

## 🔑 Google YouTube Data API Setup

To enable synchronization with your personal YouTube account, you **must** create a project in the Google Cloud Console and configure an OAuth client. **If you skip adding the exact Redirect URI, the login will not work!**

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. **Create a new Project** (or select an existing one).
3. In the left sidebar, navigate to **APIs & Services > Library**.
   - Search for **YouTube Data API v3** and click **Enable**.
4. Navigate to **APIs & Services > OAuth consent screen**.
   - Choose **External** and fill out the required fields (App name, support email, developer contact). You don't need to submit it for verification if you just use it for yourself.
   - On the **Scopes** page, click **Add or Remove Scopes** and add the following required permissions so FAVYT can read your playlists and sync likes/deletions:
     - `https://www.googleapis.com/auth/youtube.readonly`
     - `https://www.googleapis.com/auth/youtube`
     - `https://www.googleapis.com/auth/userinfo.profile`
   - Add your own Google Account email under **Test users**.
5. Navigate to **APIs & Services > Credentials**.
   - Click **Create Credentials > OAuth client ID**.
   - **Application type:** `Web application`
   - **Name:** `FAVYT` (or whatever you prefer)
   - **Authorized redirect URIs:** *THIS IS CRITICAL!* You must add the exact URL where your FAVYT instance is running, followed by `/api/auth/callback`. 
     - *Example for local use:* `http://localhost:8245/api/auth/callback`
     - *(If you host it on a server/domain, add that domain accordingly, e.g., `https://my-domain.com/api/auth/callback`)*
6. Click **Create** and copy your **Client ID** and **Client Secret**.
7. Open FAVYT in your browser, click the **Login & Sync** button in the top right corner, paste your credentials, and sign in.

---

## 💻 Local Development / Windows Start

If you prefer to run the application natively without Docker:

1. Run the included batch script `start.bat` (Windows).
   *Or manually install requirements and run:*
   ```bash
   pip install -r requirements.txt
   python -m uvicorn backend.app:app --host 127.0.0.1 --port 8245 --reload
   ```
2. Open `http://localhost:8245` in your web browser.

---

## 📁 Volume & Data Persistence

All settings and synced playlists are stored in SQLite inside the container at `/app/data/favyt.db`.  
Both the `docker-compose.yml` and the manual Docker run command mount a local `./data` folder to `/app/data` to ensure all data is preserved during container updates.
