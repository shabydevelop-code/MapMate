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
        ctx.textBaseline = "top"; ctx.font = "14px 'Arial'"; ctx.fillText("MM_v9.5.4", 2, 2);
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
        allyPulseRegistry: {},
        isExiting: false
    };

    function updateLED() {
        if (!syncLed) return;
        // Priority: 1. Error (Red), 2. Action (Blue), 3. Ready (Green)
        if (state.gpsStatus === 'error' || state.syncStatus === 'error') {
            syncLed.className = 'sync-led error';
            // UNIFIED LINK: If the LED is red, the Ring MUST be broken
            if (rangeCircle) {
                rangeCircle.setStyle({
                    color: 'rgba(15, 23, 42, 0.9)', 
                    fillOpacity: 0.15,
                    weight: 2,
                    dashArray: '5, 10'
                });
            }
        } else if (state.gpsStatus === 'active' || state.syncStatus === 'active') {
            syncLed.className = 'sync-led active';
        } else if (state.gpsStatus === 'success' && state.syncStatus === 'success') {
            syncLed.className = 'sync-led success';
        } else {
            syncLed.className = 'sync-led success';
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
        const isTactical = currentZoom >= 16;

        // Visual Visibility for Canvas-based Range Ring
        rangeCircle.setStyle({
            opacity: isTactical ? 0.9 : 0,
            fillOpacity: isTactical ? 0.15 : 0
        });

        // UI Reticle (still a DOM/CSS element)
        if (reticle) {
            if (isTactical) reticle.classList.remove('hidden-range');
            else reticle.classList.add('hidden-range');
        }

        if (!isTactical) {
            // SECURITY: Wipe all ally markers when zooming out of tactical range
            purgeNearbyMarkers();
        }
    }

    // End of Range Estimator Logic

    let userLocationMarker = null;
    let userAccuracyCircle = null;
    let searchMarker = null;
    let searchTimeout = null;

    function toggleMapInteraction(active) {
        const containers = [
            document.querySelector('.leaflet-control-container'),
            document.querySelector('.zoom-suite'),
            document.querySelector('.top-bar'),
            document.querySelector('.tactical-reticle')
        ];
        containers.forEach(c => {
            if (c) c.style.pointerEvents = active ? 'auto' : 'none';
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
    function initMap() {
        if (state.map || document.getElementById('map')._leaflet_id) return;

        state.map = L.map('map', { 
            zoomControl: false, 
            attributionControl: false, 
            tap: true, 
            preferCanvas: true, // Solve SVG flickering on mobile
            autoPanPadding: [100, 100] 
        }).setView([32.0853, 34.7818], 13);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            maxZoom: 20,
            subdomains: 'abcd'
        }).addTo(state.map);
        L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(state.map);

        // Modal-Balloon Sync: Use history stack to allow back-button closure of hints
        state.map.on('popupopen', () => {
            if (!history.state || history.state.modal !== 'balloon') {
                history.pushState({ modal: 'balloon' }, '');
            }
        });

        state.map.on('popupclose', () => {
            if (history.state && history.state.modal === 'balloon') {
                history.back();
            }
        });

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

    function updateAllyMarker(u) {
        const uid = String(u.id || u.name).toLowerCase();
        const myId = String(state.deviceId).toLowerCase();
        if (!u || uid === myId) return;

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

        if (userLocationMarker) {
            const userPos = userLocationMarker.getLatLng();
            if (userPos.lat === lat && userPos.lng === lng) {
                lat += (Math.random() - 0.5) * 0.00005;
                lng += (Math.random() - 0.5) * 0.00005;
            }
        }

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
            const isStale = (u.age_secs && u.age_secs > 15);
            const statusColor = isStale ? '#f59e0b' : '#10b981';
            const statusText = isStale ? '● SIGNAL LAG' : '● ACTIVE';
            
            // Surgical Update: Only change what is needed
            if (!m.getLatLng().equals(pos)) m.setLatLng(pos);
            const targetOpacity = isStale ? 0.5 : 1;
            if (m.options.opacity !== targetOpacity) m.setOpacity(targetOpacity);
            
            const glow = m.getElement()?.querySelector('.ally-glow');
            if (glow) {
                const targetBG = isStale ? 'radial-gradient(circle, #f59e0b 0%, transparent 70%)' : '';
                if (glow.style.background !== targetBG) glow.style.background = targetBG;
            }
            
            // Re-bind only if event was lost
            m.off('click').on('click', () => showUnitModal({ name: u.name, lat: lat, lng: lng }, m));
        } else {
            const isStale = (u.age_secs && u.age_secs > 15);
            const statusColor = isStale ? '#f59e0b' : '#10b981';
            const statusText = isStale ? '● SIGNAL LAG' : '● ACTIVE';

            const container = L.DomUtil.create('div', 'ally-marker-container');
            container.innerHTML = `<div class="ally-glow online" style="${isStale ? 'background: radial-gradient(circle, #f59e0b 0%, transparent 70%)' : ''}"></div><div class="ally-core online"></div>`;
            const m = L.marker(pos, {
                icon: L.divIcon({ html: container, className: 'ally-tactical-icon', iconSize: [64, 64], iconAnchor: [32, 32] }),
                riseOnHover: true,
                zIndexOffset: 30000,
                opacity: isStale ? 0.5 : 1
            }).addTo(state.map);
            m.on('click', () => showUnitModal({ name: u.name, lat: lat, lng: lng }, m));
            state.nearbyMarkers[uid] = m;
        }
    }

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

    const unitModal = document.getElementById('unit-modal');
    const unitModalName = document.getElementById('unit-modal-name');
    const unitModalDistance = document.getElementById('unit-distance');
    const unitModalClose = document.getElementById('unit-modal-close');

    // Haversine Distance implementation for Lat/Lng fields
    function calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371e3; // Earth radius in meters
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ/2) * Math.sin(Δλ/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return Math.round(R * c); // Distance in meters
    }

    let activeTargetMarker = null;

    function showUnitModal(u, marker) {
        if (!u) return;
        
        // Target Lock: Visual feedback
        if (activeTargetMarker) activeTargetMarker.getElement()?.classList.remove('active-target');
        activeTargetMarker = marker;
        activeTargetMarker.getElement()?.classList.add('active-target');

        unitModalName.innerText = u.name || 'Operator';
        
        const center = state.map.getCenter();
        const dist = calculateDistance(center.lat, center.lng, u.lat, u.lng);
        unitModalDistance.innerText = `${dist} M`;

        // Tactical Offset: Pan map to center marker in the visible upper 60% of the screen
        const targetLatLng = marker.getLatLng();
        const mapHeight = document.getElementById('map').offsetHeight;
        // Shift up by approx 20-25% of screen height to clear the bottom sheet
        state.map.flyTo(targetLatLng, state.map.getZoom(), {
            paddingTopLeft: [0, 0],
            paddingBottomRight: [0, mapHeight * 0.4], // Account for sheet height
            duration: 1.0
        });

        history.pushState({ modal: 'unit' }, '');
        toggleMapInteraction(false);
        unitModal.classList.remove('hidden');
        setTimeout(() => unitModal.classList.add('visible'), 10);
    }

    unitModalClose.onclick = () => history.back();

    // Native Navigation Stack (Simple & Stable)
    window.addEventListener('popstate', (e) => {
        // Clear Target Lock
        if (activeTargetMarker) {
            activeTargetMarker.getElement()?.classList.remove('active-target');
            activeTargetMarker = null;
        }

        // 1. Handle Settings Modal closure
        if (settingsModal.classList.contains('visible')) {
            settingsModal.classList.remove('visible');
            setTimeout(() => { settingsModal.classList.add('hidden'); toggleMapInteraction(true); }, 300);
            return;
        }

        // 2. Handle Unit Modal closure
        if (unitModal.classList.contains('visible')) {
            unitModal.classList.remove('visible');
            setTimeout(() => { unitModal.classList.add('hidden'); toggleMapInteraction(true); }, 300);
            return;
        }

        // 3. Handle Tactical Balloon (Fallback for browser cleanup)
        if (state.map) {
            state.map.closePopup();
        }
    });

    openSettingsBtn.onclick = () => {
        settingsNameInput.value = state.deviceName || localStorage.getItem('mapmate_name') || '';
        history.pushState({ modal: 'settings' }, ''); // Add to stack
        toggleMapInteraction(false);
        settingsModal.classList.remove('hidden');
        setTimeout(() => settingsModal.classList.add('visible'), 10);
    };

    settingsCloseBtn.onclick = () => history.back();
    settingsSaveBtn.onclick = () => {
        const newName = settingsNameInput.value.trim();
        if (newName) {
            state.deviceName = newName;
            localStorage.setItem('mapmate_name', newName);
            discoveryPulse();
            history.back();
        }
    };

    // End of Mobile Logic

    // Global Startup
    if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost')) {
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return;
            refreshing = true;
            window.location.reload();
        });

        navigator.serviceWorker.register('sw.js?v=9.5.4').then(reg => {
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
                    lat: ll.lat,
                    lng: ll.lng,
                    device_type: isMobile ? 'Mobile' : 'PC',
                    f_lat: isTactical ? mapCenter.lat : null,
                    f_lng: isTactical ? mapCenter.lng : null,
                    f_rad: isTactical ? 200 : null
                });

                if (upsertError) {
                    console.error("🚩 Supabase Upsert Error:", upsertError.message);
                    throw upsertError;
                }

                if (isTactical) {
                    try {
                        const { data: zoneUsers, error: zoneError } = await supabaseClient.rpc('get_users_in_zone', { req_user_id: state.deviceId });

                        if (!zoneError && zoneUsers) {
                            const currentIds = new Set(zoneUsers.map(u => String(u.id || u.name).toLowerCase()));
                            const hasAllies = zoneUsers.length > 0;
                            const hasFresh = zoneUsers.some(u => u.age_secs !== undefined && u.age_secs <= 15);
                            
                            let ringColor = 'rgba(15, 23, 42, 0.9)'; 
                            if (hasAllies) ringColor = hasFresh ? '#10b981' : '#f59e0b';

                            if (rangeCircle) {
                                rangeCircle.setStyle({
                                    color: ringColor,
                                    fillOpacity: hasAllies ? 0.35 : 0.15,
                                    weight: hasAllies ? 4 : 2,
                                    dashArray: hasAllies ? '' : '5, 10'
                                });
                            }

                            Object.keys(state.nearbyMarkers).forEach(uid => {
                                if (!currentIds.has(uid)) {
                                    state.map.removeLayer(state.nearbyMarkers[uid]);
                                    delete state.nearbyMarkers[uid];
                                }
                            });
                            zoneUsers.forEach(u => updateAllyMarker(u));
                            state.syncStatus = 'success';
                        } else {
                            throw new Error("RPC Failure");
                        }
                    } catch (e) {
                        state.syncStatus = 'error';
                        Object.keys(state.nearbyMarkers).forEach(uid => {
                            state.map.removeLayer(state.nearbyMarkers[uid]);
                            delete state.nearbyMarkers[uid];
                        });
                    }
                    updateLED();
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

    // Range Ring Sync (Real-time tracking enabled by Canvas)
    state.map.on('move', () => {
        // LOCK: Do not move the ring if we are inspecting a unit
        if (rangeCircle && !unitModal.classList.contains('visible') && !settingsModal.classList.contains('visible')) {
            rangeCircle.setLatLng(state.map.getCenter());
        }
    });
    
    state.map.on('moveend', () => {
        syncRingVisibility();
        if (!settingsModal.classList.contains('visible') && !unitModal.classList.contains('visible')) {
            discoveryPulse();
        }
    });

    state.map.on('zoomend', () => {
        // Re-sync on zoom if not locked
        if (rangeCircle && !unitModal.classList.contains('visible') && !settingsModal.classList.contains('visible')) {
            rangeCircle.setLatLng(state.map.getCenter());
        }
        syncRingVisibility();
        discoveryPulse();
    });
});
