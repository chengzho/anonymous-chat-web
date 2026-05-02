# Frontend Design Document

## Overview

一個 responsive web application (RWD) web，用於匿名即時聊天。前端使用 React + Vite + TypeScript 建置，並部署於 GitHub Pages。

**Repository:** `git@github.com:chengzho/anonymous-chat-web.git`
**Code location:** `webui/`

## Tech Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| React | 18+ | UI framework |
| TypeScript | 5+ | Type safety |
| Vite | 5+ | Build tooling and dev server |
| CSS | (TBD) | Styling — design scheme to be provided separately |

## Application Flow

```text
┌────────────────────────┐
│  1. Welcome Screen     │
│                        │
│      匿名聊天室         │
│                        │
│  暱稱:                 │
│  [________________]    │
│                        │
│  進入密碼:              │
│  [________________]    │
│                        │
│  [  進入聊天室  ]       │
└───────────┬────────────┘
            │ callsign and passcode submitted
            │ WebSocket connection accepted
            ▼
┌────────────────────────┐
│  2. Chat Screen        │
│                        │
│  Status: Connected     │
│  ┌──────────────────┐  │
│  │ Message List     │  │
│  │ (scrollable)     │  │
│  │                  │  │
│  │ A: Hello         │  │
│  │ B: Hey!          │  │
│  │                  │  │
│  └──────────────────┘  │
│                        │
│  ┌────────────┐ [Send] │
│  │ Type here..│        │
│  └────────────┘        │
│                        │
└────────────────────────┘
```

## Screens

### Screen 1: Welcome Screen

**Purpose:** 讓使用者輸入暱稱與 shared access passcode。前端會將暱稱對應到後端 API 使用的 `callsign` 參數。

**Elements:**

| Element | Type | Behavior |
|---------|------|----------|
| App title | Text | Display `匿名聊天室` |
| Nickname input | Text input | Captures the user's display name; mapped to the `callsign` field in backend requests |
| Passcode input | Password input | Required. Sent to backend during WebSocket connection |
| Enter Chat button | Button | Validates input format, initiates WebSocket connection |
| Error message | Text (conditional) | Shown if input is invalid or connection fails |

**Validation (client-side):**

Nickname:
- Not empty
- 1–20 characters
- Matches `^[a-zA-Z0-9_]{1,20}$`

Passcode:
- Not empty
- The frontend does not validate whether the passcode is correct
- The correct passcode must not be hardcoded in frontend code

**On Enter Chat:**

1. Validate nickname format
2. Validate passcode is not empty
3. Open WebSocket:

```
wss://{endpoint}?callsign={callsign}&passcode={passcode}
```

4. The frontend must use `encodeURIComponent` for both `callsign` and `passcode`
5. On successful connection → transition to Chat Screen
6. On connection failure → display error message

### Screen 2: Chat Screen

**Purpose:** Display messages and allow sending.

**Elements:**

| Element | Type | Behavior |
|---------|------|----------|
| Message list | Scrollable container | Displays all received messages, auto-scrolls to bottom on new message |
| Message input | Text input | Max 1000 chars |
| Send button | Button | Sends message via WebSocket |
| Connection status | Indicator | Shows connected/disconnected/reconnecting state |

**Message display format:**

- **Chat message:** `[callsign]: text` with timestamp
- **System message (join):** `[system] CoolDog joined`, if system events are enabled
- **System message (leave):** `[system] CoolDog left`, if system events are enabled
- **Own messages:** Visually distinct from others, such as aligned right or different background

## WebSocket Integration

### Configuration

```typescript
// WebSocket endpoint — configurable via environment variable
const WS_ENDPOINT = import.meta.env.VITE_WS_ENDPOINT || "wss://default.execute-api.us-west-2.amazonaws.com/prod";
```

### Connection Lifecycle

