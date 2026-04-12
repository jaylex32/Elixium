        class ModernMusicDownloaderApp {
            constructor() {
                this.socket = io();
                this.themePresets = [
                    {
                        id: 'ember',
                        name: 'Ember Signal',
                        mode: 'dark',
                        description: 'Warm copper and coral accents with a dark, cinematic shell.',
                        swatches: ['#120f0d', '#231b16', '#f97316', '#fb7185']
                    },
                    {
                        id: 'nocturne',
                        name: 'Nocturne Pulse',
                        mode: 'dark',
                        description: 'A darker studio palette with cyan and acid-lime highlights.',
                        swatches: ['#071018', '#13202b', '#22d3ee', '#a3e635']
                    },
                    {
                        id: 'sterling',
                        name: 'Sterling Deck',
                        mode: 'dark',
                        description: 'Muted steel surfaces for a cleaner premium-console feel.',
                        swatches: ['#0f1114', '#1f252c', '#d4d8dd', '#8da0b8']
                    },
                    {
                        id: 'verdant',
                        name: 'Verdant Luxe',
                        mode: 'dark',
                        description: 'Emerald surfaces with gold accents for a richer library view.',
                        swatches: ['#08120d', '#14241a', '#34d399', '#fbbf24']
                    },
                    {
                        id: 'crimson',
                        name: 'Crimson Noir',
                        mode: 'dark',
                        description: 'Deep wine and ember tones for a harder, high-contrast look.',
                        swatches: ['#12090b', '#26151b', '#ef4444', '#f59e0b']
                    },
                    {
                        id: 'hifi',
                        name: 'Hi-Fi Current',
                        mode: 'dark',
                        description: 'Blue and cyan accents tuned for a modern hi-fi dashboard.',
                        swatches: ['#081019', '#152131', '#38bdf8', '#22d3ee']
                    },
                    {
                        id: 'daylight',
                        name: 'Daylight Modern',
                        mode: 'light',
                        description: 'A bright editorial theme with cool blues and crisp contrast.',
                        swatches: ['#f5f7fb', '#ffffff', '#2563eb', '#0ea5e9']
                    }
                ];
                this.currentTheme = localStorage.getItem('elixium-theme') || 'sterling';
                this.debugEnabled = localStorage.getItem('elixium-debug') === 'true';
                this.currentPage = 'search';
                this.currentService = 'deezer';
                this.currentSearchType = 'track';
                this.searchPageSize = 50;
                this.searchOffset = 0;
                this.searchAppendRequested = false;
                this.lastSearchRequestOffset = 0;
                this.searchOverviewCollapsed = localStorage.getItem('elixium-search-overview-collapsed') !== 'false';
                this.homeOverviewCollapsed = localStorage.getItem('elixium-home-overview-collapsed') !== 'false';
                this.currentQuality = '320';
                this.currentView = 'grid';
                this.downloadColumnStorageKey = 'elixium-download-column-widths';
                this.downloadColumnMinWidths = {
                    name: 280,
                    status: 320,
                    start: 140,
                    end: 140,
                    actions: 150
                };
                this.downloadColumnRatios = {
                    name: 0.34,
                    status: 0.28,
                    start: 0.14,
                    end: 0.14,
                    actions: 0.1
                };
                this.downloadColumnWidths = this.loadDownloadColumnWidths();
                this.downloadColumnResizersBound = false;
                this.downloadQueue = [];
                this.recentSearches = this.loadStoredArray('elixium-recent-searches');
                this.recentDownloads = this.loadStoredArray('elixium-recent-downloads');
                this.searchResults = [];
                this.isDownloading = false;
                this.downloadProgress = new Map();
                this.downloadStartTimes = new Map();
                this.downloadEndTimes = new Map();
                this.albumModal = null;
                this.currentAlbumData = null;
                this.viewAllModal = null;            
                this.albumTracksCache = new Map();
                this.playlistModal = null;
                this.currentPlaylistData = null;
                this.playlistTracksCache = new Map();
                this.artistDetailModal = null;
                this.currentArtistData = null;
                this.homeService = 'deezer';
                this.discoveryCache = new Map();
                this.watchlistState = null;
                this.availableFavoriteGenres = [];
                this.favoriteGenres = [];
                this.watchlistCandidatesSelection = new Set();
                this.watchlistTrackSelection = new Set();
                this.activeGenrePageId = '';
                this.genrePageState = {};
                this.watchlistAlbumPreviewCache = new Map();
                this.watchlistExpandedAlbumIds = new Set();
                this.currentWatchlistArtistId = '';
                this.watchlistView = 'artists';
                this.monitorSchedules = null;
                this.monitorHistory = [];
                this.qualitySettings = {
                    deezer: '320',    // Default Deezer quality
                    qobuz: '44khz'    // Default Qobuz quality
                };
                this.qualitySettingsLoaded = false;                

                this.progressPanelCollapsed = localStorage.getItem('progressPanelCollapsed') === 'true';
                // Playlists (user-defined)
                this.playlists = [];
                // Player state
                this.audio = document.getElementById('audio-el');
                this.playQueue = JSON.parse(localStorage.getItem('player.queue') || '[]');
                this.nowPlayingIndex = Number(localStorage.getItem('player.index') || -1);
                this.downloadToClient = localStorage.getItem('downloadToClient') === 'true';
                this.repeat = localStorage.getItem('player.repeat') === '1';
                this.shuffle = localStorage.getItem('player.shuffle') === '1';
                // Try to restore last played track index from saved id if needed
                try {
                    const savedId = localStorage.getItem('player.lastId');
                    const savedSvc = localStorage.getItem('player.lastService') || this.currentService;
                    if (savedId) {
                        const idx = (this.playQueue || []).findIndex(x => String(x.id) === String(savedId) && (x.service||'') === (savedSvc||''));
                        if (idx >= 0 && (this.nowPlayingIndex < 0 || !this.playQueue[this.nowPlayingIndex])) {
                            this.nowPlayingIndex = idx;
                        }
                    }
                } catch {}
                
                this.init();
            }

            loadStoredArray(key) {
                try {
                    const raw = localStorage.getItem(key);
                    const parsed = raw ? JSON.parse(raw) : [];
                    return Array.isArray(parsed) ? parsed : [];
                } catch {
                    return [];
                }
            }

            loadDownloadColumnWidths() {
                try {
                    const raw = localStorage.getItem(this.downloadColumnStorageKey);
                    const parsed = raw ? JSON.parse(raw) : null;
                    return parsed && typeof parsed === 'object' ? parsed : {};
                } catch {
                    return {};
                }
            }

            syncSearchOverviewState() {
                const container = document.querySelector('.search-command-center');
                const toggle = document.getElementById('search-overview-toggle');
                if (!container || !toggle) return;

                container.classList.toggle('is-collapsed', this.searchOverviewCollapsed);
                toggle.setAttribute('aria-expanded', String(!this.searchOverviewCollapsed));

                const label = toggle.querySelector('.search-overview-toggle-label');
                const icon = toggle.querySelector('.search-overview-toggle-icon');
                if (label) label.textContent = this.searchOverviewCollapsed ? 'Expand' : 'Collapse';
                if (icon) icon.textContent = this.searchOverviewCollapsed ? '⌄' : '⌃';
            }

            toggleSearchOverview() {
                this.searchOverviewCollapsed = !this.searchOverviewCollapsed;
                localStorage.setItem('elixium-search-overview-collapsed', String(this.searchOverviewCollapsed));
                this.syncSearchOverviewState();
            }

            syncHomeOverviewState() {
                const container = document.querySelector('.home-overview-shell');
                const toggle = document.getElementById('home-overview-toggle');
                if (!container || !toggle) return;

                container.classList.toggle('is-collapsed', this.homeOverviewCollapsed);
                toggle.setAttribute('aria-expanded', String(!this.homeOverviewCollapsed));

                const label = toggle.querySelector('.search-overview-toggle-label');
                const icon = toggle.querySelector('.search-overview-toggle-icon');
                if (label) label.textContent = this.homeOverviewCollapsed ? 'Expand' : 'Collapse';
                if (icon) icon.textContent = this.homeOverviewCollapsed ? '⌄' : '⌃';
            }

            toggleHomeOverview() {
                this.homeOverviewCollapsed = !this.homeOverviewCollapsed;
                localStorage.setItem('elixium-home-overview-collapsed', String(this.homeOverviewCollapsed));
                this.syncHomeOverviewState();
            }

            init() {
                this.applyTheme(this.currentTheme, false);
                this.renderThemeOptions();
                this.loadQualitySettingsFromLocalStorage();
                this.loadPlaylistsFromStorage();
                this.setupEventListeners();
                this.setupSocketListeners();
                this.updateQualityOptions();
                this.loadSettings();                
                this.setupAlbumModal();
                this.setupPlaylistModal();
                this.setupArtistDetailModal();
                this.setupViewAllModal();
                this.setupWatchlistArtistModal();
                this.setupHomeListeners();

                this.currentPage = 'home';

                this.initializeProgressPanel();
                this.initDownloadTableResizers();

                this.restoreSearchResults();

                this.restoreSelectedService();

                this.restoreDownloadQueue();

                this.restoreSearchType();

                this.restoreViewMode();

                this.restoreLastSearch();

                this.restoreCurrentPage();

                this.restoreSidebarState();

                this.loadQualitySettings();                            
                this.initMiniRail();

                this.initAudio();
                this.initFullPlayer();
                this.updateUI();
                this.initPlaylistsUI();
                this.renderRecentSearches();
                this.renderRecentDownloads();
                this.renderSessionDeck();
                this.renderQueueInsights();
                this.syncSearchOverviewState();
                this.syncHomeOverviewState();
                this.loadWatchlistState();
                this.loadFavoriteGenres();

                // Sidebar Player nav opens the full player
                const playerNav = document.querySelector('button.nav-item[data-page="player"]');
                if (playerNav) {
                    playerNav.addEventListener('click', (e) => {
                        e.preventDefault();
                        this.showFullPlayer();
                    });
                }

                // Settings: client downloads toggle
                const clientToggle = document.getElementById('client-downloads');
                if (clientToggle) {
                    clientToggle.checked = this.downloadToClient;
                    clientToggle.addEventListener('change', () => {
                        this.downloadToClient = clientToggle.checked;
                        localStorage.setItem('downloadToClient', String(this.downloadToClient));
                    });
                }
            }

            calculateDefaultDownloadColumnWidths(containerWidth) {
                const width = Math.max(containerWidth || 1120, 1120);
                const columns = Object.keys(this.downloadColumnRatios);
                const widths = {};

                columns.forEach((column) => {
                    const proposed = Math.round(width * this.downloadColumnRatios[column]);
                    widths[column] = Math.max(this.downloadColumnMinWidths[column] || 120, proposed);
                });

                return widths;
            }

            persistDownloadColumnWidths() {
                try {
                    localStorage.setItem(this.downloadColumnStorageKey, JSON.stringify(this.downloadColumnWidths || {}));
                } catch {}
            }

            applyDownloadColumnWidths() {
                const container = document.querySelector('.download-table-container');
                const table = document.querySelector('.download-table');
                if (!container || !table) return;

                const defaults = this.calculateDefaultDownloadColumnWidths(container.clientWidth);
                const columns = Object.keys(this.downloadColumnRatios);
                let totalWidth = 0;

                columns.forEach((column) => {
                    const width = Math.max(
                        this.downloadColumnMinWidths[column] || 120,
                        Math.round(Number(this.downloadColumnWidths?.[column]) || defaults[column])
                    );
                    const col = table.querySelector(`col[data-column="${column}"]`);
                    if (col) {
                        col.style.width = `${width}px`;
                    }
                    totalWidth += width;
                });

                const finalWidth = Math.max(container.clientWidth, totalWidth);
                table.style.width = `${finalWidth}px`;
                table.style.minWidth = `${finalWidth}px`;
            }

            initDownloadTableResizers() {
                const container = document.querySelector('.download-table-container');
                const table = document.querySelector('.download-table');
                if (!container || !table) return;

                const columns = Object.keys(this.downloadColumnRatios);
                if (!this.downloadColumnWidths || columns.every((column) => !Number(this.downloadColumnWidths?.[column]))) {
                    this.downloadColumnWidths = this.calculateDefaultDownloadColumnWidths(container.clientWidth);
                }

                this.applyDownloadColumnWidths();

                if (!this.downloadColumnResizersBound) {
                    window.addEventListener('resize', () => {
                        this.applyDownloadColumnWidths();
                    });
                    this.downloadColumnResizersBound = true;
                }

                table.querySelectorAll('thead th[data-column]').forEach((headerCell) => {
                    if (headerCell.dataset.resizeBound === 'true') return;

                    const column = headerCell.dataset.column;
                    const resizer = headerCell.querySelector('.column-resizer');
                    if (!column || !resizer) return;

                    resizer.addEventListener('dblclick', (event) => {
                        event.preventDefault();
                        const defaults = this.calculateDefaultDownloadColumnWidths(container.clientWidth);
                        this.downloadColumnWidths[column] = defaults[column];
                        this.applyDownloadColumnWidths();
                        this.persistDownloadColumnWidths();
                    });

                    resizer.addEventListener('mousedown', (event) => {
                        if (window.innerWidth <= 900) return;

                        event.preventDefault();
                        event.stopPropagation();

                        const startX = event.clientX;
                        const startWidth = Number(this.downloadColumnWidths?.[column]) || headerCell.getBoundingClientRect().width;

                        const handleMouseMove = (moveEvent) => {
                            const nextWidth = Math.max(
                                this.downloadColumnMinWidths[column] || 120,
                                Math.round(startWidth + (moveEvent.clientX - startX))
                            );
                            this.downloadColumnWidths[column] = nextWidth;
                            this.applyDownloadColumnWidths();
                        };

                        const handleMouseUp = () => {
                            document.body.classList.remove('is-col-resizing');
                            window.removeEventListener('mousemove', handleMouseMove);
                            window.removeEventListener('mouseup', handleMouseUp);
                            this.persistDownloadColumnWidths();
                        };

                        document.body.classList.add('is-col-resizing');
                        window.addEventListener('mousemove', handleMouseMove);
                        window.addEventListener('mouseup', handleMouseUp);
                    });

                    headerCell.dataset.resizeBound = 'true';
                });
            }

            renderThemeOptions() {
                const container = document.getElementById('theme-options');
                if (!container) return;

                container.innerHTML = this.themePresets.map((theme) => `
                    <button class="theme-option" type="button" data-theme-id="${theme.id}">
                        <div class="theme-option-header">
                            <div class="theme-option-name">${theme.name}</div>
                            <span class="theme-option-tag">${theme.mode}</span>
                        </div>
                        <div class="theme-option-preview">
                            ${theme.swatches.map((color) => `<span class="theme-option-swatch" style="background:${color}"></span>`).join('')}
                        </div>
                        <div class="theme-option-copy">${theme.description}</div>
                    </button>
                `).join('');

                container.querySelectorAll('.theme-option').forEach((button) => {
                    button.addEventListener('click', () => {
                        this.applyTheme(button.dataset.themeId, true);
                    });
                });

                this.syncThemeUI();
            }

            applyTheme(themeId, notify = false) {
                const nextTheme = this.themePresets.find((theme) => theme.id === themeId) || this.themePresets[0];
                this.currentTheme = nextTheme.id;
                document.body.setAttribute('data-theme', nextTheme.id);
                localStorage.setItem('elixium-theme', nextTheme.id);
                this.syncThemeUI();

                if (notify) {
                    this.showNotification(`Theme switched to ${nextTheme.name}`, 'info');
                }
            }

            syncThemeUI() {
                const activeTheme = this.themePresets.find((theme) => theme.id === this.currentTheme) || this.themePresets[0];
                const nameEl = document.getElementById('theme-active-name');
                const descEl = document.getElementById('theme-active-description');

                if (nameEl) nameEl.textContent = activeTheme.name;
                if (descEl) descEl.textContent = activeTheme.description;

                document.querySelectorAll('.theme-option').forEach((button) => {
                    button.classList.toggle('active', button.dataset.themeId === activeTheme.id);
                });
            }

            saveRecentSearch(query) {
                const normalized = String(query || '').trim();
                if (!normalized) return;

                this.recentSearches = [
                    normalized,
                    ...this.recentSearches.filter((item) => item.toLowerCase() !== normalized.toLowerCase()),
                ].slice(0, 10);

                localStorage.setItem('elixium-recent-searches', JSON.stringify(this.recentSearches));
                this.renderRecentSearches();
            }

            renderRecentSearches() {
                const targets = ['recent-searches-panel', 'home-recent-searches', 'mobile-home-recent-searches'];

                targets.forEach((id) => {
                    const container = document.getElementById(id);
                    if (!container) return;

                    if (!this.recentSearches.length) {
                        container.innerHTML =
                            '<div class="history-empty">Your recent searches will live here once you start exploring.</div>';
                        return;
                    }

                    container.innerHTML = this.recentSearches
                        .map(
                            (query) => `
                                <button class="history-chip" type="button" data-recent-search="${this.escapeHtml(query)}">
                                    ${this.escapeHtml(query)}
                                </button>
                            `,
                        )
                        .join('');
                });
            }

            saveRecentDownload(item) {
                if (!item || !item.id) return;

                const normalized = {
                    id: String(item.id),
                    title: item.title || 'Unknown',
                    artist: item.artist || 'Unknown Artist',
                    album: item.album || '',
                    type: item.type || 'track',
                    service: item.service || this.currentService || 'deezer',
                    endTime: item.endTime ? new Date(item.endTime).toISOString() : new Date().toISOString(),
                    rawData: item.rawData || {},
                };

                const identity = this.getQueueIdentity(normalized);
                this.recentDownloads = [
                    normalized,
                    ...(this.recentDownloads || []).filter((entry) => this.getQueueIdentity(entry) !== identity),
                ].slice(0, 8);

                localStorage.setItem('elixium-recent-downloads', JSON.stringify(this.recentDownloads));
                this.renderRecentDownloads();
            }

            renderRecentDownloads() {
                const targets = ['home-recent-downloads', 'mobile-home-recent-downloads'];

                targets.forEach((id) => {
                    const container = document.getElementById(id);
                    if (!container) return;

                    if (!this.recentDownloads.length) {
                        container.innerHTML = `
                            <div class="recent-download-empty">
                                Finished downloads will show up here once you land a few items.
                            </div>
                        `;
                        return;
                    }

                    container.innerHTML = this.recentDownloads
                        .map((item) => {
                            const cover = this.getCoverArtUrl(item);
                            const finished = item.endTime ? new Date(item.endTime) : null;
                            const finishedLabel =
                                finished && !Number.isNaN(finished.getTime())
                                    ? finished.toLocaleDateString(undefined, {month: 'short', day: 'numeric'})
                                    : 'Recently';
                            const payload = this.escapeHtml(
                                JSON.stringify({
                                    id: item.id,
                                    type: item.type,
                                    service: item.service,
                                }),
                            );

                            return `
                                <button class="recent-download-item" type="button" data-recent-download="${payload}">
                                    <div class="recent-download-cover">
                                        ${cover
                                            ? `<img src="${cover}" alt="${this.escapeHtml(item.title)}" loading="lazy">`
                                            : '<div class="result-cover-placeholder">🎵</div>'}
                                    </div>
                                    <div class="recent-download-copy">
                                        <strong>${this.escapeHtml(this.truncateText(item.title, 34))}</strong>
                                        <span>${this.escapeHtml(this.truncateText(item.artist || item.album || 'Unknown Artist', 30))}</span>
                                    </div>
                                    <div class="recent-download-meta">
                                        <span>${this.escapeHtml(String(item.service || '').toUpperCase())}</span>
                                        <span>${this.escapeHtml(finishedLabel)}</span>
                                    </div>
                                </button>
                            `;
                        })
                        .join('');
                });
            }

            loadWatchlistState() {
                this.socket.emit('getWatchlistState');
                this.socket.emit('getWatchlistHistory');
                this.socket.emit('getMonitorSchedules');
                this.socket.emit('getMonitorHistory');
            }

            loadFavoriteGenres() {
                this.socket.emit('getFavoriteGenres');
            }

            loadAvailableGenres() {
                this.socket.emit('getFavoriteGenres');
            }

            refreshWatchlist() {
                this.socket.emit('refreshAllWatchedArtists');
                this.socket.emit('refreshAllWatchedPlaylists');
            }

            refreshActiveGenrePage() {
                if (!this.activeGenrePageId) return;
                this.genrePageState[this.activeGenrePageId] = {
                    items: [],
                    offset: 0,
                    limit: 24,
                    hasMore: true,
                    loading: false,
                };
                this.requestGenrePage(false);
            }

            requestGenrePage(append = false) {
                if (!this.activeGenrePageId) return;
                const state = this.genrePageState[this.activeGenrePageId] || {
                    items: [],
                    offset: 0,
                    limit: 24,
                    hasMore: true,
                    loading: false,
                };
                if (state.loading) return;

                state.loading = true;
                this.genrePageState[this.activeGenrePageId] = state;
                this.updateGenreLoadMoreButton();
                this.socket.emit('getGenreDiscovery', {
                    genreId: this.activeGenrePageId,
                    limit: state.limit || 24,
                    offset: append ? state.offset || 0 : 0,
                });
            }

            loadMoreActiveGenrePage() {
                if (!this.activeGenrePageId) return;
                const state = this.genrePageState[this.activeGenrePageId];
                if (!state || state.loading || !state.hasMore) return;
                this.requestGenrePage(true);
            }

            isArtistWatched(artistId) {
                const watchedArtists = this.watchlistState?.watchedArtists || [];
                return watchedArtists.some((artist) => String(artist.id) === String(artistId));
            }

            isPlaylistWatched(playlistId, service = '') {
                const normalizedService = String(service || '').toLowerCase();
                const watchedPlaylists = this.watchlistState?.watchedPlaylists || [];
                return watchedPlaylists.some((playlist) =>
                    String(playlist.id) === String(playlistId) &&
                    (!normalizedService || String(playlist.service || '').toLowerCase() === normalizedService)
                );
            }

            getWatchablePlaylistUrl(playlist) {
                const service = String(playlist?.service || this.currentService || '').toLowerCase();
                const raw = playlist?.rawData || {};
                const directCandidate = [
                    playlist?.url,
                    raw?.url,
                    raw?.share,
                    raw?.permalink,
                    raw?.permalink_url,
                    raw?.link,
                    raw?.publicPlaylistURL,
                ].find((value) => typeof value === 'string' && value.trim());

                if (directCandidate) {
                    return String(directCandidate).trim();
                }

                const id = String(playlist?.id || '').trim();
                if (!id) return '';

                switch (service) {
                    case 'qobuz':
                        return `https://play.qobuz.com/playlist/${id}`;
                    case 'deezer':
                        return `https://www.deezer.com/us/playlist/${id}`;
                    case 'tidal':
                        return `https://tidal.com/playlist/${id}`;
                    case 'spotify':
                        return `https://open.spotify.com/playlist/${id}`;
                    default:
                        return '';
                }
            }

            toggleWatchedArtist(artist) {
                if (!artist || String(artist.service || '').toLowerCase() !== 'qobuz') {
                    this.showNotification('Watchlist is Qobuz-only in this first version', 'info');
                    return;
                }

                if (this.isArtistWatched(artist.id)) {
                    this.socket.emit('removeWatchedArtist', {artistId: artist.id});
                    this.showNotification(`${artist.name || artist.title || 'Artist'} removed from watchlist`, 'info');
                } else {
                    this.socket.emit('addWatchedArtist', {
                        id: artist.id,
                        name: artist.name || artist.title || artist.artist || 'Artist',
                        image: artist.image || this.getCoverArtUrl(artist) || '',
                        service: 'qobuz',
                    });
                    this.showNotification(`${artist.name || artist.title || 'Artist'} added to watchlist`, 'success');
                }
            }

            toggleWatchedPlaylist(playlist) {
                const service = String(playlist?.service || this.currentService || '').toLowerCase();
                if (!playlist || !service) {
                    this.showNotification('Playlist data is incomplete', 'error');
                    return;
                }

                if (!['qobuz', 'deezer', 'tidal', 'spotify'].includes(service)) {
                    this.showNotification('That playlist service is not supported in Watchlist', 'info');
                    return;
                }

                if (this.isPlaylistWatched(playlist.id, service)) {
                    this.socket.emit('removeWatchedPlaylist', {playlistId: playlist.id});
                    this.showNotification(`${playlist.title || 'Playlist'} removed from watchlist`, 'info');
                    return;
                }

                const url = this.getWatchablePlaylistUrl(playlist);
                if (!url) {
                    this.showNotification('Could not determine a playlist URL for watchlist monitoring', 'error');
                    return;
                }

                this.socket.emit('addWatchedPlaylist', {url});
                this.showNotification(`${playlist.title || 'Playlist'} added to watchlist`, 'success');
            }

            saveWatchedArtistRules(artistId, rules) {
                this.socket.emit('saveWatchedArtistRules', {artistId, rules});
            }

            setWatchlistView(view) {
                const nextView = ['artists', 'playlists', 'wanted', 'history', 'schedule'].includes(view) ? view : 'artists';
                this.watchlistView = nextView;
                document.querySelectorAll('[data-watchlist-view]').forEach((button) => {
                    button.classList.toggle('active', button.dataset.watchlistView === nextView);
                });
                document.querySelectorAll('[data-watchlist-view-panel]').forEach((panel) => {
                    panel.classList.toggle('active', panel.dataset.watchlistViewPanel === nextView);
                });
            }

            getWatchlistPlaylistCandidates(playlistId) {
                return (this.watchlistState?.playlistCandidates || []).filter((candidate) => String(candidate.playlistId) === String(playlistId));
            }

            isWatchlistTrackQueueable(candidate) {
                return ['new', 'needs-review'].includes(String(candidate?.reason || ''));
            }

            saveWatchedPlaylistRules(playlistId, rules) {
                this.socket.emit('saveWatchedPlaylistRules', {playlistId, rules});
            }

            setScheduleMode(kind, mode) {
                const select = document.querySelector(`[data-schedule-mode="${kind}"]`);
                if (select) {
                    select.value = mode;
                }
                document.querySelectorAll(`[data-schedule-mode-chip="${kind}"]`).forEach((button) => {
                    button.classList.toggle('active', button.dataset.modeValue === mode);
                });
                document.querySelectorAll(`[data-schedule-block="${kind}"]`).forEach((block) => {
                    block.hidden = block.dataset.scheduleModeTarget !== mode;
                });
            }

            renderSchedulePicker(kind, schedule) {
                const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                const weekdayGrid = document.querySelector(`[data-schedule-weekday-grid="${kind}"]`);
                const monthdayGrid = document.querySelector(`[data-schedule-monthday-grid="${kind}"]`);
                const weekdayValues = Array.isArray(schedule?.weekdays) ? schedule.weekdays.map(Number) : [1];
                const monthdayValues = Array.isArray(schedule?.monthDays) ? schedule.monthDays.map(Number) : [1];

                if (weekdayGrid) {
                    weekdayGrid.innerHTML = weekdayLabels.map((label, index) => `
                        <button class="watchlist-calendar-chip ${weekdayValues.includes(index) ? 'active' : ''}" type="button" data-schedule-weekday-chip="${kind}" data-day-value="${index}">
                            ${label}
                        </button>
                    `).join('');
                }

                if (monthdayGrid) {
                    monthdayGrid.innerHTML = Array.from({length: 31}, (_, offset) => {
                        const value = offset + 1;
                        return `
                            <button class="watchlist-calendar-chip ${monthdayValues.includes(value) ? 'active' : ''}" type="button" data-schedule-monthday-chip="${kind}" data-date-value="${value}">
                                ${value}
                            </button>
                        `;
                    }).join('');
                }

                this.setScheduleMode(kind, schedule?.mode || 'interval-days');
            }

            saveMonitorSchedule(kind) {
                const enabled = document.querySelector(`[data-schedule-enabled="${kind}"]`)?.checked || false;
                const mode = document.querySelector(`[data-schedule-mode="${kind}"]`)?.value || 'interval-days';
                const intervalDays = Number(document.querySelector(`[data-schedule-days="${kind}"]`)?.value || 1);
                const intervalHours = Number(document.querySelector(`[data-schedule-hours="${kind}"]`)?.value || 12);
                const weekdays = Array.from(document.querySelectorAll(`[data-schedule-weekday-chip="${kind}"].active`))
                    .map((button) => Number(button.dataset.dayValue))
                    .filter((value) => Number.isFinite(value));
                const monthDays = Array.from(document.querySelectorAll(`[data-schedule-monthday-chip="${kind}"].active`))
                    .map((button) => Number(button.dataset.dateValue))
                    .filter((value) => Number.isFinite(value));
                const hour = Number(document.querySelector(`[data-schedule-hour="${kind}"]`)?.value || 8);
                const minute = Number(document.querySelector(`[data-schedule-minute="${kind}"]`)?.value || 0);
                this.socket.emit('saveMonitorSchedule', {
                    kind,
                    schedule: {
                        enabled,
                        mode,
                        intervalDays,
                        intervalHours,
                        weekdays,
                        monthDays,
                        hour,
                        minute,
                    },
                });
            }

            queueWatchedArtistDiscography(artistId, autoStart = false) {
                this.socket.emit('queueWatchedArtistDiscography', {artistId, autoStart});
            }

            queueWatchedArtistTracks(artistId, autoStart = false) {
                this.socket.emit('queueWatchedArtistTracks', {artistId, autoStart});
            }

            getWatchlistAlbumPreviewCacheKey(albumId) {
                return `watchlist:qobuz:${String(albumId)}`;
            }

            isWatchlistAlbumExpanded(albumId) {
                return this.watchlistExpandedAlbumIds.has(String(albumId));
            }

            toggleWatchlistAlbumPreview(candidate) {
                const albumId = String(candidate?.id || '');
                if (!albumId) return;

                if (this.watchlistExpandedAlbumIds.has(albumId)) {
                    this.watchlistExpandedAlbumIds.delete(albumId);
                    this.renderWatchlistPage();
                    return;
                }

                this.watchlistExpandedAlbumIds.add(albumId);
                this.renderWatchlistPage();

                const cacheKey = this.getWatchlistAlbumPreviewCacheKey(albumId);
                if (this.watchlistAlbumPreviewCache.has(cacheKey)) {
                    return;
                }

                this.watchlistAlbumPreviewCache.set(cacheKey, {loading: true, tracks: []});
                this.socket.emit('getAlbumTracks', {
                    albumId,
                    service: 'qobuz',
                    albumData: {
                        id: albumId,
                        title: candidate.title,
                        artist: candidate.artist,
                        rawData: candidate.rawData || {},
                    },
                });
            }

            handleWatchlistAlbumPreview(tracksData) {
                const albumId = String(tracksData?.albumId || '');
                if (!albumId || !this.watchlistExpandedAlbumIds.has(albumId)) {
                    return false;
                }

                const cacheKey = this.getWatchlistAlbumPreviewCacheKey(albumId);
                this.watchlistAlbumPreviewCache.set(cacheKey, {
                    loading: false,
                    tracks: Array.isArray(tracksData?.tracks) ? tracksData.tracks : [],
                    albumInfo: tracksData?.albumInfo || {},
                });
                this.renderWatchlistPage();
                return true;
            }

            getWatchlistArtistById(artistId) {
                return (this.watchlistState?.watchedArtists || []).find((artist) => String(artist.id) === String(artistId)) || null;
            }

            getWatchlistArtistCandidates(artistId) {
                return (this.watchlistState?.candidates || []).filter((candidate) => String(candidate.artistId) === String(artistId));
            }

            getSelectedWatchlistAlbumIdsForArtist(artistId) {
                return this.getWatchlistArtistCandidates(artistId)
                    .filter((candidate) => this.watchlistCandidatesSelection.has(String(candidate.id)))
                    .map((candidate) => String(candidate.id));
            }

            isWatchlistCandidateQueueable(candidate) {
                return ['new', 'needs-review'].includes(String(candidate?.reason || ''));
            }

            getQueueableWatchlistArtistCandidates(artistId) {
                return this.getWatchlistArtistCandidates(artistId)
                    .filter((candidate) => this.isWatchlistCandidateQueueable(candidate));
            }

            getQueueableWatchlistArtistAlbumIds(artistId) {
                return this.getQueueableWatchlistArtistCandidates(artistId).map((candidate) => String(candidate.id));
            }

            getQueueableSelectedWatchlistAlbumIdsForArtist(artistId) {
                const queueableIds = new Set(this.getQueueableWatchlistArtistAlbumIds(artistId));
                return this.getSelectedWatchlistAlbumIdsForArtist(artistId)
                    .filter((albumId) => queueableIds.has(String(albumId)));
            }

            selectAllWatchlistAlbumsForArtist(artistId) {
                this.getQueueableWatchlistArtistCandidates(artistId).forEach((candidate) => {
                    this.watchlistCandidatesSelection.add(String(candidate.id));
                });
                this.renderWatchlistArtistModal();
            }

            clearWatchlistAlbumSelectionForArtist(artistId) {
                this.getWatchlistArtistCandidates(artistId).forEach((candidate) => {
                    this.watchlistCandidatesSelection.delete(String(candidate.id));
                });
                this.renderWatchlistArtistModal();
            }

            queueAllWatchlistAlbumsForArtist(artistId, autoStart = false) {
                const albumIds = this.getQueueableWatchlistArtistAlbumIds(artistId);
                if (!albumIds.length) {
                    this.showNotification('No queueable albums are waiting for this artist', 'info');
                    return;
                }
                this.socket.emit('queueWatchedArtistReleases', {albumIds, autoStart});
                this.clearWatchlistAlbumSelectionForArtist(artistId);
            }

            setupWatchlistArtistModal() {
                this.watchlistArtistModal = {
                    overlay: document.getElementById('watchlist-artist-modal'),
                    closeBtn: document.getElementById('watchlist-artist-modal-close'),
                    refreshBtn: document.getElementById('watchlist-artist-modal-refresh'),
                    removeBtn: document.getElementById('watchlist-artist-modal-remove'),
                    cover: document.getElementById('watchlist-artist-modal-cover'),
                    title: document.getElementById('watchlist-artist-modal-title'),
                    subtitle: document.getElementById('watchlist-artist-modal-subtitle'),
                    status: document.getElementById('watchlist-artist-modal-status'),
                    helper: document.getElementById('watchlist-artist-modal-helper'),
                    list: document.getElementById('watchlist-artist-modal-list'),
                    selectAllBtn: document.getElementById('watchlist-artist-modal-select-all'),
                    clearSelectionBtn: document.getElementById('watchlist-artist-modal-clear-selection'),
                    queueAllBtn: document.getElementById('watchlist-artist-modal-queue-all'),
                    downloadAllBtn: document.getElementById('watchlist-artist-modal-download-all'),
                    discographyBtn: document.getElementById('watchlist-artist-modal-discography'),
                    topTracksBtn: document.getElementById('watchlist-artist-modal-top-tracks'),
                    downloadSelectedBtn: document.getElementById('watchlist-artist-modal-download-selected'),
                    queueSelectedBtn: document.getElementById('watchlist-artist-modal-queue-selected'),
                    markReviewedBtn: document.getElementById('watchlist-artist-modal-mark-reviewed'),
                    autoAlbumsBtn: document.getElementById('watchlist-artist-modal-auto-albums'),
                    autoTracksBtn: document.getElementById('watchlist-artist-modal-auto-tracks'),
                };

                const modal = this.watchlistArtistModal;
                if (!modal?.overlay) return;

                modal.closeBtn?.addEventListener('click', () => this.closeWatchlistArtistModal());
                modal.overlay.addEventListener('click', (event) => {
                    if (event.target === modal.overlay) this.closeWatchlistArtistModal();
                });

                modal.refreshBtn?.addEventListener('click', () => {
                    if (!this.currentWatchlistArtistId) return;
                    this.socket.emit('refreshWatchedArtist', {artistId: this.currentWatchlistArtistId});
                });

                modal.removeBtn?.addEventListener('click', () => {
                    if (!this.currentWatchlistArtistId) return;
                    this.socket.emit('removeWatchedArtist', {artistId: this.currentWatchlistArtistId});
                    this.closeWatchlistArtistModal();
                });

                modal.selectAllBtn?.addEventListener('click', () => {
                    if (!this.currentWatchlistArtistId) return;
                    this.selectAllWatchlistAlbumsForArtist(this.currentWatchlistArtistId);
                });

                modal.clearSelectionBtn?.addEventListener('click', () => {
                    if (!this.currentWatchlistArtistId) return;
                    this.clearWatchlistAlbumSelectionForArtist(this.currentWatchlistArtistId);
                });

                modal.queueAllBtn?.addEventListener('click', () => {
                    if (!this.currentWatchlistArtistId) return;
                    this.queueAllWatchlistAlbumsForArtist(this.currentWatchlistArtistId, false);
                });

                modal.downloadAllBtn?.addEventListener('click', () => {
                    if (!this.currentWatchlistArtistId) return;
                    this.queueAllWatchlistAlbumsForArtist(this.currentWatchlistArtistId, true);
                });

                modal.discographyBtn?.addEventListener('click', () => {
                    if (!this.currentWatchlistArtistId) return;
                    this.queueWatchedArtistDiscography(this.currentWatchlistArtistId, false);
                });

                modal.topTracksBtn?.addEventListener('click', () => {
                    if (!this.currentWatchlistArtistId) return;
                    this.queueWatchedArtistTracks(this.currentWatchlistArtistId, false);
                });

                modal.queueSelectedBtn?.addEventListener('click', () => {
                    if (!this.currentWatchlistArtistId) return;
                    const selected = this.getQueueableSelectedWatchlistAlbumIdsForArtist(this.currentWatchlistArtistId);
                    if (!selected.length) {
                        this.showNotification('Select at least one new or review-needed album first', 'info');
                        return;
                    }
                    this.socket.emit('queueWatchedArtistReleases', {albumIds: selected});
                    this.renderWatchlistArtistModal();
                });

                modal.downloadSelectedBtn?.addEventListener('click', () => {
                    if (!this.currentWatchlistArtistId) return;
                    const selected = this.getQueueableSelectedWatchlistAlbumIdsForArtist(this.currentWatchlistArtistId);
                    if (!selected.length) {
                        this.showNotification('Select at least one new or review-needed album first', 'info');
                        return;
                    }
                    this.socket.emit('queueWatchedArtistReleases', {albumIds: selected, autoStart: true});
                    this.renderWatchlistArtistModal();
                });

                modal.markReviewedBtn?.addEventListener('click', () => {
                    if (!this.currentWatchlistArtistId) return;
                    const selected = this.getSelectedWatchlistAlbumIdsForArtist(this.currentWatchlistArtistId);
                    if (!selected.length) {
                        this.showNotification('Select at least one album first', 'info');
                        return;
                    }
                    this.socket.emit('markWatchlistAlbumsProcessed', {albumIds: selected, reason: 'dismissed'});
                    this.renderWatchlistArtistModal();
                });

                modal.autoAlbumsBtn?.addEventListener('click', () => {
                    const artist = this.getWatchlistArtistById(this.currentWatchlistArtistId);
                    if (!artist) return;
                    this.saveWatchedArtistRules(this.currentWatchlistArtistId, {
                        ...artist.rules,
                        autoQueueAlbums: !artist?.rules?.autoQueueAlbums,
                    });
                });

                modal.autoTracksBtn?.addEventListener('click', () => {
                    const artist = this.getWatchlistArtistById(this.currentWatchlistArtistId);
                    if (!artist) return;
                    this.saveWatchedArtistRules(this.currentWatchlistArtistId, {
                        ...artist.rules,
                        autoQueueTracks: !artist?.rules?.autoQueueTracks,
                    });
                });
            }

            openWatchlistArtistModal(artistId) {
                this.currentWatchlistArtistId = String(artistId || '');
                if (!this.currentWatchlistArtistId || !this.watchlistArtistModal?.overlay) return;
                this.renderWatchlistArtistModal();
                this.watchlistArtistModal.overlay.classList.add('show');
            }

            closeWatchlistArtistModal() {
                if (!this.watchlistArtistModal?.overlay) return;
                this.watchlistArtistModal.overlay.classList.remove('show');
                this.currentWatchlistArtistId = '';
            }

            renderWatchlistArtistModal() {
                const modal = this.watchlistArtistModal;
                if (!modal?.overlay) return;

                const artist = this.getWatchlistArtistById(this.currentWatchlistArtistId);
                if (!artist) {
                    modal.overlay.classList.remove('show');
                    this.currentWatchlistArtistId = '';
                    return;
                }

                const candidates = this.getWatchlistArtistCandidates(this.currentWatchlistArtistId);
                const queueableCount = this.getQueueableWatchlistArtistAlbumIds(this.currentWatchlistArtistId).length;
                const selectedCount = this.getQueueableSelectedWatchlistAlbumIdsForArtist(this.currentWatchlistArtistId).length;

                if (modal.cover) {
                    modal.cover.innerHTML = artist.image
                        ? `<img src="${artist.image}" alt="${this.escapeHtml(artist.name)}" loading="lazy">`
                        : '🎤';
                }
                if (modal.title) modal.title.textContent = artist.name || 'Artist';
                if (modal.subtitle) {
                    modal.subtitle.textContent = queueableCount
                        ? `${queueableCount} queueable album${queueableCount === 1 ? '' : 's'} ready. Use Download All for the full batch or Select All if you want manual control.`
                        : 'No new albums are waiting. Turn on scheduled auto download, then use Run Now or your saved schedule to scan this artist again.';
                }
                if (modal.status) {
                    const autoAlbumsLabel = artist.rules?.autoQueueAlbums ? 'Scheduled albums ON' : 'Scheduled albums OFF';
                    const autoTracksLabel = artist.rules?.autoQueueTracks ? 'Scheduled tracks ON' : 'Scheduled tracks OFF';
                    modal.status.textContent = selectedCount
                        ? `${selectedCount} selected • ${autoAlbumsLabel} • ${autoTracksLabel}`
                        : `${artist.status || 'idle'} • ${autoAlbumsLabel} • ${autoTracksLabel} • ${artist.lastCheckedAt ? `Checked ${new Date(artist.lastCheckedAt).toLocaleDateString()}` : 'Not checked yet'}`;
                }
                if (modal.helper) {
                    modal.helper.textContent = artist.rules?.autoQueueAlbums || artist.rules?.autoQueueTracks
                        ? 'Scheduled monitor downloads are active. Run Now or your saved schedule will queue and start matching new releases automatically.'
                        : 'Enable scheduled auto download if you want Run Now or the saved schedule to automatically queue and start new releases.';
                }

                modal.autoAlbumsBtn?.classList.toggle('active', Boolean(artist.rules?.autoQueueAlbums));
                modal.autoTracksBtn?.classList.toggle('active', Boolean(artist.rules?.autoQueueTracks));
                if (modal.autoAlbumsBtn) {
                    modal.autoAlbumsBtn.textContent = artist.rules?.autoQueueAlbums ? 'Schedule Album Downloads On' : 'Schedule Album Downloads';
                }
                if (modal.autoTracksBtn) {
                    modal.autoTracksBtn.textContent = artist.rules?.autoQueueTracks ? 'Schedule Track Downloads On' : 'Schedule Track Downloads';
                }

                if (!modal.list) return;
                if (!candidates.length) {
                    modal.list.innerHTML = '<div class="watchlist-empty">No albums waiting for review for this artist yet.</div>';
                    return;
                }

                modal.list.innerHTML = candidates.map((candidate) => {
                    const isExpanded = this.isWatchlistAlbumExpanded(candidate.id);
                    const previewCache = this.watchlistAlbumPreviewCache.get(this.getWatchlistAlbumPreviewCacheKey(candidate.id));
                    const isQueueable = this.isWatchlistCandidateQueueable(candidate);
                    return `
                        <article class="watchlist-modal-album-card ${candidate.reason}">
                            <label class="watchlist-modal-album-shell">
                                <input type="checkbox" data-watchlist-candidate-toggle="${this.escapeHtml(String(candidate.id))}" ${this.watchlistCandidatesSelection.has(String(candidate.id)) ? 'checked' : ''} ${isQueueable ? '' : 'disabled'}>
                                <div class="watchlist-modal-album-cover">
                                    ${candidate.image
                                        ? `<img src="${candidate.image}" alt="${this.escapeHtml(candidate.title)}" loading="lazy">`
                                        : '<div class="result-cover-placeholder">💿</div>'}
                                </div>
                                <div class="watchlist-modal-album-copy">
                                    <strong>${this.escapeHtml(candidate.title)}</strong>
                                    <span>${this.escapeHtml(candidate.artist)}</span>
                                    <small>${this.escapeHtml([candidate.year || 'Album', candidate.duplicateSource || ''].filter(Boolean).join(' • '))}</small>
                                </div>
                                <div class="watchlist-modal-album-meta">
                                    <span class="watchlist-reason-chip ${this.escapeHtml(candidate.reason)}">${this.escapeHtml(candidate.reason.replace(/-/g, ' '))}</span>
                                </div>
                            </label>
                            <div class="watchlist-modal-album-actions">
                                <button class="watchlist-artist-mini-btn" type="button" data-watchlist-toggle-album="${this.escapeHtml(String(candidate.id))}">${isExpanded ? 'Hide Tracks' : 'Show Tracks'}</button>
                                <button class="watchlist-artist-mini-btn" type="button" data-watchlist-queue-album="${this.escapeHtml(String(candidate.id))}" ${isQueueable ? '' : 'disabled'}>Queue Album</button>
                                <button class="watchlist-artist-mini-btn" type="button" data-watchlist-download-album="${this.escapeHtml(String(candidate.id))}" ${isQueueable ? '' : 'disabled'}>Download Album</button>
                            </div>
                            ${isExpanded ? `
                                <div class="watchlist-track-preview">
                                    ${previewCache?.loading ? '<div class="watchlist-empty">Loading tracks...</div>' : previewCache?.error ? `<div class="watchlist-empty">${this.escapeHtml(previewCache.error)}</div>` : Array.isArray(previewCache?.tracks) && previewCache.tracks.length ? `
                                        <div class="watchlist-track-preview-list">
                                            ${previewCache.tracks.map((track, index) => `
                                                <div class="watchlist-track-preview-item">
                                                    <span class="watchlist-track-preview-number">${index + 1}</span>
                                                    <div class="watchlist-track-preview-copy">
                                                        <strong>${this.escapeHtml(track.title || track.SNG_TITLE || 'Unknown Track')}</strong>
                                                        <span>${this.escapeHtml(this.formatDuration(track.duration || track.DURATION || 0))}</span>
                                                    </div>
                                                </div>
                                            `).join('')}
                                        </div>
                                    ` : '<div class="watchlist-empty">No tracks loaded for this album.</div>'}
                                </div>
                            ` : ''}
                        </article>
                    `;
                }).join('');

                modal.list.querySelectorAll('[data-watchlist-candidate-toggle]').forEach((checkbox) => {
                    checkbox.addEventListener('change', () => {
                        const id = String(checkbox.dataset.watchlistCandidateToggle);
                        if (checkbox.checked) this.watchlistCandidatesSelection.add(id);
                        else this.watchlistCandidatesSelection.delete(id);
                        this.renderWatchlistArtistModal();
                    });
                });

                modal.list.querySelectorAll('[data-watchlist-toggle-album]').forEach((button) => {
                    button.addEventListener('click', (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const candidate = candidates.find((entry) => String(entry.id) === String(button.dataset.watchlistToggleAlbum));
                        if (candidate) this.toggleWatchlistAlbumPreview(candidate);
                    });
                });

                modal.list.querySelectorAll('[data-watchlist-queue-album]').forEach((button) => {
                    button.addEventListener('click', (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        this.socket.emit('queueWatchedArtistReleases', {albumIds: [String(button.dataset.watchlistQueueAlbum)]});
                    });
                });

                modal.list.querySelectorAll('[data-watchlist-download-album]').forEach((button) => {
                    button.addEventListener('click', (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        this.socket.emit('queueWatchedArtistReleases', {albumIds: [String(button.dataset.watchlistDownloadAlbum)], autoStart: true});
                    });
                });
            }

            queueIncomingWatchlistItems(queueItems, autoStart = false) {
                let added = 0;
                queueItems.forEach((item) => {
                    const normalized = {
                        ...item,
                        service: item.service || 'qobuz',
                    };
                    const result = this.upsertQueueItem(normalized, 'queued');
                    if (result?.added) added += 1;
                });

                this.updateQueueUI();
                if (added > 0) {
                    this.showNotification(`Added ${added} watchlist item${added === 1 ? '' : 's'} to queue`, 'success');
                } else {
                    this.showNotification('No new watchlist albums were queueable. Already processed or duplicate items stay in review.', 'info');
                }

                if (!autoStart || this.isDownloading) {
                    return;
                }

                const queuedItems = this.getQueuedItemsForStart();
                const queueServices = [...new Set(queuedItems.map((item) => {
                    if (item.service === 'user-playlist') {
                        const nestedServices = [...new Set((item.tracks || []).map((track) => track.service).filter(Boolean))];
                        if (nestedServices.length === 1) return nestedServices[0];
                    }
                    return item.service || 'qobuz';
                }))];
                if (queueServices.length === 1) {
                    this.currentService = queueServices[0];
                    this.currentQuality = this.qualitySettings[this.currentService] || this.currentQuality;
                    this.startDownload();
                } else if (queueServices.length > 1) {
                    this.showNotification('Watchlist items were queued, but mixed-service auto start is disabled.', 'info');
                }
            }

            syncWatchButtons() {
                this.updateArtistDetailWatchButton?.();

                document.querySelectorAll('[data-watch-artist-id]').forEach((button) => {
                    const watched = this.isArtistWatched(button.dataset.watchArtistId);
                    button.classList.toggle('active', watched);
                    button.classList.toggle('watched', watched);
                    button.setAttribute('aria-label', watched ? 'Unwatch artist' : 'Watch artist');
                    button.setAttribute('title', watched ? 'Unwatch artist' : 'Watch artist');
                    const label = button.querySelector('[data-watch-label]');
                    if (label) {
                        label.textContent = watched ? 'Watching' : 'Watch';
                    }
                });

                document.querySelectorAll('[data-watch-playlist-id]').forEach((button) => {
                    const watched = this.isPlaylistWatched(
                        button.dataset.watchPlaylistId,
                        button.dataset.watchPlaylistService || this.currentService,
                    );
                    button.classList.toggle('active', watched);
                    button.classList.toggle('watched', watched);
                    button.setAttribute('aria-label', watched ? 'Unwatch playlist' : 'Watch playlist');
                    button.setAttribute('title', watched ? 'Unwatch playlist' : 'Watch playlist');
                });
            }

            renderWatchlistSummary() {
                const summary = this.watchlistState?.summary || {watchedArtists: 0, watchedPlaylists: 0, newCandidates: 0, newPlaylistCandidates: 0};
                const historyCount = ((this.watchlistState?.processedAlbums || []).length + (this.watchlistState?.processedTracks || []).length);
                const setText = (id, value) => {
                    const el = document.getElementById(id);
                    if (el) el.textContent = String(value);
                };

                setText('home-watchlist-artists', summary.watchedArtists || 0);
                setText('home-watchlist-candidates', (summary.newCandidates || 0) + (summary.newPlaylistCandidates || 0));
                setText('home-watchlist-history', historyCount);
                setText('watchlist-summary-artists', summary.watchedArtists || 0);
                setText('watchlist-summary-playlists', summary.watchedPlaylists || 0);
                setText('watchlist-summary-candidates', (summary.newCandidates || 0) + (summary.newPlaylistCandidates || 0));
                setText('watchlist-summary-history', historyCount);

                const pulse = document.getElementById('home-watchlist-pulse');
                if (pulse) {
                    const totalMonitors = Number(summary.watchedArtists || 0) + Number(summary.watchedPlaylists || 0);
                    const totalWanted = Number(summary.newCandidates || 0) + Number(summary.newPlaylistCandidates || 0);
                    if (!totalMonitors) {
                        pulse.textContent = 'No artists or playlists monitored yet. Add Qobuz items from Search or Watchlist.';
                    } else if (totalWanted) {
                        pulse.textContent = `${totalWanted} monitor candidate${totalWanted === 1 ? '' : 's'} waiting for review.`;
                    } else {
                        pulse.textContent = 'Monitor checked in clean. No new artists or playlist items are waiting.';
                    }
                }
            }

            renderWatchlistPage() {
                const watchedArtists = this.watchlistState?.watchedArtists || [];
                const watchedPlaylists = this.watchlistState?.watchedPlaylists || [];
                const candidates = this.watchlistState?.candidates || [];
                const playlistCandidates = this.watchlistState?.playlistCandidates || [];
                const history = this.watchlistState?.processedHistory || [];
                const artistsGrid = document.getElementById('watchlist-artists-grid');
                const playlistsGrid = document.getElementById('watchlist-playlists-grid');
                const candidateList = document.getElementById('watchlist-candidates-list');
                const playlistCandidateList = document.getElementById('watchlist-playlist-candidates-list');
                const historyList = document.getElementById('watchlist-history-list');
                const monitorHistoryList = document.getElementById('monitor-history-list');
                const actionIcon = (paths) => `
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                        ${paths}
                    </svg>
                `;

                if (artistsGrid) {
                    if (!watchedArtists.length) {
                        artistsGrid.innerHTML = '<div class="watchlist-empty">Add a Qobuz artist from Search or an artist modal to start the watchlist.</div>';
                    } else {
                        artistsGrid.innerHTML = watchedArtists
                            .map((artist) => `
                                <article class="watchlist-artist-card" data-watchlist-artist="${this.escapeHtml(String(artist.id))}">
                                    <div class="watchlist-artist-cover">
                                        ${artist.image
                                            ? `<img src="${artist.image}" alt="${this.escapeHtml(artist.name)}" loading="lazy">`
                                            : '<div class="result-cover-placeholder">🎤</div>'}
                                    </div>
                                    <div class="watchlist-artist-copy">
                                        <div class="watchlist-artist-header">
                                            <div class="watchlist-artist-title-block">
                                                <strong>${this.escapeHtml(artist.name)}</strong>
                                                <span>${this.escapeHtml((artist.status || 'idle').replace(/-/g, ' '))}${artist.newReleaseCount ? ` • ${this.escapeHtml(String(artist.newReleaseCount))} new` : ''}</span>
                                            </div>
                                            <div class="watchlist-artist-actions">
                                                <button class="discovery-action-btn-round" type="button" data-watchlist-refresh-artist="${this.escapeHtml(String(artist.id))}" title="Refresh artist">
                                                    ${actionIcon('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>')}
                                                </button>
                                                <button class="discovery-action-btn-round" type="button" data-watchlist-remove-artist="${this.escapeHtml(String(artist.id))}" title="Remove artist">
                                                    ${actionIcon('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>')}
                                                </button>
                                            </div>
                                        </div>
                                        <small>${artist.lastCheckedAt ? `Checked ${this.escapeHtml(new Date(artist.lastCheckedAt).toLocaleDateString())}` : 'Not checked yet'}</small>
                                        <div class="watchlist-artist-rule-row">
                                            <button class="watchlist-rule-chip ${artist.rules?.autoQueueAlbums ? 'active' : ''}" type="button" data-watchlist-rule-albums="${this.escapeHtml(String(artist.id))}">
                                                ${artist.rules?.autoQueueAlbums ? 'Schedule Album Downloads On' : 'Schedule Album Downloads'}
                                            </button>
                                            <button class="watchlist-rule-chip ${artist.rules?.autoQueueTracks ? 'active' : ''}" type="button" data-watchlist-rule-tracks="${this.escapeHtml(String(artist.id))}">
                                                ${artist.rules?.autoQueueTracks ? 'Schedule Track Downloads On' : 'Schedule Track Downloads'}
                                            </button>
                                        </div>
                                        <div class="watchlist-artist-action-row">
                                            <button class="watchlist-artist-mini-btn" type="button" data-watchlist-open-artist="${this.escapeHtml(String(artist.id))}">Review</button>
                                            <button class="watchlist-artist-mini-btn" type="button" data-watchlist-download-discography="${this.escapeHtml(String(artist.id))}">Download All Albums</button>
                                            <button class="watchlist-artist-mini-btn" type="button" data-watchlist-queue-tracks="${this.escapeHtml(String(artist.id))}">Top Tracks</button>
                                        </div>
                                    </div>
                                </article>
                            `)
                            .join('');

                        artistsGrid.querySelectorAll('[data-watchlist-refresh-artist]').forEach((button) => {
                            button.addEventListener('click', () => {
                                this.socket.emit('refreshWatchedArtist', {artistId: button.dataset.watchlistRefreshArtist});
                            });
                        });

                        artistsGrid.querySelectorAll('[data-watchlist-remove-artist]').forEach((button) => {
                            button.addEventListener('click', () => {
                                this.socket.emit('removeWatchedArtist', {artistId: button.dataset.watchlistRemoveArtist});
                            });
                        });

                        artistsGrid.querySelectorAll('[data-watchlist-rule-albums]').forEach((button) => {
                            button.addEventListener('click', () => {
                                const artistId = button.dataset.watchlistRuleAlbums;
                                const artist = watchedArtists.find((entry) => String(entry.id) === String(artistId));
                                this.saveWatchedArtistRules(artistId, {
                                    ...artist?.rules,
                                    autoQueueAlbums: !artist?.rules?.autoQueueAlbums,
                                });
                            });
                        });

                        artistsGrid.querySelectorAll('[data-watchlist-rule-tracks]').forEach((button) => {
                            button.addEventListener('click', () => {
                                const artistId = button.dataset.watchlistRuleTracks;
                                const artist = watchedArtists.find((entry) => String(entry.id) === String(artistId));
                                this.saveWatchedArtistRules(artistId, {
                                    ...artist?.rules,
                                    autoQueueTracks: !artist?.rules?.autoQueueTracks,
                                });
                            });
                        });

                        artistsGrid.querySelectorAll('[data-watchlist-download-discography]').forEach((button) => {
                            button.addEventListener('click', () => {
                                this.queueWatchedArtistDiscography(button.dataset.watchlistDownloadDiscography, true);
                            });
                        });

                        artistsGrid.querySelectorAll('[data-watchlist-open-artist]').forEach((button) => {
                            button.addEventListener('click', () => {
                                this.openWatchlistArtistModal(button.dataset.watchlistOpenArtist);
                            });
                        });

                        artistsGrid.querySelectorAll('[data-watchlist-queue-tracks]').forEach((button) => {
                            button.addEventListener('click', () => {
                                this.queueWatchedArtistTracks(button.dataset.watchlistQueueTracks, false);
                            });
                        });
                    }
                }

                if (playlistsGrid) {
                    if (!watchedPlaylists.length) {
                        playlistsGrid.innerHTML = '<div class="watchlist-empty">Paste a Qobuz, Spotify, Deezer, or TIDAL playlist URL above to monitor it for new tracks.</div>';
                    } else {
                        playlistsGrid.innerHTML = watchedPlaylists
                            .map((playlist) => `
                                <article class="watchlist-artist-card watchlist-playlist-card" data-watchlist-playlist="${this.escapeHtml(String(playlist.id))}">
                                    <div class="watchlist-artist-cover">
                                        ${playlist.image
                                            ? `<img src="${playlist.image}" alt="${this.escapeHtml(playlist.title)}" loading="lazy">`
                                            : '<div class="result-cover-placeholder">🎼</div>'}
                                    </div>
                                    <div class="watchlist-artist-copy">
                                        <div class="watchlist-playlist-header">
                                            <div class="watchlist-playlist-title-block">
                                                <strong>${this.escapeHtml(playlist.title)}</strong>
                                                <span>${this.escapeHtml(playlist.owner || `${String(playlist.service || 'qobuz').toUpperCase()} Playlist`)}${playlist.newTrackCount ? ` • ${this.escapeHtml(String(playlist.newTrackCount))} new` : ''}</span>
                                            </div>
                                            <div class="watchlist-artist-actions">
                                                <span class="watchlist-reason-chip ${this.escapeHtml(playlist.service === 'spotify' ? 'needs-review' : 'new')}">${this.escapeHtml(String(playlist.service || 'qobuz').toUpperCase())}</span>
                                                <button class="discovery-action-btn-round" type="button" data-watchlist-refresh-playlist="${this.escapeHtml(String(playlist.id))}" title="Refresh playlist">
                                                    ${actionIcon('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>')}
                                                </button>
                                                <button class="discovery-action-btn-round" type="button" data-watchlist-remove-playlist="${this.escapeHtml(String(playlist.id))}" title="Remove playlist">
                                                    ${actionIcon('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>')}
                                                </button>
                                            </div>
                                        </div>
                                        <small>${playlist.lastError ? this.escapeHtml(playlist.lastError) : (playlist.lastCheckedAt ? `Checked ${this.escapeHtml(new Date(playlist.lastCheckedAt).toLocaleString())}` : 'Not checked yet')}</small>
                                        <div class="watchlist-artist-rule-row">
                                            <button class="watchlist-rule-chip ${playlist.rules?.autoQueueTracks ? 'active' : ''}" type="button" data-watchlist-playlist-auto="${this.escapeHtml(String(playlist.id))}">
                                                ${playlist.rules?.autoQueueTracks ? 'Scheduled Download On' : 'Schedule Downloads'}
                                            </button>
                                        </div>
                                        <div class="watchlist-artist-action-row">
                                            <button class="watchlist-artist-mini-btn" type="button" data-watchlist-playlist-download="${this.escapeHtml(String(playlist.id))}">Download New</button>
                                            <button class="watchlist-artist-mini-btn" type="button" data-watchlist-playlist-queue="${this.escapeHtml(String(playlist.id))}">Queue New</button>
                                        </div>
                                    </div>
                                </article>
                            `)
                            .join('');

                        playlistsGrid.querySelectorAll('[data-watchlist-refresh-playlist]').forEach((button) => {
                            button.addEventListener('click', () => {
                                this.socket.emit('refreshWatchedPlaylist', {playlistId: button.dataset.watchlistRefreshPlaylist});
                            });
                        });

                        playlistsGrid.querySelectorAll('[data-watchlist-remove-playlist]').forEach((button) => {
                            button.addEventListener('click', () => {
                                this.socket.emit('removeWatchedPlaylist', {playlistId: button.dataset.watchlistRemovePlaylist});
                            });
                        });

                        playlistsGrid.querySelectorAll('[data-watchlist-playlist-auto]').forEach((button) => {
                            button.addEventListener('click', () => {
                                const playlistId = button.dataset.watchlistPlaylistAuto;
                                const playlist = watchedPlaylists.find((entry) => String(entry.id) === String(playlistId));
                                this.saveWatchedPlaylistRules(playlistId, {autoQueueTracks: !playlist?.rules?.autoQueueTracks});
                            });
                        });

                        playlistsGrid.querySelectorAll('[data-watchlist-playlist-queue]').forEach((button) => {
                            button.addEventListener('click', () => {
                                const playlistId = button.dataset.watchlistPlaylistQueue;
                                const trackIds = this.getWatchlistPlaylistCandidates(playlistId)
                                    .filter((candidate) => this.isWatchlistTrackQueueable(candidate))
                                    .map((candidate) => String(candidate.id));
                                this.socket.emit('queueWatchedPlaylistTracks', {playlistId, trackIds});
                            });
                        });

                        playlistsGrid.querySelectorAll('[data-watchlist-playlist-download]').forEach((button) => {
                            button.addEventListener('click', () => {
                                const playlistId = button.dataset.watchlistPlaylistDownload;
                                const trackIds = this.getWatchlistPlaylistCandidates(playlistId)
                                    .filter((candidate) => this.isWatchlistTrackQueueable(candidate))
                                    .map((candidate) => String(candidate.id));
                                this.socket.emit('queueWatchedPlaylistTracks', {playlistId, trackIds, autoStart: true});
                            });
                        });
                    }
                }

                if (candidateList) {
                    if (!candidates.length) {
                        candidateList.innerHTML = '<div class="watchlist-empty">No watched-artist albums are waiting for review right now.</div>';
                    } else {
                        const candidatesByArtist = candidates.reduce((map, candidate) => {
                            const key = String(candidate.artistId);
                            if (!map.has(key)) {
                                map.set(key, []);
                            }
                            map.get(key).push(candidate);
                            return map;
                        }, new Map());

                        const artistPanels = watchedArtists
                            .filter((artist) => candidatesByArtist.has(String(artist.id)))
                            .map((artist) => {
                                const artistCandidates = candidatesByArtist.get(String(artist.id)) || [];
                                const newestYear = Math.max(...artistCandidates.map((candidate) => Number(candidate.year) || 0));
                                return `
                                    <article class="watchlist-review-card">
                                        <div class="watchlist-review-card-main">
                                            <div class="watchlist-review-card-cover">
                                                ${artist.image
                                                    ? `<img src="${artist.image}" alt="${this.escapeHtml(artist.name)}" loading="lazy">`
                                                    : '<div class="result-cover-placeholder">🎤</div>'}
                                            </div>
                                            <div class="watchlist-review-card-copy">
                                                <strong>${this.escapeHtml(artist.name)}</strong>
                                                <span>${artistCandidates.length} album candidate${artistCandidates.length === 1 ? '' : 's'}</span>
                                                <small>${newestYear ? `Latest release ${this.escapeHtml(String(newestYear))}` : 'Open this artist to review discography'}</small>
                                            </div>
                                        </div>
                                        <div class="watchlist-review-card-actions">
                                            <button class="watchlist-artist-mini-btn" type="button" data-watchlist-open-artist="${this.escapeHtml(String(artist.id))}">Open Review</button>
                                            <button class="watchlist-artist-mini-btn" type="button" data-watchlist-download-discography="${this.escapeHtml(String(artist.id))}">Download All</button>
                                            <button class="watchlist-artist-mini-btn" type="button" data-watchlist-queue-tracks="${this.escapeHtml(String(artist.id))}">Top Tracks</button>
                                        </div>
                                    </article>
                                `;
                            })
                            .join('');

                        candidateList.innerHTML = artistPanels;

                        candidateList.querySelectorAll('[data-watchlist-download-discography]').forEach((button) => {
                            button.addEventListener('click', () => {
                                this.queueWatchedArtistDiscography(button.dataset.watchlistDownloadDiscography, true);
                            });
                        });

                        candidateList.querySelectorAll('[data-watchlist-queue-tracks]').forEach((button) => {
                            button.addEventListener('click', () => {
                                this.queueWatchedArtistTracks(button.dataset.watchlistQueueTracks, false);
                            });
                        });

                        candidateList.querySelectorAll('[data-watchlist-open-artist]').forEach((button) => {
                            button.addEventListener('click', () => {
                                this.openWatchlistArtistModal(button.dataset.watchlistOpenArtist);
                            });
                        });
                    }
                }

                if (playlistCandidateList) {
                    if (!playlistCandidates.length) {
                        playlistCandidateList.innerHTML = '<div class="watchlist-empty">No watched-playlist tracks are waiting for review right now.</div>';
                    } else {
                        const candidatesByPlaylist = playlistCandidates.reduce((map, candidate) => {
                            const key = String(candidate.playlistId);
                            if (!map.has(key)) map.set(key, []);
                            map.get(key).push(candidate);
                            return map;
                        }, new Map());

                        playlistCandidateList.innerHTML = watchedPlaylists
                            .filter((playlist) => candidatesByPlaylist.has(String(playlist.id)))
                            .map((playlist) => {
                                const items = candidatesByPlaylist.get(String(playlist.id)) || [];
                                const queueableIds = items.filter((entry) => this.isWatchlistTrackQueueable(entry)).map((entry) => String(entry.id));
                                return `
                                    <article class="watchlist-review-card">
                                        <div class="watchlist-review-card-main">
                                            <div class="watchlist-review-card-cover">
                                                ${playlist.image ? `<img src="${playlist.image}" alt="${this.escapeHtml(playlist.title)}" loading="lazy">` : '<div class="result-cover-placeholder">🎼</div>'}
                                            </div>
                                            <div class="watchlist-review-card-copy">
                                                <strong>${this.escapeHtml(playlist.title)}</strong>
                                                <span>${items.length} track candidate${items.length === 1 ? '' : 's'}</span>
                                                <small>${this.escapeHtml(playlist.owner || 'Qobuz Playlist')}</small>
                                            </div>
                                        </div>
                                        <div class="watchlist-review-card-actions">
                                            <button class="watchlist-artist-mini-btn" type="button" data-watchlist-playlist-id="${this.escapeHtml(String(playlist.id))}" data-watchlist-playlist-queue-bulk="${this.escapeHtml(queueableIds.join(','))}">Queue New</button>
                                            <button class="watchlist-artist-mini-btn" type="button" data-watchlist-playlist-id="${this.escapeHtml(String(playlist.id))}" data-watchlist-playlist-download-bulk="${this.escapeHtml(queueableIds.join(','))}">Download New</button>
                                            <button class="watchlist-artist-mini-btn" type="button" data-watchlist-playlist-id="${this.escapeHtml(String(playlist.id))}" data-watchlist-playlist-dismiss-bulk="${this.escapeHtml(items.map((entry) => String(entry.id)).join(','))}">Mark Reviewed</button>
                                        </div>
                                    </article>
                                `;
                            })
                            .join('');

                        playlistCandidateList.querySelectorAll('[data-watchlist-playlist-queue-bulk]').forEach((button) => {
                            button.addEventListener('click', () => {
                                const playlistId = button.dataset.watchlistPlaylistId;
                                const trackIds = String(button.dataset.watchlistPlaylistQueueBulk || '').split(',').filter(Boolean);
                                this.socket.emit('queueWatchedPlaylistTracks', {playlistId, trackIds});
                            });
                        });
                        playlistCandidateList.querySelectorAll('[data-watchlist-playlist-download-bulk]').forEach((button) => {
                            button.addEventListener('click', () => {
                                const playlistId = button.dataset.watchlistPlaylistId;
                                const trackIds = String(button.dataset.watchlistPlaylistDownloadBulk || '').split(',').filter(Boolean);
                                this.socket.emit('queueWatchedPlaylistTracks', {playlistId, trackIds, autoStart: true});
                            });
                        });
                        playlistCandidateList.querySelectorAll('[data-watchlist-playlist-dismiss-bulk]').forEach((button) => {
                            button.addEventListener('click', () => {
                                const playlistId = button.dataset.watchlistPlaylistId;
                                const trackIds = String(button.dataset.watchlistPlaylistDismissBulk || '').split(',').filter(Boolean);
                                this.socket.emit('markWatchlistTracksProcessed', {playlistId, trackIds, reason: 'dismissed'});
                            });
                        });
                    }
                }

                if (historyList) {
                    if (!history.length) {
                        historyList.innerHTML = '<div class="watchlist-empty">Processed albums and tracks will land here after you review them.</div>';
                    } else {
                        historyList.innerHTML = history
                            .slice(0, 24)
                            .map((item) => `
                                <article class="watchlist-history-item">
                                    <div class="watchlist-history-copy">
                                        <strong>${this.escapeHtml(item.title)}</strong>
                                        <span>${this.escapeHtml(item.artist)}${item.entryType === 'track' && item.album ? ` • ${this.escapeHtml(item.album)}` : ''}</span>
                                    </div>
                                    <div class="watchlist-history-meta">
                                        <span class="watchlist-reason-chip ${this.escapeHtml(item.reason)}">${this.escapeHtml(item.reason.replace(/-/g, ' '))}</span>
                                        <small>${this.escapeHtml(new Date(item.processedAt).toLocaleDateString())}</small>
                                        <small>${this.escapeHtml(item.entryType === 'track' ? 'Track monitor' : 'Artist monitor')}</small>
                                    </div>
                                </article>
                            `)
                            .join('');
                    }
                }

                if (monitorHistoryList) {
                    if (!this.monitorHistory.length) {
                        monitorHistoryList.innerHTML = '<div class="watchlist-empty">Scheduler activity will appear here after the first run.</div>';
                    } else {
                        monitorHistoryList.innerHTML = this.monitorHistory.slice(0, 16).map((item) => `
                            <article class="watchlist-history-item">
                                <div class="watchlist-history-copy">
                                    <strong>${this.escapeHtml(item.message)}</strong>
                                    <span>${this.escapeHtml(item.details || '')}</span>
                                </div>
                                <div class="watchlist-history-meta">
                                    <span class="watchlist-reason-chip ${this.escapeHtml(item.level)}">${this.escapeHtml(item.kind)}</span>
                                    <small>${this.escapeHtml(new Date(item.createdAt).toLocaleString())}</small>
                                </div>
                            </article>
                        `).join('');
                    }
                }

                ['artists', 'playlists'].forEach((kind) => {
                    const schedule = this.monitorSchedules?.[kind];
                    if (!schedule) return;
                    const enabled = document.querySelector(`[data-schedule-enabled="${kind}"]`);
                    const mode = document.querySelector(`[data-schedule-mode="${kind}"]`);
                    const days = document.querySelector(`[data-schedule-days="${kind}"]`);
                    const hours = document.querySelector(`[data-schedule-hours="${kind}"]`);
                    const weekdays = document.querySelector(`[data-schedule-weekdays="${kind}"]`);
                    const hour = document.querySelector(`[data-schedule-hour="${kind}"]`);
                    const minute = document.querySelector(`[data-schedule-minute="${kind}"]`);
                    const nextRun = document.getElementById(`schedule-${kind}-next-run`);
                    if (enabled) enabled.checked = Boolean(schedule.enabled);
                    if (mode) mode.value = schedule.mode || 'interval-days';
                    if (days) days.value = schedule.intervalDays || 1;
                    if (hours) hours.value = schedule.intervalHours || 12;
                    if (hour) hour.value = schedule.hour ?? 8;
                    if (minute) minute.value = schedule.minute ?? 0;
                    if (nextRun) {
                        nextRun.textContent = schedule.nextRunAt
                            ? `Next run: ${new Date(schedule.nextRunAt).toLocaleString()}`
                            : 'Next run: not scheduled';
                    }
                    this.renderSchedulePicker(kind, schedule);
                });

                if (this.currentWatchlistArtistId) {
                    this.renderWatchlistArtistModal();
                }

                this.setWatchlistView(this.watchlistView);
            }

            getSelectedWatchlistAlbumIds() {
                return Array.from(this.watchlistCandidatesSelection);
            }

            queueSelectedWatchlistAlbums() {
                const selected = this.getSelectedWatchlistAlbumIds();
                if (!selected.length) {
                    this.showNotification('Select at least one watchlist album first', 'info');
                    return;
                }
                this.socket.emit('queueWatchedArtistReleases', {albumIds: selected});
                this.watchlistCandidatesSelection.clear();
            }

            downloadSelectedWatchlistAlbums() {
                const selected = this.getSelectedWatchlistAlbumIds();
                if (!selected.length) {
                    this.showNotification('Select at least one watchlist album first', 'info');
                    return;
                }
                this.socket.emit('queueWatchedArtistReleases', {albumIds: selected, autoStart: true});
                this.watchlistCandidatesSelection.clear();
            }

            markSelectedWatchlistAlbumsReviewed() {
                const selected = this.getSelectedWatchlistAlbumIds();
                if (!selected.length) {
                    this.showNotification('Select at least one watchlist album first', 'info');
                    return;
                }
                this.socket.emit('markWatchlistAlbumsProcessed', {albumIds: selected, reason: 'dismissed'});
                this.watchlistCandidatesSelection.clear();
            }

            saveFavoriteGenresSelection() {
                return;
            }

            renderFavoriteGenreSections() {
                return;
            }

            renderGenresPage() {
                const filterGrid = document.getElementById('genres-filter-grid');
                const genres = Array.isArray(this.availableFavoriteGenres) ? this.availableFavoriteGenres : [];
                if (!filterGrid) return;

                if (!genres.length) {
                    filterGrid.innerHTML = `
                        <div class="watchlist-empty">
                            Qobuz genres are not available yet. Refresh the page once Qobuz search is ready.
                        </div>
                    `;
                    return;
                }

                const genrePalette = [
                    'linear-gradient(135deg, #b87912, #946006)',
                    'linear-gradient(135deg, #b0a55a, #8f8646)',
                    'linear-gradient(135deg, #b69a67, #8d7348)',
                    'linear-gradient(135deg, #7e43af, #62308a)',
                    'linear-gradient(135deg, #a53643, #812731)',
                    'linear-gradient(135deg, #2e6896, #244f75)',
                    'linear-gradient(135deg, #4e46a8, #3b3683)',
                    'linear-gradient(135deg, #7d9424, #627418)',
                    'linear-gradient(135deg, #55504f, #383433)',
                    'linear-gradient(135deg, #5f83aa, #43698f)',
                    'linear-gradient(135deg, #af6324, #8d4d18)',
                    'linear-gradient(135deg, #575757, #3f3f3f)',
                    'linear-gradient(135deg, #4f9da1, #36797c)',
                    'linear-gradient(135deg, #ba3e30, #962e23)',
                ];

                filterGrid.innerHTML = genres
                    .map((genre, index) => `
                        <button
                            class="genre-filter-card ${String(this.activeGenrePageId) === String(genre.id) ? 'active' : ''}"
                            type="button"
                            data-genre-page-id="${this.escapeHtml(String(genre.id))}"
                            style="--genre-card-bg:${genrePalette[index % genrePalette.length]};"
                        >
                            <span class="genre-filter-card-check" aria-hidden="true"></span>
                            <span class="genre-filter-card-label">${this.escapeHtml(genre.label)}</span>
                        </button>
                    `)
                    .join('');

                filterGrid.querySelectorAll('[data-genre-page-id]').forEach((button) => {
                    button.addEventListener('click', () => {
                        this.selectGenrePage(button.dataset.genrePageId);
                    });
                });

                if (!this.activeGenrePageId || !genres.some((genre) => String(genre.id) === String(this.activeGenrePageId))) {
                    this.selectGenrePage(genres[0].id);
                }
            }

            selectGenrePage(genreId) {
                const normalizedId = String(genreId || '');
                if (!normalizedId) return;
                this.activeGenrePageId = normalizedId;
                this.genrePageState[normalizedId] = {
                    items: [],
                    offset: 0,
                    limit: 24,
                    hasMore: true,
                    loading: false,
                };

                const filterGrid = document.getElementById('genres-filter-grid');
                filterGrid?.querySelectorAll('[data-genre-page-id]').forEach((button) => {
                    button.classList.toggle('active', String(button.dataset.genrePageId) === normalizedId);
                });

                const genre = (this.availableFavoriteGenres || []).find((entry) => String(entry.id) === normalizedId);
                const title = document.getElementById('genres-results-title');
                const resultsGrid = document.getElementById('genres-results-grid');

                if (title) {
                    title.innerHTML = `<span class="section-icon">♪</span>${this.escapeHtml(genre?.label || 'Genre')} Albums`;
                }

                if (resultsGrid) {
                    resultsGrid.innerHTML = `
                        <div class="loading-placeholder">
                            <div class="loading-spinner"></div>
                            <p>Loading ${this.escapeHtml((genre?.label || 'genre').toLowerCase())} albums...</p>
                        </div>
                    `;
                }

                this.updateGenreLoadMoreButton();
                this.requestGenrePage(false);
            }

            displayGenreDiscoveryContent(data) {
                const genreId = String(data.genreId || '');
                if (!genreId) return;

                const items = Array.isArray(data.items) ? data.items : [];
                const pageGrid = document.getElementById('genres-results-grid');
                if (pageGrid && String(this.activeGenrePageId) === genreId) {
                    const state = this.genrePageState[genreId] || {
                        items: [],
                        offset: 0,
                        limit: Number(data.limit) || 24,
                        hasMore: true,
                        loading: false,
                    };
                    const append = Number(data.offset || 0) > 0;
                    state.loading = false;
                    state.limit = Number(data.limit) || state.limit || 24;
                    state.offset = Number(data.offset || 0) + items.length;
                    state.hasMore = Boolean(data.hasMore);
                    state.items = append ? [...(state.items || []), ...items] : items.slice();
                    this.genrePageState[genreId] = state;

                    pageGrid.innerHTML = '';

                    if (!state.items.length) {
                        pageGrid.innerHTML = `
                            <div class="watchlist-empty">
                                No ${this.escapeHtml(data.title || 'genre')} albums surfaced yet.
                            </div>
                        `;
                    } else {
                        state.items.forEach((item) => {
                            const cacheKey = this.getDiscoveryCacheKey('qobuz', item.type, item.id);
                            this.discoveryCache.set(cacheKey, {...item, service: 'qobuz'});
                            const card = this.createDiscoveryCard(item, 'qobuz');
                            pageGrid.appendChild(card);
                        });
                    }

                    this.updateGenreLoadMoreButton();
                }
            }

            updateGenreLoadMoreButton() {
                const loadMoreBtn = document.getElementById('genres-load-more');
                if (!loadMoreBtn) return;
                const state = this.activeGenrePageId ? this.genrePageState[this.activeGenrePageId] : null;
                const shouldShow = Boolean(state && state.hasMore && !state.loading);
                loadMoreBtn.style.display = shouldShow ? 'inline-flex' : 'none';
                loadMoreBtn.disabled = Boolean(state?.loading);
                loadMoreBtn.textContent = state?.loading ? 'Loading...' : 'Load More';
            }

            openRecentDownload(payload) {
                if (!payload) return;

                const result =
                    this.recentDownloads.find(
                        (item) =>
                            String(item.id) === String(payload.id) &&
                            String(item.type) === String(payload.type) &&
                            String(item.service) === String(payload.service),
                    ) || payload;

                if (result.service && result.service !== this.currentService) {
                    this.switchService(result.service);
                }

                if (result.type === 'album') {
                    this.showAlbumModal(result);
                    return;
                }

                if (result.type === 'playlist') {
                    this.showPlaylistModal(result);
                    return;
                }

                if (result.type === 'artist') {
                    this.showArtistDetail(result);
                    return;
                }

                this.navigateToPage('downloads');
            }

            getQueueMetrics() {
                const total = this.downloadQueue.length;
                const queued = this.downloadQueue.filter((item) => item.status === 'queued').length;
                const active = this.downloadQueue.filter((item) => item.status === 'downloading').length;
                const completed = this.downloadQueue.filter((item) => item.status === 'completed').length;
                const failed = this.downloadQueue.filter((item) => item.status === 'error').length;

                return {total, queued, active, completed, failed};
            }

            renderSessionDeck() {
                const metrics = this.getQueueMetrics();
                const serviceLabel = this.currentService.charAt(0).toUpperCase() + this.currentService.slice(1);
                const qualityValue = this.qualitySettings[this.currentService] || this.currentQuality || 'auto';
                const playlistCount = Array.isArray(this.playlists) ? this.playlists.length : 0;
                let pulse = 'Ready for a new route.';

                if (this.isDownloading || metrics.active > 0) {
                    pulse = `${metrics.active || 1} active download${metrics.active === 1 ? '' : 's'} moving through the queue.`;
                } else if (metrics.failed > 0) {
                    pulse = `${metrics.failed} queue item${metrics.failed === 1 ? '' : 's'} need another pass.`;
                } else if (metrics.queued > 0) {
                    pulse = `${metrics.queued} queued item${metrics.queued === 1 ? '' : 's'} ready to launch.`;
                } else if (metrics.completed > 0) {
                    pulse = `${metrics.completed} item${metrics.completed === 1 ? '' : 's'} completed in this session.`;
                }

                const valueMap = {
                    'snapshot-service': serviceLabel,
                    'snapshot-quality': String(qualityValue).toUpperCase(),
                    'snapshot-queue': `${metrics.total} item${metrics.total === 1 ? '' : 's'}`,
                    'snapshot-playlists': `${playlistCount} saved`,
                    'home-session-service': serviceLabel,
                    'home-session-quality': String(qualityValue).toUpperCase(),
                    'home-session-queue': `${metrics.total} item${metrics.total === 1 ? '' : 's'}`,
                    'home-session-playlists': `${playlistCount} saved`,
                    'mobile-home-service': serviceLabel,
                    'mobile-home-quality': String(qualityValue).toUpperCase(),
                    'mobile-home-queue': `${metrics.total} item${metrics.total === 1 ? '' : 's'}`,
                    'mobile-home-playlists': `${playlistCount} saved`,
                    'search-session-pulse': pulse,
                    'home-session-pulse': pulse,
                    'mobile-home-pulse': pulse,
                };

                Object.entries(valueMap).forEach(([id, value]) => {
                    const element = document.getElementById(id);
                    if (element) element.textContent = value;
                });
            }

            debug(...args) {
                if (this.debugEnabled) {
                    console.log(...args);
                }
            }

            debugWarn(...args) {
                if (this.debugEnabled) {
                    console.warn(...args);
                }
            }

            debugError(...args) {
                if (this.debugEnabled) {
                    console.error(...args);
                }
            }

            getQueueIdentity(item) {
                const service = item?.service || this.currentService || 'deezer';
                const type = item?.type || 'track';
                const id = item?.id ?? item?.SNG_ID;
                return `${service}:${type}:${String(id)}`;
            }

            queueItemsMatch(left, right) {
                return this.getQueueIdentity(left) === this.getQueueIdentity(right);
            }

            findQueueItem(candidate) {
                return this.downloadQueue.find((item) => this.queueItemsMatch(item, candidate));
            }

            createQueueItem(result, status = 'queued', overrides = {}) {
                return {
                    ...result,
                    status,
                    startTime: status === 'downloading' ? new Date() : null,
                    endTime: null,
                    addedAt: new Date(),
                    service: result.service || this.currentService,
                    ...overrides,
                };
            }

            upsertQueueItem(result, status = 'queued', overrides = {}) {
                const existingItem = this.findQueueItem(result);
                const queueItem = this.createQueueItem(result, status, overrides);

                if (existingItem) {
                    Object.assign(existingItem, queueItem);
                    return {item: existingItem, added: false};
                }

                this.downloadQueue.push(queueItem);
                return {item: queueItem, added: true};
            }

            getQueuedItemsForStart() {
                const seen = new Set();
                return this.downloadQueue.filter((item) => {
                    if (item.status !== 'queued') {
                        return false;
                    }

                    const identity = this.getQueueIdentity(item);
                    if (seen.has(identity)) {
                        return false;
                    }

                    seen.add(identity);
                    return true;
                });
            }

            syncMiniRailVisibility() {
                const appContainer = document.querySelector('.app-container');
                if (!appContainer) return;

                const sidebarHidden = appContainer.classList.contains('sidebar-hidden');
                document.body.classList.toggle('mini-rail-visible', sidebarHidden);
            }

            updateMiniRailActiveState(page = this.currentPage) {
                document.querySelectorAll('#mini-rail .mini-rail-btn').forEach((button) => {
                    button.classList.toggle('active', button.dataset.target === page);
                });
            }

            initMiniRail() {
                const rail = document.getElementById('mini-rail');
                if (!rail || rail.dataset.bound === 'true') {
                    this.syncMiniRailVisibility();
                    this.updateMiniRailActiveState();
                    return;
                }

                rail.dataset.bound = 'true';
                rail.addEventListener('click', (event) => {
                    const button = event.target.closest('.mini-rail-btn');
                    if (!button) return;

                    const target = button.dataset.target;
                    if (!target) return;

                    this.navigateToPage(target);
                });

                this.syncMiniRailVisibility();
                this.updateMiniRailActiveState();
            }

            renderQueueInsights() {
                const metrics = this.getQueueMetrics();
                const statMap = {
                    'queue-stat-total': metrics.total,
                    'queue-stat-active': metrics.active,
                    'queue-stat-done': metrics.completed,
                    'queue-stat-failed': metrics.failed,
                };

                Object.entries(statMap).forEach(([id, value]) => {
                    const element = document.getElementById(id);
                    if (element) element.textContent = String(value);
                });

                const toolbarCopy = document.getElementById('queue-toolbar-copy');
                if (toolbarCopy) {
                    if (metrics.active > 0) {
                        toolbarCopy.textContent = `${metrics.active} active item${metrics.active === 1 ? '' : 's'} in flight. ${metrics.completed} completed, ${metrics.failed} failed.`;
                    } else if (metrics.failed > 0) {
                        toolbarCopy.textContent = `${metrics.failed} item${metrics.failed === 1 ? '' : 's'} failed. Retry or remove them before the next run.`;
                    } else if (metrics.queued > 0) {
                        toolbarCopy.textContent = `${metrics.queued} queued item${metrics.queued === 1 ? '' : 's'} ready to start. Use Resume Queued to continue this batch.`;
                    } else if (metrics.completed > 0) {
                        toolbarCopy.textContent = `${metrics.completed} completed item${metrics.completed === 1 ? '' : 's'} still in history. Clear them when you are done reviewing.`;
                    } else {
                        toolbarCopy.textContent = 'Queue is idle. Add music from Search, Home, or URL Download.';
                    }
                }

                const retryBtn = document.getElementById('retry-failed-btn');
                const removeCompletedBtn = document.getElementById('remove-completed-btn');
                const removeFailedBtn = document.getElementById('remove-failed-btn');

                if (retryBtn) retryBtn.disabled = metrics.failed === 0 || this.isDownloading;
                if (removeCompletedBtn) removeCompletedBtn.disabled = metrics.completed === 0;
                if (removeFailedBtn) removeFailedBtn.disabled = metrics.failed === 0;
            }

            runRecentSearch(query) {
                const value = String(query || '').trim();
                if (!value) return;

                const searchInput = document.getElementById('search-input');
                if (searchInput) searchInput.value = value;

                this.navigateToPage('search');
                this.performSearch();
            }

            runQuickRoute(route) {
                switch (route) {
                    case 'home-new-releases':
                        this.navigateToPage('home');
                        this.searchNewReleases();
                        break;
                    case 'home-top-artists':
                        this.navigateToPage('home');
                        this.searchTopArtists();
                        break;
                    case 'downloads':
                    case 'search':
                    case 'url-download':
                    case 'settings':
                        this.navigateToPage(route);
                        if (route === 'search') {
                            document.getElementById('search-input')?.focus();
                        }
                        if (route === 'url-download') {
                            document.getElementById('url-input')?.focus();
                        }
                        break;
                    default:
                        break;
                }
            }

            retryFailedDownloads() {
                if (this.isDownloading) return;

                let retried = 0;
                this.downloadQueue.forEach((item) => {
                    if (item.status === 'error') {
                        item.status = 'queued';
                        item.errorMessage = '';
                        item.endTime = null;
                        retried += 1;
                    }
                });

                if (retried > 0) {
                    this.updateQueueUI();
                    this.showNotification(`Queued ${retried} failed item${retried === 1 ? '' : 's'} for retry`, 'success');
                } else {
                    this.showNotification('No failed items to retry', 'info');
                }
            }

            removeCompletedDownloads() {
                const completed = this.downloadQueue.filter((item) => item.status === 'completed').length;
                if (!completed) {
                    this.showNotification('No completed items to remove', 'info');
                    return;
                }

                this.downloadQueue = this.downloadQueue.filter((item) => item.status !== 'completed');
                this.updateQueueUI();
                this.showNotification(`Removed ${completed} completed item${completed === 1 ? '' : 's'}`, 'success');
            }

            removeFailedDownloads() {
                const failed = this.downloadQueue.filter((item) => item.status === 'error').length;
                if (!failed) {
                    this.showNotification('No failed items to remove', 'info');
                    return;
                }

                this.downloadQueue = this.downloadQueue.filter((item) => item.status !== 'error');
                this.updateQueueUI();
                this.showNotification(`Removed ${failed} failed item${failed === 1 ? '' : 's'}`, 'success');
            }

            // --- Simple audio player ---
            initAudio() {
                const bar = document.getElementById('player-bar');
                const cover = document.getElementById('player-cover');
                const title = document.getElementById('player-title');
                const artist = document.getElementById('player-artist');
                const btn = document.getElementById('player-toggle');
                const prevBtn = document.getElementById('player-prev');
                const nextBtn = document.getElementById('player-next');
                // Inject SVG icons
                if (prevBtn) prevBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h2v14H7V5zm2 7l9 7V5l-9 7z"></path></svg>';
                if (nextBtn) nextBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5h2v14h-2V5zm-2 7L4 19V5l9 7z"></path></svg>';
                if (btn) btn.innerHTML = '<svg class="icon icon-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg><svg class="icon icon-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"></path></svg>';
                const seek = document.getElementById('player-seek');
                const cur = document.getElementById('player-current');
                const dur = document.getElementById('player-duration');
                const vol = document.getElementById('player-volume');

                const fmt = (s) => {
                    s = Math.max(0, Math.floor(s));
                    const m = Math.floor(s / 60);
                    const ss = s % 60;
                    return `${m}:${ss < 10 ? '0'+ss : ss}`;
                };

                const updateMeta = () => {
                    if (this.nowPlayingIndex >= 0 && this.playQueue[this.nowPlayingIndex]) {
                        const it = this.playQueue[this.nowPlayingIndex];
                        bar.classList.add('show');
                        document.body.classList.add('player-visible');
                        title.textContent = it.title || 'Unknown Title';
                        artist.textContent = it.artist || '';
                        const img = this.getCoverArtUrl(it) || '';
                        cover.innerHTML = img ? `<img src="${img}" alt="">` : '<svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor" stroke="none"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" opacity="0.7"/><circle cx="10" cy="19" r="2" opacity="0.9"/></svg>';
                        if (btn) btn.classList.toggle('is-playing', !this.audio.paused);
                    } else {
                        bar.classList.remove('show');
                        document.body.classList.remove('player-visible');
                    }
                };

                this.audio.addEventListener('timeupdate', () => {
                    if (!isFinite(this.audio.duration)) return;
                    if (!this._barSeeking && seek) {
                        seek.value = String((this.audio.currentTime / this.audio.duration) * 100 || 0);
                    }
                    cur.textContent = fmt(this.audio.currentTime);
                    dur.textContent = fmt(this.audio.duration || 0);
                    // Persist last played position and track id/service
                    try {
                        const curItem = (this.playQueue || [])[this.nowPlayingIndex];
                        if (curItem) {
                            localStorage.setItem('player.lastTime', String(Math.floor(this.audio.currentTime)));
                            localStorage.setItem('player.lastId', String(curItem.id));
                            localStorage.setItem('player.lastService', String(curItem.service || this.currentService || 'deezer'));
                        }
                    } catch {}
                });
                this.audio.addEventListener('ended', () => this._handleEnded());
                this.audio.addEventListener('play', updateMeta);
                this.audio.addEventListener('pause', updateMeta);
                // Loading indicators
                this.audio.addEventListener('loadstart', () => this.setLoadingUI(true));
                this.audio.addEventListener('waiting', () => this.setLoadingUI(true));
                this.audio.addEventListener('loadedmetadata', () => {
                    // Apply any pending seek set before metadata was ready
                    try {
                        if (typeof this._pendingSeekRatio === 'number' && isFinite(this.audio.duration)) {
                            this.audio.currentTime = Math.max(0, Math.min(1, this._pendingSeekRatio)) * this.audio.duration;
                            this._pendingSeekRatio = undefined;
                        }
                    } catch {}
                    this.setLoadingUI(false);
                });
                this.audio.addEventListener('canplay', () => this.setLoadingUI(false));
                this.audio.addEventListener('playing', () => this.setLoadingUI(false));
                this.audio.addEventListener('error', () => this.setLoadingUI(false));

                btn.addEventListener('click', () => {
                    if (!this.audio.src) {
                        if (this.nowPlayingIndex === -1 && (this.playQueue?.length||0) > 0) this.nowPlayingIndex = 0;
                        if (this.nowPlayingIndex >= 0) { this._loadAndPlayCurrent(); updateMeta(); return; }
                    }
                    if (this.audio.paused) this.audio.play(); else this.audio.pause();
                    updateMeta();
                });
                prevBtn.addEventListener('click', () => this.playPrev());
                nextBtn.addEventListener('click', () => this.playNext());
                const applySeekRatioBar = (ratio) => {
                    ratio = Math.max(0, Math.min(1, Number(ratio)));
                    if (isFinite(this.audio.duration)) {
                        const t = ratio * this.audio.duration;
                        try { if (typeof this.audio.fastSeek === 'function') this.audio.fastSeek(t); else this.audio.currentTime = t; } catch { this.audio.currentTime = t; }
                    } else this._pendingSeekRatio = ratio;
                };
                this._barSeeking = false;
                if (seek) {
                    seek.addEventListener('pointerdown', (e) => { this._barSeeking = true; seek.setPointerCapture && seek.setPointerCapture(e.pointerId); });
                    seek.addEventListener('pointermove', (e) => {
                        if (!this._barSeeking) return;
                        const rect = seek.getBoundingClientRect();
                        const ratio = (e.clientX - rect.left) / rect.width;
                        seek.value = String(Math.max(0, Math.min(1, ratio)) * 100);
                        applySeekRatioBar(Number(seek.value)/100);
                    });
                    window.addEventListener('pointerup', () => { this._barSeeking = false; }, { passive: true });
                    // Touch fallback
                    seek.addEventListener('touchstart', () => { this._barSeeking = true; }, { passive: true });
                    seek.addEventListener('touchmove', (e) => {
                        if (!this._barSeeking) return;
                        const t = e.touches && e.touches[0]; if (!t) return;
                        const rect = seek.getBoundingClientRect();
                        const ratio = (t.clientX - rect.left) / rect.width;
                        seek.value = String(Math.max(0, Math.min(1, ratio)) * 100);
                        applySeekRatioBar(Number(seek.value)/100);
                    }, { passive: true });
                    window.addEventListener('touchend', () => { this._barSeeking = false; }, { passive: true });
                }
                seek.addEventListener('input', () => applySeekRatioBar(Number(seek.value)/100));
                seek.addEventListener('change', () => applySeekRatioBar(Number(seek.value)/100));
                seek.addEventListener('mousedown', (e) => {
                    const rect = seek.getBoundingClientRect();
                    const ratio = (e.clientX - rect.left) / rect.width;
                    seek.value = String(Math.max(0, Math.min(1, ratio)) * 100);
                    applySeekRatioBar(Number(seek.value)/100);
                });
                seek.addEventListener('click', (e) => {
                    const rect = seek.getBoundingClientRect();
                    const ratio = (e.clientX - rect.left) / rect.width;
                    seek.value = String(Math.max(0, Math.min(1, ratio)) * 100);
                    applySeekRatioBar(Number(seek.value)/100);
                });
                vol.addEventListener('input', () => {
                    this.audio.volume = Number(vol.value);
                    localStorage.setItem('player.volume', String(this.audio.volume));
                });
                const volSaved = Number(localStorage.getItem('player.volume') || '1');
                if (!Number.isNaN(volSaved)) { this.audio.volume = volSaved; vol.value = String(volSaved); }
                updateMeta();
                // Open fullscreen by clicking cover
                cover.addEventListener('click', () => this.showFullPlayer());
            }

            setLoadingUI(flag) {
                try {
                    const r1 = document.getElementById('player-seek');
                    const r2 = document.getElementById('pf-seek');
                    [r1, r2].forEach(el => { if (!el) return; el.classList.toggle('loading', !!flag); /* keep interactive while loading */ });
                } catch {}
            }

            initFullPlayer() {
                const overlay = document.getElementById('player-fs-overlay');
                const closeBtn = document.getElementById('pf-close');
                const toggle = document.getElementById('pf-toggle');
                const prev = document.getElementById('pf-prev');
                const next = document.getElementById('pf-next');
                const seek = document.getElementById('pf-seek');
                const clear = document.getElementById('pf-clear');
                let repeatBtn = document.getElementById('pf-repeat');
                let shuffleBtn = document.getElementById('pf-shuffle');
                // Ensure shuffle/repeat live in controls (move or create)
                try {
                    const controls = toggle && toggle.parentElement;
                    if (controls) {
                        if (shuffleBtn) {
                            shuffleBtn.className = 'pf-btn pf-btn--icon pf-btn--toggle';
                            try { controls.insertBefore(shuffleBtn, prev); } catch {}
                        } else {
                            shuffleBtn = document.createElement('button');
                            shuffleBtn.id = 'pf-shuffle';
                            shuffleBtn.className = 'pf-btn pf-btn--icon pf-btn--toggle';
                            shuffleBtn.title = 'Shuffle';
                            controls.insertBefore(shuffleBtn, prev);
                        }
                        if (repeatBtn) {
                            repeatBtn.className = 'pf-btn pf-btn--icon pf-btn--toggle';
                            try { controls.appendChild(repeatBtn); } catch {}
                        } else {
                            repeatBtn = document.createElement('button');
                            repeatBtn.id = 'pf-repeat';
                            repeatBtn.className = 'pf-btn pf-btn--icon pf-btn--toggle';
                            repeatBtn.title = 'Repeat';
                            controls.appendChild(repeatBtn);
                        }
                    }
                } catch {}
                // Inject SVG icons
                if (prev) prev.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h2v14H7V5zm2 7l9 7V5l-9 7z"></path></svg>';
                if (next) next.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5h2v14h-2V5zm-2 7L4 19V5l9 7z"></path></svg>';
                if (toggle) toggle.innerHTML = '<svg class="icon icon-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg><svg class="icon icon-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"></path></svg>';
                if (shuffleBtn) shuffleBtn.innerHTML = '<svg class="icon" xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision" text-rendering="geometricPrecision" image-rendering="optimizeQuality" fill-rule="evenodd" clip-rule="evenodd" viewBox="0 0 512 428.035"><path fill-rule="nonzero" d="M437.061 421.009c-10.806 9.948-27.635 9.246-37.582-1.56-9.948-10.806-9.247-27.634 1.56-37.582l19.187-17.605c-16.168 0-32.198-.512-47.685-2.443-103.625-12.938-127.493-77.061-151.173-140.689-15.442-41.493-30.792-82.725-76.612-97.654-24.658-8.032-54.868-7.434-87.955-6.779-12.263.243-24.854.492-30.151.492-14.716 0-26.65-11.933-26.65-26.65C0 75.82 11.934 63.886 26.65 63.886c14.902 0 22.074-.145 29.109-.282 37.931-.75 72.559-1.437 105.448 9.275 70.151 22.857 89.976 76.12 109.925 129.723 18.053 48.506 36.247 97.389 107.862 106.331 12.77 1.593 25.97 2.114 39.31 2.191l-18.221-18.19c-10.407-10.347-10.451-27.176-.106-37.583 10.347-10.404 27.176-10.45 37.583-.103l65.846 65.734a26.33 26.33 0 011.569 1.566c9.945 10.806 9.246 27.637-1.56 37.583l-66.354 60.878zm-36.022-374.84c-10.807-9.948-11.508-26.777-1.56-37.583 9.947-10.806 26.776-11.508 37.582-1.56l66.354 60.879c10.806 9.945 11.505 26.776 1.56 37.582a26.961 26.961 0 01-1.569 1.567l-65.844 65.736c-10.405 10.347-27.233 10.303-37.58-.104-10.347-10.407-10.304-27.235.103-37.582l18.221-18.193c-13.339.078-26.542.599-39.312 2.192-46.666 5.825-70.646 28.614-86.687 57.206-.223-.982-.456-1.961-.702-2.941-5.201-20.805-14.756-38.909-26.959-53.014 21.94-26.993 54.21-47.436 107.895-54.137 15.487-1.931 31.517-2.443 47.685-2.443l-19.187-17.605zM230.46 307.898c-15.831 20.16-37.331 36.858-69.253 47.259-32.889 10.711-67.517 10.025-105.448 9.274-7.035-.136-14.207-.282-29.109-.282-14.716 0-26.65-11.934-26.65-26.653 0-14.716 11.934-26.65 26.65-26.65 5.297 0 17.888.249 30.151.492 33.087.655 63.297 1.253 87.955-6.779 28.777-9.376 45.533-29.128 57.844-52.8l.21.872c5.391 21.564 15.162 40.405 27.65 55.267z"/></svg>';
                if (repeatBtn) repeatBtn.innerHTML = '<svg class="icon" xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision" text-rendering="geometricPrecision" image-rendering="optimizeQuality" fill-rule="evenodd" clip-rule="evenodd" viewBox="0 0 426 512.288"><path fill-rule="nonzero" d="M52.707 232.055c0 14.554-11.799 26.353-26.354 26.353C11.799 258.408 0 246.609 0 232.055v-37.736c0-35.539 14.521-67.83 37.915-91.222 23.393-23.394 55.684-37.915 91.222-37.915h206.748L314.6 45.652c-10.688-9.834-11.379-26.473-1.545-37.161 9.834-10.688 26.473-11.378 37.161-1.545l67.239 61.692c10.687 9.834 11.378 26.473 1.544 37.161a26.017 26.017 0 01-1.558 1.558l-66.734 66.622c-10.29 10.232-26.929 10.187-37.161-.102-10.232-10.289-10.187-26.929.102-37.16l18.859-18.829h-203.37c-20.993 0-40.097 8.607-53.959 22.471-13.864 13.862-22.471 32.967-22.471 53.96v37.736zM111.4 466.636c10.688 9.834 11.379 26.473 1.545 37.161-9.834 10.688-26.473 11.378-37.161 1.545L8.545 443.649c-10.687-9.833-11.378-26.472-1.544-37.161a26.622 26.622 0 011.558-1.558l66.734-66.621c10.29-10.232 26.929-10.187 37.161.102 10.232 10.289 10.187 26.929-.102 37.16L93.493 394.4h203.37c20.993 0 40.097-8.607 53.959-22.471 13.864-13.862 22.471-32.967 22.471-53.96v-37.736c0-14.554 11.799-26.353 26.354-26.353 14.554 0 26.353 11.799 26.353 26.353v37.736c0 35.539-14.521 67.83-37.915 91.222-23.393 23.394-55.684 37.915-91.222 37.915H90.115l21.285 19.53z"/></svg>';

                closeBtn.addEventListener('click', () => this.hideFullPlayer());
                
                // Floating close button
                const floatingCloseBtn = document.getElementById('pf-floating-close');
                if (floatingCloseBtn) {
                    floatingCloseBtn.addEventListener('click', () => this.hideFullPlayer());
                }
                
                overlay.addEventListener('click', (e) => { if (e.target === overlay) this.hideFullPlayer(); });
                toggle.addEventListener('click', () => {
                    if (!this.audio.src) {
                        if (this.nowPlayingIndex === -1 && (this.playQueue?.length||0) > 0) this.nowPlayingIndex = 0;
                        if (this.nowPlayingIndex >= 0) { this._loadAndPlayCurrent(); this.refreshFullPlayerMeta(); return; }
                    }
                    if (this.audio.paused) this.audio.play(); else this.audio.pause();
                    this.refreshFullPlayerMeta();
                });
                prev.addEventListener('click', () => this.playPrev());
                next.addEventListener('click', () => this.playNext());
                const applySeekRatioFs = (ratio) => {
                    ratio = Math.max(0, Math.min(1, Number(ratio)));
                    if (isFinite(this.audio.duration)) {
                        const t = ratio * this.audio.duration;
                        try { if (typeof this.audio.fastSeek === 'function') this.audio.fastSeek(t); else this.audio.currentTime = t; } catch { this.audio.currentTime = t; }
                    } else this._pendingSeekRatio = ratio;
                };
                this._fsSeeking = false;
                if (seek) {
                    seek.addEventListener('pointerdown', (e) => { this._fsSeeking = true; seek.setPointerCapture && seek.setPointerCapture(e.pointerId); });
                    seek.addEventListener('pointermove', (e) => {
                        if (!this._fsSeeking) return;
                        const rect = seek.getBoundingClientRect();
                        const ratio = (e.clientX - rect.left) / rect.width;
                        seek.value = String(Math.max(0, Math.min(1, ratio)) * 100);
                        applySeekRatioFs(Number(seek.value)/100);
                    });
                    window.addEventListener('pointerup', () => { this._fsSeeking = false; }, { passive: true });
                    seek.addEventListener('touchstart', () => { this._fsSeeking = true; }, { passive: true });
                    seek.addEventListener('touchmove', (e) => {
                        if (!this._fsSeeking) return;
                        const t = e.touches && e.touches[0]; if (!t) return;
                        const rect = seek.getBoundingClientRect();
                        const ratio = (t.clientX - rect.left) / rect.width;
                        seek.value = String(Math.max(0, Math.min(1, ratio)) * 100);
                        applySeekRatioFs(Number(seek.value)/100);
                    }, { passive: true });
                    window.addEventListener('touchend', () => { this._fsSeeking = false; }, { passive: true });
                }
                seek.addEventListener('input', () => applySeekRatioFs(Number(seek.value)/100));
                seek.addEventListener('change', () => applySeekRatioFs(Number(seek.value)/100));
                seek.addEventListener('mousedown', (e) => {
                    const rect = seek.getBoundingClientRect();
                    const ratio = (e.clientX - rect.left) / rect.width;
                    seek.value = String(Math.max(0, Math.min(1, ratio)) * 100);
                    applySeekRatioFs(Number(seek.value)/100);
                });
                seek.addEventListener('click', (e) => {
                    const rect = seek.getBoundingClientRect();
                    const ratio = (e.clientX - rect.left) / rect.width;
                    seek.value = String(Math.max(0, Math.min(1, ratio)) * 100);
                    applySeekRatioFs(Number(seek.value)/100);
                });
                clear.addEventListener('click', () => {
                    this.playQueue = [];
                    this.nowPlayingIndex = -1;
                    this.persistQueue();
                    this.renderFullQueue();
                    this.showNotification('Queue cleared', 'success');
                });

                // Download all in queue
                const dlAllBtn = document.getElementById('pf-download-all');
                if (dlAllBtn) dlAllBtn.addEventListener('click', async () => {
                    try {
                        const items = Array.from(this.playQueue || []);
                        let added = 0;
                        for (const t of items) {
                            try {
                                if (this.downloadToClient && (String(t.type||'track').toLowerCase() === 'track')) {
                                    await this.downloadTrackToClient(t);
                                } else {
                                    this.downloadItem(t);
                                }
                                added++;
                            } catch {}
                        }
                        if (added > 0) this.showNotification(`${added} track(s) added to downloads`, 'success');
                    } catch (e) { this.showNotification('Failed to start downloads', 'error'); }
                });

                // Toggle states for repeat/shuffle
                const applyChipState = () => {
                    if (repeatBtn) repeatBtn.classList.toggle('active', !!this.repeat);
                    if (shuffleBtn) shuffleBtn.classList.toggle('active', !!this.shuffle);
                };
                if (repeatBtn) repeatBtn.addEventListener('click', () => { this.repeat = !this.repeat; localStorage.setItem('player.repeat', this.repeat ? '1' : '0'); applyChipState(); });
                if (shuffleBtn) shuffleBtn.addEventListener('click', () => { this.shuffle = !this.shuffle; localStorage.setItem('player.shuffle', this.shuffle ? '1' : '0'); applyChipState(); });
                applyChipState();

                // Fullscreen volume control under seek
                try {
                    const pfVol = document.getElementById('pf-volume');
                    const barVol = document.getElementById('player-volume');
                    if (pfVol) {
                        const savedVol = Number(localStorage.getItem('player.volume') || String(this.audio.volume || 1));
                        if (!Number.isNaN(savedVol)) {
                            this.audio.volume = savedVol;
                            pfVol.value = String(savedVol);
                            if (barVol) barVol.value = String(savedVol);
                        }
                        pfVol.addEventListener('input', () => {
                            const v = Number(pfVol.value);
                            this.audio.volume = v;
                            localStorage.setItem('player.volume', String(v));
                            if (barVol) barVol.value = String(v);
                        });
                        if (barVol) {
                            barVol.addEventListener('input', () => {
                                pfVol.value = String(barVol.value);
                            });
                        }
                    }
                } catch {}

                // Draggable divider to resize left/right
                try {
                    const container = document.querySelector('.player-fullscreen');
                    const resizer = document.getElementById('pf-resizer');
                    const hideBtn = document.getElementById('pf-hide-queue');
                    const revealBtn = document.getElementById('pf-reveal-queue');
                    if (container && resizer) {
                        const RESIZER_W = 8;
                        const DEFAULT_RATIO = 1.2 / (1.2 + 1); // mirrors CSS 1.2fr 1fr
                        const isMobile = () => window.matchMedia('(max-width: 1024px)').matches;
                        const applySplit = (ratio) => {
                            if (isMobile()) { container.style.removeProperty('grid-template-columns'); return; }
                            const total = container.clientWidth - RESIZER_W;
                            const minLeft = 320; // match CSS minmax(320px,...)
                            const minRight = 280; // match CSS minmax(280px,...)
                            let left = Math.max(minLeft, Math.min(total - minRight, Math.round(total * ratio)));
                            const right = total - left;
                            container.style.gridTemplateColumns = `${left}px ${RESIZER_W}px ${right}px`;
                        };
                        const saved = Number(localStorage.getItem('pf.split') || '');
                        const startRatio = Number.isFinite(saved) && saved > 0 ? Math.max(0.2, Math.min(0.8, saved)) : DEFAULT_RATIO;
                        // Apply once on init
                        applySplit(startRatio);
                        // Apply saved hidden state
                        const hiddenSaved = localStorage.getItem('pf.queueHidden') === '1';
                        if (hiddenSaved) container.classList.add('pf-hide-queue');

                        let dragging = false;
                        let startX = 0;
                        let startLeft = 0;
                        const onMouseMove = (e) => {
                            if (!dragging) return;
                            const rect = container.getBoundingClientRect();
                            const total = rect.width - RESIZER_W;
                            const dx = e.clientX - startX;
                            let left = startLeft + dx;
                            const minLeft = 320;
                            const minRight = 280;
                            left = Math.max(minLeft, Math.min(total - minRight, left));
                            const ratio = left / total;
                            container.style.gridTemplateColumns = `${Math.round(left)}px ${RESIZER_W}px ${Math.round(total - left)}px`;
                            localStorage.setItem('pf.split', String(ratio));
                        };
                        const stopDrag = () => {
                            if (!dragging) return;
                            dragging = false;
                            document.body.style.cursor = '';
                            window.removeEventListener('mousemove', onMouseMove);
                            window.removeEventListener('mouseup', stopDrag);
                        };
                        resizer.addEventListener('mousedown', (e) => {
                            if (container.classList.contains('pf-hide-queue')) return;
                            if (isMobile()) return; // ignore on mobile
                            const styles = getComputedStyle(container);
                            // Compute current left width from grid columns
                            const cols = styles.gridTemplateColumns.split(' ');
                            // Expect: [left, resizer, right]
                            const leftPx = parseFloat(cols[0]);
                            const rect = container.getBoundingClientRect();
                            const total = rect.width - RESIZER_W;
                            startLeft = Number.isFinite(leftPx) ? leftPx : total * startRatio;
                            dragging = true;
                            startX = e.clientX;
                            document.body.style.cursor = 'col-resize';
                            window.addEventListener('mousemove', onMouseMove);
                            window.addEventListener('mouseup', stopDrag);
                            e.preventDefault();
                        });
                        // Keyboard nudge + double-click to reset split
                        resizer.addEventListener('keydown', (e) => {
                            if (container.classList.contains('pf-hide-queue')) return;
                            const savedR = Number(localStorage.getItem('pf.split') || String(startRatio));
                            let r = Number.isFinite(savedR) ? savedR : startRatio;
                            const step = 0.02;
                            if (e.key === 'ArrowLeft') { r = Math.max(0.2, r - step); applySplit(r); localStorage.setItem('pf.split', String(r)); e.preventDefault(); }
                            if (e.key === 'ArrowRight') { r = Math.min(0.8, r + step); applySplit(r); localStorage.setItem('pf.split', String(r)); e.preventDefault(); }
                        });
                        resizer.addEventListener('dblclick', () => {
                            localStorage.removeItem('pf.split');
                            applySplit(DEFAULT_RATIO);
                        });
                        // Hide/Show queue controls
                        const setQueueHidden = (hidden) => {
                            container.classList.toggle('pf-hide-queue', !!hidden);
                            localStorage.setItem('pf.queueHidden', hidden ? '1' : '0');
                            if (!hidden) {
                                try { this.renderFullQueue(); } catch {}
                                if (isMobile()) {
                                    requestAnimationFrame(() => {
                                        const queuePanel = document.querySelector('.pf-right');
                                        if (queuePanel && typeof queuePanel.scrollTo === 'function') {
                                            queuePanel.scrollTo({ top: 0, behavior: 'smooth' });
                                        }
                                    });
                                }
                            }
                        };
                        this.setPlayerQueueHidden = setQueueHidden;
                        if (hideBtn) hideBtn.addEventListener('click', () => setQueueHidden(true));
                        if (revealBtn) revealBtn.addEventListener('click', () => setQueueHidden(false));
                        if (revealBtn) revealBtn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { setQueueHidden(false); e.preventDefault(); } });
                        // Keep split responsive on resize
                        window.addEventListener('resize', () => {
                            const savedR = Number(localStorage.getItem('pf.split') || DEFAULT_RATIO);
                            applySplit(Number.isFinite(savedR) ? savedR : DEFAULT_RATIO);
                        });
                    }
                } catch {}
            }

            showFullPlayer() {
                const overlay = document.getElementById('player-fs-overlay');
                overlay.classList.add('show');
                document.body.classList.add('fullscreen-player-open');
                if (isMobile() && typeof this.setPlayerQueueHidden === 'function') {
                    this.setPlayerQueueHidden(true);
                }
                // Set header title to Elixium player while overlay visible
                try {
                    const titleEl = document.getElementById('page-title');
                    if (titleEl) {
                        if (!titleEl.getAttribute('data-prev')) titleEl.setAttribute('data-prev', titleEl.textContent || '');
                        titleEl.textContent = 'Elixium player';
                    }
                } catch(_) {}
                this.refreshFullPlayerMeta();
                this.renderFullQueue();
            }

            hideFullPlayer() {
                const overlay = document.getElementById('player-fs-overlay');
                overlay.classList.remove('show');
                document.body.classList.remove('fullscreen-player-open');
                // Restore header title to previous page label
                try {
                    const titleEl = document.getElementById('page-title');
                    if (titleEl && titleEl.hasAttribute('data-prev')) {
                        const prev = titleEl.getAttribute('data-prev');
                        if (prev !== null) titleEl.textContent = prev;
                        titleEl.removeAttribute('data-prev');
                    }
                } catch(_) {}
            }

            refreshFullPlayerMeta() {
                const it = this.playQueue[this.nowPlayingIndex];
                const pfTitle = document.getElementById('pf-title');
                const pfArtist = document.getElementById('pf-artist');
                const pfCover = document.getElementById('pf-cover');
                const pfAlbum = document.getElementById('pf-album');
                const pfQuality = document.getElementById('pf-quality');
                const pfToggle = document.getElementById('pf-toggle');
                if (!it) {
                    pfTitle.textContent = 'Nothing playing';
                    pfArtist.textContent = '';
                    pfCover.innerHTML = '<svg viewBox="0 0 24 24" width="64" height="64" fill="currentColor" stroke="none"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" opacity="0.7"/><path d="M12 15.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4c0-.55-.45-1-1-1h-1V3c0-.55-.45-1-1-1h-4c-.55 0-1 .45-1 1v12.55z" opacity="0.4"/><circle cx="10" cy="19" r="2" opacity="0.9"/></svg>';
                    pfToggle.textContent = '▶';
                    return;
                }
                pfTitle.textContent = it.title || '';
                pfArtist.textContent = it.artist || '';
                try {
                    const pfAlbum = document.getElementById('pf-album');
                    const pfQuality = document.getElementById('pf-quality');
                    if (pfAlbum) pfAlbum.textContent = it.album || '';
                    if (pfQuality) {
                        const svc = (it.service || this.currentService || '').toLowerCase();
                        let txt = '';
                        if (svc === 'deezer') {
                            const q = String(this.qualitySettings.deezer || '320');
                            txt = q.toLowerCase().includes('flac') || q === '1411' ? 'FLAC' : `MP3 ${q} kbps`;
                        } else if (svc === 'qobuz') {
                            const q = String(this.qualitySettings.qobuz || '44khz').toLowerCase();
                            txt = 'FLAC ' + q.replace('khz', 'kHz');
                        }
                        pfQuality.textContent = txt;
                    }
                } catch {}
                const img = this.getCoverArtUrl(it) || '';
                pfCover.innerHTML = img ? `<img src="${img}" alt="">` : '<svg viewBox="0 0 24 24" width="64" height="64" fill="currentColor" stroke="none"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" opacity="0.7"/><path d="M12 15.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4c0-.55-.45-1-1-1h-1V3c0-.55-.45-1-1-1h-4c-.55 0-1 .45-1 1v12.55z" opacity="0.4"/><circle cx="10" cy="19" r="2" opacity="0.9"/></svg>';
                pfToggle.textContent = this.audio.paused ? '▶' : '⏸';
            }

            renderFullQueue() {
                const list = document.getElementById('pf-queue');
                if (!list) { return; }
                list.innerHTML = '';
                if (!(this.playQueue || []).length) {
                    list.innerHTML = `
                        <div class="pf-queue-empty">
                            <strong>Queue is empty</strong>
                            <span>Add tracks from Search, Home, or Playlists.</span>
                        </div>
                    `;
                    return;
                }
                (this.playQueue || []).forEach((it, idx) => {
                    const row = document.createElement('div');
                    row.className = 'pf-queue-item' + (idx === this.nowPlayingIndex ? ' active' : '');
                    row.setAttribute('data-index', String(idx));
                    row.setAttribute('draggable', 'true');
                    const cover = this.getCoverArtUrl(it);
                    row.innerHTML = `
                        <div class=\"pf-queue-drag-handle\">⋮⋮</div>
                        <div class=\"pf-queue-cover\">${cover ? `<img src=\"${cover}\">` : '🎵'}</div>
                        <div class=\"pf-queue-meta\">
                            <div class=\"pf-queue-title\" title=\"${it.title||''}\">${this.truncateText(it.title||'', 48)}</div>
                            <div class=\"pf-queue-artist\" title=\"${it.artist||''}\">${this.truncateText(it.artist||'', 56)}</div>
                        </div>
                        <div class=\"pf-queue-actions\">
                            <button class=\"pf-icon-btn\" data-act=\"up\" data-index=\"${idx}\" title=\"Move up\">
                                <svg viewBox=\"0 0 24 24\" width=\"14\" height=\"14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\">
                                    <path d=\"M18 15L12 9L6 15\"/>
                                </svg>
                            </button>
                            <button class=\"pf-icon-btn\" data-act=\"down\" data-index=\"${idx}\" title=\"Move down\">
                                <svg viewBox=\"0 0 24 24\" width=\"14\" height=\"14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\">
                                    <path d=\"M6 9L12 15L18 9\"/>
                                </svg>
                            </button>
                            <button class=\"pf-icon-btn\" data-act=\"remove\" data-index=\"${idx}\" title=\"Remove from queue\">
                                <svg viewBox=\"0 0 24 24\" width=\"14\" height=\"14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\">
                                    <path d=\"M6 6L18 18M6 18L18 6\"/>
                                </svg>
                            </button>
                        </div>`;

                    // Add per-track Download button programmatically
                    try {
                        const actions = row.querySelector('.pf-queue-actions');
                        if (actions) {
                            const dl = document.createElement('button');
                            dl.className = 'pf-icon-btn';
                            dl.setAttribute('data-act','download');
                            dl.setAttribute('data-index', String(idx));
                            dl.title = 'Download';
                            dl.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>';
                            const before = actions.querySelector('[data-act="remove"]');
                            if (before) actions.insertBefore(dl, before); else actions.appendChild(dl);
                        }
                    } catch {}

                    row.addEventListener('click', (e) => {
                        const tgt = e.target;
                        if (tgt && tgt.closest && tgt.closest('.pf-queue-actions')) return;
                        this.nowPlayingIndex = idx;
                        this.persistQueue();
                        this._loadAndPlayCurrent();
                        this.renderFullQueue();
                        this.refreshFullPlayerMeta();
                        if (isMobile() && typeof this.setPlayerQueueHidden === 'function') {
                            this.setPlayerQueueHidden(true);
                        }
                    });

                    row.querySelectorAll('.pf-icon-btn').forEach(btn => {
                        btn.addEventListener('click', async (ev) => {
                            ev.stopPropagation();
                            const target = ev.currentTarget;
                            const act = target.getAttribute('data-act');
                            const i = Number(target.getAttribute('data-index'));
                            if (act === 'remove') {
                                this.playQueue.splice(i,1);
                                if (this.nowPlayingIndex >= this.playQueue.length) this.nowPlayingIndex = this.playQueue.length-1;
                            } else if (act === 'download') {
                                const it = this.playQueue[i];
                                if (it) {
                                    try {
                                        if (this.downloadToClient && (String(it.type||'track').toLowerCase() === 'track')) {
                                            await this.downloadTrackToClient(it);
                                        } else {
                                            this.downloadItem(it);
                                        }
                                        this.showNotification('Track added to downloads', 'success');
                                    } catch(e) { this.showNotification('Failed to queue download', 'error'); }
                                }
                            } else if (act === 'up' && i > 0) {
                                const tmp = this.playQueue[i-1]; this.playQueue[i-1] = this.playQueue[i]; this.playQueue[i] = tmp;
                                if (this.nowPlayingIndex === i) this.nowPlayingIndex = i-1; else if (this.nowPlayingIndex === i-1) this.nowPlayingIndex = i;
                            } else if (act === 'down' && i < this.playQueue.length-1) {
                                const tmp = this.playQueue[i+1]; this.playQueue[i+1] = this.playQueue[i]; this.playQueue[i] = tmp;
                                if (this.nowPlayingIndex === i) this.nowPlayingIndex = i+1; else if (this.nowPlayingIndex === i+1) this.nowPlayingIndex = i;
                            }
                            this.persistQueue();
                            this.renderFullQueue();
                        });
                    });

                    // Add drag and drop event listeners
                    row.addEventListener('dragstart', (e) => {
                        row.classList.add('pf-dragging');
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', String(idx));
                        // Create drag image
                        const dragImage = row.cloneNode(true);
                        dragImage.style.transform = 'rotate(3deg)';
                        dragImage.style.opacity = '0.8';
                        document.body.appendChild(dragImage);
                        e.dataTransfer.setDragImage(dragImage, e.offsetX, e.offsetY);
                        setTimeout(() => document.body.removeChild(dragImage), 0);
                    });

                    row.addEventListener('dragend', () => {
                        row.classList.remove('pf-dragging');
                        document.querySelectorAll('.pf-queue-item').forEach(item => {
                            item.classList.remove('pf-drag-over');
                        });
                    });

                    row.addEventListener('dragover', (e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        row.classList.add('pf-drag-over');
                    });

                    row.addEventListener('dragleave', () => {
                        row.classList.remove('pf-drag-over');
                    });

                    row.addEventListener('drop', (e) => {
                        e.preventDefault();
                        row.classList.remove('pf-drag-over');
                        const sourceIdx = parseInt(e.dataTransfer.getData('text/plain'));
                        const targetIdx = idx;
                        
                        if (sourceIdx !== targetIdx && sourceIdx >= 0 && sourceIdx < this.playQueue.length) {
                            // Move item in queue
                            const item = this.playQueue.splice(sourceIdx, 1)[0];
                            this.playQueue.splice(targetIdx, 0, item);
                            
                            // Update nowPlayingIndex
                            if (this.nowPlayingIndex === sourceIdx) {
                                this.nowPlayingIndex = targetIdx;
                            } else if (sourceIdx < this.nowPlayingIndex && targetIdx >= this.nowPlayingIndex) {
                                this.nowPlayingIndex--;
                            } else if (sourceIdx > this.nowPlayingIndex && targetIdx <= this.nowPlayingIndex) {
                                this.nowPlayingIndex++;
                            }
                            
                            this.persistQueue();
                            this.renderFullQueue();
                        }
                    });

                    list.appendChild(row);
                });
                const hdr = document.querySelector('.pf-title-small');
                if (hdr) hdr.textContent = `Queue (${(this.playQueue||[]).length})`;
            }

            playNow(item) {
                if (!item || !item.id || String(item.type||'track') !== 'track') return;
                const idx = this.playQueue.findIndex((t) => t && t.service === item.service && String(t.id) === String(item.id));
                if (idx === -1) this.playQueue.unshift(item); else this.nowPlayingIndex = idx;
                if (this.nowPlayingIndex === -1) this.nowPlayingIndex = 0;
                this.persistQueue();
                this._loadAndPlayCurrent();
            }

            addToQueue(item) {
                console.log('[DBG] addToQueue received:', item);
                if (!item || !item.id) { console.log('[DBG] addToQueue skip: missing id'); return; }
                const exists = this.playQueue.find((t) => t && String(t.id) === String(item.id) && (t.service||'') === (item.service||''));
                if (!exists) {
                    const norm = {
                        id: String(item.id),
                        title: item.title || '',
                        artist: item.artist || '',
                        album: item.album || '',
                        service: item.service || this.currentService || 'deezer',
                        type: item.type || 'track',
                        rawData: item.rawData || {},
                    };
                    console.log('[DBG] addToQueue pushing normalized:', norm);
                    this.playQueue.push(norm);
                    this.persistQueue();
                    console.log('[DBG] addToQueue queue after push:', (this.playQueue||[]).map(x=>x.id));
                    this.showNotification('Added to queue', 'success');
                }
                if (this.nowPlayingIndex === -1 && this.playQueue.length > 0) { this.nowPlayingIndex = 0; this._loadAndPlayCurrent(); }
                const overlay = document.getElementById('player-fs-overlay');
                const addedIndex = Math.max(0, this.playQueue.length - 1);
                if (overlay && overlay.classList.contains('show')) {
                    this.renderFullQueue();
                    const row = document.querySelector(`.pf-queue .pf-queue-item[data-index="${addedIndex}"]`);
                    if (row && row.scrollIntoView) { row.scrollIntoView({block:'nearest'}); row.classList.add('just-added'); setTimeout(()=>row.classList.remove('just-added'), 1200); }
                } else {
                    this.showFullPlayer();
                    setTimeout(() => {
                        const row = document.querySelector(`.pf-queue .pf-queue-item[data-index="${addedIndex}"]`);
                        if (row && row.scrollIntoView) { row.scrollIntoView({block:'nearest'}); row.classList.add('just-added'); setTimeout(()=>row.classList.remove('just-added'), 1200); }
                    }, 80);
                }
            }

            playNext() {
                if (this.playQueue.length === 0) return;
                if (this.shuffle) {
                    let next = this.nowPlayingIndex;
                    if (this.playQueue.length > 1) {
                        while (next === this.nowPlayingIndex) {
                            next = Math.floor(Math.random() * this.playQueue.length);
                        }
                    }
                    this.nowPlayingIndex = next;
                } else {
                    this.nowPlayingIndex = Math.min(this.playQueue.length - 1, this.nowPlayingIndex + 1);
                }
                this.persistQueue();
                this._loadAndPlayCurrent();
            }

            playPrev() {
                if (this.playQueue.length === 0) return;
                this.nowPlayingIndex = Math.max(0, this.nowPlayingIndex - 1);
                this.persistQueue();
                this._loadAndPlayCurrent();
            }

            _handleEnded() {
                if (this.repeat) {
                    try { this.audio.currentTime = 0; this.audio.play(); } catch {}
                    return;
                }
                if (this.shuffle) {
                    this.playNext();
                    return;
                }
                if (this.nowPlayingIndex < this.playQueue.length - 1) {
                    this.playNext();
                } else {
                    this.nowPlayingIndex = 0;
                    this.persistQueue();
                    this._loadAndPlayCurrent();
                }
            }

            async _loadAndPlayCurrent() {
                const it = this.playQueue[this.nowPlayingIndex];
                if (!it) return;
                const url = this.getStreamUrlForItem(it);
                this.setLoadingUI(true);
                this.audio.src = url;
                try {
                    const savedId = localStorage.getItem('player.lastId');
                    const savedSvc = localStorage.getItem('player.lastService') || '';
                    const resumeAt = Number(localStorage.getItem('player.lastTime') || '0');
                    localStorage.setItem('player.lastId', String(it.id));
                    localStorage.setItem('player.lastService', String(it.service || this.currentService || 'deezer'));
                    if (String(it.id) === String(savedId) && (it.service||'') === savedSvc && resumeAt > 0) {
                        const applyResume = () => {
                            try { this.audio.currentTime = resumeAt; } catch {}
                            this.audio.removeEventListener('loadedmetadata', applyResume);
                        };
                        this.audio.addEventListener('loadedmetadata', applyResume);
                    }
                } catch {}
                try { await this.audio.play(); } catch {}
                // update bar
                const bar = document.getElementById('player-bar');
                const cover = document.getElementById('player-cover');
                const title = document.getElementById('player-title');
                const artist = document.getElementById('player-artist');
                const btn = document.getElementById('player-toggle');
                title.textContent = it.title || 'Unknown Title';
                artist.textContent = it.artist || '';
                const img = this.getCoverArtUrl(it) || '';
                cover.innerHTML = img ? `<img src="${img}" alt="">` : '<svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor" stroke="none"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" opacity="0.7"/><circle cx="10" cy="19" r="2" opacity="0.9"/></svg>';
                btn.textContent = '⏸';
                bar.classList.add('show');
                document.body.classList.add('player-visible');
            }

            persistQueue() {
                localStorage.setItem('player.queue', JSON.stringify(this.playQueue));
                localStorage.setItem('player.index', String(this.nowPlayingIndex));
            }

            getStreamUrlForItem(item) {
                const service = item.service || (this.currentService || 'deezer');
                const quality = service === 'deezer' ? (this.qualitySettings.deezer || '320') : (this.qualitySettings.qobuz || '44khz');
                return `/api/stream?service=${encodeURIComponent(service)}&id=${encodeURIComponent(item.id)}&quality=${encodeURIComponent(quality)}`;
            }

            setupAlbumModal() {
                this.albumModal = {
                    overlay: document.getElementById('album-modal-overlay'),
                    modal: document.querySelector('.album-modal'),
                    closeBtn: document.getElementById('album-modal-close'),
                    cover: document.getElementById('album-modal-cover'),
                    title: document.getElementById('album-modal-title'),
                    artist: document.getElementById('album-modal-artist'),
                    year: document.getElementById('album-modal-year'),
                    tracks: document.getElementById('album-modal-tracks'),
                    loading: document.getElementById('modal-loading'),
                    container: document.getElementById('album-tracks-container'),
                    tracksList: document.getElementById('album-tracks-list'),
                    downloadAllBtn: document.getElementById('album-download-all-btn')
                };

                // Close modal events
                this.albumModal.closeBtn.addEventListener('click', () => this.closeAlbumModal());
                this.albumModal.overlay.addEventListener('click', (e) => {
                    if (e.target === this.albumModal.overlay) {
                        this.closeAlbumModal();
                    }
                });

                // Download all button
                this.albumModal.downloadAllBtn.addEventListener('click', () => this.downloadAllAlbumTracks());

                // Escape key to close
                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape' && this.albumModal.overlay.classList.contains('show')) {
                        this.closeAlbumModal();
                    }
                });
            }

            async showAlbumModal(albumResult) {
                try {
                    this.currentAlbumData = albumResult;
                    
                    // Create cache key
                    const cacheKey = `${this.currentService}_${albumResult.id}`;
                    
                    // Check if we already have this album's tracks cached
                    if (this.albumTracksCache.has(cacheKey)) {
                        this.debug('Using cached tracks for:', albumResult.title);
                        
                        // Show modal with cached data
                        this.albumModal.overlay.classList.add('show');
                        this.albumModal.loading.style.display = 'none';
                        this.albumModal.container.style.display = 'block';
                        
                        // Set basic album info
                        this.albumModal.title.textContent = albumResult.title;
                        this.albumModal.artist.textContent = albumResult.artist;
                        
                        if (albumResult.year) {
                            this.albumModal.year.textContent = albumResult.year;
                            this.albumModal.year.style.display = 'inline';
                        } else {
                            this.albumModal.year.style.display = 'none';
                        }

                        // Set cover image
                        const coverUrl = this.getCoverArtUrl(albumResult);
                        if (coverUrl) {
                            this.albumModal.cover.innerHTML = `<img src="${coverUrl}" alt="${albumResult.title}" loading="lazy">`;
                        } else {
                            this.albumModal.cover.innerHTML = '💿';
                        }
                        
                        // Display cached tracks
                        const cachedData = this.albumTracksCache.get(cacheKey);
                        this.displayAlbumTracks(cachedData);
                        return;
                    }
                    
                    // Show modal and loading state
                    this.albumModal.overlay.classList.add('show');
                    this.albumModal.loading.style.display = 'flex';
                    this.albumModal.container.style.display = 'none';

                    // Set basic album info
                    this.albumModal.title.textContent = albumResult.title;
                    this.albumModal.artist.textContent = albumResult.artist;
                    
                    if (albumResult.year) {
                        this.albumModal.year.textContent = albumResult.year;
                        this.albumModal.year.style.display = 'inline';
                    } else {
                        this.albumModal.year.style.display = 'none';
                    }

                    // Set cover image
                    const coverUrl = this.getCoverArtUrl(albumResult);
                    if (coverUrl) {
                        this.albumModal.cover.innerHTML = `<img src="${coverUrl}" alt="${albumResult.title}" loading="lazy">`;
                    } else {
                        this.albumModal.cover.innerHTML = '💿';
                    }

                    // Fetch album tracks from backend
                    this.debug('Fetching album tracks for:', albumResult.title);
                    
                    if (this.currentService === 'deezer') {
                        this.socket.emit('getAlbumTracks', {
                            albumId: albumResult.id,
                            service: 'deezer',
                            albumData: albumResult
                        });
                    } else if (this.currentService === 'qobuz') {
                        this.socket.emit('getAlbumTracks', {
                            albumId: albumResult.id,
                            service: 'qobuz',
                            albumData: albumResult
                        });
                    }

                } catch (error) {
                    console.error('Error showing album modal:', error);
                    this.showNotification('Failed to load album tracks', 'error');
                    this.closeAlbumModal();
                }
            }

            setupViewAllModal() {
                this.viewAllModal = {
                    overlay: document.getElementById('view-all-modal-overlay'),
                    modal: document.querySelector('.view-all-modal'),
                    closeBtn: document.getElementById('view-all-modal-close'),
                    title: document.getElementById('view-all-modal-title'),
                    subtitle: document.getElementById('view-all-modal-subtitle'),
                    loading: document.getElementById('view-all-loading'),
                    content: document.getElementById('view-all-content'),
                    grid: document.getElementById('view-all-grid')
                };
            
                // Close modal events
                this.viewAllModal.closeBtn.addEventListener('click', () => this.closeViewAllModal());
                this.viewAllModal.overlay.addEventListener('click', (e) => {
                    if (e.target === this.viewAllModal.overlay) {
                        this.closeViewAllModal();
                    }
                });
            
                // Escape key to close
                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape' && this.viewAllModal.overlay.classList.contains('show')) {
                        this.closeViewAllModal();
                    }
                });
            }
            
            showViewAllModal(type, service) {
                const titles = {
                    'new-releases': 'New Releases',
                    'trending-albums': 'Trending Albums',
                    'popular-playlists': 'Popular Playlists',
                    'top-artists': 'Top Artists',
                    'top-tracks': 'Top Tracks',
                    'genre-pop': 'Pop Highlights',
                    'genre-rap': 'Hip-Hop Highlights',
                    'genre-jazz': 'Jazz Highlights'
                };

                if (String(type || '').startsWith('favorite-genre:')) {
                    const genreId = String(type).split(':')[1];
                    const genre = (this.favoriteGenres || []).find((entry) => entry.id === genreId) || (this.availableFavoriteGenres || []).find((entry) => entry.id === genreId);
                    this.viewAllModal.title.textContent = genre?.label ? `${genre.label} Focus` : 'Genre Focus';
                } else {
                    this.viewAllModal.title.textContent = titles[type] || 'Content';
                }
                this.viewAllModal.subtitle.textContent = service.charAt(0).toUpperCase() + service.slice(1);
                
                // Show modal and loading state
                this.viewAllModal.overlay.classList.add('show');
                this.viewAllModal.loading.style.display = 'flex';
                this.viewAllModal.content.style.display = 'none';
                
                // Fetch more content (50 items for view all)
                if (String(type || '').startsWith('favorite-genre:')) {
                    this.socket.emit('getGenreDiscovery', {
                        genreId: String(type).split(':')[1],
                        limit: 50,
                    });
                } else {
                    this.socket.emit('getDiscoveryContent', {
                        type: type,
                        service: service,
                        limit: 50
                    });
                }
            }
            
            displayViewAllContent(data) {
                this.viewAllModal.loading.style.display = 'none';
                this.viewAllModal.content.style.display = 'block';
                
                const { items } = data;
                this.viewAllModal.grid.innerHTML = '';
                
                if (!items || items.length === 0) {
                    this.viewAllModal.grid.innerHTML = `
                        <div class="empty-state" style="grid-column: 1 / -1;">
                            <div class="empty-state-icon">🎵</div>
                            <h3>No content found</h3>
                            <p>Try switching services or check back later</p>
                        </div>
                    `;
                    return;
                }
                
                items.forEach(item => {
                    this.discoveryCache.set(this.getDiscoveryCacheKey(data.service, item.type, item.id), {
                        ...item,
                        service: data.service,
                    });
                    const card = this.createDiscoveryCard(item, data.service);
                    this.viewAllModal.grid.appendChild(card);
                });
            }
            
            closeViewAllModal() {
                this.viewAllModal.overlay.classList.remove('show');
                
                // Reset modal state
                setTimeout(() => {
                    this.viewAllModal.loading.style.display = 'flex';
                    this.viewAllModal.content.style.display = 'none';
                    this.viewAllModal.grid.innerHTML = '';
                }, 300);
            }

            displayAlbumTracks(tracksData) {
                try {
                    this.albumModal.loading.style.display = 'none';
                    this.albumModal.container.style.display = 'block';

                    const tracks = tracksData.tracks || [];
                    this.albumModal.tracks.textContent = `${tracks.length} tracks`;
                    
                    // Cache the tracks data for future use
                    if (this.currentAlbumData) {
                        const cacheKey = `${this.currentService}_${this.currentAlbumData.id}`;
                        this.albumTracksCache.set(cacheKey, tracksData);
                        console.log(`💾 Cached tracks for: ${this.currentAlbumData.title}`);
                    }
                    
                    // Clear previous tracks
                    this.albumModal.tracksList.innerHTML = '';

                    if (tracks.length === 0) {
                        this.albumModal.tracksList.innerHTML = `
                            <div class="empty-state">
                                <div class="empty-state-icon">🎵</div>
                                <h3>No tracks found</h3>
                                <p>This album appears to be empty or unavailable</p>
                            </div>
                        `;
                        return;
                    }

                    // Create track items
                    tracks.forEach((track, index) => {
                        const trackItem = this.createAlbumTrackItem(track, index + 1);
                        this.albumModal.tracksList.appendChild(trackItem);
                    });

                    console.log(`✅ Displayed ${tracks.length} tracks for album: ${this.currentAlbumData?.title || 'Unknown'}`);

                } catch (error) {
                    console.error('Error displaying album tracks:', error);
                    this.showNotification('Failed to display album tracks', 'error');
                }
            }

            createAlbumTrackItem(track, trackNumber) {
                const trackItem = document.createElement('div');
                trackItem.className = 'album-track-item';
                trackItem.dataset.trackId = track.id || track.SNG_ID || trackNumber;
            
                // SVG Icons
                const artistIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                                      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                                      <line x1="12" x2="12" y1="19" y2="23"/>
                                      <line x1="8" x2="16" y1="23" y2="23"/>
                                    </svg>`;
            
                const durationIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <circle cx="12" cy="12" r="10"/>
                                        <polyline points="12,6 12,12 16,14"/>
                                      </svg>`;
            
                const downloadIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                        <polyline points="7,10 12,15 17,10"/>
                                        <line x1="12" x2="12" y1="15" y2="3"/>
                                      </svg>`;
            
                const loadingIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="loading-spinner">
                                       <path d="M21 12a9 9 0 11-6.219-8.56"/>
                                     </svg>`;
            
                const completedIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                         <polyline points="20,6 9,17 4,12"/>
                                       </svg>`;
            
                // Format duration
                let duration = 'N/A';
                if (track.duration) {
                    duration = this.formatDuration(track.duration);
                } else if (track.DURATION) {
                    duration = this.formatDuration(track.DURATION);
                }
            
                // Get track title and artist
                const title = track.title || track.SNG_TITLE || 'Unknown Track';
                const artist = track.performer?.name || track.ART_NAME || this.currentAlbumData.artist;
            
                // Check if track is already downloading/downloaded
                const existingDownload = this.downloadQueue.find(item => 
                    (item.id === track.id || item.id === track.SNG_ID) && 
                    (item.status === 'downloading' || item.status === 'completed')
                );
            
                let downloadButtonHTML = '';
                if (existingDownload) {
                    if (existingDownload.status === 'downloading') {
                        downloadButtonHTML = `<button class="album-track-download-btn downloading" disabled>${loadingIcon} Downloading</button>`;
                    } else if (existingDownload.status === 'completed') {
                        downloadButtonHTML = `<button class="album-track-download-btn completed" disabled>${completedIcon} Downloaded</button>`;
                    }
                } else {
                    downloadButtonHTML = `<button class="album-track-download-btn">${downloadIcon} Download</button>`;
                }
            
                trackItem.innerHTML = `
                    <div class="album-track-number">${trackNumber}</div>
                    <div class="album-track-info">
                        <div class="album-track-title">${this.truncateText(title, 50)}</div>
                        <div class="album-track-meta">
                            <span class="track-meta-item">${artistIcon} ${this.truncateText(artist, 30)}</span>
                            <span class="track-meta-item">${durationIcon} ${duration}</span>
                        </div>
                    </div>
                    ${downloadButtonHTML}
                `;
            
                // Add download event listener
                const downloadBtn = trackItem.querySelector('.album-track-download-btn');
                if (downloadBtn && !downloadBtn.disabled) {
                    downloadBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.downloadAlbumTrack(track, trackNumber);
                    });
                }
            
                return trackItem;
            }

            downloadAlbumTrack(track, trackNumber) {
                try {
                    // Create a standardized track object for download
                    const downloadTrack = {
                        id: track.id || track.SNG_ID || `${this.currentAlbumData.id}_${trackNumber}`,
                        title: track.title || track.SNG_TITLE || 'Unknown Track',
                        artist: track.performer?.name || track.ART_NAME || this.currentAlbumData.artist,
                        album: this.currentAlbumData.title,
                        type: 'track',
                        duration: this.formatDuration(track.duration || track.DURATION || 0),
                        year: this.currentAlbumData.year,
                        rawData: track
                    };

                    console.log('🎵 Downloading album track:', downloadTrack.title);
                    
                    // Use client download if enabled
                    if (this.downloadToClient) {
                        this.downloadTrackToClient(downloadTrack);
                    } else {
                        this.downloadItem(downloadTrack);
                    }

                    // Update the button in the modal
                    const trackItem = document.querySelector(`[data-track-id="${downloadTrack.id}"]`);
                    if (trackItem) {
                        const btn = trackItem.querySelector('.album-track-download-btn');
                        if (btn) {
                            btn.className = 'album-track-download-btn downloading';
                            btn.disabled = true;
                            btn.innerHTML = '<div class="loading-spinner"></div> Downloading';
                        }
                    }

                } catch (error) {
                    console.error('Error downloading album track:', error);
                    this.showNotification('Failed to download track', 'error');
                }
            }

            async downloadAllAlbumTracks() {
                try {
                    // Double-check that we have album data
                    if (!this.currentAlbumData) {
                        console.error('❌ No album data available for download');
                        this.showNotification('No album data available', 'error');
                        return;
                    }

                    // Store a deep copy of album data before closing modal
                    const albumToDownload = JSON.parse(JSON.stringify(this.currentAlbumData));
                    
                    // Validate the copied data
                    if (!albumToDownload || !albumToDownload.title) {
                        console.error('❌ Invalid album data:', albumToDownload);
                        this.showNotification('Invalid album data', 'error');
                        return;
                    }

                    this.debug('Downloading entire album:', albumToDownload.title);

                    // Close the modal AFTER we've validated and copied the data
                    this.closeAlbumModal();

                    if (this.downloadToClient) {
                        const jobId = `zip-${this.currentService}-album-${albumToDownload.id}-${Date.now()}`;
                        const queueItem = {
                            id: jobId,
                            title: `${this.buildSafeName(albumToDownload.artist)} - ${this.buildSafeName(albumToDownload.title)}.zip`,
                            artist: albumToDownload.artist,
                            album: albumToDownload.title,
                            type: 'zip',
                            status: 'downloading',
                            startTime: new Date(),
                            endTime: null
                        };
                        this.downloadQueue.push(queueItem);
                        this.updateQueueUI();
                        const service = this.currentService;
                        const cacheKey = `${service}_${albumToDownload.id}`;
                        const cached = this.albumTracksCache.get(cacheKey);
                        const tracks = cached?.tracks || [];
                        if (tracks.length === 0) {
                            this.showNotification('Album tracks not loaded; open album first', 'warning');
                            return;
                        }
                        const itemIds = tracks.map(t => String(t.id || t.SNG_ID)).filter(Boolean);
                        const quality = service === 'deezer' ? (this.qualitySettings.deezer || '320') : (this.qualitySettings.qobuz || '44khz');
                        const zipName = `${this.buildSafeName(albumToDownload.artist||'Artist')} - ${this.buildSafeName(albumToDownload.title||'Album')}.zip`;

                        const resp = await fetch('/api/download-zip', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ service, itemIds, quality, structure: 'album', zipName, jobId })
                        });
                        if (!resp.ok) throw new Error('ZIP request failed');
                        const blob = await this.readStreamWithProgress(resp, jobId);
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(blob);
                        a.download = zipName;
                        document.body.appendChild(a);
                        a.click();
                        URL.revokeObjectURL(a.href);
                        a.remove();
                        this.showNotification('Album ZIP downloading in browser', 'success');
                    } else {
                        this.downloadItem(albumToDownload);
                        this.navigateToPage('downloads');
                    }

                } catch (error) {
                    console.error('Error downloading all album tracks:', error);
                    this.showNotification('Failed to download album: ' + error.message, 'error');
                }
            }

            closeAlbumModal() {
                this.albumModal.overlay.classList.remove('show');
                this.currentAlbumData = null;
                
                // Reset modal state
                setTimeout(() => {
                    this.albumModal.loading.style.display = 'flex';
                    this.albumModal.container.style.display = 'none';
                    this.albumModal.tracksList.innerHTML = '';
                }, 300);
            }

            clearAlbumCache() {
                this.albumTracksCache.clear();
                this.debug('Album tracks cache cleared');
            }

            setupPlaylistModal() {
                this.playlistModal = {
                    overlay: document.getElementById('playlist-modal-overlay'),
                    modal: document.querySelector('.playlist-modal'),
                    closeBtn: document.getElementById('playlist-modal-close'),
                    cover: document.getElementById('playlist-modal-cover'),
                    title: document.getElementById('playlist-modal-title'),
                    artist: document.getElementById('playlist-modal-artist'),
                    year: document.getElementById('playlist-modal-year'),
                    tracks: document.getElementById('playlist-modal-tracks'),
                    loading: document.getElementById('playlist-modal-loading'),
                    container: document.getElementById('playlist-tracks-container'),
                    tracksList: document.getElementById('playlist-modal-tracks-list'),
                    downloadAllBtn: document.getElementById('playlist-download-all-btn')
                };
            
                // Close modal events
                this.playlistModal.closeBtn.addEventListener('click', () => this.closePlaylistModal());
                this.playlistModal.overlay.addEventListener('click', (e) => {
                    if (e.target === this.playlistModal.overlay) {
                        this.closePlaylistModal();
                    }
                });
            
                // Download all button
                this.playlistModal.downloadAllBtn.addEventListener('click', () => this.downloadAllPlaylistTracks());
            
                // Escape key to close
                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape' && this.playlistModal.overlay.classList.contains('show')) {
                        this.closePlaylistModal();
                    }
                });
            }
            
            async showPlaylistModal(playlistResult) {
                try {
                    const playlistService = playlistResult.service || this.currentService;
                    this.currentPlaylistData = {
                        ...playlistResult,
                        service: playlistService,
                    };
                    
                    // Create cache key
                    const cacheKey = `${playlistService}_playlist_${playlistResult.id}`;
                    
                    // Check if we already have this playlist's tracks cached
                    if (this.playlistTracksCache.has(cacheKey)) {
                        this.debug('Using cached tracks for playlist:', playlistResult.title);
                        
                        // Show modal with cached data
                        this.playlistModal.overlay.classList.add('show');
                        this.playlistModal.loading.style.display = 'none';
                        this.playlistModal.container.style.display = 'block';
                        
                        // Set basic playlist info
                        this.playlistModal.title.textContent = playlistResult.title;
                        this.playlistModal.artist.textContent = playlistResult.artist;
                        
                        if (playlistResult.year) {
                            this.playlistModal.year.textContent = playlistResult.year;
                            this.playlistModal.year.style.display = 'inline';
                        } else {
                            this.playlistModal.year.style.display = 'none';
                        }
            
                        // Set cover image
                        const coverUrl = this.getCoverArtUrl(playlistResult);
                        if (coverUrl) {
                            this.playlistModal.cover.innerHTML = `<img src="${coverUrl}" alt="${playlistResult.title}" loading="lazy">`;
                        } else {
                            this.playlistModal.cover.innerHTML = '📋';
                        }
                        
                        // Display cached tracks
                        const cachedData = this.playlistTracksCache.get(cacheKey);
                        this.displayPlaylistTracks(cachedData);
                        return;
                    }
                    
                    // Show modal and loading state
                    this.playlistModal.overlay.classList.add('show');
                    this.playlistModal.loading.style.display = 'flex';
                    this.playlistModal.container.style.display = 'none';
            
                    // Set basic playlist info
                    this.playlistModal.title.textContent = playlistResult.title;
                    this.playlistModal.artist.textContent = playlistResult.artist;
                    
                    if (playlistResult.year) {
                        this.playlistModal.year.textContent = playlistResult.year;
                        this.playlistModal.year.style.display = 'inline';
                    } else {
                        this.playlistModal.year.style.display = 'none';
                    }
            
                    // Set cover image
                    const coverUrl = this.getCoverArtUrl(playlistResult);
                    if (coverUrl) {
                        this.playlistModal.cover.innerHTML = `<img src="${coverUrl}" alt="${playlistResult.title}" loading="lazy">`;
                    } else {
                        this.playlistModal.cover.innerHTML = '📋';
                    }
            
                    // Fetch playlist tracks from backend
                    this.debug('Fetching playlist tracks for:', playlistResult.title);
                    
                    if (playlistService === 'deezer') {
                        this.socket.emit('getPlaylistTracks', {
                            playlistId: playlistResult.id,
                            service: 'deezer',
                            playlistData: playlistResult
                        });
                    } else if (playlistService === 'qobuz') {
                        this.socket.emit('getPlaylistTracks', {
                            playlistId: playlistResult.id,
                            service: 'qobuz',
                            playlistData: playlistResult
                        });
                    }
            
                } catch (error) {
                    console.error('Error showing playlist modal:', error);
                    this.showNotification('Failed to load playlist tracks', 'error');
                    this.closePlaylistModal();
                }
            }
            
            displayPlaylistTracks(tracksData) {
                try {
                    // Check if this is for the playlist editor or the regular playlist modal
                    if (this.currentPlaylistEditData && String(tracksData.playlistId) === String(this.currentPlaylistEditData.playlistId)) {
                        this.displayPlaylistEditor(tracksData);
                        return;
                    }

                    // Regular playlist modal handling
                    this.playlistModal.loading.style.display = 'none';
                    this.playlistModal.container.style.display = 'block';
            
                    const tracks = tracksData.tracks || [];
                    this.playlistModal.tracks.textContent = `${tracks.length} tracks`;
                    
                    // Cache the tracks data for future use
                    if (this.currentPlaylistData) {
                        const cacheService = tracksData.service || this.currentPlaylistData.service || this.currentService;
                        const cacheKey = `${cacheService}_playlist_${this.currentPlaylistData.id}`;
                        this.playlistTracksCache.set(cacheKey, tracksData);
                        this.debug(`Cached tracks for playlist: ${this.currentPlaylistData.title}`);
                    }
                    
                    // Clear previous tracks
                    this.playlistModal.tracksList.innerHTML = '';
            
                    if (tracks.length === 0) {
                        this.playlistModal.tracksList.innerHTML = `
                            <div class="empty-state">
                                <div class="empty-state-icon">🎵</div>
                                <h3>No tracks found</h3>
                                <p>This playlist appears to be empty or unavailable</p>
                            </div>
                        `;
                        return;
                    }
            
                    // Create track items
                    tracks.forEach((track, index) => {
                        const trackItem = this.createPlaylistTrackItem(track, index + 1);
                        this.playlistModal.tracksList.appendChild(trackItem);
                    });
            
                    this.debug(`Displayed ${tracks.length} tracks for playlist: ${this.currentPlaylistData?.title || 'Unknown'}`);
            
                } catch (error) {
                    console.error('Error displaying playlist tracks:', error);
                    this.showNotification('Failed to display playlist tracks', 'error');
                }
            }

            displayPlaylistEditor(tracksData) {
                try {
                    // Store the tracks data
                    this.currentPlaylistEditData.tracks = tracksData.tracks || [];
                    this.currentPlaylistEditData.playlistInfo = tracksData.playlistInfo || {};

                    // Reset URL button
                    this.resetUrlButton();

                    // Show the playlist editor modal
                    const modal = document.getElementById('playlist-editor-modal');
                    const playlistName = document.getElementById('playlist-name-editor');
                    const tracksList = document.getElementById('playlist-tracks-list');

                    const totalCount = modal.querySelector('#total-count');
                    const selectedCount = modal.querySelector('#selected-count');

                    // Set playlist name
                    const name = this.currentPlaylistEditData.playlistInfo.title || 
                                 this.currentPlaylistEditData.playlistInfo.name || 
                                 'Downloaded Playlist';
                    if (playlistName) {
                        playlistName.value = name;
                        playlistName.placeholder = name;
                    } else {
                        console.error('Playlist name input not found');
                    }

                    // Clear and populate tracks
                    tracksList.innerHTML = '';
                    const tracks = this.currentPlaylistEditData.tracks;

                    if (tracks.length === 0) {
                        tracksList.innerHTML = `
                            <div class="empty-state">
                                <div class="empty-state-icon">🎵</div>
                                <h3>No tracks found</h3>
                                <p>This playlist appears to be empty or unavailable</p>
                            </div>
                        `;
                        return;
                    }

                    // Create track selection items
                    tracks.forEach((track, index) => {
                        const trackItem = this.createPlaylistEditorTrackItem(track, index);
                        tracksList.appendChild(trackItem);
                    });

                    // Update counters - force update after DOM manipulation
                    if (totalCount && selectedCount) {
                        const tracksLength = tracks.length;

                        totalCount.textContent = tracksLength.toString();
                        totalCount.innerHTML = tracksLength.toString();
                        totalCount.innerText = tracksLength.toString();
                        totalCount.setAttribute('data-total', tracksLength.toString());
                        
                        selectedCount.textContent = '0';
                        selectedCount.innerHTML = '0';
                        selectedCount.innerText = '0';
                    } else {
                        console.error('Counter elements not found:', { totalCount, selectedCount });
                        return;
                    }

                    // Show modal
                    modal.classList.add('show');

                } catch (error) {
                    console.error('Error displaying playlist editor:', error);
                    this.showNotification('Failed to open playlist editor', 'error');
                    this.resetUrlButton();
                }
            }

            createPlaylistEditorTrackItem(track, index) {
                const trackItem = document.createElement('div');
                trackItem.className = 'playlist-track-item';
                trackItem.dataset.trackIndex = index;

                const trackId = track.id || track.SNG_ID || `track_${index}`;
                const title = track.title || track.SNG_TITLE || 'Unknown Track';
                const artist = track.artist || track.ART_NAME || (track.performer && track.performer.name) || 'Unknown Artist';
                const duration = this.formatDuration(track.duration || track.DURATION || 0);

                trackItem.innerHTML = `
                    <input type="checkbox" class="playlist-track-checkbox" data-track-index="${index}">
                    <div class="playlist-track-info">
                        <div class="playlist-track-title">${this.escapeHtml(title)}</div>
                        <div class="playlist-track-artist">${this.escapeHtml(artist)}</div>
                    </div>
                    <div class="playlist-track-duration">${duration}</div>
                `;

                // Add click handler for the entire row
                trackItem.addEventListener('click', (e) => {
                    if (e.target.type !== 'checkbox') {
                        const checkbox = trackItem.querySelector('.playlist-track-checkbox');
                        checkbox.checked = !checkbox.checked;
                        this.updateTrackSelection(trackItem, checkbox.checked);
                    }
                });

                // Add checkbox change handler
                const checkbox = trackItem.querySelector('.playlist-track-checkbox');
                checkbox.addEventListener('change', (e) => {
                    this.updateTrackSelection(trackItem, e.target.checked);
                });

                return trackItem;
            }

            updateTrackSelection(trackItem, isSelected) {
                trackItem.classList.toggle('selected', isSelected);
                
                // Update selected count - use modal-specific selector
                const modal = document.getElementById('playlist-editor-modal');
                const selectedCount = modal?.querySelector('#selected-count');
                const checkedBoxes = document.querySelectorAll('#playlist-tracks-list .playlist-track-checkbox:checked');
                if (selectedCount) {
                    const newValue = checkedBoxes.length.toString();
                    
                    selectedCount.textContent = newValue;
                    selectedCount.innerHTML = newValue;
                    selectedCount.innerText = newValue;
                    selectedCount.setAttribute('data-count', newValue);
                } else {
                    this.debugWarn('Selected count element not found during update');
                }
            }

            initPlaylistEditorEventListeners() {
                // Close button
                const closeBtn = document.getElementById('playlist-editor-close');
                if (closeBtn) {
                    closeBtn.addEventListener('click', () => {
                        this.closePlaylistEditor();
                    });
                }

                // Select/Deselect all buttons
                const selectAllBtn = document.getElementById('select-all-tracks');
                const deselectAllBtn = document.getElementById('deselect-all-tracks');
                
                if (selectAllBtn) {
                    selectAllBtn.addEventListener('click', () => {
                        this.selectAllTracks(true);
                    });
                }

                if (deselectAllBtn) {
                    deselectAllBtn.addEventListener('click', () => {
                        this.selectAllTracks(false);
                    });
                }

                // Action buttons
                const saveToPlaylistBtn = document.getElementById('save-to-user-playlist');
                const addToQueueBtn = document.getElementById('add-to-queue');
                const playSelectedBtn = document.getElementById('play-selected');
                const downloadSelectedBtn = document.getElementById('download-selected');

                if (saveToPlaylistBtn) {
                    saveToPlaylistBtn.addEventListener('click', () => {
                        this.saveSelectedToPlaylist();
                    });
                }

                if (addToQueueBtn) {
                    addToQueueBtn.addEventListener('click', () => {
                        this.addSelectedToQueue();
                    });
                }

                if (playSelectedBtn) {
                    playSelectedBtn.addEventListener('click', () => {
                        this.playSelectedTracks();
                    });
                }

                if (downloadSelectedBtn) {
                    downloadSelectedBtn.addEventListener('click', () => {
                        this.downloadSelectedTracks();
                    });
                }
            }

            closePlaylistEditor() {
                const modal = document.getElementById('playlist-editor-modal');
                modal.classList.remove('show');
                this.currentPlaylistEditData = null;
            }

            selectAllTracks(selectAll) {
                const checkboxes = document.querySelectorAll('#playlist-tracks-list .playlist-track-checkbox');
                
                checkboxes.forEach((checkbox, index) => {
                    checkbox.checked = selectAll;
                    const trackItem = checkbox.closest('.playlist-track-item');
                    this.updateTrackSelection(trackItem, selectAll);
                });

                // Update the counter manually with multiple approaches - use modal-specific selectors
                const modal = document.getElementById('playlist-editor-modal');
                const selectedCount = modal?.querySelector('#selected-count');
                const totalCount = modal?.querySelector('#total-count');
                if (selectedCount && totalCount) {
                    const newSelectedValue = selectAll ? checkboxes.length.toString() : '0';
                    
                    selectedCount.textContent = newSelectedValue;
                    selectedCount.innerHTML = newSelectedValue;
                    selectedCount.innerText = newSelectedValue;
                } else {
                    console.error('Counter elements not found in selectAllTracks');
                }
            }

            getSelectedTracks() {
                const selectedTracks = [];
                const checkboxes = document.querySelectorAll('#playlist-tracks-list .playlist-track-checkbox:checked');
                
                checkboxes.forEach(checkbox => {
                    const trackIndex = parseInt(checkbox.dataset.trackIndex);
                    if (!isNaN(trackIndex) && this.currentPlaylistEditData.tracks[trackIndex]) {
                        selectedTracks.push(this.currentPlaylistEditData.tracks[trackIndex]);
                    }
                });

                return selectedTracks;
            }

            saveSelectedToPlaylist() {
                const selectedTracks = this.getSelectedTracks();
                if (selectedTracks.length === 0) {
                    this.showNotification('No tracks selected', 'warning');
                    return;
                }

                const playlistName = document.getElementById('playlist-name-editor').value.trim() || 'Downloaded Playlist';
                
                // Create new user playlist
                const playlist = {
                    id: 'pl-' + Date.now(),
                    name: playlistName,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    items: selectedTracks.map(track => ({
                        id: String(track.id || track.SNG_ID),
                        title: track.title || track.SNG_TITLE || 'Unknown Track',
                        artist: track.artist || track.ART_NAME || (track.performer && track.performer.name) || 'Unknown Artist',
                        album: track.album || track.ALB_TITLE || '',
                        service: this.currentPlaylistEditData.service === 'spotify' ? this.currentService : (this.currentPlaylistEditData.service || this.currentService),
                        type: 'track',
                        rawData: track
                    }))
                };

                // Save to user playlists
                this.playlists.push(playlist);
                this.persistPlaylists();
                this.renderPlaylistsGrid();

                this.showNotification(`Saved ${selectedTracks.length} tracks as "${playlistName}"`, 'success');
            }

            addSelectedToQueue() {
                const selectedTracks = this.getSelectedTracks();
                if (selectedTracks.length === 0) {
                    this.showNotification('No tracks selected', 'warning');
                    return;
                }

                let added = 0;
                selectedTracks.forEach(track => {
                    const trackData = {
                        id: String(track.id || track.SNG_ID),
                        title: track.title || track.SNG_TITLE || 'Unknown Track',
                        artist: track.artist || track.ART_NAME || (track.performer && track.performer.name) || 'Unknown Artist',
                        album: track.album || track.ALB_TITLE || '',
                        service: this.currentPlaylistEditData.service === 'spotify' ? this.currentService : (this.currentPlaylistEditData.service || this.currentService),
                        type: 'track',
                        rawData: track
                    };

                    const exists = this.playQueue.find(t => String(t.id) === trackData.id && (t.service || this.currentService) === trackData.service);
                    if (!exists) {
                        this.playQueue.push(trackData);
                        added++;
                    }
                });

                this.persistQueue();
                this.showNotification(`Added ${added} track(s) to queue`, 'success');
            }

            playSelectedTracks() {
                const selectedTracks = this.getSelectedTracks();
                if (selectedTracks.length === 0) {
                    this.showNotification('No tracks selected', 'warning');
                    return;
                }

                // Replace queue with selected tracks
                this.playQueue = selectedTracks.map(track => ({
                    id: String(track.id || track.SNG_ID),
                    title: track.title || track.SNG_TITLE || 'Unknown Track',
                    artist: track.artist || track.ART_NAME || (track.performer && track.performer.name) || 'Unknown Artist',
                    album: track.album || track.ALB_TITLE || '',
                    service: this.currentPlaylistEditData.service === 'spotify' ? this.currentService : (this.currentPlaylistEditData.service || this.currentService),
                    type: 'track',
                    rawData: track
                }));

                this.nowPlayingIndex = 0;
                this.persistQueue();
                this._loadAndPlayCurrent();

                const playlistName = document.getElementById('playlist-name-editor').value.trim() || 'Selected Tracks';
                this.showNotification(`Playing ${selectedTracks.length} selected tracks`, 'success');
            }

            downloadSelectedTracks() {
                const selectedTracks = this.getSelectedTracks();
                if (selectedTracks.length === 0) {
                    this.showNotification('No tracks selected', 'warning');
                    return;
                }

                const playlistName = document.getElementById('playlist-name-editor').value.trim() || 'Downloaded Playlist';
                
                // Create a playlist download for all cases (including Spotify)
                // This will handle batch downloading properly
                const playlistItem = {
                    id: `edited-playlist-${Date.now()}`,
                    title: playlistName,
                    artist: `${selectedTracks.length} tracks`,
                    type: 'playlist',
                    service: this.currentPlaylistEditData.service === 'spotify' ? 'user-playlist' : 'user-playlist',
                    tracks: selectedTracks.map(track => ({
                        id: String(track.id || track.SNG_ID),
                        title: track.title || track.SNG_TITLE || 'Unknown Track',
                        artist: track.artist || track.ART_NAME || (track.performer && track.performer.name) || 'Unknown Artist',
                        album: track.album || track.ALB_TITLE || '',
                        service: this.currentPlaylistEditData.service === 'spotify' ? this.currentService : (this.currentPlaylistEditData.service || this.currentService),
                        type: 'track',
                        rawData: track
                    })),
                    rawData: {
                        id: `edited-playlist-${Date.now()}`,
                        name: playlistName,
                        items: selectedTracks.map(track => ({
                            id: String(track.id || track.SNG_ID),
                            title: track.title || track.SNG_TITLE || 'Unknown Track',
                            artist: track.artist || track.ART_NAME || (track.performer && track.performer.name) || 'Unknown Artist',
                            album: track.album || track.ALB_TITLE || '',
                            service: this.currentPlaylistEditData.service === 'spotify' ? this.currentService : (this.currentPlaylistEditData.service || this.currentService),
                            type: 'track',
                            rawData: track
                        }))
                    }
                };

                // Download as a single playlist operation
                this.downloadItem(playlistItem);
                this.showNotification(`Started playlist download: "${playlistName}" (${selectedTracks.length} tracks)`, 'success');

                // Close the editor
                this.closePlaylistEditor();
            }
            
            createPlaylistTrackItem(track, trackNumber) {
                const trackItem = document.createElement('div');
                trackItem.className = 'playlist-track-item';
                trackItem.dataset.trackId = track.id || track.SNG_ID || trackNumber;
            
                // SVG Icons
                const artistIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                                      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                                      <line x1="12" x2="12" y1="19" y2="23"/>
                                      <line x1="8" x2="16" y1="23" y2="23"/>
                                    </svg>`;
            
                const durationIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <circle cx="12" cy="12" r="10"/>
                                        <polyline points="12,6 12,12 16,14"/>
                                      </svg>`;
            
                const downloadIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                        <polyline points="7,10 12,15 17,10"/>
                                        <line x1="12" x2="12" y1="15" y2="3"/>
                                      </svg>`;
            
                const loadingIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="loading-spinner">
                                       <path d="M21 12a9 9 0 11-6.219-8.56"/>
                                     </svg>`;
            
                const completedIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                         <polyline points="20,6 9,17 4,12"/>
                                       </svg>`;
            
                // Format duration
                let duration = 'N/A';
                if (track.duration) {
                    duration = this.formatDuration(track.duration);
                } else if (track.DURATION) {
                    duration = this.formatDuration(track.DURATION);
                }
            
                // Get track title and artist
                const title = track.title || track.SNG_TITLE || 'Unknown Track';
                const artist = track.performer?.name || track.ART_NAME || this.currentPlaylistData.artist;
            
                // Check if track is already downloading/downloaded
                const existingDownload = this.downloadQueue.find(item => 
                    (item.id === track.id || item.id === track.SNG_ID) && 
                    (item.status === 'downloading' || item.status === 'completed')
                );
            
                let downloadButtonHTML = '';
                if (existingDownload) {
                    if (existingDownload.status === 'downloading') {
                        downloadButtonHTML = `<button class="playlist-track-download-btn downloading" disabled>${loadingIcon} Downloading</button>`;
                    } else if (existingDownload.status === 'completed') {
                        downloadButtonHTML = `<button class="playlist-track-download-btn completed" disabled>${completedIcon} Downloaded</button>`;
                    }
                } else {
                    downloadButtonHTML = `<button class="playlist-track-download-btn">${downloadIcon} Download</button>`;
                }
            
                trackItem.innerHTML = `
                    <div class="playlist-track-number">${trackNumber}</div>
                    <div class="playlist-track-info">
                        <div class="playlist-track-title">${this.truncateText(title, 50)}</div>
                        <div class="playlist-track-meta">
                            <span class="track-meta-item">${artistIcon} ${this.truncateText(artist, 30)}</span>
                            <span class="track-meta-item">${durationIcon} ${duration}</span>
                        </div>
                    </div>
                    ${downloadButtonHTML}
                `;
            
                // Add download event listener
                const downloadBtn = trackItem.querySelector('.playlist-track-download-btn');
                if (downloadBtn && !downloadBtn.disabled) {
                    downloadBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.downloadPlaylistTrack(track, trackNumber);
                    });
                }
            
                return trackItem;
            }
            
            downloadPlaylistTrack(track, trackNumber) {
                try {
                    // Create a standardized track object for download
                    const downloadTrack = {
                        id: track.id || track.SNG_ID || `${this.currentPlaylistData.id}_${trackNumber}`,
                        title: track.title || track.SNG_TITLE || 'Unknown Track',
                        artist: track.performer?.name || track.ART_NAME || this.currentPlaylistData.artist,
                        album: track.album?.title || track.ALB_TITLE || 'Unknown Album',
                        type: 'track',
                        duration: this.formatDuration(track.duration || track.DURATION || 0),
                        year: this.currentPlaylistData.year,
                        rawData: track
                    };
            
                    // Use client download if enabled
                    if (this.downloadToClient) {
                        const jobId = `zip-${this.currentService}-playlist-${playlistToDownload.id}-${Date.now()}`;
                        const queueItem = {
                            id: jobId,
                            title: `${this.buildSafeName(playlistToDownload.title)}.zip`,
                            artist: playlistToDownload.artist,
                            album: playlistToDownload.title,
                            type: 'zip',
                            status: 'downloading',
                            startTime: new Date(),
                            endTime: null
                        };
                        this.downloadQueue.push(queueItem);
                        this.updateQueueUI();
                        this.downloadTrackToClient(downloadTrack);
                    } else {
                        this.downloadItem(downloadTrack);
                    }
            
                    // Update the button in the modal
                    const trackItem = document.querySelector(`[data-track-id="${downloadTrack.id}"]`);
                    if (trackItem) {
                        const btn = trackItem.querySelector('.playlist-track-download-btn');
                        if (btn) {
                            btn.className = 'playlist-track-download-btn downloading';
                            btn.disabled = true;
                            btn.innerHTML = '<div class="loading-spinner"></div> Downloading';
                        }
                    }
            
                } catch (error) {
                    console.error('Error downloading playlist track:', error);
                    this.showNotification('Failed to download track', 'error');
                }
            }
            
            async downloadAllPlaylistTracks() {
                try {
                    // Double-check that we have playlist data
                    if (!this.currentPlaylistData) {
                        console.error('❌ No playlist data available for download');
                        this.showNotification('No playlist data available', 'error');
                        return;
                    }
            
                    // Store a deep copy of playlist data before closing modal
                    const playlistToDownload = JSON.parse(JSON.stringify(this.currentPlaylistData));
                    
                    // Validate the copied data
                    if (!playlistToDownload || !playlistToDownload.title) {
                        console.error('❌ Invalid playlist data:', playlistToDownload);
                        this.showNotification('Invalid playlist data', 'error');
                        return;
                    }
            
                    // Close the modal AFTER we've validated and copied the data
                    this.closePlaylistModal();
            
                    if (this.downloadToClient) {
                        const service = this.currentService;
                        const cacheKey = `${service}_playlist_${playlistToDownload.id}`;
                        const cached = this.playlistTracksCache.get(cacheKey);
                        const tracks = cached?.tracks || [];
                        if (tracks.length === 0) {
                            this.showNotification('Playlist tracks not loaded; open playlist first', 'warning');
                            return;
                        }
                        const itemIds = tracks.map(t => String(t.id || t.SNG_ID)).filter(Boolean);
                        const quality = service === 'deezer' ? (this.qualitySettings.deezer || '320') : (this.qualitySettings.qobuz || '44khz');
                        const zipName = `${this.buildSafeName(playlistToDownload.title||'Playlist')}.zip`;

                        const resp = await fetch('/api/download-zip', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ service, itemIds, quality, structure: 'album', zipName, jobId })
                        });
                        if (!resp.ok) throw new Error('ZIP request failed');
                        const blob = await this.readStreamWithProgress(resp, jobId);
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(blob);
                        a.download = zipName;
                        document.body.appendChild(a);
                        a.click();
                        URL.revokeObjectURL(a.href);
                        a.remove();
                        this.showNotification('Playlist ZIP downloading in browser', 'success');
                    } else {
                        this.downloadItem(playlistToDownload);
                        this.navigateToPage('downloads');
                    }
            
                } catch (error) {
                    console.error('Error downloading all playlist tracks:', error);
                    this.showNotification('Failed to download playlist: ' + error.message, 'error');
                }
            }
            
            closePlaylistModal() {
                this.playlistModal.overlay.classList.remove('show');
                this.currentPlaylistData = null;
                
                // Reset modal state
                setTimeout(() => {
                    this.playlistModal.loading.style.display = 'flex';
                    this.playlistModal.container.style.display = 'none';
                    this.playlistModal.tracksList.innerHTML = '';
                }, 300);
            }
            
            clearPlaylistCache() {
                this.playlistTracksCache.clear();
                this.debug('Playlist tracks cache cleared');
            }

            //RESTORE SAVE STATES CODE
            restoreSearchResults() {
                try {
                    const savedResults = localStorage.getItem('elixium-search-results');
                    if (savedResults) {
                        const results = JSON.parse(savedResults);
                        setTimeout(() => {
                            this.displayResults(results);
                        }, 100);
                    }
                } catch (error) {
                    console.error('Failed to restore search results:', error);
                }
            }            

            restoreSelectedService() {
                try {
                    const savedService = localStorage.getItem('elixium-selected-service');
                    if (savedService && (savedService === 'deezer' || savedService === 'qobuz')) {
                        // Only change UI, don't call switchService (to avoid breaking search)
                        this.currentService = savedService;
                        this.homeService = savedService;
                        
                        document.querySelectorAll('.service-btn').forEach(btn => btn.classList.remove('active'));
                        document.querySelector(`.service-btn[data-service="${savedService}"]`)?.classList.add('active');

                        // Update home service buttons
                        document.querySelectorAll('.home-service-btn').forEach(btn => btn.classList.remove('active'));
                        document.querySelectorAll(`.home-service-btn[data-service="${savedService}"]`).forEach(btn => btn.classList.add('active'));                        

                        document.getElementById('current-service').textContent = 
                            savedService.charAt(0).toUpperCase() + savedService.slice(1);
                        
                        this.updateQualityOptions();
                    }
                } catch (error) {
                    console.error('Failed to restore service:', error);
                }
            }

            restoreDownloadQueue() {
                try {
                    const savedQueue = localStorage.getItem('elixium-download-queue');
                    
                    if (savedQueue) {
                        const queue = JSON.parse(savedQueue);
                        
                        if (Array.isArray(queue) && queue.length > 0) {
                            // FIX: Convert string dates back to Date objects
                            const fixedQueue = [];
                            const seen = new Set();

                            queue.forEach((item) => {
                                const normalizedItem = {
                                    ...item,
                                    startTime: item.startTime ? new Date(item.startTime) : null,
                                    endTime: item.endTime ? new Date(item.endTime) : null,
                                    addedAt: item.addedAt ? new Date(item.addedAt) : new Date(),
                                };

                                const identity = this.getQueueIdentity(normalizedItem);
                                if (seen.has(identity) && normalizedItem.status !== 'downloading') {
                                    return;
                                }

                                seen.add(identity);
                                fixedQueue.push(normalizedItem);
                            });
                            
                            this.downloadQueue = fixedQueue;
                            this.updateQueueUI();
                            setTimeout(() => this.syncDownloadStatusWithBackend(), 1000);
                        }
                    }
                } catch (error) {
                    console.error('❌ Failed to restore download queue:', error);
                    // Clear corrupted data
                    localStorage.removeItem('elixium-download-queue');
                }
            }       

            restoreSearchType() {
                try {
                    const savedType = localStorage.getItem('elixium-search-type');
                    if (savedType && ['track', 'album', 'artist', 'playlist'].includes(savedType)) {
                        this.currentSearchType = savedType;
                        
                        // Update UI
                        document.querySelectorAll('[data-type]').forEach(btn => {
                            if (btn.closest('.filter-group')) {
                                btn.classList.remove('active');
                            }
                        });
                        document.querySelector(`[data-type="${savedType}"]`)?.classList.add('active');
                        
                        // Update placeholder
                        const input = document.getElementById('search-input');
                        const placeholders = {
                            track: 'Search for tracks...',
                            album: 'Search for albums...',
                            artist: 'Search for artists...',
                            playlist: 'Search for playlists...'
                        };
                        if (input) input.placeholder = placeholders[savedType];
                    }
                } catch (error) {
                    console.error('Failed to restore search type:', error);
                }
            }

            restoreViewMode() {
                try {
                    const savedView = localStorage.getItem('elixium-view-mode');
                    if (savedView && ['grid', 'list'].includes(savedView)) {
                        this.currentView = savedView;
                        
                        // Update UI
                        document.querySelectorAll('.view-btn').forEach(btn => btn.classList.remove('active'));
                        document.querySelector(`[data-view="${savedView}"]`)?.classList.add('active');
                        
                        // Apply view to grid
                        const grid = document.getElementById('results-grid');
                        if (savedView === 'list') {
                            grid.classList.add('list-view');
                        } else {
                            grid.classList.remove('list-view');
                        }
                    }
                } catch (error) {
                    console.error('Failed to restore view mode:', error);
                }
            }

            restoreLastSearch() {
                try {
                    const savedQuery = localStorage.getItem('elixium-last-search');
                    if (savedQuery) {
                        const searchInput = document.getElementById('search-input');
                        if (searchInput) {
                            searchInput.value = savedQuery;
                        }
                    }
                    this.renderRecentSearches();
                } catch (error) {
                    console.error('Failed to restore last search:', error);
                }
            }

            restoreCurrentPage() {
                try {
                    const savedPage = localStorage.getItem('elixium-current-page');
                    if (savedPage && ['search', 'downloads', 'url-download', 'settings', 'home', 'watchlist', 'genres', 'playlists'].includes(savedPage)) {
                        // Don't use navigateToPage to avoid saving again
                        this.currentPage = savedPage;
                        
                        // Update nav items
                        document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
                        document.querySelector(`[data-page="${savedPage}"]`)?.classList.add('active');
            
                        // Update pages
                        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
                        document.getElementById(savedPage + '-page')?.classList.add('active');
            
                        // Update title
                    const titles = {
                        home: 'Home',
                        search: 'Search Music',
                        downloads: 'Downloads',
                        watchlist: 'Watchlist',
                        genres: 'Genres',
                        'url-download': 'URL Download',
                        settings: 'Settings',
                        playlists: 'Playlists'
                    };
                        const titleElement = document.getElementById('page-title');
                        if (titleElement) {
                            titleElement.textContent = titles[savedPage];
                        }
                        this.updateMiniRailActiveState(savedPage);
                    }
                } catch (error) {
                    console.error('Failed to restore current page:', error);
                }
            }

            restoreSidebarState() {
                try {
                    const sidebarHidden = localStorage.getItem('elixium-sidebar-hidden') === 'true';
                    const appContainer = document.querySelector('.app-container');
                    
                    if (sidebarHidden && appContainer) {
                        appContainer.classList.add('sidebar-hidden');
                    }
                    this.syncMiniRailVisibility();
                } catch (error) {
                    console.error('Failed to restore sidebar state:', error);
                }
            }

            updateDownloadBadge() {
                const badge = document.getElementById('download-badge');
                const downloadingCount = this.downloadQueue.filter(item => item.status === 'downloading').length;
                
                if (downloadingCount > 0) {
                    badge.textContent = downloadingCount;
                    badge.classList.add('show');
                } else {
                    badge.classList.remove('show');
                }
            }

            setupEventListeners() {
                // Navigation
                document.querySelectorAll('.nav-item').forEach(item => {
                    item.addEventListener('click', (e) => {
                        const page = e.currentTarget.dataset.page;
                        this.navigateToPage(page);
                    });
                });

                // Service switching
                document.querySelectorAll('.service-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const svc = (e.currentTarget && e.currentTarget.dataset) ? e.currentTarget.dataset.service : null;
                        if (svc) this.switchService(svc);
                    });
                });

                // Search functionality
                document.getElementById('search-btn').addEventListener('click', () => {
                    this.performSearch();
                });

                document.getElementById('search-input').addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        this.performSearch();
                    }
                });

                document.getElementById('search-overview-toggle')?.addEventListener('click', () => {
                    this.toggleSearchOverview();
                });

                document.getElementById('home-overview-toggle')?.addEventListener('click', () => {
                    this.toggleHomeOverview();
                });

                // Filter buttons
                document.querySelectorAll('[data-type]').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        if (e.target.closest('.filter-group')) {
                            this.setSearchType(e.target.dataset.type);
                        }
                    });
                });

                // View toggle
                document.querySelectorAll('.view-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        this.setView(e.target.dataset.view);
                    });
                });

                // URL download
                document.getElementById('url-download-btn').addEventListener('click', () => {
                    this.downloadFromUrl();
                });

                document.getElementById('url-input').addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        this.downloadFromUrl();
                    }
                });

                // URL input change handler to show/hide playlist editor toggle
                document.getElementById('url-input').addEventListener('input', (e) => {
                    const url = e.target.value.trim();
                    const toggle = document.getElementById('playlist-editor-toggle');
                    const isPlaylistUrl = url && (url.includes('/playlist/') || url.includes('/album/') || url.includes('/artist/'));
                    
                    if (isPlaylistUrl) {
                        toggle.style.display = 'block';
                    } else {
                        toggle.style.display = 'none';
                        document.getElementById('enable-playlist-editor').checked = false;
                    }
                });

                // Download controls
                document.getElementById('download-btn').addEventListener('click', () => {
                    this.startDownload();
                });

                document.getElementById('mobile-download-start-btn')?.addEventListener('click', () => {
                    this.startDownload();
                });

                document.getElementById('resume-queued-btn')?.addEventListener('click', () => {
                    this.resumeQueuedDownloads();
                });

                document.getElementById('mobile-download-resume-btn')?.addEventListener('click', () => {
                    this.resumeQueuedDownloads();
                });

                document.getElementById('clear-queue-btn').addEventListener('click', () => {
                    this.clearQueue();
                });

                document.getElementById('mobile-download-clear-btn')?.addEventListener('click', () => {
                    this.clearQueue();
                });

                document.getElementById('retry-failed-btn')?.addEventListener('click', () => {
                    this.retryFailedDownloads();
                });

                document.getElementById('remove-completed-btn')?.addEventListener('click', () => {
                    this.removeCompletedDownloads();
                });

                document.getElementById('remove-failed-btn')?.addEventListener('click', () => {
                    this.removeFailedDownloads();
                });

                document.getElementById('queue-open-search-btn')?.addEventListener('click', () => {
                    this.navigateToPage('search');
                    document.getElementById('search-input')?.focus();
                });

                // Settings
                document.getElementById('save-settings').addEventListener('click', () => {
                    this.saveSettings();
                });

                // Playlist Editor Event Listeners
                this.initPlaylistEditorEventListeners();

                const mobileMenuBtn = document.getElementById('mobile-menu-btn');
                const sidebar = document.querySelector('.sidebar');
                const sidebarOverlay = document.getElementById('sidebar-overlay');
                const appContainer = document.querySelector('.app-container');
                const deezerQualitySelect = document.getElementById('deezer-quality');
                const qobuzQualitySelect = document.getElementById('qobuz-quality');
    
                if (deezerQualitySelect) {
                    deezerQualitySelect.addEventListener('change', (e) => {
                        this.qualitySettings.deezer = e.target.value;
                        this.debug('Deezer quality changed to:', e.target.value);
                        
                        // If currently on Deezer, update the search quality buttons immediately
                        if (this.currentService === 'deezer') {
                            this.currentQuality = e.target.value;
                            this.updateQualityOptions();
                        }
                        
                        // Save settings automatically
                        this.saveQualitySettings();
                    });
                }
                
                if (qobuzQualitySelect) {
                    qobuzQualitySelect.addEventListener('change', (e) => {
                        this.qualitySettings.qobuz = e.target.value;
                        this.debug('Qobuz quality changed to:', e.target.value);
                        
                        // If currently on Qobuz, update the search quality buttons immediately
                        if (this.currentService === 'qobuz') {
                            this.currentQuality = e.target.value;
                            this.updateQualityOptions();
                        }
                        
                        // Save settings automatically
                        this.saveQualitySettings();
                    });
                }                
                
                const toggleSidebar = () => {
                    appContainer.classList.toggle('sidebar-hidden');

                    const isHidden = appContainer.classList.contains('sidebar-hidden');
                    localStorage.setItem('elixium-sidebar-hidden', isHidden.toString());
                    this.syncMiniRailVisibility();

                    if (window.innerWidth <= 1024) {
                        sidebar.classList.toggle('open');
                        sidebarOverlay.classList.toggle('show');
                    }
                };

                if (mobileMenuBtn) {
                    mobileMenuBtn.addEventListener('click', toggleSidebar);
                }

                
                // Close sidebar when clicking overlay (mobile only)
                if (sidebarOverlay) {
                    sidebarOverlay.addEventListener('click', () => {
                        appContainer.classList.add('sidebar-hidden');
                        sidebar.classList.remove('open');
                        sidebarOverlay.classList.remove('show');
                        localStorage.setItem('elixium-sidebar-hidden', 'true');
                        this.syncMiniRailVisibility();
                    });
                }
                
                // Close sidebar when clicking nav items on mobile
                document.querySelectorAll('.nav-item').forEach(item => {
                    item.addEventListener('click', () => {
                        if (window.innerWidth <= 1024) {
                            appContainer.classList.add('sidebar-hidden');
                            sidebar.classList.remove('open');
                            sidebarOverlay.classList.remove('show');
                            localStorage.setItem('elixium-sidebar-hidden', 'true');
                            this.syncMiniRailVisibility();
                        }
                    });
                });

                window.addEventListener('resize', () => {
                    this.syncMiniRailVisibility();
                });

                document.addEventListener('click', (event) => {
                    const recentSearch = event.target.closest('[data-recent-search]');
                    if (recentSearch) {
                        this.runRecentSearch(recentSearch.dataset.recentSearch);
                        return;
                    }

                    const recentDownload = event.target.closest('[data-recent-download]');
                    if (recentDownload) {
                        try {
                            this.openRecentDownload(JSON.parse(recentDownload.dataset.recentDownload));
                        } catch (_error) {}
                        return;
                    }

                    const quickRoute = event.target.closest('[data-quick-route]');
                    if (quickRoute) {
                        this.runQuickRoute(quickRoute.dataset.quickRoute);
                    }
                });
            }

            setupSocketListeners() {
                this.socket.on('connect', () => {
                    document.getElementById('connection-status').classList.remove('disconnected');
                    document.getElementById('connection-status').classList.add('connected');
                });

                this.socket.on('downloadStatusUpdate', (statusData) => {
                    this.debug('Received download status update from backend');
                    
                    if (statusData.downloads && Array.isArray(statusData.downloads)) {
                        let hasUpdates = false;
                        
                        // Update each item in queue with backend status
                        statusData.downloads.forEach(backendItem => {
                            const queueItem = this.downloadQueue.find(item => item.id === backendItem.id);
                            if (queueItem) {
                                // Update status if different
                                if (queueItem.status !== backendItem.status) {
                                    queueItem.status = backendItem.status;
                                    hasUpdates = true;
                                    
                                    if (backendItem.status === 'completed' && !queueItem.endTime) {
                                        queueItem.endTime = new Date();
                                    }
                                    
                                    this.debug(`Updated ${queueItem.title}: ${backendItem.status}`);
                                }
                            }
                        });
                        
                        // Update UI if there were changes
                        if (hasUpdates) {
                            this.updateQueueUI();
                            this.updateProgressPanelState();
                        }
                    }
                    
                    // Update global download state
                    if (statusData.isDownloading !== undefined) {
                        this.isDownloading = statusData.isDownloading;
                    }
                });

                this.socket.on('disconnect', () => {
                    document.getElementById('connection-status').classList.remove('connected');
                    document.getElementById('connection-status').classList.add('disconnected');
                });

                this.socket.on('discoveryContent', (data) => {
                    this.debug('Received discovery content:', data.type);
                    
                    // Check if it's for view all modal or home page
                    if (this.viewAllModal && this.viewAllModal.overlay.classList.contains('show')) {
                        this.displayViewAllContent(data);
                    } else {
                        this.displayDiscoveryContent(data);
                    }
                });
                
                this.socket.on('discoveryError', (error) => {
                    this.debugError('Discovery content error:', error);
                    this.showNotification('Failed to load discovery content: ' + error.message, 'error');
                });                

                this.socket.on('searchResults', (results) => {
                    const append = Boolean(this.searchAppendRequested || Number(this.lastSearchRequestOffset || 0) > 0);
                    this.displayResults(results, {append});
                    this.searchOffset = append
                        ? Number(this.lastSearchRequestOffset || 0) + (Array.isArray(results) ? results.length : 0)
                        : Array.isArray(results)
                            ? results.length
                            : 0;
                    this.searchAppendRequested = false;
                    this.hideSearchLoading();
                });

                this.socket.on('searchError', (error) => {
                    this.showNotification('Search failed: ' + error.message, 'error');
                    this.hideSearchLoading();
                });

                // Album tracks response
                this.socket.on('albumTracks', (tracksData) => {
                    this.debug('Received album tracks:', tracksData);
                    if (this.currentAlbumData && String(this.currentAlbumData.id) === String(tracksData.albumId) && this.albumModal.overlay.classList.contains('show')) {
                        this.displayAlbumTracks(tracksData);
                        return;
                    }

                    if (this.handleWatchlistAlbumPreview(tracksData)) {
                        return;
                    }
                });

                this.socket.on('albumTracksError', (error) => {
                    this.debugError('Album tracks error:', error);

                    if (error?.albumId && this.watchlistExpandedAlbumIds.has(String(error.albumId))) {
                        const cacheKey = this.getWatchlistAlbumPreviewCacheKey(String(error.albumId));
                        this.watchlistAlbumPreviewCache.set(cacheKey, {
                            loading: false,
                            tracks: [],
                            error: error.message || 'Unable to load album tracks',
                        });
                        this.renderWatchlistPage();
                        return;
                    }
                    
                    if (error.suggestion === 'download_whole_album') {
                        // For Qobuz albums with API issues, suggest downloading the whole album
                        this.showNotification(error.message + ' Click here to download the entire album instead.', 'warning');
                        
                        // Add click handler to download the whole album
                        const notification = document.getElementById('notification');
                        const downloadHandler = () => {
                            notification.removeEventListener('click', downloadHandler);
                            if (this.currentAlbumData) {
                                this.closeAlbumModal();
                                this.downloadItem(this.currentAlbumData);
                                this.navigateToPage('downloads');
                            }
                        };
                        notification.addEventListener('click', downloadHandler);
                    } else if (error.retryable) {
                        // For retryable errors, offer to retry
                        this.showNotification(error.message + ' Click here to retry.', 'warning');
                        
                        // Add click handler for retry
                        const notification = document.getElementById('notification');
                        const retryHandler = () => {
                            notification.removeEventListener('click', retryHandler);
                            if (this.currentAlbumData) {
                                // Clear cache and retry
                                const cacheKey = `${this.currentService}_${this.currentAlbumData.id}`;
                                this.albumTracksCache.delete(cacheKey);
                                this.showAlbumModal(this.currentAlbumData);
                            }
                        };
                        notification.addEventListener('click', retryHandler);
                    } else {
                        this.showNotification('Failed to load album tracks: ' + error.message, 'error');
                    }
                    
                    this.closeAlbumModal();
                });

                // Playlist tracks response
                this.socket.on('playlistTracks', (tracksData) => {
                    this.debug('Received playlist tracks:', tracksData);
                    this.displayPlaylistTracks(tracksData);
                });
                
                this.socket.on('playlistTracksError', (error) => {
                    this.debugError('Playlist tracks error:', error);
                    this.showNotification('Failed to load playlist tracks: ' + error.message, 'error');
                    
                    // Check if this error is for the playlist editor
                    if (this.currentPlaylistEditData) {
                        this.resetUrlButton();
                        this.currentPlaylistEditData = null;
                    } else {
                        this.closePlaylistModal();
                    }
                });

                this.socket.on('artistAlbums', ({artistId, items}) => {
                    if (!this.currentArtistData || String(this.currentArtistData.id) !== String(artistId)) return;
                    this.currentArtistData.albums = items || [];
                    this.renderArtistDetailSection('albums');
                });

                this.socket.on('artistTracks', ({artistId, items}) => {
                    if (!this.currentArtistData || String(this.currentArtistData.id) !== String(artistId)) return;
                    this.currentArtistData.tracks = items || [];
                    this.renderArtistDetailSection('tracks');
                });

                this.socket.on('artistPlaylists', ({artistId, items}) => {
                    if (!this.currentArtistData || String(this.currentArtistData.id) !== String(artistId)) return;
                    this.currentArtistData.playlists = items || [];
                    this.renderArtistDetailSection('playlists');
                });

                this.socket.on('artistAlbumsError', ({artistId, message}) => {
                    if (!this.currentArtistData || String(this.currentArtistData.id) !== String(artistId)) return;
                    this.currentArtistData.albumError = message;
                    this.renderArtistDetailSection('albums');
                });

                this.socket.on('artistTracksError', ({artistId, message}) => {
                    if (!this.currentArtistData || String(this.currentArtistData.id) !== String(artistId)) return;
                    this.currentArtistData.trackError = message;
                    this.renderArtistDetailSection('tracks');
                });

                this.socket.on('artistPlaylistsError', ({artistId, message}) => {
                    if (!this.currentArtistData || String(this.currentArtistData.id) !== String(artistId)) return;
                    this.currentArtistData.playlistError = message;
                    this.renderArtistDetailSection('playlists');
                });

                this.socket.on('downloadProgress', (data) => {
                    this.updateDownloadProgress(data);
                });

                this.socket.on('downloadComplete', (data) => {
                    this.onDownloadComplete(data);
                });

                this.socket.on('downloadError', (error) => {
                    this.showNotification('Download failed: ' + error.message, 'error');
                    this.resetDownloadState();
                });

                this.socket.on('directUrlDownloadStart', (data) => {
                    this.onDirectUrlDownloadStart(data);
                });
                
                this.socket.on('directUrlDownloadError', (error) => {
                    this.resetUrlButton();
                    this.showNotification('Download failed: ' + error.message, 'error');
                });

                this.socket.on('directUrlConversionProgress', (data) => {
                    this.onDirectUrlConversionProgress(data);
                });
                
                this.socket.on('playlistCreated', (data) => {
                    this.showNotification(`Playlist created: ${data.trackCount} tracks`, 'success');
                });

                this.socket.on('qualitySettings', (settings) => {
                    this.qualitySettings = settings;
                    this.qualitySettingsLoaded = true;
                    this.debug('Received quality settings from backend:', settings);
                    
                    // Automatically update UI when settings arrive
                    this.updateQualityOptions();
                });
                
                this.socket.on('qualitySettingsSaved', () => {
                    this.debug('Quality settings saved to backend');
                });
                
                this.socket.on('qualitySettingsError', (error) => {
                    this.debugError('Quality settings error:', error.message);
                });

                this.socket.on('settings', (settings) => {
                    this.populateSettings(settings);
                });

                this.socket.on('settingsSaved', () => {
                    this.showNotification('Settings saved successfully', 'success');
                });

                this.socket.on('settingsError', (error) => {
                    this.showNotification('Settings error: ' + error.message, 'error');
                });

                this.socket.on('watchlistState', (state) => {
                    this.watchlistState = state || null;
                    this.favoriteGenres = Array.isArray(state?.favoriteGenres) ? state.favoriteGenres : [];
                    this.availableFavoriteGenres = Array.isArray(state?.availableGenres) ? state.availableGenres : [];
                    this.renderWatchlistSummary();
                    this.renderWatchlistPage();
                    this.renderGenresPage();
                    this.syncWatchButtons();
                });

                this.socket.on('favoriteGenres', (payload) => {
                    this.favoriteGenres = Array.isArray(payload?.genres) ? payload.genres : [];
                    this.availableFavoriteGenres = Array.isArray(payload?.availableGenres) ? payload.availableGenres : this.availableFavoriteGenres;
                    this.renderGenresPage();
                });

                this.socket.on('watchlistHistory', (payload) => {
                    if (!this.watchlistState) this.watchlistState = {};
                    this.watchlistState.processedHistory = Array.isArray(payload?.items) ? payload.items : [];
                    this.renderWatchlistPage();
                });

                this.socket.on('monitorSchedules', (payload) => {
                    this.monitorSchedules = payload || null;
                    this.renderWatchlistPage();
                });

                this.socket.on('monitorHistory', (payload) => {
                    this.monitorHistory = Array.isArray(payload?.items) ? payload.items : [];
                    this.renderWatchlistPage();
                });

                this.socket.on('watchlistQueueItems', (payload) => {
                    const queueItems = Array.isArray(payload?.queueItems) ? payload.queueItems : [];
                    this.queueIncomingWatchlistItems(queueItems, Boolean(payload?.autoStart));
                });

                this.socket.on('genreDiscovery', (payload) => {
                    this.displayGenreDiscoveryContent(payload);
                });

                this.socket.on('watchlistError', (error) => {
                    this.showNotification(`Watchlist error: ${error.message}`, 'error');
                });
            }

            setupHomeListeners() {
                // Home service toggle
                document.querySelectorAll('.home-service-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const svc = (e.currentTarget && e.currentTarget.dataset) ? e.currentTarget.dataset.service : null;
                        if (svc) this.switchHomeService(svc);
                    });
                });

                document.getElementById('home-watchlist-refresh')?.addEventListener('click', () => {
                    this.refreshWatchlist();
                });

                document.getElementById('watchlist-refresh-all')?.addEventListener('click', () => {
                    this.refreshWatchlist();
                });

                document.getElementById('watchlist-add-playlist')?.addEventListener('click', () => {
                    const input = document.getElementById('watchlist-playlist-url');
                    const url = input?.value?.trim();
                    if (!url) {
                        this.showNotification('Paste a playlist URL first', 'info');
                        return;
                    }
                    this.socket.emit('addWatchedPlaylist', {url});
                    input.value = '';
                });

                document.getElementById('watchlist-refresh-playlists')?.addEventListener('click', () => {
                    this.socket.emit('refreshAllWatchedPlaylists');
                });

                document.querySelectorAll('[data-watchlist-view]').forEach((button) => {
                    button.addEventListener('click', () => {
                        this.setWatchlistView(button.dataset.watchlistView);
                    });
                });

                document.getElementById('watchlist-open-search')?.addEventListener('click', () => {
                    this.navigateToPage('search');
                    document.getElementById('search-input')?.focus();
                });

                document.getElementById('watchlist-queue-selected')?.addEventListener('click', () => {
                    this.queueSelectedWatchlistAlbums();
                });

                document.getElementById('watchlist-download-selected')?.addEventListener('click', () => {
                    this.downloadSelectedWatchlistAlbums();
                });

                document.getElementById('watchlist-mark-reviewed')?.addEventListener('click', () => {
                    this.markSelectedWatchlistAlbumsReviewed();
                });

                document.querySelectorAll('[data-save-schedule]').forEach((button) => {
                    button.addEventListener('click', () => {
                        this.saveMonitorSchedule(button.dataset.saveSchedule);
                    });
                });

                document.querySelectorAll('[data-schedule-mode-chip]').forEach((button) => {
                    button.addEventListener('click', () => {
                        this.setScheduleMode(button.dataset.scheduleModeChip, button.dataset.modeValue);
                    });
                });

                document.addEventListener('click', (event) => {
                    const target = event.target?.closest?.('[data-schedule-weekday-chip], [data-schedule-monthday-chip]');
                    if (!target) return;
                    target.classList.toggle('active');
                });

                document.querySelectorAll('[data-run-monitor-now]').forEach((button) => {
                    button.addEventListener('click', () => {
                        this.socket.emit('runMonitorNow', {kind: button.dataset.runMonitorNow});
                    });
                });

                document.getElementById('genres-refresh-current')?.addEventListener('click', () => {
                    this.refreshActiveGenrePage();
                });

                document.getElementById('genres-load-more')?.addEventListener('click', () => {
                    this.loadMoreActiveGenrePage();
                });
            }

            setupArtistDetailModal() {
                this.artistDetailModal = {
                    overlay: document.getElementById('artist-detail-overlay'),
                    closeBtn: document.getElementById('artist-detail-close'),
                    watchBtn: document.getElementById('artist-detail-watch'),
                    downloadBtn: document.getElementById('artist-detail-download'),
                    cover: document.getElementById('artist-detail-cover'),
                    title: document.getElementById('artist-detail-title'),
                    subtitle: document.getElementById('artist-detail-subtitle'),
                    kicker: document.getElementById('artist-detail-kicker'),
                    tracks: document.getElementById('artist-detail-tracks'),
                    albums: document.getElementById('artist-detail-albums'),
                    playlists: document.getElementById('artist-detail-playlists'),
                    tracksCount: document.getElementById('artist-detail-tracks-count'),
                    albumsCount: document.getElementById('artist-detail-albums-count'),
                    playlistsCount: document.getElementById('artist-detail-playlists-count'),
                };

                if (!this.artistDetailModal.overlay) return;

                this.artistDetailModal.closeBtn?.addEventListener('click', () => this.closeArtistDetail());
                this.artistDetailModal.overlay.addEventListener('click', (event) => {
                    if (event.target === this.artistDetailModal.overlay) {
                        this.closeArtistDetail();
                    }
                });
                this.artistDetailModal.downloadBtn?.addEventListener('click', () => {
                    if (!this.currentArtistData) return;
                    this.downloadDiscoveryItem(
                        this.currentArtistData.id,
                        'artist',
                        this.currentArtistData.service || this.currentService,
                    );
                });
                this.artistDetailModal.watchBtn?.addEventListener('click', () => {
                    if (!this.currentArtistData) return;
                    this.toggleWatchedArtist({
                        id: this.currentArtistData.id,
                        name: this.currentArtistData.title || this.currentArtistData.artist || 'Artist',
                        image: this.getCoverArtUrl(this.currentArtistData) || '',
                        service: this.currentArtistData.service || this.currentService,
                    });
                });
            }

            showArtistDetail(artistResult) {
                if (!artistResult || !artistResult.id || !this.artistDetailModal?.overlay) return;

                const service = artistResult.service || this.currentService;
                this.currentArtistData = {
                    ...artistResult,
                    service,
                    tracks: null,
                    albums: null,
                    playlists: null,
                    trackError: null,
                    albumError: null,
                    playlistError: null,
                };

                if (service !== this.currentService) {
                    this.switchService(service);
                }

                const coverUrl = this.getCoverArtUrl(artistResult);
                this.artistDetailModal.title.textContent = artistResult.title || 'Artist';
                this.artistDetailModal.subtitle.textContent = `${service.toUpperCase()} artist intelligence`;
                this.artistDetailModal.kicker.textContent = 'Artist Spotlight';
                this.artistDetailModal.cover.innerHTML = coverUrl
                    ? `<img src="${coverUrl}" alt="${this.escapeHtml(artistResult.title || 'Artist')}" loading="lazy">`
                    : '🎤';
                this.updateArtistDetailWatchButton();
                this.artistDetailModal.overlay.classList.add('show');

                ['tracks', 'albums', 'playlists'].forEach((section) => this.renderArtistDetailSection(section));

                this.socket.emit('getArtistTracks', {
                    service,
                    artistId: artistResult.id,
                    artistName: artistResult.title,
                    limit: 10,
                });
                this.socket.emit('getArtistAlbums', {
                    service,
                    artistId: artistResult.id,
                    artistName: artistResult.title,
                    limit: 12,
                });
                this.socket.emit('getArtistPlaylists', {
                    service,
                    artistId: artistResult.id,
                    artistName: artistResult.title,
                    limit: 8,
                });
            }

            closeArtistDetail() {
                if (this.artistDetailModal?.overlay) {
                    this.artistDetailModal.overlay.classList.remove('show');
                }
                this.currentArtistData = null;
            }

            updateArtistDetailWatchButton() {
                if (!this.artistDetailModal?.watchBtn || !this.currentArtistData) return;
                const watched = this.isArtistWatched(this.currentArtistData.id);
                this.artistDetailModal.watchBtn.classList.toggle('active', watched);
                this.artistDetailModal.watchBtn.title = watched ? 'Unwatch artist' : 'Watch artist';
                this.artistDetailModal.watchBtn.setAttribute('aria-label', watched ? 'Unwatch artist' : 'Watch artist');
            }

            renderArtistDetailSection(section) {
                if (!this.currentArtistData || !this.artistDetailModal) return;

                const map = {
                    tracks: {
                        items: this.currentArtistData.tracks,
                        error: this.currentArtistData.trackError,
                        container: this.artistDetailModal.tracks,
                        counter: this.artistDetailModal.tracksCount,
                    },
                    albums: {
                        items: this.currentArtistData.albums,
                        error: this.currentArtistData.albumError,
                        container: this.artistDetailModal.albums,
                        counter: this.artistDetailModal.albumsCount,
                    },
                    playlists: {
                        items: this.currentArtistData.playlists,
                        error: this.currentArtistData.playlistError,
                        container: this.artistDetailModal.playlists,
                        counter: this.artistDetailModal.playlistsCount,
                    },
                };

                const target = map[section];
                if (!target?.container) return;

                if (target.error) {
                    target.counter.textContent = 'Unavailable';
                    target.container.innerHTML = `<div class="artist-detail-empty">${this.escapeHtml(target.error)}</div>`;
                    return;
                }

                if (!Array.isArray(target.items)) {
                    target.counter.textContent = 'Loading…';
                    target.container.innerHTML = '<div class="artist-detail-empty">Loading this section…</div>';
                    return;
                }

                if (target.items.length === 0) {
                    target.counter.textContent = '0 loaded';
                    target.container.innerHTML = '<div class="artist-detail-empty">Nothing surfaced for this section yet.</div>';
                    return;
                }

                const actionIcons = {
                    play: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg>`,
                    queue: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h10"/><path d="M4 12h10"/><path d="M4 18h7"/><path d="M18 8v8"/><path d="M14 12h8"/></svg>`,
                    open: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>`,
                    download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`,
                };
                const buildActionButton = (action, sectionName, id, icon, title, extraClass = '') => `
                    <button class="discovery-action-btn-round artist-detail-action-btn ${extraClass}" type="button" title="${title}" aria-label="${title}" data-artist-action="${action}" data-artist-section="${sectionName}" data-artist-id="${this.escapeHtml(String(id))}">
                        ${icon}
                    </button>
                `;

                target.counter.textContent = `${target.items.length} loaded`;
                target.container.innerHTML = target.items
                    .map((item) => `
                        <div class="artist-detail-item artist-detail-item--${section}">
                            <div class="artist-detail-item-thumb">
                                ${this.getCoverArtUrl(item)
                                    ? `<img src="${this.getCoverArtUrl(item)}" alt="${this.escapeHtml(item.title || 'Artwork')}" loading="lazy">`
                                    : (section === 'tracks' ? '♪' : section === 'albums' ? '💿' : '📋')}
                            </div>
                            <div class="artist-detail-item-copy">
                                <strong>${this.escapeHtml(this.truncateText(item.title || item.name || 'Unknown', 42))}</strong>
                                <span>${this.escapeHtml(
                                    section === 'tracks'
                                        ? [item.artist || 'Unknown Artist', item.album || item.duration || 'Ready'].filter(Boolean).join(' • ')
                                        : (item.duration || item.artist || 'Ready')
                                )}</span>
                            </div>
                            <div class="artist-detail-item-actions">
                                ${section === 'tracks'
                                    ? buildActionButton('play', section, item.id, actionIcons.play, 'Play now', 'artist-detail-action-btn--primary')
                                    : buildActionButton('open', section, item.id, actionIcons.open, `Open ${section === 'albums' ? 'album' : 'playlist'}`, 'artist-detail-action-btn--primary')}
                                ${buildActionButton('queue', section, item.id, actionIcons.queue, 'Add to queue')}
                                ${buildActionButton('download', section, item.id, actionIcons.download, `Download ${section === 'tracks' ? 'track' : section === 'albums' ? 'album' : 'playlist'}`)}
                            </div>
                        </div>
                    `)
                    .join('');

                target.container.querySelectorAll('[data-artist-action]').forEach((button) => {
                    button.addEventListener('click', () => {
                        this.handleArtistDetailAction(
                            button.dataset.artistAction,
                            section,
                            button.dataset.artistId,
                        );
                    });
                });
            }

            handleArtistDetailAction(action, section, itemId) {
                if (!this.currentArtistData) return;

                const collection = this.currentArtistData[section] || [];
                const item = collection.find((entry) => String(entry.id) === String(itemId));
                if (!item) return;

                if (action === 'queue') {
                    if (section === 'tracks') {
                        this.addSingleToQueue(item);
                    } else {
                        this.addToQueue(item);
                    }
                    return;
                }

                if (action === 'download') {
                    this.downloadItem({
                        ...item,
                        service: item.service || this.currentArtistData.service,
                    });
                    return;
                }

                if (action === 'play' && section === 'tracks') {
                    this.playNow({
                        ...item,
                        service: item.service || this.currentArtistData.service,
                    });
                    return;
                }

                if (section === 'tracks') {
                    this.playNow({
                        ...item,
                        service: item.service || this.currentArtistData.service,
                    });
                    return;
                }

                if (section === 'albums') {
                    this.showAlbumModal({
                        ...item,
                        service: item.service || this.currentArtistData.service,
                    });
                    return;
                }

                if (section === 'playlists') {
                    this.showPlaylistModal({
                        ...item,
                        service: item.service || this.currentArtistData.service,
                    });
                }
            }
            
            switchHomeService(service) {
                if (this._switchingService) return;
                this.homeService = service;
                
                // Update home service buttons
                document.querySelectorAll('.home-service-btn').forEach(btn => {
                    btn.classList.remove('active');
                });
                document.querySelectorAll(`.home-service-btn[data-service="${service}"]`).forEach(btn => btn.classList.add('active'));
                
                // SYNC: Also update the main service selector in sidebar
                this.switchService(service);
                
                // Reload all discovery content with new service
                this.loadDiscoveryContent();
                this.renderFavoriteGenreSections();
                
                this.showNotification(`Switched to ${service.charAt(0).toUpperCase() + service.slice(1)} discovery`, 'success');
            }
            
            async loadDiscoveryContent() {
                try {
                    // Hide Deezer-only sections when browsing Qobuz
                    const deezerOnlyIds = ['top-tracks-grid','genre-pop-grid','genre-rap-grid','genre-jazz-grid'];
                    const hideDeezerOnly = (this.homeService === 'qobuz');
                    deezerOnlyIds.forEach(id => {
                        const sec = document.getElementById(id)?.closest('.discovery-section');
                        if (sec) sec.style.display = hideDeezerOnly ? 'none' : '';
                    });

                    const tasks = [
                        this.loadNewReleases(),
                        this.loadTrendingAlbums(),
                        this.loadPopularPlaylists(),
                        this.loadTopArtists(),
                    ];
                    if (this.homeService === 'deezer') {
                        tasks.push(this.loadTopTracks());
                        tasks.push(this.loadGenre('pop'));
                        tasks.push(this.loadGenre('rap'));
                        tasks.push(this.loadGenre('jazz'));
                    }
                    await Promise.all(tasks);
                } catch (error) {
                    console.error('Error loading discovery content:', error);
                    this.showNotification('Failed to load discovery content', 'error');
                }
            }
            
            async loadNewReleases() {
                const grid = document.getElementById('new-releases-grid');
                grid.innerHTML = '<div class="loading-placeholder"><div class="loading-spinner"></div><p>Loading new releases...</p></div>';
                
                try {
                    this.socket.emit('getDiscoveryContent', {
                        type: 'new-releases',
                        service: this.homeService,
                        limit: 18
                    });
                } catch (error) {
                    this.showDiscoveryError(grid, 'Failed to load new releases');
                }
            }
            
            async loadTrendingAlbums() {
                const grid = document.getElementById('trending-albums-grid');
                grid.innerHTML = '<div class="loading-placeholder"><div class="loading-spinner"></div><p>Loading trending albums...</p></div>';
                
                try {
                    this.socket.emit('getDiscoveryContent', {
                        type: 'trending-albums',
                        service: this.homeService,
                        limit: 18
                    });
                } catch (error) {
                    this.showDiscoveryError(grid, 'Failed to load trending albums');
                }
            }
            
            async loadPopularPlaylists() {
                const grid = document.getElementById('popular-playlists-grid');
                grid.innerHTML = '<div class="loading-placeholder"><div class="loading-spinner"></div><p>Loading popular playlists...</p></div>';
                
                try {
                    this.socket.emit('getDiscoveryContent', {
                        type: 'popular-playlists',
                        service: this.homeService,
                        limit: 24
                    });
                } catch (error) {
                    this.showDiscoveryError(grid, 'Failed to load popular playlists');
                }
            }

            async loadTopTracks() {
                const grid = document.getElementById('top-tracks-grid');
                if (!grid) return;
                grid.innerHTML = '<div class="loading-placeholder"><div class="loading-spinner"></div><p>Loading top tracks...</p></div>';
                try {
                    this.socket.emit('getDiscoveryContent', { type: 'top-tracks', service: this.homeService, limit: 18 });
                } catch (e) { this.showDiscoveryError(grid, 'Failed to load top tracks'); }
            }

            async loadGenre(slug) {
                const idMap = { 'pop': 'genre-pop', 'rap': 'genre-rap', 'jazz': 'genre-jazz' };
                const gid = idMap[slug];
                if (!gid) return;
                const grid = document.getElementById(`${gid}-grid`);
                if (!grid) return;
                grid.innerHTML = '<div class="loading-placeholder"><div class="loading-spinner"></div><p>Loading...</p></div>';
                try {
                    this.socket.emit('getDiscoveryContent', { type: gid, service: this.homeService, limit: 18 });
                } catch (e) { this.showDiscoveryError(grid, 'Failed to load genre'); }
            }
            
            async loadTopArtists() {
                const grid = document.getElementById('top-artists-grid');
                grid.innerHTML = '<div class="loading-placeholder"><div class="loading-spinner"></div><p>Loading top artists...</p></div>';
                
                try {
                    this.socket.emit('getDiscoveryContent', {
                        type: 'top-artists',
                        service: this.homeService,
                        limit: 12
                    });
                } catch (error) {
                    this.showDiscoveryError(grid, 'Failed to load top artists');
                }
            }
            
            showDiscoveryError(grid, message) {
                grid.innerHTML = `
                    <div class="loading-placeholder">
                        <div class="empty-state-icon">😕</div>
                        <p>${message}</p>
                        <button class="view-all-btn" onclick="app.loadDiscoveryContent()">Retry</button>
                    </div>
                `;
            }

            getDiscoveryCacheKey(service, type, id) {
                return `${service}:${type}:${String(id)}`;
            }

            getMobileHomeSectionMeta(type) {
                if (String(type || '').startsWith('favorite-genre:')) {
                    const genreId = String(type).split(':')[1];
                    const genre = (this.favoriteGenres || []).find((entry) => entry.id === genreId) || (this.availableFavoriteGenres || []).find((entry) => entry.id === genreId);
                    return {
                        title: `${genre?.label || 'Genre'} Focus`,
                        icon: null,
                        emoji: '◆',
                        action: () => this.showViewAllModal(`favorite-genre:${genreId}`, 'qobuz'),
                    };
                }

                const map = {
                    'new-releases': {
                        title: 'New Releases',
                        icon: '/assets/icons/mobile/home-new-releases.svg',
                        action: () => this.searchNewReleases(),
                    },
                    'trending-albums': {
                        title: 'Trending Albums',
                        icon: '/assets/icons/mobile/home-trending.svg',
                        action: () => this.searchTrendingAlbums(),
                    },
                    'popular-playlists': {
                        title: 'Popular Playlists',
                        icon: '/assets/icons/mobile/home-playlists.svg',
                        action: () => this.searchPopularPlaylists(),
                    },
                    'top-tracks': {
                        title: 'Top Tracks',
                        icon: '/assets/icons/mobile/home-featured.svg',
                        action: () => this.showViewAllModal('top-tracks', this.homeService),
                    },
                    'genre-pop': {
                        title: 'Pop Highlights',
                        icon: null,
                        emoji: '🎵',
                        action: () => this.showViewAllModal('genre-pop', this.homeService),
                    },
                    'genre-rap': {
                        title: 'Hip-Hop Highlights',
                        icon: null,
                        emoji: '🎤',
                        action: () => this.showViewAllModal('genre-rap', this.homeService),
                    },
                    'genre-jazz': {
                        title: 'Jazz Highlights',
                        icon: null,
                        emoji: '🎷',
                        action: () => this.showViewAllModal('genre-jazz', this.homeService),
                    },
                    'top-artists': {
                        title: 'Top Artists',
                        icon: '/assets/icons/mobile/home-top-artists.svg',
                        action: () => this.searchTopArtists(),
                    },
                };

                return map[type] || { title: 'Discover', icon: null, action: null };
            }

            ensureMobileHomeRowHeader(grid, type) {
                const section = grid?.closest('.discovery-section');
                if (!section) return;

                const meta = this.getMobileHomeSectionMeta(type);
                let rowHeader = section.querySelector('.mobile-home-row-header');
                if (!rowHeader) {
                    rowHeader = document.createElement('div');
                    rowHeader.className = 'mobile-home-row-header';
                    section.insertBefore(rowHeader, grid);
                }

                const iconMarkup = meta.icon
                    ? `<span class="section-icon section-icon-mask" style="--section-icon:url('${meta.icon}');" aria-hidden="true"></span>`
                    : `<span class="section-icon">${meta.emoji || '🎵'}</span>`;

                rowHeader.innerHTML = `
                    <div class="mobile-home-row-title">
                        <div class="section-title">
                            ${iconMarkup}
                            ${meta.title}
                        </div>
                    </div>
                    <div class="mobile-home-row-actions"></div>
                `;
            }

            ensureMobileHomeViewAll(grid, type) {
                this.ensureMobileHomeRowHeader(grid, type);
            }

            createMobileHomeViewAllCard(type) {
                const meta = this.getMobileHomeSectionMeta(type);
                const card = document.createElement('button');
                card.type = 'button';
                card.className = 'mobile-home-card mobile-home-view-all-card';
                card.innerHTML = `
                    <div class="mobile-home-view-all-card-inner">
                        <div class="mobile-home-view-all-copy">
                            <span class="mobile-home-view-all-kicker">More</span>
                            <strong>View All</strong>
                            <span>${meta.title}</span>
                        </div>
                        <span class="mobile-home-view-all-arrow" aria-hidden="true">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="m9 18 6-6-6-6"/>
                            </svg>
                        </span>
                    </div>
                `;
                if (meta.action) {
                    card.addEventListener('click', (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        meta.action();
                    });
                }
                return card;
            }
             
            displayDiscoveryContent(data) {
                const { type, service, items } = data;
                let gridId = '';
                
                switch(type) {
                    case 'new-releases':
                        gridId = 'new-releases-grid';
                        break;
                    case 'trending-albums':
                        gridId = 'trending-albums-grid';
                        break;
                    case 'popular-playlists':
                        gridId = 'popular-playlists-grid';
                        break;
                    case 'top-tracks':
                        gridId = 'top-tracks-grid';
                        break;
                    case 'genre-pop':
                        gridId = 'genre-pop-grid';
                        break;
                    case 'genre-rap':
                        gridId = 'genre-rap-grid';
                        break;
                    case 'genre-jazz':
                        gridId = 'genre-jazz-grid';
                        break;
                    case 'top-artists':
                        gridId = 'top-artists-grid';
                        break;
                    default:
                        return;
                }
                
                const grid = document.getElementById(gridId);
                const isMobileHome = document.body.classList.contains('mobile-shell') && grid?.closest('#home-page');
                if (grid) {
                    grid.classList.toggle('mobile-home-rail', !!isMobileHome);
                }
                grid.innerHTML = '';
                
                if (!items || items.length === 0) {
                    grid.innerHTML = `
                        <div class="loading-placeholder">
                            <div class="empty-state-icon">🎵</div>
                            <p>No ${type.replace('-', ' ')} found</p>
                        </div>
                    `;
                    return;
                }
                
                items.forEach(item => {
                    const cacheKey = this.getDiscoveryCacheKey(service, item.type, item.id);
                    this.discoveryCache.set(cacheKey, {
                        ...item,
                        service,
                    });
                    const card = isMobileHome
                        ? this.createMobileHomeDiscoveryCard(item, service)
                        : this.createDiscoveryCard(item, service);
                    grid.appendChild(card);
                });

                if (isMobileHome) {
                    this.ensureMobileHomeViewAll(grid, type);
                    grid.appendChild(this.createMobileHomeViewAllCard(type));
                }

                if (isMobileHome && window.__elixiumMobileShell?.initHorizontalRail) {
                    requestAnimationFrame(() => {
                        window.__elixiumMobileShell.initHorizontalRail(grid);
                    });
                }
            }

createMobileHomeDiscoveryCard(item, service = this.homeService) {
    const card = document.createElement('div');
    card.className = `mobile-home-card ${item.type === 'artist' ? 'artist-card' : ''}`;
    card.dataset.id = item.id;
    card.dataset.type = item.type;
    card.dataset.service = service;

    const coverUrl = this.getCoverArtUrl(item);
    const cacheKey = this.getDiscoveryCacheKey(service, item.type, item.id);

    const iconButton = (className, title, body) => `
        <button class="discovery-action-btn-round ${className}" type="button" title="${title}" aria-label="${title}">
            ${body}
        </button>
    `;

    const downloadIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7,10 12,15 17,10"/>
        <line x1="12" x2="12" y1="15" y2="3"/>
    </svg>`;

    const tracksIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 18V5l12-2v13"/>
        <circle cx="6" cy="18" r="3"/>
        <circle cx="18" cy="16" r="3"/>
    </svg>`;

    let masterQualityBadgeHTML = '';
    if (service === 'qobuz' && (item.type === 'track' || item.type === 'album')) {
        const qualityData = item.rawData || item;
        const hasMasterQuality = (qualityData.maximum_bit_depth >= 24 && qualityData.maximum_sampling_rate >= 48000) ||
            qualityData.hires || qualityData.hires_streamable;
        if (hasMasterQuality) {
            masterQualityBadgeHTML = `<img src="https://play.qobuz.com/resources/8.0.0-b010/2ce51090358ad1deda72.png" class="qobuz-master-badge-discovery" alt="Master Quality">`;
        }
    }

    const actions = document.createElement('div');
    actions.className = 'mobile-home-card-actions';

    const appendAction = (button, handler) => {
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            handler();
        });
        actions.appendChild(button);
    };

    if (item.type === 'artist') {
        const exploreBtn = document.createElement('button');
        exploreBtn.className = 'discovery-action-btn-round tracks';
        exploreBtn.type = 'button';
        exploreBtn.title = 'Explore Artist';
        exploreBtn.setAttribute('aria-label', 'Explore Artist');
        exploreBtn.innerHTML = tracksIcon;
        appendAction(exploreBtn, () => this.openDiscoveryArtist(String(item.id), service));

        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'discovery-action-btn-round download';
        downloadBtn.type = 'button';
        downloadBtn.title = 'Download';
        downloadBtn.setAttribute('aria-label', 'Download');
        downloadBtn.innerHTML = downloadIcon;
        appendAction(downloadBtn, () => this.downloadDiscoveryItem(String(item.id), item.type, service));
    } else if (item.type === 'album' || item.type === 'playlist') {
        const playBtn = document.createElement('button');
        playBtn.className = 'discovery-action-btn-round play-now-btn';
        playBtn.type = 'button';
        playBtn.title = 'Play';
        playBtn.setAttribute('aria-label', 'Play');
        appendAction(playBtn, () => this.playDiscoveryItem(String(item.id), item.type, service));

        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'discovery-action-btn-round download';
        downloadBtn.type = 'button';
        downloadBtn.title = 'Download';
        downloadBtn.setAttribute('aria-label', 'Download');
        downloadBtn.innerHTML = downloadIcon;
        appendAction(downloadBtn, () => this.downloadDiscoveryItem(String(item.id), item.type, service));

        const tracksBtn = document.createElement('button');
        tracksBtn.className = 'discovery-action-btn-round tracks';
        tracksBtn.type = 'button';
        tracksBtn.title = 'View Tracks';
        tracksBtn.setAttribute('aria-label', 'View Tracks');
        tracksBtn.innerHTML = tracksIcon;
        appendAction(tracksBtn, () => this.viewDiscoveryTracks(String(item.id), item.type, service));
    } else {
        const playBtn = document.createElement('button');
        playBtn.className = 'discovery-action-btn-round play-now-btn';
        playBtn.type = 'button';
        playBtn.title = 'Play';
        playBtn.setAttribute('aria-label', 'Play');
        appendAction(playBtn, () => this.playDiscoveryItem(String(item.id), 'track', service));

        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'discovery-action-btn-round download';
        downloadBtn.type = 'button';
        downloadBtn.title = 'Download';
        downloadBtn.setAttribute('aria-label', 'Download');
        downloadBtn.innerHTML = downloadIcon;
        appendAction(downloadBtn, () => this.downloadDiscoveryItem(String(item.id), 'track', service));

        const queueBtn = document.createElement('button');
        queueBtn.className = 'discovery-action-btn-round queue-all-btn';
        queueBtn.type = 'button';
        queueBtn.title = 'Add to Queue';
        queueBtn.setAttribute('aria-label', 'Add to Queue');
        appendAction(queueBtn, () => {
            const cached = this.discoveryCache.get(cacheKey);
            if (cached) this.addSingleToQueue(cached);
        });
    }

    card.innerHTML = `
        <div class="mobile-home-card-cover">
            ${masterQualityBadgeHTML}
            ${coverUrl
                ? `<img src="${coverUrl}" alt="${item.title}" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                   <div class="result-cover-placeholder" style="display:none;">🎵</div>`
                : `<div class="result-cover-placeholder">🎵</div>`}
        </div>
        <div class="mobile-home-card-info">
            <div class="mobile-home-card-title">${this.truncateText(item.title, 36)}</div>
            <div class="mobile-home-card-artist">${this.truncateText(item.artist || 'Unknown Artist', 28)}</div>
        </div>
    `;

    card.appendChild(actions);
    return card;
}
            
createDiscoveryCard(item, service = this.homeService) {
    const card = document.createElement('div');
    card.className = `discovery-card ${item.type === 'artist' ? 'artist-card' : ''}`;
    card.dataset.id = item.id;
    card.dataset.type = item.type;
    card.dataset.service = service;
    
    const coverUrl = this.getCoverArtUrl(item);
    
    // SVG icons for different types
    const typeIcons = {
        track: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 18V5l12-2v13"/>
                    <circle cx="6" cy="18" r="3"/>
                    <circle cx="18" cy="16" r="3"/>
                </svg>`,
        album: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <circle cx="12" cy="12" r="3"/>
                </svg>`,
        artist: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    <line x1="12" x2="12" y1="19" y2="23"/>
                    <line x1="8" x2="16" y1="23" y2="23"/>
                </svg>`,
        playlist: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="8" x2="21" y1="6" y2="6"/>
                    <line x1="8" x2="21" y1="12" y2="12"/>
                    <line x1="8" x2="21" y1="18" y2="18"/>
                    <line x1="3" x2="3.01" y1="6" y2="6"/>
                    <line x1="3" x2="3.01" y1="12" y2="12"/>
                    <line x1="3" x2="3.01" y1="18" y2="18"/>
                </svg>`
    };
    
    // Download icon SVG
    const downloadIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7,10 12,15 17,10"/>
                            <line x1="12" x2="12" y1="15" y2="3"/>
                          </svg>`;
    
    // Tracks icon SVG  
    const tracksIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M9 18V5l12-2v13"/>
                          <circle cx="6" cy="18" r="3"/>
                          <circle cx="18" cy="16" r="3"/>
                        </svg>`;
    
    let actionsHTML = '';
    if (item.type === 'artist') {
        actionsHTML = `
            <div class="discovery-card-actions">
                <button class="discovery-action-btn-round tracks" onclick="app.openDiscoveryArtist('${item.id}', '${service}')" title="Explore Artist">
                    ${tracksIcon}
                </button>
                <button class="discovery-action-btn-round download" onclick="app.downloadDiscoveryItem('${item.id}', '${item.type}', '${service}')" title="Download">
                    ${downloadIcon}
                </button>
            </div>
        `;
    } else if (item.type === 'album' || item.type === 'playlist') {
        actionsHTML = `
            <div class="discovery-card-actions">
                <button class="discovery-action-btn-round play-now-btn" onclick="app.playDiscoveryItem('${item.id}', '${item.type}', '${service}')" title="Play"></button>
                <button class="discovery-action-btn-round download" onclick="app.downloadDiscoveryItem('${item.id}', '${item.type}', '${service}')" title="Download">
                    ${downloadIcon}
                </button>
                <button class="discovery-action-btn-round tracks" onclick="app.viewDiscoveryTracks('${item.id}', '${item.type}', '${service}')" title="View Tracks">
                    ${tracksIcon}
                </button>
            </div>
        `;
    } else if (item.type === 'track') {
        actionsHTML = `
            <div class="discovery-card-actions">
                <button class="discovery-action-btn-round play-now-btn" onclick="app.playDiscoveryItem('${item.id}', 'track', '${service}')" title="Play"></button>
                <button class="discovery-action-btn-round more-btn" title="More"></button>
                <button class="discovery-action-btn-round download" onclick="app.downloadDiscoveryItem('${item.id}', 'track', '${service}')" title="Download">
                    ${downloadIcon}
                </button>
            </div>
        `;
    } else {
        actionsHTML = `
            <div class="discovery-card-actions">
                <button class="discovery-action-btn-round download" onclick="app.downloadDiscoveryItem('${item.id}', '${item.type}', '${service}')" title="Download">
                    ${downloadIcon}
                </button>
            </div>
        `;
    }
    
    // Check if item meets master quality requirements for Qobuz
    let masterQualityBadgeHTML = '';
    if (service === 'qobuz' && (item.type === 'track' || item.type === 'album')) {
        // Quality data is stored in rawData for discovery items
        const qualityData = item.rawData || item;
        const hasMasterQuality = (qualityData.maximum_bit_depth >= 24 && qualityData.maximum_sampling_rate >= 48000) || 
                                qualityData.hires || qualityData.hires_streamable;
        if (hasMasterQuality) {
            masterQualityBadgeHTML = `<img src="https://play.qobuz.com/resources/8.0.0-b010/2ce51090358ad1deda72.png" class="qobuz-master-badge-discovery" alt="Master Quality">`;
        }
    }

    card.innerHTML = `
        <div class="discovery-card-cover">
            ${masterQualityBadgeHTML}
            ${coverUrl ? 
                `<img src="${coverUrl}" alt="${item.title}" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                 <div class="result-cover-placeholder" style="display:none;">${typeIcons[item.type] || typeIcons.track}</div>` :
                `<div class="result-cover-placeholder">${typeIcons[item.type] || typeIcons.track}</div>`
            }
        </div>
        <div class="discovery-card-info">
            <div class="discovery-card-title">${this.truncateText(item.title, 30)}</div>
            <div class="discovery-card-artist">${this.truncateText(item.artist, 25)}</div>
            ${actionsHTML}
        </div>
    `;
    
    // Wire + button menu for tracks (Add to Queue / Add to Playlist)
    try {
        if (item.type === 'track') {
            const plusBtn = card.querySelector('.more-btn');
            if (plusBtn) {
                plusBtn.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    if (document.querySelector('.action-menu')) document.querySelectorAll('.action-menu').forEach(n=>n.remove());
                    const menu = document.createElement('div');
                    menu.className = 'action-menu';
                    const addQ = document.createElement('button'); addQ.textContent = 'Add to Queue';
                    const addP = document.createElement('button'); addP.textContent = 'Add to Playlist…';
                    menu.appendChild(addQ); menu.appendChild(addP);
                    document.body.appendChild(menu);
                    const rect = plusBtn.getBoundingClientRect();
                    menu.style.left = Math.min(window.innerWidth - 200, rect.left) + 'px';
                    menu.style.top = (rect.bottom + 6) + 'px';
                    const cleanup = () => { try { menu.remove(); } catch{} window.removeEventListener('click', outside, true); };
                    const outside = (e) => { if (!menu.contains(e.target)) cleanup(); };
                    setTimeout(()=>window.addEventListener('click', outside, true), 0);
                    addQ.addEventListener('click', () => { try { app.addSingleToQueue && app.addSingleToQueue(item); } catch{} cleanup(); });
                    addP.addEventListener('click', () => { try { app.addTrackToPlaylist && app.addTrackToPlaylist(item); } catch{} cleanup(); });
                });
            }
        }
    } catch{}

    return card;
}

            downloadDiscoveryItem(id, type, service) {
                const cachedResult = this.discoveryCache.get(this.getDiscoveryCacheKey(service, type, id));
                const discoveryCard = document.querySelector(`[data-id="${id}"][data-type="${type}"][data-service="${service}"]`);
                const result = cachedResult || {
                    id,
                    type,
                    title: discoveryCard?.querySelector('.discovery-card-title')?.textContent || 'Discovery Item',
                    artist: discoveryCard?.querySelector('.discovery-card-artist')?.textContent || 'Various Artists',
                    service
                };
                
                // Ensure we're using the correct service
                if (service !== this.currentService) {
                    this.debug(`Switching service from ${this.currentService} to ${service} for discovery download`);
                    this.switchService(service);
                }
                
                this.downloadItem(result);
                this.showNotification('Starting download...', 'success');
            }

            // Helper: add a single track to queue (avoid dup)
            addSingleToQueue(item) {
                try {
                    if (!this.playQueue) this.playQueue = [];
                    const svc = this.currentService || item.service || 'deezer';
                    const tid = item && (item.id || item.SNG_ID);
                    if (!tid) { this.showNotification('Cannot queue item (missing id)','warning'); return; }
                    const exists = this.playQueue.find(x => String(x.id)===String(tid) && (x.service||svc)===(item.service||svc));
                    if (!exists) {
                        this.playQueue.push({ id: String(tid), title: item.title||'Unknown', artist: item.artist||'', album: item.album||'', service: svc, type: 'track', rawData: item.rawData||{} });
                        this.persistQueue && this.persistQueue();
                        this.showNotification('Added to queue', 'success');
                        const overlay = document.getElementById('player-fs-overlay');
                        if (overlay && overlay.classList.contains('show')) this.renderFullQueue();
                    } else {
                        this.showNotification('Already in queue', 'info');
                    }
                } catch (e) { this.showNotification('Failed to add to queue', 'error'); }
            }

            // Helper: add track to playlist via picker dialog
            addTrackToPlaylist(item) { try { this.showPlaylistPicker(item); } catch(_e){} }
            
            viewDiscoveryTracks(id, type, service) {
                const cachedResult = this.discoveryCache.get(this.getDiscoveryCacheKey(service, type, id));
                let result = cachedResult;

                if (!result) {
                    const discoveryCard = document.querySelector(`[data-id="${id}"][data-type="${type}"][data-service="${service}"]`);
                    const title = discoveryCard?.querySelector('.discovery-card-title')?.textContent || 'Discovery Item';
                    const artist = discoveryCard?.querySelector('.discovery-card-artist')?.textContent || 'Various Artists';
                    result = {
                        id,
                        type,
                        title,
                        artist,
                        service,
                        rawData: {
                            id,
                            title
                        },
                    };
                }
                
                // Ensure we're using the correct service
                if (service !== this.currentService) {
                    this.debug(`Switching service from ${this.currentService} to ${service} for viewing tracks`);
                    this.switchService(service);
                }
                
                if (type === 'album') {
                    this.showAlbumModal(result);
                } else if (type === 'playlist') {
                    this.showPlaylistModal(result);
                }
            }

            openDiscoveryArtist(id, service) {
                const cachedResult = this.discoveryCache.get(this.getDiscoveryCacheKey(service, 'artist', id));
                const discoveryCard = document.querySelector(`[data-id="${id}"][data-type="artist"][data-service="${service}"]`);
                const result = cachedResult || {
                    id,
                    type: 'artist',
                    title: discoveryCard?.querySelector('.discovery-card-title')?.textContent || 'Artist',
                    artist: discoveryCard?.querySelector('.discovery-card-artist')?.textContent || 'Artist',
                    service,
                    rawData: {
                        id,
                    },
                };

                this.showArtistDetail(result);
            }
            
            extractCoverHashFromUrl(url) {
                if (!url) return '';
                
                // Extract hash from Deezer CDN URL like: https://cdn-images.dzcdn.net/images/cover/hash/size.jpg
                const hashMatch = url.match(/\/images\/(?:cover|artist)\/([a-f0-9]{32})\//);
                return hashMatch ? hashMatch[1] : '';
            }
            
            searchNewReleases() {
                this.showViewAllModal('new-releases', this.homeService);
            }
            
            searchTrendingAlbums() {
                this.showViewAllModal('trending-albums', this.homeService);
            }
            
            searchPopularPlaylists() {
                this.showViewAllModal('popular-playlists', this.homeService);
            }
            
            searchTopArtists() {
                this.showViewAllModal('top-artists', this.homeService);
            }

            // --- Playlists (MVP) ---
            initPlaylistsUI() {
                try {
                    const grid = document.getElementById('playlists-grid');
                    if (grid) this.renderPlaylistsGrid();
                    const btnNew = document.getElementById('pl-new');
                    const btnSave = document.getElementById('pl-save-queue');
                    if (btnNew) btnNew.addEventListener('click', () => this.promptCreatePlaylist());
                    if (btnSave) btnSave.addEventListener('click', () => this.saveQueueAsPlaylistPrompt());
                } catch {}
            }

            loadPlaylistsFromStorage() {
                try { const raw = localStorage.getItem('user.playlists.v1'); this.playlists = raw ? JSON.parse(raw) : []; if (!Array.isArray(this.playlists)) this.playlists = []; } catch { this.playlists = []; }
            }
            persistPlaylists() { try { localStorage.setItem('user.playlists.v1', JSON.stringify(this.playlists || [])); } catch {} }
            promptCreatePlaylist() { const name = prompt('Playlist name'); if (!name) return; this.createPlaylist(name.trim()); }
            createPlaylist(name) { const pl = { id: 'pl-' + Date.now(), name: name || 'My Playlist', createdAt: Date.now(), updatedAt: Date.now(), items: [] }; this.playlists.push(pl); this.persistPlaylists(); this.renderPlaylistsGrid(); this.showNotification('Playlist created','success'); }
            saveQueueAsPlaylistPrompt() { if (!this.playQueue || this.playQueue.length===0){ this.showNotification('Queue is empty','warning'); return;} const name = prompt('Save queue as playlist name'); if(!name) return; const items=(this.playQueue||[]).map(x=>({...x})); const pl={ id:'pl-'+Date.now(), name:name.trim(), createdAt:Date.now(), updatedAt:Date.now(), items}; this.playlists.push(pl); this.persistPlaylists(); this.renderPlaylistsGrid(); this.showNotification('Saved queue as playlist','success'); }
            renderPlaylistsGrid() {
                this.renderSessionDeck();
                const grid=document.getElementById('playlists-grid'); if(!grid) return; grid.innerHTML=''; const data=this.playlists||[]; if(data.length===0){ grid.innerHTML='<div class="loading-placeholder"><div class="empty-state-icon">📂</div><p>No playlists yet</p></div>'; return; }
                data.forEach(pl=>{ const card=document.createElement('div'); card.className='discovery-card playlist-card'; const first=(pl.items||[])[0]; const cov= first ? (this.getCoverArtUrl(first)||'') : ''; card.innerHTML = `
                    <div class="discovery-card-cover">${cov ? `<img src="${cov}" alt="">` : '<div class="result-cover-placeholder">🎶</div>'}</div>
                    <div class="discovery-card-info">
                        <div class="discovery-card-title" title="${pl.name}">${this.truncateText(pl.name,30)}</div>
                        <div class="discovery-card-artist">${(pl.items||[]).length} track(s)</div>
                        <div class="discovery-card-actions">
                            <button class="discovery-action-btn-round play-now-btn" title="Play" data-act="play" data-id="${pl.id}"></button>
                            <button class="discovery-action-btn-round queue-all-btn" title="Add to Queue" data-act="enqueue" data-id="${pl.id}"></button>
                            <button class="discovery-action-btn-round download" title="Download All" data-act="download" data-id="${pl.id}"></button>
                            <button class="discovery-action-btn-round btn-rename" title="Rename" data-act="rename" data-id="${pl.id}"></button>
                            <button class="discovery-action-btn-round btn-delete" title="Delete" data-act="delete" data-id="${pl.id}"></button>
                        </div>
                    </div>`; card.querySelectorAll('[data-act]').forEach(btn=>{ btn.addEventListener('click', (e)=>{ e.stopPropagation(); const act=btn.getAttribute('data-act'); const id=btn.getAttribute('data-id'); this.handlePlaylistAction(act,id); }); }); grid.appendChild(card); });
                // Double-click to open tracks view
                grid.querySelectorAll('.playlist-card').forEach(el => { el.addEventListener('dblclick', () => { const id = (this.playlists || [])[Array.prototype.indexOf.call(grid.children, el)]?.id; if (id) this.openUserPlaylistView(id); }); });
            }
            async handlePlaylistAction(act,id){ const pl=(this.playlists||[]).find(p=>String(p.id)===String(id)); if(!pl) return; if(act==='delete'){ this.playlists=this.playlists.filter(p=>p!==pl); this.persistPlaylists(); this.renderPlaylistsGrid(); return;} if(act==='rename'){ const nn=prompt('Rename playlist',pl.name); if(!nn) return; pl.name=nn.trim(); pl.updatedAt=Date.now(); this.persistPlaylists(); this.renderPlaylistsGrid(); return;} if(act==='enqueue'){ if(!this.playQueue) this.playQueue=[]; let added=0; const svc=this.currentService||'deezer'; (pl.items||[]).forEach(t=>{ const exists=this.playQueue.find(x=>String(x.id)===String(t.id)&&(x.service||svc)===(t.service||svc)); if(!exists){ this.playQueue.push({...t}); added++; } }); this.persistQueue&&this.persistQueue(); this.showNotification(`${added} track(s) added to queue`,'success'); return;} if(act==='play'){ this.playQueue=(pl.items||[]).map(t=>({...t})); this.nowPlayingIndex=this.playQueue.length?0:-1; this.persistQueue(); if(this.nowPlayingIndex>=0) this._loadAndPlayCurrent(); this.showNotification(`Playing: ${pl.name}`,'success'); return;} if(act==='download'){ try{ if(!pl.items||pl.items.length===0){ this.showNotification('Playlist is empty','warning'); return; } const playlistItem={ id:`user-playlist-${pl.id}`, title:pl.name, artist:`${pl.items.length} tracks`, type:'playlist', service:'user-playlist', playlistData:pl, tracks:pl.items, rawData:pl }; this.downloadItem(playlistItem); this.showNotification(`Playlist "${pl.name}" added to downloads`,'success'); } catch(e){ console.error('Playlist download error:',e); this.showNotification('Failed to start playlist download','error'); } return; } }

            openUserPlaylistView(id){ try{ const pl=(this.playlists||[]).find(p=>String(p.id)===String(id)); if(!pl) return; const mask=document.getElementById('user-pl-view'); const title=document.getElementById('user-pl-title'); const body=document.getElementById('user-pl-body'); const btnPlay=document.getElementById('user-pl-play'); const btnEnq=document.getElementById('user-pl-enqueue'); const btnDl=document.getElementById('user-pl-download'); const btnClose=document.getElementById('user-pl-close'); if(title) title.textContent = `${pl.name} (${(pl.items||[]).length})`; if(body){ body.innerHTML=''; (pl.items||[]).forEach((t,idx)=>{ const row=document.createElement('div'); row.className='overlay-list-item'; row.innerHTML = `<div style="min-width:0;">${this.truncateText(`${t.title} — ${t.artist||''}`, 64)}</div><div style="display:flex; gap:6px;"> <button class="btn" data-act="play" data-i="${idx}">Play</button> <button class="btn" data-act="enqueue" data-i="${idx}">+ Queue</button> <button class="btn" data-act="download" data-i="${idx}">⬇</button> </div>`; row.querySelectorAll('button').forEach(b=>{ b.addEventListener('click', async (e)=>{ const act=b.getAttribute('data-act'); const i=Number(b.getAttribute('data-i')); const tr=pl.items[i]; if(!tr) return; if(act==='play'){ this.playQueue=[...pl.items.map(x=>({...x}))]; this.nowPlayingIndex=i; this.persistQueue(); this._loadAndPlayCurrent(); } else if(act==='enqueue'){ this.addSingleToQueue(tr); } else if(act==='download'){ if(this.downloadToClient) await this.downloadTrackToClient(tr); else this.downloadItem(tr); } }); }); body.appendChild(row); }); }
                if(btnPlay) btnPlay.onclick = ()=>{ this.handlePlaylistAction('play', id); };
                if(btnEnq) btnEnq.onclick = ()=>{ this.handlePlaylistAction('enqueue', id); };
                if(btnDl) btnDl.onclick = async ()=>{ await this.handlePlaylistAction('download', id); };
                if(btnClose) btnClose.onclick = ()=>{ mask.classList.remove('show'); };
                mask.classList.add('show');
                // Ensure each row has a delete (X) button with handler
                try{
                    if (body) {
                        var rows = body.querySelectorAll('.overlay-list-item');
                        for (var r=0; r<rows.length; r++){
                            (function(row, idx){
                                if (!row.querySelector('[data-act="remove"]')){
                                    var wrap = row.querySelector('div[style*="display:flex"]') || row.lastElementChild;
                                    if (wrap){
                                        var del = document.createElement('button');
                                        del.className = 'btn';
                                        del.setAttribute('data-act','remove');
                                        del.setAttribute('data-i', String(idx));
                                        del.addEventListener('click', function(ev){
                                            ev.stopPropagation();
                                            try {
                                                pl.items.splice(idx,1);
                                                pl.updatedAt = Date.now();
                                                if (typeof window.app.persistPlaylists === 'function') window.app.persistPlaylists();
                                                if (typeof window.app.renderPlaylistsGrid === 'function') window.app.renderPlaylistsGrid();
                                            } catch(_) {}
                                            if (window.app && window.app.openUserPlaylistView) window.app.openUserPlaylistView(id);
                                        });
                                        wrap.appendChild(del);
                                    }
                                }
                            })(rows[r], r);
                        }
                    }
                }catch(_e){}
                }catch(_e){}
            }

            // Open playlist picker dialog to choose/create a playlist for adding a track
            showPlaylistPicker(forItem){ try{ const mask=document.getElementById('pl-picker'); const list=document.getElementById('pl-picker-list'); const input=document.getElementById('pl-picker-new'); const create=document.getElementById('pl-picker-create'); const cancel=document.getElementById('pl-picker-cancel'); const close=document.getElementById('pl-picker-close'); if(!mask||!list) return; list.innerHTML=''; const pls=this.playlists||[]; pls.forEach(pl=>{ const row=document.createElement('div'); row.className='overlay-list-item'; row.textContent = `${pl.name} (${(pl.items||[]).length})`; row.addEventListener('click', ()=>{ this.addTrackToNamedPlaylist(forItem, pl.name); mask.classList.remove('show'); }); list.appendChild(row); }); if(create){ create.onclick = ()=>{ const nm=(input.value||'').trim(); if(!nm) { this.showNotification('Enter a name','warning'); return; } this.addTrackToNamedPlaylist(forItem, nm); mask.classList.remove('show'); }; } const hide=()=>{ mask.classList.remove('show'); }; if(cancel) cancel.onclick = hide; if(close) close.onclick = hide; mask.classList.add('show'); }catch(_e){} }
            addTrackToNamedPlaylist(item, name){ try{ if(!name) return; let pl=(this.playlists||[]).find(p=>p.name.toLowerCase()===name.toLowerCase()); if(!pl){ pl={ id:'pl-'+Date.now(), name:name.trim(), createdAt:Date.now(), updatedAt:Date.now(), items:[] }; this.playlists.push(pl); }
                const svc=this.currentService||item.service||'deezer'; const exists=(pl.items||[]).find(x=>String(x.id)===String(item.id)&&(x.service||svc)===(item.service||svc)); if(!exists){ pl.items.push({ id:String(item.id), title:item.title||'Unknown', artist:item.artist||'', album:item.album||'', service:svc, type:'track', rawData:item.rawData||{} }); pl.updatedAt=Date.now(); this.persistPlaylists(); this.renderPlaylistsGrid(); this.showNotification('Added to playlist','success'); } else { this.showNotification('Already in playlist','info'); } }catch(_e){ this.showNotification('Failed to add to playlist','error'); } }
            navigateToPage(page) {
                // update sidebar active state safely
                document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
                const navBtn = document.querySelector(`[data-page="${page}"]`);
                if (navBtn) navBtn.classList.add('active');

                // Special case: virtual Player page opens the fullscreen overlay
                if (page === 'player') {
                    this.showFullPlayer();
                    // don't try to toggle a '.page' panel that doesn't exist
                    return;
                }

                // normal pages
                document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
                const target = document.getElementById(page + '-page');
                if (target) target.classList.add('active');

                const titles = {
                    home: 'Home',
                    search: 'Search Music',
                    downloads: 'Downloads',
                    watchlist: 'Watchlist',
                    genres: 'Genres',
                    'url-download': 'URL Download',
                    settings: 'Settings',
                    playlists: 'Playlists'
                };
                if (titles[page]) {
                    const titleEl = document.getElementById('page-title');
                    if (titleEl) titleEl.textContent = titles[page];
                }

                this.currentPage = page;
                this.updateMiniRailActiveState(page);

                if (page === 'home') {
                    setTimeout(() => this.loadDiscoveryContent(), 100);
                    this.loadWatchlistState();
                    this.refreshWatchlist();
                }

                if (page === 'watchlist') {
                    this.loadWatchlistState();
                    this.refreshWatchlist();
                }

                if (page === 'genres') {
                    this.loadFavoriteGenres();
                    this.renderGenresPage();
                    if (this.activeGenrePageId) {
                        this.refreshActiveGenrePage();
                    }
                }

                localStorage.setItem('elixium-current-page', page);
            }

            switchService(service) {
                if (this._switchingService) return;
                if (this.currentService === service && this.homeService === service) return;
                this._switchingService = true;
                this.currentService = service;
                this.homeService = service;
                
                // Clear album tracks cache when switching services
                this.albumTracksCache.clear();
                this.playlistTracksCache.clear();
                
                document.querySelectorAll('.service-btn').forEach(btn => {
                    btn.classList.remove('active');
                });
                document.querySelector(`.service-btn[data-service="${service}"]`)?.classList.add('active');

                // SYNC: Also update home service buttons if they exist
                const homeServiceBtns = document.querySelectorAll('.home-service-btn');
                if (homeServiceBtns.length > 0) {
                    homeServiceBtns.forEach(btn => btn.classList.remove('active'));
                    document.querySelectorAll(`.home-service-btn[data-service="${service}"]`).forEach(btn => btn.classList.add('active'));
                }                
                
                document.getElementById('current-service').textContent = 
                    service.charAt(0).toUpperCase() + service.slice(1);
                
                // Update quality context immediately for new service
                this.currentQuality = (service === 'deezer') ? (this.qualitySettings.deezer || '320') : (this.qualitySettings.qobuz || '44khz');
                this.updateQualityOptions();
                // this.clearResults();
                
                this.socket.emit('serviceChange', { service });

                // If we're on home page, reload discovery content
                if (this.currentPage === 'home') {
                    this.loadDiscoveryContent();
                }
                
                this.renderSessionDeck();
                this.showNotification(`Switched to ${service.charAt(0).toUpperCase() + service.slice(1)}`, 'success');
                localStorage.setItem('elixium-selected-service', service);
                this._switchingService = false;
            }

            updateQualityOptions() {
                const qualityContainer = document.getElementById('quality-options');
                qualityContainer.innerHTML = '';
                
                let qualities = [];
                if (this.currentService === 'deezer') {
                    qualities = [
                        { value: '128', label: '128' },
                        { value: '320', label: '320' },
                        { value: 'flac', label: 'FLAC' }
                    ];
                } else {
                    qualities = [
                        { value: '320kbps', label: '320' },
                        { value: '44khz', label: 'CD' },
                        { value: '96khz', label: 'Hi-Fi' },
                        { value: '192khz', label: 'Studio' }
                    ];
                }
                
                // Get saved quality for current service
                const savedQuality = this.qualitySettings[this.currentService];
                let qualityToSelect = savedQuality;
                
                // Verify the saved quality exists for current service
                const qualityExists = qualities.some(q => q.value === savedQuality);
                if (!qualityExists) {
                    // Fall back to default if saved quality doesn't exist
                    qualityToSelect = this.currentService === 'deezer' ? '320' : '44khz';
                    this.debugWarn(`Saved quality "${savedQuality}" not valid for ${this.currentService}, using "${qualityToSelect}"`);
                }
                
                qualities.forEach((quality) => {
                    const option = document.createElement('button');
                    option.className = 'filter-btn';
                    option.dataset.quality = quality.value;
                    option.textContent = quality.label;
                    
                    // Set active quality
                    if (quality.value === qualityToSelect) {
                        option.classList.add('active');
                        this.currentQuality = quality.value;
                    }
                    
                    option.addEventListener('click', () => {
                        // Remove active from all options
                        document.querySelectorAll('[data-quality]').forEach(opt => {
                            opt.classList.remove('active');
                        });
                        
                        // Set this option as active
                        option.classList.add('active');
                        this.currentQuality = quality.value;
                        
                        // Save quality setting for current service
                        this.qualitySettings[this.currentService] = quality.value;
                        this.saveQualitySettings();
                        
                        // SYNC WITH DROPDOWN: Update the settings dropdown to match
                        const dropdownId = this.currentService === 'deezer' ? 'deezer-quality' : 'qobuz-quality';
                        const dropdown = document.getElementById(dropdownId);
                        if (dropdown) {
                            dropdown.value = quality.value;
                        }
                        
                        this.renderSessionDeck();
                        this.debug(`Quality changed to ${quality.value} for ${this.currentService}`);
                    });
                    
                    qualityContainer.appendChild(option);
                });
                
                // SYNC WITH DROPDOWN: Make sure the settings dropdown matches the current selection
                const dropdownId = this.currentService === 'deezer' ? 'deezer-quality' : 'qobuz-quality';
                const dropdown = document.getElementById(dropdownId);
                if (dropdown && dropdown.value !== qualityToSelect) {
                    dropdown.value = qualityToSelect;
                }
                this.renderSessionDeck();
            }

            updateQualityFromSettings() {
                // Update UI to reflect loaded quality settings
                const savedQuality = this.qualitySettings[this.currentService];
                
                // Update active button
                document.querySelectorAll('[data-quality]').forEach(opt => {
                    opt.classList.remove('active');
                });
                
                const savedButton = document.querySelector(`[data-quality="${savedQuality}"]`);
                if (savedButton) {
                    savedButton.classList.add('active');
                    this.currentQuality = savedQuality;
                    this.debug(`Restored quality: ${savedQuality} for ${this.currentService}`);
                }
            }

            performSearch() {
                const query = document.getElementById('search-input').value.trim();
                if (!query) return;
                
                this.showSearchLoading();
                this.searchPageSize = this.searchPageSize || 50;
                this.searchOffset = 0;
                this.searchAppendRequested = false;
                this.lastSearchRequestOffset = 0;
                this.searchQuery = query;
                this.searchType = this.currentSearchType;

                localStorage.setItem('elixium-last-search', query);
                this.saveRecentSearch(query);
                
                this.socket.emit('search', {
                    query,
                    service: this.currentService,
                    type: this.currentSearchType,
                    limit: this.searchPageSize,
                    offset: 0
                });
            }

            async loadQualitySettings() {
                try {
                    // Request quality settings from backend
                    this.socket.emit('getQualitySettings');
                    
                    // Wait for response (handled in socket listener)
                    await new Promise((resolve) => {
                        const handler = (settings) => {
                            this.qualitySettings = settings;
                            this.qualitySettingsLoaded = true;
                            this.socket.off('qualitySettings', handler);
                            resolve(settings);
                        };
                        this.socket.on('qualitySettings', handler);
                        
                        // Timeout after 2 seconds
                        setTimeout(() => {
                            this.socket.off('qualitySettings', handler);
                            this.debugWarn('Quality settings not loaded from backend, using defaults');
                            this.qualitySettingsLoaded = true;
                            resolve(this.qualitySettings);
                        }, 2000);
                    });
                    
                    this.debug('Quality settings loaded:', this.qualitySettings);
                } catch (error) {
                    this.debugError('Failed to load quality settings:', error);
                    this.qualitySettingsLoaded = true; // Continue with defaults
                }
            }

            saveQualitySettings() {
                try {
                    // Save to backend
                    this.socket.emit('saveQualitySettings', this.qualitySettings);
                    
                    // Also save to localStorage as backup
                    localStorage.setItem('elixium-quality-settings', JSON.stringify(this.qualitySettings));
                    
                    this.debug('Quality settings saved:', this.qualitySettings);
                } catch (error) {
                    this.debugError('Failed to save quality settings:', error);
                }
            }
            
            loadQualitySettingsFromLocalStorage() {
                try {
                    const saved = localStorage.getItem('elixium-quality-settings');
                    if (saved) {
                        const parsed = JSON.parse(saved);
                        this.qualitySettings = {
                            deezer: parsed.deezer || '320',
                            qobuz: parsed.qobuz || '44khz'
                        };
                        this.debug('Loaded quality settings from localStorage:', this.qualitySettings);
                    }
                } catch (error) {
                    this.debugError('Failed to load quality settings from localStorage:', error);
                }
            }

            syncDownloadStatusWithBackend() {
                // Only sync if we have downloads in queue
                if (this.downloadQueue.length > 0) {
                    this.debug('Syncing download status with backend...');
                    
                    // Ask backend for current status of all downloads
                    this.socket.emit('getDownloadStatus', {
                        queueItems: this.downloadQueue.map(item => ({
                            id: item.id,
                            title: item.title,
                            status: item.status
                        }))
                    });
                }
            }

            updateProgressPanelState() {
                const panel = document.getElementById('progress-panel');
                const toggleBtn = document.getElementById('progress-toggle-btn');
                const miniFill = document.getElementById('mini-progress-fill');
                const miniText = document.getElementById('mini-progress-text');
                
                // Count download states
                const downloadingCount = this.downloadQueue.filter(item => item.status === 'downloading').length;
                const completedCount = this.downloadQueue.filter(item => item.status === 'completed').length;
                const totalCount = this.downloadQueue.length;
                
                // Remove all state classes
                panel.classList.remove('downloading', 'completed');
                toggleBtn.classList.remove('downloading', 'completed');
                if (miniFill) miniFill.classList.remove('downloading', 'completed');
                if (miniText) miniText.classList.remove('downloading', 'completed');
                
                // Apply appropriate state
                if (downloadingCount > 0) {
                    // Currently downloading
                    panel.classList.add('downloading');
                    toggleBtn.classList.add('downloading');
                    if (miniFill) miniFill.classList.add('downloading');
                    if (miniText) miniText.classList.add('downloading');
                } else if (completedCount > 0 && completedCount === totalCount && totalCount > 0) {
                    // All completed
                    panel.classList.add('completed');
                    toggleBtn.classList.add('completed');
                    if (miniFill) miniFill.classList.add('completed');
                    if (miniText) miniText.classList.add('completed');
                    
                    // Auto-remove completed state after a few seconds
                    setTimeout(() => {
                        panel.classList.remove('completed');
                        toggleBtn.classList.remove('completed');
                        if (miniFill) miniFill.classList.remove('completed');
                        if (miniText) miniText.classList.remove('completed');
                    }, 3000);
                }
            }

            showSearchLoading() {
                const searchBtn = document.getElementById('search-btn');
                const btnText = searchBtn.querySelector('.btn-text');
                const loading = searchBtn.querySelector('.loading-spinner');
                // Keep text hidden for compact icon button; only show spinner
                if (btnText) btnText.style.display = 'none';
                if (loading) loading.style.display = 'inline-block';
                searchBtn.classList.add('loading');
                searchBtn.disabled = true;
            }

            hideSearchLoading() {
                const searchBtn = document.getElementById('search-btn');
                const btnText = searchBtn.querySelector('.btn-text');
                const loading = searchBtn.querySelector('.loading-spinner');
                // Keep text hidden to preserve icon-only layout
                if (btnText) btnText.style.display = 'none';
                if (loading) loading.style.display = 'none';
                searchBtn.classList.remove('loading');
                searchBtn.disabled = false;
            }

            displayResults(results, options = {}) {
                const append = Boolean(options.append);
                const grid = document.getElementById('results-grid');
                const resultsCount = document.getElementById('results-count');

                const nextResults = Array.isArray(results) ? results : [];
                const mergedResults = append
                    ? [
                        ...(this.searchResults || []),
                        ...nextResults.filter((result) => {
                            const identity = this.getQueueIdentity({
                                id: result?.id,
                                type: result?.type,
                                service: result?.service || this.currentService,
                            });
                            return !(this.searchResults || []).some((entry) => {
                                const entryIdentity = this.getQueueIdentity({
                                    id: entry?.id,
                                    type: entry?.type,
                                    service: entry?.service || this.currentService,
                                });
                                return entryIdentity === identity;
                            });
                        }),
                    ]
                    : nextResults;

                this.searchResults = mergedResults;
                resultsCount.textContent = `${mergedResults.length} results found`;

                if (!append) {
                    grid.innerHTML = '';
                }

                localStorage.setItem('elixium-search-results', JSON.stringify(mergedResults));

                if (!mergedResults.length) {
                    grid.innerHTML = `
                        <div class="empty-state">
                            <div class="empty-state-icon">😕</div>
                            <h3>No Results Found</h3>
                            <p>Try adjusting your search terms or browse different content types</p>
                        </div>
                    `;
                    return;
                }

                nextResults.forEach(result => {
                    const item = this.createResultItem(result);
                    grid.appendChild(item);
                });
            }

            initializeProgressPanel() {
                const panel = document.getElementById('progress-panel');
                const miniIndicator = document.getElementById('mini-progress-indicator');
                const container = document.querySelector('.downloads-container');
                const arrow = panel.querySelector('.toggle-arrow');
                const toggleText = panel.querySelector('.toggle-text');
                
                if (this.progressPanelCollapsed) {
                    panel.classList.add('collapsed');
                    miniIndicator.style.display = 'flex';
                    container.classList.add('progress-collapsed');
                    arrow.textContent = '▶';
                    toggleText.textContent = 'Show Progress';
                } else {
                    arrow.textContent = '▼';
                    toggleText.textContent = 'Progress';
                }
            }
            
            toggleProgressPanel() {
                const panel = document.getElementById('progress-panel');
                const miniIndicator = document.getElementById('mini-progress-indicator');
                const arrow = panel.querySelector('.toggle-arrow');
                const container = document.querySelector('.downloads-container');
                
                this.progressPanelCollapsed = !this.progressPanelCollapsed;
                
                if (this.progressPanelCollapsed) {
                    panel.classList.add('collapsed');
                    miniIndicator.style.display = 'flex';
                    arrow.textContent = '▶';
                    container.classList.add('progress-collapsed');
                    
                    // Update toggle button text for collapsed state
                    const toggleText = panel.querySelector('.toggle-text');
                    toggleText.textContent = 'Show Progress';
                } else {
                    panel.classList.remove('collapsed');
                    miniIndicator.style.display = 'none';
                    arrow.textContent = '▼';
                    container.classList.remove('progress-collapsed');
                    
                    // Update toggle button text for expanded state
                    const toggleText = panel.querySelector('.toggle-text');
                    toggleText.textContent = 'Progress';
                }
                
                // Save state to localStorage
                localStorage.setItem('progressPanelCollapsed', this.progressPanelCollapsed.toString());
                
                // Add a nice feedback animation
                panel.style.transform = 'scale(0.98)';
                setTimeout(() => {
                    panel.style.transform = 'scale(1)';
                }, 150);
            }

            createResultItem(result) {
                const item = document.createElement('div');
                item.className = 'result-item';
                item.dataset.type = result.type; // Add this for styling
                item.dataset.id = result.id;
                const isMobileShell = document.body.classList.contains('mobile-shell');
                
                if (this.currentView === 'list') {
                    item.classList.add('list-view');
                }
                
                // SVG icons for different types
                const typeIcons = {
                    track: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M9 18V5l12-2v13"/>
                                <circle cx="6" cy="18" r="3"/>
                                <circle cx="18" cy="16" r="3"/>
                            </svg>`,
                    album: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"/>
                                <circle cx="12" cy="12" r="3"/>
                            </svg>`,
                    artist: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                                <line x1="12" x2="12" y1="19" y2="23"/>
                                <line x1="8" x2="16" y1="23" y2="23"/>
                            </svg>`,
                    playlist: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="8" x2="21" y1="6" y2="6"/>
                                <line x1="8" x2="21" y1="12" y2="12"/>
                                <line x1="8" x2="21" y1="18" y2="18"/>
                                <line x1="3" x2="3.01" y1="6" y2="6"/>
                                <line x1="3" x2="3.01" y1="12" y2="12"/>
                                <line x1="3" x2="3.01" y1="18" y2="18"/>
                            </svg>`
                };
            
                // Tracks icon SVG  
                const tracksIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                      <path d="M9 18V5l12-2v13"/>
                                      <circle cx="6" cy="18" r="3"/>
                                      <circle cx="18" cy="16" r="3"/>
                                    </svg>`;
            
                // Detail icons
                const detailIcons = {
                    type: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                             <circle cx="12" cy="12" r="10"/>
                             <circle cx="12" cy="12" r="3"/>
                           </svg>`,
                    duration: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                 <circle cx="12" cy="12" r="10"/>
                                 <polyline points="12,6 12,12 16,14"/>
                               </svg>`,
                    year: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                             <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                             <line x1="16" x2="16" y1="2" y2="6"/>
                             <line x1="8" x2="8" y1="2" y2="6"/>
                             <line x1="3" x2="21" y1="10" y2="10"/>
                           </svg>`,
                    album: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <circle cx="12" cy="12" r="10"/>
                              <circle cx="12" cy="12" r="3"/>
                            </svg>`
                };
            
                // Get cover art URL
                const coverUrl = this.getCoverArtUrl(result);
                
                // Get Qobuz quality information
                const qobuzQuality = this.getQobuzQualityInfo(result);
                
                
                // Check if this item is currently downloading
                const isDownloading = this.downloadQueue.find(item => item.id === result.id && item.status === 'downloading');
                const isCompleted = this.downloadQueue.find(item => item.id === result.id && item.status === 'completed');
                
                if (isDownloading) {
                    item.classList.add('downloading');
                }
                
                let innerHTML = `
                    <div class="result-cover">
                        ${coverUrl ? 
                            `<img src="${coverUrl}" alt="${result.title}" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                             <div class="result-cover-placeholder" style="display:none;">${typeIcons[result.type] || typeIcons.track}</div>` :
                            `<div class="result-cover-placeholder">${typeIcons[result.type] || typeIcons.track}</div>`
                        }
                        ${qobuzQuality.masterBadge}
                    </div>
                    <div class="result-info">
                        <div class="result-content">
                            <div class="result-title">${this.truncateText(result.title, this.currentView === 'list' ? 50 : 55)}</div>
                            <div class="result-artist">${this.truncateText(result.artist, this.currentView === 'list' ? 35 : 40)}</div>
                            ${qobuzQuality.qualityText ? `<div class="qobuz-quality-info">${qobuzQuality.qualityText}</div>` : ''}
                            ${this.currentView === 'grid' ? `
                            <div class="result-details">
                                <div class="result-detail">
                                    ${detailIcons.type}
                                    <span>${result.type}</span>
                                </div>
                                ${result.duration ? `
                                <div class="result-detail">
                                    ${detailIcons.duration}
                                    <span>${result.duration}</span>
                                </div>` : ''}
                                ${result.year ? `
                                <div class="result-detail">
                                    ${detailIcons.year}
                                    <span>${result.year}</span>
                                </div>` : ''}
                                ${result.album && result.type === 'track' ? `
                                <div class="result-detail">
                                    ${detailIcons.album}
                                    <span title="${result.album}">${this.truncateText(result.album, 18)}</span>
                                </div>` : ''}
                            </div>` : ''}
                        </div>
                        <div class="result-actions">
                            ${this.getDownloadButtonHTML(result, isDownloading, isCompleted)}
                            ${result.type === 'album' ? `<button class="discovery-action-btn-round tracks view-tracks-btn" title="View Tracks">${tracksIcon}</button>` : ''}
                            ${result.type === 'playlist' ? `<button class="discovery-action-btn-round tracks view-playlist-tracks-btn" title="View Tracks">${tracksIcon}</button>` : ''}
                        </div>
                    </div>
                `;
                
                item.innerHTML = innerHTML;
                
                // Add download button event listener
                const downloadBtn = item.querySelector('.download-btn');
                if (downloadBtn) {
                    downloadBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        const clientToggle = document.getElementById('client-downloads');
                        const toClient = clientToggle ? clientToggle.checked : this.downloadToClient;
                        const service = this.currentService;
                        const quality = service === 'deezer' ? (this.qualitySettings.deezer || '320') : (this.qualitySettings.qobuz || '44khz');
                        try {
                          if (!toClient) return this.downloadItem(result);
                          if (result.type === 'track') {
                            return await this.downloadTrackToClient(result);
                          }
                          if (result.type === 'album') {
                            const cacheKey = `${service}_${result.id}`;
                            const ensureTracks = async () => new Promise((resolve) => {
                              const have = this.albumTracksCache && this.albumTracksCache.get(cacheKey);
                              if (have && have.tracks && have.tracks.length) return resolve(have);
                              const handler = (tracksData) => {
                                if (tracksData && String(tracksData.albumId) === String(result.id)) {
                                  this.socket.off && this.socket.off('albumTracks', handler);
                                  resolve(tracksData);
                                }
                              };
                              this.socket.on && this.socket.on('albumTracks', handler);
                              this.socket.emit('getAlbumTracks', { albumId: result.id, service, albumData: result });
                            });
                            const tracksData = await ensureTracks();
                            const tracks = tracksData?.tracks || [];
                            if (!tracks.length) return this.showNotification('Album tracks not available', 'error');
                            const itemIds = tracks.map(t => String(t.id || t.SNG_ID)).filter(Boolean);
                            const zipName = `${this.buildSafeName(result.artist||'Artist')} - ${this.buildSafeName(result.title||'Album')}.zip`;
                            const jobId = `zip-${service}-album-${result.id}-${Date.now()}`;
                            const queueItem = { id: jobId, title: zipName, artist: result.artist, album: result.title, type: 'zip', status: 'downloading', startTime: new Date(), endTime: null };
                            this.downloadQueue.push(queueItem); this.updateQueueUI();
                            const resp = await fetch('/api/download-zip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service, itemIds, quality, structure: 'album', zipName, jobId }) });
                            if (!resp.ok) throw new Error('ZIP request failed');
                            const blob = await this.readStreamWithProgress(resp, jobId);
                            const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = zipName; document.body.appendChild(a); a.click(); URL.revokeObjectURL(a.href); a.remove();
                            return this.showNotification('Album ZIP downloading in browser', 'success');
                          }
                          if (result.type === 'playlist') {
                            const cacheKey = `${service}_playlist_${result.id}`;
                            const ensureTracks = async () => new Promise((resolve) => {
                              const have = this.playlistTracksCache && this.playlistTracksCache.get(cacheKey);
                              if (have && have.tracks && have.tracks.length) return resolve(have);
                              const handler = (tracksData) => {
                                if (tracksData && String(tracksData.playlistId) === String(result.id)) {
                                  this.socket.off && this.socket.off('playlistTracks', handler);
                                  resolve(tracksData);
                                }
                              };
                              this.socket.on && this.socket.on('playlistTracks', handler);
                              this.socket.emit('getPlaylistTracks', { playlistId: result.id, service, playlistData: result });
                            });
                            const tracksData = await ensureTracks();
                            const tracks = tracksData?.tracks || [];
                            if (!tracks.length) return this.showNotification('Playlist tracks not available', 'error');
                            const itemIds = tracks.map(t => String(t.id || t.SNG_ID)).filter(Boolean);
                            const zipName = `${this.buildSafeName(result.title||'Playlist')}.zip`;
                            const jobId = `zip-${service}-playlist-${result.id}-${Date.now()}`;
                            const queueItem = { id: jobId, title: zipName, artist: result.artist, album: result.title, type: 'zip', status: 'downloading', startTime: new Date(), endTime: null };
                            this.downloadQueue.push(queueItem); this.updateQueueUI();
                            const resp = await fetch('/api/download-zip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service, itemIds, quality, structure: 'album', zipName, jobId }) });
                            if (!resp.ok) throw new Error('ZIP request failed');
                            const blob = await this.readStreamWithProgress(resp, jobId);
                            const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = zipName; document.body.appendChild(a); a.click(); URL.revokeObjectURL(a.href); a.remove();
                            return this.showNotification('Playlist ZIP downloading in browser', 'success');
                          }
                          // Fallback
                          return this.downloadItem(result);
                        } catch (err) {
                          console.error('Client ZIP download failed:', err);
                          this.showNotification('Client ZIP failed; using server download', 'warning');
                          return this.downloadItem(result);
                        }
                    });
                }
            
                // Add view tracks button event listener (for albums)
                const viewTracksBtn = item.querySelector('.view-tracks-btn');
                if (viewTracksBtn) {
                    viewTracksBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.showAlbumModal(result);
                    });
                }
            
                const viewPlaylistTracksBtn = item.querySelector('.view-playlist-tracks-btn');
                if (viewPlaylistTracksBtn) {
                    viewPlaylistTracksBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.showPlaylistModal(result);
                    });
                }

                if (isMobileShell && result.type === 'artist') {
                    const actions = item.querySelector('.result-actions');
                    if (actions && !actions.querySelector('.view-artist-btn')) {
                        const exploreBtn = document.createElement('button');
                        exploreBtn.className = 'discovery-action-btn-round tracks view-artist-btn';
                        exploreBtn.title = 'Explore Artist';
                        exploreBtn.innerHTML = tracksIcon;
                        actions.appendChild(exploreBtn);
                        exploreBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            if (window.openArtistModal) {
                                window.openArtistModal({
                                    id: result.id,
                                    name: result.title || result.artist || 'Artist',
                                    cover: coverUrl || '',
                                });
                            } else {
                                this.showArtistDetail(result);
                            }
                        });
                    }
                }
                
                // Add double-click event for albums
                if (result.type === 'album') {
                    item.addEventListener('dblclick', (e) => {
                        e.preventDefault();
                        this.showAlbumModal(result);
                    });
                }
                // Add Play and + for album/playlist
                if (result.type === 'album' || result.type === 'playlist') {
                    const actions = item.querySelector('.result-actions');
                    if (actions) {
                        if (!isMobileShell) {
                            const playAllBtn = document.createElement('button');
                            playAllBtn.className = 'discovery-action-btn-round play-now-btn';
                            playAllBtn.title = 'Play';
                            playAllBtn.addEventListener('click', (e) => {
                                e.stopPropagation();
                                if (result.type === 'album') this.playAlbumNow(result);
                                else this.playPlaylistNow(result);
                            });
                            actions.appendChild(playAllBtn);
                        }
                        const addAllBtn = document.createElement('button');
                        addAllBtn.className = 'discovery-action-btn-round queue-all-btn';
                        addAllBtn.title = 'Add All to Queue';
                        addAllBtn.textContent = '+';
                        actions.appendChild(addAllBtn);
                        addAllBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            if (result.type === 'album') this.addAlbumToQueue(result);
                            else this.addPlaylistToQueue(result);
                        });
                    }
                }
                // Inject Play and Queue for tracks
                if (result.type === 'track') {
                    const actions = item.querySelector('.result-actions');
                    if (actions) {
                        const playBtn = document.createElement('button');
                        playBtn.className = 'discovery-action-btn-round play-now-btn';
                        playBtn.title = 'Play';
                        playBtn.textContent = '▶';
                        const moreBtn = document.createElement('button');
                        moreBtn.className = 'discovery-action-btn-round more-btn';
                        moreBtn.title = 'More';
                        // attach data for robust delegation
                        [playBtn, moreBtn].forEach(btn => {
                            btn.setAttribute('data-id', String(result.id));
                            btn.setAttribute('data-title', result.title || '');
                            btn.setAttribute('data-artist', result.artist || '');
                            btn.setAttribute('data-service', this.currentService || 'deezer');
                        });
                        actions.appendChild(playBtn);
                        actions.appendChild(moreBtn);
                        playBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const itemData = { id: result.id, title: result.title, artist: result.artist, album: result.album, service: this.currentService, type: 'track', rawData: result.rawData };
                            this.playNow(itemData);
                        });
                        moreBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            try {
                                document.querySelectorAll('.action-menu').forEach(n=>{ try{n.remove();}catch(_){}});
                                const menu = document.createElement('div');
                                menu.className = 'action-menu';
                                const addQ = document.createElement('button'); addQ.textContent = 'Add to Queue';
                                const addP = document.createElement('button'); addP.textContent = 'Add to Playlist…';
                                menu.appendChild(addQ); menu.appendChild(addP);
                                document.body.appendChild(menu);
                                const rect = moreBtn.getBoundingClientRect();
                                menu.style.left = Math.min(window.innerWidth - 200, rect.left) + 'px';
                                menu.style.top = (rect.bottom + 6) + 'px';
                                const cleanup = () => { try { menu.remove(); } catch(_){} window.removeEventListener('click', outside, true); };
                                const outside = (ev2) => { if (!menu.contains(ev2.target)) cleanup(); };
                                setTimeout(()=>window.addEventListener('click', outside, true),0);
                                const data = { id: String(result.id), title: result.title, artist: result.artist, album: result.album||'', service: this.currentService||'deezer', type: 'track', rawData: result.rawData||{} };
                                addQ.addEventListener('click', ()=>{ try { this.addSingleToQueue(data); } finally { cleanup(); } });
                                addP.addEventListener('click', ()=>{ try { this.addTrackToPlaylist(data); } finally { cleanup(); } });
                            } catch {}
                        });
                    }
                }

                if (isMobileShell) {
                    if (result.type === 'album') {
                        item.addEventListener('click', (e) => {
                            if (e.target.closest('.result-actions')) return;
                            this.showAlbumModal(result);
                        });
                    } else if (result.type === 'playlist') {
                        item.addEventListener('click', (e) => {
                            if (e.target.closest('.result-actions')) return;
                            this.showPlaylistModal(result);
                        });
                    } else if (result.type === 'artist') {
                        item.addEventListener('click', (e) => {
                            if (e.target.closest('.result-actions')) return;
                            if (window.openArtistModal) {
                                window.openArtistModal({
                                    id: result.id,
                                    name: result.title || result.artist || 'Artist',
                                    cover: coverUrl || '',
                                });
                            } else {
                                this.showArtistDetail(result);
                            }
                        });
                    }
                }
            
                // Add double-click event for playlists
                if (result.type === 'playlist') {
                    item.addEventListener('dblclick', (e) => {
                        e.preventDefault();
                        this.showPlaylistModal(result);
                    });
                }                
                
                return item;
            }

            // Enqueue all tracks from an album
            addAlbumToQueue(albumResult) {
                try {
                    const cacheKey = `${this.currentService}_${albumResult.id}`;
                    const proceed = (tracksData) => {
                        const tracks = (tracksData && tracksData.tracks) ? tracksData.tracks : [];
                        if (!this.playQueue) this.playQueue = [];
                        let added = 0;
                        tracks.forEach((t, idx) => {
                            const id = String(t.SNG_ID || t.id || `${albumResult.id}_${idx+1}`);
                            const title = t.SNG_TITLE || t.title || 'Unknown';
                            const artist = t.ART_NAME || (t.performer && t.performer.name) || albumResult.artist || '';
                            const album = t.ALB_TITLE || (t.album && t.album.title) || albumResult.title || '';
                            const svc = this.currentService || 'deezer';
                            const exists = this.playQueue.find(x => String(x.id) === id && (x.service||'') === svc);
                            if (!exists) {
                                this.playQueue.push({id, title, artist, album, service: svc, type: 'track', rawData: t});
                                added++;
                            }
                        });
                        this.persistQueue && this.persistQueue();
                        if (added > 0) this.showNotification(`${added} track(s) added to queue`, 'success');
                        const overlay = document.getElementById('player-fs-overlay');
                        if (overlay && overlay.classList.contains('show')) this.renderFullQueue();
                    };
                    if (this.albumTracksCache && this.albumTracksCache.has(cacheKey)) {
                        proceed(this.albumTracksCache.get(cacheKey));
                    } else {
                        const onTracks = (tracksData) => {
                            if (tracksData && String(tracksData.albumId) === String(albumResult.id)) {
                                this.socket.off && this.socket.off('albumTracks', onTracks);
                                proceed(tracksData);
                            }
                        };
                        if (this.socket && this.socket.on) this.socket.on('albumTracks', onTracks);
                        this.socket.emit('getAlbumTracks', { albumId: albumResult.id, service: this.currentService, albumData: albumResult });
                    }
                } catch (e) {
                    console.error('Add album to queue failed:', e);
                    this.showNotification('Failed to add album to queue', 'error');
                }
            }

            // Play album now (enqueue then start at first new track)
            async playAlbumNow(albumResult) {
                const startAt = this.playQueue ? this.playQueue.length : 0;
                const before = startAt;
                const onDone = () => {
                    if ((this.playQueue?.length || 0) > before) {
                        this.nowPlayingIndex = before;
                        this.persistQueue && this.persistQueue();
                        this._loadAndPlayCurrent && this._loadAndPlayCurrent();
                    }
                };
                const cacheKey = `${this.currentService}_${albumResult.id}`;
                const proceed = (tracksData) => {
                    let tracks = (tracksData && tracksData.tracks) ? tracksData.tracks : [];
                    // Guard against malformed entries (e.g., nulls, album stubs) that create ghost rows
                    tracks = tracks.filter(t => t && (t.SNG_ID || t.id));
                    if (!this.playQueue) this.playQueue = [];
                    tracks.forEach((t, idx) => {
                        const id = String(t.SNG_ID || t.id || `${albumResult.id}_${idx+1}`);
                        const title = t.SNG_TITLE || t.title || 'Unknown';
                        const artist = t.ART_NAME || (t.performer && t.performer.name) || albumResult.artist || '';
                        const album = t.ALB_TITLE || (t.album && t.album.title) || albumResult.title || '';
                        const svc = this.currentService || 'deezer';
                        const exists = this.playQueue.find(x => String(x.id) === id && (x.service||'') === svc);
                        if (!exists) this.playQueue.push({id, title, artist, album, service: svc, type: 'track', rawData: t});
                    });
                    this.persistQueue && this.persistQueue();
                    onDone();
                };
                if (this.albumTracksCache && this.albumTracksCache.has(cacheKey)) proceed(this.albumTracksCache.get(cacheKey));
                else {
                    const onTracks = (tracksData) => {
                        if (tracksData && String(tracksData.albumId) === String(albumResult.id)) {
                            this.socket.off && this.socket.off('albumTracks', onTracks);
                            proceed(tracksData);
                        }
                    };
                    if (this.socket && this.socket.on) this.socket.on('albumTracks', onTracks);
                    this.socket.emit('getAlbumTracks', { albumId: albumResult.id, service: this.currentService, albumData: albumResult });
                }
            }

            // Play playlist now (enqueue then start at first new track)
            async playPlaylistNow(playlistResult) {
                const startAt = this.playQueue ? this.playQueue.length : 0;
                const before = startAt;
                const onDone = () => {
                    if ((this.playQueue?.length || 0) > before) {
                        this.nowPlayingIndex = before;
                        this.persistQueue && this.persistQueue();
                        this._loadAndPlayCurrent && this._loadAndPlayCurrent();
                    }
                };
                const cacheKey = `${this.currentService}_playlist_${playlistResult.id}`;
                const proceed = (tracksData) => {
                    let tracks = (tracksData && tracksData.tracks) ? tracksData.tracks : [];
                    tracks = tracks.filter(t => t && (t.SNG_ID || t.id));
                    if (!this.playQueue) this.playQueue = [];
                    tracks.forEach((t, idx) => {
                        const id = String(t.SNG_ID || t.id || `${playlistResult.id}_${idx+1}`);
                        const title = t.SNG_TITLE || t.title || 'Unknown';
                        const artist = t.ART_NAME || (t.performer && t.performer.name) || playlistResult.artist || '';
                        const album = t.ALB_TITLE || (t.album && t.album.title) || '';
                        const svc = this.currentService || 'deezer';
                        const exists = this.playQueue.find(x => String(x.id) === id && (x.service||'') === svc);
                        if (!exists) this.playQueue.push({id, title, artist, album, service: svc, type: 'track', rawData: t});
                    });
                    this.persistQueue && this.persistQueue();
                    onDone();
                };
                if (this.playlistTracksCache && this.playlistTracksCache.has(cacheKey)) proceed(this.playlistTracksCache.get(cacheKey));
                else {
                    const onTracks = (tracksData) => {
                        if (tracksData && String(tracksData.playlistId) === String(playlistResult.id)) {
                            this.socket.off && this.socket.off('playlistTracks', onTracks);
                            proceed(tracksData);
                        }
                    };
                    if (this.socket && this.socket.on) this.socket.on('playlistTracks', onTracks);
                    this.socket.emit('getPlaylistTracks', { playlistId: playlistResult.id, service: this.currentService, playlistData: playlistResult });
                }
            }

            // Discovery play handler
            playDiscoveryItem(id, type, service) {
                if (service && this.currentService !== service) {
                    this.debug(`Switching service from ${this.currentService} to ${service} for discovery play`);
                    this.switchService(service);
                }
                const activeService = service || this.currentService;
                const cachedResult = this.discoveryCache.get(this.getDiscoveryCacheKey(activeService, type, id));
                const card = document.querySelector(`[data-id="${id}"][data-type="${type}"][data-service="${activeService}"]`);
                const title = cachedResult?.title || card?.querySelector('.discovery-card-title')?.textContent || '';
                const artist = cachedResult?.artist || card?.querySelector('.discovery-card-artist')?.textContent || '';
                if (type === 'album') return this.playAlbumNow(cachedResult || { id, title, artist, type, service: activeService });
                if (type === 'playlist') return this.playPlaylistNow(cachedResult || { id, title, artist, type, service: activeService });
                // track fallback
                const data = cachedResult || { id, title, artist, album: '', service: activeService, type: 'track', rawData: {} };
                this.playNow(data);
            }

            // Enqueue all tracks from a playlist
            addPlaylistToQueue(playlistResult) {
                try {
                    const cacheKey = `${this.currentService}_playlist_${playlistResult.id}`;
                const proceed = (tracksData) => {
                    let tracks = (tracksData && tracksData.tracks) ? tracksData.tracks : [];
                    tracks = tracks.filter(t => t && (t.SNG_ID || t.id));
                        if (!this.playQueue) this.playQueue = [];
                        let added = 0;
                        tracks.forEach((t, idx) => {
                            const id = String(t.SNG_ID || t.id || `${playlistResult.id}_${idx+1}`);
                            const title = t.SNG_TITLE || t.title || 'Unknown';
                            const artist = t.ART_NAME || (t.performer && t.performer.name) || playlistResult.artist || '';
                            const album = t.ALB_TITLE || (t.album && t.album.title) || '';
                            const svc = this.currentService || 'deezer';
                            const exists = this.playQueue.find(x => String(x.id) === id && (x.service||'') === svc);
                            if (!exists) {
                                this.playQueue.push({id, title, artist, album, service: svc, type: 'track', rawData: t});
                                added++;
                            }
                        });
                        this.persistQueue && this.persistQueue();
                        if (added > 0) this.showNotification(`${added} track(s) added to queue`, 'success');
                        const overlay = document.getElementById('player-fs-overlay');
                        if (overlay && overlay.classList.contains('show')) this.renderFullQueue();
                    };
                    if (this.playlistTracksCache && this.playlistTracksCache.has(cacheKey)) {
                        proceed(this.playlistTracksCache.get(cacheKey));
                    } else {
                        const onTracks = (tracksData) => {
                            if (tracksData && String(tracksData.playlistId) === String(playlistResult.id)) {
                                this.socket.off && this.socket.off('playlistTracks', onTracks);
                                proceed(tracksData);
                            }
                        };
                        if (this.socket && this.socket.on) this.socket.on('playlistTracks', onTracks);
                        this.socket.emit('getPlaylistTracks', { playlistId: playlistResult.id, service: this.currentService, playlistData: playlistResult });
                    }
                } catch (e) {
                    console.error('Add playlist to queue failed:', e);
                    this.showNotification('Failed to add playlist to queue', 'error');
                }
            }

            getDownloadButtonHTML(result, isDownloading, isCompleted) {
                // Download icon SVG
                const downloadIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                        <polyline points="7,10 12,15 17,10"/>
                                        <line x1="12" x2="12" y1="15" y2="3"/>
                                      </svg>`;
                
                // Loading spinner SVG
                const loadingIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="loading-spinner">
                                       <path d="M21 12a9 9 0 11-6.219-8.56"/>
                                     </svg>`;
                
                // Completed check SVG
                const completedIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                         <polyline points="20,6 9,17 4,12"/>
                                       </svg>`;
                
                if (isDownloading) {
                    return `<button class="discovery-action-btn-round downloading" disabled title="Downloading...">${loadingIcon}</button>`;
                } else if (isCompleted) {
                    return `<button class="discovery-action-btn-round completed" disabled title="Downloaded">${completedIcon}</button>`;
                } else {
                    return `<button class="discovery-action-btn-round download download-btn" title="Download">${downloadIcon}</button>`;
                }
            }

            getQobuzQualityInfo(result) {
                // Only show for Qobuz service
                if (this.currentService !== 'qobuz') return { qualityText: '', masterBadge: '' };
                
                let qualityText = '';
                let masterBadge = '';
                
                // Use the real quality data from backend
                const bitDepth = result.maximum_bit_depth;
                const samplingRate = result.maximum_sampling_rate;
                
                
                if (bitDepth && samplingRate) {
                    // Qobuz sometimes stores sampling rate in different formats - try both
                    let kHz;
                    if (samplingRate > 1000) {
                        // If it's already in Hz (like 44100, 96000, 192000)
                        kHz = Math.round(samplingRate / 1000);
                    } else {
                        // If it's already in kHz (like 44.1, 96, 192)
                        kHz = Math.round(samplingRate);
                    }
                    qualityText = `${bitDepth}-Bit/${kHz}kHz`;
                    
                    // Show master badge for high-res (24-bit/48kHz and higher)
                    const actualSampleRate = samplingRate > 1000 ? samplingRate : samplingRate * 1000;
                    if (bitDepth >= 24 && actualSampleRate >= 48000) {
                        masterBadge = `<div class="qobuz-master-badge">
                            <img src="https://play.qobuz.com/resources/8.0.0-b010/2ce51090358ad1deda72.png" alt="Master Quality" title="Master Quality ${bitDepth}-Bit/${kHz}kHz" />
                        </div>`;
                    }
                } else if (result.hires || result.hires_streamable) {
                    // Fallback for hi-res tracks without specific quality data
                    qualityText = 'Hi-Res';
                    masterBadge = `<div class="qobuz-master-badge">
                        <img src="https://play.qobuz.com/resources/8.0.0-b010/2ce51090358ad1deda72.png" alt="Hi-Res Quality" title="Hi-Res Quality Available" />
                    </div>`;
                }
                
                return { qualityText, masterBadge };
            }

            truncateText(text, maxLength) {
                if (!text) return '';
                if (text.length <= maxLength) return text;
                return text.substring(0, maxLength - 3) + '...';
            }

            escapeHtml(text) {
                if (!text) return '';
                const div = document.createElement('div');
                div.textContent = text;
                return div.innerHTML;
            }

            formatDuration(seconds) {
                if (!seconds || isNaN(seconds)) return 'N/A';
                const mins = Math.floor(seconds / 60);
                const secs = Math.floor(seconds % 60);
                return `${mins}:${secs.toString().padStart(2, '0')}`;
            }

            getCoverArtUrl(result) {
                // Deezer playlist image
                if (result.type === 'playlist' && result.rawData && result.rawData.PLAYLIST_PICTURE) {
                    const pic = String(result.rawData.PLAYLIST_PICTURE);
                    if (pic.startsWith('http')) return pic;
                    return `https://cdn-images.dzcdn.net/images/playlist/${pic}/400x400-000000-80-0-0.jpg`;
                }
                // Deezer playlist fallbacks
                if (result.type === 'playlist' && result.rawData) {
                    const p = result.rawData;
                    if (typeof p.picture_big === 'string') return p.picture_big;
                    if (typeof p.picture_small === 'string') return p.picture_small;
                }
            
                // For Qobuz playlist images - use image_rectangle array
                if (result.type === 'playlist' && result.rawData && result.rawData.image_rectangle) {
                    if (Array.isArray(result.rawData.image_rectangle) && result.rawData.image_rectangle.length > 0) {
                        return result.rawData.image_rectangle[0];
                    }
                    if (typeof result.rawData.image_rectangle === 'string') {
                        return result.rawData.image_rectangle;
                    }
                }
            
                // Deezer album cover by md5 hash on result
                if (result.rawData && result.rawData.ALB_PICTURE) {
                    return `https://e-cdns-images.dzcdn.net/images/cover/${result.rawData.ALB_PICTURE}/400x400-000000-80-0-0.jpg`;
                }
                // Deezer album (charts/editorial) may provide md5_image directly
                if (result.type === 'album' && result.rawData && result.rawData.md5_image) {
                    return `https://e-cdns-images.dzcdn.net/images/cover/${result.rawData.md5_image}/400x400-000000-80-0-0.jpg`;
                }
                // Deezer album possible cover URLs
                if (result.type === 'album' && result.rawData) {
                    const ra = result.rawData;
                    if (typeof ra.cover_big === 'string') return ra.cover_big;
                    if (typeof ra.cover_medium === 'string') return ra.cover_medium;
                    if (typeof ra.cover === 'string') return ra.cover;
                }
                // Deezer track or album with album.md5_image
                if (result.rawData && result.rawData.album && (result.rawData.album.md5_image || result.rawData.album.cover)) {
                    const md5 = result.rawData.album.md5_image;
                    if (md5) return `https://e-cdns-images.dzcdn.net/images/cover/${md5}/400x400-000000-80-0-0.jpg`;
                    const cov = result.rawData.album.cover || result.rawData.album.cover_big || result.rawData.album.cover_medium;
                    if (cov) return cov;
                }
                
                // For Qobuz track results  
                if (result.rawData && result.rawData.album && result.rawData.album.image) {
                    return result.rawData.album.image.large || result.rawData.album.image.medium || result.rawData.album.image.small;
                }
                
                // For Qobuz ALBUM results
                if (result.type === 'album' && result.rawData && result.rawData.image) {
                    return result.rawData.image.large || result.rawData.image.medium || result.rawData.image.small;
                }
                
                // For Qobuz artist results
                if (result.type === 'artist' && result.rawData && result.rawData.image) {
                    return result.rawData.image.large || result.rawData.image.medium || result.rawData.image.small;
                }
                
                // For artist images from Deezer
                if (result.type === 'artist' && result.rawData && result.rawData.ART_PICTURE) {
                    return `https://e-cdns-images.dzcdn.net/images/artist/${result.rawData.ART_PICTURE}/400x400-000000-80-0-0.jpg`;
                }
                
                // Fallback for other cases
                return null;
            }

            downloadItem(result) {            
                const existingItem = this.findQueueItem(result);
                if (existingItem && (existingItem.status === 'downloading' || existingItem.status === 'completed')) {
                    this.showNotification(`"${result.title}" is already in progress or complete`, 'info');
                    return;
                }

                const {item: queueItem} = this.upsertQueueItem(result, 'downloading');
                const service = queueItem.service || this.currentService;
                const quality = this.qualitySettings[service] || this.currentQuality;
                
                this.updateQueueUI();
                this.refreshSearchResults();
                this.showNotification(`Starting download: "${result.title}"`, 'success');
                
                // Navigate to downloads page to show progress
                // this.navigateToPage('downloads');
                
                // Start download immediately
                this.socket.emit('startDownload', {
                    queue: [queueItem],
                    quality,
                    service,
                    settings: this.getDownloadSettings()
                });
            }

            refreshSearchResults() {
                // Refresh the current search results to update button states
                if (this.searchResults.length > 0) {
                    this.displayResults(this.searchResults);
                }
            }

            addToQueue(result) {
                if (!this.findQueueItem(result)) {
                    this.upsertQueueItem(result, 'queued');
                    this.updateQueueUI();
                    this.showNotification(`Added "${result.title}" to queue`, 'success');
                } else {
                    this.showNotification(`"${result.title}" is already in the queue`, 'info');
                }
            }

            viewDetails(id) {
                const result = this.searchResults.find(r => r.id === id);
                if (result) {
                    this.showNotification(`Viewing details for: ${result.title}`, 'info');
                    // Could implement a modal or expand functionality here
                }
            }

            updateQueueUI() {
                const queueCount = document.getElementById('queue-count');
                const tableBody = document.getElementById('download-table-body');
                const downloadBtn = document.getElementById('download-btn');
                const resumeQueuedBtn = document.getElementById('resume-queued-btn');
                const queuedCount = this.downloadQueue.filter((item) => item.status === 'queued').length;
                const activeCount = this.downloadQueue.filter((item) => item.status === 'downloading').length;
                
                queueCount.textContent = this.downloadQueue.length;            
                
                if (this.downloadQueue.length === 0) {
                    tableBody.innerHTML = `
                        <tr>
                            <td colspan="5">
                                <div class="empty-state">
                                    <div class="empty-state-icon">📥</div>
                                    <h3>No Downloads Yet</h3>
                                    <p>Add some music to your queue to start downloading</p>
                                </div>
                            </td>
                        </tr>
                    `;
                } else {
                    tableBody.innerHTML = '';
                    this.downloadQueue.forEach((item, index) => {
                        const row = this.createDownloadTableRow(item, index);
                        tableBody.appendChild(row);
                    });
                }
                
                if (downloadBtn) {
                    downloadBtn.style.display = 'inline-flex';
                    if (activeCount > 0) {
                        downloadBtn.textContent = 'Downloads Running';
                    } else if (queuedCount > 0) {
                        downloadBtn.textContent = queuedCount === this.downloadQueue.length
                            ? `Start Downloads (${queuedCount})`
                            : `Resume Queued Downloads (${queuedCount})`;
                    } else if (this.downloadQueue.length > 0) {
                        downloadBtn.textContent = 'Queue Complete';
                    } else {
                        downloadBtn.textContent = 'Start Downloads';
                    }
                    downloadBtn.disabled = queuedCount === 0 || this.isDownloading;
                }

                if (resumeQueuedBtn) {
                    if (queuedCount > 0) {
                        resumeQueuedBtn.style.display = 'inline-flex';
                        resumeQueuedBtn.textContent = queuedCount === this.downloadQueue.length
                            ? `Start Queued (${queuedCount})`
                            : `Resume Queued (${queuedCount})`;
                    } else {
                        resumeQueuedBtn.style.display = 'none';
                    }
                    resumeQueuedBtn.disabled = queuedCount === 0 || this.isDownloading;
                }

                this.updateDownloadBadge();
                this.renderQueueInsights();
                this.renderSessionDeck();
                this.renderRecentDownloads();
                this.renderMobileDownloadsManager();
                this.applyDownloadColumnWidths();

                localStorage.setItem('elixium-download-queue', JSON.stringify(this.downloadQueue));
            }

            renderMobileDownloadsManager() {
                const shell = document.getElementById('mobile-downloads-manager');
                if (!shell) return;

                const countEl = document.getElementById('mobile-downloads-count');
                const queuedEl = document.getElementById('mobile-stat-queued');
                const activeEl = document.getElementById('mobile-stat-active');
                const completedEl = document.getElementById('mobile-stat-completed');
                const failedEl = document.getElementById('mobile-stat-failed');
                const listEl = document.getElementById('mobile-downloads-list');
                const startBtn = document.getElementById('mobile-download-start-btn');
                const resumeBtn = document.getElementById('mobile-download-resume-btn');
                const clearBtn = document.getElementById('mobile-download-clear-btn');

                const queued = this.downloadQueue.filter((item) => item.status === 'queued').length;
                const active = this.downloadQueue.filter((item) => item.status === 'downloading').length;
                const completed = this.downloadQueue.filter((item) => item.status === 'completed').length;
                const failed = this.downloadQueue.filter((item) => item.status === 'error').length;

                if (countEl) countEl.textContent = String(this.downloadQueue.length);
                if (queuedEl) queuedEl.textContent = String(queued);
                if (activeEl) activeEl.textContent = String(active);
                if (completedEl) completedEl.textContent = String(completed);
                if (failedEl) failedEl.textContent = String(failed);

                if (listEl) {
                    if (!this.downloadQueue.length) {
                        listEl.innerHTML = `
                            <div class="mobile-downloads-empty">
                                <div class="mobile-downloads-empty-title">No downloads yet</div>
                                <div class="mobile-downloads-empty-copy">Add music from Search, Home, or URL Download to start a batch.</div>
                            </div>
                        `;
                    } else {
                        listEl.innerHTML = '';
                        this.downloadQueue.forEach((item) => {
                            const progressState = this.downloadProgress.get(item.id) || {};
                            const progress = typeof progressState.percentage === 'number'
                                ? Math.max(0, Math.min(100, Math.round(progressState.percentage)))
                                : item.status === 'completed'
                                    ? 100
                                    : item.status === 'downloading'
                                        ? 8
                                        : 0;

                            const card = document.createElement('div');
                            card.className = `mobile-download-item mobile-download-item--${item.status || 'queued'}`;
                            const coverHtml = item.image
                                ? `<img src="${item.image}" alt="${this.escapeHtml(item.title || 'Download')}">`
                                : `<div class="mobile-download-cover-fallback">${this.escapeHtml((item.type || 'item').slice(0, 1).toUpperCase())}</div>`;
                            const subtitle = item.album || item.listTitle || item.artist || item.service || '';
                            const statusLabel = item.status === 'downloading'
                                ? 'Downloading'
                                : item.status === 'completed'
                                    ? 'Completed'
                                    : item.status === 'error'
                                        ? 'Failed'
                                        : 'Queued';

                            card.innerHTML = `
                                <div class="mobile-download-item-top">
                                    <div class="mobile-download-cover">${coverHtml}</div>
                                    <div class="mobile-download-copy">
                                        <strong class="mobile-download-name">${this.escapeHtml(item.title || 'Untitled')}</strong>
                                        <span class="mobile-download-artist">${this.escapeHtml(item.artist || item.service || 'Unknown')}</span>
                                        <span class="mobile-download-subtitle">${this.escapeHtml(subtitle)}</span>
                                    </div>
                                </div>
                                <div class="mobile-download-meta">
                                    <span class="mobile-download-status mobile-download-status--${item.status || 'queued'}">${statusLabel}</span>
                                    ${item.status === 'error' && item.errorMessage ? `<span class="mobile-download-error">${this.escapeHtml(item.errorMessage)}</span>` : ''}
                                </div>
                                <div class="mobile-download-progress">
                                    <div class="mobile-download-progress-bar">
                                        <span class="mobile-download-progress-fill" style="width:${progress}%;"></span>
                                    </div>
                                    <span class="mobile-download-progress-label">${progress}%</span>
                                </div>
                            `;
                            listEl.appendChild(card);
                        });
                    }
                }

                if (startBtn) {
                    if (active > 0) {
                        startBtn.textContent = 'Downloads Running';
                    } else if (queued > 0) {
                        startBtn.textContent = queued === this.downloadQueue.length
                            ? `Start Downloads (${queued})`
                            : `Resume Downloads (${queued})`;
                    } else if (this.downloadQueue.length > 0) {
                        startBtn.textContent = 'Queue Complete';
                    } else {
                        startBtn.textContent = 'Start Downloads';
                    }
                    startBtn.disabled = queued === 0 || this.isDownloading;
                }

                if (resumeBtn) {
                    if (queued > 0) {
                        resumeBtn.style.display = 'flex';
                        resumeBtn.textContent = queued === this.downloadQueue.length
                            ? `Start Queued (${queued})`
                            : `Resume Queued (${queued})`;
                        resumeBtn.disabled = queued === 0 || this.isDownloading;
                    } else {
                        resumeBtn.style.display = 'none';
                        resumeBtn.disabled = true;
                    }
                }

                if (clearBtn) {
                    clearBtn.disabled = this.downloadQueue.length === 0;
                }
            }

            createDownloadTableRow(item, index) {
                const row = document.createElement('tr');
                row.dataset.id = item.id;
                
                const typeEmojis = {
                    track: '🎵',
                    album: '💿',
                    artist: '🎤',
                    playlist: '📋'
                };
            
                const coverUrl = this.getCoverArtUrl(item);
                
                // Get progress data for this item
                const progress = this.downloadProgress.get(item.id) || { percentage: 0, currentTrack: '' };
                
                row.innerHTML = `
                    <td>
                        <div class="download-item-info">
                            <div class="download-item-cover">
                                ${coverUrl ? 
                                    `<img src="${coverUrl}" alt="${item.title}" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                                     <div style="display:none;">${typeEmojis[item.type] || '🎵'}</div>` :
                                    `<div>${typeEmojis[item.type] || '🎵'}</div>`
                                }
                            </div>
                            <div class="download-item-details">
                                <div class="download-item-title">${item.title}</div>
                                <div class="download-item-artist">${item.artist}</div>
                            </div>
                        </div>
                    </td>
                    <td>
                        <div class="status-progress-container">
                            <div class="status-progress-top">
                                <span class="status-badge status-${item.status}">${item.status}</span>
                                ${item.status === 'downloading' ? 
                                    `<span class="progress-percentage">${Math.round(progress.percentage)}%</span>` : 
                                    ''
                                }
                            </div>
                            ${item.status === 'downloading' ? `
                                <div class="item-progress-bar">
                                    <div class="item-progress-fill ${item.status}" style="width: ${progress.percentage}%"></div>
                                </div>
                                ${progress.currentTrack ? `
                                    <div class="current-track-info" title="${progress.currentTrack}">
                                        ${progress.currentTrack}
                                    </div>
                                ` : ''}
                            ` : ''}
                            ${item.status === 'error' && item.errorMessage ? `
                                <div class="current-track-info" style="color: var(--error-color);" title="${item.errorMessage}">
                                    ${item.errorMessage}
                                </div>
                            ` : ''}
                        </div>
                    </td>
                    <td>${item.startTime && item.startTime.toLocaleTimeString ? item.startTime.toLocaleTimeString() : '-'}</td>
                    <td>${item.endTime && item.endTime.toLocaleTimeString ? item.endTime.toLocaleTimeString() : '-'}</td>
                    <td>
                        <div class="download-actions">
                            ${item.status === 'downloading' ? 
                                '<button class="action-icon-btn danger" onclick="app.cancelDownload(\'' + item.id + '\')">⏹️</button>' :
                                '<button class="action-icon-btn danger" onclick="app.removeFromQueue(\'' + item.id + '\')">🗑️</button>'
                            }
                            <button class="action-icon-btn" onclick="app.retryDownload('${item.id}')">🔄</button>
                        </div>
                    </td>
                `;
                
                return row;
            }

            removeFromQueue(id) {
                this.downloadQueue = this.downloadQueue.filter(item => item.id !== id);
                this.updateQueueUI();
                this.clearResultSelections();
                this.showNotification('Item removed from queue', 'success');
            }

            clearQueue() {
                this.downloadQueue = [];
                this.updateQueueUI();
                this.clearResultSelections();
                this.showNotification('Queue cleared', 'success');
                localStorage.removeItem('elixium-download-queue');
            }

            startDownload() {
                const queueToStart = this.getQueuedItemsForStart();
                if (queueToStart.length === 0) {
                    this.showNotification('No queued items are ready to start', 'info');
                    return;
                }

                const queueServices = [...new Set(queueToStart.map((item) => {
                    if (item.service === 'user-playlist') {
                        const nestedServices = [...new Set((item.tracks || []).map((track) => track.service).filter(Boolean))];
                        if (nestedServices.length === 1) return nestedServices[0];
                    }
                    return item.service || this.currentService || 'deezer';
                }))];
                const service = queueServices.length === 1 ? queueServices[0] : this.currentService;
                const quality = this.qualitySettings[service] || this.currentQuality;
                
                this.isDownloading = true;
                const downloadBtn = document.getElementById('download-btn');
                
                downloadBtn.textContent = 'Downloading...';
                downloadBtn.disabled = true;
                
                // Update status of all queued items
                queueToStart.forEach(item => {
                    if (item.status === 'queued') {
                        item.status = 'downloading';
                        item.startTime = new Date();
                    }
                });
                
                this.updateQueueUI();
                this.updateProgressPanelState();
                
                this.socket.emit('startDownload', {
                    queue: queueToStart,
                    quality,
                    service,
                    settings: this.getDownloadSettings()
                });
            }

            resumeQueuedDownloads() {
                const queuedCount = this.getQueuedItemsForStart().length;
                if (queuedCount === 0) {
                    this.showNotification('No queued items are ready to resume', 'info');
                    return;
                }

                this.showNotification(
                    queuedCount === 1
                        ? 'Resuming 1 queued item'
                        : `Resuming ${queuedCount} queued items`,
                    'success'
                );
                this.startDownload();
            }

            getDownloadSettings() {
                return {
                    concurrency: parseInt(document.getElementById('concurrency').value) || 4,
                    trackNumber: document.getElementById('track-number').checked,
                    fallbackTrack: document.getElementById('fallback-track').checked,
                    fallbackQuality: document.getElementById('fallback-quality').checked,
                    deezerDownloadCover: document.getElementById('deezer-download-cover').checked,
                    qobuzDownloadCover: document.getElementById('qobuz-download-cover').checked,
                    createPlaylist: document.getElementById('create-playlist').checked,
                    deezerPath: document.getElementById('deezer-download-path').value,
                    qobuzPath: document.getElementById('qobuz-download-path').value
                };
            }

            updateDownloadProgress(data) {
                const progressFill = document.getElementById('progress-fill');
                const progressPercentage = document.getElementById('progress-percentage');
                const currentDownload = document.getElementById('current-download');
                const downloadedCount = document.getElementById('downloaded-count');
                const totalCount = document.getElementById('total-count');
                
                // Update main progress elements
                if (data.percentage !== undefined) {
                    progressFill.style.width = data.percentage + '%';
                    progressPercentage.textContent = Math.round(data.percentage) + '%';
                    
                    // Update mini progress indicator
                    this.updateMiniProgressIndicator(data);
                }
                
                if (data.current && data.total) {
                    downloadedCount.textContent = data.current;
                    totalCount.textContent = data.total;
                }
            
                // Update overall current download display
                if (data.currentTrack) {
                    if (data.itemId === 'url-conversion') {
                        currentDownload.textContent = data.currentTrack;
                    } else {
                        currentDownload.textContent = `Currently downloading: ${data.currentTrack}`;
                    }
                }
            
                // Update individual item progress if provided
                if (data.itemId) {
                    const item = this.downloadQueue.find(i => i.id === data.itemId);
                    if (item) {
                        // Update item status
                        item.status = data.itemStatus || 'downloading';
                        if (data.itemStatus === 'completed') {
                            item.endTime = new Date();
                        } else if (data.itemStatus === 'error') {
                            item.errorMessage = data.errorMessage;
                            item.endTime = new Date();
                        }
                        
                        // Store individual progress data
                        this.downloadProgress.set(data.itemId, {
                            percentage: data.itemProgress || 0,
                            currentTrack: data.currentTrack || '',
                            albumTrack: data.albumTrack || '',
                            albumProgress: data.albumProgress || 0
                        });
                        
                        // Update the specific table row
                        this.updateTableRowProgress(data.itemId, item);
                        this.refreshSearchResults();
                    }
                }
                
                // Update visual activity states
                this.updateProgressPanelState();
                this.updateDownloadBadge();
            }
            
            updateMiniProgressIndicator(data) {
                const miniFill = document.getElementById('mini-progress-fill');
                const miniPercentage = document.getElementById('mini-progress-percentage');
                const miniCount = document.getElementById('mini-progress-count');
                
                if (miniFill && data.percentage !== undefined) {
                    miniFill.style.width = data.percentage + '%';
                }
                
                if (miniPercentage) {
                    miniPercentage.textContent = Math.round(data.percentage || 0) + '%';
                }
                
                if (miniCount && data.current && data.total) {
                    miniCount.textContent = `(${data.current}/${data.total})`;
                }
            }
            
            updateTableRowProgress(itemId, item) {
                const row = document.querySelector(`tr[data-id="${itemId}"]`);
                if (!row) return;
                
                const progress = this.downloadProgress.get(itemId) || { percentage: 0, currentTrack: '' };
                const statusCell = row.querySelector('td:nth-child(2)');
                
                if (!statusCell) return;
                
                // Build the new status cell content
                let statusContent = `
                    <div class="status-progress-container">
                        <div class="status-progress-top">
                            <span class="status-badge status-${item.status}">${item.status}</span>
                            ${item.status === 'downloading' ? 
                                `<span class="progress-percentage">${Math.round(progress.percentage)}%</span>` : 
                                ''
                            }
                        </div>
                `;
                
                if (item.status === 'downloading') {
                    statusContent += `
                        <div class="item-progress-bar">
                            <div class="item-progress-fill ${item.status}" style="width: ${progress.percentage}%"></div>
                        </div>
                    `;
                    
                    // Show current track info for this item
                    if (progress.currentTrack) {
                        let trackInfo = progress.currentTrack;
                        if (progress.albumTrack) {
                            trackInfo += ` (${progress.albumTrack})`;
                        }
                        statusContent += `
                            <div class="current-track-info" title="${trackInfo}">
                                ${trackInfo}
                            </div>
                        `;
                    }
                } else if (item.status === 'error' && item.errorMessage) {
                    statusContent += `
                        <div class="current-track-info" style="color: var(--error-color);" title="${item.errorMessage}">
                            ${item.errorMessage}
                        </div>
                    `;
                }
                
                statusContent += '</div>';
                statusCell.innerHTML = statusContent;
            }

            onDownloadComplete(data) {
                this.showNotification(`Successfully downloaded ${data.count} tracks`, 'success');
                this.resetDownloadState();
                
                // Mark all items as completed
                const completedItems = [];
                this.downloadQueue.forEach(item => {
                    if (item.status === 'downloading') {
                        item.status = 'completed';
                        item.endTime = new Date();
                        completedItems.push(item);
                    }
                });

                completedItems.forEach((item) => this.saveRecentDownload(item));
                
                this.updateQueueUI();
                this.refreshSearchResults();
                this.updateProgressPanelState(); // Add this line
                
                // Update mini indicator
                this.updateMiniProgressIndicator({ percentage: 100, current: data.count, total: data.count });
            }

            resetDownloadState() {
                this.isDownloading = false;
                const downloadBtn = document.getElementById('download-btn');
                const progressFill = document.getElementById('progress-fill');
                const currentDownload = document.getElementById('current-download');
                
                downloadBtn.textContent = 'Start Downloads';
                downloadBtn.disabled = this.downloadQueue.length === 0;
                progressFill.style.width = '0%';
                currentDownload.textContent = 'No active downloads';
                
                document.getElementById('progress-percentage').textContent = '0%';
                
                // Reset mini indicator
                this.updateMiniProgressIndicator({ percentage: 0, current: 0, total: 0 });
            }
            
            resetUrlButton() {
                const urlBtn = document.getElementById('url-download-btn');
                urlBtn.querySelector('span').textContent = 'Download';
                urlBtn.disabled = false;
            }
            
            onDirectUrlDownloadStart(data) {
                // Add items to download queue for UI tracking
                if (data.tracks && data.tracks.length > 0) {
                    let addedCount = 0;
                    data.tracks.forEach((track) => {
                        const queueItem = {
                        id: track.id || track.SNG_ID,
                        title: track.title || track.SNG_TITLE,
                        artist: track.performer?.name || track.ART_NAME,
                        album: track.album?.title || track.ALB_TITLE,
                        type: data.contentType || 'track',
                        status: 'downloading',
                        startTime: new Date(),
                        endTime: null,
                        addedAt: new Date(),
                        rawData: track
                        };

                        const result = this.upsertQueueItem(queueItem, 'downloading');
                        if (result.added) {
                            addedCount += 1;
                        }
                    });

                    this.updateQueueUI();
                    
                    if (addedCount > 0) {
                        this.showNotification(`Downloading ${addedCount} track${addedCount === 1 ? '' : 's'} from URL`, 'success');
                    } else {
                        this.showNotification('These URL items are already in progress or complete', 'info');
                    }
                }
                
                this.resetUrlButton();
            }

            onDirectUrlConversionProgress(data) {
                const urlBtn = document.getElementById('url-download-btn');
                const currentDownload = document.getElementById('current-download');
                const progressText = data && typeof data.percentage === 'number' ? `Converting... ${Math.round(data.percentage)}%` : 'Converting...';

                if (urlBtn && urlBtn.disabled) {
                    const label = urlBtn.querySelector('span');
                    if (label) {
                        label.textContent = progressText;
                    }
                    if (data && data.message) {
                        urlBtn.title = data.message;
                    }
                }

                if (currentDownload && data && data.message) {
                    currentDownload.textContent = data.message;
                }
            }

            setSearchType(type) {
                this.currentSearchType = type;
                
                document.querySelectorAll('[data-type]').forEach(btn => {
                    if (btn.closest('.filter-group')) {
                        btn.classList.remove('active');
                    }
                });
                document.querySelector(`[data-type="${type}"]`).classList.add('active');
                
                const input = document.getElementById('search-input');
                const placeholders = {
                    track: 'Search for tracks...',
                    album: 'Search for albums...',
                    artist: 'Search for artists...',
                    playlist: 'Search for playlists...'
                };
                input.placeholder = placeholders[type];
                localStorage.setItem('elixium-search-type', type);
            }

            setView(view) {
                this.currentView = view;
                
                document.querySelectorAll('.view-btn').forEach(btn => {
                    btn.classList.remove('active');
                });
                document.querySelector(`[data-view="${view}"]`).classList.add('active');
                
                const grid = document.getElementById('results-grid');
                if (view === 'list') {
                    grid.classList.add('list-view');
                } else {
                    grid.classList.remove('list-view');
                }
                
                // Re-render results with new view
                if (this.searchResults.length > 0) {
                    this.displayResults(this.searchResults);
                }

                localStorage.setItem('elixium-view-mode', view);
            }

            downloadFromUrl() {
                const url = document.getElementById('url-input').value.trim();
                if (!url) {
                    this.showNotification('Please enter a URL', 'error');
                    return;
                }

                // Check if this is a playlist URL and if playlist editor is enabled
                const isPlaylistUrl = url.includes('/playlist/') || url.includes('album/') || url.includes('artist/');
                const isPlaylistEditorEnabled = document.getElementById('enable-playlist-editor')?.checked;

                if (isPlaylistUrl && isPlaylistEditorEnabled) {
                    this.fetchPlaylistForEditing(url);
                } else {
                    // Show loading state
                    const urlBtn = document.getElementById('url-download-btn');
                    urlBtn.querySelector('span').textContent = 'Downloading...';
                    urlBtn.disabled = true;
                    
                    // Start direct download
                    this.socket.emit('directUrlDownload', { 
                        url, 
                        quality: this.currentQuality,
                        service: this.currentService,
                        settings: this.getDownloadSettings()
                    });
                    
                    this.showNotification('Starting download from URL...', 'success');
                }
            }

            async fetchPlaylistForEditing(url) {
                try {
                    // Show loading state
                    const urlBtn = document.getElementById('url-download-btn');
                    urlBtn.querySelector('span').textContent = 'Loading playlist...';
                    urlBtn.disabled = true;

                    // Detect service from URL
                    let service = 'deezer';
                    let playlistId = '';
                    
                    if (url.includes('deezer.com')) {
                        service = 'deezer';
                        const match = url.match(/playlist\/(\d+)/);
                        if (match) playlistId = match[1];
                    } else if (url.includes('qobuz.com') || url.includes('play.qobuz.com')) {
                        service = 'qobuz';
                        const match = url.match(/playlist\/([^/?]+)/);
                        if (match) playlistId = match[1];
                    } else if (url.includes('spotify.com')) {
                        // For Spotify playlists, we'll process them through the backend conversion
                        // and then try to get the converted tracks for editing
                        service = 'spotify';
                        const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
                        console.log('Spotify URL processing:', { url, match });
                        
                        if (match) {
                            playlistId = match[1];
                            console.log('Extracted Spotify playlist ID:', playlistId);
                            
                            // Store the original Spotify URL for conversion
                            this.currentPlaylistEditData = {
                                url: url,
                                service: 'spotify',
                                playlistId: playlistId,
                                tracks: [],
                                playlistInfo: {}
                            };
                            
                            // Try to get playlist info through direct URL processing
                            // The backend should handle Spotify conversion
                            this.showNotification('Processing Spotify playlist for editing...', 'info');
                            
                            // Emit a special event for Spotify playlist editing
                            this.socket.emit('getSpotifyPlaylistForEditing', {
                                url: url,
                                playlistId: playlistId,
                                service: this.currentService // Target service for conversion
                            });
                            
                            return;
                        } else {
                            console.error('Failed to parse Spotify playlist ID from URL:', url);
                            this.showNotification('Could not parse Spotify playlist ID from URL', 'error');
                            this.resetUrlButton();
                            return;
                        }
                    }

                    if (!playlistId) {
                        this.showNotification('Could not parse playlist ID from URL', 'error');
                        this.resetUrlButton();
                        return;
                    }

                    // Store current playlist info for editing
                    this.currentPlaylistEditData = {
                        url: url,
                        service: service,
                        playlistId: playlistId,
                        tracks: [],
                        playlistInfo: {}
                    };

                    // Request playlist tracks from backend
                    this.socket.emit('getPlaylistTracks', {
                        playlistId: playlistId,
                        service: service,
                        playlistData: { title: 'Loading...' }
                    });

                } catch (error) {
                    console.error('Error fetching playlist for editing:', error);
                    this.showNotification('Failed to load playlist for editing', 'error');
                    this.resetUrlButton();
                }
            }

            toggleResultSelection(result, element) {
                const isSelected = element.classList.contains('selected');
                
                if (isSelected) {
                    element.classList.remove('selected');
                    this.removeFromQueue(result.id);
                } else {
                    element.classList.add('selected');
                    this.addToQueue(result);
                }
            }

            clearResults() {
                document.getElementById('results-grid').innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">🎵</div>
                        <h3>Discover Amazing Music</h3>
                        <p>Search for your favorite tracks, albums, artists, or playlists to get started</p>
                    </div>
                `;
                document.getElementById('results-count').textContent = 'No results';
                this.searchResults = [];

                // Save current search query before clearing
                const currentQuery = document.getElementById('search-input')?.value.trim();
                if (currentQuery) {
                    localStorage.setItem('elixium-last-search', currentQuery);
                }                
            }

            clearResultSelections() {
                document.querySelectorAll('.result-item').forEach(item => {
                    item.classList.remove('selected');
                });
            }

            loadSettings() {
                this.socket.emit('getSettings');
            }

            populateSettings(settings) {
                // Populate all settings fields
                if (settings.concurrency) {
                    document.getElementById('concurrency').value = settings.concurrency;
                }
                
                if (settings.trackNumber !== undefined) {
                    document.getElementById('track-number').checked = settings.trackNumber;
                }
                
                if (settings.fallbackTrack !== undefined) {
                    document.getElementById('fallback-track').checked = settings.fallbackTrack;
                }
                
                if (settings.fallbackQuality !== undefined) {
                    document.getElementById('fallback-quality').checked = settings.fallbackQuality;
                }
                
                if (settings.deezerDownloadCover !== undefined) {
                    document.getElementById('deezer-download-cover').checked = settings.deezerDownloadCover;
                }
                
                if (settings.qobuzDownloadCover !== undefined) {
                    document.getElementById('qobuz-download-cover').checked = settings.qobuzDownloadCover;
                }

                if (settings.createPlaylist !== undefined) {
                    document.getElementById('create-playlist').checked = settings.createPlaylist;
                }                
                
                if (settings.cookies && settings.cookies.arl) {
                    document.getElementById('deezer-arl').value = settings.cookies.arl;
                }
                
                const spotifySpDcInput = document.getElementById('spotify-sp-dc');
                if (spotifySpDcInput && settings.cookies && settings.cookies.sp_dc) {
                    spotifySpDcInput.value = settings.cookies.sp_dc;
                }
                
                if (settings.qobuz && settings.qobuz.token) {
                    document.getElementById('qobuz-token').value = settings.qobuz.token;
                }
                if (settings.qobuz && settings.qobuz.app_id !== undefined && document.getElementById('qobuz-app-id')) {
                    document.getElementById('qobuz-app-id').value = String(settings.qobuz.app_id || '');
                }
                if (settings.qobuz && settings.qobuz.secrets !== undefined && document.getElementById('qobuz-secrets')) {
                    document.getElementById('qobuz-secrets').value = String(settings.qobuz.secrets || '');
                }
                
                if (settings.saveLayout) {
                    document.getElementById('layout-track').value = settings.saveLayout.track || '';
                    document.getElementById('layout-album').value = settings.saveLayout.album || '';
                    document.getElementById('layout-artist').value = settings.saveLayout.artist || '';
                    document.getElementById('layout-playlist').value = settings.saveLayout.playlist || '';
                    document.getElementById('layout-qobuz-track').value = settings.saveLayout['qobuz-track'] || '';
                    document.getElementById('layout-qobuz-album').value = settings.saveLayout['qobuz-album'] || '';
                    document.getElementById('layout-qobuz-playlist').value = settings.saveLayout['qobuz-playlist'] || '';
                }

                if (settings.quality) {
                    this.qualitySettings = {
                        deezer: settings.quality.deezer || '320',
                        qobuz: settings.quality.qobuz || '44khz'
                    };
                    this.qualitySettingsLoaded = true;
                    
                    // Set the dropdown values
                    const deezerQualitySelect = document.getElementById('deezer-quality');
                    const qobuzQualitySelect = document.getElementById('qobuz-quality');
                    
                    if (deezerQualitySelect) {
                        deezerQualitySelect.value = this.qualitySettings.deezer;
                    }
                    
                    if (qobuzQualitySelect) {
                        qobuzQualitySelect.value = this.qualitySettings.qobuz;
                    }
                    
                    // Update the search quality buttons to match
                    this.updateQualityOptions();                       
                    console.log('🎵 Quality dropdowns populated:', this.qualitySettings);
                }              
                
                if (settings.coverSize) {
                    document.getElementById('cover-size-128').value = settings.coverSize['128'] || 500;
                    document.getElementById('cover-size-320').value = settings.coverSize['320'] || 500;
                    document.getElementById('cover-size-flac').value = settings.coverSize['flac'] || 1000;
                }

                if (settings.paths) {
                    document.getElementById('deezer-download-path').value = settings.paths.deezer || 'C:\\Users\\Downloads\\Music\\Deezer';
                    document.getElementById('qobuz-download-path').value = settings.paths.qobuz || 'C:\\Users\\Downloads\\Music\\Qobuz';
                }
            }

            saveSettings() {
                const settings = {
                    concurrency: parseInt(document.getElementById('concurrency').value),
                    trackNumber: document.getElementById('track-number').checked,
                    fallbackTrack: document.getElementById('fallback-track').checked,
                    fallbackQuality: document.getElementById('fallback-quality').checked,
                    deezerDownloadCover: document.getElementById('deezer-download-cover').checked,
                    qobuzDownloadCover: document.getElementById('qobuz-download-cover').checked,
                    createPlaylist: document.getElementById('create-playlist').checked,
                    cookies: {
                        arl: document.getElementById('deezer-arl').value,
                        ...(document.getElementById('spotify-sp-dc')
                            ? { sp_dc: document.getElementById('spotify-sp-dc').value }
                            : {})
                    },
                    qobuz: {
                        token: document.getElementById('qobuz-token').value,
                        app_id: document.getElementById('qobuz-app-id')?.value,
                        secrets: document.getElementById('qobuz-secrets')?.value
                    },
                    saveLayout: {
                        track: document.getElementById('layout-track').value,
                        album: document.getElementById('layout-album').value,
                        artist: document.getElementById('layout-artist').value,
                        playlist: document.getElementById('layout-playlist').value,
                        'qobuz-track': document.getElementById('layout-qobuz-track').value,
                        'qobuz-album': document.getElementById('layout-qobuz-album').value,
                        'qobuz-playlist': document.getElementById('layout-qobuz-playlist').value
                    },
                    coverSize: {
                        '128': parseInt(document.getElementById('cover-size-128').value),
                        '320': parseInt(document.getElementById('cover-size-320').value),
                        'flac': parseInt(document.getElementById('cover-size-flac').value)
                    },
                    paths: {
                        deezer: document.getElementById('deezer-download-path').value,
                        qobuz: document.getElementById('qobuz-download-path').value
                    },

                    quality: {
                        deezer: document.getElementById('deezer-quality')?.value || this.qualitySettings.deezer,
                        qobuz: document.getElementById('qobuz-quality')?.value || this.qualitySettings.qobuz
                    }                  

                };

                // Update internal quality settings
                this.qualitySettings = settings.quality;
                
                // Update search quality buttons to match the new settings
                this.updateQualityOptions();                
                
                this.socket.emit('saveSettings', settings);
                this.renderSessionDeck();

                this.debug('Settings saved with quality:', settings.quality);
            }       

            showNotification(message, type = 'success') {
                const notification = document.getElementById('notification');
                notification.textContent = message;
                notification.className = `notification ${type}`;
                notification.classList.add('show');
                
                setTimeout(() => {
                    notification.classList.remove('show');
                }, 4000);
            }

            updateUI() {
                this.updateQueueUI();
            }
            // Safer filename builder preserving readable names
            buildSafeName(name) {
                if (!name) return 'file';
                try {
                    let s = String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
                    s = s.replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '');
                    s = s.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
                    s = s.replace(/\.+/g, '.').replace(/_+/g, '_');
                    return s || 'file';
                } catch {
                    return 'file';
                }
            }

            async readStreamWithProgress(resp, jobId) {
                const contentLength = Number(resp.headers.get('Content-Length') || 0);
                if (!resp.body || !window.ReadableStream) {
                    return await resp.blob();
                }
                const reader = resp.body.getReader();
                const chunks = [];
                let received = 0;
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    received += value.byteLength;
                    if (jobId && contentLength) {
                        const pct = Math.min(100, Math.round((received / contentLength) * 100));
                        this.updateDownloadProgress({ itemId: jobId, itemStatus: 'downloading', itemProgress: pct });
                    }
                }
                const blob = new Blob(chunks);
                if (jobId) {
                    this.updateDownloadProgress({ itemId: jobId, itemStatus: 'completed', itemProgress: 100 });
                }
                return blob;
            }

            async downloadTrackToClient(result) {
                const self = this;
                try {
                    const service = this.currentService;
                    const quality = service === 'deezer' ? (this.qualitySettings.deezer || '320') : (this.qualitySettings.qobuz || '44khz');
                    const url = `/api/download-item?service=${encodeURIComponent(service)}&id=${encodeURIComponent(result.id)}&quality=${encodeURIComponent(quality)}`;
                    const resp = await fetch(url);
                    if (!resp.ok) throw new Error('Download failed');
                    const blob = await resp.blob();
                    const a = document.createElement('a');
                    const ext = blob.type.includes('flac') ? 'flac' : 'mp3';
                    const fileName = `${(result.artist||'Artist').replace(/[^\w\-\s\.]/g,'_')} - ${(result.title||'Track').replace(/[^\w\-\s\.]/g,'_')}.${ext}`;
                    a.href = URL.createObjectURL(blob);
                    a.download = fileName;
                    document.body.appendChild(a);
                    a.click();
                    URL.revokeObjectURL(a.href);
                    a.remove();
                    this.showNotification('Download started in browser', 'success');
                } catch (e) {
                    console.error(e);
                    this.showNotification('Failed to download to browser', 'error');
                }
            }

            cancelDownload(id) {
                // Implementation for canceling individual downloads
                this.socket.emit('cancelDownload', { id });
            }

            retryDownload(id) {
                const item = this.downloadQueue.find(i => i.id === id);
                if (item) {
                    if (item.status === 'downloading') {
                        this.showNotification('Wait for the active download to finish before retrying it', 'info');
                        return;
                    }
                    item.status = 'queued';
                    item.errorMessage = '';
                    item.startTime = null;
                    item.endTime = null;
                    this.updateQueueUI();
                    this.showNotification('Item queued for retry', 'success');
                }
            }
            
        }

        // Initialize the app
        let app;
        document.addEventListener('DOMContentLoaded', () => {
            app = new ModernMusicDownloaderApp();
            window.app = app; // Make it globally accessible for button handlers
        });
        // Global delegates and audio UI sync
        window.addEventListener('load', () => {
            const audio = document.getElementById('audio-el');
            if (audio) {
                audio.addEventListener('loadedmetadata', () => {
                    const dur = document.getElementById('pf-duration');
                    const cur = document.getElementById('pf-current');
                    const seek = document.getElementById('pf-seek');
                    if (dur) dur.textContent = Math.floor(audio.duration/60)+":"+("0"+Math.floor(audio.duration%60)).slice(-2);
                    if (cur) cur.textContent = Math.floor(audio.currentTime/60)+":"+("0"+Math.floor(audio.currentTime%60)).slice(-2);
                    if (seek && isFinite(audio.duration)) seek.value = String((audio.currentTime/audio.duration)*100||0);
                });
                audio.addEventListener('timeupdate', () => {
                    const dur = document.getElementById('pf-duration');
                    const cur = document.getElementById('pf-current');
                    const seek = document.getElementById('pf-seek');
                    if (isFinite(audio.duration)) {
                        if (cur) cur.textContent = Math.floor(audio.currentTime/60)+":"+("0"+Math.floor(audio.currentTime%60)).slice(-2);
                        if (dur) dur.textContent = Math.floor(audio.duration/60)+":"+("0"+Math.floor(audio.duration%60)).slice(-2);
                        if (seek && !(window.app && window.app._fsSeeking)) seek.value = String((audio.currentTime/audio.duration)*100||0);
                    }
                });
                audio.addEventListener('play', () => {
                    if (window.app){ window.app.refreshFullPlayerMeta(); window.app.renderFullQueue(); }
                    const t1 = document.getElementById('player-toggle'); if (t1) t1.classList.add('is-playing');
                    const t2 = document.getElementById('pf-toggle'); if (t2) t2.classList.add('is-playing');
                });
                audio.addEventListener('pause', () => {
                    if (window.app){ window.app.refreshFullPlayerMeta(); }
                    const t1 = document.getElementById('player-toggle'); if (t1) t1.classList.remove('is-playing');
                    const t2 = document.getElementById('pf-toggle'); if (t2) t2.classList.remove('is-playing');
                });
            }
            document.addEventListener('click', (ev) => {
                const t = ev.target;
                if (!(t && t.closest)) return;
                const q = t.closest('.queue-btn');
                const p = t.closest('.play-now-btn');
                if (!(q || p)) return;
                // Only handle quick play/queue for plain track cards.
                // Albums/playlists are handled by their own handlers (to avoid ghost items).
                const container = t.closest('.result-item');
                const type = container?.getAttribute('data-type');
                if (type && type !== 'track') return;
                if (!window.app) return;
                // Prefer explicit data attributes on the button
                const srcEl = q || p;
                const id = srcEl.getAttribute('data-id') || container?.getAttribute('data-id');
                if (!id) return; // no-op if we can't resolve an id
                const title = srcEl.getAttribute('data-title') || (container?.querySelector('.result-title')?.textContent) || '';
                const artist = srcEl.getAttribute('data-artist') || (container?.querySelector('.result-artist')?.textContent) || '';
                const service = srcEl.getAttribute('data-service') || window.app.currentService;
                const data = { id, title, artist, album: '', service, type: 'track', rawData: {} };
                ev.preventDefault(); ev.stopPropagation();
                if (p) {
                    window.app.playNow(data);
                } else {
                    if (!window.app.playQueue) window.app.playQueue = [];
                    const exists = window.app.playQueue.find((x) => String(x.id) === String(data.id) && (x.service||'') === (data.service||''));
                    if (!exists) {
                        window.app.playQueue.push(data);
                        if (window.app.persistQueue) window.app.persistQueue();
                    }
                    // Only refresh queue if overlay open; don't auto-open
                    const overlay = document.getElementById('player-fs-overlay');
                    if (overlay && overlay.classList.contains('show') && window.app.renderFullQueue) window.app.renderFullQueue();
                    window.app.showNotification && window.app.showNotification('Added to queue', 'success');
                }
            });
        });
