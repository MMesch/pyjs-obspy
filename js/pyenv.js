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

    const _cacheBust = '?v=' + Date.now();

    async function _loadFile(path) {
        const resp = await fetch(path + _cacheBust);
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
            window.Module = _pyjs; // expose for ctypes/libffi addFunction lookup
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

    async function probe() {
        const code = [
            'import sys, json, pyjs',
            'r = {"platform": sys.platform}',
            // pyjs.js — the JavaScript global object
            'try:',
            '    jsg = pyjs.js',
            '    r["pyjs.js.Module"] = hasattr(jsg, "Module")',
            '    r["pyjs.js.addFunction"] = hasattr(jsg, "addFunction")',
            '    if hasattr(jsg, "Module"):',
            '        r["pyjs.js.Module.addFunction"] = hasattr(jsg.Module, "addFunction")',
            'except Exception as e:',
            '    r["pyjs.js_err"] = str(e)',
            // ctypes source — is it Pyodide-patched?
            'try:',
            '    import ctypes, inspect',
            '    src = open(inspect.getsourcefile(ctypes)).read()',
            '    r["ctypes_src_file"] = inspect.getsourcefile(ctypes)',
            '    r["ctypes_has_addFunction"] = "addFunction" in src',
            '    r["ctypes_has_pyodide"] = "pyodide" in src.lower()',
            '    r["ctypes_has_ffi_tramp"] = "ffi_tramp" in src',
            'except Exception as e:',
            '    r["ctypes_src_err"] = str(e)',
            // ctypes callback creation test
            'try:',
            '    import ctypes',
            '    HANDLER = ctypes.CFUNCTYPE(None, ctypes.c_int)',
            '    def _cb(x): pass',
            '    cb = HANDLER(_cb)',
            '    r["ctypes_cb_type"] = str(type(cb))',
            '    r["ctypes_cb_addr"] = ctypes.cast(cb, ctypes.c_void_p).value',
            'except Exception as e:',
            '    r["ctypes_cb_err"] = str(e)',
            'json.dumps(r)',
        ].join('\n');
        const result = JSON.parse(await asyncEval(code, 'Probing JS interop...'));
        console.log('PyEnv probe result:', result);
        return result;
    }

    return { initialize, exec, asyncEval, probe, get ready() { return _ready; } };
})();

PyEnv.initialize();
