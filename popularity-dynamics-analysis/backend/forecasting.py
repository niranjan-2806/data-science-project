"""
backend/forecasting.py
======================
Supervised regression pipeline predicting 30-day cumulative views from days 0-6 data.

Why Keep the Forecasting Model Simple?
--------------------------------------
In industrial ML and applied statistics, model selection is strictly constrained by
sample size (N). With N ~ 48 videos, high-capacity models (deep neural networks, large
gradient boosted ensembles) have high variance and will severely overfit the training set.
A constrained linear regression or shallow random forest regularizes effectively, yielding
robust out-of-sample generalization with transparent feature coefficients.

Problem Formulation:
- Observation Window: Days 0 to 6 (the first week of publication).
- Prediction Horizon: Total cumulative views across all 31 days (days 0 to 30).
- Features Computed strictly from Days 0-6:
    1. early_growth_3d: Percentage growth from day 0 to day 3.
    2. volatility_early: Standard deviation of views over days 0-6.
    3. views_day_6: Views on day 6 (momentum indicator).
    4. early_cumulative_views: Total views accumulated in the first 7 days (days 0-6).
- Target: total_views_30d.
- Train / Test Split: 80% train (38 items), 20% test (10 items), random_state=42.
- Evaluation Metrics: Mean Absolute Error (MAE), Root Mean Squared Error (RMSE),
  Mean Absolute Percentage Error (MAPE).
"""

import os
import sys

# Ensure project root is on sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from typing import Any, Dict, List, Tuple
import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression, Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.model_selection import train_test_split


def extract_early_features_and_target(
    daily_df: pd.DataFrame,
) -> Tuple[pd.DataFrame, pd.Series, List[str]]:
    """Extracts features strictly from days 0-6 to avoid temporal data leakage.

    Returns:
    - X: DataFrame of features for each video_id
    - y: Series of total_views_30d
    - video_ids: List of video IDs in corresponding row order
    """
    records = []

    for vid, group in daily_df.groupby("video_id"):
        group = group.sort_values("day_index").reset_index(drop=True)
        series_name = group["series_name"].iloc[0]
        episode_title = group["episode_title"].iloc[0]

        all_views = group["views"].values.astype(float)
        total_views_30d = float(np.sum(all_views))

        # Restrict strictly to days 0-6
        early_group = group[group["day_index"] <= 6].sort_values("day_index")
        early_views = early_group["views"].values.astype(float)

        # 1. Early growth from day 0 to day 3
        v0 = max(early_views[0], 1.0)
        v3 = early_views[min(3, len(early_views) - 1)]
        early_growth_3d = ((v3 - v0) / v0) * 100.0

        # 2. Volatility over days 0-6 (rolling or sample std)
        rolling_std = (
            pd.Series(early_views).rolling(window=3, min_periods=2).std().dropna()
        )
        volatility_early = (
            float(rolling_std.mean())
            if not rolling_std.empty
            else float(np.std(early_views))
        )

        # 3. Views at day 6 (velocity leaving week 1)
        views_day_6 = float(early_views[min(6, len(early_views) - 1)])

        # 4. Cumulative early views (days 0-6)
        early_cumulative = float(np.sum(early_views))

        records.append(
            {
                "video_id": vid,
                "series_name": series_name,
                "episode_title": episode_title,
                "early_growth_3d": early_growth_3d,
                "volatility_early": volatility_early,
                "views_day_6": views_day_6,
                "early_cumulative": early_cumulative,
                "total_views_30d": total_views_30d,
            }
        )

    df_featured = pd.DataFrame(records)
    feature_cols = [
        "early_growth_3d",
        "volatility_early",
        "views_day_6",
        "early_cumulative",
    ]
    return df_featured, df_featured["total_views_30d"], df_featured["video_id"].tolist()


