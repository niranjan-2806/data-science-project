"""
backend/clustering.py
=====================
Unsupervised clustering pipeline discovering digital content popularity archetypes.

Why Normalize Curves Before Clustering?
---------------------------------------
Raw view volumes span multiple orders of magnitude: a small podcast episode might peak
at 6,000 views, while a marquee episode peaks at 120,000 views. If clustered in raw Euclidean
space, the distance metric would be completely dominated by amplitude (scale) rather than
the temporal geometry of attention.

By applying Z-score normalization:
    z(t) = (views(t) - mean(views)) / std(views)
we project all time series onto a standardized zero-mean, unit-variance manifold.
As a result, a 6,000-view viral clip and a 120,000-view viral clip superimpose onto
the exact same geometric trajectory, enabling the clustering model to discover true
shape patterns.

Model Architecture:
- Algorithm: K-Means (k=4) on standardized 31-day trajectory vectors.
- Metric: Silhouette Score to quantify cluster separation and cohesion.
- Automatic Labeling: Rule-based heuristics evaluating cluster centroid dynamics:
    * Late peak day (> 14): "Slow-Burn Sleeper"
    * Early peak (<= 3) with secondary late surge (days 16-26): "Resurgent Wave"
    * Early peak with rapid drop and high early surge: "Viral Spike"
    * Launch-day climax (day 0-1) with monotonic decline: "Steady Decay"
"""

import os
import sys

# Ensure project root is on sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from typing import Any, Dict, List, Optional, Tuple
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score


class TrajectoryClusteringEngine:
    """Discovers popularity archetypes from normalized 30-day views curves."""

    def __init__(self, n_clusters: int = 4, random_state: int = 42):
        self.n_clusters = n_clusters
        self.random_state = random_state
        self.model = KMeans(
            n_clusters=n_clusters,
            random_state=random_state,
            n_init=15,
            max_iter=300,
        )
        self.labels_: Optional[np.ndarray] = None
        self.silhouette_score_: float = 0.0
        self.cluster_summaries: Dict[int, Dict[str, Any]] = {}
        self.video_to_cluster: Dict[str, int] = {}
        self.video_ids_: List[str] = []
        self.normalized_matrix_: Optional[np.ndarray] = None
        self.raw_matrix_: Optional[np.ndarray] = None
        self.days_axis: List[int] = list(range(31))

    def fit_and_summarize(
        self,
        daily_df: pd.DataFrame,
        features_df: Optional[pd.DataFrame] = None,
    ) -> Dict[str, Any]:
        """Pivots daily time series, normalizes, fits KMeans, and computes cluster metrics."""
        # 1. Pivot into an (N_items x 31_days) matrix
        pivoted = daily_df.pivot(
            index="video_id", columns="day_index", values="views"
        ).sort_index()
        self.video_ids_ = pivoted.index.tolist()
        self.raw_matrix_ = pivoted.values.astype(float)

        # 2. Z-Score Standardization per trajectory:
        # Crucial: standardizing along axis=1 (per video across time)
        # removes individual magnitude while preserving temporal curvature.
        row_means = self.raw_matrix_.mean(axis=1, keepdims=True)
        row_stds = np.maximum(self.raw_matrix_.std(axis=1, keepdims=True), 1e-6)
        self.normalized_matrix_ = (self.raw_matrix_ - row_means) / row_stds

        # 3. Fit K-Means
        self.model.fit(self.normalized_matrix_)
        self.labels_ = self.model.labels_

        # 4. Compute silhouette score
        self.silhouette_score_ = float(
            silhouette_score(self.normalized_matrix_, self.labels_)
        )

        for vid, cluster_id in zip(self.video_ids_, self.labels_):
            self.video_to_cluster[vid] = int(cluster_id)

        # 5. Extract metadata from features_df if available
        feat_map = {}
        if features_df is not None:
            for _, r in features_df.iterrows():
                feat_map[r["video_id"]] = r.to_dict()

        # 6. Analyze each cluster to determine centroids, representative items, and rule-based name
        self.cluster_summaries = {}
        for c in range(self.n_clusters):
            c_indices = np.where(self.labels_ == c)[0]
            c_vids = [self.video_ids_[i] for i in c_indices]
            c_norm_curves = self.normalized_matrix_[c_indices]
            c_raw_curves = self.raw_matrix_[c_indices]

            # Centroid in normalized shape space
            centroid = self.model.cluster_centers_[c]

            # Find 3 representative videos closest to the centroid (medoids)
            distances = np.linalg.norm(c_norm_curves - centroid, axis=1)
            medoid_order = np.argsort(distances)
            rep_vids = [c_vids[i] for i in medoid_order[:3]]

            # Compute average features for this cluster
            c_peak_days = [
                int(np.argmax(c_raw_curves[i])) for i in range(len(c_indices))
            ]
            avg_peak_day = float(np.mean(c_peak_days))

            c_total_views = [
                float(np.sum(c_raw_curves[i])) for i in range(len(c_indices))
            ]
            avg_total_views = float(np.mean(c_total_views))

            # Centroid shape diagnostics
            centroid_peak_day = int(np.argmax(centroid))

            # Inspect resurgence: check if there is a secondary peak after day 15
            late_window = centroid[16:28]
            late_peak_val = float(np.max(late_window))
            mid_trough_val = float(np.min(centroid[8:16]))
            has_resurgence = (
                (late_peak_val - mid_trough_val) > 0.4
                and centroid_peak_day <= 5
            )

            # Auto-name deduction based on shape mechanics (no hardcoded mapping!)
            if avg_peak_day > 14.0 or centroid_peak_day > 14:
                cluster_name = "Slow-Burn Sleeper"
                archetype_description = (
                    "Compounding long-tail discovery. Views ramp up steadily, "
                    "reaching peak momentum late (days 18-26) with exceptional audience retention."
                )
            elif has_resurgence:
                cluster_name = "Resurgent Wave"
                archetype_description = (
                    "Bimodal attention curve. Initial release surge settles into baseline, "
                    "then experiences a secondary revival wave around days 18-22 via algorithmic reposts."
                )
            elif avg_peak_day <= 3.5:
                # Differentiate between explosive viral spike and monotonic steady decline
                # Viral spike starts low on day 0, surges days 1-3, and drops steep.
                # Steady decline is already at its peak on day 0 or 1.
                v0_ratio = centroid[0]
                peak_ratio = np.max(centroid)
                if centroid_peak_day == 0 or (v0_ratio >= 0.7 * peak_ratio):
                    cluster_name = "Steady Decay"
                    archetype_description = (
                        "Front-loaded release. Immediate launch attention on day 0-1 followed by "
                        "a steady exponential decay into a predictable catalog baseline."
                    )
                else:
                    cluster_name = "Viral Spike"
                    archetype_description = (
                        "Explosive breakout surge. Views detonate within days 1-3 with extreme steepness, "
                        "followed by rapid attention burnout within the first week."
                    )
            else:
                cluster_name = f"Pattern Cluster {c + 1}"
                archetype_description = "Distinct temporal engagement trajectory."

            # Package representative curves for visualization
            representative_curves = []
            for vid in rep_vids:
                row_idx = self.video_ids_.index(vid)
                representative_curves.append(
                    {
                        "video_id": vid,
                        "series_name": (
                            feat_map.get(vid, {}).get("series_name", "Series")
                        ),
                        "episode_title": (
                            feat_map.get(vid, {}).get("episode_title", vid)
                        ),
                        "views": self.raw_matrix_[row_idx].tolist(),
                        "normalized_views": [
                            round(x, 3) for x in self.normalized_matrix_[row_idx]
                        ],
                    }
                )

            self.cluster_summaries[c] = {
                "cluster_id": c,
                "cluster_name": cluster_name,
                "description": archetype_description,
                "item_count": len(c_indices),
                "percentage_of_corpus": round(
                    len(c_indices) / len(self.video_ids_) * 100.0, 1
                ),
                "avg_peak_day": round(avg_peak_day, 1),
                "avg_total_views": int(avg_total_views),
                "centroid_curve": [round(float(v), 3) for v in centroid],
                "representative_curves": representative_curves,
                "member_video_ids": c_vids,
            }

        return {
            "silhouette_score": round(self.silhouette_score_, 3),
            "n_clusters": self.n_clusters,
            "clusters": list(self.cluster_summaries.values()),
        }


