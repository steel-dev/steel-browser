/**
 * Sticky Session Example
 *
 * This example demonstrates how to use sticky sessions to persist browser state
 * across multiple automation runs for the same user.
 */

import { Client } from '@steel-browser/client';

async function main() {
  const client = new Client({
    apiKey: 'your-api-key',
    apiUrl: 'http://localhost:3000'
  });

  // User identifier - this could be a UUID, user ID, or any unique identifier
  const userId = '550e8400-e29b-41d4-a716-446655440000';

  console.log('Creating session with sticky session support...');

  // Create session with userId to enable sticky sessions
  const session = await client.sessions.create({
    userId: userId,
    timezone: 'America/New_York', // Optional: ensures consistent fingerprint
    blockAds: true,
    dimensions: {
      width: 1280,
      height: 800
    }
  });

  console.log(`Session created: ${session.id}`);
  console.log('Session data (cookies, localStorage, etc.) automatically restored from previous runs!');

  // Navigate to a website
  await client.actions.navigate(session.id, {
    url: 'https://example.com'
  });

  // Perform some actions...
  console.log('Performing browser actions...');

  // The browser state (cookies, localStorage, etc.) will be automatically
  // saved when the session is released
  console.log('Releasing session and saving state...');
  await client.sessions.release(session.id);

  console.log('Session data saved! It will be restored in the next run with the same userId.');
  console.log('Data persists for 90 days of inactivity.');
}

main().catch(console.error);
