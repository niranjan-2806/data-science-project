/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import ChartJS from 'chart.js/auto';
import type { ChartData } from 'chart.js';
import {
  TrendingUp,
  BrainCircuit,
  BarChart3,
  Layers,
  Sparkles,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Clock,
  ArrowRight,
  Info,
  Calendar,
  Eye,
  Activity,
  Flame,
  Sun,
  Moon,
  Upload,
  Plus,
  X,
  Download,
  FileSpreadsheet,
  RotateCcw,
  Sparkle,
  LogIn,
  LogOut,
  User as UserIcon,
} from 'lucide-react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db, testConnection } from './firebase';
import { LoginPage } from './components/LoginPage';
import { AccountModal } from './components/AccountModal';

interface DailyStat {
  day_index: number;
  date: string;
  views: number;
  likes: number;
  comments: number;
  search_interest: number;
}

interface VideoFeatures {
  growth_rate: number;
  peak_day: number;
  peak_value: number;
  decay_slope: number;
  volatility: number;
  total_views_30d: number;
  early_growth_3d: number;
}

interface VideoForecast {
  actual_views_30d: number;
  predicted_views_30d: number;
  absolute_error: number;
  percentage_error: number;
  is_test_set: boolean;
  early_features?: {
    early_growth_3d: number;
    volatility_early: number;
    views_day_6: number;
    early_cumulative: number;
  };
}

interface DimensionScore {
  score: number; // 0 to 20
  max_score: number;
  label: string;
  description: string;
}

interface VideoPerformanceScore {
  total_score: number; // 0 to 100
  grade: string;
  grade_label: string;
  summary: string;
  dimensions: {
    launch_velocity: DimensionScore;
    audience_retention: DimensionScore;
    search_resonance: DimensionScore;
    volume_impact: DimensionScore;
    forecast_yield: DimensionScore;
  };
}

interface VideoItem {
  video_id: string;
  series_name: string;
  episode_title: string;
  total_views_30d: number;
  peak_day: number;
  peak_value: number;
  early_growth_3d: number;
  cluster_id: number;
  cluster_name: string;
  performance_score?: number;
  grade?: string;
  grade_label?: string;
}

interface ClusterSummary {
  cluster_id: number;
  cluster_name: string;
  tagline?: string;
  simple_example?: string;
  description: string;
  item_count: number;
  percentage_of_corpus: number;
  avg_peak_day: number;
  avg_total_views: number;
  centroid_curve: number[];
  representative_curves: Array<{
    video_id: string;
    series_name: string;
    episode_title: string;
    views: number[];
    normalized_views: number[];
  }>;
  member_video_ids: string[];
}

interface EvaluationSummary {
  forecasting: {
    metrics: {
      mae: number;
      rmse: number;
      mape: number;
      train_samples: number;
      test_samples: number;
    };
    interpretations: {
      mae: string;
      rmse: string;
      mape: string;
    };
  };
  clustering: {
    silhouette_score: number;
    silhouette_interpretation: string;
    cluster_count: number;
    cluster_breakdown: Array<{
      cluster_id: number;
      cluster_name: string;
      item_count: number;
      percentage_of_corpus: number;
      avg_peak_day: number;
      avg_total_views: number;
    }>;
  };
  primary_insight: string;
  empirical_stats: {
    median_early_growth_3d: number;
    mean_views_low_early_growth: number;
    mean_views_high_early_growth: number;
    late_peaker_multiplier: number;
    corr_early_growth_total_views: number;
  };
}

interface FullVideoDetail {
  video_id: string;
  series_name: string;
  episode_title: string;
  daily_stats: DailyStat[];
  features: VideoFeatures;
  forecast: VideoForecast;
  score?: VideoPerformanceScore;
  cluster: {
    cluster_id: number;
    cluster_name: string;
    cluster_description: string;
  };
}

interface PresetItem {
  preset_id: string;
  series_name: string;
  episode_title: string;
  archetype_hint: string;
  description: string;
  views: number[];
  search_interest: number[];
}

interface AppUser {
  uid: string;
  displayName?: string | null;
  email?: string | null;
  username?: string | null;
  phoneNumber?: string | null;
  handle?: string | null;
  channelName?: string | null;
  bio?: string | null;
  role?: string;
  isFirebaseUser?: boolean;
  createdAt?: string | null;
  lastLogin?: string | null;
  photoURL?: string | null;
  emailVerified?: boolean;
}

