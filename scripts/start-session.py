#!/usr/bin/env python3
"""
Queue a session request for Command app.

Usage:
  python start-session.py <project-id> [--prompt "your prompt here"]

Examples:
  python start-session.py forge-and-field
  python start-session.py forge-and-field --prompt "Run /standup and fix the top priority bug"
  python start-session.py necroincremental --prompt "Audit test coverage and fix failing tests"

Command app polls this queue every 2 seconds and opens sessions automatically.
"""

import json
import os
import sys

QUEUE_PATH = os.path.join(
    os.environ.get("APPDATA", ""),
    "com.command.desktop",
    "queue.json",
)


def main():
    if len(sys.argv) < 2:
        print("Usage: start-session.py <project-id> [--prompt \"...\"]")
        sys.exit(1)

    project_id = sys.argv[1]
    prompt = None

    # Parse --prompt flag
    if "--prompt" in sys.argv:
        idx = sys.argv.index("--prompt")
        if idx + 1 < len(sys.argv):
            prompt = sys.argv[idx + 1]

    # Read existing queue
    queue = {"requests": []}
    if os.path.exists(QUEUE_PATH):
        try:
            with open(QUEUE_PATH, "r") as f:
                queue = json.load(f)
        except (json.JSONDecodeError, IOError):
            queue = {"requests": []}

    # Add request
    request = {"projectId": project_id}
    if prompt:
        request["prompt"] = prompt

    queue["requests"].append(request)

    # Ensure directory exists
    os.makedirs(os.path.dirname(QUEUE_PATH), exist_ok=True)

    # Write queue
    with open(QUEUE_PATH, "w") as f:
        json.dump(queue, f, indent=2)

    print(f"Queued session: {project_id}")
    if prompt:
        print(f"  Prompt: {prompt[:80]}...")


if __name__ == "__main__":
    main()
