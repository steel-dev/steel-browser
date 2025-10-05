import { FastifyBaseLogger } from "fastify";
import { createClient, RedisClientType } from "redis";
import { z } from "zod";
import { env } from "../env.js";
import { CookieData } from "./context/types.js";
import type { BrowserFingerprintWithHeaders } from "fingerprint-generator";

/**
 * Zod schema for validating persisted session data
 */
const PersistedSessionDataSchema = z.object({
  cookies: z.array(z.any()), // CookieData validation would require importing the full schema
  localStorage: z.record(z.string(), z.record(z.string(), z.string())),
  sessionStorage: z.record(z.string(), z.record(z.string(), z.string())),
  userAgent: z.string().optional(),
  timezone: z.string().optional(),
  fingerprint: z.any().optional(), // BrowserFingerprintWithHeaders is complex, using z.any() for flexibility
  dimensions: z.object({ width: z.number(), height: z.number() }).optional(),
  operatingSystem: z.string().optional(),
  browserType: z.string().optional(),
  deviceType: z.string().optional(),
});

/**
 * Interface for session data that is persisted to Redis
 * @interface PersistedSessionData
 */
export interface PersistedSessionData {
  cookies: CookieData[];
  /** Domain-specific localStorage entries. Note: localStorage values are strings per web standards */
  localStorage: Record<string, Record<string, string>>;
  /** Domain-specific sessionStorage entries. Note: sessionStorage is intentionally persisted to maintain browser fingerprint consistency across sessions */
  sessionStorage: Record<string, Record<string, string>>;
  userAgent?: string;
  timezone?: string;
  /** Browser fingerprint data to maintain consistent fingerprinting across sessions */
  fingerprint?: BrowserFingerprintWithHeaders;
  /** Screen dimensions to maintain consistent fingerprinting across sessions */
  dimensions?: { width: number; height: number };
  /** Operating system for fingerprint consistency (windows, macos, linux) */
  operatingSystem?: string;
  /** Browser type for fingerprint consistency (chrome, edge, firefox) */
  browserType?: string;
  /** Device type for fingerprint consistency (desktop, mobile) */
  deviceType?: string;
}

/**
 * Service for persisting browser session data to Redis
 * Maintains session state across multiple browser instances for the same user
 */
export class SessionPersistenceService {
  private client: RedisClientType | null = null;
  private logger: FastifyBaseLogger;
  private isEnabled: boolean;
  private readonly TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days in seconds
  private readonly MAX_SESSION_SIZE_MB = 1; // Warn when session data exceeds this size

  constructor(logger: FastifyBaseLogger) {
    this.logger = logger;
    this.isEnabled = env.ENABLE_SESSION_PERSISTENCE === true;
  }

  /**
   * Initialize Redis connection with exponential backoff retry logic
   * Attempts to connect up to 3 times with delays of 1s, 2s, and 4s
   */
  async connect(): Promise<void> {
    if (!this.isEnabled) {
      this.logger.info("Session persistence is disabled");
      return;
    }

    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        const redisUrl = env.REDIS_URL || this.buildRedisUrl();

        this.client = createClient({
          url: redisUrl,
        });

        this.client.on("error", (err) => {
          this.logger.error({ err }, "Redis client error");
        });

        this.client.on("disconnect", () => {
          this.logger.warn("Redis client disconnected - session persistence unavailable");
        });

        this.client.on("reconnecting", () => {
          this.logger.info("Redis client reconnecting...");
        });

        await this.client.connect();
        this.logger.info("Session persistence service connected to Redis");
        return;
      } catch (error) {
        attempt++;
        this.logger.error(
          { error, attempt },
          `Failed to connect to Redis (attempt ${attempt}/${maxRetries})`,
        );

        if (attempt >= maxRetries) {
          this.logger.warn(
            "Max Redis connection retries reached. Session persistence will be disabled.",
          );
          if (this.client) {
            this.client.removeAllListeners(); // Clean up event listeners
          }
          this.client = null;
          return;
        }

        // Exponential backoff: 2^attempt * 1000ms (1s, 2s, 4s)
        const backoffMs = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  /**
   * Build Redis URL from individual environment variables
   */
  private buildRedisUrl(): string {
    const host = env.REDIS_HOST || "localhost";
    const port = env.REDIS_PORT || 6379;
    const password = env.REDIS_PASSWORD;
    const db = env.REDIS_DB || 0;

    if (password) {
      return `redis://:${password}@${host}:${port}/${db}`;
    }
    return `redis://${host}:${port}/${db}`;
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.logger.info("Session persistence service disconnected from Redis");
    }
  }

