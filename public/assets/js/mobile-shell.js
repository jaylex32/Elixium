(function () {
    const MOBILE_BREAKPOINT = 860;

    const pageTitles = {
        home: 'Home',
        search: 'Search',
        downloads: 'Downloads',
        watchlist: 'Watchlist',
        genres: 'Genres',
        'url-download': 'URL Download',
        playlists: 'Playlists',
        settings: 'Settings',
        player: 'Player',
    };

    const icon = (paths) => `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            ${paths}
        </svg>
    `;

    class ElixiumMobileShell {
        constructor() {
            this.mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
            this.railCleanupMap = new WeakMap();
            this.railCarouselMap = new WeakMap();
            window.__elixiumMobileShell = this;
            this.injectChrome();
            this.bindChrome();
            this.watchMode();
            this.waitForApp();
        }

        injectChrome() {
            if (document.getElementById('mobile-shell-topbar')) return;

            const topbar = document.createElement('div');
            topbar.className = 'mobile-shell-topbar';
            topbar.id = 'mobile-shell-topbar';
            topbar.innerHTML = `
                <div class="mobile-shell-topbar-inner">
                    <button class="mobile-shell-icon-btn" id="mobile-shell-home" aria-label="Go home" title="Home">
                        ${icon('<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/>')}
                    </button>
                    <div class="mobile-shell-titleblock">
                        <div class="mobile-shell-kicker">Elixium Mobile</div>
                        <div class="mobile-shell-title" id="mobile-shell-title">Home</div>
                    </div>
                    <div class="mobile-shell-service" id="mobile-shell-service">
                        <span class="mobile-shell-service-dot"></span>
                        <span id="mobile-shell-service-label">Deezer</span>
                    </div>
                </div>
            `;

            const backdrop = document.createElement('div');
            backdrop.className = 'mobile-shell-sheet-backdrop';
            backdrop.id = 'mobile-shell-sheet-backdrop';

            const sheet = document.createElement('div');
            sheet.className = 'mobile-shell-sheet';
            sheet.id = 'mobile-shell-sheet';
            sheet.innerHTML = `
                    <div class="mobile-shell-sheet-inner">
                        <div class="mobile-shell-sheet-grabber"></div>
                        <div class="mobile-shell-sheet-header">
                        <div>
                            <div class="mobile-shell-sheet-title">More</div>
                            <div class="mobile-shell-sheet-copy">Tools, playlists, settings, and service controls.</div>
                        </div>
                        <button class="mobile-shell-icon-btn" id="mobile-shell-sheet-close" aria-label="Close mobile menu" title="Close">
                            ${icon('<path d="M6 6 18 18"/><path d="M6 18 18 6"/>')}
                        </button>
                    </div>
                    <div class="mobile-shell-service-switch">
                        <button class="mobile-shell-service-btn" type="button" data-mobile-service="deezer">
                            <span class="mobile-shell-service-copy">
                                <strong>Deezer</strong>
                                <small>Search, stream, and download</small>
                            </span>
                            <span class="mobile-shell-service-state">Active</span>
                        </button>
                        <button class="mobile-shell-service-btn" type="button" data-mobile-service="qobuz">
                            <span class="mobile-shell-service-copy">
                                <strong>Qobuz</strong>
                                <small>Hi-res search and downloads</small>
                            </span>
                            <span class="mobile-shell-service-state">Hi-Res</span>
                        </button>
                    </div>
                    <div class="mobile-shell-sheet-links">
                        <button class="mobile-shell-sheet-link" type="button" data-mobile-page="watchlist">
                            <span class="mobile-shell-sheet-link-icon">
                                ${icon('<path d="m12 17.27-5.18 3.05 1.4-5.88L3 9.76l6.09-.51L12 3.8l2.91 5.45 6.09.51-5.22 4.68 1.4 5.88z"/>')}
                            </span>
                            <span class="mobile-shell-sheet-link-copy">
                                <strong>Watchlist</strong>
                                <small>Follow Qobuz artists and review new albums</small>
                            </span>
                            <span class="mobile-shell-sheet-link-arrow">
                                ${icon('<path d="m9 18 6-6-6-6"/>')}
                            </span>
                        </button>
                        <button class="mobile-shell-sheet-link" type="button" data-mobile-page="genres">
                            <span class="mobile-shell-sheet-link-icon">
                                ${icon('<rect x="3" y="4" width="7" height="7" rx="1.5"/><rect x="14" y="4" width="7" height="7" rx="1.5"/><rect x="3" y="13" width="7" height="7" rx="1.5"/><rect x="14" y="13" width="7" height="7" rx="1.5"/>')}
                            </span>
                            <span class="mobile-shell-sheet-link-copy">
                                <strong>Genres</strong>
                                <small>Browse Qobuz genres and open albums by style</small>
                            </span>
                            <span class="mobile-shell-sheet-link-arrow">
                                ${icon('<path d="m9 18 6-6-6-6"/>')}
                            </span>
                        </button>
                        <button class="mobile-shell-sheet-link" type="button" data-mobile-page="url-download">
                            <span class="mobile-shell-sheet-link-icon">
                                ${icon('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>')}
                            </span>
                            <span class="mobile-shell-sheet-link-copy">
                                <strong>URL Download</strong>
                                <small>Paste and route links instantly</small>
                            </span>
                            <span class="mobile-shell-sheet-link-arrow">
                                ${icon('<path d="m9 18 6-6-6-6"/>')}
                            </span>
                        </button>
                        <button class="mobile-shell-sheet-link" type="button" data-mobile-page="playlists">
                            <span class="mobile-shell-sheet-link-icon">
                                ${icon('<line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="14" y1="12" y2="12"/><line x1="4" x2="10" y1="18" y2="18"/><polyline points="16,10 20,12 16,14"/>')}
                            </span>
                            <span class="mobile-shell-sheet-link-copy">
                                <strong>Playlists</strong>
                                <small>Saved lists and playlist tools</small>
                            </span>
                            <span class="mobile-shell-sheet-link-arrow">
                                ${icon('<path d="m9 18 6-6-6-6"/>')}
                            </span>
                        </button>
                        <button class="mobile-shell-sheet-link" type="button" data-mobile-page="settings">
                            <span class="mobile-shell-sheet-link-icon">
                                ${icon('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>')}
                            </span>
                            <span class="mobile-shell-sheet-link-copy">
                                <strong>Settings</strong>
                                <small>Theme, quality, folders, and controls</small>
                            </span>
                            <span class="mobile-shell-sheet-link-arrow">
                                ${icon('<path d="m9 18 6-6-6-6"/>')}
                            </span>
                        </button>
                    </div>
                </div>
            `;

            const bottomNav = document.createElement('div');
            bottomNav.className = 'mobile-shell-bottomnav';
            bottomNav.id = 'mobile-shell-bottomnav';
            bottomNav.innerHTML = `
                <div class="mobile-shell-bottomnav-inner">
                    <button class="mobile-shell-nav-btn active" type="button" data-mobile-page="home">
                        ${icon('<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/>')}
                        <span>Home</span>
                    </button>
                    <button class="mobile-shell-nav-btn" type="button" data-mobile-page="search">
                        ${icon('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>')}
                        <span>Search</span>
                    </button>
                    <button class="mobile-shell-nav-btn" type="button" data-mobile-page="downloads">
                        ${icon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" x2="12" y1="15" y2="3"/>')}
                        <span>Downloads</span>
                        <span class="mobile-shell-nav-badge" id="mobile-download-badge">0</span>
                    </button>
                    <button class="mobile-shell-nav-btn" type="button" data-mobile-page="player">
                        ${icon('<circle cx="12" cy="12" r="10"/><polygon points="10,8 16,12 10,16" fill="currentColor" stroke="none"/>')}
                        <span>Player</span>
                        <span class="mobile-shell-nav-badge" id="mobile-player-badge">0</span>
                    </button>
                    <button class="mobile-shell-nav-btn" type="button" data-mobile-page="more">
                        ${icon('<circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/>')}
                        <span>More</span>
                    </button>
                </div>
            `;

            document.body.appendChild(topbar);
            document.body.appendChild(backdrop);
            document.body.appendChild(sheet);
            document.body.appendChild(bottomNav);
        }

        bindChrome() {
            document.getElementById('mobile-shell-home')?.addEventListener('click', () => {
                if (this.isPlayerOpen() && window.app && typeof window.app.hideFullPlayer === 'function') {
                    window.app.hideFullPlayer();
                    return;
                }
                this.navigate('home');
            });

            document.getElementById('mobile-shell-service')?.addEventListener('click', () => {
                this.openSheet();
            });

            document.getElementById('mobile-shell-sheet-close')?.addEventListener('click', () => {
                this.closeSheet();
            });

            document.getElementById('mobile-shell-sheet-backdrop')?.addEventListener('click', () => {
                this.closeSheet();
            });

            document.querySelectorAll('[data-mobile-page]').forEach((button) => {
                button.addEventListener('click', () => {
                    const page = button.getAttribute('data-mobile-page');
                    if (!page) return;
                    if (page === 'more') {
                        this.openSheet();
                        return;
                    }
                    this.closeSheet();
                    this.navigate(page);
                });
            });

            document.querySelectorAll('[data-mobile-service]').forEach((button) => {
                button.addEventListener('click', () => {
                    if (!window.app) return;
                    const service = button.getAttribute('data-mobile-service');
                    if (!service) return;
                    window.app.switchService(service);
                    this.closeSheet();
                });
            });

            const nowPlayingOpen = document.getElementById('mobile-home-now-playing-open');

            nowPlayingOpen?.addEventListener('click', () => {
                if (!window.app) return;
                if ((window.app.playQueue?.length || 0) > 0 || window.app.audio?.src) {
                    window.app.showFullPlayer();
                }
            });

            nowPlayingOpen?.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                nowPlayingOpen.click();
            });

            document.getElementById('mobile-home-play-toggle')?.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!window.app || !window.app.audio) return;

                if (!window.app.audio.src) {
                    if (window.app.nowPlayingIndex === -1 && (window.app.playQueue?.length || 0) > 0) {
                        window.app.nowPlayingIndex = 0;
                    }
                    if (window.app.nowPlayingIndex >= 0 && typeof window.app._loadAndPlayCurrent === 'function') {
                        window.app._loadAndPlayCurrent();
                        this.syncHomeShell();
                        return;
                    }
                }

                if (window.app.audio.paused) {
                    window.app.audio.play().catch(() => {});
                } else {
                    window.app.audio.pause();
                }
                this.syncHomeShell();
            });

            document.getElementById('mobile-home-play-next')?.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!window.app || typeof window.app.playNext !== 'function') return;
                window.app.playNext();
                this.syncHomeShell();
            });
        }

        watchMode() {
            const apply = () => {
                const isMobile = window.innerWidth <= MOBILE_BREAKPOINT && this.mediaQuery.matches;
                document.body.classList.toggle('mobile-shell', isMobile);

                const mobileHomeShell = document.querySelector('#home-page .mobile-home-shell');
                if (mobileHomeShell) {
                    if (isMobile) {
                        mobileHomeShell.hidden = false;
                        mobileHomeShell.removeAttribute('aria-hidden');
                        mobileHomeShell.setAttribute(
                            'style',
                            'display:grid !important; visibility:visible !important; max-height:none !important; overflow:visible !important;'
                        );
                    } else {
                        mobileHomeShell.hidden = true;
                        mobileHomeShell.setAttribute('aria-hidden', 'true');
                        mobileHomeShell.setAttribute(
                            'style',
                            'display:none !important; visibility:hidden !important; max-height:0 !important; overflow:hidden !important; margin:0 !important; padding:0 !important; border:0 !important; box-shadow:none !important;'
                        );
                    }
                }

                if (!isMobile) {
                    this.closeSheet();
                    document.body.classList.remove('mobile-player-open');
                }
                this.syncAll();
            };

            if (this.mediaQuery.addEventListener) {
                this.mediaQuery.addEventListener('change', apply);
            } else {
                this.mediaQuery.addListener(apply);
            }

            window.addEventListener('resize', apply);
            apply();
        }

        waitForApp() {
            const attach = () => {
                if (!window.app) {
                    window.setTimeout(attach, 120);
                    return;
                }

                this.patchApp(window.app);
                this.syncAll();
            };

            attach();
        }

        patchApp(app) {
            if (app.__mobileShellPatched) return;

            const wrap = (methodName, after) => {
                if (typeof app[methodName] !== 'function') return;
                const original = app[methodName].bind(app);
                app[methodName] = (...args) => {
                    const result = original(...args);
                    after(...args);
                    return result;
                };
            };

            wrap('navigateToPage', () => this.syncAll());
            wrap('switchService', () => this.syncAll());
            wrap('updateQueueUI', () => this.syncCounts());
            wrap('showFullPlayer', () => {
                document.body.classList.add('mobile-player-open');
                this.syncAll();
            });
            wrap('hideFullPlayer', () => {
                document.body.classList.remove('mobile-player-open');
                this.syncAll();
            });
            wrap('renderRecentSearches', () => this.syncAll());
            wrap('renderRecentDownloads', () => this.syncAll());
            wrap('refreshFullPlayerMeta', () => this.syncHomeShell());
            wrap('renderFullQueue', () => this.syncCounts());

            const overlay = document.getElementById('player-fs-overlay');
            if (overlay) {
                const observer = new MutationObserver(() => {
                    const open = overlay.classList.contains('show');
                    document.body.classList.toggle('mobile-player-open', open);
                    this.syncAll();
                });
                observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });
            }

            if (app.audio && !app.audio.__mobileHomePatched) {
                ['timeupdate', 'play', 'pause', 'loadedmetadata', 'ended', 'emptied'].forEach((eventName) => {
                    app.audio.addEventListener(eventName, () => this.syncHomeShell());
                });
                app.audio.__mobileHomePatched = true;
            }

            app.__mobileShellPatched = true;
            this.initHorizontalRails();
        }

        navigate(page) {
            if (!window.app) return;

            if (page === 'player') {
                window.app.showFullPlayer();
                return;
            }

            window.app.navigateToPage(page);
        }

        openSheet() {
            if (!this.mediaQuery.matches) return;
            document.getElementById('mobile-shell-sheet')?.classList.add('show');
            document.getElementById('mobile-shell-sheet-backdrop')?.classList.add('show');
        }

        closeSheet() {
            document.getElementById('mobile-shell-sheet')?.classList.remove('show');
            document.getElementById('mobile-shell-sheet-backdrop')?.classList.remove('show');
        }

        syncAll() {
            if (!window.app) return;
            this.syncPrimaryButton();
            this.syncTitle();
            this.syncService();
            this.syncCounts();
            this.syncActiveNav();
            this.syncHomeShell();
        }

        initHorizontalRails() {
            if (!this.mediaQuery.matches) return;
            document.querySelectorAll('#home-page .content-grid.mobile-home-rail').forEach((rail) => {
                this.initHorizontalRail(rail);
            });
        }

        initHorizontalRail(rail) {
            if (!this.mediaQuery.matches || !rail) return;

            const cleanup = this.railCleanupMap.get(rail);
            if (cleanup) {
                cleanup();
                this.railCleanupMap.delete(rail);
            }

            rail.style.touchAction = 'pan-y';
            rail.style.webkitOverflowScrolling = 'touch';

            let track = rail.querySelector('.mobile-home-embla-track');
            if (!track) {
                track = document.createElement('div');
                track.className = 'mobile-home-embla-track';
                while (rail.firstChild) {
                    track.appendChild(rail.firstChild);
                }
                rail.appendChild(track);
            } else {
                Array.from(rail.childNodes).forEach((node) => {
                    if (node !== track) track.appendChild(node);
                });
            }

            if (typeof window.EmblaCarousel !== 'function') return;

            const embla = window.EmblaCarousel(rail, {
                align: 'start',
                containScroll: false,
                dragFree: true,
                loop: false,
                skipSnaps: true,
                slidesToScroll: 1
            });

            this.railCarouselMap.set(rail, embla);

            this.railCleanupMap.set(rail, () => {
                try {
                    embla.destroy();
                } catch {}
                this.railCarouselMap.delete(rail);
            });
        }

        isPlayerOpen() {
            const overlay = document.getElementById('player-fs-overlay');
            return !!(overlay && overlay.classList.contains('show'));
        }

        syncPrimaryButton() {
            const button = document.getElementById('mobile-shell-home');
            if (!button) return;

            if (this.isPlayerOpen()) {
                button.setAttribute('aria-label', 'Close player');
                button.setAttribute('title', 'Close player');
                button.innerHTML = icon('<path d="M18 6 6 18"/><path d="M6 6 18 18"/>');
                return;
            }

            button.setAttribute('aria-label', 'Go home');
            button.setAttribute('title', 'Home');
            button.innerHTML = icon('<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/>');
        }

        syncTitle() {
            const titleEl = document.getElementById('mobile-shell-title');
            if (!titleEl || !window.app) return;

            const playerOpen = this.isPlayerOpen();
            const page = playerOpen ? 'player' : (window.app.currentPage || 'home');
            titleEl.textContent = pageTitles[page] || 'Elixium';
        }

        syncService() {
            if (!window.app) return;

            const label = document.getElementById('mobile-shell-service-label');
            if (label) {
                const service = window.app.currentService || 'deezer';
                label.textContent = service.charAt(0).toUpperCase() + service.slice(1);
            }

            document.querySelectorAll('[data-mobile-service]').forEach((button) => {
                button.classList.toggle('active', button.getAttribute('data-mobile-service') === window.app.currentService);
            });
        }

        syncHomeShell() {
            if (!window.app) return;

            const activeService = window.app.homeService || window.app.currentService || 'deezer';
            document.querySelectorAll('.mobile-home-service-card[data-service]').forEach((button) => {
                button.classList.toggle('active', button.getAttribute('data-service') === activeService);
            });

            const title = document.getElementById('mobile-home-now-playing-title');
            const artist = document.getElementById('mobile-home-now-playing-artist');
            const time = document.getElementById('mobile-home-now-playing-time');
            const progress = document.getElementById('mobile-home-now-playing-progress');
            const cover = document.getElementById('mobile-home-now-playing-cover');
            const playToggle = document.getElementById('mobile-home-play-toggle');
            const nextButton = document.getElementById('mobile-home-play-next');
            const openButton = document.getElementById('mobile-home-now-playing-open');

            if (!title || !artist || !time || !progress || !cover || !playToggle || !nextButton || !openButton) {
                return;
            }

            const queue = Array.isArray(window.app.playQueue) ? window.app.playQueue : [];
            const current = queue[window.app.nowPlayingIndex] || null;
            const isPlayable = !!(current || window.app.audio?.src);
            const isPlaying = isPlayable && !!window.app.audio && !window.app.audio.paused;
            const duration = Number.isFinite(window.app.audio?.duration) ? window.app.audio.duration : 0;
            const currentTime = Number.isFinite(window.app.audio?.currentTime) ? window.app.audio.currentTime : 0;
            const progressRatio = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0;

            if (current) {
                title.textContent = current.title || 'Untitled track';
                artist.textContent = current.artist || current.album || 'Ready to continue listening';
                const image = typeof window.app.getCoverArtUrl === 'function' ? window.app.getCoverArtUrl(current) : '';
                cover.innerHTML = image
                    ? `<img src="${image}" alt="${this.escapeHtml(current.title || 'Artwork')}">`
                    : '<div class="result-cover-placeholder">🎵</div>';
                openButton.disabled = false;
            } else {
                title.textContent = 'Nothing playing';
                artist.textContent = 'Queue a track to keep listening here.';
                cover.innerHTML = '<div class="result-cover-placeholder">🎵</div>';
                openButton.disabled = true;
            }

            time.textContent = `${this.formatTime(currentTime)} / ${this.formatTime(duration)}`;
            progress.style.width = `${Math.round(progressRatio * 100)}%`;
            playToggle.innerHTML = isPlaying
                ? icon('<rect x="7" y="5" width="3" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="3" height="14" rx="1" fill="currentColor" stroke="none"/>')
                : icon('<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>');
            nextButton.disabled = queue.length < 2;
        }

        formatTime(seconds) {
            const totalSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
            const minutes = Math.floor(totalSeconds / 60);
            const remainder = totalSeconds % 60;
            return `${minutes}:${String(remainder).padStart(2, '0')}`;
        }

        escapeHtml(value) {
            return String(value)
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('"', '&quot;')
                .replaceAll("'", '&#39;');
        }

        syncCounts() {
            if (!window.app) return;

            const downloadCount = Array.isArray(window.app.downloadQueue) ? window.app.downloadQueue.length : 0;
            const playerCount = Array.isArray(window.app.playQueue) ? window.app.playQueue.length : 0;

            this.setBadge('mobile-download-badge', downloadCount);
            this.setBadge('mobile-player-badge', playerCount);
        }

        setBadge(id, value) {
            const badge = document.getElementById(id);
            if (!badge) return;

            badge.textContent = String(value);
            badge.classList.toggle('show', value > 0);
        }

        syncActiveNav() {
            if (!window.app) return;

            const playerOpen = this.isPlayerOpen();
            const active = playerOpen ? 'player' : (window.app.currentPage || 'home');

            document.querySelectorAll('.mobile-shell-nav-btn').forEach((button) => {
                const target = button.getAttribute('data-mobile-page');
                button.classList.toggle('active', target === active);
            });
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        window.elixiumMobileShell = new ElixiumMobileShell();
    });
})();
