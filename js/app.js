// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const target = tab.getAttribute('data-tab');
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(target).classList.add('active');
    });
});

// Disable Python-dependent buttons until env is ready
document.querySelectorAll('button[data-requires-python]').forEach(btn => {
    btn.disabled = true;
});
document.addEventListener('pyready', () => {
    document.querySelectorAll('button[data-requires-python]').forEach(btn => {
        btn.disabled = false;
    });
});

// Fetch data and display results
async function fetchData() {
    const network     = document.getElementById('network').value;
    const station     = document.getElementById('station').value;
    const location    = document.getElementById('location').value;
    const channel     = document.getElementById('channel').value;
    const fdsnService = document.getElementById('fdsnService').value;
    const attachResp  = document.getElementById('attachResponse').checked;
    const removeResp  = document.getElementById('removeResponse').checked;

    const output      = document.getElementById('output');
    const fetchBtn    = document.getElementById('fetchData');
    const fetchSpinner = document.getElementById('fetchSpinner');
    const fetchText   = document.getElementById('fetchText');

    const rawEl    = document.getElementById('rawPlot');
    const procEl   = document.getElementById('processedPlot');
    const specEl   = document.getElementById('spectrogramPlot');
    const respPlotEl = document.getElementById('responsePlot');

    fetchBtn.disabled = true;
    fetchSpinner.style.display = 'inline-block';
    fetchText.textContent = 'Loading...';
    output.textContent = '';
    rawEl.innerHTML = procEl.innerHTML = specEl.innerHTML = respPlotEl.innerHTML = '';

    // datetime-local value is local time; append Z to treat input as UTC
    const startUTC  = document.getElementById('startTime').value + ':00Z';
    const duration  = parseFloat(document.getElementById('duration').value);
    const endUTC    = new Date(new Date(startUTC).getTime() + duration * 60 * 1000).toISOString();

    try {
        // ── Step 1: fetch raw waveforms ────────────────────────────────────
        output.textContent += 'Connecting to ' + fdsnService + '...\n';
        const rawCall = 'await fetch_raw('
            + '"' + fdsnService + '","' + network + '","' + station + '",'
            + '"' + location + '","' + channel + '",'
            + '"' + startUTC + '","' + endUTC + '",'
            + 'attach_response=' + (attachResp ? 'True' : 'False') + ')';
        const raw = JSON.parse(await PyEnv.asyncEval(rawCall,
            'Fetching waveforms from ' + fdsnService + '…'));

        output.textContent += 'Fetched ' + raw.num_traces + ' trace(s)';
        if (raw.has_response) output.textContent += ' · response metadata attached';
        output.textContent += '\n';

        if (raw.raw_plot) {
            rawEl.innerHTML = '<h4>Raw Data</h4>'
                + '<img src="data:image/png;base64,' + raw.raw_plot + '" alt="Raw seismic data">';
        }

        // ── Step 2: remove instrument response ────────────────────────────
        if (removeResp && raw.has_response) {
            output.textContent += 'Removing instrument response...\n';
            const proc = JSON.parse(await PyEnv.asyncEval(
                'await process_stream()', 'Removing instrument response…'));
            if (proc.error) {
                output.textContent += 'Response removal failed: ' + proc.error + '\n';
            } else {
                output.textContent += 'Response removed (output: velocity)\n';
                procEl.innerHTML = '<h4>Processed Data (response removed)</h4>'
                    + '<img src="data:image/png;base64,' + proc.processed_plot + '" alt="Processed">';
            }
        }

        // ── Step 3: spectrograms ───────────────────────────────────────────
        output.textContent += 'Computing spectrograms...\n';
        const spec = JSON.parse(await PyEnv.asyncEval(
            'await compute_spectrograms()', 'Computing spectrograms…'));
        if (spec.spectrograms && spec.spectrograms.length > 0) {
            specEl.innerHTML = spec.spectrograms.map(s =>
                '<h4>Spectrogram — ' + s.seed_id + '</h4>'
                + '<img src="data:image/png;base64,' + s.plot + '" alt="Spectrogram ' + s.seed_id + '">'
            ).join('');
            output.textContent += 'Spectrograms done\n';
        }

        // ── Step 4: instrument response plot ──────────────────────────────
        if (attachResp && raw.has_response) {
            output.textContent += 'Plotting instrument response...\n';
            const resp = JSON.parse(await PyEnv.asyncEval(
                'await compute_response_plot()', 'Plotting instrument response…'));
            if (resp.response_plot) {
                respPlotEl.innerHTML = '<h4>Instrument Response (' + resp.response_channel + ')</h4>'
                    + '<img src="data:image/png;base64,' + resp.response_plot + '" alt="Instrument response">';
                output.textContent += 'Done\n';
            }
        }

    } catch (err) {
        console.error('Fetch error:', err);
        output.textContent += 'Error: ' + err.message + '\n';
    } finally {
        fetchBtn.disabled = false;
        fetchSpinner.style.display = 'none';
        fetchText.textContent = 'Fetch Data';
    }
}

