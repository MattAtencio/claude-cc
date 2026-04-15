use std::sync::Mutex;
use tauri::Manager;
use tauri::Emitter;

mod commands;
mod config;
mod orchestrator;
mod output_parser;
pub mod persistence;
mod process_scanner;
mod pty_manager;
mod queue;
mod window_focus;

pub struct AppState {
    pub pty_sessions: Mutex<std::collections::HashMap<String, pty_manager::PtySession>>,
    pub config: Mutex<config::OrganizerConfig>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            pty_sessions: Mutex::new(std::collections::HashMap::new()),
            config: Mutex::new(config::OrganizerConfig::default()),
        })
        .setup(|app| {
            // Load config using the app handle (resolves proper config dir)
            let loaded_config = config::load_config(Some(app.handle()))
                .unwrap_or_default();
            let state = app.state::<AppState>();
            *state.config.lock().unwrap() = loaded_config.clone();

            // Write orchestrator context file to main project directory
            // This lets the Home Office Claude know how to use Command
            let scripts_path = loaded_config
                .settings
                .as_ref()
                .and_then(|s| s.scripts_path.clone())
                .unwrap_or_else(|| {
                    // Auto-detect: look next to the executable or in the repo
                    let exe_dir = std::env::current_exe()
                        .ok()
                        .and_then(|p| p.parent().map(|p| p.to_path_buf()));
                    // Check common locations
                    for candidate in [
                        exe_dir.as_ref().map(|d| d.join("scripts")),
                        Some(std::path::PathBuf::from("C:/dev/claude-organizer/scripts")),
                    ]
                    .into_iter()
                    .flatten()
                    {
                        if candidate.join("start-session.py").exists() {
                            return candidate.to_string_lossy().to_string();
                        }
                    }
                    "scripts".to_string()
                });
            orchestrator::write_orchestrator_context(&loaded_config, &scripts_path);

            // Background thread to monitor for permission-blocked sessions
            let app_handle_for_thread = app.handle().clone();
            std::thread::spawn(move || {
                let mut previously_blocked: std::collections::HashSet<String> = std::collections::HashSet::new();
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(2));
                    let blocked_pids: Vec<String> = {
                        let state = app_handle_for_thread.try_state::<AppState>();
                        if let Some(state) = state {
                            if let Ok(sessions) = state.pty_sessions.lock() {
                                sessions.iter()
                                    .filter(|(_, session)| {
                                        session.analyzer.lock()
                                            .map(|a| *a.current_state() == output_parser::SessionState::PermissionBlocked)
                                            .unwrap_or(false)
                                    })
                                    .map(|(pid, _)| pid.clone())
                                    .collect()
                            } else {
                                vec![]
                            }
                        } else {
                            vec![]
                        }
                    };

                    let currently_blocked: std::collections::HashSet<String> = blocked_pids.into_iter().collect();
                    for pid in &currently_blocked {
                        if !previously_blocked.contains(pid) {
                            let _ = app_handle_for_thread.emit("session-blocked", pid.as_str());
                        }
                    }
                    previously_blocked = currently_blocked;
                }
            });

            // Queue watcher — polls for session requests from CLI orchestrator
            let queue_handle = app.handle().clone();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(2));

                    let requests = queue::drain_queue(Some(&queue_handle));
                    if requests.is_empty() {
                        continue;
                    }

                    let state = match queue_handle.try_state::<AppState>() {
                        Some(s) => s,
                        None => continue,
                    };

                    for req in requests {
                        // Look up project path from config
                        let project_path = {
                            let config = match state.config.lock() {
                                Ok(c) => c,
                                Err(_) => continue,
                            };
                            config.projects.iter()
                                .find(|p| p.id == req.project_id)
                                .map(|p| p.path.clone())
                        };

                        let project_path = match project_path {
                            Some(p) => p,
                            None => {
                                eprintln!("Queue: project '{}' not found in config", req.project_id);
                                continue;
                            }
                        };

                        // Create PTY session
                        match pty_manager::create_pty_session_with_size(
                            &req.project_id,
                            &project_path,
                            24, 80,
                            queue_handle.clone(),
                        ) {
                            Ok(session) => {
                                // Send initial prompt if provided
                                if let Some(prompt) = &req.prompt {
                                    let writer = session.writer.clone();
                                    let prompt = prompt.clone();
                                    std::thread::spawn(move || {
                                        std::thread::sleep(std::time::Duration::from_secs(3));
                                        if let Ok(mut w) = writer.lock() {
                                            use std::io::Write;
                                            let _ = w.write_all(format!("{}\n", prompt).as_bytes());
                                            let _ = w.flush();
                                        }
                                    });
                                }

                                // Insert into sessions map
                                if let Ok(mut sessions) = state.pty_sessions.lock() {
                                    sessions.insert(req.project_id.clone(), session);
                                }

                                // Notify frontend a new session was created
                                let _ = queue_handle.emit("session-created", &req.project_id);
                                eprintln!("Queue: started session for '{}'", req.project_id);
                            }
                            Err(e) => {
                                eprintln!("Queue: failed to start session for '{}': {}", req.project_id, e);
                            }
                        }
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_projects,
            commands::get_settings,
            commands::get_config_path,
            commands::create_session,
            commands::write_to_session,
            commands::resize_session,
            commands::close_session,
            commands::scan_claude_processes,
            commands::focus_program,
            commands::launch_program,
            commands::get_sessions_status,
            commands::get_saved_sessions,
            commands::reconnect_saved_session,
            commands::create_adhoc_session,
            commands::scan_dev_repos,
            commands::add_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
