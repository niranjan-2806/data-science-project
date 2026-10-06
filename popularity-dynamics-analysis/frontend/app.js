/**
 * Popularity Dynamics Analysis - Client Application
 * Handles API data ingestion, Chart.js multi-axis rendering, feature presentation,
 * supervised forecast visual comparison, and unsupervised cluster exploration.
 */

// Global state
const state = {
  seriesList: [],
  selectedSeries: "",
  videosList: [],
  selectedVideoId: "",
  currentVideoData: null,
  clustersData: null,
  summaryData: null,
  chartInstance: null,
};

// DOM Elements
const el = {
  statusDot: document.querySelector(".status-dot"),
  statusLabel: document.getElementById("backend-status"),
  btnRefresh: document.getElementById("btn-refresh"),
  seriesSelect: document.getElementById("series-select"),
  videoSelect: document.getElementById("video-select"),
  metaSeries: document.getElementById("meta-series"),
  metaCluster: document.getElementById("meta-cluster"),
  metaTotalViews: document.getElementById("meta-total-views"),
  primaryInsightText: document.getElementById("primary-insight-text"),
  featVideoId: document.getElementById("feat-video-id"),
  statPeakDay: document.getElementById("stat-peak-day"),
  statPeakValue: document.getElementById("stat-peak-value"),
  statEarlyGrowth: document.getElementById("stat-early-growth"),
  statDecaySlope: document.getElementById("stat-decay-slope"),
  statVolatility: document.getElementById("stat-volatility"),
  statGrowthRate: document.getElementById("stat-growth-rate"),
  fcActual: document.getElementById("fc-actual"),
  fcPredicted: document.getElementById("fc-predicted"),
  fcDelta: document.getElementById("fc-delta"),
  fcAccuracyBar: document.getElementById("fc-accuracy-bar"),
  fcErrorPct: document.getElementById("fc-error-pct"),
  splitBadge: document.getElementById("forecast-split-badge"),
  metricMae: document.getElementById("metric-mae"),
  metricRmse: document.getElementById("metric-rmse"),
  metricMape: document.getElementById("metric-mape"),
  metricSilhouette: document.getElementById("metric-silhouette"),
  clustersContainer: document.getElementById("clusters-container"),
  trendChartCanvas: document.getElementById("trendChart"),
};

// Formatting helpers
const formatNumber = (num) => {
  if (num === null || num === undefined || isNaN(num)) return "—";
  return new Intl.NumberFormat("en-US").format(Math.round(num));
};

const formatPct = (num) => {
  if (num === null || num === undefined || isNaN(num)) return "—%";
  const prefix = num > 0 ? "+" : "";
  return `${prefix}${Number(num).toFixed(1)}%`;
};

// API Fetch wrappers with error fallback
async function fetchApi(endpoint) {
  try {
    const res = await fetch(endpoint);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  } catch (err) {
    console.error(`API Error on ${endpoint}:`, err);
    throw err;
  }
}

// Initial Boot Sequence
async function initializeApp() {
  updateStatus("Connecting to Pipeline...", true);
  try {
    // 1. Health check
    const health = await fetchApi("/api/health");
    updateStatus(`Pipeline Online (${health.videos_loaded} items)`, false);

    // 2. Load Series catalog
    const seriesRes = await fetchApi("/api/series");
    state.seriesList = seriesRes.series || [];
    populateSeriesDropdown();

    // 3. Load Clusters
    state.clustersData = await fetchApi("/api/clusters");
    renderClusters();

    // 4. Load Evaluation Summary
    state.summaryData = await fetchApi("/api/summary");
    renderSummary();

    // 5. Load Videos catalog
    await loadVideosForSeries("");

    // Setup event listeners
    setupEventListeners();
  } catch (err) {
    console.error("Initialization failed:", err);
    updateStatus("Connection Error - Click Refresh", false, true);
  }
}

function updateStatus(label, isLoading = false, isError = false) {
  el.statusLabel.textContent = label;
  el.statusDot.classList.toggle("loading", isLoading);
  if (isError) {
    el.statusDot.style.backgroundColor = "#dc2626";
  } else {
    el.statusDot.style.backgroundColor = isLoading ? "#d97706" : "#16a34a";
  }
}

function populateSeriesDropdown() {
  el.seriesSelect.innerHTML = `<option value="">All Series (48 Items)</option>`;
  state.seriesList.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    el.seriesSelect.appendChild(opt);
  });
}

async function loadVideosForSeries(seriesName) {
  state.selectedSeries = seriesName;
  const endpoint = seriesName
    ? `/api/videos?series=${encodeURIComponent(seriesName)}`
    : `/api/videos`;

  const data = await fetchApi(endpoint);
  state.videosList = data.videos || [];
  populateVideoDropdown();

  // Automatically select the first video
  if (state.videosList.length > 0) {
    await selectVideo(state.videosList[0].video_id);
  }
}

function populateVideoDropdown() {
  el.videoSelect.innerHTML = "";
  state.videosList.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v.video_id;
    opt.textContent = `${v.episode_title} (${v.cluster_name}) — ${formatNumber(v.total_views_30d)} views`;
    el.videoSelect.appendChild(opt);
  });
}