```typescript
// Connect
const ws = new WebSocket(
  `${WS_ENDPOINT}?callsign=${encodeURIComponent(callsign)}&passcode=${encodeURIComponent(passcode)}`
);

// Receive messages
ws.onmessage = (event: MessageEvent) => {
  const data = JSON.parse(event.data);
  // data.type === "message" | "system"
  // Append to message list
};

// Send message
const sendMessage = (text: string) => {
  ws.send(JSON.stringify({
    action: "sendMessage",
    text: text,
  }));
};

// Handle disconnect
ws.onclose = (event: CloseEvent) => {
  // Update status indicator
  // Optionally attempt reconnect
};

// Handle errors
ws.onerror = (event: Event) => {
  // Update status indicator
  // Log error
};
```

**Important:** The frontend only sends the user-entered passcode during the WebSocket `$connect` handshake. The frontend must not store or validate the correct passcode.

### Reconnection Strategy

On unexpected disconnect:

1. Show "Disconnected" status
2. Wait 2 seconds, attempt reconnect
3. On success → rejoin with the same callsign and passcode, show "Reconnected" status
4. On failure → exponential backoff (2s, 4s, 8s, max 30s)
5. After 5 failed attempts → show "Connection lost" with manual reconnect button

## TypeScript Interfaces

```typescript
// Incoming messages from server
interface ChatMessage {
  type: "message";
  callsign: string;
  text: string;
  timestamp: string;  // ISO 8601
}

interface SystemEvent {
  type: "system";
  event: "user_joined" | "user_left";
  callsign: string;
  timestamp: string;
}

type ServerMessage = ChatMessage | SystemEvent;

// Outgoing message to server
interface SendMessagePayload {
  action: "sendMessage";
  text: string;
}

// Application state
interface AppState {
  screen: "welcome" | "chat";
  callsign: string;
  messages: ServerMessage[];
  connectionStatus: "connecting" | "connected" | "disconnected" | "reconnecting";
  inputText: string;
}
```

## Component Structure

```
webui/src/
├── App.tsx                  # Root: routes between WelcomeScreen and ChatScreen
├── main.tsx                 # Entry point
├── components/
│   ├── WelcomeScreen.tsx    # App title + nickname input + passcode input + enter button
│   ├── ChatScreen.tsx       # Message list + input + status
│   ├── MessageList.tsx      # Scrollable message container
│   ├── MessageItem.tsx      # Single message rendering
│   ├── MessageInput.tsx     # Text input + send button
│   └── StatusIndicator.tsx  # Connection status display
├── hooks/
│   └── useWebSocket.ts      # WebSocket connection management hook
├── types/
│   └── index.ts             # TypeScript interfaces
├── config.ts                # Environment-based configuration
└── styles/                  # (TBD — design scheme provided separately)
```

## Responsive Design (RWD) Requirements

The app must work on both mobile and desktop browsers.

**Breakpoints:**

| Breakpoint | Target |
|-----------|--------|
| < 480px | Mobile portrait |
| 480–768px | Mobile landscape / small tablet |
| 768–1024px | Tablet |
| > 1024px | Desktop |

**Layout behavior:**

- **Mobile:** Full-width message list, input fixed to bottom of viewport, no wasted horizontal space
- **Desktop:** Centered content area with max-width, such as 800px, comfortable reading width
- **All sizes:** Message input always visible at bottom, message list scrollable above it

**Touch considerations:**

- Input field should not be obscured by virtual keyboard on mobile
- Send button should be large enough for touch, minimum 44x44px tap target
- Auto-scroll to latest message

## Build and Deployment

### Development

```bash
cd webui
npm install
npm run dev
# Open http://localhost:5173
```

**Environment variable for local development:**

Create `webui/.env.local`:

```text
VITE_WS_ENDPOINT=wss://{your-api-id}.execute-api.{region}.amazonaws.com/prod
```

### Production Build

```bash
cd webui
npm run build
# Output: webui/dist/
```

### GitHub Pages Deployment

**Option A: Manual**

Copy the contents of `webui/dist/` to the repository branch/folder configured for GitHub Pages.

**Option B: GitHub Actions (recommended)**

```yaml
# .github/workflows/deploy.yml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
    paths:
      - "webui/**"
      - ".github/workflows/deploy.yml"

jobs:
  deploy:
    runs-on: ubuntu-latest

    env:
      VITE_WS_ENDPOINT: ${{ secrets.VITE_WS_ENDPOINT }}

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: cd webui && npm ci && npm run build

      - uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./webui/dist
```

