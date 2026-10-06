"""
backend/app.py
==============
FastAPI REST API server exposing time-series analytics, feature extraction,
supervised forecasting, and unsupervised trajectory clustering.

Endpoints:
- GET /api/health: Health check and status
- GET /api/series: Unique series catalog
- GET /api/videos?series=...: Filtered or full video list with headline metrics
- GET /api/video/{video_id}: Full 31-day history, engineered features, and 7-day forecast
- GET /api/clusters: 4 discovered shape archetypes, centroids, and representative medoid curves
- GET /api/summary: Model evaluation metrics, plain-English explanations, and empirical insights
"""

import os
import sys
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

# Ensure project root is on sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import numpy as np
import pandas as pd

from backend.clustering import TrajectoryClusteringEngine
from backend.data_generator import generate_dataset, save_dataset
from backend.evaluation import generate_evaluation_summary
from backend.features import compute_features_from_dataframe, save_features
from backend.forecasting import ForecastingEngine

# Global in-memory cache for ultra-fast, low-latency API responses
DATA_CACHE: Dict[str, Any] = {
    "daily_df": None,
    "features_df": None,
    "forecasting_engine": None,
    "clustering_engine": None,
    "summary": None,
}


def initialize_pipeline(data_dir: str = "data"):
    """Loads existing data or runs the complete end-to-end ML pipeline."""
    csv_path = os.path.join(data_dir, "daily_stats.csv")
    if not os.path.exists(csv_path):
        print(f"[Pipeline] Generating new dataset in {data_dir}...")
        daily_df, _ = generate_dataset(n_items=48, days=31)
        save_dataset(daily_df, data_dir)
    else:
        print(f"[Pipeline] Loading existing dataset from {csv_path}...")
        daily_df = pd.read_csv(csv_path)

    features_path = os.path.join(data_dir, "features.csv")
    if not os.path.exists(features_path):
        print("[Pipeline] Computing engineered features...")
        features_df = compute_features_from_dataframe(daily_df)
        save_features(features_df, data_dir)
    else:
        features_df = pd.read_csv(features_path)

    print("[Pipeline] Training forecasting engine...")
    forecasting_engine = ForecastingEngine(random_state=42)
    forecasting_engine.train_and_evaluate(daily_df)

    print("[Pipeline] Fitting trajectory clustering engine...")
    clustering_engine = TrajectoryClusteringEngine(n_clusters=4, random_state=42)
    clustering_engine.fit_and_summarize(daily_df, features_df)

    print("[Pipeline] Generating evaluation synthesis & insights...")
    summary = generate_evaluation_summary(
        daily_df, features_df, forecasting_engine, clustering_engine
    )

    DATA_CACHE["daily_df"] = daily_df
    DATA_CACHE["features_df"] = features_df
    DATA_CACHE["forecasting_engine"] = forecasting_engine
    DATA_CACHE["clustering_engine"] = clustering_engine
    DATA_CACHE["summary"] = summary
    print("[Pipeline] Pipeline ready!")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure initialized on startup
    if DATA_CACHE["daily_df"] is None:
        initialize_pipeline("data")
    yield


app = FastAPI(
    title="Popularity Dynamics Analysis API",
    description="Data science backend for digital content popularity trajectories, supervised forecasting, and unsupervised clustering.",
    version="1.0.0",
    lifespan=lifespan,
)

# Also run initialization at import time so data is immediately available
try:
    initialize_pipeline("data")
except Exception as e:
    print(f"[Pipeline] Warning during module-level initialization: {e}")

# Enable CORS for local development and preview environments
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
@app.get("/api/health")
def get_health() -> Dict[str, str]:
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "popularity-dynamics-backend",
        "videos_loaded": str(
            DATA_CACHE["daily_df"]["video_id"].nunique()
            if DATA_CACHE["daily_df"] is not None
            else 0
        ),
    }


@app.get("/api/series")
def get_series() -> Dict[str, List[str]]:
    """Returns the list of distinct content series."""
    df = DATA_CACHE["daily_df"]
    if df is None:
        raise HTTPException(status_code=503, detail="Pipeline data not initialized")
    series_list = sorted(df["series_name"].unique().tolist())
    return {"series": series_list}


