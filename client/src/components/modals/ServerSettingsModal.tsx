import React, { useEffect, useState } from 'react';
import { Check, Copy, RefreshCw, Server, X } from 'lucide-react';
import { api, METADATA_PROVIDERS, type SettingsData } from '../../api/client';

interface ServerSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ServerSettingsModal: React.FC<ServerSettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [paths, setPaths] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    let current = true;
    setLoading(true);
    setError(null);
    setNotice(null);
    void api.getSettings()
      .then((data) => {
        if (!current) return;
        setSettings(data);
        setPaths(Object.fromEntries(
          data.libraries.map((lib) => [lib.id, lib.path ?? '']),
        ));
      })
      .catch((cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : '서버 설정을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
    };
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const origin = window.location.origin;

  const toggleVisibility = async (next: boolean) => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await api.putSettings({ visibility: next ? 'public' : 'private' });
      setSettings(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '설정을 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const savePaths = async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await api.putSettings({
        libraries: settings.libraries.map((lib) => ({
          id: lib.id,
          path: (paths[lib.id] ?? '').trim().length > 0 ? paths[lib.id].trim() : null,
        })),
      });
      setSettings(saved);
      setPaths(Object.fromEntries(
        saved.libraries.map((lib) => [lib.id, lib.path ?? '']),
      ));
      setNotice('보관함 경로를 저장했습니다.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '설정을 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const toggleProvider = async (id: string, next: boolean) => {
    if (!settings) return;
    const current = settings.metadataProviders ?? METADATA_PROVIDERS.map((p) => p.id);
    const nextProviders = next
      ? METADATA_PROVIDERS.map((p) => p.id).filter((p) => p === id || current.includes(p))
      : current.filter((p) => p !== id);
    setSaving(true);
    setError(null);
    try {
      const saved = await api.putSettings({ metadataProviders: nextProviders });
      setSettings(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '설정을 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const scan = async () => {
    setScanning(true);
    setError(null);
    setNotice(null);
    try {
      await api.scanLibrary();
      setNotice('스캔을 완료했습니다.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '스캔을 실행하지 못했습니다.');
    } finally {
      setScanning(false);
    }
  };

  const copyOrigin = async () => {
    try {
      await navigator.clipboard.writeText(origin);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('URL을 복사하지 못했습니다.');
    }
  };

  const isPublic = settings?.visibility === 'public';

  return (
    <div
      data-testid="server-settings-overlay"
      role="dialog"
      aria-label="서버 설정"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-white/[0.08] bg-zinc-900 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Server className="h-5 w-5 text-amber-400" />
            <h2 className="text-lg font-bold text-zinc-100">서버 설정</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="rounded-xl border border-white/[0.07] p-2 text-zinc-400 transition hover:bg-white/[0.05] hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading && <p className="text-sm text-zinc-500">불러오는 중...</p>}

        {error && (
          <div role="alert" className="mb-4 rounded-xl border border-red-900/60 bg-red-950/60 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}
        {notice && (
          <div className="mb-4 rounded-xl border border-emerald-900/60 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
            {notice}
          </div>
        )}

        {settings && (
          <div className="space-y-6">
            {/* Visibility */}
            <div className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.06] bg-white/[0.025] px-4 py-3.5">
              <label htmlFor="server-settings-visibility" className="text-sm font-semibold text-zinc-200">
                이 URL로 들어온 사람에게 보관함 공개
              </label>
              <button
                id="server-settings-visibility"
                type="button"
                role="switch"
                aria-checked={isPublic}
                disabled={saving}
                onClick={() => void toggleVisibility(!isPublic)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                  isPublic ? 'bg-amber-500' : 'bg-zinc-700'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
                    isPublic ? 'left-[22px]' : 'left-0.5'
                  }`}
                />
              </button>
            </div>

            {/* Origin URL */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-4 py-3.5">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">이 URL로 접속</p>
              <div className="flex items-center gap-2">
                <code data-testid="server-settings-origin" className="flex-1 truncate rounded-lg bg-black/40 px-3 py-2 text-sm text-amber-300">
                  {origin}
                </code>
                <button
                  type="button"
                  onClick={() => void copyOrigin()}
                  aria-label="URL 복사"
                  className="rounded-xl border border-white/[0.07] p-2 text-zinc-400 transition hover:border-amber-500/20 hover:text-amber-400"
                >
                  {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-zinc-500">
                공개해도 서버 바인드 주소는 바뀌지 않습니다. LAN/WAN은 OPENPLEX_BIND와 OPENPLEX_AUTH_TOKEN으로 엽니다.
              </p>
            </div>

            {/* Library paths */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-4 py-3.5">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">보관함 경로</p>
              <div className="space-y-3">
                {settings.libraries.map((lib) => (
                  <div key={lib.id}>
                    <label htmlFor={`server-settings-path-${lib.id}`} className="mb-1 block text-xs font-semibold text-zinc-300">
                      {lib.name}
                    </label>
                    <input
                      id={`server-settings-path-${lib.id}`}
                      type="text"
                      value={paths[lib.id] ?? ''}
                      placeholder="예: D:\\Media\\Drama"
                      onChange={(e) => setPaths((prev) => ({ ...prev, [lib.id]: e.target.value }))}
                      className="w-full rounded-lg border border-white/[0.08] bg-black/40 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-amber-500/40 focus:outline-none"
                    />
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => void savePaths()}
                disabled={saving}
                className="mt-4 min-h-10 rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-50"
              >
                저장
              </button>
            </div>

            {/* Metadata providers */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-4 py-3.5">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">메타데이터 소스</p>
              <p className="mb-3 text-xs leading-relaxed text-zinc-500">
                한국 사이트는 제목·연도·장르·줄거리·포스터만 가지고 오며, 재생 소스로 쓰지 않습니다.
              </p>
              <div className="space-y-2.5">
                {METADATA_PROVIDERS.map((provider) => {
                  const saved = settings.metadataProviders ?? METADATA_PROVIDERS.map((p) => p.id);
                  const checked = saved.includes(provider.id);
                  const showKmdbHint = provider.id === 'kmdb'
                    && settings.kmdbConfigured === false
                    && checked;
                  return (
                    <div key={provider.id}>
                      <label
                        htmlFor={`metadata-provider-${provider.id}`}
                        className="flex cursor-pointer items-center gap-2.5 text-sm text-zinc-200"
                      >
                        <input
                          id={`metadata-provider-${provider.id}`}
                          type="checkbox"
                          checked={checked}
                          disabled={saving}
                          onChange={(e) => void toggleProvider(provider.id, e.target.checked)}
                          className="h-4 w-4 rounded border-white/20 bg-black/40 accent-amber-500"
                        />
                        <span>{provider.label}</span>
                      </label>
                      {showKmdbHint && (
                        <p data-testid="kmdb-helper-text" className="mt-1 pl-6.5 text-xs text-amber-300/80">
                          KMDB_API_KEY 미설정 — 이 소스는 건너뜁니다
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Scan */}
            <button
              type="button"
              onClick={() => void scan()}
              disabled={scanning}
              className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-white/[0.08] px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:bg-white/[0.05] disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${scanning ? 'animate-spin' : ''}`} />
              <span>스캔</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
