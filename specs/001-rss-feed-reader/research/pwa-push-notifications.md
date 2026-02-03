# PWA Push Notifications with Python Backend - Research & Best Practices

## Overview

This document covers the implementation patterns for PWA push notifications with a Python backend, including Web Push API requirements, VAPID authentication, and timezone-aware scheduled notifications.

---

## 1. Web Push API Requirements & Browser Support

### Core Requirements

The Push API enables web applications to receive push messages from a server, even when the app is not in the foreground or loaded.

**Key Requirements:**
- **HTTPS Required**: Push notifications only work in secure contexts (HTTPS or localhost)
- **Service Worker**: An active service worker must be registered to receive push events
- **User Permission**: Explicit user consent is required before subscribing to push notifications
- **VAPID Authentication**: Voluntary Application Server Identification for security

### Browser Support Matrix

| Feature         | Chrome | Firefox | Safari | Edge |
| --------------- | ------ | ------- | ------ | ---- |
| PushEvent       | 42+    | 44+     | 16+    | 17+  |
| PushManager     | 42+    | 44+     | 16+    | 17+  |
| PushMessageData | 50+    | 44+     | 16+    | 17+  |
| WebView Android | ❌      | -       | -      | -    |
| iOS WebView     | ❌      | -       | ❌      | -    |

**Important Notes:**
- Safari 16+ supports Push API on macOS
- Safari 16.4+ supports Push API on iOS (via Home Screen web apps)
- WebView does not support push notifications
- Chrome requires `userVisibleOnly: true` (must show a notification for each push)

### Push Service Architecture

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│   Backend   │────▶│ Push Service │────▶│   Browser    │
│   Server    │     │ (FCM/Mozilla)│     │  (Client)    │
└─────────────┘     └─────────────┘     └──────────────┘
       │                                       │
       └───────── VAPID Signed Request ────────┘
```

---

## 2. VAPID Keys & Subscription Management

### Understanding VAPID

VAPID (Voluntary Application Server Identification) provides a way for application servers to identify themselves to push services. This prevents unauthorized servers from sending messages to your users.

### Generating VAPID Keys

**Using OpenSSL (Recommended for Production):**
```bash
# Generate private key
openssl ecparam -name prime256v1 -genkey -noout -out private_key.pem

# Extract public key
openssl ec -in private_key.pem -pubout -out public_key.pem
```

**Using web-push CLI:**
```bash
npm install -g web-push
web-push generate-vapid-keys
```

**Using py_vapid (Python):**
```python
from py_vapid import Vapid

# Generate new keys
vapid = Vapid()
vapid.generate_keys()
vapid.save_key("private_key.pem")
vapid.save_public_key("public_key.pem")

# Or load existing keys
vapid = Vapid.from_file("private_key.pem")
public_key = vapid.public_key
```

### VAPID Claims Structure

```json
{
    "aud": "https://fcm.googleapis.com",
    "sub": "mailto:admin@yoursite.com",
    "exp": 1699718878
}
```

| Claim | Description                                                | Required     |
| ----- | ---------------------------------------------------------- | ------------ |
| `aud` | The origin of the push service (auto-filled from endpoint) | Optional     |
| `sub` | Contact email (mailto:) or URL for the sender              | **Required** |
| `exp` | Expiration timestamp (defaults to 12 hours if not set)     | Optional     |

### Client-Side Subscription Flow

```javascript
// 1. Check for support
if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
  console.log('Push notifications not supported');
  return;
}

// 2. Register service worker
const registration = await navigator.serviceWorker.register('/sw.js');

// 3. Request notification permission
const permission = await Notification.requestPermission();
if (permission !== 'granted') {
  throw new Error('Permission denied');
}

// 4. Subscribe to push
const subscription = await registration.pushManager.subscribe({
  userVisibleOnly: true,  // Required by Chrome
  applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
});

