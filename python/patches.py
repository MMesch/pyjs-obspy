import pyodide_http
pyodide_http.patch_all()

# ObsPy mseed write: rec_handler is created as CFUNCTYPE(c_void_p, ...) but the
# C function expects a void callback — WASM type iiii vs viii → call_indirect trap.
# Wrap _write_mseed to temporarily fix CFUNCTYPE so c_void_p return becomes None.
import ctypes as _C
import obspy.io.mseed.core as _mseed_core

_orig_CFUNCTYPE = _C.CFUNCTYPE
_orig_write_mseed = _mseed_core._write_mseed

def _write_mseed_fixed(*args, **kwargs):
    def _cfunctype_void_fixed(restype, *argtypes, **kw):
        if restype is _C.c_void_p:
            restype = None
        return _orig_CFUNCTYPE(restype, *argtypes, **kw)
    _C.CFUNCTYPE = _cfunctype_void_fixed
    try:
        return _orig_write_mseed(*args, **kwargs)
    finally:
        _C.CFUNCTYPE = _orig_CFUNCTYPE

_mseed_core._write_mseed = _write_mseed_fixed
