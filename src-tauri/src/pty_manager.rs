use crate::output_parser::{OutputAnalyzer, SessionState};
use crate::persistence;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::Emitter;

pub struct PtySession {
    pub project_id: String,
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub reader_handle: Option<std::thread::JoinHandle<()>>,
    pub idle_handle: Option<std::thread::JoinHandle<()>>,
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
    pub started_at: String,
    pub analyzer: Arc<Mutex<OutputAnalyzer>>,
    pub persist: bool,
}

impl Drop for PtySession {
    fn drop(&mut self) {
        if !self.persist {
            // Kill the child process when the session is dropped
            let _ = self.child.kill();
            // Wait briefly to reap the process
            let _ = self.child.wait();
        }
        // If persist is true, the child process keeps running
        // so we can reconnect with --resume later
    }
}

/// Try to extract a Claude session ID from PTY output.
/// Claude CLI outputs the session ID in various formats.
fn try_extract_session_id(data: &str) -> Option<String> {
    for line in data.lines() {
        let line_trimmed = line.trim();
        if let Some(rest) = line_trimmed.strip_prefix("Session: ") {
            let id = rest.trim();
            if !id.is_empty() {
                return Some(id.to_string());
            }
        }
        if let Some(rest) = line_trimmed.strip_prefix("session_id: ") {
            let id = rest.trim();
            if !id.is_empty() {
                return Some(id.to_string());
            }
        }
    }
    // Check for session ID in ANSI output or status bar text
    if let Some(pos) = data.find("session ") {
        let after = &data[pos + 8..];
        if after.len() >= 36 {
            let candidate = &after[..36];
            if is_uuid_like(candidate) {
                return Some(candidate.to_string());
            }
        }
    }
    None
}

fn is_uuid_like(s: &str) -> bool {
    if s.len() != 36 {
        return false;
    }
    let parts: Vec<&str> = s.split('-').collect();
    if parts.len() != 5 {
        return false;
    }
    let expected_lens = [8, 4, 4, 4, 12];
    for (part, &expected_len) in parts.iter().zip(&expected_lens) {
        if part.len() != expected_len || !part.chars().all(|c| c.is_ascii_hexdigit()) {
            return false;
        }
    }
    true
}

fn spawn_reader_thread(
    mut reader: Box<dyn Read + Send>,
    pid: String,
    analyzer_clone: Arc<Mutex<OutputAnalyzer>>,
    app_handle: tauri::AppHandle,
) -> std::thread::JoinHandle<()> {
    let pid_for_session = pid.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut session_id_found = false;
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_handle.emit(&format!("pty-output-{}", pid), &data);

                    // Try to capture Claude session ID from output
                    if !session_id_found {
                        if let Some(sid) = try_extract_session_id(&data) {
                            persistence::update_session_id(&pid_for_session, &sid, None);
                            session_id_found = true;
                        }
                    }

                    // Feed to analyzer and emit state changes
                    if let Ok(mut a) = analyzer_clone.lock() {
                        if let Some(new_state) = a.analyze(&data) {
                            let _ = app_handle.emit(
                                &format!("session-state-{}", pid),
                                &new_state,
                            );
                        }
                    }
                }
                Err(_) => break,
            }
        }
        // Session ended
        if let Ok(mut a) = analyzer_clone.lock() {
            let _ = a.analyze("Session ended");
        }
    })
}

pub fn create_pty_session(
    project_id: &str,
    project_path: &str,
    app_handle: tauri::AppHandle,
) -> Result<PtySession, String> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows: 30,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    let mut cmd = CommandBuilder::new("claude");
    cmd.cwd(project_path);

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn claude: {}", e))?;

    // Drop the slave - we only need the master side
    drop(pair.slave);

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take writer: {}", e))?;

    // SAFETY: On Windows, the writer from portable-pty is Send-safe.
    // We wrap it in Arc<Mutex<>> for shared access.
    let writer: Arc<Mutex<Box<dyn Write + Send>>> =
        Arc::new(Mutex::new(unsafe { std::mem::transmute(writer) }));

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone reader: {}", e))?;

    let analyzer = Arc::new(Mutex::new(OutputAnalyzer::new()));

    // Spawn a thread to read PTY output, analyze it, and emit to frontend
    let pid = project_id.to_string();
    let analyzer_clone = Arc::clone(&analyzer);
    let app_handle_clone = app_handle.clone();
    let handle = spawn_reader_thread(reader, pid, analyzer_clone, app_handle);

    // Spawn an idle checker thread that polls every 500ms
    let idle_pid = project_id.to_string();
    let idle_analyzer = Arc::clone(&analyzer);
    let idle_handle = std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_millis(500));
            if let Ok(mut a) = idle_analyzer.lock() {
                if *a.current_state() == SessionState::Completed {
                    break;
                }
                if let Some(new_state) = a.check_idle() {
                    let _ = app_handle_clone.emit(
                        &format!("session-state-{}", idle_pid),
                        &new_state,
                    );
                }
            }
        }
    });

    // Persist session to disk
    persistence::add_session(project_id, project_path, None);

    Ok(PtySession {
        project_id: project_id.to_string(),
        writer,
        reader_handle: Some(handle),
        idle_handle: Some(idle_handle),
        master: pair.master,
        child,
        started_at: chrono::Utc::now().to_rfc3339(),
        analyzer,
        persist: true,
    })
}

pub fn reconnect_session(
    project_id: &str,
    project_path: &str,
    session_id: &str,
    app_handle: tauri::AppHandle,
) -> Result<PtySession, String> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows: 30,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    let mut cmd = CommandBuilder::new("claude");
    cmd.arg("--resume");
    cmd.arg(session_id);
    cmd.cwd(project_path);

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn claude --resume: {}", e))?;

    drop(pair.slave);

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take writer: {}", e))?;

    let writer: Arc<Mutex<Box<dyn Write + Send>>> =
        Arc::new(Mutex::new(unsafe { std::mem::transmute(writer) }));

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone reader: {}", e))?;

    let analyzer = Arc::new(Mutex::new(OutputAnalyzer::new()));

    let pid = project_id.to_string();
    let analyzer_clone = Arc::clone(&analyzer);
    let app_handle_clone = app_handle.clone();
    let handle = spawn_reader_thread(reader, pid, analyzer_clone, app_handle);

    // Spawn idle checker thread
    let idle_pid = project_id.to_string();
    let idle_analyzer = Arc::clone(&analyzer);
    let idle_handle = std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_millis(500));
            if let Ok(mut a) = idle_analyzer.lock() {
                if *a.current_state() == SessionState::Completed {
                    break;
                }
                if let Some(new_state) = a.check_idle() {
                    let _ = app_handle_clone.emit(
                        &format!("session-state-{}", idle_pid),
                        &new_state,
                    );
                }
            }
        }
    });

    Ok(PtySession {
        project_id: project_id.to_string(),
        writer,
        reader_handle: Some(handle),
        idle_handle: Some(idle_handle),
        master: pair.master,
        child,
        started_at: chrono::Utc::now().to_rfc3339(),
        analyzer,
        persist: true,
    })
}

pub fn write_to_pty(session: &PtySession, data: &str) -> Result<(), String> {
    let mut writer = session.writer.lock().map_err(|e| e.to_string())?;
    writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Failed to write to PTY: {}", e))?;
    writer
        .flush()
        .map_err(|e| format!("Failed to flush PTY: {}", e))?;
    Ok(())
}

pub fn resize_pty(session: &PtySession, rows: u16, cols: u16) -> Result<(), String> {
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to resize PTY: {}", e))
}
