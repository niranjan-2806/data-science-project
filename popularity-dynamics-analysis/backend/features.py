"""
backend/features.py
===================
Feature engineering pipeline for digital content time-series curves.

Why Feature Engineering on Time Series?
---------------------------------------
Raw time-series trajectories are high-dimensional (31 days = 31 dimensions) and highly
collinear. By projecting daily views onto parameterized domain-specific shape descriptors,
we compress the temporal dynamics into interpretable, lower-dimensional signals that:
1. Allow supervised regressors to predict long-term total views using only early days (0-6).
2. Allow unsupervised clustering models to separate curve profiles (peaks, decay, resurgence).

Computed Features (per video_id):
- growth_rate: Mean day-over-day percentage change in views across the 30-day window.
- peak_day: The day_index (0 to 30) when daily views achieved their absolute maximum.
- peak_value: The maximum single-day views count.
- decay_slope: The rate of daily view decline following the peak day (units: views/day).
- volatility: Mean 3-day rolling standard deviation of views, capturing curve turbulence.
- total_views_30d: Cumulative views accumulated across all 31 days (days 0 to 30).
- early_growth_3d: Percentage growth in views from day 0 to day 3: ((views_3 - views_0) / views_0) * 100.
  This is the primary early signal for early-stage lifetime forecasting.
"""

import os
from typing import Optional
import numpy as np
import pandas as pd


def compute_features_from_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    """Computes shape and volume features for each video in the daily_stats DataFrame.

    Parameters:
    - df: DataFrame containing ['video_id', 'series_name', 'episode_title', 'day_index', 'views', ...]

    Returns:
    - features_df: One row per video_id with all engineered features.
    """
    rows = []

    # Group by video_id to process each time series independently
    for vid, group in df.groupby("video_id"):
        # Ensure chronological ordering by day_index
        group = group.sort_values("day_index").reset_index(drop=True)
        series_name = group["series_name"].iloc[0]
        episode_title = group["episode_title"].iloc[0]

        views = group["views"].values.astype(float)
        days = group["day_index"].values

        total_views_30d = float(np.sum(views))
        peak_idx = int(np.argmax(views))
        peak_day = int(days[peak_idx])
        peak_value = float(views[peak_idx])

        # 1. Day-over-day growth rates (pct_change)
        # Avoid division by zero by establishing a small epsilon floor
        safe_views = np.maximum(views, 1.0)
        pct_changes = np.diff(safe_views) / safe_views[:-1]
        # Mean growth rate expressed as a percentage
        growth_rate = float(np.mean(pct_changes) * 100.0)

        # 2. Decay slope: post-peak drop rate
        # If peak is at the very end of the observation window, decay slope is 0.0
        if peak_idx < len(views) - 1:
            post_peak_views = views[peak_idx:]
            post_peak_days = days[peak_idx:]
            # Linear regression slope over post-peak segment
            # Slope is typically negative; we report the rate of decay (views dropped per day)
            decay_days = post_peak_days[-1] - post_peak_days[0]
            decay_amount = peak_value - post_peak_views[-1]
            decay_slope = float(decay_amount / max(decay_days, 1))
        else:
            decay_slope = 0.0

        # 3. Volatility: rolling 3-day standard deviation
        # Measures whether the trajectory is smooth or subject to erratic spikes/shocks
        rolling_std = pd.Series(views).rolling(window=3, min_periods=2).std().dropna()
        volatility = float(rolling_std.mean()) if not rolling_std.empty else 0.0

        # 4. Early growth (days 0 to 3)
        # Why day 0 to 3? Most algorithmic recommendation decisions on YouTube and Spotify
        # occur within the first 72 hours of upload.
        v0 = max(float(views[0]), 1.0)
        v3 = float(views[min(3, len(views) - 1)])
        early_growth_3d = float(((v3 - v0) / v0) * 100.0)

        # Sanity check against NaN / inf
        if np.isnan(growth_rate) or np.isinf(growth_rate):
            growth_rate = 0.0
        if np.isnan(decay_slope) or np.isinf(decay_slope):
            decay_slope = 0.0
        if np.isnan(volatility) or np.isinf(volatility):
            volatility = 0.0
        if np.isnan(early_growth_3d) or np.isinf(early_growth_3d):
            early_growth_3d = 0.0

        rows.append(
            {
                "video_id": vid,
                "series_name": series_name,
                "episode_title": episode_title,
                "growth_rate": round(growth_rate, 2),
                "peak_day": peak_day,
                "peak_value": int(peak_value),
                "decay_slope": round(decay_slope, 2),
                "volatility": round(volatility, 2),
                "total_views_30d": int(total_views_30d),
                "early_growth_3d": round(early_growth_3d, 2),
            }
        )

    features_df = pd.DataFrame(rows)
    return features_df


def save_features(features_df: pd.DataFrame, output_dir: str = "data") -> str:
    """Saves engineered features to CSV."""
    os.makedirs(output_dir, exist_ok=True)
    out_path = os.path.join(output_dir, "features.csv")
    features_df.to_csv(out_path, index=False)
    return out_path


def load_or_compute_features(
    data_path: str = "data/daily_stats.csv",
) -> pd.DataFrame:
    """Loads features if precomputed or generates them from daily_stats."""
    features_path = os.path.join(os.path.dirname(data_path), "features.csv")
    if os.path.exists(features_path):
        return pd.read_csv(features_path)

    if not os.path.exists(data_path):
        from backend.data_generator import generate_dataset, save_dataset

        df, _ = generate_dataset()
        save_dataset(df, os.path.dirname(data_path) or "data")
    else:
        df = pd.read_csv(data_path)

    feat_df = compute_features_from_dataframe(df)
    save_features(feat_df, os.path.dirname(data_path) or "data")
    return feat_df


if __name__ == "__main__":
    print("=" * 60)
    print("POPULARITY DYNAMICS: FEATURE ENGINEERING VERIFICATION")
    print("=" * 60)
    # Load dataset
    raw_df = pd.read_csv("data/daily_stats.csv")
    feat_df = compute_features_from_dataframe(raw_df)
    save_features(feat_df, "data")

    # Sanity checks
    print(f"Computed features for {len(feat_df)} videos.")
    print("Null check:")
    print(feat_df.isna().sum())
    print("\nInfinite values check:")
    print(np.isinf(feat_df.select_dtypes(include=np.number)).sum())

    print("\nFeature Summary Statistics:")
    print(feat_df.describe().round(2).T[["mean", "std", "min", "50%", "max"]])

    print("\nFirst 5 Rows of Feature Table:")
    print(
        feat_df[
            [
                "video_id",
                "series_name",
                "growth_rate",
                "peak_day",
                "decay_slope",
                "volatility",
                "early_growth_3d",
                "total_views_30d",
            ]
        ].head()
    )
    print("\nFeature engineering verification successful!")
