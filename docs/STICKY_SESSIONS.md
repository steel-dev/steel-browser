# Sticky Sessions

Sticky sessions allow you to persist browser state across multiple sessions for the same user. This feature is essential for browser automation scenarios where you need to maintain consistent fingerprints, cookies, localStorage, and other session data between browser instances.

## Features

- **90-day session persistence** - Session data is automatically saved and expires after 90 days of inactivity
- **Redis-based storage** - Fast, scalable session data persistence using Redis
- **Automatic state restoration** - Browser cookies, localStorage, sessionStorage, and user agent are automatically restored
- **Timezone support** - Optional timezone parameter to ensure consistent browser fingerprinting
- **User-based isolation** - Each user (identified by UUID) has their own isolated session data
- **Graceful degradation** - Service continues to work if Redis is unavailable

## Configuration

### Environment Variables

Add the following environment variables to enable sticky sessions:

```bash
# Enable session persistence
ENABLE_SESSION_PERSISTENCE=true

# Redis connection (Option 1: Use full URL)
REDIS_URL=redis://localhost:6379/0

# Redis connection (Option 2: Individual parameters)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_password  # optional
REDIS_DB=0                     # optional, defaults to 0
```

### Docker Compose Example

```yaml
services:
  steel-browser:
    environment:
      - ENABLE_SESSION_PERSISTENCE=true
      - REDIS_URL=redis://redis:6379/0
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data

volumes:
  redis-data:
```

## Usage

### Basic Usage

To use sticky sessions, simply provide a `userId` when creating a session:

```typescript
import { Client } from '@steel-browser/client';

const client = new Client({
  apiKey: 'your-api-key',
  apiUrl: 'http://localhost:3000'
});

// Create session with userId to enable sticky sessions
const session = await client.sessions.create({
  userId: '550e8400-e29b-41d4-a716-446655440000',
  blockAds: true
});

// Session data is automatically loaded from Redis!
// Navigate, interact with the browser...
await client.actions.navigate(session.id, { url: 'https://example.com' });

// When you release the session, data is automatically saved
await client.sessions.release(session.id);
```

### With Timezone

You can specify a timezone to ensure consistent fingerprinting across sessions:

```typescript
const session = await client.sessions.create({
  userId: '550e8400-e29b-41d4-a716-446655440000',
  timezone: 'America/New_York',
  dimensions: { width: 1280, height: 800 }
});
```

The timezone will be:
1. Used from the explicit `timezone` parameter if provided
2. Loaded from persisted session data if available
3. Detected from proxy if proxy is used
4. Default to system timezone

### cURL Example

```bash
# Create session with userId
curl -X POST http://localhost:3000/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "550e8400-e29b-41d4-a716-446655440000",
    "timezone": "America/New_York",
    "blockAds": true
  }'

# Session data is automatically restored and will be saved on release
```

### Python SDK Example

```python
from steel import Steel

steel = Steel(api_key="your-api-key", api_url="http://localhost:3000")

# Create session with userId
session = steel.sessions.create(
    user_id="550e8400-e29b-41d4-a716-446655440000",
    timezone="America/New_York",
    block_ads=True
)

# Use the session...
steel.actions.navigate(session.id, url="https://example.com")

# Release session (data is automatically saved)
steel.sessions.release(session.id)
```

## How It Works

### Session Data Persistence

When you create a session with a `userId`:

1. **Load Phase**: The system checks Redis for existing session data
   - If found, cookies, localStorage, sessionStorage, user agent, and timezone are restored
   - Data is merged with any explicitly provided session context

2. **Active Phase**: You can interact with the browser normally
   - All browser state changes (cookies, localStorage, etc.) are tracked

3. **Save Phase**: When the session is released
   - Current browser state is extracted
   - Data is saved to Redis with the user's ID as the key
   - TTL is set to 90 days and refreshed on each access

### Data Stored

For each user, the following data is persisted:

