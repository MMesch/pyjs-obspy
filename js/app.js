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
    const network      = document.getElementById('network').value;
    const station      = document.getElementById('station').value;
    const location     = document.getElementById('location').value;
    const channel      = document.getElementById('channel').value;
    const timeWindow   = parseFloat(document.getElementById('timeWindow').value);
    const fdsnService  = document.getElementById('fdsnService').value;
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

        const endTime   = new Date();
        const startTime = new Date(endTime.getTime() - timeWindow * 3600 * 1000);

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

        const result = JSON.parse(await PyEnv.asyncEval(call));

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

    } catch (err) {
        console.error('Fetch error:', err);
        output.textContent += 'Error: ' + err.message + '\n';
    } finally {
        fetchBtn.disabled = false;
        fetchSpinner.style.display = 'none';
        fetchText.textContent = 'Fetch Data';
    }
}

document.getElementById('fetchData').addEventListener('click', fetchData);
