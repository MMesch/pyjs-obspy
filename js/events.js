const EventsTab = (() => {
    let _map = null;
    let _eventLayer = null;
    let _stationLayer = null;
    let _selectedEvent = null;
    let _selectedMarker = null;

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

        loadEvents();
    }

    // ── Events ────────────────────────────────────────────────────────────────

    function _magRadius(mag) { return Math.max(4, (mag - 3) * 3.5); }

    function _magColor(mag) {
        if (mag >= 7.0) return '#b2182b';
        if (mag >= 6.0) return '#ef6548';
        if (mag >= 5.0) return '#fc8d59';
        return '#fdcc8a';
    }

    async function loadEvents() {
        const minMag = document.getElementById('evtMinMag').value;
        const days   = document.getElementById('evtDays').value;
        const since  = new Date(Date.now() - days * 86400e3).toISOString();

        _setStatus('Loading events…');
        if (_eventLayer) _eventLayer.clearLayers();
        if (_stationLayer) _stationLayer.clearLayers();
        _clearSelection();

        const url = 'https://earthquake.usgs.gov/fdsnws/event/1/query'
            + '?format=geojson&orderby=time&limit=500'
            + '&minmagnitude=' + minMag
            + '&starttime=' + since;

        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const data = await resp.json();

            data.features.forEach(f => {
                const [lon, lat, depth] = f.geometry.coordinates;
                const mag   = f.properties.mag;
                const place = f.properties.place || '';
                const time  = f.properties.time;

                const circle = L.circleMarker([lat, lon], {
                    radius:      _magRadius(mag),
                    fillColor:   _magColor(mag),
                    color:       'rgba(0,0,0,0.4)',
                    weight:      0.8,
                    fillOpacity: 0.75,
                });

                circle.on('click', () => _selectEvent({ lat, lon, depth, mag, place, time }, circle));
                circle.bindTooltip('M' + mag.toFixed(1) + ' · ' + place, { sticky: true, offset: [8, 0] });
                _eventLayer.addLayer(circle);
            });

            _setStatus(data.features.length + ' events · click one to select');
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
        marker.setStyle({ color: '#1b2433', weight: 2.5 });

        const t = new Date(evt.time);
        document.getElementById('evtSelectedTitle').textContent =
            'M' + evt.mag.toFixed(1) + ' — ' + evt.place;
        document.getElementById('evtSelectedMeta').textContent =
            t.toUTCString() + ' · depth ' + evt.depth.toFixed(0) + ' km';
        document.getElementById('evtSelectedPanel').style.display = '';

        _stationLayer.clearLayers();
    }

    function _clearSelection() {
        if (_selectedMarker) {
            _selectedMarker.setStyle({ color: 'rgba(0,0,0,0.4)', weight: 0.8 });
        }
        _selectedEvent  = null;
        _selectedMarker = null;
        document.getElementById('evtSelectedPanel').style.display = 'none';
        if (_stationLayer) _stationLayer.clearLayers();
    }

    // ── Prefill data form ─────────────────────────────────────────────────────

    function prefillDataTab(channel) {
        if (!_selectedEvent) return;
        const t = new Date(_selectedEvent.time - 5 * 60e3);
        document.getElementById('startTime').value = t.toISOString().slice(0, 16);
        const chan = channel || document.getElementById('channel').value || '';
        const band = chan.charAt(0);
        // SEED band code → sensible default duration (minutes)
        const dur = { E: 15, S: 30, H: 30, B: 60, M: 60, L: 120, V: 360, U: 720 }[band] ?? 60;
        document.getElementById('duration').value = dur;
        document.querySelector('.tab[data-tab="data"]').click();
    }

    // ── Stations ──────────────────────────────────────────────────────────────

    function _stationIcon(color) {
        const c = color || '#999';
        return L.divIcon({
            className: '',
            html: '<div class="sta-marker" style="border-bottom-color:' + c + '"></div>',
            iconSize:    [14, 14],
            iconAnchor:  [7, 14],
            popupAnchor: [0, -14],
        });
    }

    // Channel priority for auto-selection: lowest sample rate first, Z component preferred
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

    // Query the FDSN availability endpoint for all stations at once.
    // Returns { available: Set<"NET.STA">, channels: Map<"NET.STA", [{location,channel}]> }
    // or null if the service doesn't support the endpoint.
    async function _checkAvailability(service, stations, startIso, endIso) {
        const base = _FDSN_URLS[service];
        if (!base) return null;

        const networks = [...new Set(stations.map(s => s.network))].join(',');
        const staCodes = [...new Set(stations.map(s => s.station))].join(',');

        const url = base + '/fdsnws/availability/1/query'
            + '?network=' + encodeURIComponent(networks)
            + '&station=' + encodeURIComponent(staCodes)
            + '&channel=LH*,BH*,HH*'
            + '&starttime=' + startIso
            + '&endtime='   + endIso
            + '&format=text&merge=samplerate';

        try {
            const resp = await fetch(url);
            if (!resp.ok) return null;
            const text = await resp.text();
            const available = new Set();
            const channels  = new Map();
            text.trim().split('\n').forEach(line => {
                if (line.startsWith('#') || !line.trim()) return;
                const parts = line.trim().split(/\s+/);
                if (parts.length < 4) return;
                const [net, sta] = parts;
                // Location codes are always 2 chars; channel codes always 3.
                // Some services omit empty location codes instead of using '--',
                // shifting all subsequent columns left.
                const loc = parts[2].length === 3 ? ''    : parts[2];
                const cha = parts[2].length === 3 ? parts[2] : parts[3];
                const key = net + '.' + sta;
                available.add(key);
                if (!channels.has(key)) channels.set(key, []);
                channels.get(key).push({ location: loc, channel: cha });
            });
            return { available, channels };
        } catch (e) {
            return null;
        }
    }

    function _channelButtons(staObj, channels) {
        if (!channels || channels.length === 0) return '';
        const best = _bestChannel(channels);
        return '<div class="sta-channels">'
            + channels.map(c => {
                const label = (c.location && c.location !== '--' ? c.location + '.' : '') + c.channel;
                const isBest = c === best;
                const s = Object.assign({}, staObj, { location: c.location === '--' ? '' : c.location, channel: c.channel });
                return '<button class="sta-chan-btn' + (isBest ? ' sta-chan-best' : '') + '" '
                    + 'onclick="EventsTab.selectStation(' + JSON.stringify(s).replace(/"/g, '&quot;') + ')">'
                    + label + '</button>';
            }).join('')
            + '</div>';
    }

    async function findStations() {
        if (!_selectedEvent) { _setStatus('Select an event first.'); return; }

        const service  = document.getElementById('evtFdsnService').value;
        const radius   = parseFloat(document.getElementById('evtStationRadius').value) || 15;
        const spinner  = document.getElementById('evtStationsSpinner');
        const btn      = document.getElementById('evtStationsBtn');

        btn.disabled = true;
        spinner.style.display = 'inline-block';
        _stationLayer.clearLayers();

        const evtIso  = new Date(_selectedEvent.time).toISOString();
        const endIso  = new Date(_selectedEvent.time + 3 * 3600e3).toISOString();
        const call = 'await get_stations_near("' + service + '",'
            + _selectedEvent.lat + ',' + _selectedEvent.lon + ',' + radius
            + ',"' + evtIso + '")';

        try {
            const result = JSON.parse(await PyEnv.asyncEval(call, 'Querying FDSN stations…'));

            if (result.error) {
                _setStatus('Station query failed: ' + result.error);
                return;
            }

            // Build marker map keyed by NET.STA; show all grey while availability runs
            const markerMap = {};
            result.stations.forEach(sta => {
                const key    = sta.network + '.' + sta.station;
                const marker = L.marker([sta.lat, sta.lon], { icon: _stationIcon() });
                marker._staObj = sta;
                marker.bindPopup(
                    '<div class="sta-popup">'
                    + '<b>' + sta.network + '.' + sta.station + '</b>'
                    + (sta.name ? '<br><span>' + sta.name + '</span>' : '')
                    + '<br><span class="sta-channels-loading">checking channels…</span>'
                    + '</div>'
                );
                _stationLayer.addLayer(marker);
                markerMap[key] = marker;
            });

            _setStatus(result.stations.length + ' stations found · checking availability…');

            const avail = await _checkAvailability(service, result.stations, evtIso, endIso);

            if (avail === null) {
                // Endpoint not supported — leave grey, update popups to show plain Use button
                Object.entries(markerMap).forEach(([, marker]) => {
                    const sta = marker._staObj;
                    marker.setPopupContent(
                        '<div class="sta-popup">'
                        + '<b>' + sta.network + '.' + sta.station + '</b>'
                        + (sta.name ? '<br><span>' + sta.name + '</span>' : '')
                        + '<br><button class="sta-use-btn" '
                        + 'onclick="EventsTab.selectStation(' + JSON.stringify(sta).replace(/"/g, '&quot;') + ')">'
                        + 'Use this station</button>'
                        + '</div>'
                    );
                });
                _setStatus(result.stations.length + ' stations (availability not supported by ' + service + ')');
            } else {
                let nData = 0;
                Object.entries(markerMap).forEach(([key, marker]) => {
                    const sta      = marker._staObj;
                    const hasData  = avail.available.has(key);
                    const chans    = avail.channels.get(key) || [];
                    if (hasData) nData++;
                    marker.setIcon(_stationIcon(hasData ? '#2a9d3f' : '#cc3333'));
                    marker.setPopupContent(
                        '<div class="sta-popup">'
                        + '<b>' + sta.network + '.' + sta.station + '</b>'
                        + (sta.name ? '<br><span>' + sta.name + '</span>' : '')
                        + (hasData
                            ? _channelButtons(sta, chans)
                            : '<br><span class="sta-no-data">no data in this time window</span>')
                        + '</div>'
                    );
                });
                _setStatus(result.stations.length + ' stations · '
                    + nData + ' with data (green) · '
                    + (result.stations.length - nData) + ' without (red)');
            }

        } catch (err) {
            _setStatus('Error: ' + (err.message || String(err)));
        } finally {
            btn.disabled = false;
            spinner.style.display = 'none';
        }
    }

    function selectStation(sta) {
        document.getElementById('network').value  = sta.network;
        document.getElementById('station').value  = sta.station;
        document.getElementById('location').value = sta.location !== undefined ? sta.location : '*';
        if (sta.channel) document.getElementById('channel').value = sta.channel;
        prefillDataTab(sta.channel || null);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _setStatus(msg) {
        document.getElementById('evtStatus').textContent = msg;
    }

    // ── Sync service selectors ────────────────────────────────────────────────

    const _evtSvc  = document.getElementById('evtFdsnService');
    const _dataSvc = document.getElementById('fdsnService');
    _evtSvc.addEventListener('change',  () => { _dataSvc.value = _evtSvc.value; });
    _dataSvc.addEventListener('change', () => { _evtSvc.value  = _dataSvc.value; });

    // ── Wire up tab activation ────────────────────────────────────────────────

    document.querySelector('.tab[data-tab="events"]').addEventListener('click', () => {
        setTimeout(initMap, 30);
    });

    return { loadEvents, prefillDataTab, findStations, selectStation };
})();
