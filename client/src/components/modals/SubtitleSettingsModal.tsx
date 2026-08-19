import React, { useEffect, useState } from 'react';
import { Check, Subtitles, X } from 'lucide-react';
import {
  api,
  DEFAULT_SUBTITLE_STYLE,
  type ProfileItem,
  type SubtitleStyle,
} from '../../api/client';

interface SubtitleSettingsModalProps {
  isOpen: boolean;
  profile: ProfileItem | null;
  onClose: () => void;
  onSaved: (style: SubtitleStyle) => void;
}

const COLOR_OPTIONS: Array<{ value: SubtitleStyle['color']; label: string; swatch: string; colorCode: string }> = [
  { value: 'white', label: '흰색', swatch: '#ffffff', colorCode: '#ffffff' },
  { value: 'yellow', label: '노란색', swatch: '#fbbf24', colorCode: '#fbbf24' },
  { value: 'cyan', label: '청록색', swatch: '#22d3ee', colorCode: '#22d3ee' },
];

const EDGE_OPTIONS: Array<{ value: SubtitleStyle['edgeStyle']; label: string; description: string }> = [
  { value: 'none', label: '없음', description: '기본 텍스트' },
  { value: 'shadow', label: '그림자', description: '드롭 섀도우' },
  { value: 'outline', label: '외곽선', description: '또렷한 테두리' },
];

