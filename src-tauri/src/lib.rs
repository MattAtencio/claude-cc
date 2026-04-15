use std::sync::Mutex;
use tauri::Manager;
use tauri::Emitter;

mod commands;
mod config;
mod output_parser;
pub mod persistence;
mod process_scanner;
mod pty_manager;
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
            *state.config.lock().unwrap() = loaded_config;

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