// 5. Send subscription to server
await fetch('/api/push/subscribe', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(subscription.toJSON())
});
```

### Subscription Object Structure

```json
{
  "endpoint": "https://fcm.googleapis.com/fcm/send/abc123...",
  "expirationTime": null,
  "keys": {
    "p256dh": "BGyyVt9FFV...",
    "auth": "R9sidzkcdf..."
  }
}
```

### Base64 URL Conversion Helper

```javascript
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
```

---

## 3. Python Libraries for Web Push Notifications

### pywebpush (Recommended)

**Installation:**
```bash
pip install pywebpush
```

**Current Version:** 2.2.0 (as of January 2026)

**Basic Usage:**
```python
from pywebpush import webpush, WebPushException

def send_push_notification(subscription_info: dict, message: str):
    """
    Send a push notification to a subscriber.
    
    Args:
        subscription_info: Dict containing endpoint and keys
        message: The notification payload (usually JSON string)
    """
    try:
        webpush(
            subscription_info=subscription_info,
            data=message,
            vapid_private_key="path/to/private_key.pem",
            vapid_claims={
                "sub": "mailto:admin@yoursite.com"
            }
        )
    except WebPushException as ex:
        print(f"Push failed: {repr(ex)}")
        if ex.response is not None:
            # Mozilla returns additional error info
            try:
                extra = ex.response.json()
                print(f"Error {extra.get('code')}: {extra.get('message')}")
            except:
                pass
```

**Sending JSON Payload:**
```python
import json

payload = json.dumps({
    "title": "New Article Available",
    "body": "Check out the latest post on your feed!",
    "icon": "/icons/notification-icon.png",
    "badge": "/icons/badge-icon.png",
    "url": "/feeds/123/articles/456",
    "tag": "new-article",
    "data": {
        "articleId": 456,
        "feedId": 123
    }
})

webpush(
    subscription_info=subscription,
    data=payload,
    vapid_private_key=VAPID_PRIVATE_KEY,
    vapid_claims={"sub": "mailto:admin@yoursite.com"},
    ttl=86400  # Message expires in 24 hours
)
```

### WebPusher Class for Repeated Sends

```python
from pywebpush import WebPusher

# Create pusher instance for a subscription
pusher = WebPusher(subscription_info)

# Send multiple messages
pusher.send(data="Message 1", ttl=3600)
pusher.send(data="Message 2", ttl=3600)
```

### Key Parameters

| Parameter           | Description                                        |
| ------------------- | -------------------------------------------------- |
| `subscription_info` | Dict with `endpoint` and `keys`                    |
| `data`              | Message payload (string, bytes, or JSON)           |
| `vapid_private_key` | Path to PEM file or base64 encoded DER             |
| `vapid_claims`      | Dict with `sub` (required), `aud`, `exp`           |
| `ttl`               | Time-to-live in seconds (default: 0 = immediate)   |
| `content_encoding`  | `'aes128gcm'` (default) or `'aesgcm'` (deprecated) |
| `timeout`           | Request timeout in seconds                         |

### Windows-Specific Headers

Microsoft requires additional headers for Edge/Windows notifications:

```python
# For Windows notifications
windows_headers = {
    "X-WNS-Type": "wns/toast",
    "TTL": 600,
    "Content-Type": "text/xml"
}

webpush(
    subscription_info=subscription,
    data=payload,
    headers=windows_headers,  # Add extra headers
    vapid_private_key=VAPID_PRIVATE_KEY,
    vapid_claims={"sub": "mailto:admin@yoursite.com"}
)
```

### Error Handling

```python
from pywebpush import WebPushException

try:
    webpush(...)
except WebPushException as e:
    if e.response is not None:
        status = e.response.status_code
        
        if status == 404 or status == 410:
            # Subscription expired or invalid - remove from database
            delete_subscription(subscription['endpoint'])
        elif status == 429:
            # Rate limited - implement backoff
            retry_after = e.response.headers.get('Retry-After', 60)
            schedule_retry(subscription, int(retry_after))
        elif status >= 500:
            # Push service error - retry later
            schedule_retry(subscription, 300)
