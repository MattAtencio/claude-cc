use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRequest {
    pub project_id: String,
    pub prompt: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionQueue {
    pub requests: Vec<SessionRequest>,
}

pub fn queue_path(app_handle: Option<&tauri::AppHandle>) -> PathBuf {
    crate::config::config_dir(app_handle).join("queue.json")
}

/// Read and clear the queue atomically
pub fn drain_queue(app_handle: Option<&tauri::AppHandle>) -> Vec<SessionRequest> {
    let path = queue_path(app_handle);
    if !path.exists() {
        return vec![];
    }

    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let queue: SessionQueue = match serde_json::from_str(&content) {
        Ok(q) => q,
        Err(_) => return vec![],
    };

    if queue.requests.is_empty() {
        return vec![];
    }

    // Clear the queue
    let empty = SessionQueue { requests: vec![] };
    if let Ok(json) = serde_json::to_string_pretty(&empty) {
        let _ = std::fs::write(&path, json);
    }

    queue.requests
}
