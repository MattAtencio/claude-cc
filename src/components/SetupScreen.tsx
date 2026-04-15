import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export function SetupScreen() {
  const [configPath, setConfigPath] = useState("");

  useEffect(() => {
    invoke<string>("get_config_path").then(setConfigPath).catch(() => {});
  }, []);

  return (
    <div className="flex h-screen w-screen bg-[#0a0a0a] text-gray-200 items-center justify-center">
      <div className="max-w-lg mx-auto text-center space-y-6 px-8">
        <h1 className="text-2xl font-bold text-white">Welcome to Command</h1>
        <p className="text-gray-400 text-sm leading-relaxed">
          Command manages multiple Claude CLI sessions across your projects.
          To get started, create a config file with your projects.
        </p>

        <div className="bg-[#111] border border-gray-800 rounded-lg p-4 text-left space-y-3">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Setup</p>

          <div className="space-y-2 text-sm text-gray-300">
            <p>
              <span className="text-gray-500">1.</span> Copy the example config:
            </p>
            <code className="block bg-black/50 rounded px-3 py-2 text-xs text-purple-400 font-mono break-all">
              {configPath
                ? `cp config.example.json "${configPath}"`
                : "cp projects/config.example.json projects/config.json"}
            </code>

            <p>
              <span className="text-gray-500">2.</span> Edit it with your projects, paths, and tools.
            </p>

            <p>
              <span className="text-gray-500">3.</span> Restart Command.
            </p>
          </div>
        </div>

        {configPath && (
          <p className="text-xs text-gray-600">
            Config location: <span className="text-gray-500 font-mono">{configPath}</span>
          </p>
        )}

        <p className="text-xs text-gray-600">
          Or set <span className="font-mono text-gray-500">COMMAND_CONFIG</span> env var to use a custom path.
        </p>
      </div>
    </div>
  );
}
