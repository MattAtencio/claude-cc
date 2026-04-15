# Claude CC (Control Center)

Desktop app for managing multiple concurrent [Claude Code](https://claude.ai/claude-code) CLI sessions across your projects.

Built with [Tauri v2](https://v2.tauri.app) + React + TypeScript + Rust.

![Claude CC](https://img.shields.io/badge/status-alpha-orange)

## Features

- **Multi-session terminals** — Run Claude CLI in multiple projects simultaneously via embedded PTY (xterm.js)
- **Real-time status** — See which sessions are working, idle, or blocked (waiting for permission input)
- **Project organization** — Group projects by category (games, apps, infra, etc.) with color coding
- **Tool launcher** — Launch VS Code, browser, terminal, Obsidian, Aseprite, or any custom tool per project
- **Command palette** — Fuzzy search across projects, sessions, and tools (Ctrl+K)
- **Session persistence** — Sessions survive app restarts via `claude --resume`
- **Auto-discovery** — Scans a configurable dev root for repos not yet in your config
- **Keyboard shortcuts** — Ctrl+1-9 to switch sessions, Ctrl+[/] to cycle projects

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) (stable)
- [Claude CLI](https://claude.ai/claude-code) installed and available in PATH
- Windows: MSVC C++ Build Tools (via Visual Studio Installer)

## Setup

```bash
# Clone and install
git clone https://github.com/YOUR_USERNAME/claude-cc.git
cd claude-cc
npm install

# Create your config
cp projects/config.example.json projects/config.json
# Edit projects/config.json with your projects

# Run in development
npm run tauri dev

# Build for production
npm run tauri build
```

## Configuration

Claude CC uses a `config.json` file to define your projects. On first launch it looks for:

1. `CLAUDE_CC_CONFIG` environment variable (custom path)
2. Tauri app config directory (`%APPDATA%/com.claude-cc.app/config.json` on Windows)
3. `projects/config.json` next to the executable (dev mode)

See [`projects/config.example.json`](projects/config.example.json) for the full schema.

### Config structure

```json
{
  "settings": {
    "devRoot": "/path/to/your/repos"
  },
  "projects": [
    {
      "id": "my-project",
      "name": "My Project",
      "path": "/path/to/my-project",
      "category": "app",
      "color": "#3b82f6",
      "tools": [
        { "name": "VS Code", "type": "vscode", "path": "/path/to/my-project" },
        { "name": "Browser", "type": "browser", "command": "http://localhost:3000" }
      ]
    }
  ]
}
```

### Settings

| Key | Description |
|-----|-------------|
| `devRoot` | Directory to scan for undiscovered repos. Leave empty to disable. |

### Categories

`game`, `app`, `framework`, `infra`, `personal`

### Tool types

`vscode`, `browser`, `terminal`, `obsidian`, `aseprite`, `slack`, `discord`, `custom`

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Toggle command palette |
| `Ctrl+1-9` | Switch to Nth active session |
| `Ctrl+[` / `Ctrl+]` | Cycle through projects |

## License

MIT
