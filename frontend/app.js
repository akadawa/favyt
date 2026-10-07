// State Management
const initialSavedActiveTab = localStorage.getItem("favyt_active_playlist_id");
const initialSavedActiveTitle = localStorage.getItem("favyt_active_playlist_title");

let playlists = [];
let activePlaylistId = initialSavedActiveTab || "favorites";
let currentVideos = [];
let filteredVideos = [];
let currentPlayingIndex = 0;
let isSyncing = false;
let syncStatusTimer = null;

let authStatus = {
  connected: false,
  channel_name: "",
  channel_avatar: "",
  last_sync: "",
  has_client_credentials: false
};

let appSettings = {
  default_startup_view: "favorites",
  last_selected_tab: "favorites",
  player_mode: "modal",
  player_modal_size: "large",
  sleep_timer_minutes: 0
};

let settingsDraft = {
  default_startup_view: "favorites",
  player_mode: "modal",
  player_modal_size: "large",
  sleep_timer_minutes: 0,
  visibility_map: {}
};

function applyPlayerModalSize(size) {
  const dialog = document.querySelector(".player-modal-dialog");
  if (!dialog) return;
  dialog.classList.remove("size-compact", "size-medium", "size-large", "size-theater", "size-cinema");
  const validSize = ["compact", "medium", "large", "theater", "cinema"].includes(size) ? size : "large";
  dialog.classList.add(`size-${validSize}`);
}

// Playback Sleep Timer State & Controller
let sleepTimerMinutes = 0;
let sleepTimerSecondsRemaining = 0;
let sleepTimerInterval = null;
let isSleepTimerRunning = false;
let isSleepTimerPaused = false;

function initOrUpdateSleepTimerUI() {
  const modalBtn = document.getElementById("btn-player-sleep-timer");
  const modalLabel = document.getElementById("player-sleep-timer-label");
  const headerBtn = document.getElementById("btn-header-timer");
  const headerLabel = document.getElementById("header-timer-label");

  let formattedTime = "";
  if (isSleepTimerRunning && sleepTimerSecondsRemaining > 0) {
    const h = Math.floor(sleepTimerSecondsRemaining / 3600);
    const m = Math.floor((sleepTimerSecondsRemaining % 3600) / 60);
    const s = sleepTimerSecondsRemaining % 60;
    const pad = n => n < 10 ? '0' + n : n;
    
    if (h > 0) {
      formattedTime = h + ":" + pad(m) + ":" + pad(s);
    } else {
      formattedTime = pad(m) + ":" + pad(s);
    }
  }

  // Update Player Modal Button
  if (modalBtn && modalLabel) {
    if (isSleepTimerRunning && sleepTimerSecondsRemaining > 0) {
      modalBtn.classList.add("active");
      modalLabel.textContent = formattedTime;
    } else {
      modalBtn.classList.remove("active");
      modalLabel.textContent = "Off";
    }
  }

  // Update Header Button
  if (headerBtn && headerLabel) {
    if (isSleepTimerRunning && sleepTimerSecondsRemaining > 0) {
      headerBtn.classList.add("active");
      headerBtn.title = "Watch Timer active (" + formattedTime + " remaining) - Click to deactivate";
      headerLabel.textContent = formattedTime;
    } else {
      headerBtn.classList.remove("active");
      const defaultMins = parseInt(appSettings.sleep_timer_minutes || 0, 10);
      headerBtn.title = defaultMins > 0 
        ? "Watch Timer: " + defaultMins + " min - Click to start timer" 
        : "Watch Timer: Off - Click to start";
      
      if (defaultMins > 0) {
        const h = Math.floor(defaultMins / 60);
        const m = defaultMins % 60;
        const pad = n => n < 10 ? '0' + n : n;
        headerLabel.textContent = (h > 0 ? h + ":" + pad(m) + ":00" : pad(m) + ":00");
      } else {
        headerLabel.textContent = "Off";
      }
    }
  }
  // Update quick menu active items
  document.querySelectorAll(".sleep-menu-item").forEach(item => {
    const mins = parseInt(item.getAttribute("data-timer"), 10);
    if (mins === 0 && !isSleepTimerRunning) {
      item.classList.add("active");
    } else if (isSleepTimerRunning && mins === sleepTimerMinutes) {
      item.classList.add("active");
    } else {
      item.classList.remove("active");
    }
  });
}

function startSleepTimer(minutes, showNotification = true) {
  const mins = parseInt(minutes, 10);
  if (isNaN(mins) || mins <= 0) {
    stopSleepTimer(showNotification);
    return;
  }

  sleepTimerMinutes = mins;
  if (!isSleepTimerRunning || sleepTimerSecondsRemaining <= 0) {
    sleepTimerSecondsRemaining = mins * 60;
  }
  isSleepTimerRunning = true;

  if (sleepTimerInterval) { clearInterval(sleepTimerInterval); sleepTimerInterval = null; }

  const isPlaying = typeof ytPlayer !== 'undefined' && ytPlayer && typeof ytPlayer.getPlayerState === 'function' && ytPlayer.getPlayerState() === 1;
  isSleepTimerPaused = !isPlaying;

  if (!isSleepTimerPaused) {
    sleepTimerInterval = setInterval(() => {
      if (!isSleepTimerRunning || isSleepTimerPaused) {
        if (sleepTimerInterval) clearInterval(sleepTimerInterval);
        return;
      }
      sleepTimerSecondsRemaining--;
      if (sleepTimerSecondsRemaining <= 0) {
        stopSleepTimer(false);
        if (typeof closePlayerModal === 'function') closePlayerModal();
      }
      initOrUpdateSleepTimerUI();
    }, 1000);
  }

  initOrUpdateSleepTimerUI();
  if (showNotification) showToast("Watch Timer set to " + mins + " minutes.");
}

