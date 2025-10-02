import { FastifyBaseLogger } from "fastify";
import { createClient, RedisClientType } from "redis";
import { env } from "../env.js";
import { CookieData } from "./context/types.js";

export interface PersistedSessionData {
  cookies: CookieData[];
  localStorage: Record<string, Record<string, any>>;
  sessionStorage: Record<string, Record<string, any>>;
  userAgent?: string;
  timezone?: string;
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

  constructor(logger: FastifyBaseLogger) {
    this.logger = logger;
    this.isEnabled = env.ENABLE_SESSION_PERSISTENCE === true;
  }

  /**
   * Initialize Redis connection
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

        await this.client.connect();
        this.logger.info("Session persistence service connected to Redis");
        return;
      } catch (error) {
        attempt++;
        this.logger.error({ error, attempt }, `Failed to connect to Redis (attempt ${attempt}/${maxRetries})`);

        if (attempt >= maxRetries) {
          this.logger.warn("Max Redis connection retries reached. Session persistence will be disabled.");
          this.client = null;
          return;
        }

        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
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
   * Save session data for a user
   */
  async saveSession(userId: string, sessionData: PersistedSessionData): Promise<void> {
    if (!this.client || !this.isEnabled) {
      return;
    }

    try {
      const key = this.getKey(userId);
      await this.client.setEx(key, this.TTL_SECONDS, JSON.stringify(sessionData));
      this.logger.debug({ userId }, "Session data saved for user");
    } catch (error) {
      this.logger.error({ error, userId }, "Failed to save session data");
    }
  }

  /**
   * Load session data for a user
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
        const sessionData = JSON.parse(data) as PersistedSessionData;
        this.logger.debug({ userId }, "Session data loaded for user");
        return sessionData;
      } catch (parseError) {
        this.logger.error({ error: parseError, userId }, "Failed to parse session data, removing corrupt data");
        // Clean up corrupt data
        await this.client.del(key);
        return null;
      }
    } catch (error) {
      this.logger.error({ error, userId }, "Failed to load session data");
      return null;
    }
  }

  /**
   * Delete session data for a user
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
   */
  isReady(): boolean {
    return this.isEnabled && this.client !== null;
  }
}