async function selectVideo(videoId) {
  if (!videoId) return;
  state.selectedVideoId = videoId;
  el.videoSelect.value = videoId;

  try {
    const data = await fetchApi(`/api/video/${videoId}`);
    state.currentVideoData = data;
    renderSelectedVideo(data);
  } catch (err) {
    console.error("Failed to load video details:", err);
  }
}

function renderSelectedVideo(data) {
  // Top metadata strip
  el.metaSeries.textContent = `Series: ${data.series_name}`;
  el.metaCluster.textContent = `Discovered Archetype: ${data.cluster.cluster_name}`;
  el.metaTotalViews.textContent = `30-Day Views: ${formatNumber(data.features.total_views_30d)}`;

  // Feature stats
  el.featVideoId.textContent = data.video_id;
  el.statPeakDay.textContent = `Day ${data.features.peak_day}`;
  el.statPeakValue.textContent = formatNumber(data.features.peak_value);
  el.statEarlyGrowth.textContent = formatPct(data.features.early_growth_3d);
  el.statDecaySlope.textContent = `${formatNumber(data.features.decay_slope)} v/d`;
  el.statVolatility.textContent = `±${formatNumber(data.features.volatility)}`;
  el.statGrowthRate.textContent = formatPct(data.features.growth_rate);

  // Supervised Forecast Panel
  const fc = data.forecast || {};
  const actual = fc.actual_views_30d || data.features.total_views_30d;
  const pred = fc.predicted_views_30d || 0;
  const delta = Math.abs(actual - pred);
  const relErr = actual > 0 ? (delta / actual) * 100 : 0;

  el.fcActual.textContent = formatNumber(actual);
  el.fcPredicted.textContent = formatNumber(pred);
  el.fcDelta.textContent = `±${formatNumber(delta)} views`;
  el.fcErrorPct.textContent = `Relative Error: ${relErr.toFixed(1)}% | Velocity leaving Day 6: ${formatNumber(fc.early_features?.views_day_6 || 0)} v/d`;

  // Accuracy meter (100% minus relative error capped between 10% and 100%)
  const accuracyScore = Math.max(10, Math.min(100, 100 - relErr));
  el.fcAccuracyBar.style.width = `${accuracyScore}%`;

  if (fc.is_test_set) {
    el.splitBadge.textContent = "Held-Out Test Sample";
    el.splitBadge.style.color = "#16a34a";
    el.splitBadge.style.backgroundColor = "#f0fdf4";
    el.splitBadge.style.borderColor = "#bbf7d0";
  } else {
    el.splitBadge.textContent = "Training Sample";
    el.splitBadge.style.color = "#475569";
    el.splitBadge.style.backgroundColor = "#f1f5f9";
    el.splitBadge.style.borderColor = "#e2e8f0";
  }

  // Update Trend Chart
  renderTrendChart(data.daily_stats);
}

function renderTrendChart(dailyStats) {
  if (!el.trendChartCanvas) return;
  const ctx = el.trendChartCanvas.getContext("2d");

  const labels = dailyStats.map((d) => `Day ${d.day_index}`);
  const views = dailyStats.map((d) => d.views);
  const search = dailyStats.map((d) => d.search_interest);

  if (state.chartInstance) {
    state.chartInstance.destroy();
  }

  const isDark = document.body.classList.contains("dark");
  const gridColor = isDark ? "rgba(51, 65, 85, 0.45)" : "rgba(226, 232, 240, 0.7)";
  const textColor = isDark ? "#94a3b8" : "#64748b";
  const viewsColor = isDark ? "#60a5fa" : "#2563eb";

  // Create subtle gradient fill for views
  const gradient = ctx.createLinearGradient(0, 0, 0, 300);
  if (isDark) {
    gradient.addColorStop(0, "rgba(59, 130, 246, 0.35)");
    gradient.addColorStop(1, "rgba(59, 130, 246, 0.01)");
  } else {
    gradient.addColorStop(0, "rgba(37, 99, 235, 0.25)");
    gradient.addColorStop(1, "rgba(37, 99, 235, 0.01)");
  }

  state.chartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Daily Views",
          data: views,
          borderColor: viewsColor,
          backgroundColor: gradient,
          fill: true,
          tension: 0.35,
          borderWidth: 2.5,
          pointRadius: 2,
          pointHoverRadius: 5,
          pointBackgroundColor: viewsColor,
          yAxisID: "yViews",
        },
        {
          label: "Search Interest (0-100)",
          data: search,
          borderColor: "#f59e0b",
          backgroundColor: "transparent",
          borderDash: [5, 4],
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.3,
          yAxisID: "ySearch",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: {
          display: false, // Custom legend pills in HTML header
        },
        tooltip: {
          backgroundColor: isDark ? "#020617" : "#0f172a",
          borderColor: isDark ? "#334155" : "transparent",
          borderWidth: isDark ? 1 : 0,
          titleFont: { family: "var(--font-sans)", size: 12, weight: "600" },
          bodyFont: { family: "var(--font-mono)", size: 11 },
          padding: 10,
          callbacks: {
            label: function (context) {
              if (context.datasetIndex === 0) {
                return ` Daily Views: ${formatNumber(context.raw)}`;
              } else {
                return ` Search Score: ${context.raw} / 100`;
              }
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            font: { family: "var(--font-mono)", size: 11 },
            color: textColor,
            maxTicksLimit: 11,
          },
        },
        yViews: {
          type: "linear",
          display: true,
          position: "left",
          grid: { color: gridColor },
          ticks: {
            font: { family: "var(--font-mono)", size: 11 },
            color: textColor,
            callback: (val) => (val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val),
          },
        },
        ySearch: {
          type: "linear",
          display: true,
          position: "right",
          min: 0,
          max: 100,
          grid: { drawOnChartArea: false },
          ticks: {
            font: { family: "var(--font-mono)", size: 11 },
            color: "#d97706",
          },
        },
      },
    },
  });
}