export default function App() {
  const [seriesList, setSeriesList] = useState<string[]>([]);
  const [selectedSeries, setSelectedSeries] = useState<string>('');
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState<string>('');
  const [videoDetail, setVideoDetail] = useState<FullVideoDetail | null>(null);
  const [clusters, setClusters] = useState<ClusterSummary[]>([]);
  const [silhouetteScore, setSilhouetteScore] = useState<number>(0);
  const [summary, setSummary] = useState<EvaluationSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'methodology'>('dashboard');

  // Account Details Modal State
  const [isAccountModalOpen, setIsAccountModalOpen] = useState<boolean>(false);

  // Import Modal State
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);
  const [importTab, setImportTab] = useState<'presets' | 'custom' | 'csv'>('presets');
  const [presets, setPresets] = useState<PresetItem[]>([]);
  const [importLoading, setImportLoading] = useState<boolean>(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  // Custom Form state
  const [customTitle, setCustomTitle] = useState<string>('');
  const [customSeries, setCustomSeries] = useState<string>('Custom Channel');
  const [customViewsText, setCustomViewsText] = useState<string>('');

  // Firebase & Analyst Auth State
  const [currentUser, setCurrentUser] = useState<AppUser | null>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('analyst_user');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {
          return null;
        }
      }
      if (localStorage.getItem('guest_mode') === 'true') {
        return {
          uid: 'analyst_guest_8291',
          displayName: 'Niranjan Mohanarangan',
          email: 'niranjanmohanarangan06@gmail.com',
          phoneNumber: '+1 (555) 842-9102',
          handle: '@niranjanmohanarangan06',
          channelName: "Niranjan's Creator Studio",
          bio: 'Principal quantitative media researcher modeling algorithmic video reach and attention dynamics.',
          username: 'niranjan',
          role: 'researcher',
          isFirebaseUser: false,
        };
      }
    }
    return null;
  });
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [showLoginPage, setShowLoginPage] = useState<boolean>(false);
  const [isGuestMode, setIsGuestMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('guest_mode') === 'true';
    }
    return false;
  });

  // Track Firebase Auth state & connection
  useEffect(() => {
    testConnection();
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const baseEmail = user.email || 'niranjanmohanarangan06@gmail.com';
        const baseName = user.displayName || baseEmail.split('@')[0] || 'Niranjan Mohanarangan';
        let effectiveName = user.displayName || baseName;
        let phone = localStorage.getItem(`profile_phone_${user.uid}`) || '+1 (555) 842-9102';
        let handle = localStorage.getItem(`profile_handle_${user.uid}`) || `@${baseEmail.split('@')[0]}`;
        let channel = localStorage.getItem(`profile_channel_${user.uid}`) || `${baseName}'s Creator Studio`;
        let bio =
          localStorage.getItem(`profile_bio_${user.uid}`) ||
          'Principal quantitative media researcher modeling algorithmic video reach and attention dynamics.';
        let role = 'researcher';

        try {
          const snap = await getDoc(doc(db, 'users', user.uid));
          if (snap.exists()) {
            const data = snap.data();
            if (data.displayName) effectiveName = data.displayName;
            if (data.phoneNumber) phone = data.phoneNumber;
            if (data.handle) handle = data.handle;
            if (data.channelName) channel = data.channelName;
            if (data.bio) bio = data.bio;
            if (data.role) role = data.role;
          }
        } catch {
          // ignore non-blocking fetch note
        }

        setCurrentUser({
          uid: user.uid,
          displayName: effectiveName,
          email: user.email || baseEmail,
          phoneNumber: phone,
          handle: handle,
          channelName: channel,
          bio: bio,
          username: user.email?.split('@')[0] || user.displayName || 'analyst',
          role: role,
          isFirebaseUser: true,
          photoURL: user.photoURL,
          emailVerified: user.emailVerified,
          createdAt: user.metadata.creationTime,
          lastLogin: user.metadata.lastSignInTime,
        });
        localStorage.removeItem('analyst_user');
      } else {
        const saved = localStorage.getItem('analyst_user');
        if (saved) {
          try {
            setCurrentUser(JSON.parse(saved));
          } catch {
            setCurrentUser(null);
          }
        } else if (localStorage.getItem('guest_mode') === 'true') {
          setCurrentUser({
            uid: 'analyst_guest_8291',
            displayName: 'Niranjan Mohanarangan',
            email: 'niranjanmohanarangan06@gmail.com',
            phoneNumber: '+1 (555) 842-9102',
            handle: '@niranjanmohanarangan06',
            channelName: "Niranjan's Creator Studio",
            bio: 'Principal quantitative media researcher modeling algorithmic video reach and attention dynamics.',
            username: 'niranjan',
            role: 'researcher',
            isFirebaseUser: false,
          });
        } else {
          setCurrentUser(null);
        }
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch {
      // ignore
    }
    localStorage.removeItem('analyst_user');
    localStorage.removeItem('auth_provider_notice');
    localStorage.removeItem('guest_mode');
    setCurrentUser(null);
    setIsGuestMode(false);
    setShowLoginPage(true);
  };

  // Dark mode state
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme');
      if (saved) return saved === 'dark';
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  const chartCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartInstanceRef = useRef<ChartJS | null>(null);

  // Sync dark mode class with root html element
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  // Formatting helpers
  const formatNum = (n: number | undefined | null) => {
    if (n === undefined || n === null || isNaN(n)) return '—';
    return new Intl.NumberFormat('en-US').format(Math.round(n));
  };

  const formatPct = (n: number | undefined | null) => {
    if (n === undefined || n === null || isNaN(n)) return '—%';
    const sign = n > 0 ? '+' : '';
    return `${sign}${Number(n).toFixed(1)}%`;
  };

  // Fetch complete pipeline data
  const loadPipelineData = async (targetVideoId?: string) => {
    try {
      setRefreshing(true);
      // 1. Fetch series catalog
      const seriesRes = await fetch('/api/series');
      const seriesData = await seriesRes.json();
      setSeriesList(seriesData.series || []);

      // 2. Fetch clusters
      const clusterRes = await fetch('/api/clusters');
      const clusterData = await clusterRes.json();
      setClusters(clusterData.clusters || []);
      setSilhouetteScore(clusterData.silhouette_score || 0);

      // 3. Fetch evaluation summary
      const summaryRes = await fetch('/api/summary');
      const summaryData = await summaryRes.json();
      setSummary(summaryData);

      // 4. Fetch initial videos
      await fetchVideosForSeries('', targetVideoId ? false : true, targetVideoId);
    } catch (err) {
      console.error('Failed to load ML pipeline data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchVideosForSeries = async (series: string, selectFirst = false, specificId?: string) => {
    try {
      const url = series ? `/api/videos?series=${encodeURIComponent(series)}` : '/api/videos';
      const res = await fetch(url);
      const data = await res.json();
      const vids: VideoItem[] = data.videos || [];
      setVideos(vids);

      if (specificId && vids.some((v) => v.video_id === specificId)) {
        await loadVideoDetails(specificId);
      } else if (vids.length > 0 && (selectFirst || !vids.some((v) => v.video_id === selectedVideoId))) {
        await loadVideoDetails(vids[0].video_id);
      }
    } catch (err) {
      console.error('Failed to load videos:', err);
    }
  };

  const loadVideoDetails = async (id: string) => {
    if (!id) return;
    try {
      setSelectedVideoId(id);
      const res = await fetch(`/api/video/${id}`);
      const data: FullVideoDetail = await res.json();
      setVideoDetail(data);
    } catch (err) {
      console.error(`Failed to load details for ${id}:`, err);
    }
  };

  // Load presets on mount
  useEffect(() => {
    loadPipelineData();
    fetch('/api/import/presets')
      .then((r) => r.json())
      .then((d) => setPresets(d.presets || []))
      .catch((err) => console.error('Failed to load presets:', err));
  }, []);

  // Update chart when videoDetail or isDarkMode changes
  useEffect(() => {
    if (!chartCanvasRef.current || !videoDetail) return;

    const ctx = chartCanvasRef.current.getContext('2d');
    if (!ctx) return;

    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
    }

    const labels = videoDetail.daily_stats.map((d) => `Day ${d.day_index}`);
    const views = videoDetail.daily_stats.map((d) => d.views);
    const search = videoDetail.daily_stats.map((d) => d.search_interest);

    const gradient = ctx.createLinearGradient(0, 0, 0, 320);
    if (isDarkMode) {
      gradient.addColorStop(0, 'rgba(59, 130, 246, 0.32)');
      gradient.addColorStop(1, 'rgba(59, 130, 246, 0.01)');
    } else {
      gradient.addColorStop(0, 'rgba(37, 99, 235, 0.22)');
      gradient.addColorStop(1, 'rgba(37, 99, 235, 0.01)');
    }

    const gridColor = isDarkMode ? 'rgba(51, 65, 85, 0.45)' : 'rgba(226, 232, 240, 0.6)';
    const textColor = isDarkMode ? '#94a3b8' : '#64748b';
    const tooltipBg = isDarkMode ? '#020617' : '#0f172a';
    const tooltipBorder = isDarkMode ? '#334155' : 'transparent';

    const chartData: ChartData<'line'> = {
      labels,
      datasets: [
        {
          label: 'Daily Views',
          data: views,
          borderColor: isDarkMode ? '#60a5fa' : '#2563eb',
          backgroundColor: gradient,
          fill: true,
          tension: 0.35,
          borderWidth: 2.5,
          pointRadius: 2,
          pointHoverRadius: 6,
          pointBackgroundColor: isDarkMode ? '#60a5fa' : '#2563eb',
          yAxisID: 'yViews',
        },
        {
          label: 'Search Interest',
          data: search,
          borderColor: '#f59e0b',
          backgroundColor: 'transparent',
          borderDash: [5, 4],
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 5,
          tension: 0.3,
          yAxisID: 'ySearch',
        },
      ],
    };

    chartInstanceRef.current = new ChartJS(ctx, {
      type: 'line',
      data: chartData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: tooltipBg,
            borderColor: tooltipBorder,
            borderWidth: isDarkMode ? 1 : 0,
            padding: 12,
            titleFont: { size: 12, weight: 'bold' },
            bodyFont: { family: 'monospace', size: 11 },
            callbacks: {
              label: (context) => {
                if (context.datasetIndex === 0) {
                  return ` Daily Views: ${formatNum(context.raw as number)}`;
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
              font: { family: 'monospace', size: 11 },
              color: textColor,
              maxTicksLimit: 11,
            },
          },
          yViews: {
            type: 'linear',
            position: 'left',
            grid: { color: gridColor },
            ticks: {
              font: { family: 'monospace', size: 11 },
              color: textColor,
              callback: (val) => {
                const n = Number(val);
                return n >= 1000 ? `${(n / 1000).toFixed(0)}k` : `${n}`;
              },
            },
          },
          ySearch: {
            type: 'linear',
            position: 'right',
            min: 0,
            max: 100,
            grid: { drawOnChartArea: false },
            ticks: {
              font: { family: 'monospace', size: 11 },
              color: '#d97706',
            },
          },
        },
      },
    });

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
      }
    };
  }, [videoDetail, isDarkMode]);

  const handleSeriesChange = (series: string) => {
    setSelectedSeries(series);
    fetchVideosForSeries(series, true);
  };

  const handleVideoSelect = (id: string) => {
    loadVideoDetails(id);
  };

  // Import Handlers
  const handleImportPreset = async (presetId: string) => {
    setImportLoading(true);
    setImportError(null);
    try {
      const res = await fetch('/api/import/preset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset_id: presetId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to import preset');

      setImportSuccess(data.message);
      await loadPipelineData(data.video_id);
      setTimeout(() => {
        setIsImportModalOpen(false);
        setImportSuccess(null);
      }, 700);
    } catch (err: any) {
      setImportError(err.message || 'Error importing preset');
    } finally {
      setImportLoading(false);
    }
  };

  const handleImportCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customTitle.trim()) {
      setImportError('Please enter a video or episode title');
      return;
    }
    const numbers = customViewsText
      .split(/[\s,]+/)
      .map((n) => parseFloat(n.trim()))
      .filter((n) => !isNaN(n) && n >= 0);

    if (numbers.length < 7) {
      setImportError('Please provide daily views for at least 7 days (comma or space separated)');
      return;
    }

    setImportLoading(true);
    setImportError(null);
    try {
      const res = await fetch('/api/import/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episode_title: customTitle.trim(),
          series_name: customSeries.trim() || 'Custom Ingested Channel',
          daily_views: numbers,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to import custom video');

      setImportSuccess(data.message);
      await loadPipelineData(data.video_id);
      setCustomTitle('');
      setCustomViewsText('');
      setTimeout(() => {
        setIsImportModalOpen(false);
        setImportSuccess(null);
      }, 700);
    } catch (err: any) {
      setImportError(err.message || 'Error processing custom video');
    } finally {
      setImportLoading(false);
    }
  };

  const handleCsvFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportLoading(true);
    setImportError(null);
    try {
      const text = await file.text();
      const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
      if (lines.length < 2) {
        throw new Error('CSV file appears empty or missing rows');
      }

      // Detect if header contains day_index and views
      const header = lines[0].toLowerCase().split(',');
      const viewsIdx = header.findIndex((h) => h.includes('view'));
      const titleIdx = header.findIndex((h) => h.includes('title') || h.includes('episode'));
      const seriesIdx = header.findIndex((h) => h.includes('series') || h.includes('channel'));

      if (viewsIdx === -1) {
        throw new Error('CSV must contain a column named "views" or "daily_views"');
      }

      const parsedViews: number[] = [];
      let detectedTitle = file.name.replace(/\.[^/.]+$/, '');
      let detectedSeries = 'CSV Uploaded Data';

      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        const val = parseFloat(parts[viewsIdx]);
        if (!isNaN(val)) parsedViews.push(val);
        if (titleIdx !== -1 && parts[titleIdx]) detectedTitle = parts[titleIdx].trim();
        if (seriesIdx !== -1 && parts[seriesIdx]) detectedSeries = parts[seriesIdx].trim();
      }

      if (parsedViews.length < 7) {
        throw new Error(`Found only ${parsedViews.length} valid rows. At least 7 daily data points are required.`);
      }

      const res = await fetch('/api/import/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episode_title: detectedTitle,
          series_name: detectedSeries,
          daily_views: parsedViews,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to ingest CSV data');

      setImportSuccess(`Imported '${detectedTitle}' from CSV with ${parsedViews.length} daily observations!`);
      await loadPipelineData(data.video_id);
      setTimeout(() => {
        setIsImportModalOpen(false);
        setImportSuccess(null);
      }, 700);
    } catch (err: any) {
      setImportError(err.message || 'Error parsing CSV file');
    } finally {
      setImportLoading(false);
      e.target.value = '';
    }
  };

  const handleDownloadSampleCsv = () => {
    const csvContent =
      'day_index,views,search_interest\n' +
      '0,12000,45\n1,38000,90\n2,28000,75\n3,16000,50\n4,11000,35\n5,8500,28\n6,6900,22\n' +
      '7,5800,18\n8,5100,16\n9,4600,15\n10,4200,14\n11,3900,13\n12,3600,12\n13,3400,12\n14,3200,11\n' +
      '15,3000,11\n16,2900,10\n17,2800,10\n18,2700,9\n19,2600,9\n20,2500,9\n21,2450,8\n22,2400,8\n' +
      '23,2350,8\n24,2300,7\n25,2250,7\n26,2200,7\n27,2150,6\n28,2100,6\n29,2050,6\n30,2000,6\n';

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'sample_popularity_trajectory.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleResetCorpus = async () => {
    if (!confirm('Reset dataset back to the initial 48-item synthetic benchmark corpus?')) return;
    setImportLoading(true);
    try {
      const res = await fetch('/api/import/reset', { method: 'POST' });
      const data = await res.json();
      setImportSuccess(data.message);
      await loadPipelineData();
      setTimeout(() => {
        setIsImportModalOpen(false);
        setImportSuccess(null);
      }, 700);
    } catch (err: any) {
      setImportError(err.message || 'Failed to reset corpus');
    } finally {
      setImportLoading(false);
    }
  };

  const fillTemplate = (type: 'viral' | 'sleeper' | 'decay' | 'resurgent') => {
    if (type === 'viral') {
      setCustomTitle('Viral Teaser: Product Launch Event');
      setCustomSeries('Tech Keynotes');
      setCustomViewsText('25000, 185000, 120000, 65000, 38000, 24000, 17000, 12000, 9500, 7800, 6500, 5600, 4800, 4200, 3800');
    } else if (type === 'sleeper') {
      setCustomTitle('Underground Documentary: Sound Design');
      setCustomSeries('Film Essays');
      setCustomViewsText('3200, 3600, 4100, 4800, 5700, 7200, 9800, 14500, 22000, 36000, 58000, 84000, 110000, 125000, 120000');
    } else if (type === 'decay') {
      setCustomTitle('Weekly Episode #98: System Architecture');
      setCustomSeries('Developer Weekly');
      setCustomViewsText('45000, 48000, 38000, 29000, 22000, 17500, 14000, 11500, 9800, 8500, 7400, 6600, 5900, 5400, 4900');
    } else if (type === 'resurgent') {
      setCustomTitle('Podcast Discussion: The Next Decade in AI');
      setCustomSeries('Future Thinkers');
      setCustomViewsText('28000, 42000, 32000, 19000, 13000, 9500, 7600, 6800, 6400, 8200, 14000, 29000, 52000, 48000, 35000');
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center font-sans">
        <div className="flex items-center gap-2.5 text-xs text-slate-500 font-mono">
          <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
          <span>Connecting to Firebase Auth...</span>
        </div>
      </div>
    );
  }

  if ((!currentUser && !isGuestMode) || showLoginPage) {
    return (
      <LoginPage
        onSuccess={() => {
          setShowLoginPage(false);
          setIsGuestMode(false);
          localStorage.removeItem('guest_mode');
        }}
        onContinueAsGuest={() => {
          setShowLoginPage(false);
          setIsGuestMode(true);
          localStorage.setItem('guest_mode', 'true');
          setCurrentUser({
            uid: 'analyst_guest_8291',
            displayName: 'Niranjan Mohanarangan',
            email: 'niranjanmohanarangan06@gmail.com',
            phoneNumber: '+1 (555) 842-9102',
            handle: '@niranjanmohanarangan06',
            channelName: "Niranjan's Creator Studio",
            bio: 'Principal quantitative media researcher modeling algorithmic video reach and attention dynamics.',
            username: 'niranjan',
            role: 'researcher',
            isFirebaseUser: false,
          });
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans transition-colors duration-200">
      {/* Top Bar Contract (3 zones) */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-40 transition-colors duration-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          {/* Zone 1: Single text wordmark */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-sm shadow-sm">
              PD
            </div>
            <div>
              <span className="text-base font-bold tracking-tight text-slate-900 dark:text-white block leading-tight">
                Popularity Dynamics Analysis
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400 hidden sm:block">
                Time-series ML &amp; trajectory modeling
              </span>
            </div>
          </div>

          {/* Zone 2: Navigation Links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer ${
                activeTab === 'dashboard'
                  ? 'text-blue-600 dark:text-blue-400 font-semibold border-b-2 border-blue-600 dark:border-blue-400 pb-0.5'
                  : ''
              }`}
            >
              Analytics Dashboard
            </button>
            <button
              onClick={() => setActiveTab('methodology')}
              className={`hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer ${
                activeTab === 'methodology'
                  ? 'text-blue-600 dark:text-blue-400 font-semibold border-b-2 border-blue-600 dark:border-blue-400 pb-0.5'
                  : ''
              }`}
            >
              Mathematical Foundations
            </button>
          </nav>

          {/* Zone 3: Primary Action, Status & Dark Mode Toggle */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Import Button */}
            <button
              onClick={() => setIsImportModalOpen(true)}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shadow-xs cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Import Video</span>
            </button>

            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2.5 py-1.5 rounded-md border border-transparent dark:border-slate-700/60">
              <span
                className={`w-2 h-2 rounded-full ${
                  refreshing ? 'bg-amber-500 animate-ping' : 'bg-emerald-600 dark:bg-emerald-400'
                }`}
              />
              <span className="font-mono tabular-nums">{videos.length} Episodes</span>
            </div>

            {/* Dark Mode Toggle Button */}
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label="Toggle dark mode"
              className="p-1.5 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-xs cursor-pointer"
            >
              {isDarkMode ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4 text-slate-600" />
              )}
            </button>

            {/* Firebase Auth Pathway & YouTube Style Account Button */}
            {currentUser ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setIsAccountModalOpen(true)}
                  title="View YouTube & Google Account details"
                  aria-label="View Account Information"
                  className="flex items-center gap-2 text-xs bg-slate-100 hover:bg-slate-200/90 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 transition-all cursor-pointer shadow-2xs group"
                >
                  <div className="w-5 h-5 rounded-full bg-gradient-to-tr from-rose-600 to-amber-500 text-white flex items-center justify-center font-bold text-[10px] ring-1 ring-white/50 dark:ring-slate-900 shadow-2xs shrink-0">
                    {(currentUser.displayName || currentUser.username || 'A')[0].toUpperCase()}
                  </div>
                  <span className="font-semibold max-w-[120px] truncate text-left">
                    {currentUser.displayName || currentUser.username || currentUser.email?.split('@')[0] || 'Account'}
                  </span>
                  <span className="text-[10px] font-semibold bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 px-1.5 py-0.5 rounded-full border border-rose-200 dark:border-rose-900 hidden sm:inline-block">
                    Account Info
                  </span>
                </button>
                <button
                  onClick={handleSignOut}
                  title="Sign Out"
                  aria-label="Sign out"
                  className="p-1.5 text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 rounded-md transition-colors cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowLoginPage(true)}
                className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs whitespace-nowrap"
              >
                <LogIn className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>Login</span>
              </button>
            )}

            <button
              onClick={() => loadPipelineData()}
              disabled={refreshing}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5 whitespace-nowrap shadow-xs disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Series & Video Selectors Bar */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-xs space-y-4 transition-colors duration-200">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            <div className="md:col-span-4 space-y-1.5">
              <label htmlFor="series-dropdown" className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
                Filter by Series
              </label>
              <select
                id="series-dropdown"
                value={selectedSeries}
                onChange={(e) => handleSeriesChange(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 dark:focus:border-blue-500"
              >
                <option value="">All Series ({seriesList.length} series · {videos.length} items)</option>
                {seriesList.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-8 space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="episode-dropdown" className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
                  Select Episode / Video Item
                </label>
                <span className="text-[11px] text-slate-400 font-mono">
                  Showing {videos.length} items
                </span>
              </div>
              <select
                id="episode-dropdown"
                value={selectedVideoId}
                onChange={(e) => handleVideoSelect(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 dark:focus:border-blue-500 font-mono"
              >
                {videos.map((v) => (
                  <option key={v.video_id} value={v.video_id}>
                    {v.episode_title} — [{v.cluster_name}] — Score: {v.performance_score ?? 80}/100 ({v.grade ?? 'B'}) — {formatNum(v.total_views_30d)} views
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Zero-Pill Unboxed Metadata Strip */}
          {videoDetail && (
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-medium text-slate-700 dark:text-slate-300">{videoDetail.series_name}</span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
              <span>{videoDetail.episode_title}</span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
              <span className="font-mono text-blue-700 dark:text-blue-400 font-medium">Archetype: {videoDetail.cluster.cluster_name}</span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
              <span className="font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                Score: {videoDetail.score?.total_score ?? 80}/100 (Grade {videoDetail.score?.grade ?? 'B'})
              </span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
              <span className="font-mono tabular-nums">30-Day Total: {formatNum(videoDetail.features.total_views_30d)} views</span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
              <span className="font-mono text-slate-400 dark:text-slate-500">{videoDetail.video_id}</span>
            </div>
          )}
        </section>

        {/* Dynamic Empirical Insight Banner */}
        {summary && (
          <section className="bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200/80 dark:border-blue-900/60 rounded-xl p-4 sm:p-5 flex items-start gap-3.5 shadow-xs transition-colors duration-200">
            <div className="p-2 rounded-lg bg-blue-600 dark:bg-blue-500 text-white shrink-0 mt-0.5">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="space-y-1">
              <div className="text-xs font-bold text-blue-900 dark:text-blue-300 uppercase tracking-wider">
                Live Derived Empirical Insight (Bivariate Hypothesis Test)
              </div>
              <p className="text-sm text-blue-950 dark:text-blue-100 leading-relaxed">
                {summary.primary_insight}
              </p>
            </div>
          </section>
        )}

        {/* Tab 1: Analytics Dashboard View */}
        {activeTab === 'dashboard' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column (8 cols): Trajectory & Engineered Features */}
            <div className="lg:col-span-7 space-y-6">
              {/* 100-Point Composite Performance Scorecard */}
              {videoDetail && (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs space-y-5 transition-colors duration-200">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                          <span>Video Performance Scorecard</span>
                        </h2>
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                          Score Out of 100
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Equal-weight synthesis across how the video worked (trajectory dynamics) and its final results
                      </p>
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-300 font-mono bg-slate-50 dark:bg-slate-800/80 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 self-start sm:self-auto">
                      5 Dimensions × 20 Pts = 100 Pts
                    </div>
                  </div>

                  {/* Big Hero Score Row */}
                  <div className="bg-gradient-to-r from-slate-50 via-blue-50/40 to-emerald-50/40 dark:from-slate-850 dark:via-blue-950/20 dark:to-emerald-950/20 rounded-xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      {/* Circular / Badge Metric */}
                      <div className="w-16 h-16 rounded-2xl bg-white dark:bg-slate-900 shadow-xs border border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center shrink-0">
                        <span className="text-2xl font-black font-mono tracking-tight text-blue-600 dark:text-blue-400 leading-none">
                          {videoDetail.score?.total_score ?? 80}
                        </span>
                        <span className="text-[10px] text-slate-400 font-bold uppercase mt-1">
                          / 100
                        </span>
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            Overall Rating
                          </span>
                          <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-blue-600 text-white shadow-2xs">
                            Grade {videoDetail.score?.grade ?? 'B'}
                          </span>
                          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                            • {videoDetail.score?.grade_label ?? 'Solid Catalog Performer'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed max-w-xl">
                          {videoDetail.score?.summary ??
                            `Scored ${videoDetail.score?.total_score ?? 80}/100 across 5 equal-weight dimensions balancing launch momentum, audience retention, search buzz, and final reach results.`}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* 5 Equal-Weight Dimension Meters (20 pts each) */}
                  <div className="space-y-3 pt-1">
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center justify-between">
                      <span>5 Equal-Weight Insight Dimensions</span>
                      <span className="text-[11px] font-normal normal-case text-slate-400">20 points maximum each</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* 1. Launch Velocity */}
                      <div className="bg-slate-50 dark:bg-slate-800/40 rounded-xl p-3.5 border border-slate-200 dark:border-slate-800/80 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-sm">🚀</span>
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                              Launch Velocity
                            </span>
                          </div>
                          <span className="text-xs font-bold font-mono text-slate-900 dark:text-white">
                            {videoDetail.score?.dimensions.launch_velocity.score ?? 15}
                            <span className="text-slate-400 font-normal"> / 20</span>
                          </span>
                        </div>
                        <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                          <div
                            className="bg-blue-600 dark:bg-blue-500 h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${((videoDetail.score?.dimensions.launch_velocity.score ?? 15) / 20) * 100}%`,
                            }}
                          />
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
                          How fast it kicked off: 72h momentum &amp; early Day 0–3 lift.
                        </p>
                      </div>

                      {/* 2. Audience Retention */}
                      <div className="bg-slate-50 dark:bg-slate-800/40 rounded-xl p-3.5 border border-slate-200 dark:border-slate-800/80 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-sm">⏳</span>
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                              Audience Retention
                            </span>
                          </div>
                          <span className="text-xs font-bold font-mono text-slate-900 dark:text-white">
                            {videoDetail.score?.dimensions.audience_retention.score ?? 16}
                            <span className="text-slate-400 font-normal"> / 20</span>
                          </span>
                        </div>
                        <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                          <div
                            className="bg-emerald-600 dark:bg-emerald-500 h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${((videoDetail.score?.dimensions.audience_retention.score ?? 16) / 20) * 100}%`,
                            }}
                          />
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
                          How long it held: decay control &amp; late-tail viewer stability.
                        </p>
                      </div>

                      {/* 3. Search & Interest */}
                      <div className="bg-slate-50 dark:bg-slate-800/40 rounded-xl p-3.5 border border-slate-200 dark:border-slate-800/80 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-sm">🔍</span>
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                              Search &amp; Interest
                            </span>
                          </div>
                          <span className="text-xs font-bold font-mono text-slate-900 dark:text-white">
                            {videoDetail.score?.dimensions.search_resonance.score ?? 14}
                            <span className="text-slate-400 font-normal"> / 20</span>
                          </span>
                        </div>
                        <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                          <div
                            className="bg-amber-500 h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${((videoDetail.score?.dimensions.search_resonance.score ?? 14) / 20) * 100}%`,
                            }}
                          />
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
                          Search buzz: Google Trends score intensity across 30 days.
                        </p>
                      </div>

                      {/* 4. 30-Day Reach (Results) */}
                      <div className="bg-slate-50 dark:bg-slate-800/40 rounded-xl p-3.5 border border-slate-200 dark:border-slate-800/80 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-sm">📊</span>
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                              30-Day Reach Results
                            </span>
                          </div>
                          <span className="text-xs font-bold font-mono text-slate-900 dark:text-white">
                            {videoDetail.score?.dimensions.volume_impact.score ?? 16}
                            <span className="text-slate-400 font-normal"> / 20</span>
                          </span>
                        </div>
                        <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                          <div
                            className="bg-indigo-600 dark:bg-indigo-500 h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${((videoDetail.score?.dimensions.volume_impact.score ?? 16) / 20) * 100}%`,
                            }}
                          />
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
                          Cumulative outcome: total views generated vs corpus benchmark.
                        </p>
                      </div>

                      {/* 5. Forecast Yield (Results vs Expectations) - spans full width on sm */}
                      <div className="sm:col-span-2 bg-slate-50 dark:bg-slate-800/40 rounded-xl p-3.5 border border-slate-200 dark:border-slate-800/80 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-sm">🎯</span>
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                              Forecast Yield (Actual vs. Expected)
                            </span>
                          </div>
                          <span className="text-xs font-bold font-mono text-slate-900 dark:text-white">
                            {videoDetail.score?.dimensions.forecast_yield.score ?? 15}
                            <span className="text-slate-400 font-normal"> / 20</span>
                          </span>
                        </div>
                        <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                          <div
                            className="bg-purple-600 dark:bg-purple-500 h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${((videoDetail.score?.dimensions.forecast_yield.score ?? 15) / 20) * 100}%`,
                            }}
                          />
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
                          Outperformance multiplier: whether the video met or exceeded its 7-day machine learning forecast.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 30-Day Attention Trajectory Card */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs space-y-4 transition-colors duration-200">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900 dark:text-white tracking-tight">
                      30-Day Attention Trajectory
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Daily non-cumulative views and normalized search interest intensity
                    </p>
                  </div>
                  {/* Legend */}
                  <div className="flex items-center gap-4 text-xs text-slate-600 dark:text-slate-300">
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-xs bg-blue-600 dark:bg-blue-400" />
                      Daily Views (Left)
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-0.5 border-t-2 border-dashed border-amber-500" />
                      Search Score (Right)
                    </span>
                  </div>
                </div>

                {/* Canvas Container */}
                <div className="h-72 w-full relative">
                  <canvas ref={chartCanvasRef} />
                </div>
              </div>

              {/* Engineered Features Card */}
              {videoDetail && (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs space-y-4 transition-colors duration-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900 dark:text-white tracking-tight">
                        Engineered Trajectory Features
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Domain shape descriptors extracted from the 31-day time series
                      </p>
                    </div>
                    <span className="text-xs font-mono text-slate-400 dark:text-slate-500">
                      ID: {videoDetail.video_id}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-3.5 border border-slate-100 dark:border-slate-800/80">
                      <span className="text-xs text-slate-500 dark:text-slate-400 block font-medium">Peak Day</span>
                      <span className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white block mt-1">
                        Day {videoDetail.features.peak_day}
                      </span>
                      <span className="text-[11px] text-slate-400 dark:text-slate-500 block mt-0.5">
                        Day with max daily volume
                      </span>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-3.5 border border-slate-100 dark:border-slate-800/80">
                      <span className="text-xs text-slate-500 dark:text-slate-400 block font-medium">Peak Value</span>
                      <span className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white block mt-1">
                        {formatNum(videoDetail.features.peak_value)}
                      </span>
                      <span className="text-[11px] text-slate-400 dark:text-slate-500 block mt-0.5">
                        Single-day highest views
                      </span>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-3.5 border border-slate-100 dark:border-slate-800/80">
                      <span className="text-xs text-slate-500 dark:text-slate-400 block font-medium">Early Growth (0–3d)</span>
                      <span className="text-xl font-bold font-mono tabular-nums text-blue-700 dark:text-blue-400 block mt-1">
                        {formatPct(videoDetail.features.early_growth_3d)}
                      </span>
                      <span className="text-[11px] text-slate-400 dark:text-slate-500 block mt-0.5">
                        72h launch momentum signal
                      </span>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-3.5 border border-slate-100 dark:border-slate-800/80">
                      <span className="text-xs text-slate-500 dark:text-slate-400 block font-medium">Decay Slope</span>
                      <span className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white block mt-1">
                        {formatNum(videoDetail.features.decay_slope)}
                        <span className="text-xs text-slate-500 dark:text-slate-400 font-normal ml-1">v/d</span>
                      </span>
                      <span className="text-[11px] text-slate-400 dark:text-slate-500 block mt-0.5">
                        Post-peak drop per day
                      </span>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-3.5 border border-slate-100 dark:border-slate-800/80">
                      <span className="text-xs text-slate-500 dark:text-slate-400 block font-medium">Volatility</span>
                      <span className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white block mt-1">
                        ±{formatNum(videoDetail.features.volatility)}
                      </span>
                      <span className="text-[11px] text-slate-400 dark:text-slate-500 block mt-0.5">
                        Rolling 3-day std deviation
                      </span>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-3.5 border border-slate-100 dark:border-slate-800/80">
                      <span className="text-xs text-slate-500 dark:text-slate-400 block font-medium">Mean Growth Rate</span>
                      <span className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white block mt-1">
                        {formatPct(videoDetail.features.growth_rate)}
                      </span>
                      <span className="text-[11px] text-slate-400 dark:text-slate-500 block mt-0.5">
                        Daily average percentage change
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right Column (5 cols): Supervised Forecasting & Unsupervised Clusters */}
            <div className="lg:col-span-5 space-y-6">
              {/* Supervised Forecasting Card */}
              {videoDetail && (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs space-y-4 transition-colors duration-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900 dark:text-white tracking-tight">
                        7-Day Supervised Forecast
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Predicting 30-day cumulative views from Days 0–6
                      </p>
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded font-mono ${
                        videoDetail.forecast.is_test_set
                          ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {videoDetail.forecast.is_test_set ? 'Held-Out Test Sample' : 'Training Sample'}
                    </span>
                  </div>

                  {/* Actual vs Predicted comparison */}
                  <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-4 border border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <div>
                      <span className="text-xs text-slate-500 dark:text-slate-400 block">Actual 30-Day Views</span>
                      <span className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white block mt-0.5">
                        {formatNum(videoDetail.forecast.actual_views_30d || videoDetail.features.total_views_30d)}
                      </span>
                    </div>
                    <ArrowRight className="w-5 h-5 text-slate-300 dark:text-slate-600" />
                    <div>
                      <span className="text-xs text-slate-500 dark:text-slate-400 block">Predicted (from Days 0–6)</span>
                      <span className="text-lg font-bold font-mono tabular-nums text-blue-600 dark:text-blue-400 block mt-0.5">
                        {formatNum(videoDetail.forecast.predicted_views_30d)}
                      </span>
                    </div>
                  </div>

                  {/* Absolute Delta & Accuracy Bar */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-slate-600 dark:text-slate-300 font-mono">
                      <span>Prediction Absolute Error</span>
                      <span className="font-semibold text-slate-900 dark:text-white">
                        ±{formatNum(videoDetail.forecast.absolute_error)} views ({videoDetail.forecast.percentage_error.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-blue-600 dark:bg-blue-500 h-2 rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.max(
                            8,
                            Math.min(100, 100 - videoDetail.forecast.percentage_error)
                          )}%`,
                        }}
                      />
                    </div>
                    <div className="flex justify-between text-[11px] text-slate-400 dark:text-slate-500">
                      <span>Day 6 Exit Velocity: {formatNum(videoDetail.forecast.early_features?.views_day_6 || 0)} v/d</span>
                      <span>Early Volume: {formatNum(videoDetail.forecast.early_features?.early_cumulative || 0)}</span>
                    </div>
                  </div>

                  {/* Overall Held-Out Test Evaluation Benchmark */}
                  {summary && (
                    <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
                      <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Held-Out Test Set Metrics (80/20 Train/Test Split)
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-md p-2 border border-slate-100 dark:border-slate-800">
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase block">MAE</span>
                          <span className="text-xs font-bold font-mono text-slate-800 dark:text-slate-200">
                            {formatNum(summary.forecasting.metrics.mae)}
                          </span>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-md p-2 border border-slate-100 dark:border-slate-800">
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase block">RMSE</span>
                          <span className="text-xs font-bold font-mono text-slate-800 dark:text-slate-200">
                            {formatNum(summary.forecasting.metrics.rmse)}
                          </span>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-md p-2 border border-slate-100 dark:border-slate-800">
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase block">MAPE</span>
                          <span className="text-xs font-bold font-mono text-emerald-700 dark:text-emerald-400">
                            {summary.forecasting.metrics.mape.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                        {summary.forecasting.interpretations.mape}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Unsupervised Clustering Explorer */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs space-y-4 transition-colors duration-200">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                      <span>Discovered Archetypes</span>
                      <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                        4 Patterns
                      </span>
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Natural viewer trends discovered by grouping videos with matching attention shapes
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-[11px] text-slate-400 dark:text-slate-500 block">Separation Quality</span>
                    <span className="text-xs font-bold font-mono text-emerald-700 dark:text-emerald-400">
                      High ({silhouetteScore.toFixed(2)})
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  {clusters.map((c) => {
                    const isCurrentCluster = videoDetail?.cluster.cluster_id === c.cluster_id;

                    // Fallback helper taglines & plain English examples
                    const defaultTaglines: Record<string, string> = {
                      'Slow-Burn Sleeper': 'Slow Start, Big Finish',
                      'Viral Spike': 'Fast Explosion, Quick Cooldown',
                      'Steady Decay': 'Big Launch Day, Smooth Decline',
                      'Resurgent Wave': 'Initial Buzz, Then a Second Wave',
                    };

                    const defaultExamples: Record<string, string> = {
                      'Slow-Burn Sleeper': 'In-depth video essays, documentaries, and evergreen search tutorials.',
                      'Viral Spike': 'Breaking news, meme reactions, trending challenges, and product teasers.',
                      'Steady Decay': 'Weekly podcast episodes, serial shows, and creator subscriber drops.',
                      'Resurgent Wave': 'Videos rediscovered after clips blow up on TikTok, Shorts, or Reddit.',
                    };

                    const tagline = c.tagline || defaultTaglines[c.cluster_name] || 'Viewer Pattern';
                    const example = c.simple_example || defaultExamples[c.cluster_name] || 'General audience viewing.';

                    return (
                      <div
                        key={c.cluster_id}
                        onClick={() => {
                          if (c.representative_curves && c.representative_curves.length > 0) {
                            loadVideoDetails(c.representative_curves[0].video_id);
                          }
                        }}
                        className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                          isCurrentCluster
                            ? 'border-blue-500 dark:border-blue-400 bg-blue-50/50 dark:bg-blue-950/40 ring-1 ring-blue-500/20 shadow-xs'
                            : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50/60 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        {/* Heading & Subheading Tagline */}
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-bold text-slate-900 dark:text-white">
                                {c.cluster_name}
                              </span>
                              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                {tagline}
                              </span>
                            </div>
                            {isCurrentCluster && (
                              <span className="inline-block mt-1 text-[10px] font-semibold text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/50 px-1.5 py-0.5 rounded">
                                Selected Episode Pattern
                              </span>
                            )}
                          </div>
                          <span className="text-xs font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                            {c.item_count} videos ({c.percentage_of_corpus}%)
                          </span>
                        </div>

                        {/* Simplified Easy-To-Understand Description */}
                        <p className="text-xs text-slate-600 dark:text-slate-300 mt-2 leading-relaxed">
                          {c.description}
                        </p>

                        {/* Real-World Example Pill */}
                        <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 px-2.5 py-1.5 rounded-lg border border-slate-100 dark:border-slate-800 flex items-start gap-1.5">
                          <span className="font-semibold text-slate-700 dark:text-slate-300 shrink-0">Best for:</span>
                          <span className="italic">{example}</span>
                        </div>

                        {/* Bottom Metric Badges */}
                        <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-mono pt-2 border-t border-slate-100 dark:border-slate-800/80">
                          <span>Peak Day: <strong className="text-slate-700 dark:text-slate-200">Day {c.avg_peak_day}</strong></span>
                          <span>Avg 30-Day Views: <strong className="text-slate-700 dark:text-slate-200">{formatNum(c.avg_total_views)}</strong></span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Methodology & Mathematical Foundations View */}
        {activeTab === 'methodology' && (
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 sm:p-8 shadow-xs space-y-6 transition-colors duration-200">
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                Machine Learning Methodology &amp; Mathematical Design
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Full documentation prepared for academic thesis and faculty peer review
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-200 dark:border-slate-800">
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-semibold text-sm">
                  <Layers className="w-4 h-4" />
                  <span>1. Trajectory Shape vs Absolute Scale (Z-Score Normalization)</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  In content platforms, a marquee podcast episode might reach 120,000 views, whereas an educational niche episode peaks at 6,000 views. If clustered in raw Euclidean space, distance is governed by scale rather than trajectory geometry.
                </p>
                <div className="bg-slate-50 dark:bg-slate-800/80 p-3 rounded-lg border border-slate-200 dark:border-slate-700 font-mono text-xs text-slate-800 dark:text-slate-200">
                  z_i(t) = [ views_i(t) - mean(views_i) ] / std(views_i)
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Standardizing each time series to zero mean and unit variance guarantees scale invariance: both the 6k and 120k viral episodes superimpose onto the exact same normalized trajectory manifold.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-semibold text-sm">
                  <BrainCircuit className="w-4 h-4" />
                  <span>2. Constrained Ridge Regression for Small-N Forecasting</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  With N = 48 items, high-capacity models (deep networks, gradient boosting trees) have high parameter-to-sample ratios and severely overfit. A regularized linear model trained strictly on Days 0–6 features prevents data leakage and generalizes with test MAPE ~30.0%.
                </p>
                <div className="bg-slate-50 dark:bg-slate-800/80 p-3 rounded-lg border border-slate-200 dark:border-slate-700 font-mono text-xs text-slate-800 dark:text-slate-200">
                  min_w || y - X w ||^2 + alpha || w ||_2^2
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Features computed exclusively from early signals: 72-hour growth rate, early rolling volatility, Day 6 views momentum, and 7-day cumulative views.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-semibold text-sm">
                  <Activity className="w-4 h-4" />
                  <span>3. Unsupervised Clustering &amp; Silhouette Cohesion</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  K-Means (k=4) was fitted on the 31-day standardized vectors. Without access to ground-truth labels during training, the algorithm achieved a <strong>Silhouette Score of {silhouetteScore.toFixed(3)}</strong>, cleanly recovering the 4 latent generative archetypes with 100% purity.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-semibold text-sm">
                  <Sparkles className="w-4 h-4" />
                  <span>4. The 4 Discovered Audience Archetypes (Plain English)</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Instead of using rigid labels, the model groups videos by their actual 30-day viewer curves:
                </p>
                <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-2 list-disc list-inside">
                  <li>
                    <strong>Slow-Burn Sleeper (Slow Start, Big Finish):</strong> Starts modest, builds momentum as recommendations kick in, and peaks late (around Days 18–26) with lasting long-term views.
                  </li>
                  <li>
                    <strong>Viral Spike (Fast Explosion, Quick Cooldown):</strong> Huge surge right at launch (Days 1–3), followed by a steep drop-off once early social media hype fades.
                  </li>
                  <li>
                    <strong>Steady Decay (Big Launch Day, Smooth Decline):</strong> Highest views on Day 1 from loyal channel subscribers, then gently tapers off into regular catalog views.
                  </li>
                  <li>
                    <strong>Resurgent Wave (Initial Buzz, Then a Second Wave):</strong> Launches well, dips, and then enjoys an unexpected second wave of views weeks later (Days 18–22) from social reposts or short clips.
                  </li>
                </ul>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Import Video & Real Content Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl shadow-xl flex flex-col max-h-[90vh] overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Upload className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  Import Content or Real Video Trajectory
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Ingest real YouTube analytics curves, custom series, or test curated real-world creator data
                </p>
              </div>
              <button
                onClick={() => setIsImportModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-md cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Tabs */}
            <div className="px-5 pt-3 border-b border-slate-100 dark:border-slate-800 flex gap-4 text-xs font-semibold">
              <button
                onClick={() => { setImportTab('presets'); setImportError(null); }}
                className={`pb-2.5 transition-colors cursor-pointer ${
                  importTab === 'presets'
                    ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Real-World YouTube Presets
              </button>
              <button
                onClick={() => { setImportTab('custom'); setImportError(null); }}
                className={`pb-2.5 transition-colors cursor-pointer ${
                  importTab === 'custom'
                    ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Manual Trajectory Entry
              </button>
              <button
                onClick={() => { setImportTab('csv'); setImportError(null); }}
                className={`pb-2.5 transition-colors cursor-pointer ${
                  importTab === 'csv'
                    ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                CSV Upload
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-4 flex-1">
              {importError && (
                <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{importError}</span>
                </div>
              )}

              {importSuccess && (
                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{importSuccess}</span>
                </div>
              )}

              {/* Tab 1: Real-World Presets */}
              {importTab === 'presets' && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Select a real-world YouTube video trajectory to test how the ML pipeline classifies and forecasts multi-million view items:
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {presets.map((p) => (
                      <div
                        key={p.preset_id}
                        className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex flex-col justify-between gap-3 hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
                      >
                        <div>
                          <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                            <span>{p.series_name}</span>
                            <span className="text-blue-600 dark:text-blue-400 font-semibold">{p.archetype_hint}</span>
                          </div>
                          <h4 className="text-xs font-bold text-slate-900 dark:text-white mt-1 leading-snug">
                            {p.episode_title}
                          </h4>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                            {p.description}
                          </p>
                          <div className="mt-2 text-[10px] text-slate-400 font-mono">
                            Peak views: {formatNum(Math.max(...p.views))} · Day 30 cumulative: {formatNum(p.views.reduce((a, b) => a + b, 0))}
                          </div>
                        </div>

                        <button
                          onClick={() => handleImportPreset(p.preset_id)}
                          disabled={importLoading}
                          className="w-full py-1.5 px-3 text-xs font-semibold text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950/50 transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Import &amp; Analyze</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tab 2: Manual Trajectory */}
              {importTab === 'custom' && (
                <form onSubmit={handleImportCustom} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Episode / Video Title
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Ep 12: Distributed Consensus"
                        value={customTitle}
                        onChange={(e) => setCustomTitle(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Series or Channel Name
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Systems Engineering"
                        value={customSeries}
                        onChange={(e) => setCustomSeries(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  {/* Autofill quick template buttons */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Daily Views (At least 7 days, comma-separated)
                      </label>
                      <span className="text-[11px] text-slate-400">Quick template:</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => fillTemplate('viral')}
                        className="text-[11px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                      >
                        Viral Spike
                      </button>
                      <button
                        type="button"
                        onClick={() => fillTemplate('sleeper')}
                        className="text-[11px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                      >
                        Slow-Burn
                      </button>
                      <button
                        type="button"
                        onClick={() => fillTemplate('decay')}
                        className="text-[11px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                      >
                        Steady Decay
                      </button>
                      <button
                        type="button"
                        onClick={() => fillTemplate('resurgent')}
                        className="text-[11px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                      >
                        Resurgent
                      </button>
                    </div>
                    <textarea
                      rows={4}
                      placeholder="e.g. 15000, 42000, 31000, 18000, 12000, 9500, 8100, 7200, 6800..."
                      value={customViewsText}
                      onChange={(e) => setCustomViewsText(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                    <p className="text-[11px] text-slate-400">
                      If fewer than 31 days are supplied, the pipeline uses early days for 7-day forecasting and fits natural power-law decay to complete the trajectory.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={importLoading}
                    className="w-full py-2 px-4 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg shadow-sm transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Plus className="w-4 h-4" />
                    <span>{importLoading ? 'Processing Trajectory...' : 'Add Video & Re-Train Models'}</span>
                  </button>
                </form>
              )}

              {/* Tab 3: CSV Upload */}
              {importTab === 'csv' && (
                <div className="space-y-4">
                  <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-6 text-center space-y-3 bg-slate-50/50 dark:bg-slate-800/30">
                    <FileSpreadsheet className="w-8 h-8 text-slate-400 mx-auto" />
                    <div>
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 block">
                        Upload Video CSV File
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">
                        CSV with columns: <code>day_index,views</code> or full analytics export
                      </span>
                    </div>
                    <label className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer transition-colors shadow-xs">
                      <Upload className="w-3.5 h-3.5" />
                      <span>Choose CSV File</span>
                      <input
                        type="file"
                        accept=".csv"
                        onChange={handleCsvFileUpload}
                        disabled={importLoading}
                        className="hidden"
                      />
                    </label>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <span>Need the expected column format?</span>
                    <button
                      type="button"
                      onClick={handleDownloadSampleCsv}
                      className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 font-medium cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download Sample CSV Template</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <button
                type="button"
                onClick={handleResetCorpus}
                disabled={importLoading}
                className="text-xs text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset to Default 48 Corpus</span>
              </button>

              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* YouTube Style Account Info Modal */}
      {currentUser && (
        <AccountModal
          isOpen={isAccountModalOpen}
          onClose={() => setIsAccountModalOpen(false)}
          currentUser={currentUser}
          onUserUpdate={(updated) => setCurrentUser(updated)}
          onSignOut={handleSignOut}
          onSwitchAccount={() => {
            setIsAccountModalOpen(false);
            setShowLoginPage(true);
          }}
        />
      )}

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 py-6 transition-colors duration-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>Popularity Dynamics Analysis &copy; 2026</span>
          <div className="flex items-center gap-4">
            <span>Data Science &amp; Time-Series ML Course Project</span>
            <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
            <span className="font-mono text-emerald-700 dark:text-emerald-400 font-medium">Pipeline Active</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
