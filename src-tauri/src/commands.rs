use crate::config::{self, ProjectConfig};
use std::io::Write;
use crate::persistence;
use crate::process_scanner;
use crate::pty_manager;
use crate::window_focus;
use crate::AppState;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStatus {
    pub project_id: String,
    pub active: bool,
    pub status: String,
    pub started_at: String,
}

#[tauri::command]
pub fn get_projects(state: State<AppState>) -> Result<Vec<ProjectConfig>, String> {
    let config = state.config.lock().map_err(|e| e.to_string())?;
    Ok(config.projects.clone())
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Result<Option<config::Settings>, String> {
    let config = state.config.lock().map_err(|e| e.to_string())?;
    Ok(config.settings.clone())
}

#[tauri::command]
pub fn get_config_path(app_handle: tauri::AppHandle) -> String {
    config::config_path(Some(&app_handle)).to_string_lossy().to_string()
}

#[tauri::command]
pub fn create_session(
    project_id: String,
    initial_prompt: Option<String>,
    app_handle: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    let config = state.config.lock().map_err(|e| e.to_string())?;
    let project = config
        .projects
        .iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| format!("Project '{}' not found", project_id))?;

    let project_path = project.path.clone();
    drop(config); // Release the config lock

    let session = pty_manager::create_pty_session(&project_id, &project_path, app_handle)?;

    // If an initial prompt was provided, send it after a brief delay
    // to let Claude CLI initialize
    if let Some(prompt) = initial_prompt {
        let writer = session.writer.clone();
        std::thread::spawn(move || {
            // Wait for Claude to show its prompt
            std::thread::sleep(std::time::Duration::from_secs(3));
            if let Ok(mut w) = writer.lock() {
                let prompt_with_newline = format!("{}\n", prompt);
                let _ = w.write_all(prompt_with_newline.as_bytes());
                let _ = w.flush();
            }
        });
    }

    let mut sessions = state.pty_sessions.lock().map_err(|e| e.to_string())?;
    sessions.insert(project_id, session);

    Ok(())
}

#[tauri::command]
pub fn write_to_session(
    project_id: String,
    data: String,
    state: State<AppState>,
) -> Result<(), String> {
    let sessions = state.pty_sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get(&project_id)
        .ok_or_else(|| format!("No session for project '{}'", project_id))?;
    pty_manager::write_to_pty(session, &data)
}

#[tauri::command]
pub fn resize_session(
    project_id: String,
    rows: u16,
    cols: u16,
    state: State<AppState>,
) -> Result<(), String> {
    let sessions = state.pty_sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get(&project_id)
        .ok_or_else(|| format!("No session for project '{}'", project_id))?;
    pty_manager::resize_pty(session, rows, cols)
}

#[tauri::command]
pub fn close_session(project_id: String, state: State<AppState>) -> Result<(), String> {
    let mut sessions = state.pty_sessions.lock().map_err(|e| e.to_string())?;
    if let Some(session) = sessions.get_mut(&project_id) {
        session.persist = false;
    }
    sessions.remove(&project_id);
    persistence::remove_session(&project_id, None);
    Ok(())
}

#[tauri::command]
pub fn get_saved_sessions() -> Vec<persistence::SavedSession> {
    persistence::load_state(None).sessions
}

#[tauri::command]
pub fn reconnect_saved_session(
    project_id: String,
    session_id: String,
    app_handle: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    let config = state.config.lock().map_err(|e| e.to_string())?;
    let project = config
        .projects
        .iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| format!("Project '{}' not found", project_id))?;

    let project_path = project.path.clone();
    drop(config);

    let session = pty_manager::reconnect_session(&project_id, &project_path, &session_id, app_handle)?;

    let mut sessions = state.pty_sessions.lock().map_err(|e| e.to_string())?;
    sessions.insert(project_id, session);

    Ok(())
}

