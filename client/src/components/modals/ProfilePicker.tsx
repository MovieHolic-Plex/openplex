import React, { useState, useEffect } from 'react';
import { User, Plus, Edit2, Trash2, Check, X, ShieldAlert, ArrowLeft } from 'lucide-react';
import { api, type ProfileItem } from '../../api/client';

interface ProfilePickerProps {
  isOpen: boolean;
  onSelectProfile: (profile: ProfileItem) => void;
  onClose?: () => void;
  canClose?: boolean;
}

const AVATAR_COLORS = [
  '#e5a00d', // plex gold
  '#3b82f6', // blue
  '#10b981', // emerald
  '#ec4899', // pink
  '#8b5cf6', // purple
  '#f97316', // orange
  '#06b6d4', // cyan
  '#ef4444', // red
];

export const ProfilePicker: React.FC<ProfilePickerProps> = ({
  isOpen,
  onSelectProfile,
  onClose,
  canClose = false,
}) => {
  const [profiles, setProfiles] = useState<ProfileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(AVATAR_COLORS[0]);
  const [editingProfileId, setEditingProfileId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 4000);
  };

  const loadProfiles = async () => {
    try {
      setLoading(true);
      const items = await api.getProfiles();
      setProfiles(items);
    } catch (err) {
      console.error('Failed to load profiles', err);
      showToast('프로필 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void loadProfiles();
      setIsEditing(false);
      setIsCreating(false);
      setEditingProfileId(null);
      setFormError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) {
      setFormError('프로필 이름을 입력해주세요.');
      return;
    }

    try {
      const created = await api.createProfile(trimmed, newColor);
      setNewName('');
      setIsCreating(false);
      setFormError(null);
      await loadProfiles();
      // If was opened as a mandatory gate (cannot close), automatically select newly created profile
      if (!canClose) {
        onSelectProfile(created);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '프로필 생성에 실패했습니다.';
      if (msg.includes('UNIQUE') || msg.includes('exists') || msg.includes('400')) {
        setFormError('이미 사용 중이거나 올바르지 않은 이름입니다.');
      } else {
        setFormError(msg);
      }
    }
  };

  const handleStartRename = (profile: ProfileItem) => {
    setEditingProfileId(profile.id);
    setEditName(profile.name);
    setFormError(null);
  };

  const handleSaveRename = async (profileId: number) => {
    const trimmed = editName.trim();
    if (!trimmed) {
      setFormError('프로필 이름을 입력해주세요.');
      return;
    }

    try {
      await api.renameProfile(profileId, trimmed);
      setEditingProfileId(null);
      setFormError(null);
      await loadProfiles();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '이름 변경에 실패했습니다.';
      if (msg.includes('UNIQUE') || msg.includes('exists') || msg.includes('400')) {
        setFormError('이미 사용 중이거나 올바르지 않은 이름입니다.');
      } else {
        setFormError(msg);
      }
    }
  };

  const handleDelete = async (profile: ProfileItem) => {
    if (profile.id === 1) {
      showToast('기본 프로필은 삭제할 수 없습니다.');
      return;
    }
    if (profiles.length <= 1) {
      showToast('마지막 프로필은 삭제할 수 없습니다.');
      return;
    }

    try {
      await api.deleteProfile(profile.id);
      await loadProfiles();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '프로필 삭제에 실패했습니다.';
      if (msg.includes('default') || msg.includes('Default') || (err as { status?: number }).status === 409) {
        showToast('기본 프로필 또는 마지막 프로필은 삭제할 수 없습니다.');
      } else {
        showToast(msg);
      }
    }
  };

  return (
    <div
      data-testid="profile-picker-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[radial-gradient(circle_at_50%_12%,rgba(245,158,11,0.11),transparent_30%),linear-gradient(180deg,#09090b_0%,#050506_100%)] p-4 py-8 backdrop-blur-2xl animate-in fade-in duration-200"
    >
      {/* Toast alert */}
      {toastMessage && (
        <div
          role="alert"
          className="fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-zinc-900 border border-amber-500/40 text-amber-300 px-4 py-2.5 rounded-xl shadow-2xl text-sm font-medium animate-in slide-in-from-top duration-150"
        >
          <ShieldAlert className="w-4 h-4 flex-none text-amber-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main card */}
      <div className="relative flex w-full max-w-3xl flex-col items-center overflow-hidden rounded-[28px] border border-white/[0.08] bg-zinc-900/78 p-6 shadow-[0_32px_120px_rgba(0,0,0,0.62)] backdrop-blur-2xl sm:p-10">
        <div className="pointer-events-none absolute inset-x-16 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/55 to-transparent" />
        {canClose && onClose && (
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-6 right-6 p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-full transition"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {isCreating ? (
          <div className="w-full max-w-md">
            <button
              onClick={() => {
                setIsCreating(false);
                setFormError(null);
              }}
              className="mb-6 flex min-h-10 items-center gap-2 rounded-xl px-2 text-sm text-zinc-400 transition hover:bg-white/[0.04] hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>뒤로가기</span>
            </button>
            <h2 className="text-2xl font-bold text-zinc-100 text-center mb-6">프로필 만들기</h2>
            <form onSubmit={handleCreate} className="space-y-6">
              <div className="flex flex-col items-center gap-4">
                <div
                  className="w-24 h-24 rounded-2xl flex items-center justify-center text-3xl font-bold text-zinc-950 shadow-xl transition-transform"
                  style={{ backgroundColor: newColor }}
                >
                  {newName.trim() ? newName.trim()[0].toUpperCase() : <User className="w-12 h-12 text-zinc-950" />}
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-center">
                  {AVATAR_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Color ${c}`}
                      aria-pressed={newColor === c}
                      onClick={() => setNewColor(c)}
                      className={`w-7 h-7 rounded-full transition-transform ${
                        newColor === c ? 'scale-125 ring-2 ring-white ring-offset-2 ring-offset-zinc-900' : 'hover:scale-110'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                  프로필 이름
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => {
                    setNewName(e.target.value);
                    if (formError) setFormError(null);
                  }}
                  placeholder="이름을 입력하세요"
                  maxLength={24}
                  autoFocus
                  className="w-full rounded-xl border border-white/[0.08] bg-black/35 px-4 py-3 text-zinc-100 placeholder-zinc-600 transition focus:border-amber-500/60 focus:outline-none focus:ring-2 focus:ring-amber-500/10"
                />
                {formError && <p className="mt-2 text-xs text-red-400 font-medium">{formError}</p>}
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsCreating(false);
                    setFormError(null);
                  }}
                  className="flex-1 px-4 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-semibold text-sm transition"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-sm transition shadow-lg shadow-amber-500/20"
                >
                  완료
                </button>
              </div>
            </form>
          </div>
        ) : (
          <>
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-zinc-950 shadow-[0_10px_30px_rgba(245,158,11,0.18)]">
              <User className="h-5 w-5" />
            </div>
            <h1 className="mb-2 text-center text-3xl font-black tracking-[-0.035em] text-zinc-100 sm:text-4xl">
              {isEditing ? '프로필 관리' : '누가 시청 중인가요?'}
            </h1>
            <p className="mb-9 max-w-md text-center text-sm leading-6 text-zinc-400">
              {isEditing ? '수정하거나 삭제할 프로필을 선택하세요.' : '프로필을 선택하여 맞춤 콘텐츠를 즐겨보세요.'}
            </p>

            {formError && (
              <div className="mb-4 text-xs text-red-400 bg-red-950/40 border border-red-900/60 px-4 py-2 rounded-xl">
                {formError}
              </div>
            )}

            {loading ? (
              <div className="py-12 text-zinc-500 text-sm">프로필을 불러오는 중...</div>
            ) : (
              <div className="mb-9 flex w-full flex-wrap justify-center gap-5 sm:gap-7">
                {profiles.map((profile) => {
                  const avatarBg = profile.avatar_color || '#e5a00d';
                  const isEditingThis = editingProfileId === profile.id;

                  return (
                    <div
                      key={profile.id}
                      data-testid={`profile-card-${profile.id}`}
                      className="flex flex-col items-center group w-full max-w-[130px]"
                    >
                      {isEditingThis ? (
                        <div className="w-full flex flex-col items-center gap-2">
                          <div
                            className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl flex items-center justify-center text-2xl sm:text-3xl font-black text-zinc-950 shadow-xl"
                            style={{ backgroundColor: avatarBg }}
                          >
                            {profile.name[0]?.toUpperCase() ?? '?'}
                          </div>
                          <div className="flex items-center gap-1 w-full mt-1">
                            <input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className="w-full bg-zinc-950 border border-amber-500 rounded-lg px-2 py-1 text-xs text-center text-white focus:outline-none"
                              autoFocus
                            />
                            <button
                              onClick={() => void handleSaveRename(profile.id)}
                              aria-label="Save"
                              className="p-1 bg-amber-500 text-zinc-950 rounded-lg hover:bg-amber-400"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setEditingProfileId(null)}
                              aria-label="Cancel"
                              className="p-1 bg-zinc-800 text-zinc-400 rounded-lg hover:bg-zinc-700"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="relative">
                            <button
                              onClick={() => {
                                if (isEditing) {
                                  handleStartRename(profile);
                                } else {
                                  onSelectProfile(profile);
                                }
                              }}
                              aria-label={`Select profile ${profile.name}`}
                              className="flex h-20 w-20 items-center justify-center rounded-[22px] border-2 border-transparent text-2xl font-black text-zinc-950 shadow-[0_14px_34px_rgba(0,0,0,0.32)] transition-all duration-300 group-hover:-translate-y-1 group-hover:border-amber-300/80 group-hover:shadow-[0_18px_42px_rgba(245,158,11,0.16)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300/70 sm:h-24 sm:w-24 sm:text-3xl"
                              style={{ backgroundColor: avatarBg }}
                            >
                              {profile.name[0]?.toUpperCase() ?? <User className="w-10 h-10 text-zinc-950" />}
                            </button>

                            {/* Editing overlay controls */}
                            {isEditing && (
                              <div className="absolute -top-2 -right-2 flex gap-1">
                                <button
                                  onClick={() => handleStartRename(profile)}
                                  title="이름 변경"
                                  className="p-1.5 bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 text-zinc-200 rounded-full shadow-lg transition"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                {profile.id !== 1 && profiles.length > 1 && (
                                  <button
                                    onClick={() => void handleDelete(profile)}
                                    title="프로필 삭제"
                                    className="p-1.5 bg-red-950/90 border border-red-800/80 hover:bg-red-900 text-red-300 rounded-full shadow-lg transition"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                          <span className="mt-2.5 text-sm font-semibold text-zinc-300 group-hover:text-zinc-100 transition truncate max-w-full text-center">
                            {profile.name}
                          </span>
                        </>
                      )}
                    </div>
                  );
                })}

                {/* Add profile card button */}
                {!isEditing && (
                  <div className="flex flex-col items-center group w-full max-w-[130px]">
                    <button
                      onClick={() => {
                        setIsCreating(true);
                        setNewName('');
                        setNewColor(AVATAR_COLORS[profiles.length % AVATAR_COLORS.length]);
                        setFormError(null);
                      }}
                      aria-label="Add Profile"
                      className="flex h-20 w-20 items-center justify-center rounded-[22px] border-2 border-dashed border-zinc-700 bg-white/[0.015] text-zinc-500 transition-all duration-300 hover:border-amber-500/60 hover:bg-amber-500/[0.04] hover:text-amber-300 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300/60 sm:h-24 sm:w-24"
                    >
                      <Plus className="w-8 h-8" />
                    </button>
                    <span className="mt-2.5 text-sm font-medium text-zinc-500 group-hover:text-zinc-400">
                      프로필 추가
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Bottom action button */}
            <div className="flex w-full justify-center border-t border-white/[0.06] pt-6">
              <button
                onClick={() => {
                  setIsEditing(!isEditing);
                  setEditingProfileId(null);
                  setFormError(null);
                }}
                className={`px-6 py-2.5 rounded-xl border text-sm font-semibold transition tracking-wide ${
                  isEditing
                    ? 'bg-amber-500 text-zinc-950 border-amber-500 hover:bg-amber-400 shadow-lg shadow-amber-500/20'
                    : 'bg-zinc-800/80 text-zinc-300 border-zinc-700/80 hover:bg-zinc-700/80 hover:text-white'
                }`}
              >
                {isEditing ? '완료' : '프로필 관리'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