function renderClusters() {
  if (!state.clustersData) return;
  el.metricSilhouette.textContent = state.clustersData.silhouette_score.toFixed(3);
  el.clustersContainer.innerHTML = "";

  state.clustersData.clusters.forEach((c) => {
    const item = document.createElement("div");
    item.className = "cluster-item";
    item.innerHTML = `
      <div class="cluster-item-header">
        <span class="cluster-name">${c.cluster_name}</span>
        <span class="cluster-count font-mono">${c.item_count} items (${c.percentage_of_corpus}%)</span>
      </div>
      <p class="cluster-desc">${c.description}</p>
      <div class="cluster-meta-row">
        <span>Avg Peak: Day ${c.avg_peak_day}</span>
        <span>·</span>
        <span>Avg 30d Views: ${formatNumber(c.avg_total_views)}</span>
      </div>
    `;

    item.addEventListener("click", () => {
      // Pick first representative video from this cluster
      if (c.representative_curves && c.representative_curves.length > 0) {
        selectVideo(c.representative_curves[0].video_id);
      }
    });

    el.clustersContainer.appendChild(item);
  });
}

function renderSummary() {
  if (!state.summaryData) return;
  const s = state.summaryData;

  // Primary empirical insight text
  el.primaryInsightText.textContent = s.primary_insight;

  // Model benchmark metrics
  const m = s.forecasting.metrics;
  el.metricMae.textContent = formatNumber(m.mae);
  el.metricRmse.textContent = formatNumber(m.rmse);
  el.metricMape.textContent = `${m.mape.toFixed(1)}%`;
}

function setupEventListeners() {
  el.seriesSelect.addEventListener("change", (e) => {
    loadVideosForSeries(e.target.value);
  });

  el.videoSelect.addEventListener("change", (e) => {
    selectVideo(e.target.value);
  });

  el.btnRefresh.addEventListener("click", () => {
    initializeApp();
  });

  // Dark mode toggle
  const themeToggle = document.getElementById("btn-theme-toggle");
  const themeIcon = document.getElementById("theme-icon");

  const applyTheme = (isDark) => {
    document.body.classList.toggle("dark", isDark);
    if (themeIcon) {
      themeIcon.textContent = isDark ? "☀️" : "🌙";
    }
    localStorage.setItem("theme", isDark ? "dark" : "light");
    if (state.currentVideoData) {
      renderTrendChart(state.currentVideoData.daily_stats);
    }
  };

  const initialDark = localStorage.getItem("theme") === "dark" ||
    (!localStorage.getItem("theme") && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);

  applyTheme(initialDark);

  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      const isCurrentlyDark = document.body.classList.contains("dark");
      applyTheme(!isCurrentlyDark);
    });
  }

  // Import button handler
  const btnImport = document.getElementById("btn-import");
  if (btnImport) {
    btnImport.addEventListener("click", async () => {
      const choice = prompt(
        "Choose real content preset to import:\n" +
        "1. MrBeast $1,000,000 Survival Challenge (Viral Explosion - 11.2M views)\n" +
        "2. Veritasium The Quantum Paradox (Algorithmic Sleeper - 14.8M views)\n" +
        "3. Apple Next-Gen Silicon Keynote (Resurgent Wave - 4.9M views)\n" +
        "4. Huberman Lab Dopamine Masterclass (Steady Decay - 3.2M views)\n\n" +
        "Enter 1, 2, 3, or 4:",
        "1"
      );

      const presetMap = {
        "1": "real_mrbeast_viral",
        "2": "real_veritasium_sleeper",
        "3": "real_apple_event_resurgent",
        "4": "real_huberman_steady_decay",
      };

      const presetId = presetMap[choice?.trim() || ""];
      if (!presetId) return;

      updateStatus("Importing & re-fitting models...", true);
      try {
        const res = await fetch("/api/import/preset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preset_id: presetId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Import failed");
        alert(data.message);
        await initializeApp();
        if (data.video_id) {
          await selectVideo(data.video_id);
        }
      } catch (err) {
        alert("Import error: " + err.message);
      } finally {
        updateStatus("Pipeline Online", false);
      }
    });
  }
}

// Start on DOM ready
document.addEventListener("DOMContentLoaded", initializeApp);