// Default: Mw 7.4 earthquake, GEOFON GE.STU, 2026-04-20 07:52 UTC
document.getElementById('startTime').value = '2026-04-20T07:52';

document.getElementById('fetchData').addEventListener('click', fetchData);

// ── Beachball ────────────────────────────────────────────────────────────────

document.querySelectorAll('input[name="bbType"]').forEach(radio => {
    radio.addEventListener('change', () => {
        const focal = document.getElementById('bbFocalInputs');
        const mt    = document.getElementById('bbMtInputs');
        if (radio.value === 'focal') { focal.style.display = ''; mt.style.display = 'none'; }
        else                         { focal.style.display = 'none'; mt.style.display = ''; }
    });
});

async function plotBeachball() {
    const btn     = document.getElementById('plotBeachball');
    const spinner = document.getElementById('bbSpinner');
    const text    = document.getElementById('bbText');
    const output  = document.getElementById('bbOutput');
    const plotEl  = document.getElementById('bbPlot');

    btn.disabled = true;
    spinner.style.display = 'inline-block';
    text.textContent = 'Computing...';
    output.style.display = 'none';
    plotEl.innerHTML = '';

    try {
        const inputType = document.querySelector('input[name="bbType"]:checked').value;
        const color     = document.getElementById('bbColor').value;
        let values;

        if (inputType === 'focal') {
            values = [
                parseFloat(document.getElementById('bbStrike').value),
                parseFloat(document.getElementById('bbDip').value),
                parseFloat(document.getElementById('bbRake').value),
            ];
        } else {
            values = document.getElementById('bbMt').value
                .trim().split(/\s+/).map(Number);
        }

        const call = 'await plot_beachball("' + inputType + '", '
            + JSON.stringify(values) + ', "' + color + '")';
        const result = JSON.parse(await PyEnv.asyncEval(call, 'Plotting beachball...'));

        if (result.error) {
            output.style.display = '';
            output.textContent = 'Error: ' + result.error;
            return;
        }
        plotEl.innerHTML = '<img src="data:image/png;base64,' + result.plot + '" alt="Beachball">';

    } catch (err) {
        console.error('Beachball error:', err);
        output.style.display = '';
        output.textContent = 'Error: ' + err.message;
    } finally {
        btn.disabled = false;
        spinner.style.display = 'none';
        text.textContent = 'Plot Beachball';
    }
}

document.getElementById('plotBeachball').addEventListener('click', plotBeachball);

// ── TauP ─────────────────────────────────────────────────────────────────────

document.getElementById('taupPlotType').addEventListener('change', function () {
    const distGroup = document.getElementById('taupDistGroup');
    distGroup.style.display = this.value === 'travel_times' ? 'none' : '';
});
// hide distance initially only if travel_times is default
document.getElementById('taupDistGroup').style.display = 'none';

async function computeTaup() {
    const btn      = document.getElementById('computeTaup');
    const spinner  = document.getElementById('taupSpinner');
    const text     = document.getElementById('taupText');
    const output   = document.getElementById('taupOutput');
    const plotEl   = document.getElementById('taupPlot');

    btn.disabled = true;
    spinner.style.display = 'inline-block';
    text.textContent = 'Computing...';
    output.style.display = 'none';
    plotEl.innerHTML = '';

    try {
        const plotType  = document.getElementById('taupPlotType').value;
        const depth     = parseFloat(document.getElementById('taupDepth').value);
        const dist      = parseFloat(document.getElementById('taupDist').value);
        const model     = document.getElementById('taupModel').value;
        const phases    = document.getElementById('taupPhases').value
            .split(',').map(p => p.trim()).filter(Boolean);

        const distArg = plotType === 'travel_times' ? 'None' : String(dist);
        const call = 'await plot_taup("' + plotType + '", ' + depth + ', '
            + JSON.stringify(phases) + ', ' + distArg + ', "' + model + '")';

        const result = JSON.parse(await PyEnv.asyncEval(call, 'Computing TauP...'));

        if (result.error) {
            output.style.display = '';
            output.textContent = 'Error: ' + result.error;
            return;
        }
        plotEl.innerHTML = '<img src="data:image/png;base64,' + result.plot + '" alt="TauP plot">';

    } catch (err) {
        console.error('TauP error:', err);
        output.style.display = '';
        output.textContent = 'Error: ' + err.message;
    } finally {
        btn.disabled = false;
        spinner.style.display = 'none';
        text.textContent = 'Compute';
    }
}

document.getElementById('computeTaup').addEventListener('click', computeTaup);

