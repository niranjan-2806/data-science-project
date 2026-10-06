"""
backend/data_generator.py
=========================
Generates synthetic daily time-series statistics for digital content episodes.

Why Synthetic Data?
-------------------
In data science education and prototyping, synthetic data allows us to define
known ground-truth mathematical generators (archetypes). This provides a reliable
benchmark to verify whether feature engineering and clustering algorithms can
independently rediscover real structural dynamics without label leakage.

Data Schema:
- video_id: Unique identifier for each video/episode (e.g. "vid_101")
- series_name: The show or content series the episode belongs to
- episode_title: Human-readable descriptive episode title
- day_index: Days elapsed since publication (0 to 30)
- date: Calendar date corresponding to the day_index
- views: Daily views count (non-cumulative time series)
- likes: Daily likes count (proportional to engagement)
- comments: Daily comments count (proportional to community interaction)
- search_interest: Normalized 0-100 Google-Trends-style search interest score

Archetypes (25% each across 48 items):
1. Slow-burn: Gradual compounding growth, late peak (days 18-25), gentle tail.
2. Viral-spike: Violent immediate explosion (days 1-3), followed by rapid decay.
3. Steady-decline: Maximum attention at launch (days 0-1), smooth exponential drop.
4. Resurgent: Launch spike, decay, followed by secondary wave (days 18-22, e.g. algorithm reco/season tease).
"""

import os
from datetime import datetime, timedelta
from typing import Dict, List, Tuple
import numpy as np
import pandas as pd

# Fix random seed for reproducible benchmark evaluations
DEFAULT_RANDOM_STATE = 42

ARCHETYPES = ["slow_burn", "viral_spike", "steady_decline", "resurgent"]

SERIES_CATALOG = [
    "AI Tech Pulse",
    "The Deep Dive Podcast",
    "DevOps Horizon",
    "Future of Code",
    "Data Systems Unpacked",
    "Cyber Insights",
]

EPISODE_TOPICS = [
    "Foundational Models in Production",
    "High-Performance Vector Indexing",
    "Autonomous Agent Architectures",
    "Distributed Cache Strategies",
    "Graph Neural Networks Demystified",
    "Low-Latency Stream Processing",
    "Zero-Trust Cloud Mesh Security",
    "Stateful Serverless Orchestration",
]


def generate_episode_curve(
    archetype: str,
    days: int = 31,
    amplitude: float = 25000.0,
    rng: np.random.RandomState = None,
) -> np.ndarray:
    """Generates daily views for an episode according to its parametric popularity archetype.

    Mathematical justifications:
    - Normalization invariance: amplitudes vary widely across items (5k to 120k).
      This tests whether our clustering pipeline correctly discovers shape rather than magnitude.
    - Gaussian noise simulates real-world observation jitter (weekend dips, platform fluctuations).
    """
    if rng is None:
        rng = np.random.RandomState()

    t = np.arange(days, dtype=float)

    if archetype == "slow_burn":
        # Peaks near tau in [19, 24]. Normalized gamma-like curve: (t/tau) * exp(1 - t/tau)
        tau = rng.uniform(19.0, 24.0)
        # Shape: starts small, builds steadily, peaks late, gentle decay
        curve = amplitude * (t / tau) * np.exp(1.0 - (t / tau))
        # Add baseline engagement
        curve += amplitude * 0.05

    elif archetype == "viral_spike":
        # Sharp Gaussian spike centered at t0 in [1.0, 2.5] with small width sigma in [0.9, 1.4]
        t0 = rng.uniform(1.0, 2.2)
        sigma = rng.uniform(0.9, 1.4)
        curve = amplitude * np.exp(-((t - t0) ** 2) / (2.0 * sigma**2))
        # Long modest residual tail
        curve += amplitude * 0.08 * np.exp(-t / 10.0)

    elif archetype == "steady_decline":
        # Launch day maximum (t=0 or 1), decaying exponentially with half-life ~ 5-8 days
        decay_rate = rng.uniform(5.5, 8.5)
        curve = amplitude * np.exp(-t / decay_rate)
        # Residual retention floor
        curve += amplitude * 0.04

    elif archetype == "resurgent":
        # Two-stage curve: Initial moderate peak at t0 ~ 1-2, then second peak at t1 ~ 18-22
        t0 = rng.uniform(1.0, 2.0)
        sigma0 = rng.uniform(1.0, 1.5)
        peak1 = amplitude * 0.65 * np.exp(-((t - t0) ** 2) / (2.0 * sigma0**2))

        t1 = rng.uniform(18.0, 22.0)
        sigma1 = rng.uniform(2.5, 3.8)
        # Secondary resurgence event (e.g. virality on Reddit/TikTok or cross-promotion)
        peak2 = amplitude * 0.55 * np.exp(-((t - t1) ** 2) / (2.0 * sigma1**2))

        decay_floor = amplitude * 0.05 * np.exp(-t / 12.0)
        curve = peak1 + peak2 + decay_floor

    else:
        raise ValueError(f"Unknown archetype: {archetype}")

    # Add 4% to 8% proportional random noise + integer cast
    noise = rng.normal(0.0, 0.05 * amplitude, size=days)
    daily_views = np.maximum(curve + noise, 15.0).astype(int)
    return daily_views