```

---

## 4. Scheduling Notifications for User Local Times

### Timezone Handling Strategy

For RSS feed applications, users often want notifications at specific local times (e.g., "Daily digest at 8 AM"). This requires proper timezone handling.

### Database Schema Pattern

```python
from sqlalchemy import Column, String, Integer, Time, Boolean
from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()

class UserNotificationPreferences(Base):
    __tablename__ = 'user_notification_preferences'
    
    user_id = Column(Integer, primary_key=True)
    timezone = Column(String(50), default='UTC')  # IANA timezone name
    
    # Scheduled notification times
    daily_digest_enabled = Column(Boolean, default=False)
    daily_digest_time = Column(Time)  # Local time
    
    # Immediate notifications
    instant_notifications = Column(Boolean, default=True)
```

### Converting User Local Time to UTC

```python
from datetime import datetime, time
from zoneinfo import ZoneInfo

def get_next_notification_time(user_local_time: time, user_timezone: str) -> datetime:
    """
    Calculate the next UTC datetime for a user's local notification time.
    
    Args:
        user_local_time: The time in user's local timezone (e.g., 8:00 AM)
        user_timezone: IANA timezone name (e.g., 'America/New_York')
    
    Returns:
        UTC datetime for the next occurrence
    """
    tz = ZoneInfo(user_timezone)
    now = datetime.now(tz)
    
    # Create today's scheduled time in user's timezone
    scheduled = datetime.combine(now.date(), user_local_time, tzinfo=tz)
    
    # If time has passed today, schedule for tomorrow
    if scheduled <= now:
        scheduled = scheduled + timedelta(days=1)
    
    # Convert to UTC for storage/scheduling
    return scheduled.astimezone(ZoneInfo('UTC'))
```

### Celery Task for Scheduled Notifications

```python
from celery import Celery
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

app = Celery('notifications')

@app.task(bind=True, max_retries=3)
def send_scheduled_digest(self, user_id: int):
    """Send daily digest notification at user's preferred time."""
    try:
        user = get_user(user_id)
        preferences = get_notification_preferences(user_id)
        subscription = get_push_subscription(user_id)
        
        if not subscription or not preferences.daily_digest_enabled:
            return
        
        # Get unread articles since last digest
        articles = get_unread_articles(user_id, since=timedelta(days=1))
        
        if articles:
            payload = json.dumps({
                "title": f"📰 {len(articles)} new articles",
                "body": f"Your daily digest is ready!",
                "url": "/digest",
                "tag": "daily-digest",
                "data": {
                    "type": "digest",
                    "count": len(articles)
                }
            })
            
            send_push_notification(subscription, payload)
        
        # Schedule next day's notification
        schedule_next_digest(user_id, preferences)
        
    except Exception as e:
        raise self.retry(exc=e, countdown=60 * 5)


def schedule_next_digest(user_id: int, preferences):
    """Schedule the next day's digest notification."""
    next_time = get_next_notification_time(
        preferences.daily_digest_time,
        preferences.timezone
    )
    
    send_scheduled_digest.apply_async(
        args=[user_id],
        eta=next_time
    )
```

### APScheduler Alternative

```python
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

scheduler = AsyncIOScheduler()

def schedule_user_digest(user_id: int, local_time: time, timezone: str):
    """Schedule daily digest for a user at their local time."""
    job_id = f"digest_{user_id}"
    
    # Remove existing job if any
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
    
    # Add new job with timezone-aware trigger
    scheduler.add_job(
        send_digest_notification,
        CronTrigger(
            hour=local_time.hour,
            minute=local_time.minute,
            timezone=timezone
        ),
        id=job_id,
        args=[user_id],
        replace_existing=True
    )
```

### Frontend Timezone Detection

```javascript
// Get user's timezone
const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
// e.g., "America/New_York", "Europe/London", "Asia/Tokyo"

