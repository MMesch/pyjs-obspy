import json
import io
import base64
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from obspy.imaging.beachball import beachball as _beachball


async def plot_beachball(input_type, values, facecolor='steelblue'):
    """
    input_type: 'focal' (strike, dip, rake) or 'mt' (Mrr, Mtt, Mpp, Mrt, Mrp, Mtp)
    values: list of 3 or 6 floats
    facecolor: color string
    """
    try:
        buf = io.BytesIO()
        _beachball(values, linewidth=2, facecolor=facecolor,
                   outfile=buf, format='png')
        buf.seek(0)
        plot = base64.b64encode(buf.read()).decode('utf-8')
        plt.close('all')
        return json.dumps({'plot': plot})
    except Exception as e:
        return json.dumps({'error': str(e)})