/// Start a Claude session in any directory — doesn't need a project in config
#[tauri::command]
pub fn create_adhoc_session(
    session_id: String,
    path: String,
    name: String,
    app_handle: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    let session = pty_manager::create_pty_session(&session_id, &path, app_handle)?;

    let mut sessions = state.pty_sessions.lock().map_err(|e| e.to_string())?;
    sessions.insert(session_id.clone(), session);

    // Also add as a dynamic project so the frontend can display it
    let mut config = state.config.lock().map_err(|e| e.to_string())?;
    if !config.projects.iter().any(|p| p.id == session_id) {
        config.projects.push(ProjectConfig {
            id: session_id,
            name,
            path: path.clone(),
            tools: vec![
                crate::config::ToolConfig {
                    name: "VS Code".to_string(),
                    tool_type: "vscode".to_string(),
                    command: None,
                    path: Some(path),
                    icon: Some("code".to_string()),
                },
            ],
            color: Some("#6b7280".to_string()),
            category: "adhoc".to_string(),
        });
    }

    Ok(())
}

/// Scan devRoot for directories that aren't in the project config
#[tauri::command]
pub fn scan_dev_repos(state: State<AppState>) -> Result<Vec<ProjectConfig>, String> {
    let config = state.config.lock().map_err(|e| e.to_string())?;

    // Get devRoot from settings, skip scan if not configured
    let dev_root = config.settings.as_ref()
        .and_then(|s| s.dev_root.as_deref())
        .unwrap_or("");

    if dev_root.is_empty() {
        return Ok(vec![]);
    }

    let dev_dir = std::path::Path::new(dev_root);
    if !dev_dir.exists() {
        return Ok(vec![]);
    }

    let known_paths: std::collections::HashSet<String> = config.projects.iter()
        .map(|p| p.path.to_lowercase().replace('\\', "/"))
        .collect();

    let mut discovered = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dev_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() { continue; }

            let path_str = path.to_string_lossy().replace('\\', "/");
            if known_paths.contains(&path_str.to_lowercase()) { continue; }

            // Check if it's a git repo or has package.json (likely a project)
            let is_project = path.join(".git").exists()
                || path.join("package.json").exists()
                || path.join("Cargo.toml").exists()
                || path.join("CLAUDE.md").exists();

            if is_project {
                let name = entry.file_name().to_string_lossy().to_string();
                let id = name.to_lowercase().replace(' ', "-");
                discovered.push(ProjectConfig {
                    id,
                    name,
                    path: path_str,
                    tools: vec![
                        crate::config::ToolConfig {
                            name: "VS Code".to_string(),
                            tool_type: "vscode".to_string(),
                            command: None,
                            path: Some(path.to_string_lossy().to_string()),
                            icon: Some("code".to_string()),
                        },
                    ],
                    color: Some("#6b7280".to_string()),
                    category: "discovered".to_string(),
                });
            }
        }
    }

    Ok(discovered)
}

/// Add a project to the runtime config (doesn't persist to config.json)
#[tauri::command]
pub fn add_project(project: ProjectConfig, state: State<AppState>) -> Result<(), String> {
    let mut config = state.config.lock().map_err(|e| e.to_string())?;
    if !config.projects.iter().any(|p| p.id == project.id) {
        config.projects.push(project);
    }
    Ok(())
}

#[tauri::command]
pub fn scan_claude_processes() -> Vec<process_scanner::ClaudeProcess> {
    process_scanner::scan_claude_processes()
}

#[tauri::command]
pub fn launch_program(
    tool_type: String,
    command: Option<String>,
    path: Option<String>,
) -> Result<(), String> {
    window_focus::launch_tool(&tool_type, command.as_deref(), path.as_deref())
}

#[tauri::command]
pub fn focus_program(title: String) -> Result<bool, String> {
    window_focus::focus_window_by_title(&title)
}

#[tauri::command]
pub fn get_sessions_status(state: State<AppState>) -> Result<Vec<SessionStatus>, String> {
    let sessions = state.pty_sessions.lock().map_err(|e| e.to_string())?;
    Ok(sessions
        .values()
        .map(|s| {
            let state = s
                .analyzer
                .lock()
                .map(|a| format!("{:?}", a.current_state()))
                .unwrap_or_else(|_| "unknown".to_string());
            SessionStatus {
                project_id: s.project_id.clone(),
                active: true,
                status: state,
                started_at: s.started_at.clone(),
            }
        })
        .collect())
}