// Send to backend with subscription
await fetch('/api/user/preferences', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    timezone: userTimezone,
    dailyDigestTime: '08:00',  // Local time
    dailyDigestEnabled: true
  })
});
```

---

## 5. Service Worker Requirements for Vite React PWA

### vite-plugin-pwa Setup

**Installation:**
```bash
pnpm add -D vite-plugin-pwa
```

**vite.config.ts:**
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
      
      // Use injectManifest for custom service worker with push support
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      
      manifest: {
        name: 'My Feeds - RSS Reader',
        short_name: 'My Feeds',
        description: 'A modern RSS feed reader with push notifications',
        theme_color: '#1a1a2e',
        background_color: '#1a1a2e',
        display: 'standalone',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
      
      devOptions: {
        enabled: true,  // Enable SW in development
        type: 'module',
      },
    }),
  ],
});
```

### Custom Service Worker with Push Support (src/sw.ts)

```typescript
/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';

declare let self: ServiceWorkerGlobalScope;

// Precache static assets
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Take control immediately
self.skipWaiting();
clientsClaim();

// Push notification handler
self.addEventListener('push', (event: PushEvent) => {
  console.log('Push received:', event);
  
  if (!event.data) {
    console.log('No data in push event');
    return;
  }
  
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = {
      title: 'New Notification',
      body: event.data.text(),
    };
  }
  
  const options: NotificationOptions = {
    body: payload.body,
    icon: payload.icon || '/icons/icon-192.png',
    badge: payload.badge || '/icons/badge-72.png',
    image: payload.image,
    tag: payload.tag || 'default',
    renotify: payload.renotify || false,
    requireInteraction: payload.requireInteraction || false,
    silent: payload.silent || false,
    data: {
      url: payload.url || '/',
      ...payload.data,
    },
    actions: payload.actions || [],
  };
  
  event.waitUntil(
    self.registration.showNotification(payload.title, options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  console.log('Notification clicked:', event.action);
  
  event.notification.close();
  
  const urlToOpen = event.notification.data?.url || '/';
  
  // Handle action buttons
  if (event.action) {
    switch (event.action) {
      case 'open':
        // Default - handled below
        break;
      case 'dismiss':
        return; // Just close, don't open
      case 'mark-read':
        // Send API request to mark as read
        fetch('/api/notifications/mark-read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            articleId: event.notification.data?.articleId,
          }),
        });
        return;
    }
  }
  
  // Open or focus the app
  event.waitUntil(
    self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    }).then((windowClients) => {
      // Check if app is already open
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin)) {
          // Focus existing window and navigate
          client.focus();
          client.navigate(urlToOpen);
          return;
        }
      }
      // Open new window
      return self.clients.openWindow(urlToOpen);
    })
  );
});

// Notification close handler (for analytics)
self.addEventListener('notificationclose', (event: NotificationEvent) => {
  console.log('Notification closed without interaction');
  
  // Track dismissal
  fetch('/api/analytics/notification-dismissed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag: event.notification.tag,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
});

// Handle subscription changes
self.addEventListener('pushsubscriptionchange', (event: any) => {
  console.log('Push subscription changed');
  
  event.waitUntil(
    self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: (self as any).VAPID_PUBLIC_KEY,
    }).then((subscription) => {
      return fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      });
    })
  );
});
```

### React Hook for Push Subscription

