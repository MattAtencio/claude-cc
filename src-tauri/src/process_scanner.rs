use serde::Serialize;
use sysinfo::System;

#[derive(Debug, Clone, Serialize)]
pub struct ClaudeProcess {
    pub pid: u32,
    pub name: String,
    pub cmd: Vec<String>,
    pub cwd: Option<String>,
    pub status: String,
}

pub fn scan_claude_processes() -> Vec<ClaudeProcess> {
    let mut sys = System::new();
    sys.refresh_processes();

    let mut processes = Vec::new();

    for (pid, process) in sys.processes() {
        let name = process.name().to_string();

        // Look for claude CLI processes (node processes running claude)
        if name.contains("claude")
            || process
                .cmd()
                .iter()
                .any(|arg| arg.contains("claude") && !arg.contains("command"))
        {
            let cmd: Vec<String> = process.cmd().to_vec();
            let cwd = process.cwd().map(|p| p.to_string_lossy().to_string());

            processes.push(ClaudeProcess {
                pid: pid.as_u32(),
                name,
                cmd,
                cwd,
                status: format!("{:?}", process.status()),
            });
        }
    }

    processes
}
