if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then(reg => {
            console.log('SW Registered');
            reg.update();
        }).catch(err => console.log('SW Error', err));
    });
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
    let storedId = localStorage.getItem('mapmate_id');
    const isMobile = /Android|iPhone|iPad|iPod|Opera Mini|IEMobile/i.test(navigator.userAgent);
    
    const state = {
        map: null,
        markerCluster: null,
        isFenceMode: false,
        fences: [],
        deviceId: storedId || ('MM-' + Math.random().toString(36).substr(2, 6).toUpperCase()),
        deviceName: localStorage.getItem('mapmate_name') || (`Operator_${Math.floor(Math.random() * 1000)} ${isMobile ? '[Mobile]' : '[PC]'}`),
        nearbyMarkers: {},
        geoWatcher: null
    };

    if (!storedId) {
        localStorage.setItem('mapmate_id', state.deviceId);
    }
    if (!localStorage.getItem('mapmate_name')) localStorage.setItem('mapmate_name', state.deviceName);

    const splashScreen = document.getElementById('splash-screen');
    const appContainer = document.getElementById('app');
    const locateBtn = document.getElementById('locate-me');
    const fenceBtn = document.getElementById('add-fence');
    const zoomInBtn = document.getElementById('zoom-in');
    const zoomOutBtn = document.getElementById('zoom-out');
    const modal = document.getElementById('custom-modal');
    const searchInput = document.getElementById('map-search');
    const searchResults = document.getElementById('search-results');
    const syncLed = document.getElementById('sync-led');
    const recContainer = document.getElementById('recovery-container');
    const recInput = document.getElementById('recovery-input');
    const recRestore = document.getElementById('recovery-restore');

    // Tactical Identity Display
    if (recContainer) {
        const keyDisplay = document.createElement('div');
        keyDisplay.className = 'recovery-key-display';
        keyDisplay.innerText = state.deviceId;
        recContainer.after(keyDisplay);

        const keyHint = document.createElement('div');
        keyHint.className = 'recovery-hint';
        keyHint.innerText = "MISSION RECOVERY KEY (SAVE THIS)";
        keyDisplay.after(keyHint);

        recRestore.addEventListener('click', () => {
            const val = recInput.value.trim().toUpperCase();
            if (val.startsWith('MM-') && val.length >= 6) {
                localStorage.setItem('mapmate_id', val);
                location.reload();
            }
        });
    }

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
        } catch (e) { console.error("Search failed", e); }
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
        state.map = L.map('map', { zoomControl: false, attributionControl: false, tap: false, autoPanPadding: [100, 100] }).setView([32.0853, 34.7818], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(state.map);
        L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(state.map);
        state.map.createPane('fencePane');
        state.map.getPane('fencePane').style.zIndex = 45000;
        state.map.createPane('handlePane');
        state.map.getPane('handlePane').style.zIndex = 50000;
        state.markerCluster = L.markerClusterGroup({
            showCoverageOnHover: false, maxClusterRadius: 40,
            iconCreateFunction: (c) => L.divIcon({ html: `<div class="luxury-cluster"><span>${c.getChildCount()}</span></div>`, className: 'custom-cluster-icon', iconSize: [44, 44] })
        });
        state.map.addLayer(state.markerCluster);
        state.map.on('click', (e) => { if (state.isFenceMode) createFence(e.latlng); });

        // Zoom Suite Linkage
        zoomInBtn.addEventListener('click', () => state.map.zoomIn());
        zoomOutBtn.addEventListener('click', () => state.map.zoomOut());
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
        if (!u.lat || !u.lng || isNaN(u.lat) || isNaN(u.lng)) return;
        const pos = [u.lat, u.lng];
        if (state.nearbyMarkers[u.id]) {
            state.nearbyMarkers[u.id].setLatLng(pos);
            state.nearbyMarkers[u.id].getPopup().setContent(`
                <div style="text-align: center; font-family: 'Assistant', sans-serif;">
                    <div style="font-weight: 800; font-size: 1.1rem; margin-bottom: 8px; color: #1e293b;">${u.name}</div>
                    <button class="modal-btn primary" style="padding: 10px 20px; font-size: 0.9rem;" onclick="window.dispatchChat('${u.id}', '${u.name}')">
                        Direct Message
                    </button>
                    <div style="height: 12px;"></div>
                </div>
            `);
        } else {
            const container = L.DomUtil.create('div', 'ally-marker-container');
            container.innerHTML = '<div class="ally-glow"></div><div class="ally-core"></div>';
            const m = L.marker(pos, {
                icon: L.divIcon({ html: container, className: 'ally-tactical-icon', iconSize: [64, 64], iconAnchor: [32, 32] }),
                riseOnHover: true,
                zIndexOffset: 10000
            });
            m.bindPopup(`
                <div style="text-align: center; font-family: 'Assistant', sans-serif;">
                    <div style="font-weight: 800; font-size: 1.1rem; margin-bottom: 8px; color: #1e293b;">${u.name}</div>
                    <button class="modal-btn primary" style="padding: 10px 20px; font-size: 0.9rem;" onclick="window.dispatchChat('${u.id}', '${u.name}')">
                        Direct Message
                    </button>
                    <div style="height: 12px;"></div>
                </div>
            `, { closeButton: false, offset: [0, -100] });
            state.nearbyMarkers[u.id] = m;
            state.markerCluster.addLayer(m);
        }
    }
    window.dispatchChat = (id, n) => openChat(id, n);

    function updateFenceUI() {
        const hasFence = state.fences.length > 0;
        fenceBtn.innerHTML = hasFence ?
            `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>` :
            `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle></svg>`;
        fenceBtn.style.color = hasFence ? '#ef4444' : '#3b82f6';
    }

    function createFence(latlng) {
        const id = Date.now();
        const fence = {
            id, name: "Fence",
            circle: L.circle(latlng, { radius: 100, color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.15, weight: 3, dashArray: '8, 8', pane: 'fencePane', interactive: false }).addTo(state.map),
            centerHandle: null, edgeHandle: null
        };
        const handleIcon = L.divIcon({ html: '<div class="fence-handle"></div>', className: 'custom-handle', iconSize: [28, 28], iconAnchor: [14, 14] });
        fence.centerHandle = L.marker(latlng, { icon: handleIcon, draggable: true, pane: 'handlePane', zIndexOffset: 1000 }).addTo(state.map);
        const getDest = (ll, d) => L.latLng(ll.lat, ll.lng + (d / (6378137 * Math.cos(Math.PI * ll.lat / 180)) * 180 / Math.PI));
        fence.edgeHandle = L.marker(getDest(latlng, 100), { icon: handleIcon, draggable: true, pane: 'handlePane', zIndexOffset: 1000 }).addTo(state.map);
        const updatePositions = (e) => { fence.circle.setLatLng(e.latlng); fence.edgeHandle.setLatLng(getDest(e.latlng, fence.circle.getRadius())); };
        fence.centerHandle.on('drag', updatePositions);
        fence.edgeHandle.on('drag', (e) => {
            let radius = fence.circle.getLatLng().distanceTo(e.latlng);
            if (radius > 250) { radius = 250; const center = fence.circle.getLatLng(); const angle = Math.atan2(e.latlng.lng - center.lng, e.latlng.lat - center.lat); const l = center.lat + (250 / 111320) * Math.cos(angle); const n = center.lng + (250 / (111320 * Math.cos(center.lat * Math.PI / 180))) * Math.sin(angle); fence.edgeHandle.setLatLng([l, n]); }
            fence.circle.setRadius(radius);
        });
        const openManager = async () => {
            const result = await showConfirm("Delete Zone", "", true, id);
            if (!result) return;
            if (result.action === 'delete') {
                const f = state.fences.find(x => x.id === result.id);
                state.map.removeLayer(f.circle); state.map.removeLayer(f.centerHandle); state.map.removeLayer(f.edgeHandle);
                state.fences = state.fences.filter(x => x.id !== result.id);
                updateFenceUI();
            }
        };
        state.fences.push(fence);
        toggleFenceMode(false);
        updateFenceUI();
    }

    function toggleFenceMode(a) {
        if (a && state.fences.length >= 1) {
            const id = state.fences[0].id; // Get the ID of the single existing fence
            const openManager = async () => {
                const result = await showConfirm("Delete Zone", "", true, id);
                if (!result) return;
                if (result.action === 'delete') {
                    const f = state.fences.find(x => x.id === result.id);
                    state.map.removeLayer(f.circle); state.map.removeLayer(f.centerHandle); state.map.removeLayer(f.edgeHandle);
                    state.fences = state.fences.filter(x => x.id !== result.id);
                    updateFenceUI();
                }
            };
            openManager();
            return;
        }
        state.isFenceMode = a;
        fenceBtn.style.background = a ? '#f59e0b' : '';
        document.body.style.cursor = a ? 'crosshair' : '';
    }
    fenceBtn.addEventListener('click', () => toggleFenceMode(!state.isFenceMode));

    function startTracking() {
        if (!navigator.geolocation) return;
        if (state.geoWatcher !== null) return; // Already tracking

        // Visual feedback: GPS is searching (Blue pulse)
        if (syncLed) syncLed.className = 'sync-led active';

        const geoOptions = {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        };

        state.geoWatcher = navigator.geolocation.watchPosition(
            (p) => {
                updateUserMarker([p.coords.latitude, p.coords.longitude], p.coords.accuracy);
                // Restore LED to success or idle after first fix
                if (syncLed && syncLed.className === 'sync-led active') {
                    syncLed.className = 'sync-led success';
                }
            },
            (err) => {
                console.warn(`🛰️ GPS Error (${err.code}): ${err.message}`);
                if (syncLed) syncLed.className = 'sync-led error';
                state.geoWatcher = null; // Reset to allow retry
            },
            geoOptions
        );
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

            // Focus map on the very first GPS fix
            state.map.flyTo(ll, 17, { duration: 2 });
        }
    }
    locateBtn.addEventListener('click', () => {
        if (userLocationMarker) {
            state.map.flyTo(userLocationMarker.getLatLng(), 17, { duration: 1.5 });
        } else {
            // If no fix, force a fresh attempt
            if (state.geoWatcher) {
                navigator.geolocation.clearWatch(state.geoWatcher);
                state.geoWatcher = null;
            }
            startTracking();
        }
    });

    initMap(); startTracking();

    // Tactical Session Cleanup: Attempt to purge location on exit
    window.addEventListener('beforeunload', () => {
        if (supabaseClient && state.deviceId) {
            // Navigator.sendBeacon or a quick fire-and-forget delete
            const headers = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
            const url = `${SUPABASE_URL}/rest/v1/locations?id=eq.${state.deviceId}`;
            fetch(url, { method: 'DELETE', headers, keepalive: true }).catch(() => { });
        }
    });

    // 10-Second Discovery Pulse (Supabase PostGIS)
    async function discoveryPulse() {
        // 0. Visual Pulse Start (Always show attempt)
        syncLed.className = 'sync-led active';

        // 1. Fail if no link
        if (!supabaseClient) {
            setTimeout(() => { if (syncLed) syncLed.className = 'sync-led error'; }, 800);
            return;
        }

        try {
            if (userLocationMarker) {
                const ll = userLocationMarker.getLatLng();
                const fence = state.fences[0];

                // Broadcast self location + Active Zone using strict SRID formatting
                const { error: upsertError } = await supabaseClient.from('locations').upsert({
                    id: state.deviceId,
                    name: state.deviceName,
                    location: `SRID=4326;POINT(${ll.lng} ${ll.lat})`,
                    fence_lat: fence ? fence.circle.getLatLng().lat : null,
                    fence_lng: fence ? fence.circle.getLatLng().lng : null,
                    fence_radius: fence ? fence.circle.getRadius() : null,
                    last_seen: new Date().toISOString()
                });

                if (upsertError) {
                    console.error("🚩 Supabase Upsert Error:", upsertError.message);
                    throw upsertError;
                }

                // Discover Users in MY Zone
                const { data: zoneUsers, error: zoneError } = await supabaseClient.rpc('get_users_in_zone', { req_user_id: state.deviceId });

                if (!zoneError && zoneUsers) {
                    if (fence) fence.circle.setStyle({ color: zoneUsers.length > 0 ? '#ef4444' : '#f59e0b', fillOpacity: zoneUsers.length > 0 ? 0.3 : 0.15 });
                    const currentAllieIds = new Set(zoneUsers.map(u => u.id));
                    zoneUsers.forEach(u => updateAllyMarker(u));
                    Object.keys(state.nearbyMarkers).forEach(id => { if (!currentAllieIds.has(id)) { state.markerCluster.removeLayer(state.nearbyMarkers[id]); delete state.nearbyMarkers[id]; } });
                }
            } else {
                // Heartbeat only: Check if DB is reachable
                await supabaseClient.from('locations').select('id').limit(1);
            }

            // Success Indication
            syncLed.className = 'sync-led success';
        } catch (e) {
            console.log('Sync Error', e);
            syncLed.className = 'sync-led error';
        }

        // Return to success state after pulse (don't go back to gray)
        setTimeout(() => { if (syncLed && syncLed.className !== 'sync-led error') syncLed.className = 'sync-led success'; }, 1500);
    }

    // Zero-delay start + 10-second cycle
    discoveryPulse();
    setInterval(discoveryPulse, 10000);

    setTimeout(() => { splashScreen.classList.add('fade-out'); appContainer.classList.remove('hidden'); state.map.invalidateSize(); }, 1500);
});
