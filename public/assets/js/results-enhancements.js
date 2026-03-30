      (function(){
        function ready(fn){ if(document.readyState!=='loading'){ fn(); } else { document.addEventListener('DOMContentLoaded', fn); } }

        function getItemFromCard(card){
          var id = card && card.getAttribute('data-id') ? String(card.getAttribute('data-id')) : '';
          var titleEl = card ? card.querySelector('.result-title') : null;
          var artistEl = card ? card.querySelector('.result-artist') : null;
          var title = titleEl && titleEl.textContent ? titleEl.textContent : 'Unknown';
          var artist = artistEl && artistEl.textContent ? artistEl.textContent : 'Unknown Artist';
          var service = (window.app && window.app.currentService) ? window.app.currentService : 'deezer';
          return { id: id, title: title, artist: artist, album: '', service: service, type: 'track', rawData: {} };
        }

        function updateQueueBadge(){
          try {
            var btn = document.querySelector('button.nav-item[data-page="player"]');
            if(!btn) return;
            var badge = document.getElementById('queue-badge');
            if(!badge){
              badge = document.createElement('span');
              badge.id = 'queue-badge';
              badge.className = 'download-badge';
              badge.style.transform = 'scale(1)';
              btn.appendChild(badge);
            }
            var n = 0;
            if(window.app && window.app.playQueue){ n = window.app.playQueue.length; }
            else {
              try { var saved = localStorage.getItem('player.queue'); if(saved){ var arr = JSON.parse(saved); if(Array.isArray(arr)) n = arr.length; } } catch(_e){}
            }
            badge.textContent = String(n);
            badge.style.display = n > 0 ? 'inline-flex' : 'none';
          } catch(_e){}
        }

        function ensureButtons(){
          var cards = document.querySelectorAll('.result-item[data-type="track"]');
          for(var i=0;i<cards.length;i++){
            var card = cards[i];
            if(card.getAttribute('data-app-enhanced') === '1') continue;
            var actions = card.querySelector('.result-actions');
            if(!actions){ actions = document.createElement('div'); actions.className = 'result-actions'; var content = card.querySelector('.result-content') || card; content.appendChild(actions); }

            // Avoid duplicates: if any play/queue button already exists, don't add ours
            var hasPlay = actions.querySelector('.app-play-now') || actions.querySelector('.play-now-btn') || actions.querySelector('button[title="Play"]');
            var hasQueue = actions.querySelector('.more-btn') || actions.querySelector('.app-queue') || actions.querySelector('.queue-btn') || actions.querySelector('button[title*="Queue"]');

            var playBtn = null, queueBtn = null, moreBtn = null;
            if(!hasPlay){
              playBtn = document.createElement('button');
              playBtn.className = 'discovery-action-btn-round app-play-now';
              playBtn.title = 'Play';
              playBtn.textContent = '▶';
              actions.appendChild(playBtn);
            }
            if(!hasQueue){
              moreBtn = document.createElement('button');
              moreBtn.className = 'discovery-action-btn-round more-btn';
              moreBtn.title = 'More';
              actions.appendChild(moreBtn);
            }

            if(playBtn) playBtn.addEventListener('click', function(ev){
              ev.stopPropagation();
              var parent = ev.currentTarget.closest('.result-item');
              var item = getItemFromCard(parent);
              if(window.app && window.app.playNow){ window.app.playNow(item); }
              updateQueueBadge();
            });
            if(moreBtn) moreBtn.addEventListener('click', function(ev){
              ev.stopPropagation();
              try{
                var parent = ev.currentTarget.closest('.result-item');
                var item = getItemFromCard(parent);
                // remove any open menu
                var openMenus = document.querySelectorAll('.action-menu');
                for (var k=0;k<openMenus.length;k++){ try{ openMenus[k].remove(); }catch(_){} }
                var menu = document.createElement('div');
                menu.className = 'action-menu';
                var addQ = document.createElement('button'); addQ.textContent = 'Add to Queue';
                var addP = document.createElement('button'); addP.textContent = 'Add to Playlist…';
                menu.appendChild(addQ); menu.appendChild(addP);
                document.body.appendChild(menu);
                var rect = ev.currentTarget.getBoundingClientRect();
                menu.style.left = Math.min(window.innerWidth - 200, rect.left) + 'px';
                menu.style.top = (rect.bottom + 6) + 'px';
                var cleanup = function(){ try { menu.remove(); } catch(_){} window.removeEventListener('click', outside, true); };
                var outside = function(e){ if (!menu.contains(e.target)) cleanup(); };
                setTimeout(function(){ window.addEventListener('click', outside, true); },0);
                addQ.addEventListener('click', function(){ try { if(window.app && window.app.addSingleToQueue){ window.app.addSingleToQueue(item); } } finally { cleanup(); } });
                addP.addEventListener('click', function(){ try { if(window.app && window.app.addTrackToPlaylist){ window.app.addTrackToPlaylist(item); } } finally { cleanup(); } });
              }catch(_e){}
            });

            // Mark as enhanced to avoid re-adding later
            card.setAttribute('data-app-enhanced','1');
          }
        }

        function addAlbumPlaylistQueueAll(){
          var types = ['album','playlist'];
          for(var t=0;t<types.length;t++){
            var sel = '.result-item[data-type="'+types[t]+'"]';
            var cards = document.querySelectorAll(sel);
            for(var i=0;i<cards.length;i++){
              var card = cards[i];
              if(card.getAttribute('data-app-qa')==='1') continue;
              var actions = card.querySelector('.result-actions');
              if(!actions){ actions = document.createElement('div'); actions.className='result-actions'; var cont = card.querySelector('.result-content')||card; cont.appendChild(actions); }
              // Skip if a queue-all button already exists
              var existingQa = actions.querySelector('.app-queue-all') || actions.querySelector('button[title="Add All to Queue"]');
              var qaBtn = existingQa || document.createElement('button');
              if(!existingQa){
                qaBtn.className = 'discovery-action-btn-round app-queue-all';
                qaBtn.title = 'Add All to Queue';
                qaBtn.textContent = '+';
                actions.appendChild(qaBtn);
              }
              qaBtn.addEventListener('click', (function(card,type){ return function(ev){
                ev.stopPropagation();
                var id = card.getAttribute('data-id');
                var titleEl = card.querySelector('.result-title');
                var artistEl = card.querySelector('.result-artist');
                var title = titleEl && titleEl.textContent ? titleEl.textContent : '';
                var artist = artistEl && artistEl.textContent ? artistEl.textContent : '';
                if(!(window.app && window.app.socket)){ if(window.app && window.app.showNotification){ window.app.showNotification('Socket not ready','error');} return; }
                var svc = window.app.currentService || 'deezer';
                var onceAlbum = function(data){ try{ if(String(data.albumId)===String(id)){ window.app.socket.off('albumTracks', onceAlbum); enqueueTracks(data.tracks, title, artist); } }catch(_e){} };
                var oncePlaylist = function(data){ try{ if(String(data.playlistId)===String(id)){ window.app.socket.off('playlistTracks', oncePlaylist); enqueueTracks(data.tracks, title, artist); } }catch(_e){} };
                function enqueueTracks(tracks, altTitle, altArtist){
                  if(!tracks || !tracks.length) { if(window.app.showNotification){ window.app.showNotification('No tracks found','error'); } return; }
                  if(!window.app.playQueue) window.app.playQueue = [];
                  var added=0;
                  for(var k=0;k<tracks.length;k++){
                    var tr = tracks[k];
                    if(!tr || !(tr.SNG_ID || tr.id)) continue; // skip invalid/ghost
                    var tid = String(tr.SNG_ID || tr.id || (id+'_'+(k+1)));
                    var ttitle = tr.SNG_TITLE || tr.title || altTitle || 'Unknown';
                    var tartist = tr.ART_NAME || (tr.performer && tr.performer.name) || altArtist || 'Unknown Artist';
                    var exists = window.app.playQueue.find(function(x){ return String(x.id)===tid && (x.service||'')===svc; });
                    if(!exists){ window.app.playQueue.push({ id: tid, title: ttitle, artist: tartist, album: '', service: svc, type: 'track', rawData: tr }); added++; }
                  }
                  if(window.app.persistQueue) window.app.persistQueue();
                  if(window.app.showNotification){ window.app.showNotification(String(added)+' track(s) added to queue', 'success'); }
                  var overlay = document.getElementById('player-fs-overlay');
                  if(overlay && overlay.classList.contains('show') && window.app.renderFullQueue){ window.app.renderFullQueue(); }
                  updateQueueBadge();
                }
                if(type==='album'){
                  window.app.socket.on('albumTracks', onceAlbum);
                  window.app.socket.emit('getAlbumTracks', { albumId: id, service: svc, albumData: { id: id, title: title, artist: artist } });
                } else {
                  window.app.socket.on('playlistTracks', oncePlaylist);
                  window.app.socket.emit('getPlaylistTracks', { playlistId: id, service: svc, playlistData: { id: id, title: title, artist: artist } });
                }
              }; })(card, types[t]));
              card.setAttribute('data-app-qa','1');
            }
          }
        }

        function wrapPlayNowForBadge(){
          try{
            if(!window.app || window.app.__playWrapInstalled) return;
            var orig = window.app.playNow && window.app.playNow.bind(window.app);
            if(orig){
              window.app.playNow = function(){ var out = orig.apply(window.app, arguments); try{ updateQueueBadge(); }catch(_e){} return out; };
              window.app.__playWrapInstalled = true;
            }
          }catch(_e){}
        }

        ready(function(){
          try{ ensureButtons(); addAlbumPlaylistQueueAll(); updateQueueBadge(); wrapPlayNowForBadge(); }catch(_e){}
          // Re-ensure on dynamic updates
          setInterval(function(){ try{ ensureButtons(); addAlbumPlaylistQueueAll(); updateQueueBadge(); }catch(_e){} }, 1500);
        });
      })();

      (function(){
        var waitApp=function(cb){ if(window.app && window.app.socket) return cb(window.app); setTimeout(function(){ waitApp(cb); },150); };
        var ensureResultsLoadMore=function(){ var grid=document.getElementById('results-grid'); if(!grid) return null; var ctl=document.getElementById('results-load-more'); if(!ctl){ ctl=document.createElement('div'); ctl.id='results-load-more'; ctl.style.display='none'; ctl.style.margin='1rem 0 2rem'; ctl.style.textAlign='center'; var btn=document.createElement('button'); btn.id='results-load-more-btn'; btn.textContent='Load More'; btn.style.padding='0.8rem 1.2rem'; btn.style.borderRadius='10px'; btn.style.border='1px solid var(--border-color)'; btn.style.background='linear-gradient(135deg, var(--surface-bg), var(--accent-bg))'; btn.style.color='var(--text-secondary)'; btn.style.cursor='pointer'; btn.addEventListener('mouseenter',function(){ btn.style.background='linear-gradient(135deg, var(--primary-accent), var(--secondary-accent))'; btn.style.color='#fff'; }); btn.addEventListener('mouseleave',function(){ btn.style.background='linear-gradient(135deg, var(--surface-bg), var(--accent-bg))'; btn.style.color='var(--text-secondary)'; }); btn.addEventListener('click', function(){ var app=window.app; if(!app) return; var q=(document.getElementById('search-input')||{value: app.searchQuery||''}).value||''; var active=document.querySelector('.filter-btn.type.active'); var type= active ? active.getAttribute('data-type') : (app.searchType||'track'); var service= app.currentService || 'deezer'; app.searchQuery=q; app.searchType=type; app.searchPageSize= app.searchPageSize || 50; app.searchOffset= app.searchOffset || 0; app.searchAppendRequested = true; app.lastSearchRequestOffset = app.searchOffset || 0; app.socket.emit('search', { query:q, service:service, type:type, limit: app.searchPageSize, offset: app.searchOffset }); }); ctl.appendChild(btn); grid.parentElement && grid.parentElement.appendChild(ctl);} return ctl; };
        var ensureArtistModal=function(){
          if(document.getElementById('artist-modal-overlay')) return;
          var style=document.createElement('style');
          style.textContent=`#artist-modal-overlay{position:fixed;inset:0;background:rgba(4,8,16,.74);backdrop-filter:blur(12px);display:none;align-items:center;justify-content:center;z-index:960}#artist-modal-overlay .artist-modal{width:min(1260px,96vw);max-height:90vh;background:linear-gradient(180deg, rgb(var(--primary-accent-rgb) / .08), transparent 22%),var(--card-bg);border:1px solid rgb(var(--primary-accent-rgb) / .16);border-radius:24px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 30px 70px rgba(0,0,0,.48)}#artist-modal-overlay .artist-header{display:flex;align-items:flex-start;justify-content:space-between;gap:1.4rem;padding:1.35rem 1.45rem 1.1rem;border-bottom:1px solid rgb(var(--primary-accent-rgb) / .16)}#artist-modal-overlay .artist-header-main{display:flex;align-items:center;gap:1rem;min-width:0}#artist-modal-overlay .artist-cover{width:92px;height:92px;border-radius:28px;overflow:hidden;background:linear-gradient(135deg, rgb(var(--primary-accent-rgb) / .26), rgb(var(--secondary-accent-rgb) / .12));display:flex;align-items:center;justify-content:center;font-size:2rem;flex-shrink:0;box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}#artist-modal-overlay .artist-cover img{width:100%;height:100%;object-fit:cover}#artist-modal-overlay .artist-kicker{font-size:.72rem;text-transform:uppercase;letter-spacing:.16em;color:var(--text-muted);margin-bottom:.35rem}#artist-modal-overlay .artist-title{font-weight:800;font-size:1.7rem;color:var(--text-primary);line-height:1.1}#artist-modal-overlay .artist-subtitle{color:var(--text-secondary);margin-top:.3rem;max-width:56ch}#artist-modal-overlay .artist-header-actions{display:flex;align-items:center;gap:.6rem;flex-shrink:0}#artist-modal-overlay .artist-chip{padding:.55rem .85rem;border-radius:999px;border:1px solid var(--border-color);background:rgb(var(--secondary-accent-rgb) / .07);font-size:.82rem;color:var(--text-secondary)}#artist-modal-overlay .artist-close{width:46px;height:46px;border-radius:999px;border:1px solid var(--border-color);background:var(--surface-bg);color:var(--text-secondary);cursor:pointer;font-size:1.25rem}#artist-modal-overlay .artist-close:hover{background:linear-gradient(135deg, var(--primary-accent), var(--secondary-accent));color:#fff;border-color:transparent}#artist-modal-overlay .artist-tabs{display:flex;gap:.7rem;padding:.95rem 1.2rem;border-bottom:1px solid var(--border-color);background:rgb(var(--secondary-accent-rgb) / .05)}#artist-modal-overlay .artist-tab{background:var(--surface-bg);border:1px solid var(--border-color);color:var(--text-secondary);padding:.72rem 1rem;border-radius:999px;cursor:pointer;font-weight:800;letter-spacing:.02em;transition:all .2s ease}#artist-modal-overlay .artist-tab:hover{transform:translateY(-1px);border-color:rgb(var(--primary-accent-rgb) / .8);color:var(--text-primary)}#artist-modal-overlay .artist-tab.active{background:linear-gradient(135deg, var(--primary-accent), var(--secondary-accent));color:#fff;border-color:transparent;box-shadow:0 12px 24px rgb(var(--primary-accent-rgb) / .24)}#artist-modal-overlay .artist-body{padding:1rem 1.2rem 0;overflow:auto;min-height:0}#artist-modal-overlay .artist-list{display:grid;gap:1rem;padding-bottom:1rem}#artist-modal-overlay .artist-list--collections{grid-template-columns:repeat(auto-fit,minmax(248px,1fr))}#artist-modal-overlay .artist-list--tracks{grid-template-columns:1fr}#artist-modal-overlay .artist-item{background:linear-gradient(180deg, rgb(var(--primary-accent-rgb) / .08), transparent 38%),var(--surface-bg);border:1px solid var(--border-color);border-radius:20px;padding:1rem;min-width:0;box-shadow:inset 0 1px 0 rgba(255,255,255,.04);transition:border-color .18s ease,transform .18s ease,background .18s ease}#artist-modal-overlay .artist-item:hover{border-color:rgb(var(--primary-accent-rgb) / .42);transform:translateY(-1px)}#artist-modal-overlay .artist-item--track{display:grid;grid-template-columns:auto auto minmax(0,1fr) auto;gap:1rem;align-items:center;padding:.95rem 1rem;border-radius:18px}#artist-modal-overlay .artist-item--collection{display:flex;flex-direction:column;gap:.9rem}#artist-modal-overlay .artist-item-head{display:flex;align-items:flex-start;gap:.9rem;min-width:0}#artist-modal-overlay .artist-track-rank{width:40px;height:40px;border-radius:14px;background:rgb(var(--secondary-accent-rgb) / .08);border:1px solid var(--border-color);display:flex;align-items:center;justify-content:center;font-size:.82rem;font-weight:800;color:var(--text-muted);flex-shrink:0}#artist-modal-overlay .artist-art{width:74px;height:74px;border-radius:18px;overflow:hidden;background:rgb(var(--secondary-accent-rgb) / .08);display:flex;align-items:center;justify-content:center;font-size:1.25rem;flex-shrink:0}#artist-modal-overlay .artist-item--track .artist-art{width:60px;height:60px;border-radius:16px}#artist-modal-overlay .artist-art img{width:100%;height:100%;object-fit:cover}#artist-modal-overlay .artist-copy{min-width:0;flex:1;display:flex;flex-direction:column;gap:.32rem}#artist-modal-overlay .artist-copy h4{margin:0;font-size:1rem;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#artist-modal-overlay .artist-item--collection .artist-copy h4{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}#artist-modal-overlay .artist-copy p{margin:0;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#artist-modal-overlay .artist-meta{font-size:.82rem;color:var(--text-muted)}#artist-modal-overlay .artist-actions{display:flex;gap:.55rem;flex-wrap:wrap;align-items:center;justify-content:flex-end}#artist-modal-overlay .artist-item--collection .artist-actions{margin-top:auto;justify-content:flex-start;padding-top:.1rem}#artist-modal-overlay .artist-action-btn{width:42px;height:42px;border-radius:14px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--border-color);background:var(--surface-bg);color:var(--text-secondary);cursor:pointer;transition:all .18s ease}#artist-modal-overlay .artist-action-btn svg{width:17px;height:17px;stroke-width:2}#artist-modal-overlay .artist-action-btn:hover{background:rgb(var(--primary-accent-rgb) / .14);color:var(--text-primary);border-color:rgb(var(--primary-accent-rgb) / .7)}#artist-modal-overlay .artist-action-btn--primary{background:linear-gradient(135deg, rgb(var(--primary-accent-rgb) / .18), rgb(var(--secondary-accent-rgb) / .16));color:var(--text-primary);border-color:rgb(var(--primary-accent-rgb) / .28)}#artist-modal-overlay .artist-empty{padding:2.8rem 1.2rem;border:1px dashed var(--border-color);border-radius:20px;text-align:center;color:var(--text-muted);background:rgb(var(--secondary-accent-rgb) / .06)}#artist-modal-overlay .artist-footer{padding:1rem 1.2rem;border-top:1px solid var(--border-color);display:flex;align-items:center;justify-content:space-between;gap:1rem;background:rgb(var(--secondary-accent-rgb) / .04)}#artist-modal-overlay .artist-status{color:var(--text-muted);font-size:.92rem}#artist-modal-overlay .artist-load-more{padding:.82rem 1.15rem;border-radius:12px;border:1px solid var(--border-color);background:linear-gradient(135deg, var(--surface-bg), var(--accent-bg));color:var(--text-secondary);cursor:pointer;font-weight:800}#artist-modal-overlay .artist-load-more:hover{background:linear-gradient(135deg, var(--primary-accent), var(--secondary-accent));color:#fff;border-color:transparent}@media (max-width:900px){#artist-modal-overlay .artist-header{flex-direction:column}#artist-modal-overlay .artist-header-actions{width:100%;justify-content:space-between}#artist-modal-overlay .artist-tabs{flex-wrap:wrap}#artist-modal-overlay .artist-item--track{grid-template-columns:auto auto minmax(0,1fr);align-items:flex-start}#artist-modal-overlay .artist-item--track .artist-actions{grid-column:1/-1;justify-content:flex-start}}@media (max-width:640px){#artist-modal-overlay .artist-body{padding:.9rem}#artist-modal-overlay .artist-tabs{padding:.85rem .9rem}#artist-modal-overlay .artist-footer{flex-direction:column;align-items:stretch}#artist-modal-overlay .artist-load-more{width:100%}#artist-modal-overlay .artist-list--collections{grid-template-columns:1fr}}`;
          document.head.appendChild(style);
          var overlay=document.createElement('div');
          overlay.id='artist-modal-overlay';
          overlay.innerHTML='<div class="artist-modal"><div class="artist-header"><div class="artist-header-main"><div class="artist-cover" id="artist-modal-cover">🎤</div><div><div class="artist-kicker">Search Artist Browser</div><div class="artist-title" id="artist-modal-title">Artist</div><div class="artist-subtitle" id="artist-modal-subtitle">Open the strongest releases, top tracks, and playlists from this artist.</div></div></div><div class="artist-header-actions"><div class="artist-chip" id="artist-modal-chip">Top Tracks</div><button id="artist-modal-watch" class="artist-close" aria-label="Watch artist" title="Watch artist">★</button><button id="artist-modal-close" class="artist-close" aria-label="Close">×</button></div></div><div class="artist-tabs"><button class="artist-tab active" data-tab="top-tracks">Top Tracks</button><button class="artist-tab" data-tab="albums">Albums</button><button class="artist-tab" data-tab="playlists">Playlists</button></div><div class="artist-body"><div class="artist-list artist-list--tracks" id="artist-list"></div></div><div class="artist-footer"><div class="artist-status" id="artist-modal-status">Loading top tracks...</div><button class="artist-load-more" id="artist-load-more">Load More</button></div></div>';
          document.body.appendChild(overlay);
          overlay.addEventListener('click', function(e){ if(e.target===overlay) overlay.style.display='none'; });
          overlay.querySelector('#artist-modal-close').addEventListener('click', function(){ overlay.style.display='none'; });
          overlay.querySelector('#artist-modal-watch').addEventListener('click', function(e){
            e.preventDefault();
            e.stopPropagation();
            if (!window.app || !window.app.toggleWatchedArtist) return;
            window.app.toggleWatchedArtist({
              id: artistCtx.id,
              name: artistCtx.name,
              image: artistCtx.cover || '',
              service: 'qobuz'
            });
          });
        };
        var formatDurationText=function(raw){
          if(!raw) return '';
          if(typeof raw === 'string' && raw.indexOf(':') > -1) return raw;
          var total=Number(raw);
          if(!isFinite(total) || total <= 0) return '';
          var minutes=Math.floor(total/60);
          var seconds=String(total%60).padStart(2,'0');
          return minutes+'m '+seconds+'s';
        };
        var setArtistStatus=function(text){
          var el=document.getElementById('artist-modal-status');
          if(el) el.textContent=text;
        };
        var setArtistListMode=function(tab){
          var list=document.getElementById('artist-list');
          var chip=document.getElementById('artist-modal-chip');
          if(list){
            list.classList.toggle('artist-list--tracks', tab==='top-tracks');
            list.classList.toggle('artist-list--collections', tab!=='top-tracks');
          }
          if(chip) chip.textContent = tab==='top-tracks' ? 'Top Tracks' : tab==='albums' ? 'Albums' : 'Playlists';
        };
        var getArtistCoverForTab=function(tab, it){
          try{
            var rd=it.rawData||{};
            if(tab==='albums'){
              return rd.md5_image ? ('https://e-cdns-images.dzcdn.net/images/cover/'+rd.md5_image+'/250x250-000000-80-0-0.jpg') : (rd.cover_xl || rd.cover_big || rd.cover_medium || rd.cover || (rd.image && (rd.image.large || rd.image.extralarge || rd.image.medium || rd.image.small)));
            }
            if(tab==='top-tracks'){
              var album=rd.album||{};
              return album.md5_image ? ('https://e-cdns-images.dzcdn.net/images/cover/'+album.md5_image+'/250x250-000000-80-0-0.jpg') : (album.cover_xl || album.cover_big || album.cover_medium || album.cover || (album.image && (album.image.large || album.image.medium)));
            }
            return rd.image || rd.image_rectangle_mini || rd.picture_big || rd.picture_medium || (rd.images300 && rd.images300[0]) || (rd.images150 && rd.images150[0]);
          }catch(_e){}
          return null;
        };
        var createArtistEmpty=function(message){
          var list=document.getElementById('artist-list');
          if(!list) return;
          list.innerHTML='<div class="artist-empty">'+message+'</div>';
        };
        var artistIcons={
          play:'<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg>',
          queue:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 6h10"/><path d="M4 12h10"/><path d="M4 18h7"/><path d="M18 8v8"/><path d="M14 12h8"/></svg>',
          open:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>',
          download:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>'
        };
        var renderArtistItems=function(app, tab, items, append){
          var list=document.getElementById('artist-list');
          if(!list) return;
          setArtistListMode(tab);
          if(!append) list.innerHTML='';
          if(!items || !items.length){
            if(!append) createArtistEmpty(tab==='top-tracks' ? 'No top tracks found for this artist yet.' : 'No '+(tab==='albums' ? 'albums' : 'playlists')+' found for this artist.');
            return;
          }
          items.forEach(function(it, index){
            var cover=getArtistCoverForTab(tab, it);
            var raw=it.rawData || {};
            var title=it.title || raw.title || raw.name || (tab==='top-tracks' ? 'Track' : tab==='albums' ? 'Album' : 'Playlist');
            var artist=it.artist || (raw.artist && raw.artist.name) || (raw.owner && raw.owner.name) || '';
            var service=(window.app && window.app.currentService) || it.service || 'deezer';
            var normalized={
              id:String(it.id || raw.id || raw.SNG_ID || ''),
              title:title,
              artist:artist,
              album:it.album || (raw.album && raw.album.title) || '',
              service:service,
              type:tab==='top-tracks' ? 'track' : tab==='albums' ? 'album' : 'playlist',
              rawData:raw
            };
            var meta='';
            if(tab==='top-tracks'){
              meta=[normalized.album, formatDurationText(it.duration || raw.duration || raw.DURATION)].filter(Boolean).join(' • ');
            } else if(tab==='albums'){
              var albumCount=raw.nb_tracks || raw.tracks_count || (raw.tracks && (raw.tracks.total || raw.tracks.length)) || raw.NB_SONG || 0;
              meta=[albumCount ? albumCount+' tracks' : '', it.year || raw.release_date_original || raw.release_date || 'Album'].filter(Boolean).join(' • ');
            } else {
              var playlistCount=raw.tracks_count || (raw.tracks && (raw.tracks.total || (raw.tracks.items && raw.tracks.items.length))) || 0;
              meta=[playlistCount ? playlistCount+' tracks' : '', artist || (raw.owner && raw.owner.name) || 'Playlist'].filter(Boolean).join(' • ');
            }
            var div=document.createElement('div');
            div.className='artist-item' + (tab==='top-tracks' ? ' artist-item--track' : ' artist-item--collection');
            div.style.cursor='pointer';
            div.innerHTML=(tab==='top-tracks'
              ? '<div class="artist-track-rank">'+String(index+1).padStart(2,'0')+'</div><div class="artist-art">'+(cover ? '<img src="'+cover+'" loading="lazy" alt="" onerror="this.parentNode.textContent=\'🎵\'">' : '🎵')+'</div><div class="artist-copy"><h4>'+title+'</h4><p>'+(artist || 'Track')+'</p><div class="artist-meta">'+(meta || '&nbsp;')+'</div></div><div class="artist-actions"></div>'
              : '<div class="artist-item-head"><div class="artist-art">'+(cover ? '<img src="'+cover+'" loading="lazy" alt="" onerror="this.parentNode.textContent=\'🎵\'">' : '🎵')+'</div><div class="artist-copy"><h4>'+title+'</h4><p>'+(artist || (tab==='playlists' ? 'Editorial playlist' : 'Artist release'))+'</p><div class="artist-meta">'+(meta || '&nbsp;')+'</div></div></div><div class="artist-actions"></div>');
            var actions=div.querySelector('.artist-actions');
            var makeBtn=function(icon, titleText, cls, handler){
              var btn=document.createElement('button');
              btn.className='discovery-action-btn-round artist-action-btn'+(cls ? ' '+cls : '');
              btn.title=titleText;
              btn.setAttribute('aria-label', titleText);
              btn.innerHTML=icon;
              btn.addEventListener('click', function(ev){ ev.preventDefault(); ev.stopPropagation(); handler(); });
              return btn;
            };
            if(tab==='top-tracks'){
              actions.appendChild(makeBtn(artistIcons.play,'Play now','artist-action-btn--primary', function(){ app.playNow && app.playNow(normalized); }));
              actions.appendChild(makeBtn(artistIcons.queue,'Add to queue','', function(){ app.addSingleToQueue && app.addSingleToQueue(normalized); }));
              actions.appendChild(makeBtn(artistIcons.download,'Download track','', function(){ if(app.downloadToClient && app.downloadTrackToClient){ app.downloadTrackToClient(normalized); } else { app.downloadItem && app.downloadItem(normalized); } }));
              div.addEventListener('click', function(){ app.playNow && app.playNow(normalized); });
            } else if(tab==='albums'){
              actions.appendChild(makeBtn(artistIcons.open,'Open album','artist-action-btn--primary', function(){ app.showAlbumModal && app.showAlbumModal(normalized); }));
              actions.appendChild(makeBtn(artistIcons.queue,'Add album to queue','', function(){ app.addToQueue && app.addToQueue(normalized); }));
              actions.appendChild(makeBtn(artistIcons.download,'Download album','', function(){ app.downloadItem && app.downloadItem(normalized); }));
              div.addEventListener('click', function(){ app.showAlbumModal && app.showAlbumModal(normalized); });
            } else {
              actions.appendChild(makeBtn(artistIcons.open,'Open playlist','artist-action-btn--primary', function(){ app.showPlaylistModal && app.showPlaylistModal(normalized); }));
              actions.appendChild(makeBtn(artistIcons.queue,'Add playlist to queue','', function(){ app.addToQueue && app.addToQueue(normalized); }));
              actions.appendChild(makeBtn(artistIcons.download,'Download playlist','', function(){ app.downloadItem && app.downloadItem(normalized); }));
              div.addEventListener('click', function(){ app.showPlaylistModal && app.showPlaylistModal(normalized); });
            }
            list.appendChild(div);
          });
        };
        waitApp(function(app){
          app.searchPageSize = app.searchPageSize || 50;
          app.searchOffset = 0;
          app.searchQuery = app.searchQuery || '';
          app.searchType = app.searchType || 'track';
          ensureResultsLoadMore();
          app.updateResultsPaginationButton = function(show){ var c=ensureResultsLoadMore(); if(!c) return; c.style.display = show ? '' : 'none'; };
          app.socket.on && app.socket.on('searchResults', function(results){ var pageSize = app.searchPageSize || 50; var hasMore = Array.isArray(results) ? results.length >= pageSize : false; app.updateResultsPaginationButton(hasMore); });
          ensureArtistModal();
          var artistCtx={ id:null, name:'', cover:'', tab:'top-tracks', offset:{'top-tracks':0, albums:0, playlists:0}, page:24 };
          function openArtistModal(artist){
            var overlay=document.getElementById('artist-modal-overlay');
            var cover=document.getElementById('artist-modal-cover');
            if(!overlay || !artist || !artist.id) return;
            artistCtx={ id:String(artist.id), name:artist.name || 'Artist', cover:artist.cover || '', tab:'top-tracks', offset:{'top-tracks':0, albums:0, playlists:0}, page:24 };
            document.getElementById('artist-modal-title').textContent=artistCtx.name;
            document.getElementById('artist-modal-subtitle').textContent='Explore top tracks, albums, and playlists connected to '+artistCtx.name+'.';
            cover.innerHTML = artistCtx.cover ? '<img src="'+artistCtx.cover+'" alt="" loading="lazy">' : '🎤';
            var watchBtn=document.getElementById('artist-modal-watch');
            if(watchBtn){
              watchBtn.setAttribute('data-watch-artist-id', String(artistCtx.id));
              watchBtn.setAttribute('title', 'Watch artist');
              watchBtn.setAttribute('aria-label', 'Watch artist');
              if(window.app && window.app.syncWatchButtons) window.app.syncWatchButtons();
            }
            overlay.style.display='flex';
            overlay.querySelectorAll('.artist-tab').forEach(function(b){ b.classList.remove('active'); });
            overlay.querySelector('.artist-tab[data-tab="top-tracks"]').classList.add('active');
            document.getElementById('artist-list').innerHTML='';
            setArtistListMode('top-tracks');
            setArtistStatus('Loading top tracks...');
            requestArtistTab('top-tracks');
          }
          function requestArtistTab(tab){
            var service=app.currentService || 'deezer';
            var off=artistCtx.offset[tab] || 0;
            setArtistStatus(off > 0 ? 'Loading more '+tab.replace('-',' ')+'...' : 'Loading '+tab.replace('-',' ')+'...');
            if(tab==='albums'){
              app.socket.emit('getArtistAlbums', {service:service, artistId:artistCtx.id, limit:artistCtx.page, offset:off});
            } else if(tab==='top-tracks'){
              app.socket.emit('getArtistTracks', {service:service, artistId:artistCtx.id, limit:artistCtx.page, offset:off});
            } else {
              app.socket.emit('getArtistPlaylists', {service:service, artistId:artistCtx.id, artistName:artistCtx.name, limit:artistCtx.page, offset:off});
            }
          }
          var grid=document.getElementById('results-grid');
          if(grid && window.MutationObserver){
            var obs=new MutationObserver(function(){
              grid.querySelectorAll('.result-item[data-type="artist"]').forEach(function(card){
              if(card.__hasBrowse) return;
              var actions=card.querySelector('.result-actions');
              if(!actions) return;
                var watchBtn=document.createElement('button');
                watchBtn.className='discovery-action-btn-round watch-artist';
                watchBtn.title='Watch artist';
                watchBtn.setAttribute('aria-label', 'Watch artist');
                watchBtn.setAttribute('data-watch-artist-id', String(card.getAttribute('data-id') || ''));
                watchBtn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 17.27-5.18 3.05 1.4-5.88L3 9.76l6.09-.51L12 3.8l2.91 5.45 6.09.51-5.22 4.68 1.4 5.88z"/></svg>';
                watchBtn.addEventListener('click', function(ev){
                  ev.stopPropagation();
                  ev.preventDefault();
                  if(!window.app || !window.app.toggleWatchedArtist) return;
                  var id=card.getAttribute('data-id');
                  var titleEl=card.querySelector('.result-title');
                  var imgEl=card.querySelector('img');
                  window.app.toggleWatchedArtist({
                    id:id,
                    name:(titleEl && titleEl.textContent)||'Artist',
                    image:(imgEl && imgEl.src)||'',
                    service:'qobuz'
                  });
                });
                var btn=document.createElement('button');
                btn.className='discovery-action-btn-round view-artist';
                btn.title='Browse Artist';
                btn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="14" height="12" rx="2"/><path d="M7 2h14v10"/></svg>';
                btn.addEventListener('click', function(ev){
                  ev.stopPropagation();
                  ev.preventDefault();
                  var id=card.getAttribute('data-id');
                  var titleEl=card.querySelector('.result-title');
                  var imgEl=card.querySelector('img');
                  openArtistModal({ id:id, name:(titleEl && titleEl.textContent)||'Artist', cover:(imgEl && imgEl.src)||'' });
                });
                actions.appendChild(watchBtn);
                actions.appendChild(btn);
                if(window.app && window.app.syncWatchButtons) window.app.syncWatchButtons();
                card.__hasBrowse = true;
              });
              grid.querySelectorAll('.result-item[data-type="playlist"]').forEach(function(card){
                var watchBtn=card.__playlistWatchBtn;
                var service=(window.app && (window.app.currentService || 'deezer')) || 'deezer';
                var imgEl=card.querySelector('img');
                var titleEl=card.querySelector('.result-title');
                var artistEl=card.querySelector('.result-artist');
                if(!watchBtn){
                  watchBtn=document.createElement('button');
                  watchBtn.title='Watch playlist';
                  watchBtn.setAttribute('aria-label', 'Watch playlist');
                  watchBtn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
                  watchBtn.addEventListener('click', function(ev){
                    ev.stopPropagation();
                    ev.preventDefault();
                    if(!window.app || !window.app.toggleWatchedPlaylist) return;
                    window.app.toggleWatchedPlaylist({
                      id: card.getAttribute('data-id'),
                      title: (titleEl && titleEl.textContent) || 'Playlist',
                      artist: (artistEl && artistEl.textContent) || '',
                      image: (imgEl && imgEl.src) || '',
                      service: service
                    });
                  });
                  card.__playlistWatchBtn = watchBtn;
                }
                watchBtn.setAttribute('data-watch-playlist-id', String(card.getAttribute('data-id') || ''));
                watchBtn.setAttribute('data-watch-playlist-service', String(service));
                if(card.classList.contains('list-view')){
                  watchBtn.className='discovery-action-btn-round watch-playlist';
                  var actions=card.querySelector('.result-actions');
                  if(actions && watchBtn.parentElement !== actions){
                    actions.appendChild(watchBtn);
                  }
                } else {
                  watchBtn.className='discovery-action-btn-round watch-playlist watch-playlist-overlay';
                  if(watchBtn.parentElement !== card){
                    card.appendChild(watchBtn);
                  }
                }
                if(window.app && window.app.syncWatchButtons) window.app.syncWatchButtons();
                card.__hasPlaylistWatch = true;
              });
            });
            obs.observe(grid, {childList:true, subtree:true});
          }
          var overlay=document.getElementById('artist-modal-overlay');
          if(overlay){
            overlay.addEventListener('click', function(e){
              var t=e.target;
              if(!t) return;
              if(t.classList && t.classList.contains('artist-tab') && t.getAttribute('data-tab')){
                var tab=t.getAttribute('data-tab');
                overlay.querySelectorAll('.artist-tab').forEach(function(b){ b.classList.remove('active'); });
                t.classList.add('active');
                artistCtx.tab=tab;
                artistCtx.offset[tab]=0;
                document.getElementById('artist-list').innerHTML='';
                setArtistListMode(tab);
                requestArtistTab(tab);
              }
            }, true);
          }
          document.getElementById('artist-load-more') && document.getElementById('artist-load-more').addEventListener('click', function(){ requestArtistTab(artistCtx.tab); });
          app.socket.on('artistAlbums', function(payload){
            if(!payload || String(payload.artistId) !== String(artistCtx.id)) return;
            var items=payload.items||[];
            renderArtistItems(app, 'albums', items, (artistCtx.offset.albums||0)>0);
            artistCtx.offset.albums = (artistCtx.offset.albums||0) + items.length;
            setArtistStatus(items.length ? 'Showing '+artistCtx.offset.albums+' albums for '+artistCtx.name+'.' : 'No albums found for '+artistCtx.name+'.');
            document.getElementById('artist-load-more').style.display = items.length >= artistCtx.page ? '' : 'none';
          });
          app.socket.on('artistTracks', function(payload){
            if(!payload || String(payload.artistId) !== String(artistCtx.id)) return;
            var items=payload.items||[];
            renderArtistItems(app, 'top-tracks', items, (artistCtx.offset['top-tracks']||0)>0);
            artistCtx.offset['top-tracks'] = (artistCtx.offset['top-tracks']||0) + items.length;
            setArtistStatus(items.length ? 'Showing '+artistCtx.offset['top-tracks']+' top tracks for '+artistCtx.name+'.' : 'No top tracks found for '+artistCtx.name+'.');
            document.getElementById('artist-load-more').style.display = items.length >= artistCtx.page ? '' : 'none';
          });
          app.socket.on('artistPlaylists', function(payload){
            if(!payload || String(payload.artistId) !== String(artistCtx.id)) return;
            var items=payload.items||[];
            renderArtistItems(app, 'playlists', items, (artistCtx.offset.playlists||0)>0);
            artistCtx.offset.playlists = (artistCtx.offset.playlists||0) + items.length;
            setArtistStatus(items.length ? 'Showing '+artistCtx.offset.playlists+' playlists for '+artistCtx.name+'.' : 'No playlists found for '+artistCtx.name+'.');
            document.getElementById('artist-load-more').style.display = items.length >= artistCtx.page ? '' : 'none';
          });
          app.socket.on('artistAlbumsError', function(payload){ if(!payload || String(payload.artistId) !== String(artistCtx.id)) return; createArtistEmpty(payload.message || 'Unable to load albums right now.'); setArtistStatus('Album load failed.'); document.getElementById('artist-load-more').style.display='none'; });
          app.socket.on('artistTracksError', function(payload){ if(!payload || String(payload.artistId) !== String(artistCtx.id)) return; createArtistEmpty(payload.message || 'Unable to load top tracks right now.'); setArtistStatus('Top tracks load failed.'); document.getElementById('artist-load-more').style.display='none'; });
          app.socket.on('artistPlaylistsError', function(payload){ if(!payload || String(payload.artistId) !== String(artistCtx.id)) return; createArtistEmpty(payload.message || 'Unable to load playlists right now.'); setArtistStatus('Playlist load failed.'); document.getElementById('artist-load-more').style.display='none'; });
          window.openArtistModal = openArtistModal;
        });
      })();
