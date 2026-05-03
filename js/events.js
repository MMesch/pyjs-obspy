const EventsTab = (() => {
    let _map = null;
    let _eventLayer = null;
    let _stationLayer = null;
    let _selectedEvent = null;
    let _selectedMarker = null;
    let _selectedStation = null;
    let _selectedStationMarker = null;
    let _distDeg = null;
    let _availState = null;   // { markerMap, service, evtIso, endIso, stations }

    // FDSN base URLs for availability endpoint
    const _FDSN_URLS = {
        GEOFON:      'https://geofon.gfz-potsdam.de',
        EPOSFR:      'https://ws.resif.fr',
        EARTHSCOPE:  'https://service.iris.edu',
        ETH:         'https://eida.ethz.ch',
        ORFEUS:      'https://www.orfeus-eu.org',
    };

    // ── Map init ──────────────────────────────────────────────────────────────

    function initMap() {
        if (_map) { _map.invalidateSize(); return; }

        _map = L.map('eventsMap', { worldCopyJump: true }).setView([20, 10], 2);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 18,
        }).addTo(_map);

        _eventLayer   = L.layerGroup().addTo(_map);
        _stationLayer = L.layerGroup().addTo(_map);
    }

    // ── Distance helper (haversine, returns degrees) ──────────────────────────

    function _gcdeg(lat1, lon1, lat2, lon2) {
        const R2D = Math.PI / 180;
        const φ1 = lat1 * R2D, φ2 = lat2 * R2D;
        const Δφ = (lat2 - lat1) * R2D, Δλ = (lon2 - lon1) * R2D;
        const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
        return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) / R2D;
    }

    // ── Events ────────────────────────────────────────────────────────────────

    function _magRadius(mag) { return Math.max(4, (mag - 3) * 3.5); }

    function _magColor(mag) {
        if (mag >= 7.0) return '#b2182b';
        if (mag >= 6.0) return '#ef6548';
        if (mag >= 5.0) return '#fc8d59';
        return '#fdcc8a';
    }

    function _addEventMarkers(events) {
        events.forEach(evt => {
            const { lat, lon, mag, place } = evt;
            const circle = L.circleMarker([lat, lon], {
                radius:      _magRadius(mag),
                fillColor:   _magColor(mag),
                color:       'rgba(0,0,0,0.4)',
                weight:      0.8,
                fillOpacity: 0.75,
            });
            circle.on('click', () => _selectEvent(evt, circle));
            circle.bindTooltip('M' + mag.toFixed(1) + ' · ' + place, { sticky: true, offset: [8, 0] });
            _eventLayer.addLayer(circle);
        });
    }

    async function loadEvents() {
        if (!PyEnv.ready) { _setStatus('Python environment not ready yet — please wait.'); return; }

        const minMag   = document.getElementById('evtMinMag').value;
        const service  = document.getElementById('evtCatalogService').value;
        const startISO = document.getElementById('evtStartDate').value + 'T00:00:00Z';
        const endISO   = document.getElementById('evtEndDate').value   + 'T23:59:59Z';

        _setStatus('Loading events…');
        if (_eventLayer) _eventLayer.clearLayers();
        if (_stationLayer) _stationLayer.clearLayers();
        _clearSelection();

        try {
            const result = JSON.parse(await PyEnv.asyncEval(
                'await fetch_events("' + service + '",' + minMag + ',"' + startISO + '","' + endISO + '")',
                'Fetching events via ObsPy…'
            ));
            if (result.error) { _setStatus('Error: ' + result.error); return; }
            _addEventMarkers(result.events);
            _setStatus(result.events.length + ' events [ObsPy · ' + service + '] · click one to select');
        } catch (err) {
            _setStatus('Error loading events: ' + err.message);
        }
    }

    function _selectEvent(evt, marker) {
        if (_selectedMarker) {
            _selectedMarker.setStyle({ color: 'rgba(0,0,0,0.4)', weight: 0.8 });
        }
        _selectedEvent  = evt;
        _selectedMarker = marker;
        _distDeg = null;
        _availState = null;
        _selectedStationMarker = null;
        marker.setStyle({ color: '#1b2433', weight: 2.5 });

        const t = new Date(evt.time);
        document.getElementById('evtCardTitle').textContent =
            'M' + evt.mag.toFixed(1) + ' — ' + evt.place;
        document.getElementById('evtCardMeta').textContent =
            t.toUTCString() + ' · depth ' + evt.depth.toFixed(0) + ' km';
        document.getElementById('evtEventCard').style.display = '';
        document.getElementById('evtStationCard').style.display = 'none';
        document.getElementById('evtNetworkPanel').style.display = 'none';

        document.getElementById('evtFindNetsBtn').disabled = false;
        document.getElementById('evtStationsBtn').disabled = true;
        document.getElementById('evtAvailBtn').disabled = true;

        _stationLayer.clearLayers();
    }

    function _clearSelection() {
        if (_selectedMarker) {
            _selectedMarker.setStyle({ color: 'rgba(0,0,0,0.4)', weight: 0.8 });
        }
        _selectedEvent         = null;
        _selectedMarker        = null;
        _selectedStation       = null;
        _selectedStationMarker = null;
        _distDeg   = null;
        _availState = null;
        document.getElementById('evtEventCard').style.display = 'none';
        document.getElementById('evtStationCard').style.display = 'none';
        document.getElementById('evtNetworkPanel').style.display = 'none';
        document.getElementById('evtFindNetsBtn').disabled = true;
        document.getElementById('evtStationsBtn').disabled = true;
        document.getElementById('evtAvailBtn').disabled = true;
        if (_stationLayer) _stationLayer.clearLayers();
    }

    // ── Networks ──────────────────────────────────────────────────────────────

    async function findNetworks() {
        if (!_selectedEvent) { _setStatus('Select an event first.'); return; }

        const service = document.getElementById('evtFdsnService').value;
        const minDeg  = parseFloat(document.getElementById('evtStationMinDeg').value) || 0;
        const maxDeg  = parseFloat(document.getElementById('evtStationMaxDeg').value) || 15;
        const btn     = document.getElementById('evtFindNetsBtn');
        const spinner = document.getElementById('evtNetsSpinner');

        btn.disabled = true;
        spinner.style.display = 'inline-block';
        document.getElementById('evtNetworkPanel').style.display = 'none';

        const evtIso = new Date(_selectedEvent.time).toISOString();
        const call = 'await get_networks_near("' + service + '",'
            + _selectedEvent.lat + ',' + _selectedEvent.lon + ','
            + minDeg + ',' + maxDeg + ',"' + evtIso + '")';

        try {
            const result = JSON.parse(await PyEnv.asyncEval(call, 'Querying available networks…'));
            if (result.error) { _setStatus('Network query failed: ' + result.error); return; }

            _populateNetworkPills(result.networks);
            document.getElementById('evtNetworkPanel').style.display = '';
            document.getElementById('evtStationsBtn').disabled = false;
            _setStatus(result.networks.length + ' networks found · toggle to filter, then Find Stations');
        } catch (err) {
            _setStatus('Error: ' + (err.message || String(err)));
        } finally {
            btn.disabled = false;
            spinner.style.display = 'none';
        }
    }

    function _populateNetworkPills(networks) {
        const container = document.getElementById('evtNetworkPills');
        container.innerHTML = '';
        networks.forEach(net => {
            const btn = document.createElement('button');
            btn.className = 'evt-net-pill active';
            btn.textContent = net;
            btn.addEventListener('click', () => btn.classList.toggle('active'));
            container.appendChild(btn);
        });
    }

    function _getSelectedNetworks() {
        const active = [...document.querySelectorAll('#evtNetworkPills .evt-net-pill.active')]
            .map(b => b.textContent);
        return active.length ? active.join(',') : null;
    }

    // ── Stations ──────────────────────────────────────────────────────────────

    function _stationIcon(color, selected) {
        const c = color || '#999';
        if (selected) {
            // Dark outer triangle + colored inner triangle — mirrors earthquake border on select
            return L.divIcon({
                className: '',
                html: '<div style="position:relative;width:16px;height:15px">'
                    + '<div style="position:absolute;width:0;height:0;'
                    + 'border-left:8px solid transparent;border-right:8px solid transparent;'
                    + 'border-bottom:15px solid #1b2433"></div>'
                    + '<div style="position:absolute;width:0;height:0;'
                    + 'border-left:6px solid transparent;border-right:6px solid transparent;'
                    + 'border-bottom:11px solid ' + c + ';top:2px;left:1px"></div>'
                    + '</div>',
                iconSize:   [16, 15],
                iconAnchor: [8, 15],
            });
        }
        return L.divIcon({
            className: '',
            html: '<div class="sta-marker" style="border-bottom-color:' + c + '"></div>',
            iconSize:   [14, 14],
            iconAnchor: [7, 14],
        });
    }

    function _selectStationMarker(sta, marker) {
        if (_selectedStationMarker && _selectedStationMarker !== marker) {
            _selectedStationMarker.setIcon(_stationIcon(_selectedStationMarker._color));
        }
        _selectedStationMarker = marker;
        marker.setIcon(_stationIcon(marker._color, true));
        _selectedStation = sta;
        _showStationCard(sta);
    }

    const _CHAN_PRIORITY = ['LHZ','LH1','LH2','LHN','LHE',
                            'BHZ','BH1','BH2','BHN','BHE',
                            'HHZ','HH1','HH2','HHN','HHE'];

    function _bestChannel(channels) {
        for (const pref of _CHAN_PRIORITY) {
            const match = channels.find(c => c.channel === pref);
            if (match) return match;
        }
        return channels[0] || null;
    }

    function _parseAvailText(text) {
        const available = new Set();
        const channels  = new Map();
        text.trim().split('\n').forEach(line => {
            if (line.startsWith('#') || !line.trim()) return;
            const parts = line.trim().split(/\s+/);
            if (parts.length < 4) return;
            const [net, sta] = parts;
            const loc = parts[2].length === 3 ? ''       : parts[2];
            const cha = parts[2].length === 3 ? parts[2] : parts[3];
            const key = net + '.' + sta;
            available.add(key);
            if (!channels.has(key)) channels.set(key, []);
            channels.get(key).push({ location: loc, channel: cha });
        });
        return { available, channels };
    }

    async function _fetchAvailChunk(base, chunk, startIso, endIso, timeoutMs) {
        const networks = [...new Set(chunk.map(s => s.network))].join(',');
        const staCodes = [...new Set(chunk.map(s => s.station))].join(',');
        const url = base + '/fdsnws/availability/1/query'
            + '?network=' + encodeURIComponent(networks)
            + '&station=' + encodeURIComponent(staCodes)
            + '&channel=LH*,BH*,HH*'
            + '&starttime=' + startIso
            + '&endtime='   + endIso
            + '&format=text&merge=samplerate';
        try {
            const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
            if (!resp.ok) return null;
            return _parseAvailText(await resp.text());
        } catch (e) {
            return null;
        }
    }

    async function _checkAvailability(service, stations, startIso, endIso) {
        const base = _FDSN_URLS[service];
        if (!base) return null;

        const CHUNK = 20;
        const TIMEOUT_MS = 12000;
        const chunks = [];
        for (let i = 0; i < stations.length; i += CHUNK)
            chunks.push(stations.slice(i, i + CHUNK));

        const results = await Promise.all(
            chunks.map(chunk => _fetchAvailChunk(base, chunk, startIso, endIso, TIMEOUT_MS))
        );

        if (results.every(r => r === null)) return null;

        const available = new Set();
        const channels  = new Map();
        for (const r of results) {
            if (!r) continue;
            r.available.forEach(k => available.add(k));
            r.channels.forEach((v, k) => {
                if (!channels.has(k)) channels.set(k, []);
                channels.get(k).push(...v);
            });
        }
        return { available, channels };
    }

    async function findStations() {
        if (!_selectedEvent) { _setStatus('Select an event first.'); return; }

        const service   = document.getElementById('evtFdsnService').value;
        const minDeg    = parseFloat(document.getElementById('evtStationMinDeg').value) || 0;
        const maxDeg    = parseFloat(document.getElementById('evtStationMaxDeg').value) || 15;
        const netFilter = _getSelectedNetworks();
        const spinner   = document.getElementById('evtStationsSpinner');
        const btn       = document.getElementById('evtStationsBtn');

        btn.disabled = true;
        spinner.style.display = 'inline-block';
        _stationLayer.clearLayers();
        document.getElementById('evtStationCard').style.display = 'none';

        const evtIso  = new Date(_selectedEvent.time).toISOString();
        const endIso  = new Date(_selectedEvent.time + 3 * 3600e3).toISOString();
        const netArg  = netFilter ? ',"' + netFilter + '"' : ',None';
        const call = 'await get_stations_near("' + service + '",'
            + _selectedEvent.lat + ',' + _selectedEvent.lon + ','
            + minDeg + ',' + maxDeg + netArg
            + ',"' + evtIso + '")';

        try {
            const result = JSON.parse(await PyEnv.asyncEval(call, 'Querying FDSN stations…'));

            if (result.error) {
                _setStatus('Station query failed: ' + result.error);
                return;
            }

            _selectedStationMarker = null;
            const markerMap = {};
            result.stations.forEach(sta => {
                const key    = sta.network + '.' + sta.station;
                const marker = L.marker([sta.lat, sta.lon], { icon: _stationIcon() });
                marker._staObj = sta;
                marker._color  = null;
                marker.bindTooltip(
                    sta.network + '.' + sta.station + (sta.name ? ' · ' + sta.name : ''),
                    { sticky: true, offset: [8, -7] }
                );
                marker.on('click', () => _selectStationMarker(sta, marker));
                _stationLayer.addLayer(marker);
                markerMap[key] = marker;
            });

            _availState = { markerMap, service, evtIso, endIso, stations: result.stations };
            document.getElementById('evtAvailBtn').disabled = false;
            _setStatus(result.stations.length + ' stations [ObsPy] · click a station or Check Availability for data');

        } catch (err) {
            _setStatus('Error: ' + (err.message || String(err)));
        } finally {
            btn.disabled = false;
            spinner.style.display = 'none';
        }
    }

    async function checkAvailability() {
        if (!_availState) return;
        const { markerMap, service, evtIso, endIso, stations } = _availState;
        const btn     = document.getElementById('evtAvailBtn');
        const spinner = document.getElementById('evtAvailSpinner');
        btn.disabled = true;
        spinner.style.display = 'inline-block';
        _setStatus('Checking availability [JS]…');

        const avail = await _checkAvailability(service, stations, evtIso, endIso);

        if (avail === null) {
            _setStatus(stations.length + ' stations · availability not supported by ' + service);
        } else {
            // Persist channels so the station card can use them
            _availState.channels = avail.channels;

            let nData = 0;
            Object.entries(markerMap).forEach(([key, marker]) => {
                const hasData = avail.available.has(key);
                if (hasData) nData++;
                const color   = hasData ? '#2a9d3f' : '#cc3333';
                marker._color = color;
                marker.setIcon(_stationIcon(color, marker === _selectedStationMarker));
            });
            _setStatus(stations.length + ' stations · '
                + nData + ' with data (green) · '
                + (stations.length - nData) + ' without (red)');

            // Refresh station card if one is already open
            if (_selectedStation) _showStationCard(_selectedStation);
        }
        spinner.style.display = 'none';
        btn.disabled = false;
    }

    // ── Station card ──────────────────────────────────────────────────────────

    function selectStation(sta) {
        _selectedStation = sta;
        _showStationCard(sta);  // visual marker update handled by _selectStationMarker via click
    }

    function _showStationCard(sta) {
        document.getElementById('evtStaCardTitle').textContent =
            sta.network + '.' + sta.station + (sta.name ? ' — ' + sta.name : '');

        let meta = '';
        if (_selectedEvent && sta.lat != null) {
            const dist = _gcdeg(_selectedEvent.lat, _selectedEvent.lon, sta.lat, sta.lon);
            _distDeg = parseFloat(dist.toFixed(2));
            meta = dist.toFixed(1) + '° from epicentre';
        }
        document.getElementById('evtStaCardMeta').textContent = meta;

        const chansEl = document.getElementById('evtStaChannels');
        chansEl.innerHTML = '';

        const key      = sta.network + '.' + sta.station;
        const channels = _availState && _availState.channels
            ? (_availState.channels.get(key) || [])
            : [];

        if (channels.length > 0) {
            const best = _bestChannel(channels);
            channels.forEach(c => {
                const loc   = c.location === '--' ? '' : (c.location || '');
                const label = (loc ? loc + '.' : '') + c.channel;
                const pill  = document.createElement('button');
                pill.className = 'evt-net-pill' + (c === best ? ' active' : '');
                pill.dataset.location = loc;
                pill.dataset.channel  = c.channel;
                pill.textContent = label;
                pill.addEventListener('click', () => pill.classList.toggle('active'));
                chansEl.appendChild(pill);
            });
        } else {
            chansEl.innerHTML = '<span style="font-size:0.8rem;color:var(--ink-light)">'
                + 'Run Check Availability to see channels</span>';
        }

        document.getElementById('evtStationCard').style.display = '';
        document.getElementById('evtStationCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function useSelectedStation() {
        if (!_selectedStation) return;
        const sta = _selectedStation;
        document.getElementById('network').value = sta.network;
        document.getElementById('station').value = sta.station;

        const activePills = [...document.querySelectorAll('#evtStaChannels .evt-net-pill.active')];
        if (activePills.length > 0) {
            const locs = [...new Set(activePills.map(p => p.dataset.location))];
            document.getElementById('location').value = locs.length === 1 ? (locs[0] || '*') : '*';
            document.getElementById('channel').value  = activePills.map(p => p.dataset.channel).join(',');
            prefillDataTab(activePills[0].dataset.channel);
        } else {
            document.getElementById('location').value = sta.location !== undefined ? sta.location : '*';
            if (sta.channel) document.getElementById('channel').value = sta.channel;
            prefillDataTab(sta.channel || null);
        }
    }

    // ── Prefill data form ─────────────────────────────────────────────────────

    function prefillDataTab(channel) {
        if (!_selectedEvent) return;
        const t = new Date(_selectedEvent.time - 5 * 60e3);
        document.getElementById('startTime').value = t.toISOString().slice(0, 16);
        const chan = channel || document.getElementById('channel').value || '';
        const band = chan.charAt(0);
        const dur = { E: 15, S: 30, H: 30, B: 60, M: 60, L: 120, V: 360, U: 720 }[band] ?? 60;
        document.getElementById('duration').value = dur;
        document.querySelector('.tab[data-tab="data"]').click();
    }

    // ── TauP link ─────────────────────────────────────────────────────────────

    async function showEventTauP() {
        if (!_selectedEvent) return;
        document.getElementById('taupDepth').value = _selectedEvent.depth.toFixed(0);
        if (_selectedStation && _selectedStation.lat != null) {
            if (_distDeg === null) {
                _distDeg = parseFloat(_gcdeg(
                    _selectedEvent.lat, _selectedEvent.lon,
                    _selectedStation.lat, _selectedStation.lon
                ).toFixed(2));
            }
            document.getElementById('taupDist').value = _distDeg.toFixed(1);
            document.getElementById('taupPlotType').value = 'rays_spherical';
            // Update distance group visibility
            document.getElementById('taupDistGroup').style.display = '';
        }
        document.querySelector('.tab[data-tab="taup"]').click();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _setStatus(msg) {
        document.getElementById('evtStatus').textContent = msg;
    }

    function getContext() {
        return { event: _selectedEvent, station: _selectedStation };
    }

    function setDistDeg(d) {
        if (d != null) _distDeg = d;
    }

    // ── Sync service selectors ────────────────────────────────────────────────

    const _evtSvc  = document.getElementById('evtFdsnService');
    const _dataSvc = document.getElementById('fdsnService');
    _evtSvc.addEventListener('change',  () => { _dataSvc.value = _evtSvc.value; });
    _dataSvc.addEventListener('change', () => { _evtSvc.value  = _dataSvc.value; });

    // ── Default date range (last 30 days) ────────────────────────────────────

    (function () {
        const end   = new Date();
        const start = new Date(end - 30 * 86400e3);
        document.getElementById('evtEndDate').value   = end.toISOString().slice(0, 10);
        document.getElementById('evtStartDate').value = start.toISOString().slice(0, 10);
    })();

    // ── Wire up tab activation ────────────────────────────────────────────────

    document.querySelector('.tab[data-tab="events"]').addEventListener('click', () => {
        setTimeout(initMap, 30);
    });

    return {
        loadEvents, findNetworks, findStations, checkAvailability,
        selectStation, useSelectedStation,
        getContext, setDistDeg, showEventTauP,
    };
})();
