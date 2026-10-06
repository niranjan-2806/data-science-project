# Popularity Dynamics Analysis

A time-series machine learning system and interactive analytics dashboard that analyzes how digital content (episodes, videos, podcasts) evolves over time. Rather than treating popularity as a static vanity score, this project models popularity as a continuous dynamic trajectory.

---

## 1. Executive Summary & Core Motivation

Digital content on platforms like YouTube, Spotify, and TikTok does not follow a single uniform adoption curve. Content items with the same 30-day cumulative view count can have wildly divergent temporal trajectories:
- Some explode immediately and burn out within 72 hours (**Viral Spike**).
- Some accumulate attention through long-tail algorithmic recommendations (**Slow-Burn Sleeper**).
- Some launch at peak interest and decay monotonically (**Steady Decay**).
- Some experience second-wave revival events weeks after release (**Resurgent Wave**).

Understanding these shapes enables two core machine learning capabilities:
1. **Supervised Forecasting**: Predicting 30-day cumulative performance using strictly the first 7 days of observation (Days 0–6).
2. **Unsupervised Clustering**: Discovering natural popularity archetypes based purely on curve geometry, completely independent of absolute scale.

---

## 2. Mathematical Archetypes & Generative Process

Synthetic data (`backend/data_generator.py`) generates $N=48$ content items across 6 distinct series over a 31-day observation window ($t \in [0, 30]$):

### 1. Slow-Burn ($25\%$)
- **Dynamics**: Gradual compounding discovery peaking between days 19–24, followed by gentle decay.
- **Formula**:
  $$\text{views}(t) = A \cdot \left(\frac{t}{\tau}\right) \cdot \exp\left(1 - \frac{t}{\tau}\right) + \text{noise}$$
  where $\tau \in [19, 24]$ and $A \in [7.5\text{k}, 115\text{k}]$.

### 2. Viral Spike ($25\%$)
- **Dynamics**: Immediate high-energy detonation within days 1–3, steep exponential drop-off.
- **Formula**:
  $$\text{views}(t) = A \cdot \exp\left(-\frac{(t - t_0)^2}{2\sigma^2}\right) + 0.08 A \exp(-t/10) + \text{noise}$$
  where $t_0 \in [1.0, 2.2]$ and $\sigma \in [0.9, 1.4]$.

### 3. Steady Decay ($25\%$)
- **Dynamics**: Launch-day maximum ($t=0$ or $1$) followed by steady exponential decay into catalog baseline.
- **Formula**:
  $$\text{views}(t) = A \cdot \exp\left(-\frac{t}{\lambda}\right) + \text{noise}$$
  where $\lambda \in [5.5, 8.5]$ (half-life of attention).

### 4. Resurgent Wave ($25\%$)
- **Dynamics**: Bimodal attention curve. Initial moderate release surge, decay, followed by a secondary revival wave around days 18–22.
- **Formula**:
  $$\text{views}(t) = A_1 \exp\left(-\frac{(t - t_0)^2}{2\sigma_0^2}\right) + A_2 \exp\left(-\frac{(t - t_1)^2}{2\sigma_1^2}\right) + \text{noise}$$
  where $t_1 \in [18, 22]$.

---

## 3. Feature Engineering (`backend/features.py`)

Raw time series are 31-dimensional and highly collinear. We project daily curves onto 7 domain-specific features:
- `growth_rate`: Mean day-over-day percentage change in daily views.
- `peak_day`: Day index ($0$ to $30$) achieving maximum view volume.
- `peak_value`: Single-day maximum view count.
- `decay_slope`: Average linear drop per day post-peak ($\Delta\text{views} / \Delta t$).
- `volatility`: Rolling 3-day standard deviation capturing trajectory noise and shocks.
- `total_views_30d`: Cumulative volume across all 31 days.
- `early_growth_3d`: Percentage growth from day 0 to day 3: $\frac{V_3 - V_0}{V_0} \times 100\%$. Key early momentum signal.

---

## 4. Machine Learning Tasks

