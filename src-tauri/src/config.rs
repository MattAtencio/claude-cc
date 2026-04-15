use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// Root directory to scan for undiscovered repos (e.g., "C:/dev" or "~/projects")
    pub dev_root: Option<String>,
    /// Display name for the main/home project (default: "Main")
    pub main_label: Option<String>,
    /// Path to the start-session script (auto-detected if not set)
    pub scripts_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrganizerConfig {
    pub settings: Option<Settings>,
    pub projects: Vec<ProjectConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectConfig {
    pub id: String,
    pub name: String,
    pub path: String,
    pub tools: Vec<ToolConfig>,
    pub color: Option<String>,
    pub category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolConfig {
    pub name: String,
    #[serde(alias = "type", rename(serialize = "type", deserialize = "type"))]
    pub tool_type: String,
    pub command: Option<String>,
    pub path: Option<String>,
    pub icon: Option<String>,
}

impl Default for OrganizerConfig {
    fn default() -> Self {
        Self {
            settings: Some(Settings::default()),
            projects: vec![],
        }
    }
}

/// Resolve the config directory. Uses Tauri app config dir when available,
/// falls back to a `config/` dir next to the executable.
pub fn config_dir(app_handle: Option<&tauri::AppHandle>) -> PathBuf {
    if let Some(handle) = app_handle {
        if let Ok(path) = handle.path().app_config_dir() {
            return path;
        }
    }
    // Fallback: next to the executable
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn config_path(app_handle: Option<&tauri::AppHandle>) -> PathBuf {
    // Check env var override first
    if let Ok(p) = std::env::var("COMMAND_CONFIG") {
        return PathBuf::from(p);
    }
    config_dir(app_handle).join("config.json")
}

pub fn load_config(app_handle: Option<&tauri::AppHandle>) -> Result<OrganizerConfig, String> {
    let path = config_path(app_handle);

    if path.exists() {
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read config at {}: {}", path.display(), e))?;
        let raw: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse config: {}", e))?;

        let settings: Option<Settings> = raw.get("settings")
            .and_then(|s| serde_json::from_value(s.clone()).ok());

        if let Some(projects) = raw.get("projects") {
            let projects: Vec<ProjectConfig> = serde_json::from_value(projects.clone())
                .map_err(|e| format!("Failed to parse projects: {}", e))?;
            return Ok(OrganizerConfig { settings, projects });
        }
    }

    Ok(OrganizerConfig::default())
}

use tauri::Manager;
