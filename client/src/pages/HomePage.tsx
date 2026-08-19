import React, { useState, useEffect } from 'react';
import { HeroBanner } from '../components/home/HeroBanner';
import { NextUpShelf } from '../components/home/NextUpShelf';
import { ContinueWatchingShelf } from '../components/home/ContinueWatchingShelf';
import { MediaShelf } from '../components/home/MediaShelf';
import { api, type NextUpItem } from '../api/client';
import type { MediaItem, WatchHistoryItem } from '@openplex/shared';
import type { NavTab } from '../components/layout/Header';

interface HomePageProps {
  onSelectItem: (item: MediaItem) => void;
  onPlayItem: (item: MediaItem) => void;
  onResumeItem: (item: WatchHistoryItem) => void;
  onPlayNextUp: (item: NextUpItem) => void;
  onNavigateTab: (tab: NavTab) => void;
}

export const HomePage: React.FC<HomePageProps> = ({
  onSelectItem,
  onPlayItem,
  onResumeItem,
  onPlayNextUp,
  onNavigateTab,
}) => {
  const [heroItems, setHeroItems] = useState<MediaItem[]>([]);
  const [nextUp, setNextUp] = useState<NextUpItem[]>([]);
  const [continueWatching, setContinueWatching] = useState<WatchHistoryItem[]>([]);
  const [sections, setSections] = useState<{ id: string; title: string; category: string; items: MediaItem[] }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      try {
        const home = await api.getHome();
        if (isMounted) {
          setHeroItems(home.heroItems);
          setNextUp(home.nextUp);
          setContinueWatching(home.continueWatching);
          setSections(home.sections);
        }
      } catch (e) {
        console.error('Failed to load home data', e);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadData();
    return () => {
      isMounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-amber-500/20 border-t-amber-500 rounded-full animate-spin" />
          <p className="text-xs font-semibold text-zinc-400 tracking-wider uppercase">Loading OpenPlex...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 pb-20">
      {/* Dynamic Blurred Backdrop Hero */}
      <HeroBanner
        items={heroItems}
        onPlay={onPlayItem}
        onMoreInfo={onSelectItem}
      />

      {/* Main Stream Content Sections */}
      <div className="relative -mt-6 sm:-mt-10 z-20 space-y-6">
        {/* Next Up is intentionally the first home shelf. */}
        <NextUpShelf items={nextUp} onPlay={onPlayNextUp} />

        {/* Continue Watching Section */}
        {continueWatching.length > 0 && (
          <ContinueWatchingShelf
            items={continueWatching}
            onSelect={(entry) => onSelectItem(entry.mediaItem)}
            onPlay={onResumeItem}
          />
        )}

        {/* Dynamic Media Shelves */}
        {sections.map((section) => (
          <MediaShelf
            key={section.id}
            title={section.title}
            items={section.items}
            onSelect={onSelectItem}
            onPlay={onPlayItem}
            onViewAll={() => onNavigateTab(section.category as NavTab)}
          />
        ))}
      </div>
    </div>
  );
};
