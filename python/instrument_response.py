import json
import io
import base64
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt


async def plot_instrument_response():
    if current_stream is None:
        return json.dumps({'error': 'No data fetched yet. Use the Data Fetching tab first.'})

    traces_with_response = [tr for tr in current_stream if hasattr(tr.stats, 'response')]
    if not traces_with_response:
        return json.dumps({'error': 'No instrument response attached. Re-fetch with "Attach instrument response" checked.'})

    plots = []
    for trace in traces_with_response:
        seed_id = trace.id
        fig = trace.stats.response.plot(
            min_freq=0.001,
            output='VEL',
            show=False,
        )
        buf = io.BytesIO()
        fig.savefig(buf, format='png', dpi=100, bbox_inches='tight')
        buf.seek(0)
        plots.append({
            'seed_id': seed_id,
            'plot': base64.b64encode(buf.read()).decode('utf-8'),
        })
        plt.close(fig)

    return json.dumps({'plots': plots})
