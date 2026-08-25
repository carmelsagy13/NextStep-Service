import { Logger } from '@nestjs/common';

/** One Open Finance API identity (a single sandbox/production account). */
export interface OFCredentials {
  /** Profile key from OF_USER_KEYS, used for logging only. */
  key: string;
  clientId: string;
  clientSecret: string;
  /** Sent as `userId` to /oauth/token; equals the app user's email. */
  username: string;
}

const logger = new Logger('OpenFinanceCredentials');

/** OF_USER_KEYS entries become env prefixes: "carmel" -> OF_CARMEL_*. */
function envPrefix(key: string): string {
  return `OF_${key.trim().toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

function readProfile(key: string): OFCredentials | null {
  const prefix = envPrefix(key);
  const clientId = process.env[`${prefix}_CLIENT_ID`]?.trim();
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`]?.trim();
  const username = process.env[`${prefix}_USERNAME`]?.trim();

  if (!clientId || !clientSecret || !username) {
    logger.warn(
      `Open Finance profile "${key}" is incomplete — expected ${prefix}_CLIENT_ID, ${prefix}_CLIENT_SECRET and ${prefix}_USERNAME.`,
    );
    return null;
  }
  return { key: key.trim(), clientId, clientSecret, username };
}

/**
 * Builds the email -> credentials map from OF_USER_KEYS. Read on every call so
 * a `.env` change only needs a restart of the process, not a rebuild.
 */
function loadProfiles(): Map<string, OFCredentials> {
  const keys = (process.env.OF_USER_KEYS ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);

  const byEmail = new Map<string, OFCredentials>();
  for (const key of keys) {
    const profile = readProfile(key);
    if (profile) byEmail.set(profile.username.toLowerCase(), profile);
  }
  return byEmail;
}

/** Legacy single-account configuration, used when no profile matches. */
function loadFallback(): OFCredentials | null {
  const clientId = process.env.OF_CLIENT_ID?.trim();
  const clientSecret = process.env.OF_CLIENT_SECRET?.trim();
  const username = process.env.OF_USERNAME?.trim();
  if (!clientId || !clientSecret || !username) return null;
  return { key: 'default', clientId, clientSecret, username };
}

/**
 * Resolves the Open Finance credentials for the logged-in user by matching the
 * app account email against each profile's OF_*_USERNAME.
 *
 * @returns the matching profile, the legacy OF_* fallback, or null when neither
 *          is configured.
 */
export function resolveOFCredentials(email: string): OFCredentials | null {
  const match = loadProfiles().get(email.trim().toLowerCase());
  if (match) return match;

  const fallback = loadFallback();
  if (fallback) {
    logger.warn(
      `No Open Finance profile for "${email}" — falling back to OF_CLIENT_ID/OF_CLIENT_SECRET/OF_USERNAME (${fallback.username}).`,
    );
  }
  return fallback;
}