function stopSleepTimer(showNotification = true) {
  isSleepTimerRunning = false;
  isSleepTimerPaused = false;
  sleepTimerSecondsRemaining = 0;
  if (sleepTimerInterval) {
    clearInterval(sleepTimerInterval);
    sleepTimerInterval = null;
  }
  initOrUpdateSleepTimerUI();
  if (showNotification) showToast("Watch Timer deactivated.");
}

function pauseSleepTimer() {
  if (isSleepTimerRunning && !isSleepTimerPaused) {
    isSleepTimerPaused = true;
    if (sleepTimerInterval) {
      clearInterval(sleepTimerInterval);
      sleepTimerInterval = null;
    }
    initOrUpdateSleepTimerUI();
  }
}

function resumeSleepTimer() {
  if (isSleepTimerRunning && isSleepTimerPaused) {
    isSleepTimerPaused = false;
    // Restart interval using existing remaining seconds
    startSleepTimer(sleepTimerMinutes, false);
  }
}

function markVideoAsWatched(videoId, progress = 100, currentSec = 0) {
  // Update in memory
  let alreadyMarked = false;
  playlists.forEach(p => {
    if (p.videos) {
      const v = p.videos.find(x => x.video_id === videoId);
      if (v) {
        if (v.is_watched === 1) alreadyMarked = true;
        v.is_watched = 1;
        v.watch_progress = progress;
        if (currentSec) v.last_position_seconds = currentSec;
      }
    }
  });

  if (alreadyMarked) return;

  // Update DOM badge
  const badge = document.getElementById(`watch-badge-${videoId}`);
  if (badge) {
    badge.className = "watch-status-badge watched";
    badge.title = "Click to toggle watch status";
    badge.innerHTML = `<i data-lucide="check"></i> Watched`;
    lucide.createIcons();
  }

  const bg = document.getElementById(`progress-bg-${videoId}`);
  if (bg) bg.classList.add("hidden");

  // Send API update in background
  try {
    fetch(`/api/videos/${videoId}/watch-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ progress: progress, is_watched: true, last_position_seconds: currentSec })
    });
  } catch (e) {}
}

async function toggleVideoWatchStatus(videoId) {
  let isCurrentlyWatched = false;
  playlists.forEach(p => {
    if (p.videos) {
      const v = p.videos.find(x => x.video_id === videoId);
      if (v && (v.is_watched === 1 || (v.watch_progress && v.watch_progress >= 70))) {
        isCurrentlyWatched = true;
      }
    }
  });

  const newWatched = !isCurrentlyWatched;

  // Update memory
  playlists.forEach(p => {
    if (p.videos) {
      const v = p.videos.find(x => x.video_id === videoId);
      if (v) {
        v.is_watched = newWatched ? 1 : 0;
        v.watch_progress = newWatched ? 100 : 0;
        if (!newWatched) v.last_position_seconds = 0;
      }
    }
  });

  // Update DOM
  const badge = document.getElementById(`watch-badge-${videoId}`);
  const bg = document.getElementById(`progress-bg-${videoId}`);
  const bar = document.getElementById(`progress-bar-${videoId}`);

  if (badge) {
    if (newWatched) {
      badge.className = "watch-status-badge watched";
      badge.innerHTML = `<i data-lucide="check"></i> Watched`;
      if (bg) bg.classList.add("hidden");
    } else {
      badge.className = "watch-status-badge unwatched";
      badge.innerHTML = `<i data-lucide="clock"></i> Unwatched`;
      if (bg) bg.classList.add("hidden");
      if (bar) bar.style.width = "0%";
    }
    lucide.createIcons();
  }

  showToast(newWatched ? "Marked as Watched" : "Marked as Unwatched", "info");

  try {
    await fetch(`/api/videos/${videoId}/watch-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_watched: newWatched, last_position_seconds: newWatched ? 0 : 0 })
    });
  } catch (e) {}
}

