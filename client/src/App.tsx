import React, { useState, useEffect, useCallback } from 'react';
import { Header, type NavTab } from './components/layout/Header';
import { HomePage } from './pages/HomePage';
import { BrowsePage } from './pages/BrowsePage';
import { MyListPage } from './pages/MyListPage';
import { StatsPage } from './pages/StatsPage';
import { ComicsPage } from './pages/ComicsPage';
import { LibraryPage } from './pages/LibraryPage';
import { SearchModal } from './components/modals/SearchModal';
import { TitleDetailModal } from './components/modals/TitleDetailModal';
import { ProfilePicker } from './components/modals/ProfilePicker';
import { SubtitleSettingsModal } from './components/modals/SubtitleSettingsModal';
import { ServerSettingsModal } from './components/modals/ServerSettingsModal';
import { DownloadManagerModal } from './components/modals/DownloadManagerModal';
import { AgentDrawer } from './components/AgentDrawer';
import { Player } from './components/Player';
import type { MediaItem, Episode, SubtitleTrack, WatchHistoryItem } from '@openplex/shared';
import {
  api,
  DEFAULT_SUBTITLE_STYLE,
  withAuthToken,
  type LocalDownloadItem,
  type NextUpItem,
  type ProfileItem,
  type SubtitleStyle,
} from './api/client';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);

  // Profile management state
  const [profiles, setProfiles] = useState<ProfileItem[]>([]);
  const [currentProfile, setCurrentProfile] = useState<ProfileItem | null>(null);
  const [profilePickerOpen, setProfilePickerOpen] = useState(false);
  const [subtitleSettingsOpen, setSubtitleSettingsOpen] = useState(false);
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [serverSettingsOpen, setServerSettingsOpen] = useState(false);
  const [visitor, setVisitor] = useState(false);
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>(DEFAULT_SUBTITLE_STYLE);
  const [appKey, setAppKey] = useState(0); // key to trigger fresh reload of sub-components upon profile switch

  // Player state
  const [activePlayback, setActivePlayback] = useState<{
    item: MediaItem;
    episode: Episode;
    src: string;
    fileUrl?: string;
    sessionId: string;
    subtitles: SubtitleTrack[];
    nextEpisode: { idx?: number; title?: string } | null;
    resume?: { position: number; duration: number };
  } | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  const fetchProfilesAndSync = useCallback(async (skipPicker = false) => {
    try {
      const items = await api.getProfiles();
      setProfiles(items);
      const activeId = api.getActiveProfileId();
      if (activeId !== null) {
        const found = items.find((p) => p.id === activeId);
        if (found) {
          setCurrentProfile(found);
          setProfilePickerOpen(false);
        } else {
          // Stale profile ID in storage not in DB
          api.setActiveProfileId(null);
          setCurrentProfile(null);
          setProfilePickerOpen(true);
        }
      } else {
        setCurrentProfile(null);
        setProfilePickerOpen(!skipPicker);
      }
    } catch (err) {
      console.error('Failed to load profiles on init', err);
    }
  }, []);

  // Settings-first boot: visitors (public library, no token) skip the
  // profile picker entirely and browse with the guest identity.
  useEffect(() => {
    let current = true;
    void api.getSettings()
      .then((settings) => {
        if (!current) return;
        setVisitor(settings.visitor);
        if (settings.visitor) setActiveTab('library');
        return fetchProfilesAndSync(!settings.visitor);
      })
      .catch((cause: unknown) => {
        if (current) {
          console.warn('Failed to load settings on init', cause);
          void fetchProfilesAndSync();
        }
      });
    return () => {
      current = false;
    };
  }, [fetchProfilesAndSync]);

  useEffect(() => {
    if (!currentProfile) {
      setSubtitleStyle(DEFAULT_SUBTITLE_STYLE);
      return;
    }

    let current = true;
    void api.getSubtitleStyle(currentProfile.id)
      .then((style) => {
        if (current) setSubtitleStyle(style);
      })
      .catch((error: unknown) => console.warn('Failed to load subtitle style', error));
    return () => {
      current = false;
    };
  }, [currentProfile]);

  const handleSelectProfile = (profile: ProfileItem) => {
    api.setActiveProfileId(profile.id);
    setCurrentProfile(profile);
    setProfilePickerOpen(false);
    // Clear transient state
    setActivePlayback(null);
    setSelectedItem(null);
    setDetailModalOpen(false);
    setSearchOpen(false);
    setStreamError(null);
    setAppKey((prev) => prev + 1);
    void fetchProfilesAndSync();
  };

  const handleSwitchProfile = (profile: ProfileItem) => {
    handleSelectProfile(profile);
  };

  // Global keyboard shortcut for search ('/' key)
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && !searchOpen && !activePlayback && !profilePickerOpen && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchOpen, activePlayback, profilePickerOpen]);

  const handleSelectItem = (item: MediaItem) => {
    setSelectedItem(item);
    setDetailModalOpen(true);
  };

  const categoryFor = (item: MediaItem) =>
    item.category
      ?? (item.mediaType === 'movie' ? 'movie' : item.mediaType === 'anime' ? 'animation' : 'drama');

  const startPlayback = async (
    item: MediaItem,
    episode: Episode,
    resume?: { position: number; duration: number },
  ) => {
    setStreamError(null);
    try {
      const stream = await api.createStream(categoryFor(item), item.id, episode.episodeNumber);
      setDetailModalOpen(false);
      setActivePlayback({
        item,
        episode,
        src: withAuthToken(stream.playlistUrl),
        fileUrl: stream.fileUrl ? withAuthToken(stream.fileUrl) : undefined,
        sessionId: stream.sessionId,
        subtitles: stream.subtitles.map((track) => ({ ...track, url: withAuthToken(track.url) })),
        nextEpisode: (stream.nextEpisode as { idx?: number; title?: string } | null) ?? null,
        resume,
      });
    } catch (error) {
      setStreamError(error instanceof Error ? error.message : 'Unable to create stream');
    }
  };

  const handlePlayItem = (item: MediaItem) => {
    void (async () => {
      setStreamError(null);
      try {
        // Episode ids on this provider are opaque (e.g. 406773715), never 1..N:
        // resolve the real first episode from the title detail before streaming.
        const detail = await api.getTitleDetail(item.id, categoryFor(item));
        const first = detail.episodes[0];
        if (!first) {
          setStreamError('No playable episode found for this title');
          return;
        }
        await startPlayback(item, first);
      } catch (error) {
        setStreamError(error instanceof Error ? error.message : 'Unable to create stream');
      }
    })();
  };

  const handlePlayEpisode = (episode: Episode, item: MediaItem) => {
    void startPlayback(item, episode);
  };

  const handleResumeItem = (entry: WatchHistoryItem) => {
    const epIdx = entry.episodeNumber;
    if (epIdx === undefined) return;
    void startPlayback(entry.mediaItem, {
      id: `${entry.mediaId}-${epIdx}`,
      mediaId: entry.mediaId,
      seasonNumber: entry.seasonNumber ?? 1,
      episodeNumber: epIdx,
      title: entry.episodeTitle ?? `Episode ${epIdx}`,
      stillPath: entry.mediaItem.backdropPath ?? entry.mediaItem.posterPath,
    }, {
      position: entry.progressSeconds,
      duration: entry.durationSeconds,
    });
  };

  const playEpisode = (category: string, id: number, epIdx: number, title: string, thumb?: string) => {
    void (async () => {
      setStreamError(null);
      try {
        // epIdx is an opaque provider identifier supplied by Next Up. Stream it directly;
        // resolving title details here would select the wrong episode and add an upstream call.
        const stream = await api.createStream(category, id, epIdx);
        const item: MediaItem = {
          id: String(id),
          category,
          title,
          posterPath: thumb,
          backdropPath: thumb,
          mediaType: category === 'movie' ? 'movie' : category === 'animation' ? 'anime' : 'tv',
        };
        const episode: Episode = {
          id: `${id}-${epIdx}`,
          mediaId: String(id),
          seasonNumber: 1,
          episodeNumber: epIdx,
          title: stream.title,
          stillPath: thumb,
        };
        setDetailModalOpen(false);
        setActivePlayback({
          item,
          episode,
          src: withAuthToken(stream.playlistUrl),
          fileUrl: stream.fileUrl ? withAuthToken(stream.fileUrl) : undefined,
          sessionId: stream.sessionId,
          subtitles: stream.subtitles.map((track) => ({ ...track, url: withAuthToken(track.url) })),
          nextEpisode: (stream.nextEpisode as { idx?: number; title?: string } | null) ?? null,
        });
      } catch (error) {
        setStreamError(error instanceof Error ? error.message : 'Unable to create stream');
      }
    })();
  };

  const handlePlayNextUp = (nextUp: NextUpItem) => {
    playEpisode(
      nextUp.category,
      nextUp.id,
      nextUp.epIdx,
      nextUp.seriesTitle,
      nextUp.thumb || nextUp.seriesThumb,
    );
  };

  const handleNextEpisode = () => {
    if (!activePlayback) return;
    const { item, episode, nextEpisode } = activePlayback;
    // Upstream supplies the real next-episode id (opaque, non-sequential).
    if (nextEpisode && typeof nextEpisode.idx === 'number') {
      void startPlayback(item, {
        id: `${item.id}-${nextEpisode.idx}`,
        mediaId: item.id,
        seasonNumber: episode.seasonNumber || 1,
        episodeNumber: nextEpisode.idx,
        title: nextEpisode.title || `Episode ${nextEpisode.idx}`,
      });
      return;
    }
    setStreamError('마지막 화입니다');
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 selection:bg-amber-500 selection:text-black antialiased font-sans">
      {/* Shell Header */}
      <Header
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onOpenSearch={() => setSearchOpen(true)}
        currentProfile={currentProfile}
        profiles={profiles}
        onSwitchProfile={handleSwitchProfile}
        onManageProfiles={() => setProfilePickerOpen(true)}
        onOpenSubtitleSettings={() => setSubtitleSettingsOpen(true)}
        onOpenDownloads={() => setDownloadsOpen(true)}
        onOpenAgent={() => setAgentOpen(true)}
        onOpenServerSettings={() => setServerSettingsOpen(true)}
        visitor={visitor}
      />

      {/* Main Pages Router with key to force fresh fetch on profile switch */}
      <main key={appKey} className="w-full">
        {activeTab === 'library' && (
          <LibraryPage
            visitor={visitor}
            onOpenServerSettings={() => setServerSettingsOpen(true)}
            onPlayVideo={(spec) => {
              playEpisode(spec.category, spec.id, spec.epIdx, spec.title, spec.thumb);
            }}
            onPlayLocal={({ fileUrl, title }) => {
              setActivePlayback({
                item: { id: 'local', title, mediaType: 'movie' },
                episode: { id: '0', mediaId: 'local', seasonNumber: 1, episodeNumber: 1, title },
                src: fileUrl,
                fileUrl,
                sessionId: 'local',
                subtitles: [],
                nextEpisode: null,
              });
            }}
          />
        )}

        {activeTab === 'home' && (
          <HomePage
            onSelectItem={handleSelectItem}
            onPlayItem={handlePlayItem}
            onResumeItem={handleResumeItem}
            onPlayNextUp={handlePlayNextUp}
            onNavigateTab={(tab) => {
              setActiveTab(tab);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        )}

        {activeTab === 'drama' && (
          <BrowsePage
            category="drama"
            onSelectItem={handleSelectItem}
            onPlayItem={handlePlayItem}
          />
        )}

        {activeTab === 'movie' && (
          <BrowsePage
            category="movie"
            onSelectItem={handleSelectItem}
            onPlayItem={handlePlayItem}
          />
        )}

        {activeTab === 'animation' && (
          <BrowsePage
            category="animation"
            onSelectItem={handleSelectItem}
            onPlayItem={handlePlayItem}
          />
        )}

        {activeTab === 'mylist' && (
          <MyListPage
            onSelectItem={handleSelectItem}
            onPlayItem={handlePlayItem}
          />
        )}

        {activeTab === 'comics' && <ComicsPage />}

        {activeTab === 'stats' && <StatsPage />}
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-900 bg-zinc-950 py-10 px-4 text-center text-xs text-zinc-600">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-bold text-zinc-400">보관함</span>
            <span>•</span>
            <span>Korean media library</span>
          </div>
          <p>© 2026 OpenPlex Web Client. Pure streaming & catalog experience.</p>
        </div>
      </footer>

      {/* Profile Picker Overlay (First-visit gate or manage modal) */}
      <ProfilePicker
        isOpen={profilePickerOpen}
        onSelectProfile={handleSelectProfile}
        onClose={() => setProfilePickerOpen(false)}
        canClose={currentProfile !== null}
      />

      <SubtitleSettingsModal
        isOpen={subtitleSettingsOpen}
        profile={currentProfile}
        onClose={() => setSubtitleSettingsOpen(false)}
        onSaved={setSubtitleStyle}
      />

      <ServerSettingsModal
        isOpen={serverSettingsOpen}
        onClose={() => setServerSettingsOpen(false)}
      />

      <AgentDrawer
        isOpen={agentOpen}
        onClose={() => setAgentOpen(false)}
        onEnqueueUnit={(unitId) => {
          void api.enqueueDownloadByUnit(unitId).catch((cause: unknown) => {
            setStreamError(cause instanceof Error ? cause.message : '받기를 시작하지 못했습니다.');
          });
        }}
      />

      <DownloadManagerModal
        isOpen={downloadsOpen}
        onClose={() => setDownloadsOpen(false)}
        onPlay={(item: LocalDownloadItem) => {
          setDownloadsOpen(false);
          playEpisode(item.category, item.id, item.epIdx, item.title, item.thumb);
        }}
      />

      {/* Search Overlay Modal */}
      <SearchModal
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelectItem={(item) => {
          handleSelectItem(item);
        }}
      />

      {/* Title Details & Episodes Modal */}
      <TitleDetailModal
        item={selectedItem}
        isOpen={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
        onPlayEpisode={handlePlayEpisode}
      />

      {streamError && (
        <div role="alert" className="fixed bottom-6 right-6 z-50 rounded-lg bg-red-950 px-4 py-3 text-sm text-red-100">
          {streamError}
        </div>
      )}

      {/* Fullscreen Video Player */}
      {activePlayback && (
        <Player
          src={activePlayback.src}
          fileUrl={activePlayback.fileUrl}
          sessionId={activePlayback.sessionId}
          subtitles={activePlayback.subtitles}
          subtitleStyle={subtitleStyle}
          resume={activePlayback.resume}
          title={activePlayback.item.title}
          episodeTitle={activePlayback.episode.title}
          category={categoryFor(activePlayback.item)}
          mediaId={activePlayback.item.id}
          epIdx={activePlayback.episode.episodeNumber}
          thumb={activePlayback.episode.stillPath || activePlayback.item.posterPath}
          autoPlay={true}
          nextEpisode={
            activePlayback.nextEpisode && typeof activePlayback.nextEpisode.idx === 'number'
              ? {
                  id: `${activePlayback.item.id}-${activePlayback.nextEpisode.idx}`,
                  mediaId: activePlayback.item.id,
                  seasonNumber: activePlayback.episode.seasonNumber || 1,
                  episodeNumber: activePlayback.nextEpisode.idx,
                  title: activePlayback.nextEpisode.title || `Episode ${activePlayback.nextEpisode.idx}`,
                }
              : undefined
          }
          onNextEpisode={handleNextEpisode}
          onClose={() => setActivePlayback(null)}
        />
      )}
    </div>
  );
}
