import React, { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Settings,
  Subtitles,
  ChevronLeft,
  X,
  Check,
  FastForward,
} from 'lucide-react';
import type { SubtitleTrack, Episode } from '@openplex/shared';
import { DEFAULT_SUBTITLE_STYLE, api, type SubtitleStyle } from '../api/client';
import { canResume } from '../utils/canResume';

export interface ResumeToastTimer {
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
}

const defaultResumeToastTimer: ResumeToastTimer = {
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (handle) => clearTimeout(handle),
};

export interface PlayerProps {
  src?: string;
  fileUrl?: string;
  sessionId?: string;
  subtitles?: SubtitleTrack[];
  subtitleStyle?: SubtitleStyle;
  resume?: { position: number; duration: number };
  resumeToastTimer?: ResumeToastTimer;
  title?: string;
  episodeTitle?: string;
  category?: string;
  mediaId?: string | number;
  epIdx?: number;
  thumb?: string;
  autoPlay?: boolean;
  nextEpisode?: Episode | null;
  onNextEpisode?: () => void;
  onClose?: () => void;
  onEnded?: () => void;
}

export const Player: React.FC<PlayerProps> = ({
  src,
  fileUrl,
  sessionId,
  subtitles = [],
  subtitleStyle = DEFAULT_SUBTITLE_STYLE,
  resume,
  resumeToastTimer = defaultResumeToastTimer,
  title = 'OpenPlex Media',
  episodeTitle,
  category = 'drama',
  mediaId = 1,
  epIdx = 1,
  thumb = '',
  autoPlay = true,
  nextEpisode,
  onNextEpisode,
  onClose,
  onEnded,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [resumeToast, setResumeToast] = useState(false);
  const resumeHandledRef = useRef(false);
  const resumeToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Quality & Subtitles
  const [qualityLevels, setQualityLevels] = useState<{ id: number; height: number; bitrate: number; name: string }[]>([]);
  const [currentQuality, setCurrentQuality] = useState<number>(-1); // -1 = Auto
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>(subtitles);
  const [currentSubtitle, setCurrentSubtitle] = useState<string>('off');

  // Menus
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-next countdown
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Format time (s -> HH:MM:SS or MM:SS)
  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const totalSecs = Math.floor(seconds);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Watch history reporting
  const reportHistory = useCallback((curTime: number, durTime: number) => {
    const rawId = typeof mediaId === 'string' ? parseInt(mediaId.replace(/\D/g, ''), 10) || 1 : mediaId;
    api.updateHistory({
      category,
      id: rawId,
      epIdx,
      title: episodeTitle ? `${title} - ${episodeTitle}` : title,
      thumb: thumb || '',
      position_sec: Math.max(0, Math.floor(curTime)),
      duration_sec: Math.max(0, Math.floor(durTime)),
      sessionId: sessionId || undefined,
    }).catch((err) => console.warn('[Player] Error reporting history:', err));
  }, [category, mediaId, epIdx, title, episodeTitle, thumb, sessionId]);

  // Keep a ref to the latest state for unmount history reporting
  const historyRef = useRef({ currentTime: 0, duration: 0, reportHistory });
  useEffect(() => {
    historyRef.current = { currentTime, duration, reportHistory };
  }, [currentTime, duration, reportHistory]);

  // Periodic history reporter (every 5 seconds)
  useEffect(() => {
    const interval = setInterval(() => {
      if (videoRef.current && !videoRef.current.paused) {
        reportHistory(videoRef.current.currentTime, videoRef.current.duration || 0);
      }
    }, 5000);

    return () => {
      clearInterval(interval);
      // Report on unmount
      const { currentTime: cTime, duration: dTime, reportHistory: reporter } = historyRef.current;
      if (cTime > 0) {
        reporter(cTime, dTime);
      }
    };
  }, [reportHistory]);

  // Progressive MP4 skips hls.js; HLS playlists keep the existing path.
  const streamUrl = (fileUrl && /\.mp4(?:\?|$)/i.test(fileUrl) ? fileUrl : null)
    || src
    || (sessionId ? `/hls/${sessionId}/master.m3u8` : '');

  // Subtitle list resolution (fetch from session if sessionId provided and no static tracks)
  useEffect(() => {
    if (subtitles && subtitles.length > 0) {
      setSubtitleTracks(subtitles);
    } else if (sessionId) {
      // Default standard subtitle track for session
      setSubtitleTracks([
        { id: 'sub-ko', language: 'ko', label: '한국어 (Korean)', url: `/hls/${sessionId}/subtitle/ko` },
        { id: 'sub-en', language: 'en', label: 'English', url: `/hls/${sessionId}/subtitle/en` },
      ]);
    }
  }, [subtitles, sessionId]);

  // Initialize HLS.js or native video. The metadata handler is installed before
  // either HLS or native source loading so an immediately available source cannot race it.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return;

    let hls: Hls | null = null;
    resumeHandledRef.current = false;
    setResumeToast(false);
    if (resumeToastTimeoutRef.current) resumeToastTimer.clearTimeout(resumeToastTimeoutRef.current);

    const handleLoadedMetadata = () => {
      if (resumeHandledRef.current) return;
      resumeHandledRef.current = true;
      if (resume && canResume(resume.position, resume.duration)) {
        video.currentTime = resume.position;
        setCurrentTime(resume.position);
        setResumeToast(true);
        resumeToastTimeoutRef.current = resumeToastTimer.setTimeout(() => {
          setResumeToast(false);
          resumeToastTimeoutRef.current = null;
        }, 5000);
      }
    };
    video.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });

    if (Hls.isSupported() && streamUrl.includes('.m3u8')) {
      const token = api.getAuthToken();
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
        xhrSetup: token
          ? (xhr) => {
              xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            }
          : undefined,
      });
      hlsRef.current = hls;

      hls.attachMedia(video);
      hls.loadSource(streamUrl);
      video.dataset.hlsAttached = 'true';

      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        const levels = data.levels.map((lvl, index) => ({
          id: index,
          height: lvl.height,
          bitrate: lvl.bitrate,
          name: lvl.name || `${lvl.height}p`,
        }));
        setQualityLevels(levels);

        if (autoPlay) {
          video.play().catch(() => setIsPlaying(false));
        }
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, () => {
        // level switched
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls?.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls?.recoverMediaError();
              break;
            default:
              hls?.destroy();
              break;
          }
        }
      });
    } else {
      video.src = streamUrl;
      video.dataset.hlsAttached = 'native';
      if (autoPlay) {
        video.play().catch(() => setIsPlaying(false));
      }
    }

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      delete video.dataset.hlsAttached;
      if (resumeToastTimeoutRef.current) resumeToastTimer.clearTimeout(resumeToastTimeoutRef.current);
      if (hls) {
        hls.destroy();
        hlsRef.current = null;
      }
    };
  }, [streamUrl, sessionId, autoPlay, resume, resumeToastTimer]);

  const dismissResumeToast = () => {
    setResumeToast(false);
    if (resumeToastTimeoutRef.current) resumeToastTimer.clearTimeout(resumeToastTimeoutRef.current);
  };

  const continueFromResume = () => {
    dismissResumeToast();
    videoRef.current?.play().catch(() => setIsPlaying(false));
  };

  const restartFromBeginning = () => {
    if (videoRef.current) videoRef.current.currentTime = 0;
    setCurrentTime(0);
    dismissResumeToast();
    videoRef.current?.play().catch(() => setIsPlaying(false));
  };

  // Video event handlers
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleDurationChange = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration || 0);
    }
  };

  const handlePlay = () => setIsPlaying(true);
  const handlePause = () => {
    // Only set to false if user or element genuinely paused
    setIsPlaying(false);
    if (videoRef.current) {
      reportHistory(videoRef.current.currentTime, videoRef.current.duration || 0);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    if (videoRef.current) {
      reportHistory(videoRef.current.currentTime, videoRef.current.duration || 0);
    }
    if (onEnded) onEnded();

    // Auto next countdown
    if (nextEpisode || onNextEpisode) {
      setCountdown(5);
    }
  };

  // Countdown timer for next episode
  useEffect(() => {
    if (countdown === null) return;

    if (countdown <= 0) {
      setCountdown(null);
      if (onNextEpisode) onNextEpisode();
      return;
    }

    countdownIntervalRef.current = setInterval(() => {
      setCountdown((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);

    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, [countdown, onNextEpisode]);

  const cancelCountdown = () => {
    setCountdown(null);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
  };

  // Controls actions
  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
      videoRef.current.play().catch(() => {});
    }
  };

  const seek = (time: number) => {
    if (!videoRef.current) return;
    const clamped = Math.max(0, Math.min(time, duration));
    videoRef.current.currentTime = clamped;
    setCurrentTime(clamped);
  };

  const skip = (delta: number) => {
    if (!videoRef.current) return;
    seek(videoRef.current.currentTime + delta);
  };

  const handleVolumeChange = (newVol: number) => {
    if (!videoRef.current) return;
    const clamped = Math.max(0, Math.min(1, newVol));
    videoRef.current.volume = clamped;
    setVolume(clamped);
    if (clamped === 0) {
      videoRef.current.muted = true;
      setIsMuted(true);
    } else if (isMuted) {
      videoRef.current.muted = false;
      setIsMuted(false);
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    const nextMuted = !isMuted;
    videoRef.current.muted = nextMuted;
    setIsMuted(nextMuted);
    if (!nextMuted && volume === 0) {
      videoRef.current.volume = 0.5;
      setVolume(0.5);
    }
  };

  const handleSpeedChange = (speed: number) => {
    if (!videoRef.current) return;
    videoRef.current.playbackRate = speed;
    setPlaybackSpeed(speed);
    setShowSettingsMenu(false);
  };

  const handleQualityChange = (levelIndex: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = levelIndex;
      setCurrentQuality(levelIndex);
    }
    setShowSettingsMenu(false);
  };

  const handleSubtitleChange = (trackId: string) => {
    setCurrentSubtitle(trackId);
    setShowSubtitleMenu(false);

    // Synchronize HTML5 video textTracks if attached
    if (videoRef.current && videoRef.current.textTracks) {
      const tracks = videoRef.current.textTracks;
      for (let i = 0; i < tracks.length; i++) {
        tracks[i].mode = (trackId !== 'off' && tracks[i].id === trackId) ? 'showing' : 'disabled';
      }
    }
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(console.error);
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(console.error);
    }
  };

  // Fullscreen change listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Inactivity fade timer for controls
  const handleMouseMove = () => {
    setControlsVisible(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying && !showSettingsMenu && !showSubtitleMenu && countdown === null) {
        setControlsVisible(false);
      }
    }, 3500);
  };

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when inside input/select
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;

      switch (e.code) {
        case 'Space':
        case 'KeyK':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          skip(-5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          skip(5);
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (videoRef.current) handleVolumeChange(videoRef.current.volume + 0.1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (videoRef.current) handleVolumeChange(videoRef.current.volume - 0.1);
          break;
        case 'KeyF':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'KeyM':
          e.preventDefault();
          toggleMute();
          break;
        case 'Escape':
          if (countdown !== null) {
            cancelCountdown();
          } else if (showSettingsMenu) {
            setShowSettingsMenu(false);
          } else if (showSubtitleMenu) {
            setShowSubtitleMenu(false);
          } else if (!isFullscreen && onClose) {
            onClose();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, volume, isMuted, isFullscreen, showSettingsMenu, showSubtitleMenu, countdown, onClose]);

  const remainingTime = Math.max(0, duration - currentTime);
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const subtitleColor = {
    white: '#fff',
    yellow: '#ff0',
    cyan: '#0ff',
  }[subtitleStyle.color];
  const subtitleEdge = {
    none: 'none',
    shadow: '2px 2px 4px rgba(0, 0, 0, .95)',
    outline: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000',
  }[subtitleStyle.edgeStyle];
  const playerStyle = {
    '--sub-color': subtitleColor,
    '--sub-bg': `rgba(0, 0, 0, ${subtitleStyle.backgroundOpacity / 100})`,
    '--sub-edge': subtitleEdge,
    '--sub-scale': `${subtitleStyle.fontScale}%`,
  } as React.CSSProperties;

  return (
    <div
      ref={containerRef}
      data-testid="openplex-player-container"
      style={playerStyle}
      onMouseMove={handleMouseMove}
      className="group fixed inset-0 z-50 flex select-none flex-col items-center justify-center overflow-hidden bg-black font-sans"
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        className="w-full h-full object-contain cursor-pointer"
        onClick={togglePlay}
        onTimeUpdate={handleTimeUpdate}
        onDurationChange={handleDurationChange}
        onPlay={handlePlay}
        onPause={handlePause}
        onEnded={handleEnded}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => setIsBuffering(false)}
        playsInline
      >
        {subtitleTracks.map((sub) => (
          <track
            key={sub.id}
            id={sub.id}
            kind="subtitles"
            src={sub.url}
            srcLang={sub.language}
            label={sub.label}
            default={currentSubtitle === sub.id}
          />
        ))}
      </video>

      {resumeToast && (
        <div
          role="status"
          data-testid="resume-toast"
          className="absolute bottom-24 left-1/2 z-40 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 flex-col gap-2 rounded-2xl border border-white/[0.09] bg-zinc-900/95 p-3 shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-2xl sm:w-auto sm:flex-row"
        >
          <button
            type="button"
            onClick={continueFromResume}
            className="min-h-11 rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-zinc-950 transition hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
          >
            이어서 보기
          </button>
          <button
            type="button"
            onClick={restartFromBeginning}
            className="min-h-11 rounded-xl bg-white/[0.06] px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            처음부터
          </button>
        </div>
      )}

      {/* Buffering Indicator */}
      {isBuffering && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/[0.08] bg-black/45 shadow-2xl backdrop-blur-xl">
            <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-amber-500/20 border-t-amber-400" />
          </div>
        </div>
      )}

      {/* Auto Next Countdown Overlay */}
      {countdown !== null && (
        <div
          data-testid="next-countdown-overlay"
          role="status"
          aria-live="polite"
          className="absolute bottom-24 left-4 right-4 z-40 w-auto max-w-sm rounded-2xl border border-white/[0.09] bg-zinc-900/95 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-2xl animate-in slide-in-from-bottom duration-300 sm:left-auto sm:right-8 sm:w-full"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-400">Up Next</span>
            <button
              onClick={cancelCountdown}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-zinc-400 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <h4 className="text-sm font-bold text-white mb-1 truncate">
            {nextEpisode ? nextEpisode.title : 'Next Episode'}
          </h4>
          <p className="text-xs text-zinc-400 mb-4">Playing automatically in {countdown}s</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                cancelCountdown();
                if (onNextEpisode) onNextEpisode();
              }}
              className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-zinc-950 transition hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
            >
              <FastForward className="w-4 h-4 fill-zinc-950" />
              <span>Play Now</span>
            </button>
            <button
              onClick={cancelCountdown}
              className="min-h-11 rounded-xl bg-white/[0.06] px-4 py-2 text-xs font-semibold text-zinc-300 transition hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Top Header Bar */}
      <div
        className={`absolute top-0 left-0 right-0 p-4 sm:p-6 bg-gradient-to-b from-black/90 via-black/40 to-transparent flex items-center justify-between transition-opacity duration-300 z-30 ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-3">
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Back"
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.08] bg-black/35 text-zinc-300 backdrop-blur-xl transition hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          <div>
            <h1 className="text-sm sm:text-base font-bold text-white tracking-wide">{title}</h1>
            {episodeTitle && <p className="text-xs text-zinc-400">{episodeTitle}</p>}
          </div>
        </div>

        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.08] bg-black/35 text-zinc-300 backdrop-blur-xl transition hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Settings / Quality Menu */}
      {showSettingsMenu && (
        <div
          data-testid="settings-menu"
          className="absolute bottom-24 left-3 right-3 z-40 max-h-[55vh] overflow-y-auto rounded-2xl border border-white/[0.09] bg-zinc-900/95 p-3 text-xs text-zinc-200 shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-2xl sm:left-auto sm:right-6 sm:min-w-[230px]"
        >
          <div className="font-bold text-zinc-400 uppercase tracking-wider text-[10px] mb-2 px-2">
            Playback Speed
          </div>
          <div className="grid grid-cols-3 gap-1 mb-3">
            {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((spd) => (
              <button
                key={spd}
                onClick={() => handleSpeedChange(spd)}
                className={`py-1.5 px-2 rounded-lg text-center font-semibold transition ${
                  playbackSpeed === spd
                    ? 'bg-amber-500 text-zinc-950'
                    : 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300'
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>

          {qualityLevels.length > 0 && (
            <>
              <div className="font-bold text-zinc-400 uppercase tracking-wider text-[10px] mb-2 px-2 border-t border-zinc-800 pt-2">
                Quality
              </div>
              <div className="space-y-1">
                <button
                  onClick={() => handleQualityChange(-1)}
                  className={`w-full flex items-center justify-between py-1.5 px-2 rounded-lg text-left font-semibold transition ${
                    currentQuality === -1
                      ? 'bg-amber-500/20 text-amber-400'
                      : 'hover:bg-zinc-800 text-zinc-300'
                  }`}
                >
                  <span>Auto</span>
                  {currentQuality === -1 && <Check className="w-3.5 h-3.5" />}
                </button>
                {qualityLevels.map((lvl) => (
                  <button
                    key={lvl.id}
                    onClick={() => handleQualityChange(lvl.id)}
                    className={`w-full flex items-center justify-between py-1.5 px-2 rounded-lg text-left font-semibold transition ${
                      currentQuality === lvl.id
                        ? 'bg-amber-500/20 text-amber-400'
                        : 'hover:bg-zinc-800 text-zinc-300'
                    }`}
                  >
                    <span>{lvl.name}</span>
                    {currentQuality === lvl.id && <Check className="w-3.5 h-3.5" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Subtitles Menu */}
      {showSubtitleMenu && (
        <div
          data-testid="subtitles-menu"
          className="absolute bottom-24 left-3 right-3 z-40 max-h-[55vh] overflow-y-auto rounded-2xl border border-white/[0.09] bg-zinc-900/95 p-3 text-xs text-zinc-200 shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-2xl sm:left-auto sm:right-16 sm:min-w-[230px]"
        >
          <div className="font-bold text-zinc-400 uppercase tracking-wider text-[10px] mb-2 px-2">
            Subtitles
          </div>
          <div className="space-y-1">
            <button
              onClick={() => handleSubtitleChange('off')}
              className={`w-full flex items-center justify-between py-1.5 px-2 rounded-lg text-left font-semibold transition ${
                currentSubtitle === 'off'
                  ? 'bg-amber-500/20 text-amber-400'
                  : 'hover:bg-zinc-800 text-zinc-300'
              }`}
            >
              <span>Off</span>
              {currentSubtitle === 'off' && <Check className="w-3.5 h-3.5" />}
            </button>
            {subtitleTracks.map((track) => (
              <button
                key={track.id}
                onClick={() => handleSubtitleChange(track.id)}
                className={`w-full flex items-center justify-between py-1.5 px-2 rounded-lg text-left font-semibold transition ${
                  currentSubtitle === track.id
                    ? 'bg-amber-500/20 text-amber-400'
                    : 'hover:bg-zinc-800 text-zinc-300'
                }`}
              >
                <span>{track.label}</span>
                {currentSubtitle === track.id && <Check className="w-3.5 h-3.5" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bottom Controls Bar */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-30 bg-gradient-to-t from-black via-black/75 to-transparent p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-opacity duration-300 sm:p-6 ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Scrubber / Progress Bar */}
        <div className="group/scrub relative mb-2 flex h-6 w-full cursor-pointer items-center">
          {/* Track background */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-700/80 transition-all duration-200 group-hover/scrub:h-2">
            <div
              className="h-full bg-amber-500 transition-all duration-75"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* HTML5 Range input overlay for full accessible seeking */}
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.1}
            value={currentTime}
            onChange={(e) => seek(parseFloat(e.target.value))}
            aria-label="Seek Video"
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        </div>

        {/* Control Buttons & Indicators */}
        <div className="flex items-center justify-between text-zinc-200">
          {/* Left Controls */}
          <div className="flex items-center gap-3 sm:gap-4">
            {/* Play/Pause */}
            <button
              onClick={togglePlay}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className="p-2 rounded-lg hover:bg-zinc-800/80 text-white transition active:scale-95"
            >
              {isPlaying ? <Pause className="w-5 h-5 fill-white" /> : <Play className="w-5 h-5 fill-white" />}
            </button>

            {/* 10s Back */}
            <button
              onClick={() => skip(-10)}
              aria-label="Seek back 10 seconds"
              className="p-2 rounded-lg hover:bg-zinc-800/80 text-zinc-300 hover:text-white transition active:scale-95"
            >
              <RotateCcw className="w-5 h-5" />
            </button>

            {/* 10s Forward */}
            <button
              onClick={() => skip(10)}
              aria-label="Seek forward 10 seconds"
              className="p-2 rounded-lg hover:bg-zinc-800/80 text-zinc-300 hover:text-white transition active:scale-95"
            >
              <RotateCw className="w-5 h-5" />
            </button>

            {/* Volume Control */}
            <div className="flex items-center gap-2 group/vol">
              <button
                onClick={toggleMute}
                aria-label={isMuted ? 'Unmute' : 'Mute'}
                className="p-2 rounded-lg hover:bg-zinc-800/80 text-zinc-300 hover:text-white transition active:scale-95"
              >
                {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                aria-label="Volume Slider"
                className="w-16 sm:w-20 h-1 bg-zinc-700 accent-amber-500 rounded-lg cursor-pointer"
              />
            </div>

            {/* Time Display */}
            <div className="text-xs font-mono text-zinc-400 pl-1 hidden sm:block">
              <span className="text-zinc-200">{formatTime(currentTime)}</span>
              <span className="mx-1">/</span>
              <span>{formatTime(duration)}</span>
              <span className="text-zinc-500 ml-2">(-{formatTime(remainingTime)})</span>
            </div>
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Subtitles Toggle */}
            <button
              onClick={() => {
                setShowSubtitleMenu(!showSubtitleMenu);
                setShowSettingsMenu(false);
              }}
              aria-label="Subtitles"
              className={`p-2 rounded-lg transition active:scale-95 ${
                currentSubtitle !== 'off' || showSubtitleMenu
                  ? 'text-amber-400 bg-amber-500/20'
                  : 'text-zinc-300 hover:text-white hover:bg-zinc-800/80'
              }`}
            >
              <Subtitles className="w-5 h-5" />
            </button>

            {/* Speed & Quality Settings */}
            <button
              onClick={() => {
                setShowSettingsMenu(!showSettingsMenu);
                setShowSubtitleMenu(false);
              }}
              aria-label="Settings"
              className={`p-2 rounded-lg transition active:scale-95 ${
                showSettingsMenu ? 'text-amber-400 bg-amber-500/20' : 'text-zinc-300 hover:text-white hover:bg-zinc-800/80'
              }`}
            >
              <Settings className="w-5 h-5" />
            </button>

            {/* Fullscreen Toggle */}
            <button
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
              className="p-2 rounded-lg hover:bg-zinc-800/80 text-zinc-300 hover:text-white transition active:scale-95"
            >
              {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