```typescript
// src/hooks/usePushNotifications.ts
import { useState, useCallback, useEffect } from 'react';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

interface UsePushNotificationsReturn {
  isSupported: boolean;
  isSubscribed: boolean;
  permission: NotificationPermission;
  subscribe: () => Promise<PushSubscription | null>;
  unsubscribe: () => Promise<boolean>;
}

export function usePushNotifications(): UsePushNotificationsReturn {
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');

  useEffect(() => {
    const supported = 'serviceWorker' in navigator && 
                      'PushManager' in window && 
                      'Notification' in window;
    setIsSupported(supported);
    
    if (supported) {
      setPermission(Notification.permission);
      checkSubscription();
    }
  }, []);

  const checkSubscription = async () => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      setIsSubscribed(!!subscription);
    } catch (error) {
      console.error('Error checking subscription:', error);
    }
  };

  const subscribe = useCallback(async (): Promise<PushSubscription | null> => {
    if (!isSupported) return null;

    try {
      // Request permission
      const result = await Notification.requestPermission();
      setPermission(result);
      
      if (result !== 'granted') {
        throw new Error('Permission denied');
      }

      // Get subscription
      const registration = await navigator.serviceWorker.ready;
      
      let subscription = await registration.pushManager.getSubscription();
      
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }

      // Send to server
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      });

      setIsSubscribed(true);
      return subscription;
    } catch (error) {
      console.error('Failed to subscribe:', error);
      return null;
    }
  }, [isSupported]);

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      
      if (subscription) {
        await subscription.unsubscribe();
        
        // Notify server
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
      }
      
      setIsSubscribed(false);
      return true;
    } catch (error) {
      console.error('Failed to unsubscribe:', error);
      return false;
    }
  }, []);

  return {
    isSupported,
    isSubscribed,
    permission,
    subscribe,
    unsubscribe,
  };
}
```

---

## 6. Notification Payload Best Practices & Deep Linking

### Payload Structure

```typescript
interface NotificationPayload {
  // Visual options
  title: string;                    // Main notification title
  body: string;                     // Body text (keep concise)
  icon?: string;                    // Small icon (192px recommended)
  badge?: string;                   // Monochrome badge (72px)
  image?: string;                   // Large preview image
  
  // Behavioral options
  tag?: string;                     // Group/replace notifications with same tag
  renotify?: boolean;               // Sound/vibrate on replace (requires tag)
  requireInteraction?: boolean;     // Stay until user interacts
  silent?: boolean;                 // No sound/vibration
  
  // Action buttons (max 2-3)
  actions?: Array<{
    action: string;                 // Action identifier
    title: string;                  // Button label
    icon?: string;                  // Button icon
    type?: 'button' | 'text';       // Text for inline replies
    placeholder?: string;           // Placeholder for text input
  }>;
  
  // Custom data for click handling
  data?: {
    url: string;                    // Deep link URL
    [key: string]: any;             // Additional data
  };
}
```

### Best Practice Payload Examples

**New Article Notification:**
```python
payload = {
    "title": "📰 TechCrunch",
    "body": "Apple announces new M4 chip with breakthrough AI capabilities",
    "icon": "/feeds/techcrunch/icon.png",
    "badge": "/icons/badge.png",
    "image": "/article-preview.jpg",  # Optional thumbnail
    "tag": "feed-techcrunch",  # Collapse multiple from same feed
    "url": "/feeds/123/articles/456",
    "data": {
        "type": "new-article",
        "feedId": 123,
        "articleId": 456,
        "feedName": "TechCrunch"
    },
    "actions": [
        {"action": "open", "title": "Read", "type": "button"},
        {"action": "mark-read", "title": "Mark Read", "type": "button"}
    ]
}
```

**Daily Digest:**
```python
payload = {
    "title": "📬 Daily Digest",
    "body": "12 new articles from 5 feeds",
    "icon": "/icons/digest.png",
    "badge": "/icons/badge.png",
    "tag": "daily-digest",  # Only one digest notification
    "requireInteraction": True,  # Don't auto-dismiss
    "url": "/digest",
    "data": {
        "type": "digest",
        "articleCount": 12,
        "feedCount": 5
    }
}
```

**Feed Update Error:**
```python
payload = {
    "title": "⚠️ Feed Error",
    "body": "Unable to update 'TechCrunch' - the feed URL may have changed",
    "icon": "/icons/warning.png",
    "tag": "feed-error-123",
    "url": "/feeds/123/settings",
    "data": {
        "type": "feed-error",
        "feedId": 123
    },
    "actions": [
        {"action": "fix", "title": "Fix Now", "type": "button"},
        {"action": "dismiss", "title": "Dismiss", "type": "button"}
    ]
}
```

