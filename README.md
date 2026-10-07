# FAVYT 📺

**FAVYT** (Favorite YouTube) is a clean, dark-mode, personal YouTube favorites and custom playlist manager web application. 

**What does this project do?**
YouTube's native interface is heavily optimized to keep you scrolling through an endless feed of recommendations. FAVYT takes a different approach: it provides a minimal, distraction-free environment where you can focus *only* on the content you have explicitly chosen to save. It uses the official YouTube Data API to securely sync your 'Liked Videos' and custom playlists into a local, self-hosted interface. You can watch videos in a theater-like focus mode, organize your playlists, and automatically sync any deletions back to your YouTube account—all without ever seeing a single algorithmically generated recommendation.

*(Note: This entire project was **vibe coded**! Built seamlessly through iterative AI collaboration and natural language prompting.)*

---


---

## ?? Google YouTube Data API Setup

To enable synchronization with your personal YouTube account, you **must** create a project in the Google Cloud Console and configure an OAuth client. **If you skip adding the exact Redirect URI, the login will not work!**

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. **Create a new Project** (or select an existing one).
3. In the left sidebar, navigate to **APIs & Services > Library**.
   - Search for **YouTube Data API v3** and click **Enable**.
4. Navigate to **APIs & Services > OAuth consent screen**.
   - Choose **External** and fill out the required fields (App name, support email, developer contact). You don't need to submit it for verification if you just use it for yourself.
   - On the **Scopes** page, click **Add or Remove Scopes** and add the following required permissions so FAVYT can read your playlists and sync likes/deletions:
     - https://www.googleapis.com/auth/youtube.readonly
     - https://www.googleapis.com/auth/youtube
     - https://www.googleapis.com/auth/userinfo.profile
   - Add your own Google Account email under **Test users**.
5. Navigate to **APIs & Services > Credentials**.
   - Click **Create Credentials > OAuth client ID**.
   - **Application type:** Web application
   - **Name:** FAVYT (or whatever you prefer)
   - **Authorized redirect URIs:** *THIS IS CRITICAL!* You must add the exact URL where your FAVYT instance is running, followed by /api/auth/callback. 
     - *Example for local use:* http://localhost:8245/api/auth/callback
     - *(If you host it on a server/domain, add that domain accordingly, e.g., https://my-domain.com/api/auth/callback)*
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
