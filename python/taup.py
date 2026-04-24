import json
import io
import base64
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt


async def plot_taup(plot_type, source_depth_km, phases, distance_deg=None, model_name='iasp91'):
    """
    plot_type:        'travel_times' | 'rays_cartesian' | 'rays_spherical'
    source_depth_km:  float
    phases:           list of phase name strings
    distance_deg:     float, required for ray plots
    model_name:       'iasp91' | 'ak135'
    """
    try:
        if plot_type == 'travel_times':
            from obspy.taup import plot_travel_times
            fig, ax = plt.subplots(figsize=(10, 8))
            plot_travel_times(
                source_depth=source_depth_km,
                phase_list=phases,
                model=model_name,
                ax=ax,
                fig=fig,
                show=False,
            )
        else:
            from obspy.taup import TauPyModel
            model = TauPyModel(model=model_name)
            arrivals = model.get_ray_paths(
                source_depth_in_km=source_depth_km,
                distance_in_degree=distance_deg,
                phase_list=phases,
            )
            ray_type = 'cartesian' if plot_type == 'rays_cartesian' else 'spherical'
            arrivals.plot_rays(
                plot_type=ray_type,
                show=False,
                legend=True,
                plot_all=False,
            )
            fig = plt.gcf()

        buf = io.BytesIO()
        fig.savefig(buf, format='png', dpi=100, bbox_inches='tight')
        buf.seek(0)
        plot = base64.b64encode(buf.read()).decode('utf-8')
        plt.close(fig)
        return json.dumps({'plot': plot})

    except Exception as e:
        return json.dumps({'error': str(e)})
