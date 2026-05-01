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


async def get_stations_near(fdsn_service, lat, lon, maxradius_deg=15.0, at_time_iso=None):
    client = Client(fdsn_service, _discover_services=False)
    kwargs = dict(
        latitude=float(lat),
        longitude=float(lon),
        maxradius=float(maxradius_deg),
        channel='LH*,BH*,HH*',
        level='station',
    )
    if at_time_iso:
        t = UTCDateTime(at_time_iso)
        kwargs['starttime'] = t - 86400   # station must have been active at event time
        kwargs['endtime']   = t + 86400
    try:
        inv = client.get_stations(**kwargs)
    except Exception as e:
        return json.dumps({'error': str(e), 'stations': []})

    stations = []
    for net in inv:
        for sta in net:
            stations.append({
                'network': net.code,
                'station': sta.code,
                'lat':     float(sta.latitude),
                'lon':     float(sta.longitude),
                'name':    sta.site.name if sta.site else '',
            })
    return json.dumps({'stations': stations}, cls=_NumpyEncoder)


def _write_mseed_pure(st):
    import struct
    RECORD_SIZE = 4096
    DATA_OFFSET = 56          # 48-byte fixed header + 8-byte Blockette 1000
    SPR = (RECORD_SIZE - DATA_OFFSET) // 4   # 1010 samples per record

    def _btime(t):
        us = int(round(t.microsecond / 100))  # 1/10000 s units
        return struct.pack('>HHBBBBH',
                           t.year, t.julday,
                           t.hour, t.minute, t.second, 0, us)

    def _sr_fac_mul(sr):
        if sr >= 1.0:
            return int(round(sr)), 1
        else:
            return 1, -int(round(1.0 / sr))

    buf = bytearray()
    seq = [1]

    for tr in st:
        net = tr.stats.network[:2].encode().ljust(2)
        sta = tr.stats.station[:5].encode().ljust(5)
        loc = tr.stats.location[:2].encode().ljust(2)
        cha = tr.stats.channel[:3].encode().ljust(3)
        fac, mul = _sr_fac_mul(tr.stats.sampling_rate)
        samples = np.round(tr.data).astype('>i4')

        for off in range(0, max(len(samples), 1), SPR):
            chunk = samples[off:off + SPR]
            n = len(chunk)
            t_start = tr.stats.starttime + off / tr.stats.sampling_rate

            hdr = struct.pack('>6scc5s2s3s2s',
                              f'{seq[0]:06d}'.encode(), b'D', b' ',
                              sta, loc, cha, net)
            seq[0] += 1
            hdr += _btime(t_start)
            hdr += struct.pack('>HhhBBBBiHH',
                               n, fac, mul,
                               0, 0, 0, 1, 0,
                               DATA_OFFSET, 48)
            blk1000 = struct.pack('>HHBBBB', 1000, 0, 3, 1, 12, 0)
            data_bytes = chunk.tobytes()
            record = hdr + blk1000 + data_bytes
            pad = RECORD_SIZE - len(record)
            if pad < 0:
                raise ValueError('Record overflow')
            buf += record + b'\x00' * pad

    return bytes(buf)


async def export_stream_serialise(fmt, use_processed=False):
    import os
    st = (_processed_stream if (use_processed and _processed_stream is not None)
          else current_stream)
    if st is None or len(st) == 0:
        return json.dumps({'error': 'No data loaded'})

    label = st[0].id + '_' + str(st[0].stats.starttime)[:16].replace(':', 'h')

    try:
        if fmt == 'mseed':
            data = base64.b64encode(_write_mseed_pure(st)).decode()
            return json.dumps({'data': data, 'filename': label + '.mseed',
                               'mime': 'application/octet-stream'})

        if fmt == 'sac':
            import zipfile
            os.makedirs('/tmp/_sac', exist_ok=True)
            for tr in st:
                tr.write('/tmp/_sac/' + tr.id + '.sac', format='SAC')
            zip_path = '/tmp/_export.zip'
            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_STORED) as zf:
                for fname in os.listdir('/tmp/_sac'):
                    zf.write('/tmp/_sac/' + fname, fname)
                    os.unlink('/tmp/_sac/' + fname)
            os.rmdir('/tmp/_sac')
            with open(zip_path, 'rb') as f:
                data = base64.b64encode(f.read()).decode()
            os.unlink(zip_path)
            return json.dumps({'data': data, 'filename': label + '_sac.zip',
                               'mime': 'application/zip'})

        elif fmt == 'csv':
            rows = ['network,station,location,channel,time,value']
            for tr in st:
                net, sta, loc, cha = (tr.stats.network, tr.stats.station,
                                      tr.stats.location, tr.stats.channel)
                t0    = tr.stats.starttime
                delta = tr.stats.delta
                for i, v in enumerate(tr.data):
                    rows.append(f'{net},{sta},{loc},{cha},'
                                f'{(t0 + i * delta).isoformat()},{v}')
            text = '\n'.join(rows)
            data = base64.b64encode(text.encode()).decode()
            return json.dumps({'data': data, 'filename': label + '.csv',
                               'mime': 'text/csv'})

        return json.dumps({'error': 'Unknown format: ' + fmt})

    except Exception as e:
        return json.dumps({'error': f'{type(e).__name__}: {e}'})