  /**
   * Save session data for a user to Redis with automatic TTL
   * @param userId - Unique identifier for the user
   * @param sessionData - Browser session data to persist
   * @throws Will log error but not throw if save fails (graceful degradation)
   */
  async saveSession(userId: string, sessionData: PersistedSessionData): Promise<void> {
    if (!this.client || !this.isEnabled) {
      return;
    }

    try {
      const key = this.getKey(userId);
      const serialized = JSON.stringify(sessionData);
      const sizeInMB = Buffer.byteLength(serialized, "utf8") / (1024 * 1024);

      // Warn if session data is larger than threshold
      if (sizeInMB > this.MAX_SESSION_SIZE_MB) {
        this.logger.warn(
          { userId, sizeInMB: sizeInMB.toFixed(2) },
          "Large session data detected - consider reviewing what is being stored",
        );
      }

      await this.client.setEx(key, this.TTL_SECONDS, serialized);
      this.logger.debug({ userId }, "Session data saved for user");
    } catch (error) {
      this.logger.error({ error, userId }, "Failed to save session data");
    }
  }

  /**
   * Load session data for a user from Redis
   * Automatically refreshes TTL on access to keep active sessions alive
   * @param userId - Unique identifier for the user
   * @returns Session data if found, null if not found or on error
   * @throws Will log error but return null if load fails (graceful degradation)
   */
  async loadSession(userId: string): Promise<PersistedSessionData | null> {
    if (!this.client || !this.isEnabled) {
      return null;
    }

    try {
      const key = this.getKey(userId);
      const data = await this.client.get(key);

      if (!data) {
        this.logger.debug({ userId }, "No session data found for user");
        return null;
      }

      // Refresh TTL on access
      await this.client.expire(key, this.TTL_SECONDS);

      try {
        const parsed = JSON.parse(data);
        // Validate the parsed data against schema
        const sessionData = PersistedSessionDataSchema.parse(parsed);
        this.logger.debug({ userId }, "Session data loaded for user");
        return sessionData as PersistedSessionData;
      } catch (parseError) {
        this.logger.error(
          { error: parseError, userId },
          "Failed to parse or validate session data, removing corrupt data",
        );
        // Clean up corrupt data automatically
        await this.client.del(key);
        return null;
      }
    } catch (error) {
      this.logger.error({ error, userId }, "Failed to load session data");
      return null;
    }
  }

  /**
   * Delete session data for a user from Redis
   * @param userId - Unique identifier for the user
   * @throws Will log error but not throw if deletion fails (graceful degradation)
   */
  async deleteSession(userId: string): Promise<void> {
    if (!this.client || !this.isEnabled) {
      return;
    }

    try {
      const key = this.getKey(userId);
      await this.client.del(key);
      this.logger.debug({ userId }, "Session data deleted for user");
    } catch (error) {
      this.logger.error({ error, userId }, "Failed to delete session data");
    }
  }

  /**
   * Generate Redis key for a user's session
   */
  private getKey(userId: string): string {
    return `steel:session:${userId}`;
  }

  /**
   * Check if the service is ready to use
   * @returns True if session persistence is enabled and Redis client is connected
   */
  isReady(): boolean {
    return this.isEnabled && this.client !== null;
  }
}