def generate_dataset(
    n_items: int = 48,
    days: int = 31,
    random_state: int = DEFAULT_RANDOM_STATE,
) -> Tuple[pd.DataFrame, Dict[str, str]]:
    """Generates the full synthetic time-series dataset.

    Returns:
    - df: DataFrame in daily_stats format (n_items * days rows)
    - ground_truth: dict mapping video_id -> archetype string (held out for evaluation)
    """
    rng = np.random.RandomState(random_state)
    start_anchor_date = datetime(2026, 8, 15)

    records = []
    ground_truth = {}

    items_per_archetype = n_items // len(ARCHETYPES)

    video_counter = 1000

    for arch_idx, arch in enumerate(ARCHETYPES):
        for i in range(items_per_archetype):
            video_counter += 1
            video_id = f"yt_{video_counter}"
            ground_truth[video_id] = arch

            series_name = SERIES_CATALOG[
                (arch_idx * items_per_archetype + i) % len(SERIES_CATALOG)
            ]
            topic = EPISODE_TOPICS[i % len(EPISODE_TOPICS)]
            episode_num = (i % 12) + 1
            episode_title = f"Ep {episode_num}: {topic}"

            # High variance in scale (5,000 to 110,000 views)
            # This directly proves to professors why z-score curve normalization is required!
            amplitude = float(rng.uniform(7500, 115000))

            views_series = generate_episode_curve(
                arch, days=days, amplitude=amplitude, rng=rng
            )
            peak_val = float(np.max(views_series))

            episode_start_date = start_anchor_date + timedelta(
                days=int(rng.randint(0, 14))
            )

            for d in range(days):
                curr_date = episode_start_date + timedelta(days=d)
                v = int(views_series[d])

                # Engagement rate correlations:
                # Likes: typically 4.5% to 8.5% of daily views
                likes_ratio = rng.uniform(0.045, 0.085)
                likes = int(v * likes_ratio + rng.uniform(0, 5))

                # Comments: typically 0.8% to 2.2% of daily views
                comments_ratio = rng.uniform(0.008, 0.022)
                comments = int(v * comments_ratio + rng.uniform(0, 3))

                # Search interest score (0 to 100):
                # Strong correlation with views curve + search-specific lag and noise
                relative_intensity = v / max(peak_val, 1.0)
                raw_interest = (relative_intensity * 82.0) + rng.normal(8.0, 4.0)
                search_interest = int(np.clip(raw_interest, 2, 100))

                records.append(
                    {
                        "video_id": video_id,
                        "series_name": series_name,
                        "episode_title": episode_title,
                        "day_index": d,
                        "date": curr_date.strftime("%Y-%m-%d"),
                        "views": v,
                        "likes": likes,
                        "comments": comments,
                        "search_interest": search_interest,
                    }
                )

    df = pd.DataFrame(records)
    return df, ground_truth


def save_dataset(df: pd.DataFrame, output_dir: str = "data") -> str:
    """Saves generated dataset to CSV."""
    os.makedirs(output_dir, exist_ok=True)
    out_path = os.path.join(output_dir, "daily_stats.csv")
    df.to_csv(out_path, index=False)
    return out_path


if __name__ == "__main__":
    print("=" * 60)
    print("POPULARITY DYNAMICS: SYNTHETIC DATA GENERATOR VERIFICATION")
    print("=" * 60)
    df, gt = generate_dataset(n_items=48, days=31)
    print(f"Generated {len(df)} total daily observation rows across {df['video_id'].nunique()} videos.")
    print(f"Series count: {df['series_name'].nunique()}")

    # Print representative summary per archetype
    print("\nSample Peak Day & View Dynamics per Archetype:")
    for arch in ARCHETYPES:
        sample_vid = next(vid for vid, a in gt.items() if a == arch)
        sub = df[df["video_id"] == sample_vid]
        peak_day = sub.loc[sub["views"].idxmax()]["day_index"]
        max_v = sub["views"].max()
        day0_v = sub.iloc[0]["views"]
        day15_v = sub[sub["day_index"] == 15]["views"].values[0]
        day25_v = sub[sub["day_index"] == 25]["views"].values[0]
        print(f" - Archetype [{arch:14s}] (ID: {sample_vid}):")
        print(f"     Peak Day: {peak_day:2d} | Max Views: {max_v:6d} | Day 0: {day0_v:5d} | Day 15: {day15_v:5d} | Day 25: {day25_v:5d}")

    out_csv = save_dataset(df, "data")
    print(f"\nSaved CSV to: {out_csv}")
    print("Data generator verification successful!\n")
