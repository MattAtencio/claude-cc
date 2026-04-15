use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedSession {
    pub project_id: String,
    pub claude_session_id: Option<String>,
    pub started_at: String,
    pub working_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SavedState {
    pub sessions: Vec<SavedSession>,
}

/// State file lives in the same dir as config (Tauri app data or next to exe).
fn state_path(app_handle: Option<&tauri::AppHandle>) -> PathBuf {
    crate::config::config_dir(app_handle).join("sessions.json")
}

pub fn load_state(app_handle: Option<&tauri::AppHandle>) -> SavedState {
    let path = state_path(app_handle);
    if !path.exists() {
        return SavedState::default();
    }
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => SavedState::default(),
    }
}

pub fn save_state(state: &SavedState, app_handle: Option<&tauri::AppHandle>) {
    let path = state_path(app_handle);
    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(state) {
        let _ = std::fs::write(path, json);
    }
}

pub fn add_session(project_id: &str, working_dir: &str, app_handle: Option<&tauri::AppHandle>) {
    let mut state = load_state(app_handle);
    state.sessions.retain(|s| s.project_id != project_id);
    state.sessions.push(SavedSession {
        project_id: project_id.to_string(),
        claude_session_id: None,
        started_at: chrono::Utc::now().to_rfc3339(),
        working_dir: working_dir.to_string(),
    });
    save_state(&state, app_handle);
}

pub fn remove_session(project_id: &str, app_handle: Option<&tauri::AppHandle>) {
    let mut state = load_state(app_handle);
    state.sessions.retain(|s| s.project_id != project_id);
    save_state(&state, app_handle);
}

pub fn update_session_id(project_id: &str, claude_session_id: &str, app_handle: Option<&tauri::AppHandle>) {
    let mut state = load_state(app_handle);
    if let Some(session) = state.sessions.iter_mut().find(|s| s.project_id == project_id) {
        session.claude_session_id = Some(claude_session_id.to_string());
    }
    save_state(&state, app_handle);
}
