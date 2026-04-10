// Dynamic PWA Implementation (Prevents CORS errors on file://)
const isRemote = (window.location.protocol === 'http:' || window.location.protocol === 'https:');
if (isRemote) {
    const manifestLink = document.createElement('link');
    manifestLink.rel = 'manifest';
    manifestLink.href = 'manifest.json';
    document.head.appendChild(manifestLink);

    const iconLink = document.createElement('link');
    iconLink.rel = 'icon';
    iconLink.type = 'image/x-icon';
    iconLink.href = 'favicon.ico';
    document.head.appendChild(iconLink);

    const themeMeta = document.createElement('meta');
    themeMeta.name = 'theme-color';
    themeMeta.content = '#0d1117';
    document.head.appendChild(themeMeta);
}

// Supabase Tactical Configuration
const SUPABASE_URL = 'https://aagabelswhvmwvibgvfg.supabase.co';
const SUPABASE_KEY = 'sb_publishable_hF4Flad0xtJszisMF1G29w_Bpv_Avw8';

// Safety Handshake: Only initialize if real keys are present
let supabaseClient = null;
if (SUPABASE_URL !== 'YOUR_SUPABASE_URL') {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
} else {
    console.warn("🛡️ MapMate: Supabase keys not set. Proximity Discovery is in Standby Mode.");
}