@app.get("/api/videos")
def get_videos(series: Optional[str] = Query(None, description="Optional series filter")) -> Dict[str, Any]:
    """Returns video catalog, optionally filtered by series, enriched with cluster metadata."""
    feat_df = DATA_CACHE["features_df"]
    c_engine = DATA_CACHE["clustering_engine"]
    if feat_df is None or c_engine is None:
        raise HTTPException(status_code=503, detail="Pipeline data not initialized")

    filtered = feat_df
    if series:
        filtered = filtered[filtered["series_name"] == series]

    video_items = []
    for _, row in filtered.iterrows():
        vid = row["video_id"]
        c_id = c_engine.video_to_cluster.get(vid, -1)
        c_name = (
            c_engine.cluster_summaries.get(c_id, {}).get("cluster_name", "Unknown")
            if c_id >= 0
            else "Unknown"
        )
        video_items.append(
            {
                "video_id": vid,
                "series_name": row["series_name"],
                "episode_title": row["episode_title"],
                "total_views_30d": int(row["total_views_30d"]),
                "peak_day": int(row["peak_day"]),
                "peak_value": int(row["peak_value"]),
                "early_growth_3d": float(row["early_growth_3d"]),
                "cluster_id": c_id,
                "cluster_name": c_name,
            }
        )

    # Sort videos by episode title or ID
    video_items.sort(key=lambda x: x["video_id"])
    return {
        "total_count": len(video_items),
        "selected_series": series,
        "videos": video_items,
    }


@app.get("/api/video/{video_id}")
def get_video_details(video_id: str) -> Dict[str, Any]:
    """Returns full 31-day history, engineered features, cluster assignment, and 7-day forecast for a video."""
    daily_df = DATA_CACHE["daily_df"]
    feat_df = DATA_CACHE["features_df"]
    f_engine = DATA_CACHE["forecasting_engine"]
    c_engine = DATA_CACHE["clustering_engine"]

    if daily_df is None or feat_df is None:
        raise HTTPException(status_code=503, detail="Pipeline data not initialized")

    v_daily = daily_df[daily_df["video_id"] == video_id].sort_values("day_index")
    if v_daily.empty:
        raise HTTPException(status_code=404, detail=f"Video with id '{video_id}' not found")

    v_feat = feat_df[feat_df["video_id"] == video_id]
    features_dict = v_feat.iloc[0].to_dict() if not v_feat.empty else {}

    # Extract daily stats rows
    daily_stats = []
    for _, r in v_daily.iterrows():
        daily_stats.append(
            {
                "day_index": int(r["day_index"]),
                "date": str(r["date"]),
                "views": int(r["views"]),
                "likes": int(r["likes"]),
                "comments": int(r["comments"]),
                "search_interest": int(r["search_interest"]),
            }
        )

    # Forecasting prediction
    forecast_info = f_engine.predict_for_video(video_id) if f_engine else {}

    # Cluster assignment
    c_id = c_engine.video_to_cluster.get(video_id, -1) if c_engine else -1
    cluster_meta = (
        c_engine.cluster_summaries.get(c_id, {}) if c_id >= 0 else {}
    )

    return {
        "video_id": video_id,
        "series_name": v_daily.iloc[0]["series_name"],
        "episode_title": v_daily.iloc[0]["episode_title"],
        "daily_stats": daily_stats,
        "features": {
            "growth_rate": float(features_dict.get("growth_rate", 0.0)),
            "peak_day": int(features_dict.get("peak_day", 0)),
            "peak_value": int(features_dict.get("peak_value", 0)),
            "decay_slope": float(features_dict.get("decay_slope", 0.0)),
            "volatility": float(features_dict.get("volatility", 0.0)),
            "total_views_30d": int(features_dict.get("total_views_30d", 0)),
            "early_growth_3d": float(features_dict.get("early_growth_3d", 0.0)),
        },
        "forecast": forecast_info,
        "cluster": {
            "cluster_id": c_id,
            "cluster_name": cluster_meta.get("cluster_name", "Unassigned"),
            "cluster_description": cluster_meta.get("description", ""),
        },
    }


