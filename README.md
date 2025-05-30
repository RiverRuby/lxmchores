# lxmchores

A Slack bot built on Cloudflare Workers that manages household chore rotations with AI-powered natural language processing and Google Calendar integration. Features a web interface for real-time chore status viewing.

## Features

- 📅 **Automated Chore Rotation**: Manages who's turn it is for chores
- 🤖 **AI-Powered Commands**: Uses OpenAI GPT-4 with function calling for natural language interactions
- 📆 **Calendar Integration**: Creates Google Calendar events for chore reminders
- ⏰ **Scheduled Reminders**: Sends daily reminders via cron triggers (9 AM and 7 PM)
- 🌐 **Web Interface**: Real-time web dashboard showing current chore status
- 📊 **REST API**: HTTP endpoints for external integrations
- 🔒 **Secure**: Verifies Slack request signatures and uses encrypted secrets
- 💾 **Persistent State**: Uses Cloudflare Durable Objects with automatic daily backups
- 🧪 **Testing**: Vitest integration with Cloudflare Workers pool

## Architecture

```
┌─── Cloudflare Workers Runtime ───┐
│                                  │
│  ┌─ Entry Point (index.ts) ────┐ │
│  │  • /slack (webhook)         │ │
│  │  • /api/chores (REST API)   │ │
│  │  • / (web interface)        │ │
│  │  • /health (health check)   │ │
│  │  • Cron triggers            │ │
│  └─────────────────────────────┘ │
│                                  │
│  ┌─ Core Modules ──────────────┐ │
│  │  • slack.ts (Slack API)     │ │
│  │  • openai.ts (GPT-4)        │ │
│  │  • state.ts (Durable Object)│ │
│  │  • utils.ts (Calendar/GCP)  │ │
│  │  • scheduler.ts (Cron)      │ │
│  │  • api.ts (REST endpoints)  │ │
│  └─────────────────────────────┘ │
│                                  │
│  ┌─ Static Assets (public/) ───┐ │
│  │  • index.html (dashboard)   │ │
│  │  • rusty.jpeg (bot avatar)  │ │
│  └─────────────────────────────┘ │
└──────────────────────────────────┘

┌─ External Services ─┐
│  • OpenAI GPT-4     │
│  • Google Calendar  │
│  • Slack Workspace  │
└─────────────────────┘
```

## Setup

### 1. Prerequisites

- Node.js 18+
- Cloudflare account
- Slack workspace admin access
- Google Cloud Platform account
- OpenAI API account

### 2. Install Dependencies

```bash
npm install
npm install -g wrangler
```

### 3. Slack App Setup

