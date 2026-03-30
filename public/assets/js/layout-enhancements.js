      (function(){
        function makeIconHTML(inner){ var svg=document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('width','20'); svg.setAttribute('height','20'); svg.setAttribute('fill','none'); svg.setAttribute('stroke','currentColor'); svg.setAttribute('stroke-width','2'); svg.innerHTML = inner; return svg; }
        function ensureMiniRail(){
          if (document.getElementById('mini-rail')) return document.getElementById('mini-rail');
          var rail=document.createElement('div'); rail.className='mini-rail'; rail.id='mini-rail';
          var mkBtn=function(title, id, svgInner){ var b=document.createElement('button'); b.className='mini-rail-btn'; b.title=title; b.setAttribute('data-target',id); b.appendChild(makeIconHTML(svgInner)); return b; };
          
          var home = mkBtn('Home','home','<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/>' );
          var search = mkBtn('Search','search','<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>' );
          var downloads = mkBtn('Downloads','downloads','<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" x2="12" y1="15" y2="3"/>' );
          var url = mkBtn('URL Download','url-download','<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>' );
          var playlists = mkBtn('Playlists','playlists','<line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="14" y1="12" y2="12"/><line x1="4" x2="10" y1="18" y2="18"/><polyline points="16,10 20,12 16,14"/>' );
          var player = mkBtn('Player','player','<circle cx="12" cy="12" r="10"/><polygon points="10,8 16,12 10,16" fill="currentColor" stroke="none"/>' );
          var settings = mkBtn('Settings','settings','<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>' );
          var topPad=document.createElement('div'); topPad.style.height='6px';
          rail.appendChild(topPad); rail.appendChild(home); rail.appendChild(search); rail.appendChild(downloads); rail.appendChild(url); rail.appendChild(playlists); rail.appendChild(player); rail.appendChild(settings);
          var spacer=document.createElement('div'); spacer.className='mini-spacer'; rail.appendChild(spacer);
          document.body.appendChild(rail);

          // Clicks
          rail.addEventListener('click', function(ev){
            var btn = ev.target.closest && ev.target.closest('.mini-rail-btn');
            if (!btn) return;
            var id = btn.getAttribute('data-target');
            try {
              if (window.app) {
                var overlay = document.getElementById('player-fs-overlay');
                var overlayVisible = overlay && overlay.classList.contains('show');
                if (id !== 'player' && overlayVisible && typeof window.app.hideFullPlayer === 'function') {
                  window.app.hideFullPlayer();
                }
                if (typeof window.app.navigateToPage === 'function') {
                  window.app.navigateToPage(id);
                }
                if (id === 'player' && !overlayVisible && typeof window.app.showFullPlayer === 'function') {
                  window.app.showFullPlayer();
                }
              }
            } catch(_e) {}
          });

          // Active state sync
          var setActive=function(page){ rail.querySelectorAll('.mini-rail-btn').forEach(function(b){ if(b.getAttribute('data-target')!=='__menu'){ b.classList.toggle('active', b.getAttribute('data-target')===page); } }); };
          // Patch navigateToPage to also set active
          var installSync=function(){ try{ if(!window.app || !window.app.navigateToPage) return setTimeout(installSync, 300); if(window.app.__miniNavPatched) return; var orig=window.app.navigateToPage.bind(window.app); window.app.navigateToPage=function(page){ setActive(page); return orig(page); }; window.app.__miniNavPatched=true; setActive(window.app.currentPage||'home');
            // sync body class for mini rail when sidebar is hidden
            var appContainer=document.querySelector('.app-container');
            var apply=function(){ if(!appContainer) return; var visible = appContainer.classList.contains('sidebar-hidden'); document.body.classList.toggle('mini-rail-visible', visible); };
            apply();
            var menuBtn=document.getElementById('mobile-menu-btn'); if(menuBtn){ menuBtn.addEventListener('click', function(){ setTimeout(apply, 10); }); }
          }catch(_e){ setTimeout(installSync, 600); } };
          installSync();
          return rail;
        }
        // Build on ready
        document.addEventListener('DOMContentLoaded', ensureMiniRail);
        // Also when app loads (in case of different load order)
        setTimeout(ensureMiniRail, 800);
        // Delegate artist modal download button
        document.addEventListener('click', function(e){
          var btn = e.target && e.target.closest && e.target.closest('.artist-download');
          if(!btn) return;
          try{
            var id = btn.getAttribute('data-id');
            var type = btn.getAttribute('data-type');
            var title = btn.getAttribute('data-title')||'';
            var artist = btn.getAttribute('data-artist')||'';
            var svc = (window.app && window.app.currentService) || 'deezer';
            var toClient = !!(document.getElementById('client-downloads') && document.getElementById('client-downloads').checked);
            var item = { id:id, type:type, title:title, artist:artist, service: svc };
            if(type==='track'){
              if(toClient && window.app && window.app.downloadTrackToClient) { window.app.downloadTrackToClient(item); return; }
              if(window.app && window.app.downloadItem) { window.app.downloadItem(item); return; }
            } else if(type==='album' || type==='playlist'){
              if(window.app && window.app.downloadItem) { window.app.downloadItem(item); return; }
            }
          }catch(_e){}
        });
      })();

(function(){
  function byId(id){ return document.getElementById(id); }
  function setVal(id, v){ var el = byId(id); if(el){ el.value = v; el.dispatchEvent(new Event('input',{bubbles:true})); } }
  function wire(id, fn){ var b=byId(id); if(b) b.addEventListener('click', fn); }
  // Toggle vars panels
  wire('dz-vars-toggle', function(){ var b=byId('dz-vars'); if(b) b.style.display = (b.style.display==='none'||!b.style.display)?'block':'none'; });
  wire('qb-vars-toggle', function(){ var b=byId('qb-vars'); if(b) b.style.display = (b.style.display==='none'||!b.style.display)?'block':'none'; });
  // Deezer presets
  wire('dz-preset-track', function(){ setVal('layout-track','{ALB_TITLE}/{SNG_TITLE}'); });
  wire('dz-preset-album', function(){ setVal('layout-album','{ART_NAME}/{ALB_TITLE}/{SNG_TITLE}'); });
  wire('dz-preset-artist', function(){ setVal('layout-artist','{ALB_TITLE}/{SNG_TITLE}'); });
  wire('dz-preset-server', function(){ setVal('layout-playlist','{ART_NAME}/{ART_NAME} - {ALB_TITLE}/{NO_TRACK_NUMBER}{ART_NAME} - {SNG_TITLE}'); });
  // Qobuz presets
  wire('qb-preset-track', function(){ setVal('layout-qobuz-track','{alb_title}/{no_track_number}{title}'); });
  wire('qb-preset-album', function(){ setVal('layout-qobuz-album','{alb_artist}/{alb_title}/{title}'); });
  wire('qb-preset-artist', function(){ setVal('layout-qobuz-album','{alb_artist}/{alb_title}/{no_track_number}{alb_artist} - {title}'); });
  wire('qb-preset-server', function(){ setVal('layout-qobuz-playlist','{alb_artist}/{alb_artist} - {alb_title}/{alb_artist} - {title}'); });
})();