@app.get("/api/clusters")
def get_clusters() -> Dict[str, Any]:
    """Returns unsupervised clustering results, archetype descriptions, centroids, and representative curves."""
    c_engine = DATA_CACHE["clustering_engine"]
    if c_engine is None:
        raise HTTPException(status_code=503, detail="Clustering engine not initialized")

    return {
        "silhouette_score": round(c_engine.silhouette_score_, 3),
        "n_clusters": c_engine.n_clusters,
        "clusters": list(c_engine.cluster_summaries.values()),
    }


@app.get("/api/summary")
def get_summary() -> Dict[str, Any]:
    """Returns evaluation metrics, plain-English explanations, and live derived empirical insights."""
    summary = DATA_CACHE["summary"]
    if summary is None:
        raise HTTPException(status_code=503, detail="Summary not ready")
    return summary


# ---------------------------------------------------------
# Real-World Preset Catalog & Import Pipeline
# ---------------------------------------------------------

REAL_WORLD_PRESETS = {
    "real_mrbeast_viral": {
        "preset_id": "real_mrbeast_viral",
        "series_name": "Real YouTube Mega-Creators",
        "episode_title": "$1,000,000 Survival Island Challenge (Viral Explosion)",
        "archetype_hint": "Viral Spike",
        "description": "High-velocity Day 1 global detonation with steep 72-hour algorithmic drop-off.",
        "views": [
            850000, 3420000, 2180000, 1150000, 720000, 480000, 340000,
            260000, 210000, 175000, 145000, 125000, 110000, 98000, 89000,
            82000, 76000, 71000, 67000, 63000, 59000, 56000, 53000,
            50000, 48000, 45000, 43000, 41000, 39000, 38000, 36000
        ],
        "search_interest": [
            45, 100, 88, 62, 45, 34, 28,
            24, 21, 19, 17, 16, 15, 14, 13,
            12, 12, 11, 11, 10, 10, 9, 9,
            8, 8, 8, 7, 7, 7, 6, 6
        ]
    },
    "real_veritasium_sleeper": {
        "preset_id": "real_veritasium_sleeper",
        "series_name": "Real Science & Educational",
        "episode_title": "The Quantum Paradox Nobody Understood (Long-Tail Sleeper)",
        "archetype_hint": "Slow-Burn Sleeper",
        "description": "Modest release that triggers compounding recommendation discovery after Day 14.",
        "views": [
            35000, 38000, 42000, 46000, 52000, 58000, 67000,
            78000, 92000, 115000, 148000, 195000, 260000, 340000, 440000,
            560000, 710000, 890000, 1120000, 1340000, 1480000, 1420000, 1280000,
            1120000, 960000, 820000, 710000, 630000, 560000, 510000, 470000
        ],
        "search_interest": [
            12, 14, 15, 17, 19, 21, 24,
            27, 32, 38, 45, 54, 65, 76, 85,
            92, 98, 100, 96, 92, 86, 80, 74,
            68, 62, 57, 52, 48, 44, 40, 37
        ]
    },
    "real_apple_event_resurgent": {
        "preset_id": "real_apple_event_resurgent",
        "series_name": "Real Tech Product Keynotes",
        "episode_title": "Next-Gen Silicon Keynote (Launch + Clip Revival Wave)",
        "archetype_hint": "Resurgent Wave",
        "description": "Initial keynote release followed by a strong secondary revival surge 3 weeks later.",
        "views": [
            280000, 490000, 780000, 520000, 310000, 195000, 140000,
            105000, 85000, 72000, 65000, 59000, 55000, 52000, 58000,
            72000, 98000, 145000, 230000, 390000, 510000, 480000, 370000,
            260000, 190000, 145000, 115000, 95000, 82000, 74000, 68000
        ],
        "search_interest": [
            62, 85, 100, 78, 54, 40, 31,
            25, 21, 18, 16, 15, 14, 15, 18,
            24, 32, 45, 62, 82, 94, 88, 72,
            55, 42, 33, 27, 23, 20, 18, 16
        ]
    },
    "real_huberman_steady_decay": {
        "preset_id": "real_huberman_steady_decay",
        "series_name": "Real Longform Dialogue & Podcasts",
        "episode_title": "Optimizing Dopamine & Focus Circuits (Catalog Decay)",
        "archetype_hint": "Steady Decay",
        "description": "Heavy subscriber day-1 consumption followed by classic power-law retention decline.",
        "views": [
            420000, 460000, 390000, 310000, 250000, 205000, 172000,
            148000, 130000, 116000, 104000, 94000, 86000, 79000, 73000,
            68000, 63000, 59000, 55000, 52000, 49000, 46000, 43000,
            41000, 39000, 37000, 35000, 33000, 32000, 30000, 29000
        ],
        "search_interest": [
            82, 95, 88, 76, 68, 60, 54,
            49, 45, 41, 38, 35, 32, 30, 28,
            26, 25, 23, 22, 21, 20, 19, 18,
            17, 16, 15, 15, 14, 13, 13, 12
        ]
    }
}


