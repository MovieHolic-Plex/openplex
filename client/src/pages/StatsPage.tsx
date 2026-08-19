import React, { useEffect, useState } from 'react';
import { BarChart3, Clock3, Film, Loader2, Trophy, Tv, TrendingUp, Sparkles } from 'lucide-react';
import { api, type ProfileStats } from '../api/client';

const EMPTY_STATS: ProfileStats = {
  totalWatchSeconds: 0,
  seriesCount: 0,
  movieCount: 0,
  topSeries: [],
  daily: [],
};

function formatDuration(totalSeconds: number): string {
  const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : 0;
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (hours === 0) return `${minutes}분`;
  return minutes === 0 ? `${hours}시간` : `${hours}시간 ${minutes}분`;
}

function formatDay(date: string): string {
  const [, month, day] = date.split('-');
  return month && day ? `${Number(month)}/${Number(day)}` : date;
}

interface MetricCardProps {
  label: string;
  value: string;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
  highlight?: boolean;
}

const MetricCard: React.FC<MetricCardProps> = ({ label, value, detail, icon: Icon, highlight }) => (
  <article className={`relative overflow-hidden rounded-2xl border p-5 sm:p-6 transition-all duration-200 ${
    highlight
      ? 'border-amber-500/30 bg-gradient-to-b from-amber-500/10 via-zinc-900/80 to-zinc-950 shadow-xl shadow-amber-500/5'
      : 'border-zinc-800 bg-zinc-900/50 hover:bg-zinc-900/80 shadow-lg shadow-black/20'
  }`}>
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">{label}</p>
        <p className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight text-white">{value}</p>
        <p className="text-xs text-zinc-500 font-medium">{detail}</p>
      </div>
      <span className={`rounded-xl p-3 ring-1 ${
        highlight
          ? 'bg-amber-500/20 text-amber-400 ring-amber-500/40 shadow-sm'
          : 'bg-zinc-800 text-zinc-300 ring-zinc-700/60'
      }`}>
        <Icon className="h-5 w-5" />
      </span>
    </div>
  </article>
);

