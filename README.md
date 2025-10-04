# Projects

This workspace hosts multiple apps. The PopModel app runs a React frontend and an Express backend with Anthropic integration, Google Sign-In, Admin mode, and chat history.

## Quick start

1) Backend env

- Copy example and configure:

```
cp PopModel/backend/.env.example PopModel/backend/.env
```

Edit `PopModel/backend/.env`:

- POPMODEL_API_KEY=your_anthropic_key
- GOOGLE_CLIENT_ID=your_google_web_client_id
- ADMIN_CODE=Pop91525 (optional)
- ALLOW_INSECURE_NOAUTH=true (for local dev only)

2) Install dependencies

```
npm install
```

3) Option A: Start both servers (dev)

```
npm run start:clean
```

- Backend: http://127.0.0.1:5001
- Frontend: http://localhost:3000

4) Option B: Single-port run (build + serve from backend)

```
npm --prefix PopModel/frontend run build
node PopModel/backend/server.js
```

- App served at: http://127.0.0.1:5001

To run on a different port (e.g., 8080) and listen on all interfaces:

```
npm run start:single:8080
# or manually
PORT=8080 HOST=0.0.0.0 node PopModel/backend/server.js
```

## Using the app

- Sign in with Google from the sidebar (required when ALLOW_INSECURE_NOAUTH is not true).
- Click New Chat to create a session. Use History to list and load sessions.
- Press Shift+A or click Admin to enter the admin code. Admin replies are marked and use a faster/best model.
- Change models in Settings. Selecting the payment model will take you to the Buy page.
- Attach images using the file picker next to the input; they’ll be previewed and sent with your next message.
- Rename chats using the ✏️ Rename action in the Sessions list.
- Markdown is supported, including code blocks with syntax highlighting; use the Copy button to copy code.

## Model selection notes

- The backend exposes `/api/models` with labeled options:
  - `claude-3-opus-20240229` → pop.ai model 1.5
  - `claude-3-5-sonnet-latest` → pop.ai model 2 (payment)
- If your current persisted model isn’t in the labeled list, it will appear as `(<model id>) (current)` so you can select it safely.
- You can POST to `/api/config/model` with either the id or the label; the backend persists to `PopModel/backend/popmodel.config.json`.
- If the selected model 404s at Anthropic, the backend auto-falls back to a working model and persists it.

## Troubleshooting

- Ports busy: run `npm run stop` or kill ports `fuser -k 5001/tcp || true && fuser -k 3001/tcp || true`.
- Backend health: `curl -sS -H 'Accept: application/json' http://127.0.0.1:5001/api/health`.
- Anthropic model 404: backend auto-falls back and persists a working model to `popmodel.config.json`.