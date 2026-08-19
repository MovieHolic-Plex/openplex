import React, { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { api, type AgentTurn } from '../api/client';

interface AgentDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onEnqueueUnit?: (unitId: number) => void;
}

export const AgentDrawer: React.FC<AgentDrawerProps> = ({ isOpen, onClose, onEnqueueUnit }) => {
  const [message, setMessage] = useState('다음에 뭐 보지');
  const [turn, setTurn] = useState<AgentTurn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [oauth, setOauth] = useState<{ configured: boolean; authorized: boolean } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    void api.getAgentOauthStatus().then(setOauth).catch(() => setOauth(null));
  }, [isOpen]);

  if (!isOpen) return null;

  const recommended = (turn?.tools ?? [])
    .filter((tool) => tool.name === 'recommend_next')
    .flatMap((tool) => Array.isArray(tool.result) ? tool.result : []);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-end bg-black/50 p-3 sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-drawer-title"
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-400" />
            <h2 id="agent-drawer-title" className="text-sm font-bold text-zinc-100">에이전트</h2>
          </div>
          <button
            type="button"
            aria-label="Close agent"
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {oauth?.configured && !oauth.authorized && (
          <div className="border-b border-zinc-800 px-4 py-2 text-xs text-zinc-400">
            GPT OAuth 토큰이 없습니다.
            <button
              type="button"
              className="ml-2 font-bold text-amber-400"
              onClick={() => {
                void api.startAgentOauth().then((started) => {
                  window.open(started.authorizeUrl, '_blank', 'noopener');
                }).catch((cause: unknown) => {
                  setError(cause instanceof Error ? cause.message : 'OAuth를 시작하지 못했습니다.');
                });
              }}
            >
              GPT 로그인
            </button>
          </div>
        )}

        <form
          className="flex gap-2 border-b border-zinc-800 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!message.trim()) return;
            setBusy(true);
            setError(null);
            void api.agentTurn(message.trim())
              .then(setTurn)
              .catch((cause: unknown) => {
                setError(cause instanceof Error ? cause.message : '에이전트를 호출하지 못했습니다.');
              })
              .finally(() => setBusy(false));
          }}
        >
          <input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            aria-label="에이전트에게 묻기"
            className="min-h-10 flex-1 rounded-xl border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-amber-500 px-3 text-sm font-bold text-zinc-950 disabled:opacity-60"
          >
            {busy ? '생각 중' : '묻기'}
          </button>
        </form>

        <div className="flex-1 overflow-y-auto p-4 text-sm">
          {error && <p role="alert" className="mb-3 text-red-400">{error}</p>}
          {turn && (
            <>
              <p className="whitespace-pre-wrap text-zinc-200">{turn.reply}</p>
              {recommended.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {recommended.map((row) => {
                    const record = row as {
                      work?: { id?: number; title?: string };
                      unitId?: number | null;
                    };
                    const title = record.work?.title ?? '작품';
                    const unitId = record.unitId;
                    return (
                      <li
                        key={`${record.work?.id ?? title}`}
                        className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2"
                      >
                        <span className="truncate font-semibold text-zinc-100">{title}</span>
                        {typeof unitId === 'number' && (
                          <button
                            type="button"
                            onClick={() => onEnqueueUnit?.(unitId)}
                            className="ml-2 shrink-0 text-xs font-bold text-amber-400"
                          >
                            받기
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
};