1. Go to [https://api.slack.com/apps](https://api.slack.com/apps)
2. Click "Create New App" → "From scratch"
3. Choose app name and workspace
4. In **OAuth & Permissions**:

   - Add these Bot Token Scopes:
     - `chat:write`
     - `commands`
     - `users:read`
     - `channels:read`
   - Install to workspace and copy the Bot User OAuth Token (`xoxb-...`)

5. In **Slash Commands**:

   - Create `/rusty` command
   - Request URL: `https://your-worker.your-subdomain.workers.dev/slack`

6. In **Basic Information**:
   - Copy the Signing Secret

### 4. Google Calendar Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable the Google Calendar API
4. Create a Service Account:
   - Go to IAM & Admin → Service Accounts
   - Create service account
   - Download the JSON key file
5. Share your Google Calendar with the service account email

### 5. Environment Setup

Set up your secrets using Wrangler:

```bash
# Slack secrets
npx wrangler secret put SLACK_BOT_TOKEN
# Paste your xoxb- token

npx wrangler secret put SLACK_SIGNING_SECRET
# Paste your signing secret

# OpenAI API key
npx wrangler secret put OPENAI_API_KEY
# Paste your OpenAI API key

# Google service account (paste the entire JSON)
npx wrangler secret put GCP_SERVICE_ACCOUNT
# Paste the entire service account JSON
```

### 6. Deploy

```bash
# Deploy to Cloudflare Workers
npm run deploy

# Your worker will be available at:
# https://chore-bot.your-subdomain.workers.dev
```

### 7. Update Slack App

1. Go back to your Slack app settings
2. Update the slash command Request URL to: `https://chore-bot.your-subdomain.workers.dev/slack`
3. In **Event Subscriptions** (optional):
   - Enable events
   - Request URL: `https://chore-bot.your-subdomain.workers.dev/slack`
   - Subscribe to `message.channels` for @mentions

## Usage

### Slash Commands

```bash
# Check current rotation status
/rusty status

# Update rotation with new people
/rusty set rotation Alice Bob Charlie

# Update chore list
/rusty set chores "take out trash, do dishes, vacuum living room"

# Move to next person in rotation
/rusty next

# Create a calendar reminder
/rusty calendar "Chore reminder" tomorrow 9am
```

### Natural Language

The bot understands natural language through OpenAI GPT-4:

```bash
/rusty who's turn is it?
/rusty add Dave to the rotation
/rusty what are today's chores?
/rusty skip to the next person
/rusty create a reminder for this weekend
```

### Web Interface

Visit your deployed worker URL to see the live chore dashboard:

- Real-time chore status updates
- Rusty's avatar and speech bubble interface
- Auto-refresh every 5 minutes
- Mobile-responsive design

### API Endpoints

```bash
# Get current chore state
GET /api/chores

# Health check
GET /health

# Slack webhook
POST /slack
```

## Scheduled Reminders

The bot automatically sends reminders at 9 AM and 7 PM daily (configured in `wrangler.jsonc` cron triggers).

## Development

```bash
# Run locally with hot reload
npm run dev

# Type checking
npx tsc --noEmit

# Run tests
npm test

# Generate Cloudflare Worker types
npm run cf-typegen

# Deploy to production
npm run deploy
```

## Project Structure

```
chore-bot/
├── src/
│   ├── index.ts          # Main entry point and routing
│   ├── slack.ts          # Slack API integration (310 lines)
│   ├── openai.ts         # OpenAI GPT-4 function calling (333 lines)
│   ├── state.ts          # Durable Object for state management
│   ├── utils.ts          # Google Calendar & utility functions
│   ├── scheduler.ts      # Cron job handling
│   ├── api.ts           # REST API endpoints
│   └── types.ts         # TypeScript interfaces
├── public/
│   ├── index.html       # Web dashboard (195 lines)
│   └── rusty.jpeg       # Bot avatar image
├── wrangler.jsonc       # Cloudflare Workers configuration
├── package.json         # Dependencies and scripts
├── tsconfig.json        # TypeScript configuration
├── vitest.config.mts    # Test configuration
└── README.md           # This file
```

## State Management

The bot uses Cloudflare Durable Objects for persistent state with:

- **Primary state**: Current chore rotation and assignments
- **Automatic backups**: Daily backups with timestamps
- **Manual backups**: Available via `/backup` endpoint
- **State validation**: Type-safe state updates
- **Atomic operations**: Consistent state management

## Configuration

Edit `wrangler.jsonc` to customize:

- **Cron schedules**: Modify reminder times
- **Environment variables**: Set production/development flags
- **Compatibility dates**: Update Worker runtime features
- **Durable Object bindings**: Configure state management

## Testing

The project includes Vitest with Cloudflare Workers integration:

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch
```

Tests are configured to run in the Cloudflare Workers environment using `@cloudflare/vitest-pool-workers`.

## Troubleshooting

### Common Issues

1. **Invalid Slack signature**: Check your signing secret
2. **Calendar API errors**: Verify service account permissions
3. **OpenAI errors**: Check API key and billing status
4. **State not persisting**: Ensure Durable Objects are properly configured
5. **Web interface not loading**: Check static asset configuration

### Debugging

```bash
# View real-time logs
wrangler tail

# View specific deployment logs
wrangler tail --format=pretty

# Local development with debugging
npm run dev
```

### Health Monitoring

- **Health endpoint**: `GET /health` returns 200 OK
- **API status**: `GET /api/chores` shows current state
- **Console logs**: Structured logging with timestamps
- **Error tracking**: Comprehensive error handling and logging

## License

MIT License - see LICENSE file for details.