export const StatsPage: React.FC = () => {
  const [stats, setStats] = useState<ProfileStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadStats() {
      const profileId = api.getActiveProfileId();
      if (profileId === null) {
        setStats(EMPTY_STATS);
        setLoading(false);
        return;
      }

      try {
        const response = await api.getProfileStats(profileId);
        if (!cancelled) setStats(response);
      } catch (caught) {
        if (!cancelled) {
          setStats(EMPTY_STATS);
          setError(caught instanceof Error ? caught.message : '통계를 불러오지 못했습니다');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadStats();
    return () => {
      cancelled = true;
    };
  }, []);

  const maxDailySeconds = Math.max(0, ...stats.daily.map((day) => day.watchSeconds));

  return (
    <div className="mx-auto min-h-screen max-w-7xl bg-zinc-950 px-4 pb-20 pt-24 text-zinc-100 sm:px-6 lg:px-8">
      {/* Header Section */}
      <div className="border-b border-zinc-800/80 pb-6 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-amber-400">
            <BarChart3 className="h-3.5 w-3.5" />
            <span>Watch Insights & Activity</span>
          </div>
          <h1 className="mt-1.5 text-3xl sm:text-4xl font-black tracking-tight text-white">시청 통계</h1>
          <p className="mt-1 text-xs sm:text-sm text-zinc-400">현재 프로필의 재생 진행도 및 시청 이력을 기반으로 집계된 데이터입니다.</p>
        </div>

        {!loading && (
          <div className="flex items-center gap-2 self-start md:self-auto rounded-xl border border-zinc-800 bg-zinc-900/60 px-3.5 py-1.5 text-xs text-zinc-400 backdrop-blur-sm">
            <Sparkles className="h-3.5 w-3.5 text-amber-400" />
            <span>실시간 자동 동기화</span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-28 gap-3" aria-label="통계 불러오는 중">
          <Loader2 className="h-9 w-9 animate-spin text-amber-500" />
          <p className="text-xs text-zinc-500 font-medium">시청 데이터를 분석하는 중...</p>
        </div>
      ) : (
        <>
          {error && (
            <p role="alert" className="mt-6 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </p>
          )}

          {/* Metric Cards Grid */}
          <section className="mt-8 grid gap-4 sm:grid-cols-3" aria-label="주요 시청 통계">
            <MetricCard
              label="총 시청시간"
              value={formatDuration(stats.totalWatchSeconds)}
              detail="누적 추정 시청 진행량"
              icon={Clock3}
              highlight={stats.totalWatchSeconds > 0}
            />
            <MetricCard
              label="시리즈 수"
              value={`${stats.seriesCount}`}
              detail="시청 기록이 있는 드라마/애니"
              icon={Tv}
            />
            <MetricCard
              label="영화 수"
              value={`${stats.movieCount}`}
              detail="시청 기록이 있는 영화"
              icon={Film}
            />
          </section>

          {/* Chart & Top Series Grid */}
          <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1.2fr)]">
            {/* Daily Chart Card */}
            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-6 backdrop-blur-sm" aria-labelledby="daily-stats-title">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-amber-400" />
                    <h2 id="daily-stats-title" className="text-lg font-bold text-white">최근 7일 시청 추이</h2>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">일별 시청 시간 통계</p>
                </div>
                {maxDailySeconds > 0 && (
                  <span className="text-xs font-mono font-medium text-amber-400/90 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-lg">
                    최고 {formatDuration(maxDailySeconds)}
                  </span>
                )}
              </div>

              {stats.daily.length === 0 ? (
                <div className="flex min-h-60 flex-col items-center justify-center text-center p-6 border border-dashed border-zinc-800/80 rounded-xl mt-6">
                  <Clock3 className="h-8 w-8 text-zinc-700 mb-2" />
                  <p className="text-sm font-medium text-zinc-400">최근 시청 이력이 없습니다</p>
                  <p className="text-xs text-zinc-600 mt-1">콘텐츠를 시청하면 일별 그래프가 생성됩니다.</p>
                </div>
              ) : (
                <div className="mt-8 flex h-60 items-end gap-2 sm:gap-4 px-1" data-testid="stats-daily-chart">
                  {stats.daily.map((day) => {
                    const heightPercent = maxDailySeconds > 0
                      ? Math.max(4, (day.watchSeconds / maxDailySeconds) * 100)
                      : 4;
                    const isPeak = maxDailySeconds > 0 && day.watchSeconds === maxDailySeconds;
                    return (
                      <div key={day.date} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
                        <span className={`text-[10px] font-mono transition-opacity sm:text-xs ${
                          day.watchSeconds > 0 ? (isPeak ? 'font-bold text-amber-400' : 'text-zinc-400') : 'text-zinc-600 opacity-60'
                        }`}>
                          {formatDuration(day.watchSeconds)}
                        </span>
                        <div className="flex h-44 w-full items-end justify-center rounded-xl bg-zinc-950/80 p-1.5 border border-zinc-800/60 group-hover:border-zinc-700 transition">
                          <div
                            className={`w-full max-w-10 sm:max-w-12 rounded-t-lg transition-all duration-300 ${
                              day.watchSeconds > 0
                                ? isPeak
                                  ? 'bg-gradient-to-t from-amber-600 to-amber-400 shadow-lg shadow-amber-500/20 ring-1 ring-amber-400/40'
                                  : 'bg-amber-500/80 hover:bg-amber-400'
                                : 'bg-zinc-800/60'
                            }`}
                            style={{ height: `${heightPercent}%` }}
                            title={`${day.date}: ${formatDuration(day.watchSeconds)}`}
                            data-testid="stats-daily-bar"
                            data-watch-seconds={day.watchSeconds}
                          />
                        </div>
                        <span className={`whitespace-nowrap text-[10px] font-medium sm:text-xs ${
                          isPeak ? 'text-amber-400 font-bold' : 'text-zinc-400'
                        }`}>
                          {formatDay(day.date)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Top Series Card */}
            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-6 backdrop-blur-sm flex flex-col" aria-labelledby="top-series-title">
              <div className="flex items-center gap-2">
                <Trophy className="h-4 w-4 text-amber-400" />
                <h2 id="top-series-title" className="text-lg font-bold text-white">TOP 5 최다 시청 시리즈</h2>
              </div>
              <p className="mt-1 text-xs text-zinc-500">재생 시간이 가장 긴 시리즈 순위</p>

              {stats.topSeries.length === 0 ? (
                <div className="flex flex-1 min-h-56 flex-col items-center justify-center text-center p-6 border border-dashed border-zinc-800/80 rounded-xl mt-6">
                  <div className="rounded-full bg-zinc-900 p-3 border border-zinc-800">
                    <Tv className="h-6 w-6 text-zinc-600" />
                  </div>
                  <p className="mt-3 text-sm font-medium text-zinc-400">아직 시청 기록이 없습니다</p>
                  <p className="mt-1 text-xs text-zinc-600">시리즈를 감상하면 순위가 집계됩니다.</p>
                </div>
              ) : (
                <ol className="mt-6 space-y-2.5 flex-1">
                  {stats.topSeries.map((series, index) => {
                    const isRank1 = index === 0;
                    return (
                      <li
                        key={`${series.category}-${series.id}`}
                        className={`flex items-center gap-3 rounded-xl p-3 border transition-colors ${
                          isRank1
                            ? 'bg-amber-500/10 border-amber-500/30'
                            : 'bg-zinc-950/60 border-zinc-800/80 hover:border-zinc-700'
                        }`}
                      >
                        <span className={`flex h-7 w-7 flex-none items-center justify-center rounded-lg text-xs font-black ${
                          isRank1
                            ? 'bg-amber-500 text-zinc-950 shadow-sm'
                            : 'bg-zinc-800 text-zinc-300'
                        }`}>
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-200">
                          {series.title}
                        </span>
                        <span className="flex-none font-mono text-xs font-medium text-amber-400/90">
                          {formatDuration(series.watchSeconds)}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
};