export const SubtitleSettingsModal: React.FC<SubtitleSettingsModalProps> = ({
  isOpen,
  profile,
  onClose,
  onSaved,
}) => {
  const [style, setStyle] = useState<SubtitleStyle>(DEFAULT_SUBTITLE_STYLE);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !profile) return;

    let current = true;
    setLoading(true);
    setError(null);
    void api.getSubtitleStyle(profile.id)
      .then((stored) => {
        if (current) setStyle(stored);
      })
      .catch((cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : '자막 설정을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
    };
  }, [isOpen, profile]);

  // Keyboard escape handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !profile) return null;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await api.updateSubtitleStyle(profile.id, style);
      setStyle(saved);
      onSaved(saved);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '자막 설정을 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  // Compute live preview CSS style for Korean subtitle preview
  const getPreviewTextColor = (color: SubtitleStyle['color']) => {
    switch (color) {
      case 'yellow':
        return '#fbbf24';
      case 'cyan':
        return '#22d3ee';
      case 'white':
      default:
        return '#ffffff';
    }
  };

  const getPreviewTextShadow = (edgeStyle: SubtitleStyle['edgeStyle']) => {
    switch (edgeStyle) {
      case 'shadow':
        return '2px 2px 4px rgba(0, 0, 0, 0.95), 0 0 8px rgba(0, 0, 0, 0.8)';
      case 'outline':
        return '-1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px 1.5px 0 #000, 0 2px 4px rgba(0,0,0,0.8)';
      case 'none':
      default:
        return 'none';
    }
  };

  const previewTextColor = getPreviewTextColor(style.color);
  const previewBgColor = `rgba(0, 0, 0, ${Math.max(0, Math.min(100, style.backgroundOpacity)) / 100})`;
  const previewTextShadow = getPreviewTextShadow(style.edgeStyle);
  // Scale preview font-size relative to base 14px
  const previewFontSize = `${Math.max(0.7, Math.min(1.8, style.fontScale / 100)) * 14}px`;

  return (
    <div
      data-testid="subtitle-settings-overlay"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-3 sm:p-4 backdrop-blur-md animate-in fade-in duration-200 overflow-y-auto"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="subtitle-settings-title"
        className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950/95 p-5 shadow-2xl shadow-black/80 sm:p-6 my-auto ring-1 ring-white/5"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-amber-500/15 p-2 text-amber-400 border border-amber-500/20">
              <Subtitles className="h-5 w-5" />
            </div>
            <div>
              <h2 id="subtitle-settings-title" className="text-lg font-bold text-zinc-100">자막 설정</h2>
              <p className="text-xs text-zinc-400 font-normal">{profile.name} 프로필에 실시간으로 적용됩니다.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close subtitle settings"
            className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {loading ? (
          <div className="py-16 text-center text-sm text-zinc-400">설정을 불러오는 중...</div>
        ) : (
          <div className="space-y-5">
            {/* Live Korean Subtitle Preview Box */}
            <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/90 p-4 shadow-inner">
              <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-amber-400/90">
                <span>실시간 미리보기</span>
                <span className="font-mono text-zinc-500">{style.fontScale}% · {style.color}</span>
              </div>
              {/* Scene Backdrop Simulation */}
              <div className="relative h-28 w-full rounded-lg overflow-hidden bg-gradient-to-tr from-zinc-950 via-zinc-900 to-zinc-950 flex flex-col justify-between p-3 border border-zinc-800/80">
                <div className="flex items-center justify-between opacity-40">
                  <div className="h-2 w-16 rounded bg-zinc-700" />
                  <div className="h-2 w-8 rounded bg-zinc-700" />
                </div>
                {/* Live Preview Subtitle Cue */}
                <div className="flex flex-col items-center justify-center text-center">
                  <span
                    className="inline-block max-w-full px-2.5 py-1 rounded transition-all duration-150 leading-snug font-medium select-none"
                    style={{
                      color: previewTextColor,
                      backgroundColor: previewBgColor,
                      textShadow: previewTextShadow,
                      fontSize: previewFontSize,
                    }}
                  >
                    이곳에 실시간 한국어 자막 미리보기가 표시됩니다.
                  </span>
                </div>
              </div>
            </div>

            {/* Font Scale Slider */}
            <label className="block">
              <span className="mb-2 flex items-center justify-between text-sm font-semibold text-zinc-200">
                <span>자막 크기</span>
                <output className="text-amber-400 font-bold font-mono text-sm">{style.fontScale}%</output>
              </span>
              <input
                aria-label="자막 크기"
                type="range"
                min={50}
                max={200}
                step={5}
                value={style.fontScale}
                onChange={(event) => setStyle((current) => ({
                  ...current,
                  fontScale: Number(event.target.value),
                }))}
                className="h-2 w-full cursor-pointer accent-amber-500 bg-zinc-800 rounded-lg appearance-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
              />
              <span className="mt-1.5 flex justify-between text-[11px] text-zinc-500 font-mono">
                <span>작게 (50%)</span><span>기본 (100%)</span><span>크게 (200%)</span>
              </span>
            </label>

            {/* Subtitle Color Options */}
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-zinc-200">글자 색상</legend>
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                {COLOR_OPTIONS.map((option) => {
                  const isSelected = style.color === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setStyle((current) => ({ ...current, color: option.value }))}
                      className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                        isSelected
                          ? 'border-amber-500/70 bg-amber-500/15 text-amber-300 shadow-sm'
                          : 'border-zinc-800 bg-zinc-900/80 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                      }`}
                    >
                      <span
                        className="h-3.5 w-3.5 rounded-full border border-black/40 ring-1 ring-white/10"
                        style={{ backgroundColor: option.colorCode }}
                      />
                      {option.label}
                      {isSelected && <Check className="h-3.5 w-3.5 text-amber-400 ml-0.5" />}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {/* Background Opacity */}
            <label className="block">
              <span className="mb-2 flex items-center justify-between text-sm font-semibold text-zinc-200">
                <span>배경 불투명도</span>
                <output className="text-amber-400 font-bold font-mono text-sm">{style.backgroundOpacity}%</output>
              </span>
              <input
                aria-label="배경 불투명도"
                type="range"
                min={0}
                max={100}
                step={5}
                value={style.backgroundOpacity}
                onChange={(event) => setStyle((current) => ({
                  ...current,
                  backgroundOpacity: Number(event.target.value),
                }))}
                className="h-2 w-full cursor-pointer accent-amber-500 bg-zinc-800 rounded-lg appearance-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
              />
              <span className="mt-1.5 flex justify-between text-[11px] text-zinc-500 font-mono">
                <span>투명 (0%)</span><span>반투명 (50%)</span><span>불투명 (100%)</span>
              </span>
            </label>

            {/* Edge Style */}
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-zinc-200">가장자리 스타일</legend>
              <div className="grid grid-cols-3 gap-2 rounded-xl bg-zinc-900/90 p-1.5 border border-zinc-800">
                {EDGE_OPTIONS.map((option) => {
                  const isSelected = style.edgeStyle === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setStyle((current) => ({ ...current, edgeStyle: option.value }))}
                      className={`rounded-lg px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                        isSelected
                          ? 'bg-amber-500 text-zinc-950 font-bold shadow-md'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300/80 flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              <span><strong className="font-semibold">Chromium에서 완전 지원</strong> · HLS HTML5 자막 렌더러와 호환됩니다.</span>
            </div>

            {error && <p role="alert" className="text-xs font-medium text-red-400 bg-red-950/40 border border-red-500/30 p-2.5 rounded-xl">{error}</p>}

            <div className="flex justify-end gap-2.5 border-t border-zinc-800/90 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl px-4 py-2.5 text-sm font-semibold text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-bold text-zinc-950 transition hover:bg-amber-400 active:scale-95 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 shadow-md shadow-amber-500/10"
              >
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