### Task A: Supervised Forecasting (`backend/forecasting.py`)
- **Objective**: Given strictly Days 0–6 data, predict 30-day cumulative views (`total_views_30d`).
- **Feature Set**: `early_growth_3d`, `volatility_early` (days 0–6), `views_day_6`, and `early_cumulative` (days 0–6).
- **Model Choice**: Regularized Ridge Regression ($L_2$ shrinkage).
- **Why a Simple Model?** With $N=48$ items, deep neural networks or complex ensembles severely overfit and blow up test variance. A constrained linear model regularizes effectively, yielding stable out-of-sample predictions.
- **Data Split**: 80% train (38 items), 20% test (10 items), `random_state=42`.
- **Benchmark Results on Held-Out Test Set**:
  - **MAE**: $108,780$ views
  - **RMSE**: $142,421$ views
  - **MAPE**: $30.0\%$ (well under the $100\%$ threshold)

### Task B: Unsupervised Clustering (`backend/clustering.py`)
- **Objective**: Group content items by temporal curve shape, not volume.
- **Why Z-Score Normalization is Mandatory**:
  $$z_i(t) = \frac{\text{views}_i(t) - \mu_i}{\sigma_i}$$
  Across channels, absolute volume varies from $5,000$ to $120,000$. Without normalization, Euclidean distance groups videos by scale rather than curve geometry. Standardizing each trajectory to $\mu=0, \sigma=1$ guarantees scale invariance.
- **Algorithm**: K-Means ($k=4$) on normalized 31-day vectors.
- **Silhouette Score**: **$0.592$** (substantially exceeds the $0.20$ threshold).
- **Archetype Alignment**: K-Means independently rediscovered the 4 latent ground-truth generators with 100% purity.
- **Rule-Based Dynamic Labeling**: Centroid characteristics automatically map clusters to descriptive titles without hardcoded labels:
  - Peak Day $> 14 \rightarrow$ **Slow-Burn Sleeper**
  - Secondary late surge $\rightarrow$ **Resurgent Wave**
  - Peak Day $\le 3$ with surge $\rightarrow$ **Viral Spike**
  - Monotonic drop from day 0 $\rightarrow$ **Steady Decay**

---

## 5. Evaluation & Dynamic Insights (`backend/evaluation.py`)

The evaluation module computes live empirical hypothesis tests on the real data:
> *"Empirical analysis reveals that episodes in the top half of 3-day early growth (early_growth_3d > -17.1%) average 898,201 total 30-day views, compared to 436,858 views for those below (2.06x difference). Furthermore, sleeper episodes peaking after day 15 generated 3.84x the 30-day cumulative volume of early-spike episodes, demonstrating that long-tail retention compounds significantly over time."*

---

## 6. Directory Structure

```text
popularity-dynamics-analysis/
├── backend/
│   ├── data_generator.py    # Synthetic time-series generator (4 archetypes)
│   ├── features.py          # Time-series feature engineering pipeline
│   ├── forecasting.py       # Supervised 7-day Ridge regression forecaster
│   ├── clustering.py        # Unsupervised K-Means on Z-normalized curves
│   ├── evaluation.py        # Metrics synthesis & dynamic hypothesis testing
│   ├── app.py               # FastAPI REST API server
│   └── requirements.txt     # Python package requirements
├── frontend/
│   ├── index.html           # Single-page dashboard markup
│   ├── app.js               # Client controller & Chart.js integration
│   └── style.css            # Clean, production-grade styling
├── data/
│   ├── daily_stats.csv      # Daily time series (1,488 rows across 48 items)
│   └── features.csv         # Computed feature matrix (48 items)
└── README.md                # Academic & technical documentation
```

---

## 7. How to Run Locally

### Option A: Standard FastAPI + Plain Frontend
```bash
# 1. Install dependencies
pip install pandas numpy scikit-learn fastapi uvicorn tslearn httpx

# 2. Run data generation and verify feature engineering
python backend/data_generator.py
python backend/features.py
python backend/forecasting.py
python backend/clustering.py
python backend/evaluation.py

# 3. Start the FastAPI backend
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000 --reload

# 4. Open frontend/index.html in your browser or serve it:
cd frontend && python -m http.server 3000
```

### Option B: Full-Stack Vite Preview (Port 3000)
```bash
# Dev server runs on port 3000 and proxies /api to port 8000
npm run dev
```

---

## 8. REST API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Server and dataset health check |
| `GET` | `/api/series` | Catalog of distinct series |
| `GET` | `/api/videos?series=...` | List of episodes with headline metrics and cluster tag |
| `GET` | `/api/video/{video_id}` | Complete 31-day history, engineered features, and 7-day forecast |
| `GET` | `/api/clusters` | 4 discovered archetypes, silhouette score, and medoids |
| `GET` | `/api/summary` | MAE/RMSE/MAPE interpretations and dynamic empirical insight |
