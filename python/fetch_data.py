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

current_stream = None


async def fetch_data(fdsn_service, network, station, location, channel,
               starttime_iso, endtime_iso, attach_response=True, remove_response=True):
    global current_stream

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

    result = {
        'num_traces': len(st),
        'has_response': hasattr(st[0].stats, 'response') if len(st) > 0 else False,
        'response_attempted': attach_response,
        'traces': [],
        'raw_plot': None,
        'processed_plot': None,
        'response_removed': False,
    }

    for trace in st:
        result['traces'].append({
            'network': trace.stats.network,
            'station': trace.stats.station,
            'location': trace.stats.location,
            'channel': trace.stats.channel,
            'starttime': str(trace.stats.starttime),
            'endtime': str(trace.stats.endtime),
            'sampling_rate': trace.stats.sampling_rate,
            'npts': trace.stats.npts,
        })

    if len(st) > 0:
        fig = plt.figure(figsize=(20, 6))
        st.plot(fig=fig, equal_scale=False)
        buf = io.BytesIO()
        plt.savefig(buf, format='png', dpi=100, bbox_inches='tight')
        buf.seek(0)
        result['raw_plot'] = base64.b64encode(buf.read()).decode('utf-8')
        plt.close(fig)

    if remove_response and len(st) > 0 and result['has_response']:
        try:
            st_proc = st.copy()
            st_proc.remove_response(output='VEL', pre_filt=[0.005, 0.01, 5, 10])
            fig = plt.figure(figsize=(20, 6))
            st_proc.plot(fig=fig, equal_scale=False)
            buf = io.BytesIO()
            plt.savefig(buf, format='png', dpi=100, bbox_inches='tight')
            buf.seek(0)
            result['processed_plot'] = base64.b64encode(buf.read()).decode('utf-8')
            result['response_removed'] = True
            plt.close(fig)
        except Exception as e:
            result['response_removal_error'] = str(e)

    current_stream = st
    return json.dumps(result, cls=_NumpyEncoder)