// Play Video with Continuous Auto-Play & Exact Position Resume Support
function handlePlayVideo(index) {
  if (index < 0 || index >= filteredVideos.length) return;
  currentPlayingIndex = index;
  const video = filteredVideos[index];
  if (!video) return;

  if (appSettings.player_mode === "youtube_direct") {
    window.open(`https://www.youtube.com/watch?v=${video.video_id}`, "_blank");
    return;
  }

  const modal = document.getElementById("player-modal");
  const title = document.getElementById("player-modal-title");
  const channel = document.getElementById("player-modal-channel");
  const indicator = document.getElementById("player-index-indicator");
  const btnYT = document.getElementById("btn-open-in-youtube");

  if (title) title.textContent = video.title;
  if (channel) channel.textContent = video.channel_title || "YouTube";
  if (indicator) indicator.textContent = `${index + 1} / ${filteredVideos.length}`;
  if (btnYT) btnYT.onclick = () => window.open(`https://www.youtube.com/watch?v=${video.video_id}`, "_blank");

  if (modal) modal.classList.remove("hidden");

  // Initialize or maintain sleep timer state
  const configuredSleepMins = parseInt(appSettings.sleep_timer_minutes || 0, 10);
  if (configuredSleepMins > 0 && !isSleepTimerRunning) {
    startSleepTimer(configuredSleepMins, false);
  } else {
    initOrUpdateSleepTimerUI();
  }

  // Highlight active card in background playlist grid
  document.querySelectorAll(".video-card").forEach(c => c.classList.remove("playing"));
  const activeCard = document.getElementById(`video-card-${video.video_id}`);
  if (activeCard) activeCard.classList.add("playing");

  const startSec = getVideoResumeSeconds(video);
  if (startSec > 3) {
    showToast(`▶️ Resuming from ${formatTimeSec(startSec)}`, "info");
  }

  // Check if YouTube API is ready
  if (!window.YT || !window.YT.Player) {
    pendingPlayIndex = index;
    const wrapper = document.getElementById("video-iframe-wrapper");
    if (wrapper && !ytPlayer) {
      const startParam = startSec > 0 ? `&start=${startSec}` : "";
      wrapper.innerHTML = `<iframe id="video-player-iframe" src="https://www.youtube-nocookie.com/embed/${video.video_id}?autoplay=1&enablejsapi=1&rel=0&modestbranding=1${startParam}" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe>`;
    }
    lucide.createIcons();
    return;
  }

  startWatchTracking(video.video_id);

  if (ytPlayer && typeof ytPlayer.loadVideoById === "function") {
    try {
      // loadVideoById seamlessly switches stream without reloading iframe, preserving Fullscreen!
      ytPlayer.loadVideoById({
        videoId: video.video_id,
        startSeconds: startSec
      });
      ytPlayer.playVideo();
    } catch (e) {
      console.warn("Re-creating YT.Player instance:", e);
      createYTPlayer(video.video_id, startSec);
    }
  } else {
    createYTPlayer(video.video_id, startSec);
  }

  lucide.createIcons();
}

function createYTPlayer(videoId, startSeconds = 0) {
  const wrapper = document.getElementById("video-iframe-wrapper");
  if (!wrapper) return;
  wrapper.innerHTML = `<div id="youtube-player-element"></div>`;

  try {
    ytPlayer = new YT.Player("youtube-player-element", {
      videoId: videoId,
      playerVars: {
        start: startSeconds,
        autoplay: 1,
        rel: 0,
        modestbranding: 1,
        enablejsapi: 1,
        origin: window.location.origin,
        playsinline: 1,
        fs: 1
      },
      events: {
        onReady: (event) => {
          if (startSeconds > 0) {
            event.target.seekTo(startSeconds, true);
          }
          event.target.playVideo();
          startWatchTracking(videoId);
            if (typeof resumeSleepTimer === 'function') resumeSleepTimer();
        },
        onStateChange: (event) => {
          const currentVid = filteredVideos[currentPlayingIndex]?.video_id;
          // 1 = PLAYING
          if (event.data === 1) {
            if (currentVid) startWatchTracking(currentVid);
          }
          // 2 = PAUSED
          else if (event.data === 2) {
            if (currentVid) saveVideoCurrentPosition(currentVid);
            stopWatchTracking();
            if (typeof pauseSleepTimer === 'function') pauseSleepTimer();
          }
          // 0 = YT.PlayerState.ENDED -> Mark watched & Auto advance to next video!
          else if (event.data === 0 || (window.YT && event.data === window.YT.PlayerState.ENDED)) {
            if (currentVid) {
              markVideoAsWatched(currentVid, 100, 0);
              fetch(`/api/videos/${currentVid}/watch-status`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ progress: 100, is_watched: true, last_position_seconds: 0 })
              }).catch(() => {});
            }
            stopWatchTracking();
            if (typeof pauseSleepTimer === 'function') pauseSleepTimer();
            playNextVideo();
          }
        },
        onError: (event) => {
          console.warn("YouTube player error event:", event.data);
          if (event.data === 101 || event.data === 150) {
            showToast("Video cannot be embedded, skipping to next...", "info");
            setTimeout(playNextVideo, 1500);
          }
        }
      }
    });
  } catch (err) {
    console.error("Failed to initialize YT.Player instance:", err);
  }
}

function closePlayerModal() {
  if (currentTrackingVideoId) {
    saveVideoCurrentPosition(currentTrackingVideoId);
  }
  stopWatchTracking();
            if (typeof pauseSleepTimer === 'function') pauseSleepTimer();
  const modal = document.getElementById("player-modal");
  if (modal) modal.classList.add("hidden");

  if (ytPlayer && typeof ytPlayer.stopVideo === "function") {
    try {
      ytPlayer.stopVideo();
    } catch (e) {}
  }

  const iframe = document.getElementById("video-player-iframe");
  if (iframe) iframe.src = "";

  document.querySelectorAll(".video-card").forEach(c => c.classList.remove("playing"));
}

function playNextVideo() {
  if (currentPlayingIndex < filteredVideos.length - 1) {
    handlePlayVideo(currentPlayingIndex + 1);
  } else {
    showToast("Reached end of playlist", "info");
  }
}

function playPrevVideo() {
  if (currentPlayingIndex > 0) {
    handlePlayVideo(currentPlayingIndex - 1);
  }
}