document.addEventListener('DOMContentLoaded', () => {
    // Silent Fingerprinting (Stable across Incognito/Wipes)
    function generateTacticalFingerprint() {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.textBaseline = "top"; ctx.font = "14px 'Arial'"; ctx.fillText("MM_v4.1.1", 2, 2);
        const sig = canvas.toDataURL() + navigator.userAgent + screen.width;
        let h = 0; for (let i = 0; i < sig.length; i++) h = ((h << 5) - h) + sig.charCodeAt(i) | 0;
        return 'op_' + Math.abs(h).toString(36);
    }

    let storedId = localStorage.getItem('mapmate_id');
    const isMobile = /Android|iPhone|iPad|iPod|Opera Mini|IEMobile/i.test(navigator.userAgent);

    // Identity Priority: 1. Storage -> 2. Fingerprint -> 3. Random fallback
    const fingerprintId = generateTacticalFingerprint();
    const deviceId = storedId || fingerprintId;

    const state = {
        map: null,
        deviceId: deviceId,
        deviceName: (localStorage.getItem('mapmate_name') || `User_${Math.floor(Math.random() * 1000)}`).replace(/\s*\[?(Mobile|PC)\]?/gi, '').trim(),
        nearbyMarkers: {}, // Registry for nearby allies found via Supabase
        geoWatcher: null, // Track the active geolocation watcher
        gpsStatus: 'idle', // Status Tracking: idle, active, success, error
        syncStatus: 'idle',
        serverTime: Date.now(),
        allyPulseRegistry: {} // TRACKER: { uid: { val: string, misses: int } }
    };

    function updateLED() {
        if (!syncLed) return;
        // Priority: 1. Error (Red), 2. Action (Blue), 3. Ready (Green)
        if (state.gpsStatus === 'error' || state.syncStatus === 'error') {
            syncLed.className = 'sync-led error';
        } else if (state.gpsStatus === 'active' || state.syncStatus === 'active') {
            syncLed.className = 'sync-led active';
        } else if (state.gpsStatus === 'success' && state.syncStatus === 'success') {
            syncLed.className = 'sync-led success';
        } else {
            syncLed.className = 'sync-led success'; // Default to green if initialized
        }
    }
    if (!storedId) {
        try {
            localStorage.setItem('mapmate_id', state.deviceId);
        } catch (e) {
            console.error("🚩 MapMate Storage Error: Identity cannot be persisted. Reset expected on refresh.");
            state.deviceName += " (Guest)";
        }
    }
    function purgeNearbyMarkers() {
        Object.keys(state.nearbyMarkers).forEach(id => {
            state.map.removeLayer(state.nearbyMarkers[id]);
            delete state.nearbyMarkers[id];
        });
    }

    // Connectivity Stealth: Wipe stale data if internet drops
    window.addEventListener('offline', () => {
        state.syncStatus = 'error';
        updateLED();
        purgeNearbyMarkers();
    });

    window.addEventListener('online', () => {
        state.syncStatus = 'active';
        updateLED();
        discoveryPulse();
    });

    const splashScreen = document.getElementById('splash-screen');
    const appContainer = document.getElementById('app');
    const locateBtn = document.getElementById('locate-me');
    const zoomInBtn = document.getElementById('zoom-in');
    const zoomOutBtn = document.getElementById('zoom-out');
    const modal = document.getElementById('custom-modal');
    const searchInput = document.getElementById('map-search');
    const searchResults = document.getElementById('search-results');
    const syncLed = document.getElementById('sync-led');
    const reticle = document.querySelector('.tactical-reticle');
    const settingsModal = document.getElementById('settings-modal');
    const settingsNameInput = document.getElementById('settings-name-input');
    const settingsSaveBtn = document.getElementById('settings-save');
    const settingsCloseBtn = document.getElementById('settings-close');
    const openSettingsBtn = document.getElementById('open-settings');
    let rangeCircle = null;

    function updateRangeRing() {
        if (!state.map || !rangeCircle) return;
        rangeCircle.setLatLng(state.map.getCenter());
    }

    function syncRingVisibility() {
        if (!state.map || !rangeCircle) return;
        const currentZoom = state.map.getZoom();
        const isVisible = currentZoom >= 16;

        // Only toggle if state actually changed
        const el = rangeCircle.getElement();
        if (isVisible) {
            if (el) el.classList.remove('hidden-range');
            if (reticle) reticle.classList.remove('hidden-range');
        } else {
            if (el) el.classList.add('hidden-range');
            if (reticle) reticle.classList.add('hidden-range');

            // SECURITY: Wipe all ally markers when zooming out of tactical range
            purgeNearbyMarkers();
        }
    }

    // End of Range Estimator Logic

    let userLocationMarker = null;
    let userAccuracyCircle = null;
    let searchMarker = null;
    let searchTimeout = null;

    function toggleMapInteraction(enabled) {
        if (!state.map) return;
        ['dragging', 'touchZoom', 'doubleClickZoom', 'scrollWheelZoom', 'boxZoom', 'keyboard'].forEach(m => {
            if (state.map[m]) enabled ? state.map[m].enable() : state.map[m].disable();
        });
    }

    // --- Search Intelligence ---
    async function performSearch(query) {
        if (!query || query.length < 3) { searchResults.classList.add('hidden'); return; }
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`);
            const data = await res.json();
            renderSearchResults(data);
        } catch (e) { /* Silent GPS/Search failure */ }
    }

    function renderSearchResults(data) {
        searchResults.innerHTML = '';
        if (data.length === 0) { searchResults.classList.add('hidden'); return; }
        data.forEach(item => {
            const div = document.createElement('div');
            div.className = 'result-item';
            div.innerHTML = `<span style="font-weight:700;">${item.display_name.split(',')[0]}</span><br><small style="color:#64748b;">${item.display_name}</small>`;
            div.onclick = () => {
                const lat = parseFloat(item.lat);
                const lon = parseFloat(item.lon);

                if (searchMarker) state.map.removeLayer(searchMarker);

                searchMarker = L.marker([lat, lon], {
                    icon: L.divIcon({
                        html: `<div class="search-pin-container"><div class="search-pin-head"></div><div class="search-pin-shadow"></div></div>`,
                        className: 'custom-search-pin', iconSize: [60, 60], iconAnchor: [30, 60]
                    }),
                    zIndexOffset: 30000
                }).addTo(state.map);

                state.map.flyTo([lat, lon], 17, { duration: 1.5 });

                searchResults.classList.add('hidden');
                searchInput.value = item.display_name.split(',')[0];
            };
            searchResults.appendChild(div);
        });
        searchResults.classList.remove('hidden');
    }

    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => performSearch(e.target.value), 400);
    });

    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
            searchResults.classList.add('hidden');
        }
    });

    function showConfirm(title, message, isEdit = false, fenceId = null) {
        return new Promise((resolve) => {
            toggleMapInteraction(false);
            const titleEl = document.getElementById('modal-title');
            const msgEl = document.getElementById('modal-message');
            titleEl.innerText = title;

            // Inject Close X
            const closeX = document.createElement('button');
            closeX.className = 'modal-close-x';
            closeX.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="3" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
            modal.querySelector('.modal-content').appendChild(closeX);

            if (isEdit) {
                msgEl.innerHTML = `
                     <div class="version-tag">v4.1.1-PRO</div>
                    <div class="modal-edit-container">
                        <p style="margin-bottom: 24px; color: #64748b; font-weight: 500;">Are you sure you want to remove this zone from the map?</p>
                        <button id="modal-delete-fence" class="modal-btn del">
                            <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                            Delete Zone
                        </button>
                    </div>
                `;
                document.getElementById('modal-confirm').style.display = 'none';
                document.getElementById('modal-delete-fence').onclick = () => {
                    resolve({ action: 'delete', id: fenceId });
                    closeModal();
                };
            } else {
                msgEl.innerText = message;
                document.getElementById('modal-confirm').innerText = "OK";
                document.getElementById('modal-confirm').style.display = 'flex';
            }

            modal.classList.remove('hidden');
            setTimeout(() => modal.classList.add('visible'), 10);

            const closeModal = () => {
                closeX.remove();
                modal.classList.remove('visible');
                setTimeout(() => { modal.classList.add('hidden'); toggleMapInteraction(true); }, 300);
            };

            const cleanup = (val) => {
                const inputName = document.getElementById('modal-input-name');
                const result = isEdit ? { action: 'update', name: inputName ? inputName.value : '', id: fenceId } : val;
                closeModal();
                resolve(result);
            };

            closeX.onclick = () => { resolve(false); closeModal(); };
            document.getElementById('modal-confirm').onclick = () => cleanup(true);
            // Auto-hide the original cancel button if it exists in the static HTML
            const staticCancel = document.getElementById('modal-cancel');
            if (staticCancel) staticCancel.style.display = 'none';
        });
    }

    function initMap() {
        if (state.map || document.getElementById('map')._leaflet_id) return;

        state.map = L.map('map', { zoomControl: false, attributionControl: false, tap: false, autoPanPadding: [100, 100] }).setView([32.0853, 34.7818], 13);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            maxZoom: 20,
            subdomains: 'abcd'
        }).addTo(state.map);
        L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(state.map);

        // Zoom Suite Linkage
        zoomInBtn.addEventListener('click', () => state.map.zoomIn());
        zoomOutBtn.addEventListener('click', () => state.map.zoomOut());

        // Initialize targeting circle
        rangeCircle = L.circle(state.map.getCenter(), {
            radius: 200,
            color: 'rgba(15, 23, 42, 0.9)',
            fillColor: 'rgba(15, 23, 42, 0.15)',
            weight: 2,
            dashArray: '3, 6',
            interactive: false,
            pane: 'overlayPane'
        }).addTo(state.map);
        syncRingVisibility();
    }

    const commsTerminal = document.getElementById('comms-terminal');
    const commsHistory = document.getElementById('comms-history');
    const commsInput = document.getElementById('comms-input');
    const commsTargetName = document.getElementById('comms-target-name');
    const commsIndicator = document.querySelector('.comms-indicator');
    let currentChatId = null;

    async function openChat(targetId, targetName) {
        currentChatId = targetId;
        commsTargetName.innerText = targetName;
        commsHistory.innerHTML = ''; // Clear for fresh load
        commsTerminal.classList.remove('hidden');

        // Authentic Status Check
        if (!supabaseClient) {
            commsIndicator.className = 'comms-indicator error';
            return;
        }

        commsIndicator.className = 'comms-indicator active';

        // Fetch History
        const { data, error } = await supabaseClient
            .from('messages')
            .select('*')
            .or(`and(sender_id.eq.${state.deviceId},recipient_id.eq.${targetId}),and(sender_id.eq.${targetId},recipient_id.eq.${state.deviceId})`)
            .order('created_at', { ascending: true })
            .limit(20);

        if (!error && data) {
            data.forEach(m => appendMessage(m));
            commsHistory.scrollTop = commsHistory.scrollHeight;
            commsIndicator.className = 'comms-indicator success';
        } else {
            commsIndicator.className = 'comms-indicator error';
        }
    }

    function appendMessage(m) {
        const isMe = m.sender_id === state.deviceId;
        const div = document.createElement('div');
        div.className = `msg ${isMe ? 'outgoing' : 'incoming'}`;
        div.innerText = m.content;
        commsHistory.appendChild(div);
        commsHistory.scrollTop = commsHistory.scrollHeight;
    }

    async function sendMsg() {
        const txt = commsInput.value.trim();
        if (!txt || !currentChatId || !supabaseClient) return;

        const { error } = await supabaseClient.from('messages').insert({
            sender_id: state.deviceId,
            recipient_id: currentChatId,
            content: txt
        });

        if (!error) {
            commsInput.value = '';
            // Note: Realtime will trigger the local draw
        }
    }

    // Subscribe to Private Messages
    if (supabaseClient) {
        supabaseClient
            .channel('private-messages')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `recipient_id=eq.${state.deviceId}` }, payload => {
                const m = payload.new;
                // Only process if it's an incoming message from the active chat target
                if (m.sender_id !== state.deviceId && currentChatId === m.sender_id && !commsTerminal.classList.contains('hidden')) {
                    appendMessage(m);
                } else if (m.sender_id !== state.deviceId) {
                    // Alert user of incoming message (Vibrate + LED Blink)
                    if (window.navigator.vibrate) window.navigator.vibrate(200);
                    syncLed.className = 'sync-led active';
                    setTimeout(() => { syncLed.className = 'sync-led'; }, 500);
                }
            })
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `sender_id=eq.${state.deviceId}` }, payload => {
                const m = payload.new;
                if (currentChatId === m.recipient_id) appendMessage(m);
            })
            .subscribe();
    }

    document.getElementById('comms-send').onclick = sendMsg;
    document.getElementById('comms-close').onclick = () => { commsTerminal.classList.add('hidden'); currentChatId = null; };
    commsInput.onkeydown = (e) => { if (e.key === 'Enter') sendMsg(); };

    // Mission log bound to personal marker
    function updateAllyMarker(u) {
        const uid = String(u.id || u.name).toLowerCase(); // Normalized ID
        const myId = String(state.deviceId).toLowerCase();
        if (!u || uid === myId) return;

        // Deep Coordinate Resolution (PostGIS String/Object Fallbacks)
        let lat = u.lat || u.latitude;
        let lng = u.lng || u.longitude;

        if (!lat || !lng) {
            if (u.location && typeof u.location === 'string' && u.location.includes('POINT')) {
                const pts = u.location.match(/-?\d+\.?\d*/g);
                if (pts && pts.length >= 2) { lng = parseFloat(pts[0]); lat = parseFloat(pts[1]); }
            } else if (u.location && u.location.coordinates) {
                lng = u.location.coordinates[0];
                lat = u.location.coordinates[1];
            }
        }

        if (!lat || !lng || isNaN(lat) || isNaN(lng)) return;

        // Tactical Anti-Stacking: If exact overlap with user, add tiny jitter
        if (userLocationMarker) {
            const userPos = userLocationMarker.getLatLng();
            if (userPos.lat === lat && userPos.lng === lng) {
                lat += (Math.random() - 0.5) * 0.00005;
                lng += (Math.random() - 0.5) * 0.00005;
            }
        }

        // Pure DB Record - No Logic/Guessing
        const pos = [lat, lng];

        if (state.nearbyMarkers[uid]) {
            const m = state.nearbyMarkers[uid];
            m.setLatLng(pos);
            m.setOpacity(1);
            const mEl = m.getElement();
            if (mEl) {
                const core = mEl.querySelector('.ally-core');
                const glow = mEl.querySelector('.ally-glow');
                if (core) core.className = `ally-core online`;
                if (glow) glow.className = `ally-glow online`;
            }
            m.getPopup().setContent(`
                <div style="text-align: center; font-family: 'Assistant', sans-serif;">
                    <div style="font-weight: 800; font-size: 1.1rem; margin-bottom: 4px; color: #1e293b;">${u.name}</div>
                    <div style="font-size: 0.75rem; color: #10b981; font-weight: 700; margin-bottom: 12px;">
                        ● ACTIVE
                    </div>
                    <button class="modal-btn primary" style="padding: 10px 20px; font-size: 0.9rem;" onclick="window.dispatchChat('${u.id}', '${u.name}')">
                        Direct Message
                    </button>
                </div>
            `);
        } else {
            const container = L.DomUtil.create('div', 'ally-marker-container');
            container.innerHTML = `<div class="ally-glow online"></div><div class="ally-core online"></div>`;
            const m = L.marker(pos, {
                icon: L.divIcon({ html: container, className: 'ally-tactical-icon', iconSize: [64, 64], iconAnchor: [32, 32] }),
                riseOnHover: true,
                zIndexOffset: 30000, // Top-tier priority
                opacity: 1
            });
            m.bindPopup(`
                <div style="text-align: center; font-family: 'Assistant', sans-serif;">
                    <div style="font-weight: 800; font-size: 1.1rem; margin-bottom: 2px; color: #1e293b;">${u.name}</div>
                    <div style="font-size: 0.65rem; color: #94a3b8; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px;">
                        ${u.device_type || 'Unknown'}
                    </div>
                    <div style="font-size: 0.75rem; color: #10b981; font-weight: 700; margin-bottom: 12px;">
                        ● ACTIVE
                    </div>
                    <button class="modal-btn primary" style="padding: 10px 20px; font-size: 0.9rem;" onclick="window.dispatchChat('${u.id}', '${u.name}')">
                        Direct Message
                    </button>
                </div>
            `, { closeButton: false, offset: [0, -100] });
            m.addTo(state.map); // Direct add (Bypass clustering)
            state.nearbyMarkers[uid] = m;
        }
    }
    window.dispatchChat = (id, n) => openChat(id, n);

    // End of Recognition Logic

    function startTracking() {
        if (!navigator.geolocation) return;
        if (state.geoWatcher !== null) return;

        state.gpsStatus = 'active';
        updateLED();

        // 5-Second Watchdog: If no fix is received, indicate error
        const gpsTimeout = setTimeout(() => {
            if (state.gpsStatus === 'active') {
                state.gpsStatus = 'error';
                updateLED();
            }
        }, 8000);

        // Stage 1: Fast initial snap (Cell/WiFi)
        navigator.geolocation.getCurrentPosition(
            (p) => {
                clearTimeout(gpsTimeout);
                updateUserMarker([p.coords.latitude, p.coords.longitude], p.coords.accuracy);
                state.gpsStatus = 'success';
                updateLED();
            },
            (err) => {
                clearTimeout(gpsTimeout);
                state.gpsStatus = 'error';
                updateLED();
            },
            { enableHighAccuracy: false, timeout: 5000, maximumAge: Infinity }
        );

        // Stage 2: Steady high-accuracy stream
        const startWatch = (highAccuracy) => {
            state.geoWatcher = navigator.geolocation.watchPosition(
                (p) => {
                    updateUserMarker([p.coords.latitude, p.coords.longitude], p.coords.accuracy);
                    state.gpsStatus = 'success';
                    updateLED();
                },
                (err) => {
                    // If high accuracy fails, retry with low accuracy fallback
                    if (highAccuracy && (err.code === err.TIMEOUT || err.code === err.POSITION_UNAVAILABLE)) {
                        navigator.geolocation.clearWatch(state.geoWatcher);
                        startWatch(false);
                    } else {
                        state.gpsStatus = 'error';
                        updateLED();
                        state.geoWatcher = null;
                    }
                },
                { enableHighAccuracy: highAccuracy, timeout: 30000, maximumAge: 30000 }
            );
        };

        startWatch(true);
    }
    function updateUserMarker(ll, acc) {
        if (!ll || isNaN(ll[0]) || isNaN(ll[1])) return; // Tactical Safety Guard

        if (userLocationMarker) {
            userLocationMarker.setLatLng(ll);
            userAccuracyCircle.setLatLng(ll).setRadius(acc / 2);
        } else {
            userLocationMarker = L.marker(ll, { icon: L.divIcon({ html: `<div class="luxury-marker-container"><div class="luxury-glow"></div><div class="luxury-core"></div></div>`, className: 'pwa-marker', iconSize: [48, 48], iconAnchor: [24, 24] }), zIndexOffset: 20000 }).addTo(state.map);
            userLocationMarker.on('click', () => window.dispatchChat(state.deviceId, 'Mission Log (Me)'));
            userAccuracyCircle = L.circle(ll, { radius: acc / 2, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.08, weight: 1, interactive: false }).addTo(state.map);
        }
    }
    locateBtn.addEventListener('click', () => {
        if (userLocationMarker) {
            state.map.flyTo(userLocationMarker.getLatLng(), 17, { duration: 1.5 });
        } else {
            // Signal a fresh attempt without flickering the Whole UI
            if (!state.geoWatcher) {
                startTracking();
            } else {
                state.gpsStatus = 'active';
                updateLED();
            }
        }
    });

    // Settings System
    openSettingsBtn.addEventListener('click', () => {
        settingsNameInput.value = state.deviceName;
        history.pushState({ modal: 'settings' }, '');
        toggleMapInteraction(false);
        settingsModal.classList.remove('hidden');
        setTimeout(() => settingsModal.classList.add('visible'), 10);
    });

    const closeSettings = (isBack = false) => {
        settingsModal.classList.remove('visible');
        setTimeout(() => {
            settingsModal.classList.add('hidden');
            toggleMapInteraction(true);
            if (!isBack && history.state?.modal === 'settings') history.back();
        }, 300);
    };

    settingsCloseBtn.onclick = () => closeSettings();
    settingsSaveBtn.onclick = () => {
        const newName = settingsNameInput.value.trim();
        if (newName) {
            state.deviceName = newName;
            localStorage.setItem('mapmate_name', newName);
            discoveryPulse();
            closeSettings();
        }
    };

    // Global Mobile Back-Button Handler
    window.addEventListener('popstate', (e) => {
        // If back button clicked, close any open modal
        if (settingsModal.classList.contains('visible')) {
            closeSettings(true);
            return;
        }
        if (!commsTerminal.classList.contains('hidden')) {
            commsTerminal.classList.add('hidden');
            toggleMapInteraction(true);
            return;
        }
        if (!searchResults.classList.contains('hidden')) {
            searchResults.classList.add('hidden');
            return;
        }

        // If at root level, show EXIT confirmation
        showModal("ABORT MISSION?", "Are you sure you want to exit MapMate and terminate tactical tracking?", () => {
            history.back(); // If they confirm, let them go back (exit)
        });
        // Push state back so they don't exit immediately on first click
        history.pushState({ root: true }, '');
    });

    // Push initial state to trap the first back-button press
    history.pushState({ root: true }, '');

    // Global Startup
    if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost')) {
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return;
            refreshing = true;
            window.location.reload();
        });

        navigator.serviceWorker.register('sw.js?v=4.1.1').then(reg => {
            reg.onupdatefound = () => {
                const nw = reg.installing;
                nw.onstatechange = () => {
                    if (nw.state === 'installed' && navigator.serviceWorker.controller) {
                        // Managed by sw.js skipWaiting
                    }
                };
            };
        });
    } else {
        console.warn("[Tactical] Service Worker bypassed: Non-secure origin detected (Requires HTTPS or Localhost)");
    }

    // Moved to unified startup at bottom

    // 10-Second Discovery Pulse (Supabase PostGIS)
    async function discoveryPulse() {
        // 0. Visual Pulse Start (Always show attempt)
        state.syncStatus = 'active';
        updateLED();

        // 1. Fail if no link
        if (!supabaseClient) {
            setTimeout(() => {
                state.syncStatus = 'error';
                updateLED();
            }, 800);
            return;
        }

        try {
            if (userLocationMarker) {
                const ll = userLocationMarker.getLatLng();
                const currentZoom = state.map.getZoom();
                const isTactical = currentZoom >= 16;
                const mapCenter = state.map.getCenter();

                // Broadcast self location + Automatic Passive Zone
                const { error: upsertError } = await supabaseClient.from('locations').upsert({
                    id: state.deviceId || localStorage.getItem('mapmate_id') || 'generic_op',
                    name: state.deviceName || 'Operator',
                    location: `SRID=4326;POINT(${ll.lng} ${ll.lat})`,
                    device_type: isMobile ? 'Mobile' : 'PC',
                    fence_location: isTactical ? `SRID=4326;POINT(${mapCenter.lng} ${mapCenter.lat})` : null,
                    fence_radius: isTactical ? 200 : null,
                    last_seen: new Date().toISOString()
                });

                if (upsertError) {
                    console.error("🚩 Supabase Upsert Error:", upsertError.message);
                    throw upsertError;
                }

                // Discover Users in MY Zone
                const { data: zoneUsers, error: zoneError } = await supabaseClient.rpc('get_users_in_zone', { req_user_id: state.deviceId });

                if (!zoneError && zoneUsers) {
                    if (rangeCircle) rangeCircle.setStyle({
                        color: zoneUsers.length > 0 ? '#f59e0b' : 'rgba(15, 23, 42, 0.9)',
                        fillOpacity: zoneUsers.length > 0 ? 0.35 : 0.15,
                        weight: zoneUsers.length > 0 ? 4 : 2,
                        dashArray: zoneUsers.length > 0 ? '' : '5, 10'
                    });
                    
                    const currentIds = new Set(zoneUsers.map(u => String(u.id || u.name).toLowerCase()));
                    
                    // 1. Absolute Vaporization: If not in DB result, they are GONE
                    Object.keys(state.nearbyMarkers).forEach(uid => {
                        if (!currentIds.has(uid)) {
                            state.map.removeLayer(state.nearbyMarkers[uid]);
                            delete state.nearbyMarkers[uid];
                            if (state.allyPulseRegistry[uid]) delete state.allyPulseRegistry[uid];
                        }
                    });

                    // 2. Pure Mirror: Render exactly what DB returns
                    zoneUsers.forEach(u => updateAllyMarker(u));
                    
                    state.errCount = 0;
                }
            } else {
                // Heartbeat only: Check if DB is reachable
                await supabaseClient.from('locations').select('id').limit(1);
            }

            // Success Indication
            state.syncStatus = 'success';
            updateLED();
            state.errCount = 0; 
        } catch (e) {
            console.log('Sync Error', e);
            state.syncStatus = 'error';
            updateLED();
            state.errCount = (state.errCount || 0) + 1;
            if (state.errCount > 3) purgeNearbyMarkers(); // Persistent failure only
        }

        // Pulse persistence handle
        setTimeout(() => {
            if (state.syncStatus === 'active') state.syncStatus = 'success';
            updateLED();
        }, 1500);
    }

    // Background Pulse Management (Web Worker + WakeLock)
    async function initTacticalPulse() {
        if ('wakeLock' in navigator) {
            try { await navigator.wakeLock.request('screen'); } catch (e) { }
        }
        const workerCode = `setInterval(() => { self.postMessage('ping'); }, 10000);`;
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const worker = new Worker(URL.createObjectURL(blob));
        worker.onmessage = () => discoveryPulse();
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') discoveryPulse();
        });
        discoveryPulse();
    }

    // Clean activation sequence: Map -> Tracking -> Pulse
    initMap();
    startTracking();
    initTacticalPulse();

    // Auto-Fade Splash
    setTimeout(() => {
        splashScreen.classList.add('fade-out');
        appContainer.classList.remove('hidden');
        state.map.invalidateSize();
    }, 1500);

    state.map.on('move', updateRangeRing);
    state.map.on('zoomend', () => {
        updateRangeRing();
        syncRingVisibility();
        discoveryPulse(); // FORCE: Instant cloud state sync
    });
    state.map.on('moveend', () => {
        syncRingVisibility();
        discoveryPulse(); // FORCE: Instant cloud state sync
    });
});
