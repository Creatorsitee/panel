# cmnty Server Management Panel

A lightweight, self-hosted Node.js & Python server management panel designed for cloud containers (such as Railway), dedicated servers, and NAT Gateway environments, featuring real-time streaming telemetry and terminal access.

---

## Key Features

- **Multi-Runtime Support**: First-class execution for Node.js (`node`, `npm`, `npx`, `tsx`) and Python (`python3`, `uvicorn`, `gunicorn`, `flask`, `fastapi`, `pytest`).
- **Resource Management**: Fair-share memory (`512 MB` to `16 GB`) and CPU percentage (`10%` to `100%`) allocation to ensure stable multi-server hosting.
- **NAT Gateway & Port Forwarding**: Configurable internal server ports mapped cleanly for NAT gateway and container setups.
- **Real-Time Telemetry & Console**: Server-Sent Events (SSE) powered live logs, stdout/stderr high-signal highlighting, interactive resource charts, and stdin command execution.
- **Integrated File Manager**: Built-in file editor, ZIP archive extraction, directory tree management, and `.env` configuration support.
- **Role-Based Access Control (RBAC)**: Secure administrator and user workspace isolation.

---

## Tech Stack

- **Framework**: Next.js 15 (App Router) with React 19 & TypeScript
- **Styling**: Tailwind CSS v4 with Lucide icons
- **State & Transport**: Server-Sent Events (SSE) streaming & SQLite-backed persistent JSON store
- **Process Supervision**: Native Node.js child process manager with RSS memory limits and OOM auto-termination

---

## Installation & Deployment

### Option 1: Docker / Railway (Recommended)

This project includes a production-ready `Dockerfile` optimized for containerized environments such as Railway, Render, or self-hosted Docker:

```bash
docker build -t cmnty-panel .
docker run -d -p 3000:3000 -v /path/to/data:/app/data cmnty-panel
```

For **Railway**, simply connect your repository, add a persistent Volume mounted at `/app/data`, and deploy.

### Option 2: Native Ubuntu / Debian Setup

Clone the repository to your Linux server and run the automated installation script:

```bash
git clone <repository-url> cmnty
cd cmnty
sudo bash install.sh
```

The installer automatically handles:
1. Node.js 22 LTS, Python 3, `pip`, and `git` prerequisites.
2. Production environment generation and secret keying.
3. Next.js build compilation (`npm run build`).
4. Systemd service registration (`cmnty-panel.service`) running on port `3000`.

---

## Environment Variables

Configure application behavior using a `.env` file in the root directory:

```env
NODE_ENV=production
PORT=3000
PANEL_SESSION_SECRET=your_secure_random_secret_here
```

---

## License

MIT License. See [LICENSE](LICENSE) for details.
