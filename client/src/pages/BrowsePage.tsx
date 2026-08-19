import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Sparkles, Loader2, ArrowUpDown, Filter } from 'lucide-react';
import type { MediaItem } from '@openplex/shared';
import { api } from '../api/client';
import { CATEGORIES } from '../types';
import { MediaCard } from '../components/common/MediaCard';

type SortOrder = 'latest' | 'popular';
type CountryFilter = 'all' | 'korea' | 'overseas';

interface BrowsePageProps {
  category: string;
  onSelectItem: (item: MediaItem) => void;
  onPlayItem: (item: MediaItem) => void;
}

export const BrowsePage: React.FC<BrowsePageProps> = ({
  category,
  onSelectItem,
  onPlayItem,
}) => {
  const [activeCategory, setActiveCategory] = useState(category);
  const [rawItems, setRawItems] = useState<MediaItem[]>([]);
  const [sortOrder, setSortOrder] = useState<SortOrder>('latest');
  const [countryFilter, setCountryFilter] = useState<CountryFilter>('all');
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setActiveCategory(category);
  }, [category]);

  const loadData = useCallback(async (cat: string, targetPage: number, append: boolean = false) => {
    if (targetPage === 1) setLoading(true);
    else setLoadingMore(true);

    try {
      const res = await api.getCategoryItems(cat, targetPage);
      if (append) {
        setRawItems((prev) => [...prev, ...res.items]);
      } else {
        setRawItems(res.items);
      }
      setHasNext(res.hasNext);
      setPage(res.page);
    } catch (e) {
      console.error('Failed to load category items', e);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    loadData(activeCategory, 1, false);
  }, [activeCategory, loadData]);

  const items = useMemo(() => {
    // 1. Filter by country
    let filtered = rawItems;
    if (countryFilter === 'korea') {
      filtered = rawItems.filter((item) => {
        const country = item.country ? item.country.trim().toLowerCase() : '';
        return country === 'kr' || country === 'korea' || country === '한국';
      });
    } else if (countryFilter === 'overseas') {
      filtered = rawItems.filter((item) => {
        if (!item.country || !item.country.trim()) return false;
        const country = item.country.trim().toLowerCase();
        return country !== 'kr' && country !== 'korea' && country !== '한국';
      });
    } // 'all': includes items with null, undefined, empty string, or any country

    // 2. Sort items
    if (sortOrder === 'popular') {
      return [...filtered].sort((a, b) => {
        const popA = a.popularity ?? 0;
        const popB = b.popularity ?? 0;
        return popB - popA;
      });
    }

    // 'latest': preserves upstream/provider order
    return filtered;
  }, [rawItems, countryFilter, sortOrder]);

  // Infinite scroll trigger observer
  const observerRef = useRef<IntersectionObserver | null>(null);
  const lastElementRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (loading || loadingMore) return;
      if (observerRef.current) observerRef.current.disconnect();

      observerRef.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasNext) {
          loadData(activeCategory, page + 1, true);
        }
      });

      if (node) observerRef.current.observe(node);
    },
    [loading, loadingMore, hasNext, activeCategory, page, loadData]
  );

  const activeCategoryMeta =
    CATEGORIES.find((c) => c.id === activeCategory) || CATEGORIES[0];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 pt-24 pb-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      {/* Category Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-zinc-800/80">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-amber-500 uppercase tracking-widest">
            <Sparkles className="w-3.5 h-3.5" />
            <span>OpenPlex Catalog</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white mt-1">
            {activeCategoryMeta.nameKo} ({activeCategoryMeta.name})
          </h1>
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0 scrollbar-none">
          {CATEGORIES.map((cat) => {
            const isSelected = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`flex-none px-3.5 py-1.5 rounded-full text-xs font-semibold transition ${
                  isSelected
                    ? 'bg-amber-500 text-zinc-950 shadow-md shadow-amber-500/20'
                    : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border border-zinc-800'
                }`}
              >
                {cat.nameKo}
              </button>
            );
          })}
        </div>
      </div>

      {/* Sort and Filter Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 py-4 border-b border-zinc-800/40 text-sm">
        {/* Country Filter Chips */}
        <div className="flex items-center gap-2" data-testid="country-filter-group">
          <Filter className="w-4 h-4 text-zinc-500" />
          <span className="text-xs text-zinc-400 font-medium mr-1">국가:</span>
          <button
            type="button"
            onClick={() => setCountryFilter('all')}
            className={`px-3 py-1 rounded-full text-xs font-medium transition ${
              countryFilter === 'all'
                ? 'bg-zinc-100 text-zinc-950 font-semibold'
                : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border border-zinc-800'
            }`}
            data-testid="filter-country-all"
          >
            전체
          </button>
          <button
            type="button"
            onClick={() => setCountryFilter('korea')}
            className={`px-3 py-1 rounded-full text-xs font-medium transition ${
              countryFilter === 'korea'
                ? 'bg-zinc-100 text-zinc-950 font-semibold'
                : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border border-zinc-800'
            }`}
            data-testid="filter-country-korea"
          >
            한국
          </button>
          <button
            type="button"
            onClick={() => setCountryFilter('overseas')}
            className={`px-3 py-1 rounded-full text-xs font-medium transition ${
              countryFilter === 'overseas'
                ? 'bg-zinc-100 text-zinc-950 font-semibold'
                : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border border-zinc-800'
            }`}
            data-testid="filter-country-overseas"
          >
            해외
          </button>
        </div>

        {/* Sort Segment */}
        <div className="flex items-center gap-2" data-testid="sort-segment-group">
          <ArrowUpDown className="w-4 h-4 text-zinc-500" />
          <span className="text-xs text-zinc-400 font-medium mr-1">정렬:</span>
          <div className="inline-flex rounded-lg bg-zinc-900 p-0.5 border border-zinc-800">
            <button
              type="button"
              onClick={() => setSortOrder('latest')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition ${
                sortOrder === 'latest'
                  ? 'bg-amber-500 text-zinc-950 font-semibold shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              data-testid="sort-latest"
            >
              최신순
            </button>
            <button
              type="button"
              onClick={() => setSortOrder('popular')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition ${
                sortOrder === 'popular'
                  ? 'bg-amber-500 text-zinc-950 font-semibold shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              data-testid="sort-popular"
            >
              인기순
            </button>
          </div>
        </div>
      </div>

      {/* Grid Content */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center">
          <Loader2 className="w-8 h-8 text-amber-500 animate-spin mb-3" />
          <p className="text-xs text-zinc-400 font-medium">Fetching catalog content...</p>
        </div>
      ) : items.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-zinc-400 text-sm">No titles found matching your filter.</p>
        </div>
      ) : (
        <div
          data-testid="browse-grid"
          className="mt-8 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6"
        >
          {items.map((item, idx) => {
            const isLast = idx === items.length - 1;
            return (
              <div
                key={`${item.id}-${idx}`}
                ref={isLast ? lastElementRef : undefined}
                className="flex justify-center"
                data-testid="media-card-wrapper"
                data-item-id={item.id}
                data-item-title={item.title}
                data-item-country={item.country ?? ''}
                data-item-popularity={item.popularity ?? 0}
              >
                <MediaCard
                  item={item}
                  onSelect={onSelectItem}
                  onPlay={onPlayItem}
                  aspect="poster"
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Loading More Indicator */}
      {loadingMore && (
        <div className="py-10 flex items-center justify-center gap-2 text-xs text-zinc-400">
          <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />
          <span>Loading more titles...</span>
        </div>
      )}
    </div>
  );
};
