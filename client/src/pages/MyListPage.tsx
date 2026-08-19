import React, { useState, useEffect } from 'react';
import { Bookmark } from 'lucide-react';
import type { BookmarkItem, MediaItem } from '@openplex/shared';
import { api } from '../api/client';
import { MediaCard } from '../components/common/MediaCard';

interface MyListPageProps {
  onSelectItem: (item: MediaItem) => void;
  onPlayItem: (item: MediaItem) => void;
}

export const MyListPage: React.FC<MyListPageProps> = ({
  onSelectItem,
  onPlayItem,
}) => {
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadBookmarks() {
      try {
        const items = await api.getBookmarks();
        setBookmarks(items);
      } catch (e) {
        console.error('Failed to load bookmarks', e);
      } finally {
        setLoading(false);
      }
    }
    loadBookmarks();
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 pt-24 pb-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="pb-6 border-b border-zinc-800/80">
        <div className="flex items-center gap-2 text-xs font-bold text-amber-500 uppercase tracking-widest">
          <Bookmark className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
          <span>Saved Collection</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white mt-1">
          My List
        </h1>
        <p className="text-xs text-zinc-400 mt-1">
          {bookmarks.length} saved titles ready to stream anytime
        </p>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="py-20 flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-amber-500/20 border-t-amber-500 rounded-full animate-spin" />
        </div>
      ) : bookmarks.length === 0 ? (
        <div className="py-24 text-center max-w-md mx-auto">
          <div className="w-12 h-12 rounded-full bg-zinc-900 flex items-center justify-center mx-auto mb-4 border border-zinc-800">
            <Bookmark className="w-6 h-6 text-zinc-600" />
          </div>
          <h3 className="text-lg font-bold text-zinc-200">Your List is Empty</h3>
          <p className="text-xs text-zinc-500 mt-1">
            Add dramas, movies, and animations to your list to keep track of what you want to watch.
          </p>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6">
          {bookmarks.map((bm) => (
            <div key={bm.id} className="flex justify-center">
              <MediaCard
                item={bm.mediaItem}
                onSelect={onSelectItem}
                onPlay={onPlayItem}
                aspect="poster"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