// Delete Video with Confirmation Prompt & Instant Optimistic UI Update
async function deleteVideo(videoId, videoTitle = "") {
  const displayTitle = videoTitle ? `"${videoTitle}"` : "this video";
  if (!confirm(`Do you really want to remove ${displayTitle} from this playlist and YouTube?`)) {
    return;
  }

  // 1. Instantly remove video card from current view for snappy feedback
  currentVideos = currentVideos.filter(v => v.video_id !== videoId);
  filteredVideos = filteredVideos.filter(v => v.video_id !== videoId);
  renderVideoGrid();

  // Instantly update badge count in view header and sidebar
  const pl = playlists.find(p => p.id === activePlaylistId);
  if (pl) {
    if (pl.videos) {
      pl.videos = pl.videos.filter(v => v.video_id !== videoId);
      pl.video_count = pl.videos.length;
    }
    const countEl = document.getElementById("current-view-count");
    if (countEl) {
      const count = pl.videos ? pl.videos.length : currentVideos.length;
      countEl.textContent = `${count} ${count === 1 ? 'Video' : 'Videos'}`;
    }
    const tabBadge = document.querySelector(`#tab-${pl.id} .tab-badge`);
    if (tabBadge && pl.videos) {
      tabBadge.textContent = pl.videos.length;
    }
  }

  try {
    const res = await fetch(`/api/playlists/${activePlaylistId}/videos/${videoId}`, {
      method: "DELETE"
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Error deleting video");

    if (data.yt_result && data.yt_result.success) {
      if (data.yt_result.type === "favorite_unliked") {
        showToast("Video removed from Favorites & YouTube Liked list", "success");
      } else {
        showToast("Video removed from playlist & YouTube", "success");
      }
    } else {
      showToast("Video removed", "success");
    }

    // Refresh database state cleanly in background
    await loadPlaylists();
  } catch (err) {
    showToast(err.message || "Error deleting video", "error");
    // Revert state if failed
    await loadPlaylists();
  }
}

// Google OAuth & Sync Handlers
async function handleGoogleCredentialsSubmit(e) {
  e.preventDefault();
  const clientId = document.getElementById("google-client-id").value.trim();
  const clientSecret = document.getElementById("google-client-secret").value.trim();
  
  if (!clientId || !clientSecret) return;

  const submitBtn = document.getElementById("btn-save-and-login");
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<span>Redirecting...</span>`;

  try {
    const res = await fetch("/api/auth/save-credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Error saving credentials");

    if (data.auth_url) {
      window.location.href = data.auth_url;
    } else {
      window.location.href = "/api/auth/login";
    }
  } catch (err) {
    showToast(err.message, "error");
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<i data-lucide="log-in"></i> Sign in with Google`;
    lucide.createIcons();
  }
}

// Manual User Sync Execution with Immediate View Refresh & Automatic Page Reload
async function handleSyncNow() {
  if (isSyncing) return;
  isSyncing = true;

  setSyncUIState("syncing", "Syncing...");
  showToast("YouTube synchronization started...", "info");

  try {
    const res = await fetch(`/api/auth/sync?_t=${Date.now()}`, { method: "POST", cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Synchronization failed");

    // Immediately reload playlists data in memory so changes are instant
    await checkAuthStatus();
    await loadPlaylists();

    localStorage.setItem("favyt_active_playlist_id", activePlaylistId);
    sessionStorage.setItem("favyt_sync_toast", `Successfully synced! (${data.favorites_synced} Favorites, ${data.playlists_synced} Playlists)`);
    
    setSyncUIState("success", "Done!");
    closeAllModals();

    // Perform forced cache-busted page reload automatically
    setTimeout(() => {
      window.location.href = window.location.pathname + `?_t=${Date.now()}`;
    }, 400);
  } catch (err) {
    showToast(err.message || "Error during sync", "error");
    setSyncUIState("error", "Error");
    isSyncing = false;
  }
}

async function handleLogout() {
  if (confirm("Do you really want to disconnect your YouTube account?")) {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      showToast("YouTube account disconnected", "info");
      await checkAuthStatus();
      setSyncUIState("idle");
      closeAllModals();
    } catch (e) {
      showToast("Error logging out", "error");
    }
  }
}

// Playlist Visibility & Settings Modal (Staged Draft State)
function openSettingsModal() {
  settingsDraft.default_startup_view = appSettings.default_startup_view || "favorites";
  settingsDraft.player_mode = appSettings.player_mode || "modal";
  settingsDraft.player_modal_size = appSettings.player_modal_size || "large";
  settingsDraft.sleep_timer_minutes = parseInt(appSettings.sleep_timer_minutes || 0, 10);
  settingsDraft.visibility_map = {};

  playlists.forEach(p => {
    settingsDraft.visibility_map[p.id] = (p.is_visible !== 0);
  });

  const startupSelect = document.getElementById("setting-startup-view");
  if (startupSelect) startupSelect.value = settingsDraft.default_startup_view;

  const playerModeSelect = document.getElementById("setting-player-mode");
  if (playerModeSelect) playerModeSelect.value = settingsDraft.player_mode;

  const playerSizeSelect = document.getElementById("setting-player-size");
  if (playerSizeSelect) playerSizeSelect.value = settingsDraft.player_modal_size;

  const sleepHoursInput = document.getElementById("setting-sleep-timer-hours");
  const sleepMinsInput = document.getElementById("setting-sleep-timer-minutes");
  if (sleepHoursInput) sleepHoursInput.value = Math.floor((settingsDraft.sleep_timer_minutes || 0) / 60);
  if (sleepMinsInput) sleepMinsInput.value = (settingsDraft.sleep_timer_minutes || 0) % 60;

  const searchInput = document.getElementById("setting-playlist-search");
  if (searchInput) searchInput.value = "";

  renderPlaylistManagerInSettings();
  document.getElementById("settings-modal").classList.remove("hidden");
  lucide.createIcons();
}

function renderPlaylistManagerInSettings() {
  const listContainer = document.getElementById("settings-playlist-list");
  const badge = document.getElementById("playlist-visible-count-badge");
  const searchQuery = (document.getElementById("setting-playlist-search")?.value || "").toLowerCase().trim();

  if (!listContainer) return;
  listContainer.innerHTML = "";

  let visibleCount = 0;
  playlists.forEach(p => {
    if (settingsDraft.visibility_map[p.id]) visibleCount++;
  });
  if (badge) badge.textContent = `${visibleCount} of ${playlists.length} active`;

  const filtered = playlists.filter(p => {
    if (!searchQuery) return true;
    return p.title.toLowerCase().includes(searchQuery);
  });

  filtered.forEach(p => {
    const item = document.createElement("div");
    item.className = "playlist-manager-item";
    const isChecked = !!settingsDraft.visibility_map[p.id];
    const vCount = p.video_count || (p.videos ? p.videos.length : 0);
    const iconName = ICON_MAP[p.icon] || (p.is_system ? 'star' : 'folder');

    item.innerHTML = `
      <label class="playlist-manager-label">
        <input type="checkbox" data-id="${p.id}" ${isChecked ? "checked" : ""}>
        <i data-lucide="${iconName}" style="width: 16px; height: 16px; color: ${p.is_system ? 'var(--accent-red)' : 'var(--text-secondary)'};"></i>
        <span class="playlist-manager-title">${escapeHtml(p.title)}</span>
      </label>
      <span class="playlist-manager-badge">${vCount} Videos</span>
    `;

    const checkbox = item.querySelector("input[type='checkbox']");
    checkbox.addEventListener("change", () => {
      settingsDraft.visibility_map[p.id] = checkbox.checked;
      let count = 0;
      playlists.forEach(pl => { if (settingsDraft.visibility_map[pl.id]) count++; });
      if (badge) badge.textContent = `${count} of ${playlists.length} active`;
    });

    listContainer.appendChild(item);
  });

  lucide.createIcons();
}

function handleSetAllVisibility(makeVisible) {
  playlists.forEach(p => {
    settingsDraft.visibility_map[p.id] = !!makeVisible;
  });
  renderPlaylistManagerInSettings();
}

async function saveSettingsAndClose() {
  const startupSelect = document.getElementById("setting-startup-view");
  const playerModeSelect = document.getElementById("setting-player-mode");
  const playerSizeSelect = document.getElementById("setting-player-size");
  const sleepHoursInput = document.getElementById("setting-sleep-timer-hours");
  const sleepMinsInput = document.getElementById("setting-sleep-timer-minutes");
  
  if (startupSelect) settingsDraft.default_startup_view = startupSelect.value;
  if (playerModeSelect) settingsDraft.player_mode = playerModeSelect.value;
  if (playerSizeSelect) settingsDraft.player_modal_size = playerSizeSelect.value;

  if (sleepHoursInput && sleepMinsInput) {
    let h = parseInt(sleepHoursInput.value, 10) || 0;
    let m = parseInt(sleepMinsInput.value, 10) || 0;
    if (h < 0) h = 0;
    if (h > 12) h = 12;
    if (m < 0) m = 0;
    if (m > 59) m = 59;
    settingsDraft.sleep_timer_minutes = (h * 60) + m;
  }

  try {
    const res = await fetch("/api/settings/save-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        default_startup_view: settingsDraft.default_startup_view,
        player_mode: settingsDraft.player_mode,
        player_modal_size: settingsDraft.player_modal_size,
        sleep_timer_minutes: settingsDraft.sleep_timer_minutes,
        visibility_map: settingsDraft.visibility_map
      })
    });
    
    if (!res.ok) throw new Error("Error saving settings");
    
    // Apply changes locally to app state
    appSettings.default_startup_view = settingsDraft.default_startup_view;
    appSettings.player_mode = settingsDraft.player_mode;
    appSettings.player_modal_size = settingsDraft.player_modal_size;
    appSettings.sleep_timer_minutes = settingsDraft.sleep_timer_minutes;
    applyPlayerModalSize(appSettings.player_modal_size);

    // Apply sleep timer to active player if running or configure
    if (appSettings.sleep_timer_minutes > 0) {
      startSleepTimer(appSettings.sleep_timer_minutes, false);
    } else {
      stopSleepTimer(false);
    }

    playlists.forEach(p => {
      if (p.id in settingsDraft.visibility_map) {
        p.is_visible = settingsDraft.visibility_map[p.id] ? 1 : 0;
      }
    });

    // Verify active playlist visibility
    const visiblePlaylists = playlists.filter(p => p.is_visible !== 0);
    if (visiblePlaylists.length === 0) {
      activePlaylistId = null;
      localStorage.removeItem("favyt_active_playlist_id");
      localStorage.removeItem("favyt_active_playlist_title");
    } else if (!visiblePlaylists.some(p => p.id === activePlaylistId)) {
      activePlaylistId = visiblePlaylists[0].id;
      localStorage.setItem("favyt_active_playlist_id", activePlaylistId);
    }

    renderTabs();
    renderCurrentPlaylist();
    showToast("Settings saved successfully", "success");
  } catch (err) {
    showToast(err.message || "Error saving settings", "error");
  }

  closeAllModals();
}

