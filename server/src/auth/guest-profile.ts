import { LocalMediaStore } from '../store/local-media-store.js';
import { SQLiteStore, type Profile } from '../store/sqlite-store.js';

export const GUEST_PROFILE_NAME = 'Guest';
const GUEST_PROFILE_COLOR = '#71717a';

function isUniqueViolation(error: unknown): boolean {
  return /UNIQUE constraint failed/i.test(error instanceof Error ? error.message : '');
}

/**
 * Returns the persisted guest profile id, creating the profile on first use.
 *
 * The stored id is authoritative when present, valid, and not the owner
 * profile (1). A new profile is always created rather than looked up by
 * name, so visitor progress can never land in an owner profile that merely
 * shares the name "Guest". When the name is taken we fall back to
 * "Guest (shared)", "Guest (shared 2)", ... and finally a Date.now()
 * suffix, never reusing an existing row or returning id 1.
 */
export function ensureGuestProfile(store: SQLiteStore, localMedia: LocalMediaStore): number {
  const stored = localMedia.getGuestProfileId();
  if (stored !== null && stored !== 1 && store.profileExists(stored)) {
    return stored;
  }

  const attempts = [
    GUEST_PROFILE_NAME,
    'Guest (shared)',
    'Guest (shared 2)',
    'Guest (shared 3)',
    'Guest (shared 4)',
  ];

  let profile: Profile | undefined;
  for (const name of attempts) {
    try {
      profile = store.createProfile(name, GUEST_PROFILE_COLOR);
      break;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  if (!profile) {
    profile = store.createProfile(
      `Guest ${Date.now()}`,
      GUEST_PROFILE_COLOR,
    );
  }
  if (profile.id === 1) {
    throw new Error('Guest profile must not reuse the owner profile');
  }
  localMedia.setGuestProfileId(profile.id);
  return profile.id;
}