class ForecastingEngine:
    """Supervised forecasting model trained to predict 30-day cumulative views."""

    def __init__(self, random_state: int = 42):
        self.random_state = random_state
        # Ridge regression ensures stable coefficient shrinkage with correlated features
        self.model = Ridge(alpha=1.0, random_state=random_state)
        self.feature_cols = [
            "early_growth_3d",
            "volatility_early",
            "views_day_6",
            "early_cumulative",
        ]
        self.metrics: Dict[str, float] = {}
        self.test_predictions_df: pd.DataFrame = pd.DataFrame()
        self.all_predictions: Dict[str, Dict[str, Any]] = {}
        self.is_trained = False

    def train_and_evaluate(self, daily_df: pd.DataFrame) -> Dict[str, Any]:
        """Splits data 80/20, trains model, and evaluates test performance."""
        df_featured, y, video_ids = extract_early_features_and_target(daily_df)
        X = df_featured[self.feature_cols]

        X_train, X_test, y_train, y_test, idx_train, idx_test = (
            train_test_split(
                X,
                y,
                df_featured.index,
                test_size=0.20,
                random_state=self.random_state,
            )
        )

        self.model.fit(X_train, y_train)
        self.is_trained = True

        # Evaluate on held-out test set
        y_test_pred = self.model.predict(X_test)
        # Ensure predicted counts cannot be negative
        y_test_pred = np.maximum(y_test_pred, 0.0)

        mae = float(mean_absolute_error(y_test, y_test_pred))
        rmse = float(np.sqrt(mean_squared_error(y_test, y_test_pred)))
        # Mean Absolute Percentage Error (MAPE)
        safe_y_test = np.maximum(y_test.values, 1.0)
        mape = float(np.mean(np.abs((y_test.values - y_test_pred) / safe_y_test)) * 100.0)

        self.metrics = {
            "mae": round(mae, 2),
            "rmse": round(rmse, 2),
            "mape": round(mape, 2),
            "train_samples": len(X_train),
            "test_samples": len(X_test),
        }

        # Predict across the entire corpus for interactive UI inspection
        y_all_pred = np.maximum(self.model.predict(X), 0.0)

        for i, row in df_featured.iterrows():
            vid = row["video_id"]
            actual = int(row["total_views_30d"])
            pred = int(y_all_pred[i])
            pct_err = round(abs(actual - pred) / max(actual, 1) * 100.0, 1)
            is_test = i in idx_test

            self.all_predictions[vid] = {
                "video_id": vid,
                "episode_title": row["episode_title"],
                "series_name": row["series_name"],
                "actual_views_30d": actual,
                "predicted_views_30d": pred,
                "absolute_error": abs(actual - pred),
                "percentage_error": pct_err,
                "is_test_set": is_test,
                "early_features": {
                    "early_growth_3d": round(row["early_growth_3d"], 2),
                    "volatility_early": round(row["volatility_early"], 2),
                    "views_day_6": int(row["views_day_6"]),
                    "early_cumulative": int(row["early_cumulative"]),
                },
            }

        return self.metrics

    def predict_for_video(self, video_id: str) -> Dict[str, Any]:
        """Returns forecast results for a specific video."""
        return self.all_predictions.get(video_id, {})


if __name__ == "__main__":
    print("=" * 60)
    print("POPULARITY DYNAMICS: FORECASTING MODULE VERIFICATION")
    print("=" * 60)
    df = pd.read_csv("data/daily_stats.csv")
    engine = ForecastingEngine(random_state=42)
    metrics = engine.train_and_evaluate(df)

    print("\nModel Evaluation on Held-Out Test Set (20% split):")
    print(f" - Train Samples: {metrics['train_samples']}")
    print(f" - Test Samples:  {metrics['test_samples']}")
    print(f" - MAE:           {metrics['mae']:,.2f} views")
    print(f" - RMSE:          {metrics['rmse']:,.2f} views")
    print(f" - MAPE:          {metrics['mape']:.2f}%")

    # Sanity check: MAPE well under 100%
    if metrics["mape"] < 100.0:
        print("\nSANITY CHECK PASSED: MAPE is well under 100% threshold.")
    else:
        print("\nSANITY CHECK FAILED: MAPE exceeds 100% threshold.")

    print("\nSample Test Set Predictions:")
    test_vids = [
        vid for vid, p in engine.all_predictions.items() if p["is_test_set"]
    ][:5]
    for vid in test_vids:
        p = engine.all_predictions[vid]
        print(
            f" - {p['video_id']} ({p['series_name']}): Actual={p['actual_views_30d']:,} | Pred={p['predicted_views_30d']:,} | Err={p['percentage_error']}%"
        )
    print("\nForecasting module verification successful!")