async function handleFactoryReset() {
  const confirmReset = confirm(
    "⚠️ Warning: Are you sure you want to perform a factory reset?\n\n" +
    "This will permanently delete:\n" +
    "• All synchronized playlists and videos\n" +
    "• Stored Google OAuth credentials and tokens\n" +
    "• All custom settings and preferences\n\n" +
    "The application will return to its original factory state."
  );
  
  if (!confirmReset) return;

  try {
    const res = await fetch("/api/settings/factory-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    
    if (!res.ok) {
      throw new Error("Failed to reset application.");
    }
    
    // Clear client-side stored states
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem("favyt_sync_toast", "App has been reset to factory defaults.");
    
    // Reload page back to fresh root
    window.location.href = "/";
  } catch (err) {
    showToast(err.message || "Failed to reset application.", "error");
  }
}

function closeAllModals() {
  document.querySelectorAll(".modal-overlay").forEach(m => m.classList.add("hidden"));
  const iframe = document.getElementById("video-player-iframe");
  if (iframe) iframe.src = "";
}

// Toast Notifications
function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  
  let icon = "info";
  if (type === "success") icon = "check-circle";
  if (type === "error") icon = "alert-circle";

  toast.innerHTML = `
    <i data-lucide="${icon}"></i>
    <span>${escapeHtml(message)}</span>
  `;
  container.appendChild(toast);
  lucide.createIcons();

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(50px)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Setup Event Listeners
function setupEventListeners() {
  // Sidebar Toggle (Hamburger Button)
  document.getElementById("btn-toggle-sidebar")?.addEventListener("click", toggleSidebar);

  // Brand click goes to favorites
  document.getElementById("brand-home")?.addEventListener("click", () => switchPlaylist("favorites"));

  // Sidebar Playlist Search
  const plSearch = document.getElementById("playlist-search-input");
  const clearPlBtn = document.getElementById("clear-pl-search-btn");
  if (plSearch) {
    plSearch.addEventListener("input", () => {
      if (plSearch.value.trim()) {
        clearPlBtn?.classList.remove("hidden");
      } else {
        clearPlBtn?.classList.add("hidden");
      }
      renderTabs();
    });
  }
  clearPlBtn?.addEventListener("click", () => {
    if (plSearch) plSearch.value = "";
    clearPlBtn.classList.add("hidden");
    renderTabs();
    plSearch?.focus();
  });

  // Video Filter Input inside current playlist
  const filterInput = document.getElementById("video-filter-input");
  filterInput?.addEventListener("input", applyVideoFilter);
  document.getElementById("clear-search-btn")?.addEventListener("click", () => {
    if (filterInput) filterInput.value = "";
    applyVideoFilter();
    filterInput?.focus();
  });

  // Header Sync Button (Acts as both trigger & live status feedback)
  document.getElementById("btn-sync-header")?.addEventListener("click", () => {
    if (authStatus.connected) {
      handleSyncNow();
    } else {
      document.getElementById("yt-connect-modal").classList.remove("hidden");
      lucide.createIcons();
    }
  });

  // Settings Button & Factory Reset
  document.getElementById("btn-open-settings")?.addEventListener("click", openSettingsModal);
  document.getElementById("btn-factory-reset")?.addEventListener("click", handleFactoryReset);

  // Settings Playlist Manager listeners
  const settingPlSearch = document.getElementById("setting-playlist-search");
  if (settingPlSearch) {
    settingPlSearch.addEventListener("input", renderPlaylistManagerInSettings);
  }
  document.getElementById("btn-select-all-pls")?.addEventListener("click", () => handleSetAllVisibility(true));
  document.getElementById("btn-deselect-all-pls")?.addEventListener("click", () => handleSetAllVisibility(false));

  // Sleep Timer Setting Dropdown in Settings Modal
  const settingSleepSelect = document.getElementById("setting-sleep-timer");
  const settingSleepCustom = document.getElementById("setting-sleep-timer-custom");
  settingSleepSelect?.addEventListener("change", () => {
    if (settingSleepSelect.value === "custom") {
      settingSleepCustom?.classList.remove("hidden");
      settingSleepCustom?.focus();
    } else {
      settingSleepCustom?.classList.add("hidden");
    }
  });

  // Modals & OAuth forms
  document.getElementById("google-credentials-form")?.addEventListener("submit", handleGoogleCredentialsSubmit);
  document.getElementById("btn-yt-sync-now")?.addEventListener("click", handleSyncNow);
  document.getElementById("btn-yt-logout")?.addEventListener("click", handleLogout);

  // Player controls
  document.getElementById("btn-close-player")?.addEventListener("click", closePlayerModal);
  document.getElementById("btn-player-next")?.addEventListener("click", playNextVideo);
  document.getElementById("btn-player-prev")?.addEventListener("click", playPrevVideo);
  document.getElementById("btn-play-all")?.addEventListener("click", () => {
    if (filteredVideos.length > 0) handlePlayVideo(0);
  });

  // Header Watch Timer Toggle Button (Start / Stop)
  document.getElementById("btn-header-timer")?.addEventListener("click", () => {
    if (isSleepTimerRunning) {
      stopSleepTimer(true);
    } else {
      let mins = parseInt(appSettings.sleep_timer_minutes || 0, 10);
      if (mins <= 0) mins = 30; // fallback to 30 min if no default is set
      startSleepTimer(mins, true);
    }
  });

  // Player Sleep Timer Quick Button & Menu
  const btnSleepTimer = document.getElementById("btn-player-sleep-timer");
  const sleepMenu = document.getElementById("sleep-timer-quick-menu");
  btnSleepTimer?.addEventListener("click", (e) => {
    e.stopPropagation();
    sleepMenu?.classList.toggle("hidden");
    lucide.createIcons();
  });

  document.querySelectorAll(".sleep-menu-item").forEach(item => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      const mins = parseInt(item.getAttribute("data-timer"), 10);
      startSleepTimer(mins, true);
      sleepMenu?.classList.add("hidden");
    });
  });

  const btnApplyQuickCustom = document.getElementById("btn-apply-quick-custom-timer");
  const inputQuickCustom = document.getElementById("quick-custom-sleep-timer");
  btnApplyQuickCustom?.addEventListener("click", (e) => {
    e.stopPropagation();
    const mins = parseInt(inputQuickCustom?.value, 10);
    if (!isNaN(mins) && mins > 0) {
      startSleepTimer(mins, true);
      if (inputQuickCustom) inputQuickCustom.value = "";
      sleepMenu?.classList.add("hidden");
    } else {
      showToast("Please enter a valid number of minutes", "error");
    }
  });

  inputQuickCustom?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.stopPropagation();
      btnApplyQuickCustom?.click();
    }
  });

  // Close sleep quick menu on click outside
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".sleep-timer-wrapper")) {
      sleepMenu?.classList.add("hidden");
    }
  });

  // Keybindings (Escape to close, Alt+Right/Left for next/prev)
  document.addEventListener("keydown", (e) => {
    const playerModal = document.getElementById("player-modal");
    if (playerModal && !playerModal.classList.contains("hidden")) {
      if (e.key === "Escape") closePlayerModal();
      if (e.key === "ArrowRight" && e.altKey) playNextVideo();
      if (e.key === "ArrowLeft" && e.altKey) playPrevVideo();
    } else {
      if (e.key === "Escape") closeAllModals();
    }
  });

  document.querySelectorAll(".modal-overlay").forEach(modal => {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeAllModals();
    });
  });
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

