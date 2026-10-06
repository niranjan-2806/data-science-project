/**
 * server.ts
 * =========
 * Express server entry point mounting the ML pipeline API routes and Vite dev middleware.
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { MLPipeline, REAL_WORLD_PRESETS } from './server/pipeline.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const isProd = process.env.NODE_ENV === 'production';
const PORT = isProd ? parseInt(process.env.PORT || '8080', 10) : 3000;

app.use(express.json({ limit: '10mb' }));

// Initialize pipeline
const pipeline = new MLPipeline(path.resolve(__dirname, 'data'));
pipeline.init();

// Health endpoints
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'popularity-dynamics-backend',
    videos_loaded: String(pipeline.getVideoIds().length),
  });
});

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'popularity-dynamics-backend',
    videos_loaded: String(pipeline.getVideoIds().length),
  });
});

// Series Catalog
app.get('/api/series', (_req, res) => {
  const series = pipeline.getSeriesList();
  res.json({ series });
});

// Video catalog with optional series filter
app.get('/api/videos', (req, res) => {
  const seriesFilter = (req.query.series as string | undefined) || undefined;
  const videoIds = pipeline.getVideoIds();

  const videoItems = [];
  for (const vid of videoIds) {
    const feat = pipeline.features.get(vid);
    if (!feat) continue;
    if (seriesFilter && feat.series_name !== seriesFilter) continue;

    const cId = pipeline.videoToCluster.get(vid) ?? -1;
    const cluster = pipeline.clusters.find((c) => c.cluster_id === cId);
    const clusterName = cluster ? cluster.cluster_name : 'Unknown';
    const score = pipeline.scores.get(vid);

    videoItems.push({
      video_id: vid,
      series_name: feat.series_name,
      episode_title: feat.episode_title,
      total_views_30d: feat.total_views_30d,
      peak_day: feat.peak_day,
      peak_value: feat.peak_value,
      early_growth_3d: feat.early_growth_3d,
      cluster_id: cId,
      cluster_name: clusterName,
      performance_score: score?.total_score ?? 75,
      grade: score?.grade ?? 'B',
      grade_label: score?.grade_label ?? 'Solid Catalog Performer',
    });
  }

  videoItems.sort((a, b) => a.video_id.localeCompare(b.video_id));

  res.json({
    total_count: videoItems.length,
    selected_series: seriesFilter || null,
    videos: videoItems,
  });
});

// Video Details
app.get('/api/video/:videoId', (req, res) => {
  const vid = req.params.videoId;
  const feat = pipeline.features.get(vid);
  const dailyStats = pipeline.getDailyStatsForVideo(vid);

  if (!feat || dailyStats.length === 0) {
    return res.status(404).json({ detail: `Video with id '${vid}' not found` });
  }

  const forecastInfo = pipeline.forecasts.get(vid) || {};
  const cId = pipeline.videoToCluster.get(vid) ?? -1;
  const cluster = pipeline.clusters.find((c) => c.cluster_id === cId);
  const scoreInfo = pipeline.scores.get(vid) || null;

  res.json({
    video_id: vid,
    series_name: feat.series_name,
    episode_title: feat.episode_title,
    daily_stats: dailyStats.map((d) => ({
      day_index: d.day_index,
      date: d.date,
      views: d.views,
      likes: d.likes,
      comments: d.comments,
      search_interest: d.search_interest,
    })),
    features: {
      growth_rate: feat.growth_rate,
      peak_day: feat.peak_day,
      peak_value: feat.peak_value,
      decay_slope: feat.decay_slope,
      volatility: feat.volatility,
      total_views_30d: feat.total_views_30d,
      early_growth_3d: feat.early_growth_3d,
    },
    forecast: forecastInfo,
    score: scoreInfo,
    cluster: {
      cluster_id: cId,
      cluster_name: cluster ? cluster.cluster_name : 'Unassigned',
      cluster_description: cluster ? cluster.description : '',
    },
  });
});

// Clusters
app.get('/api/clusters', (_req, res) => {
  res.json({
    silhouette_score: pipeline.silhouetteScore,
    n_clusters: pipeline.clusters.length,
    clusters: pipeline.clusters,
  });
});

// Summary
app.get('/api/summary', (_req, res) => {
  if (!pipeline.summary) {
    return res.status(503).json({ detail: 'Summary not ready' });
  }
  res.json(pipeline.summary);
});

// Presets Catalog
app.get('/api/import/presets', (_req, res) => {
  res.json({ presets: Object.values(REAL_WORLD_PRESETS) });
});

// Import Preset
app.post('/api/import/preset', (req, res) => {
  try {
    const { preset_id } = req.body || {};
    if (!preset_id) {
      return res.status(400).json({ detail: 'preset_id is required' });
    }
    const result = pipeline.importPreset(preset_id);
    res.json({
      status: 'success',
      video_id: result.video_id,
      message: result.message,
      series_name: result.series_name,
    });
  } catch (err: any) {
    res.status(400).json({ detail: err.message || 'Error importing preset' });
  }
});

// Import Custom Video
app.post('/api/import/custom', (req, res) => {
  try {
    const { episode_title, series_name, daily_views } = req.body || {};
    if (!episode_title || !episode_title.trim()) {
      return res.status(400).json({ detail: 'episode_title is required' });
    }
    if (!Array.isArray(daily_views) || daily_views.length < 7) {
      return res.status(400).json({ detail: 'daily_views must be a list of at least 7 numbers (up to 31)' });
    }
    const result = pipeline.importCustom(
      episode_title.trim(),
      (series_name || 'User Imported Videos').trim(),
      daily_views.map(Number)
    );
    res.json({
      status: 'success',
      video_id: result.video_id,
      message: result.message,
      series_name: result.series_name,
    });
  } catch (err: any) {
    res.status(400).json({ detail: err.message || 'Error importing custom video' });
  }
});

// Reset Dataset
app.post('/api/import/reset', (_req, res) => {
  try {
    const result = pipeline.resetCorpus();
    res.json({
      status: 'success',
      message: result.message,
      videos_loaded: result.videos_loaded,
    });
  } catch (err: any) {
    res.status(500).json({ detail: err.message || 'Error resetting corpus' });
  }
});

// Vite Middleware or Static Production Serving
async function startServer() {
  if (isProd) {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Popularity Dynamics] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[Popularity Dynamics] Server start failure:', err);
  process.exit(1);
});