### Vite Configuration for GitHub Pages

```typescript
// webui/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/anonymous-chat-web/',  // Must match GitHub repo name for GitHub Pages
});
```

## UI Design Scheme

本專案採用 **Quiet Mist / 霧藍灰系** 作為主要視覺風格。整體設計目標是讓匿名聊天室看起來乾淨、安靜、放鬆，適合使用者長時間閱讀與聊天。

### Design Keywords

- Calm
- Clean
- Soft
- Low-saturation
- Relaxed
- Minimal
- Mobile-friendly

### Color Palette

| Token | Color | Usage |
|-------|-------|-------|
| `background` | `#F3F6F8` | Page background |
| `surface` | `#FFFFFF` | Main card, chat container |
| `primary` | `#7D9AAE` | Primary buttons, active states |
| `primaryHover` | `#68879C` | Button hover state |
| `border` | `#D8E1E8` | Input border, card border, dividers |
| `textPrimary` | `#2F3C46` | Main text |
| `textSecondary` | `#6F7D87` | Secondary text, timestamps, placeholders |
| `ownBubble` | `#DCE8F0` | Current user's message bubble |
| `otherBubble` | `#EFF4F7` | Other users' message bubble |
| `systemText` | `#7A8790` | System messages |
| `error` | `#C97C7C` | Error messages |
| `success` | `#6FA67A` | Connected status |

### Layout Style

- The overall page background should use `background`.
- The main content should be placed inside a centered card using `surface`.
- The card should have rounded corners and a subtle shadow.
- Desktop layout should use a centered container with a comfortable max width, such as `800px`.
- Mobile layout should use the full viewport width with enough padding.
- The chat message list should be scrollable.
- The message input area should remain visible at the bottom of the chat screen.

### Welcome Screen Style

The Welcome Screen should feel calm and simple.

- Page background: `background`
- Main card background: `surface`
- App title: `匿名聊天室`
- Title color: `textPrimary`
- Subtitle or helper text: `textSecondary`
- Input border: `border`
- Input focus color: `primary`
- Primary button background: `primary`
- Primary button hover: `primaryHover`
- Button text: white

User-facing labels should use natural Chinese wording:

- `暱稱`
- `進入密碼`
- `進入聊天室`

The UI should not display the technical term `callsign` to users. Internally, the nickname value is still mapped to the `callsign` query parameter.

### Chat Screen Style

The Chat Screen should prioritize readability.

- Chat container background: `surface`
- Message list background: `surface`
- Own messages:
  - Background: `ownBubble`
  - Align to the right
- Other users' messages:
  - Background: `otherBubble`
  - Align to the left
- System messages:
  - Center aligned
  - Smaller text
  - Text color: `systemText`
- Timestamp:
  - Smaller text
  - Text color: `textSecondary`

### Input and Button Style

- Message input should have a white or near-white background.
- Input borders should use `border`.
- Focus state should use `primary`.
- Send button should use `primary`.
- Send button hover should use `primaryHover`.
- Buttons should have rounded corners and a comfortable tap target size.

### Visual Constraints

- Avoid high-saturation colors.
- Avoid pure black text; use `textPrimary` instead.
- Avoid heavy shadows.
- Avoid overly bright blue.
- Avoid too many accent colors.
- Keep the interface soft, clean, and easy to read.

## Accessibility Baseline

Even before the design scheme is applied:

- All interactive elements must be keyboard-accessible
- Input fields must have associated labels, either visible or `aria-label`
- Status changes, such as connected or disconnected, should be announced to screen readers via `aria-live` region
- Color contrast ratios should meet WCAG AA, 4.5:1 for normal text, enforced when design scheme is applied

## Error States

| State | Display |
|-------|---------|
| WebSocket connection failed | Error message on Welcome Screen with retry option |
| Invalid passcode or rejected connection | Error message on Welcome Screen |
| Connection lost during chat | Status indicator changes, reconnection attempts begin |
| Message send failed | Visual indicator on the failed message, such as red icon |
| Invalid nickname | Inline validation error below the nickname input field |
| Empty passcode | Inline validation error below the passcode input field |