function escapeForInlineJs(str) {
  if (!str) return "";
  return str.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;");
}

function parseIsoDate(dateVal) {
  if (!dateVal) return null;
  if (dateVal instanceof Date) return isNaN(dateVal.getTime()) ? null : dateVal;
  let s = String(dateVal).trim();
  // Ensure UTC timezone parsing if not specified
  if (!s.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(s)) {
    s += 'Z';
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(d) {
  const date = parseIsoDate(d);
  if (!date) return "";
  return formatYouTubeTimeAgo(date);
}

function formatYouTubeTimeAgo(dateVal) {
  const d = parseIsoDate(dateVal);
  if (!d) return "";
  
  const now = new Date();
  const diffMs = Math.max(0, now - d);
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffSeconds < 60) return "Just now";
  if (diffMinutes === 1) return "1 minute ago";
  if (diffMinutes < 60) return `${diffMinutes} minutes ago`;
  if (diffHours === 1) return "1 hour ago";
  if (diffHours < 24) return `${diffHours} hours ago`;
  if (diffDays === 1) return "1 day ago";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffWeeks === 1) return "1 week ago";
  if (diffWeeks < 4) return `${diffWeeks} weeks ago`;
  if (diffMonths === 1) return "1 month ago";
  if (diffMonths < 12) return `${diffMonths} months ago`;
  if (diffYears === 1) return "1 year ago";
  return `${diffYears} years ago`;
}

