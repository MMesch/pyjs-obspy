import warnings
warnings.filterwarnings('ignore')

import json
import numpy as np
import obspy
from obspy.clients.fdsn import Client
from obspy import UTCDateTime
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import io
import base64


class _NumpyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.integer):
            return int(obj)
        if isinstance(obj, np.floating):
            return float(obj)
        return super().default(obj)


def _plot_stream(st):
    fig = plt.figure(figsize=(20, 6))
    st.plot(fig=fig, equal_scale=False)
    buf = io.BytesIO()
    plt.savefig(buf, format='png', dpi=100, bbox_inches='tight')
    buf.seek(0)
    data = base64.b64encode(buf.read()).decode('utf-8')
    plt.close(fig)
    return data


current_stream = None
_processed_stream = None


async def fetch_raw(fdsn_service, network, station, location, channel,
                    starttime_iso, endtime_iso, attach_response=True):
    global current_stream, _processed_stream
    _processed_stream = None

    client = Client(fdsn_service, _discover_services=False)
    starttime = UTCDateTime(starttime_iso)
    endtime = UTCDateTime(endtime_iso)

    st = client.get_waveforms(
        network=network,
        station=station,
        location=location,
        channel=channel,
        starttime=starttime,
        endtime=endtime,
        attach_response=attach_response,
    )
    current_stream = st

    result = {
        'num_traces': len(st),
        'has_response': len(st) > 0 and hasattr(st[0].stats, 'response'),
        'traces': [{
            'network':       tr.stats.network,
            'station':       tr.stats.station,
            'location':      tr.stats.location,
            'channel':       tr.stats.channel,
            'starttime':     str(tr.stats.starttime),
            'endtime':       str(tr.stats.endtime),
            'sampling_rate': tr.stats.sampling_rate,
            'npts':          tr.stats.npts,
        } for tr in st],
        'raw_plot': _plot_stream(st) if len(st) > 0 else None,
    }
    return json.dumps(result, cls=_NumpyEncoder)


async def process_stream():
    global current_stream, _processed_stream
    if current_stream is None or len(current_stream) == 0:
        return json.dumps({'error': 'No stream loaded'})

    st_proc = current_stream.copy()
    st_proc.remove_response(output='VEL', pre_filt=[0.005, 0.01, 5, 10])
    _processed_stream = st_proc

    return json.dumps({
        'processed_plot': _plot_stream(st_proc),
    }, cls=_NumpyEncoder)


async def compute_spectrograms():
    global current_stream, _processed_stream
    st_src = (_processed_stream if _processed_stream is not None else current_stream)
    if st_src is None:
        return json.dumps({'spectrograms': []})

    st_for_spec = st_src.copy()
    for tr in st_for_spec:
        factor = int(tr.stats.sampling_rate / 25)
        if factor > 1:
            tr.decimate(factor, no_filter=False)

    spectrograms = []
    for tr in st_for_spec:
        tr.spectrogram(show=False, title=tr.id)
        fig = plt.gcf()
        buf = io.BytesIO()
        fig.savefig(buf, format='png', dpi=100, bbox_inches='tight')
        buf.seek(0)
        spectrograms.append({
            'seed_id': tr.id,
            'plot':    base64.b64encode(buf.read()).decode('utf-8'),
        })
        plt.close(fig)

    return json.dumps({'spectrograms': spectrograms}, cls=_NumpyEncoder)


async def compute_response_plot():
    global current_stream
    if current_stream is None:
        return json.dumps({})

    traces_with_response = [tr for tr in current_stream if hasattr(tr.stats, 'response')]
    if not traces_with_response:
        return json.dumps({})

    tr = traces_with_response[0]
    fig = tr.stats.response.plot(min_freq=0.001, output='VEL', show=False)
    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=100, bbox_inches='tight')
    buf.seek(0)
    result = {
        'response_plot':    base64.b64encode(buf.read()).decode('utf-8'),
        'response_channel': tr.id,
    }
    plt.close(fig)
    return json.dumps(result, cls=_NumpyEncoder)
