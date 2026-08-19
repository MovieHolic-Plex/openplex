import React, { useState, useEffect, useRef } from 'react';
import { Library, Server, Search, Bookmark, Film, Tv, Sparkles, Menu, X, Home, User, Settings, SlidersHorizontal, BarChart3, Download, BookOpen, Bot } from 'lucide-react';
import { Logo } from '../common/Logo';
import type { ProfileItem } from '../../api/client';

export type NavTab = 'library' | 'home' | 'drama' | 'movie' | 'animation' | 'comics' | 'mylist' | 'stats';

interface HeaderProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  onOpenSearch: () => void;
  currentProfile: ProfileItem | null;
  profiles: ProfileItem[];
  onSwitchProfile: (profile: ProfileItem) => void;
  onManageProfiles: () => void;
  onOpenSubtitleSettings: () => void;
  onOpenDownloads: () => void;
  onOpenAgent: () => void;
  onOpenServerSettings: () => void;
  visitor?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onTabChange,
  onOpenSearch,
  currentProfile,
  profiles,
  onSwitchProfile,
  onManageProfiles,
  onOpenSubtitleSettings,
  onOpenDownloads,
  onOpenAgent,
  onOpenServerSettings,
  visitor = false,
}) => {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setProfileDropdownOpen(false);
      }
    };
    if (profileDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [profileDropdownOpen]);

  const navItems: { id: NavTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'library', label: '보관함', icon: Library },
    { id: 'home', label: '홈', icon: Home },
    { id: 'drama', label: '드라마', icon: Tv },
    { id: 'movie', label: '영화', icon: Film },
    { id: 'animation', label: '애니', icon: Sparkles },
    { id: 'comics', label: '만화', icon: BookOpen },
    { id: 'mylist', label: '내 목록', icon: Bookmark },
    { id: 'stats', label: '통계', icon: BarChart3 },
  ];

  const visibleNavItems = visitor ? navItems.filter((item) => item.id === 'library') : navItems;

  const currentAvatarBg = currentProfile?.avatar_color || '#e5a00d';

  return (
    <header
      className={`fixed inset-x-0 top-0 z-40 border-b transition-all duration-300 ${
        scrolled
          ? 'border-white/[0.06] bg-zinc-950/78 py-3 shadow-[0_12px_50px_rgba(0,0,0,0.35)] backdrop-blur-2xl'
          : 'border-transparent bg-gradient-to-b from-zinc-950/95 via-zinc-950/55 to-transparent py-4'
      }`}
    >
      <div className="mx-auto flex min-w-0 max-w-[1536px] items-center justify-between gap-2 px-4 sm:px-6 lg:px-8">
        {/* Left: Brand + Nav Links */}
        <div className="flex items-center gap-8">
          <Logo onClick={() => onTabChange('home')} />

          {/* Desktop Nav */}
          <nav aria-label="주요 메뉴" className="hidden items-center gap-1 rounded-2xl border border-white/[0.05] bg-black/10 p-1 md:flex">
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onTabChange(item.id)}
                  className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 ${
                    isActive
                      ? 'border border-white/[0.08] bg-zinc-800/90 text-amber-300 shadow-sm shadow-black/30'
                      : 'border border-transparent text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-amber-400' : 'text-zinc-400'}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Right: Search & Profile & Actions */}
        <div className="flex shrink-0 items-center gap-2">
          {!visitor && (
            <button
              type="button"
              onClick={onOpenAgent}
              aria-label="에이전트"
              className="hidden min-h-10 min-w-10 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.045] p-2 text-zinc-300 shadow-sm transition duration-200 hover:border-amber-500/20 hover:bg-white/[0.07] hover:text-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 sm:flex"
            >
              <Bot className="h-4 w-4" />
            </button>
          )}
          {!visitor && (
            <button
              type="button"
              onClick={onOpenDownloads}
              aria-label="다운로드"
              className="hidden min-h-10 min-w-10 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.045] p-2 text-zinc-300 shadow-sm transition duration-200 hover:border-amber-500/20 hover:bg-white/[0.07] hover:text-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 sm:flex"
            >
              <Download className="h-4 w-4" />
            </button>
          )}

          {!visitor && (
            <button
              onClick={onOpenSearch}
              aria-label="검색"
              className="group flex min-h-10 items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.045] px-3 py-2 text-xs font-medium text-zinc-300 shadow-sm transition duration-200 hover:border-amber-500/20 hover:bg-white/[0.07] hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 sm:text-sm"
            >
              <Search className="w-4 h-4 text-zinc-400 group-hover:text-amber-400 transition" />
              <span className="hidden sm:inline">작품 찾기...</span>
              <kbd className="hidden lg:inline-block px-1.5 py-0.5 text-[10px] font-semibold bg-zinc-800 text-zinc-400 rounded border border-zinc-700">
                /
              </kbd>
            </button>
          )}

          {/* Always-reachable server settings for owners, independent of currentProfile */}
          {!visitor && (
            <button
              type="button"
              onClick={onOpenServerSettings}
              aria-label="서버 설정"
              title="서버 설정"
              className="flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.045] p-2 text-zinc-300 shadow-sm transition duration-200 hover:border-amber-500/20 hover:bg-white/[0.07] hover:text-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70"
            >
              <Server className="h-4 w-4" />
            </button>
          )}

          {/* Profile Switcher Dropdown */}
          {currentProfile && !visitor && (
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                aria-label={`Profile: ${currentProfile.name}`}
                aria-expanded={profileDropdownOpen}
                aria-haspopup="menu"
                className="group flex min-h-10 items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.045] p-1 transition duration-200 hover:border-amber-500/20 hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 sm:px-2 sm:py-1"
              >
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-zinc-950 shadow-sm"
                  style={{ backgroundColor: currentAvatarBg }}
                >
                  {currentProfile.name[0]?.toUpperCase() ?? <User className="w-4 h-4 text-zinc-950" />}
                </div>
                <span className="hidden sm:inline text-xs font-semibold text-zinc-300 group-hover:text-zinc-100 max-w-[100px] truncate">
                  {currentProfile.name}
                </span>
              </button>

              {/* Dropdown Menu */}
              {profileDropdownOpen && (
                <div role="menu" className="absolute right-0 z-50 mt-2 w-64 animate-in rounded-2xl border border-white/[0.08] bg-zinc-900/95 p-1.5 shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-2xl fade-in slide-in-from-top-2 duration-150">
                  <div className="rounded-xl bg-white/[0.025] px-3 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">현재 프로필</p>
                    <p className="text-sm font-bold text-zinc-100 truncate">{currentProfile.name}</p>
                  </div>

                  {/* Switch list */}
                  <div className="py-1">
                    {profiles
                      .filter((p) => p.id !== currentProfile.id)
                      .map((p) => (
                        <button
                          key={p.id}
                          onClick={() => {
                            setProfileDropdownOpen(false);
                            onSwitchProfile(p);
                          }}
                          className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-zinc-300 transition hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
                        >
                          <div
                            className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-zinc-950 flex-none"
                            style={{ backgroundColor: p.avatar_color || '#e5a00d' }}
                          >
                            {p.name[0]?.toUpperCase() ?? 'U'}
                          </div>
                          <span className="truncate flex-1">{p.name}</span>
                        </button>
                      ))}
                  </div>

                  <div className="border-t border-zinc-800/80 my-1" />

                  {/* Manage Profiles */}
                  <button
                    onClick={() => {
                      setProfileDropdownOpen(false);
                      onManageProfiles();
                    }}
                    className="flex min-h-10 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-semibold text-zinc-300 transition hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
                  >
                    <Settings className="w-4 h-4 text-zinc-400" />
                    <span>프로필 관리</span>
                  </button>

                  <button
                    onClick={() => {
                      setProfileDropdownOpen(false);
                      onOpenSubtitleSettings();
                    }}
                    className="flex min-h-10 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-semibold text-zinc-300 transition hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
                  >
                    <SlidersHorizontal className="w-4 h-4 text-zinc-400" />
                    <span>자막 설정</span>
                  </button>

                  {!visitor && (
                    <button
                      onClick={() => {
                        setProfileDropdownOpen(false);
                        onOpenServerSettings();
                      }}
                      className="flex min-h-10 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-semibold text-zinc-300 transition hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
                    >
                      <Server className="w-4 h-4 text-zinc-400" />
                      <span>서버 설정</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Mobile menu trigger */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="min-h-10 min-w-10 shrink-0 rounded-xl border border-white/[0.07] bg-white/[0.045] p-2 text-zinc-400 transition hover:bg-white/[0.07] hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 md:hidden"
            aria-label="메뉴 열기"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="space-y-1.5 border-b border-white/[0.06] bg-zinc-950/95 px-4 pb-5 pt-3 shadow-2xl backdrop-blur-2xl md:hidden">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onTabChange(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition ${
                  isActive
                    ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-amber-400' : 'text-zinc-400'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
          {!visitor && (
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenAgent();
              }}
              className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
            >
              <Bot className="h-4 w-4" />
              <span>에이전트</span>
            </button>
          )}
          {!visitor && (
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenDownloads();
              }}
              className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
            >
              <Download className="h-4 w-4" />
              <span>받은 영상</span>
            </button>
          )}
          {!visitor && (
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenServerSettings();
              }}
              className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
            >
              <Server className="h-4 w-4" />
              <span>서버 설정</span>
            </button>
          )}
        </div>
      )}
    </header>
  );
};