function formatUploadDate(dateVal) {
  return formatYouTubeTimeAgo(dateVal);
}

function updateHeaderSyncTime(lastSyncIso) {
  const syncTimeEl = document.getElementById("header-last-sync-time");
  if (!syncTimeEl) return;
  
  if (!lastSyncIso) {
    syncTimeEl.textContent = "Last synced: Never";
    return;
  }
  
  const d = parseIsoDate(lastSyncIso);
  if (!d) {
    syncTimeEl.textContent = "Last synced: Never";
    return;
  }
  
  const timeStr = formatYouTubeTimeAgo(d);
  syncTimeEl.textContent = `Last synced: ${timeStr}`;
}

async function checkAuthStatus() {
  try {
    const res = await fetch("/api/auth/status?_t=" + Date.now());
    const data = await res.json();
    authStatus = data;

    updateHeaderSyncTime(data.last_sync);
    
    const syncBtn = document.getElementById("btn-sync-header");
    if (syncBtn) {
        if (authStatus.connected) {
            syncBtn.textContent = "Sync";
            syncBtn.classList.remove("btn-primary");
            syncBtn.classList.add("btn-secondary");
        } else {
            syncBtn.textContent = authStatus.has_client_credentials ? "Login & Sync" : "Login & Sync";
            syncBtn.classList.add("btn-primary");
            syncBtn.classList.remove("btn-secondary");
        }
    }
  } catch(e) {
    console.error("Auth status error", e);
  }
}

async function loadPlaylists() {
  try {
    const res = await fetch("/api/playlists?_t=" + Date.now());
    if (res.ok) {
      playlists = await res.json();
      renderSidebar();
      if (activePlaylistId) {
        switchPlaylist(activePlaylistId);
      } else {
        switchPlaylist("favorites");
      }
    }
  } catch(e) {
    console.error("Playlists error", e);
  }
}

