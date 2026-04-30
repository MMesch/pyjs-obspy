const PyEnv = (() => {
    let _pyjs = null;
    let _ready = false;
    let _initStart = null;
    let _initElapsed = null;

    function _setLoadingBar(pct) {
        const el = document.getElementById('loadingBar');
        if (el) el.style.width = pct + '%';
    }

    function _setLoadingStatus(msg, done) {
        const el = document.getElementById('loadingStatus');
        const txt = document.getElementById('loadingText');
        if (txt) txt.textContent = msg;
        if (el) el.classList.toggle('ready', !!done);
    }

    async function _loadFile(path) {
        const resp = await fetch(path);
        if (!resp.ok) throw new Error('Failed to load ' + path + ' (' + resp.status + ')');
        return resp.text();
    }

    async function initialize() {
        _initStart = Date.now();
        try {
            _setLoadingStatus('Initializing Python runtime...');
            _setLoadingBar(10);

            const locateFile = (filename) =>
                filename.endsWith('pyjs_runtime_browser.wasm')
                    ? './pyjs_runtime_browser.wasm'
                    : filename;

            _pyjs = await createModule({ locateFile });
            _setLoadingBar(40);
            _setLoadingStatus('Loading Obspy environment...');

            await _pyjs.bootstrap_from_empack_packed_environment(
                './empack_env_meta.json',
                './packages/'
            );

            _setLoadingBar(80);
            _setLoadingStatus('Applying patches...');
            _pyjs.exec(await _loadFile('./python/patches.py'));

            _setLoadingStatus('Loading Python modules...');
            _pyjs.exec(await _loadFile('./python/fetch_data.py'));
            _pyjs.exec(await _loadFile('./python/beachball.py'));
            _pyjs.exec(await _loadFile('./python/taup.py'));

            _setLoadingBar(100);
            _initElapsed = ((Date.now() - _initStart) / 1000).toFixed(1);
            _setLoadingStatus('Environment ready — loaded in ' + _initElapsed + ' s', true);
            _ready = true;
            setTimeout(() => document.dispatchEvent(new Event('pyready')), 450);

        } catch (err) {
            console.error('PyEnv init error:', err);
            _setLoadingStatus('Error initializing environment: ' + err.message);
        }
    }

    function exec(code) {
        if (!_ready) throw new Error('Python environment not ready');
        return _pyjs.exec(code);
    }

    async function asyncEval(code, label) {
        if (!_ready) throw new Error('Python environment not ready');
        _setLoadingBar(100);
        _setLoadingStatus(label || 'Running Python...');
        const t0 = Date.now();
        try {
            return await _pyjs.async_exec_eval(code);
        } finally {
            const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
            _setLoadingStatus('Ready — ' + elapsed + ' s  (env loaded in ' + _initElapsed + ' s)', true);
        }
    }

    return { initialize, exec, asyncEval, get ready() { return _ready; } };
})();

PyEnv.initialize();