def _update_and_recompute_pipeline(new_rows: List[Dict[str, Any]]) -> str:
    """Appends new daily observations to dataset and triggers pipeline re-scoring."""
    daily_df = DATA_CACHE["daily_df"]
    new_df = pd.DataFrame(new_rows)
    
    # Avoid duplicate video_ids by removing any existing matches
    v_id = new_rows[0]["video_id"]
    if v_id in daily_df["video_id"].values:
        daily_df = daily_df[daily_df["video_id"] != v_id]

    updated_daily_df = pd.concat([daily_df, new_df], ignore_index=True)
    
    # Recompute features
    updated_features_df = compute_features_from_dataframe(updated_daily_df)
    
    # Re-evaluate models
    forecasting_engine = ForecastingEngine(random_state=42)
    forecasting_engine.train_and_evaluate(updated_daily_df)
    
    clustering_engine = TrajectoryClusteringEngine(n_clusters=4, random_state=42)
    clustering_engine.fit_and_summarize(updated_daily_df, updated_features_df)
    
    summary = generate_evaluation_summary(
        updated_daily_df, updated_features_df, forecasting_engine, clustering_engine
    )
    
    # Persist changes
    save_dataset(updated_daily_df, "data")
    save_features(updated_features_df, "data")
    
    # Update cache
    DATA_CACHE["daily_df"] = updated_daily_df
    DATA_CACHE["features_df"] = updated_features_df
    DATA_CACHE["forecasting_engine"] = forecasting_engine
    DATA_CACHE["clustering_engine"] = clustering_engine
    DATA_CACHE["summary"] = summary
    
    return v_id


@app.get("/api/import/presets")
def get_import_presets() -> Dict[str, Any]:
    """Returns curated real-world trajectory datasets available for instant one-click import."""
    return {"presets": list(REAL_WORLD_PRESETS.values())}


@app.post("/api/import/preset")
def import_preset_endpoint(body: Dict[str, str]) -> Dict[str, Any]:
    """Imports a real-world video trajectory preset into the active corpus."""
    preset_id = body.get("preset_id")
    if not preset_id or preset_id not in REAL_WORLD_PRESETS:
        raise HTTPException(status_code=400, detail=f"Invalid preset_id. Available: {list(REAL_WORLD_PRESETS.keys())}")
        
    preset = REAL_WORLD_PRESETS[preset_id]
    v_id = f"real_{preset_id.replace('real_', '')[:12]}_{abs(hash(preset['episode_title'])) % 1000}"
    
    dates = pd.date_range("2026-01-01", periods=31, freq="D").strftime("%Y-%m-%d").tolist()
    new_rows = []
    for day in range(31):
        v = int(preset["views"][day])
        s = int(preset["search_interest"][day])
        new_rows.append({
            "video_id": v_id,
            "series_name": preset["series_name"],
            "episode_title": preset["episode_title"],
            "day_index": day,
            "date": dates[day],
            "views": v,
            "likes": int(v * 0.045),
            "comments": int(v * 0.0035),
            "search_interest": s,
            "latent_archetype": preset["archetype_hint"].lower().replace(" ", "_"),
        })
        
    created_id = _update_and_recompute_pipeline(new_rows)
    return {
        "status": "success",
        "video_id": created_id,
        "message": f"Successfully imported '{preset['episode_title']}' and recomputed ML models!",
        "series_name": preset["series_name"],
    }