async function loadSettings() {
  try {
    const res = await fetch("/api/settings?_t=" + Date.now());
    if (res.ok) {
      const data = await res.json();
      appSettings = data;
      applyPlayerModalSize(appSettings.player_modal_size);
      
      // Initialize timer based on settings
      const sleepVal = parseInt(appSettings.sleep_timer_minutes || 0, 10);
      sleepTimerMinutes = sleepVal;
      initOrUpdateSleepTimerUI();
    }
  } catch(e) {
    console.error("Settings error", e);
  }
}

async function initApp() {
  if (typeof lucide !== "undefined") {
    lucide.createIcons();
  }
  await loadSettings();
  await checkAuthStatus();
  await loadPlaylists();
}

document.addEventListener("DOMContentLoaded", initApp);

function toggleSidebar() {
  const sidebar = document.getElementById("app-sidebar");
  if (sidebar) {
    sidebar.classList.toggle("collapsed");
  }
}

async function switchPlaylist(playlistId) {
  activePlaylistId = playlistId;
  localStorage.setItem("favyt_active_playlist_id", playlistId);
  
  document.querySelectorAll(".sidebar-nav-item").forEach(el => {
    if (el.dataset.id === playlistId) el.classList.add("active");
    else el.classList.remove("active");
  });

  const titleEl = document.getElementById("current-view-title");
  const countEl = document.getElementById("current-view-count");
  if (titleEl) titleEl.textContent = "Loading...";
  if (countEl) countEl.textContent = "";

  try {
    const res = await fetch(`/api/playlists/${playlistId}/videos?_t=${Date.now()}`);
    if (res.ok) {
      const data = await res.json();
      currentVideos = data.videos || [];
      
      const p = playlists.find(p => p.id === playlistId);
      if (titleEl) titleEl.textContent = p ? p.title : (playlistId === "favorites" ? "Favorites" : "Playlist");
      if (countEl) countEl.textContent = currentVideos.length > 0 ? currentVideos.length : "";
      
      localStorage.setItem("favyt_active_playlist_title", titleEl.textContent);
      
      const input = document.getElementById("video-filter-input");
      if (input) input.value = "";
      applyVideoFilter();
    }
  } catch(e) {
    console.error("Error switching playlist", e);
    if (titleEl) titleEl.textContent = "Error loading videos";
  }
}

function applyVideoFilter() {
  const input = document.getElementById("video-filter-input");
  const query = input ? input.value.toLowerCase() : "";
  
  if (!query) {
    filteredVideos = [...currentVideos];
  } else {
    filteredVideos = currentVideos.filter(v => v.title.toLowerCase().includes(query) || (v.channel_title && v.channel_title.toLowerCase().includes(query)));
  }
  
  renderVideoGrid();
}

function renderTabs() {
  const nav = document.getElementById("playlist-tabs");
  if (!nav) return;
  
  nav.innerHTML = '';
  
  const favBtn = document.createElement("a");
  favBtn.className = "sidebar-nav-item";
  if (activePlaylistId === "favorites") favBtn.classList.add("active");
  favBtn.dataset.id = "favorites";
  favBtn.innerHTML = `<i data-lucide="star"></i><span>Favorites</span>`;
  favBtn.addEventListener("click", () => switchPlaylist("favorites"));
  nav.appendChild(favBtn);

  playlists.forEach(p => {
    if (p.is_visible !== 0) {
      const btn = document.createElement("a");
      btn.className = "sidebar-nav-item";
      if (activePlaylistId === p.id) btn.classList.add("active");
      btn.dataset.id = p.id;
      btn.innerHTML = `<i data-lucide="folder"></i><span title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</span>`;
      btn.addEventListener("click", () => switchPlaylist(p.id));
      nav.appendChild(btn);
    }
  });
  
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderCurrentPlaylist() { }

function renderVideoGrid() {
  const grid = document.getElementById("video-grid");
  const emptyState = document.getElementById("empty-state");
  if (!grid || !emptyState) return;

  grid.innerHTML = '';

  if (filteredVideos.length === 0) {
    grid.classList.add("hidden");
    emptyState.classList.remove("hidden");
    return;
  }

  grid.classList.remove("hidden");
  emptyState.classList.add("hidden");

  filteredVideos.forEach((video, index) => {
    const card = document.createElement("div");
    card.className = "video-card";
    
    let progressHtml = '';
    if (video.watch_progress > 0) {
      progressHtml = `<div class="progress-bar-bg"><div class="progress-bar-fill" style="width: ${video.watch_progress}%"></div></div>`;
    }

    card.innerHTML = `
      <div class="thumbnail-wrapper">
        <img src="${video.thumbnail_url}" alt="Thumbnail">
        ${progressHtml}
        <button class="play-overlay" title="Play"><i data-lucide="play-circle"></i></button>
      </div>
      <div class="video-info">
        <div class="video-title" title="${escapeHtml(video.title)}">${escapeHtml(video.title)}</div>
        <div class="video-channel">${escapeHtml(video.channel_title || '')}</div>
        <div class="video-meta">
          <span>${formatYouTubeTimeAgo(video.published_at || '')}</span>
          <button class="btn-delete-video" title="Remove video"><i data-lucide="trash-2"></i></button>
        </div>
      </div>
    `;

    card.querySelector(".thumbnail-wrapper").addEventListener("click", () => handlePlayVideo(index));
    card.querySelector(".btn-delete-video").addEventListener("click", (e) => {
      e.stopPropagation();
      deleteVideo(video.video_id, video.title);
    });

    grid.appendChild(card);
  });
  
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderSidebar() {
  renderTabs();
}