```typescript
{
  cookies: [...],              // Array of cookie objects
  localStorage: {...},          // localStorage data by domain
  sessionStorage: {...},        // sessionStorage data by domain
  userAgent: "...",            // User agent string
  timezone: "America/New_York" // Timezone (if specified)
}
```

### Redis Keys

Session data is stored with the key format:
```
steel:session:{userId}
```

Example: `steel:session:550e8400-e29b-41d4-a716-446655440000`

## Use Cases

### E-commerce Automation

Maintain shopping cart and login state across automation runs:

```typescript
const session = await client.sessions.create({
  userId: `user-${accountId}`,
  timezone: 'America/Los_Angeles'
});

// First run: Login and add items to cart
// Subsequent runs: Cart and login state are automatically restored
```

### Social Media Automation

Keep users logged in and maintain consistent browser fingerprints:

```typescript
const session = await client.sessions.create({
  userId: `social-${platformUserId}`,
  timezone: 'Europe/London',
  blockAds: true
});

// Browser fingerprint and login cookies persist across runs
```

### Multi-User Scenarios

Isolate session data per user in a multi-tenant system:

```typescript
for (const user of users) {
  const session = await client.sessions.create({
    userId: user.uuid,
    timezone: user.timezone,
    dimensions: { width: 1920, height: 1080 }
  });

  // Each user has isolated, persistent session data
  await automateTask(session.id, user);
  await client.sessions.release(session.id);
}
```

## API Reference

### Session Creation

**Endpoint**: `POST /v1/sessions`

**New Parameters**:
- `userId` (string, optional): User identifier for session persistence
- `timezone` (string, optional): IANA timezone name (e.g., "America/New_York")

**Example Request**:
```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "timezone": "America/New_York",
  "blockAds": true,
  "dimensions": {
    "width": 1280,
    "height": 800
  }
}
```

## Troubleshooting

### Session data is not persisting

1. **Check Redis connection**:
   ```bash
   redis-cli ping
   # Should return: PONG
   ```

2. **Verify environment variables**:
   ```bash
   echo $ENABLE_SESSION_PERSISTENCE  # Should be 'true'
   echo $REDIS_URL                   # Should be set
   ```

3. **Check logs** for Redis connection errors:
   ```bash
   # Look for messages like:
   # "Session persistence service connected to Redis"
   # or error messages about Redis connection
   ```

### Session data loads but doesn't save

- Ensure you're properly releasing sessions with `sessions.release()`
- Check that the browser state is accessible before session ends
- Review server logs for any errors during the save operation

### Different fingerprints across sessions

- Ensure you're passing the same `timezone` parameter or letting it be loaded from persisted data
- Verify that `userId` is consistent across session creations
- Check that `userAgent` is being properly restored from persisted data

### Redis memory issues

Session data has a 90-day TTL and is automatically cleaned up. If you need to manually clear data:

```bash
# Clear all session data (use with caution!)
redis-cli --scan --pattern "steel:session:*" | xargs redis-cli del

# Clear specific user's session
redis-cli del "steel:session:550e8400-e29b-41d4-a716-446655440000"
```

## Security Considerations

1. **User ID Privacy**: User IDs are stored as-is in Redis. Consider hashing sensitive identifiers.

2. **Redis Security**:
   - Use password authentication (`REDIS_PASSWORD`)
   - Enable TLS for production: `rediss://` URL scheme
   - Restrict Redis network access

3. **Data Encryption**: Session data is stored unencrypted in Redis. For sensitive data:
   - Use Redis encryption at rest
   - Consider application-level encryption for cookies/localStorage

4. **Access Control**: Ensure proper authentication before allowing session creation with userId

## Performance

- **Overhead**: ~10-50ms added to session creation and release
- **Storage**: ~1-10KB per user (varies by cookies/localStorage size)
- **Scalability**: Redis supports millions of keys; suitable for large-scale automation

## Limitations

- Session data is tied to Redis availability
- Maximum session data size limited by Redis string value limit (512MB, but typically much smaller)
- TTL is fixed at 90 days (can be modified in code if needed)
- Does not persist file downloads or other file system state
