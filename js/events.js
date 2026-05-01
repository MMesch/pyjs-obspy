const EventsTab = (() => {
    let _map = null;
    let _eventLayer = null;
    let _stationLayer = null;
    let _selectedEvent = null;
    let _selectedMarker = null;

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
        // Reset previous highlight
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

    function prefillDataTab() {
        if (!_selectedEvent) return;
        // Start 5 minutes before origin time
        const t = new Date(_selectedEvent.time - 5 * 60e3);
        document.getElementById('startTime').value = t.toISOString().slice(0, 16);
        document.getElementById('duration').value  = 120;
        // Switch to data tab
        document.querySelector('.tab[data-tab="data"]').click();
    }

    // ── Stations ──────────────────────────────────────────────────────────────

    function _stationIcon() {
        return L.divIcon({
            className: '',
            html: '<div class="sta-marker"></div>',
            iconSize:   [14, 14],
            iconAnchor: [7, 14],
            popupAnchor: [0, -14],
        });
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

        // Pass event time so only stations active at that moment are returned
        const evtIso = new Date(_selectedEvent.time).toISOString();
        const call = 'await get_stations_near("' + service + '",'
            + _selectedEvent.lat + ',' + _selectedEvent.lon + ',' + radius
            + ',"' + evtIso + '")';

        try {
            const result = JSON.parse(await PyEnv.asyncEval(call, 'Querying FDSN stations…'));

            if (result.error) {
                _setStatus('Station query failed: ' + result.error);
                return;
            }

            result.stations.forEach(sta => {
                const marker = L.marker([sta.lat, sta.lon], { icon: _stationIcon() });
                marker.bindPopup(
                    '<div class="sta-popup">'
                    + '<b>' + sta.network + '.' + sta.station + '</b>'
                    + (sta.name ? '<br><span>' + sta.name + '</span>' : '')
                    + '<br><button class="sta-use-btn" '
                    + 'onclick="EventsTab.selectStation(' + JSON.stringify(sta).replace(/"/g, '&quot;') + ')">'
                    + 'Use this station</button>'
                    + '</div>'
                );
                _stationLayer.addLayer(marker);
            });

            _setStatus(result.stations.length + ' stations found on ' + service);
        } catch (err) {
            _setStatus('Error: ' + (err.message || String(err)));
        } finally {
            btn.disabled = false;
            spinner.style.display = 'none';
        }
    }

    function selectStation(sta) {
        document.getElementById('network').value = sta.network;
        document.getElementById('station').value = sta.station;
        prefillDataTab();
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
        // Leaflet needs the container to be visible before init
        setTimeout(initMap, 30);
    });

    return { loadEvents, prefillDataTab, findStations, selectStation };
})();