@app.post("/api/import/custom")
def import_custom_video(body: Dict[str, Any]) -> Dict[str, Any]:
    """Imports custom user-specified daily trajectory points (or extrapolated from early days)."""
    title = body.get("episode_title", "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="episode_title is required")
        
    series = body.get("series_name", "User Imported Videos").strip() or "User Imported Videos"
    views = body.get("daily_views", [])
    if not isinstance(views, list) or len(views) < 7:
        raise HTTPException(status_code=400, detail="daily_views must be a list of at least 7 numbers (up to 31)")
        
    # Extrapolate to 31 days if fewer days provided
    views_31 = [float(v) for v in views]
    if len(views_31) < 31:
        last_val = views_31[-1]
        for d in range(len(views_31), 31):
            decayed = max(100.0, last_val * (0.94 ** (d - len(views) + 1)))
            views_31.append(decayed)
    else:
        views_31 = views_31[:31]
        
    search_interest = body.get("search_interest", [])
    if not isinstance(search_interest, list) or len(search_interest) < 31:
        # Generate proportional search interest (0-100)
        max_v = max(views_31) if max(views_31) > 0 else 1.0
        search_31 = [min(100, max(5, int((v / max_v) * 90) + 5)) for v in views_31]
    else:
        search_31 = [min(100, max(0, int(s))) for s in search_interest[:31]]
        
    v_id = f"custom_{abs(hash(title)) % 90000 + 10000}"
    dates = pd.date_range("2026-01-01", periods=31, freq="D").strftime("%Y-%m-%d").tolist()
    
    new_rows = []
    for day in range(31):
        v = int(views_31[day])
        s = int(search_31[day])
        new_rows.append({
            "video_id": v_id,
            "series_name": series,
            "episode_title": title,
            "day_index": day,
            "date": dates[day],
            "views": v,
            "likes": int(v * 0.04),
            "comments": int(v * 0.003),
            "search_interest": s,
            "latent_archetype": "imported",
        })
        
    created_id = _update_and_recompute_pipeline(new_rows)
    return {
        "status": "success",
        "video_id": created_id,
        "message": f"Successfully imported '{title}' into series '{series}'!",
        "series_name": series,
    }


@app.post("/api/import/reset")
def reset_dataset_endpoint() -> Dict[str, Any]:
    """Resets dataset back to the initial 48-item synthetic benchmark corpus."""
    daily_df, _ = generate_dataset(n_items=48, days=31)
    save_dataset(daily_df, "data")
    features_df = compute_features_from_dataframe(daily_df)
    save_features(features_df, "data")
    
    forecasting_engine = ForecastingEngine(random_state=42)
    forecasting_engine.train_and_evaluate(daily_df)
    
    clustering_engine = TrajectoryClusteringEngine(n_clusters=4, random_state=42)
    clustering_engine.fit_and_summarize(daily_df, features_df)
    
    summary = generate_evaluation_summary(
        daily_df, features_df, forecasting_engine, clustering_engine
    )
    
    DATA_CACHE["daily_df"] = daily_df
    DATA_CACHE["features_df"] = features_df
    DATA_CACHE["forecasting_engine"] = forecasting_engine
    DATA_CACHE["clustering_engine"] = clustering_engine
    DATA_CACHE["summary"] = summary
    
    return {
        "status": "success",
        "message": "Dataset reset to default 48-item benchmark corpus.",
        "videos_loaded": 48
    }


# Optional: Mount static directory if frontend is co-located
if os.path.exists("frontend"):
    app.mount("/static", StaticFiles(directory="frontend"), name="static")


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8888))
    print(f"Starting Popularity Dynamics API on port {port}...")
    uvicorn.run("backend.app:app", host="0.0.0.0", port=port, reload=False)
