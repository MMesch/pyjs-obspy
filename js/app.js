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
    const attachResp   = document.getElementById('attachResponse').checked;
    const removeResp   = document.getElementById('removeResponse').checked;

    const output      = document.getElementById('output');
    const fetchBtn    = document.getElementById('fetchData');
    const fetchSpinner = document.getElementById('fetchSpinner');
    const fetchText   = document.getElementById('fetchText');

    fetchBtn.disabled = true;
    fetchSpinner.style.display = 'inline-block';
    fetchText.textContent = 'Loading...';

    try {
        output.textContent = 'Fetching data from ' + fdsnService + '...\n';

        const startTime = new Date(document.getElementById('startTime').value);
        const duration  = parseFloat(document.getElementById('duration').value);
        const endTime   = new Date(startTime.getTime() + duration * 60 * 1000);

        const call = [
            'await fetch_data(',
            '"' + fdsnService + '", ',
            '"' + network + '", ',
            '"' + station + '", ',
            '"' + location + '", ',
            '"' + channel + '", ',
            '"' + startTime.toISOString() + '", ',
            '"' + endTime.toISOString() + '", ',
            'attach_response=' + (attachResp ? 'True' : 'False') + ', ',
            'remove_response=' + (removeResp ? 'True' : 'False'),
            ')',
        ].join('');

        const result = JSON.parse(await PyEnv.asyncEval(call, 'Fetching seismic data...'));

        const numTraces       = result.num_traces;
        const hasResponse     = result.has_response;
        const responseRemoved = result.response_removed || false;
        const rawPlot         = result.raw_plot;
        const processedPlot   = result.processed_plot;

        output.textContent += 'Fetched ' + numTraces + ' trace(s)\n';
        output.textContent += 'Response attached: ' + (hasResponse ? 'Yes' : 'No') + '\n';
        if (responseRemoved) output.textContent += 'Instrument response removed\n';

        const rawEl = document.getElementById('rawPlot');
        rawEl.innerHTML = rawPlot
            ? '<h4>Raw Data</h4><img src="data:image/png;base64,' + rawPlot + '" alt="Raw seismic data">'
            : '<h4>Raw Data</h4><p>No plot available</p>';

        const procEl = document.getElementById('processedPlot');
        if (processedPlot) {
            procEl.innerHTML = '<h4>Processed Data (Response Removed)</h4><img src="data:image/png;base64,' + processedPlot + '" alt="Processed seismic data">';
        } else if (removeResp) {
            procEl.innerHTML = '<h4>Processed Data</h4><p>Response removal failed or no response available</p>';
        } else {
            procEl.innerHTML = '';
        }

        const specEl = document.getElementById('spectrogramPlot');
        if (result.spectrograms && result.spectrograms.length > 0) {
            specEl.innerHTML = result.spectrograms.map(s =>
                '<h4>Spectrogram — ' + s.seed_id + '</h4>'
                + '<img src="data:image/png;base64,' + s.plot + '" alt="Spectrogram ' + s.seed_id + '">'
            ).join('');
        } else {
            specEl.innerHTML = '';
        }

        const respPlotEl = document.getElementById('responsePlot');
        if (result.response_plot) {
            respPlotEl.innerHTML = '<h4>Instrument Response (' + result.response_channel + ')</h4>'
                + '<img src="data:image/png;base64,' + result.response_plot + '" alt="Instrument response">';
        } else {
            respPlotEl.innerHTML = '';
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

// Default start time: 1 hour ago, rounded to the minute
(function () {
    const d = new Date(Date.now() - 60 * 60 * 1000);
    d.setSeconds(0, 0);
    // datetime-local expects "YYYY-MM-DDTHH:MM"
    const iso = d.toISOString().slice(0, 16);
    document.getElementById('startTime').value = iso;
})();

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

