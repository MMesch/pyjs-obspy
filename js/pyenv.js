const PyEnv = (() => {
    let _pyjs = null;
    let _ready = false;
    let _initStart = null;
    let _initElapsed = null;
    let _timings = {};

    function _setLoadingBar(pct) {
        const el = document.getElementById('loadingBar');
        if (el) el.style.width = pct + '%';
    }

    function _setLoadingStatus(msg, done) {
        const txt = document.getElementById('loadingText');
        const el  = document.getElementById('loadingStatus');
        if (txt) txt.textContent = msg;
        if (el)  el.classList.toggle('ready', !!done);
    }

    function _setLoadingStatusHTML(html, done) {
        const txt = document.getElementById('loadingText');
        const el  = document.getElementById('loadingStatus');
        if (txt) txt.innerHTML = html;
        if (el)  el.classList.toggle('ready', !!done);
    }

    function _tip(label, tooltip) {
        const esc = tooltip.replace(/"/g, '&quot;').replace(/\n/g, '&#10;');
        return '<span title="' + esc + '" style="border-bottom:1px dotted currentColor;cursor:help">'
            + label + '</span>';
    }

    const _cacheBust = '?v=' + Date.now();

    async function _loadFile(path) {
        const resp = await fetch(path + _cacheBust);
        if (!resp.ok) throw new Error('Failed to load ' + path + ' (' + resp.status + ')');
        return resp.text();
    }

    function _wasmStats() {
        const e = performance.getEntriesByType('resource')
            .find(r => r.name.includes('pyjs_runtime_browser.wasm'));
        if (!e) return null;
        const cached = e.transferSize === 0 && e.decodedBodySize > 0;
        const networkS = (e.duration / 1000).toFixed(1);
        const sizeMB = (e.decodedBodySize / 1048576).toFixed(1);
        return { cached, networkS, sizeMB };
    }

    function _packageStats() {
        const entries = performance.getEntriesByType('resource')
            .filter(e => e.name.includes('/packages/') || e.name.includes('empack_env_meta'));
        let transferred = 0, decoded = 0;
        for (const e of entries) {
            transferred += e.transferSize   || 0;
            decoded     += e.decodedBodySize || 0;
        }
        const cached = transferred === 0 && decoded > 0;
        const mb = (b) => (b / 1048576).toFixed(1) + ' MB';
        return { transferred, decoded, cached, mb };
    }

    function _readyHTML(opElapsed) {
        const t = _timings;
        const wasm = _wasmStats();
        const pkg  = _packageStats();

        const wasmTooltip = [
            'Fetches and compiles the Python WebAssembly binary'
                + (wasm ? ' (' + wasm.sizeMB + ' MB)' : '') + '.',
            wasm && wasm.cached
                ? 'Served from browser cache — no network request.'
                : wasm
                    ? 'Network fetch took ' + wasm.networkS + ' s; the rest is browser WASM compilation.'
                    : '',
            'The browser caches the compiled result so subsequent loads are faster.',
        ].filter(Boolean).join('\n');

        const pkgCacheNote = pkg.cached
            ? 'Served from browser cache — no network request. Unpacking into the\nin-browser filesystem still takes several seconds even when cached.'
            : pkg.transferred > 0
                ? pkg.mb(pkg.transferred) + ' transferred over the network.'
                : '';
        const pkgNote = pkg.cached ? 'cached' : pkg.mb(pkg.transferred);
        const pkgTooltip = [
            'Downloads and installs ObsPy, NumPy, SciPy and all other Python',
            'dependencies into the in-browser virtual filesystem'
                + (pkg.decoded > 0 ? ' (' + pkg.mb(pkg.decoded) + ' unpacked).' : '.'),
            pkgCacheNote,
        ].filter(Boolean).join('\n');

        const pyTooltip = 'First-time import of obspy, numpy, scipy and other modules.\n'
            + 'Runs on every page load regardless of caching.';

        let parts = [];
        if (opElapsed !== null)
            parts.push('last operation ' + opElapsed + ' s');
        parts.push(_tip('interpreter ' + t.wasm + ' s', wasmTooltip));
        parts.push(_tip('packages ' + t.packages + ' s, ' + pkgNote, pkgTooltip));
        parts.push(_tip('Python ' + t.pyinit + ' s', pyTooltip));
        parts.push('total ' + _initElapsed + ' s');

        return 'Ready — ' + parts.join(' · ');
    }

    async function initialize() {
        _initStart = Date.now();
        try {
            _setLoadingStatus('Interpreter: loading WebAssembly…');
            _setLoadingBar(10);

            const locateFile = (filename) =>
                filename.endsWith('pyjs_runtime_browser.wasm')
                    ? './pyjs_runtime_browser.wasm'
                    : filename;

            const t0 = Date.now();
            _pyjs = await createModule({ locateFile });
            window.Module = _pyjs; // expose for ctypes/libffi addFunction lookup
            _timings.wasm = ((Date.now() - t0) / 1000).toFixed(1);

            _setLoadingBar(30);
            _setLoadingStatus('Packages: downloading and installing…');

            const t1 = Date.now();
            await _pyjs.bootstrap_from_empack_packed_environment(
                './empack_env_meta.json',
                './packages/'
            );
            _timings.packages = ((Date.now() - t1) / 1000).toFixed(1);

            _setLoadingBar(80);
            _setLoadingStatus('Python: importing modules…');

            const t2 = Date.now();
            _pyjs.exec(await _loadFile('./python/patches.py'));
            _setLoadingStatus('Python: loading app modules…');
            _pyjs.exec(await _loadFile('./python/fetch_data.py'));
            _pyjs.exec(await _loadFile('./python/beachball.py'));
            _pyjs.exec(await _loadFile('./python/taup.py'));
            _timings.pyinit = ((Date.now() - t2) / 1000).toFixed(1);

            _setLoadingBar(100);
            _initElapsed = ((Date.now() - _initStart) / 1000).toFixed(1);
            _setLoadingStatusHTML(_readyHTML(null), true);
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
        _setLoadingStatus(label || 'Running Python…');
        const t0 = Date.now();
        try {
            return await _pyjs.async_exec_eval(code);
        } finally {
            const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
            _setLoadingStatusHTML(_readyHTML(elapsed), true);
        }
    }

    async function probe() {
        const code = [
            'import sys, json, pyjs',
            'r = {"platform": sys.platform}',
            'try:',
            '    jsg = pyjs.js',
            '    r["pyjs.js.Module"] = hasattr(jsg, "Module")',
            '    r["pyjs.js.addFunction"] = hasattr(jsg, "addFunction")',
            '    if hasattr(jsg, "Module"):',
            '        r["pyjs.js.Module.addFunction"] = hasattr(jsg.Module, "addFunction")',
            'except Exception as e:',
            '    r["pyjs.js_err"] = str(e)',
            'try:',
            '    import ctypes, inspect',
            '    src = open(inspect.getsourcefile(ctypes)).read()',
            '    r["ctypes_src_file"] = inspect.getsourcefile(ctypes)',
            '    r["ctypes_has_addFunction"] = "addFunction" in src',
            '    r["ctypes_has_pyodide"] = "pyodide" in src.lower()',
            '    r["ctypes_has_ffi_tramp"] = "ffi_tramp" in src',
            'except Exception as e:',
            '    r["ctypes_src_err"] = str(e)',
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
