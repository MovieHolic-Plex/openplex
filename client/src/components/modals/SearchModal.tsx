import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Loader2, Play, Star, Check } from 'lucide-react';
import type { MediaItem } from '@openplex/shared';
import { api } from '../../api/client';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectItem: (item: MediaItem) => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
  onSelectItem,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
      setResults([]);
    }
  }, [isOpen]);

  // Debounced search logic (300ms)
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const handler = setTimeout(async () => {
      try {
        const data = await api.search(query);
        setResults(data.items);
      } catch (err) {
        console.error('Search failed', err);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(handler);
  }, [query]);

  // Keyboard escape handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 px-4 bg-zinc-950/80 backdrop-blur-xl animate-in fade-in duration-200">
      {/* Click outside to close backdrop */}
      <div className="fixed inset-0" onClick={onClose} />

      {/* Modal Card */}
      <div className="relative w-full max-w-3xl bg-zinc-900/95 border border-zinc-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh] z-10">
        {/* Search Bar Input */}
        <div className="flex items-center px-4 sm:px-6 py-4 border-b border-zinc-800 bg-zinc-950/40">
          <Search className="w-5 h-5 text-amber-400 mr-3 flex-none" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles, actors, or directors..."
            className="w-full bg-transparent text-white placeholder-zinc-500 text-base sm:text-lg focus:outline-none"
          />
          {loading && <Loader2 className="w-5 h-5 text-amber-500 animate-spin mr-3 flex-none" />}
          {query && !loading && (
            <button
              onClick={() => setQuery('')}
              className="p-1 rounded-md text-zinc-400 hover:text-white mr-2"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onClose}
            className="px-2.5 py-1 text-xs font-semibold text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg border border-zinc-700 transition"
          >
            ESC
          </button>
        </div>

        {/* Results Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
          {query.trim() === '' ? (
            <div className="py-12 text-center text-zinc-500 text-sm">
              Type keywords above to search across movies, dramas, and anime.
            </div>
          ) : !loading && results.length === 0 ? (
            <div className="py-12 text-center text-zinc-400 text-sm">
              No results found for "<span className="text-zinc-200">{query}</span>"
            </div>
          ) : (
            <div className="space-y-2.5">
              {results.map((item) => (
                <div
                  key={item.id}
                  onClick={() => {
                    onSelectItem(item);
                    onClose();
                  }}
                  className="flex items-center gap-4 p-2.5 rounded-xl hover:bg-zinc-800/80 cursor-pointer transition border border-transparent hover:border-zinc-700/60 group"
                >
                  {/* Poster thumbnail */}
                  <div className="relative w-12 sm:w-14 aspect-[2/3] rounded-lg overflow-hidden bg-zinc-800 flex-none">
                    {item.posterPath ? (
                      <img
                        src={item.posterPath}
                        alt={item.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-500">
                        N/A
                      </div>
                    )}

                    {/* Watched circular badge */}
                    {item.watchState?.watched && (
                      <div
                        data-testid="search-watched-badge"
                        className="absolute top-1 right-1 w-4 h-4 rounded-full bg-amber-500 text-zinc-950 flex items-center justify-center shadow-md shadow-black/80 pointer-events-none"
                      >
                        <Check className="w-2.5 h-2.5 stroke-[3]" />
                      </div>
                    )}

                    {/* Progress indicator */}
                    {!item.watchState?.watched &&
                      typeof item.watchState?.progress === 'number' &&
                      Number.isFinite(item.watchState.progress) &&
                      item.watchState.progress > 0 &&
                      item.watchState.progress < 0.9 && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-zinc-800/90 pointer-events-none">
                          <div
                            className="h-full bg-amber-500"
                            style={{
                              width: `${Math.max(0, Math.min(100, Math.round(item.watchState.progress * 100)))}%`,
                            }}
                          />
                        </div>
                      )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] font-bold text-zinc-300 uppercase border border-zinc-700/50">
                        {item.mediaType}
                      </span>
                      {item.voteAverage && (
                        <span className="flex items-center gap-0.5 text-xs text-amber-400 font-semibold">
                          <Star className="w-3 h-3 fill-amber-400" />
                          {item.voteAverage.toFixed(1)}
                        </span>
                      )}
                      {item.releaseDate && (
                        <span className="text-xs text-zinc-500">{item.releaseDate}</span>
                      )}
                    </div>
                    <h4 className="text-sm font-bold text-zinc-100 group-hover:text-amber-400 transition truncate">
                      {item.title}
                    </h4>
                    {item.overview && (
                      <p className="text-xs text-zinc-400 line-clamp-1 mt-0.5">
                        {item.overview}
                      </p>
                    )}
                  </div>

                  {/* Play Action */}
                  <div className="flex-none pr-2 opacity-0 group-hover:opacity-100 transition">
                    <div className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center text-zinc-950 shadow-md">
                      <Play className="w-4 h-4 fill-zinc-950 translate-x-0.5" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
