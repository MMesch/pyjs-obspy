const PyEnv = (() => {
    let _pyjs = null;
    let _ready = false;

    function _setLoadingBar(pct) {
        const el = document.getElementById('loadingBar');
        if (el) el.style.width = pct + '%';
    }

    function _setLoadingStatus(msg) {
        const el = document.getElementById('loadingStatus');
        if (el) el.textContent = msg;
    }

    async function _loadFile(path) {
        const resp = await fetch(path);
        if (!resp.ok) throw new Error('Failed to load ' + path + ' (' + resp.status + ')');
        return resp.text();
    }

    async function initialize() {
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
            _setLoadingStatus('Environment ready!');
            _ready = true;
            document.dispatchEvent(new Event('pyready'));

            setTimeout(() => {
                const bar = document.querySelector('.loading-bar-container');
                if (bar) bar.style.display = 'none';
            }, 2000);

        } catch (err) {
            console.error('PyEnv init error:', err);
            _setLoadingStatus('Error initializing environment: ' + err.message);
        }
    }

    function exec(code) {
        if (!_ready) throw new Error('Python environment not ready');
        return _pyjs.exec(code);
    }

    async function asyncEval(code) {
        if (!_ready) throw new Error('Python environment not ready');
        return _pyjs.async_exec_eval(code);
    }

    return { initialize, exec, asyncEval, get ready() { return _ready; } };
})();

PyEnv.initialize();