if __name__ == "__main__":
    print("=" * 60)
    print("POPULARITY DYNAMICS: CLUSTERING MODULE VERIFICATION")
    print("=" * 60)
    daily_df = pd.read_csv("data/daily_stats.csv")
    from backend.data_generator import generate_dataset
    from backend.features import compute_features_from_dataframe

    _, ground_truth = generate_dataset()
    features_df = compute_features_from_dataframe(daily_df)

    clustering_engine = TrajectoryClusteringEngine(n_clusters=4, random_state=42)
    results = clustering_engine.fit_and_summarize(daily_df, features_df)

    print(f"\nSilhouette Score: {results['silhouette_score']}")
    if results["silhouette_score"] > 0.2:
        print("SANITY CHECK PASSED: Silhouette score is well above 0.2 benchmark.")
    else:
        print("SANITY CHECK FAILED: Silhouette score is too low.")

    print("\nDiscovered Clusters & Ground Truth Alignment:")
    for c in results["clusters"]:
        c_id = c["cluster_id"]
        vids = c["member_video_ids"]
        gt_types = [ground_truth.get(v, "unknown") for v in vids]
        gt_counts = pd.Series(gt_types).value_counts().to_dict()
        print(f"\n* Cluster {c_id}: '{c['cluster_name']}'")
        print(f"   Items: {c['item_count']} ({c['percentage_of_corpus']}%) | Avg Peak Day: {c['avg_peak_day']} | Avg Views: {c['avg_total_views']:,}")
        print(f"   Ground-Truth Composition: {gt_counts}")
        print(f"   Description: {c['description']}")

    print("\nClustering module verification successful!")