### Deep Linking Implementation

**Service Worker Click Handler:**
```typescript
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  
  const data = event.notification.data;
  let url = data?.url || '/';
  
  // Handle action-specific URLs
  if (event.action === 'fix') {
    url = `/feeds/${data.feedId}/settings`;
  } else if (event.action === 'mark-read') {
    // API call without navigation
    fetch(`/api/articles/${data.articleId}/read`, { method: 'POST' });
    return;
  }
  
  event.waitUntil(openOrFocusWindow(url));
});

async function openOrFocusWindow(url: string) {
  const clients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });
  
  // Try to find and focus existing window
  for (const client of clients) {
    if (new URL(client.url).origin === self.location.origin) {
      await client.focus();
      // Use postMessage to navigate within SPA
      client.postMessage({ type: 'NAVIGATE', url });
      return;
    }
  }
  
  // Open new window
  return self.clients.openWindow(url);
}
```

**React App Navigation Handler:**
```typescript
// In your App component or root layout
useEffect(() => {
  const handleServiceWorkerMessage = (event: MessageEvent) => {
    if (event.data?.type === 'NAVIGATE') {
      navigate(event.data.url);
    }
  };
  
  navigator.serviceWorker?.addEventListener('message', handleServiceWorkerMessage);
  
  return () => {
    navigator.serviceWorker?.removeEventListener('message', handleServiceWorkerMessage);
  };
}, [navigate]);
```

### UX Best Practices

1. **Don't duplicate domain in title/body** - Browser already shows your site name
2. **Be specific and actionable** - "John sent you a message" > "New notification"
3. **Use icons effectively** - 192px for icon, 72px for badge
4. **Limit actions to 2-3** - More confuses users
5. **Use tags to collapse similar notifications** - Avoid notification spam
6. **Make deep links meaningful** - Take user directly to relevant content
7. **Respect quiet hours** - Use timezone-aware scheduling
8. **Provide easy opt-out** - In-app notification settings

### Notification Permission UX

```typescript
// DON'T: Ask immediately on page load
// DO: Ask in context after user engagement

function NotificationPrompt() {
  const { isSupported, permission, subscribe } = usePushNotifications();
  
  if (!isSupported || permission === 'denied') return null;
  if (permission === 'granted') return null;
  
  return (
    <div className="notification-prompt">
      <p>Get notified when new articles are published!</p>
      <button onClick={subscribe}>Enable Notifications</button>
      <button onClick={() => /* dismiss prompt */}>Not now</button>
    </div>
  );
}
```

---

## Summary Checklist

### Backend Setup
- [ ] Install pywebpush: `pip install pywebpush`
- [ ] Generate VAPID keys (store private key securely)
- [ ] Create API endpoints for subscribe/unsubscribe
- [ ] Store subscriptions in database with user association
- [ ] Implement error handling for expired subscriptions
- [ ] Set up scheduled task system (Celery/APScheduler)

### Frontend Setup
- [ ] Install vite-plugin-pwa
- [ ] Configure PWA manifest
- [ ] Create custom service worker with push handlers
- [ ] Implement subscription management hook
- [ ] Add notification permission UI with good UX
- [ ] Handle deep linking from notifications
- [ ] Capture user timezone

### Notification Design
- [ ] Design payload structure for different notification types
- [ ] Use tags to prevent notification spam
- [ ] Include meaningful deep links
- [ ] Add action buttons for quick interactions
- [ ] Test on multiple browsers and platforms

---

## References

- [MDN Push API Documentation](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
- [web.dev Push Notifications Guide](https://web.dev/articles/push-notifications-overview)
- [pywebpush GitHub](https://github.com/web-push-libs/pywebpush)
- [py_vapid GitHub](https://github.com/web-push-libs/vapid/tree/main/python)
- [Vite PWA Plugin](https://vite-pwa-org.netlify.app/)
- [VAPID Specification](https://datatracker.ietf.org/doc/draft-ietf-webpush-vapid/)
