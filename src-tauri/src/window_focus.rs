use std::process::Command;

/// Launch a program associated with a project tool
pub fn launch_tool(
    tool_type: &str,
    command: Option<&str>,
    path: Option<&str>,
) -> Result<(), String> {
    match tool_type {
        "vscode" => {
            let target = path.unwrap_or(".");
            Command::new("code")
                .arg(target)
                .spawn()
                .map_err(|e| format!("Failed to launch VS Code: {}", e))?;
        }
        "obsidian" => {
            if let Some(cmd) = command {
                Command::new("cmd")
                    .args(["/C", "start", "", cmd])
                    .spawn()
                    .map_err(|e| format!("Failed to launch Obsidian: {}", e))?;
            }
        }
        "browser" => {
            let url = command.or(path).unwrap_or("http://localhost:3000");
            Command::new("cmd")
                .args(["/C", "start", "", url])
                .spawn()
                .map_err(|e| format!("Failed to launch browser: {}", e))?;
        }
        "aseprite" => {
            let aseprite_path = "C:/Program Files/Aseprite/Aseprite.exe";
            let mut cmd = Command::new(aseprite_path);
            if let Some(p) = path {
                cmd.arg(p);
            }
            cmd.spawn()
                .map_err(|e| format!("Failed to launch Aseprite: {}", e))?;
        }
        "terminal" => {
            let dir = path.unwrap_or(".");
            Command::new("cmd")
                .args(["/C", "start", "cmd", "/K", &format!("cd /d {}", dir)])
                .spawn()
                .map_err(|e| format!("Failed to launch terminal: {}", e))?;
        }
        "slack" | "discord" => {
            if let Some(cmd) = command {
                Command::new("cmd")
                    .args(["/C", "start", "", cmd])
                    .spawn()
                    .map_err(|e| format!("Failed to launch {}: {}", tool_type, e))?;
            }
        }
        _ => {
            if let Some(cmd) = command {
                Command::new("cmd")
                    .args(["/C", "start", "", cmd])
                    .spawn()
                    .map_err(|e| format!("Failed to launch custom tool: {}", e))?;
            }
        }
    }
    Ok(())
}

/// Focus a program window by finding it via its window title
pub fn focus_window_by_title(title_substring: &str) -> Result<bool, String> {
    // Use PowerShell to find and focus the window
    let script = format!(
        r#"Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinFocus {{
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}}
"@
$proc = Get-Process | Where-Object {{ $_.MainWindowTitle -like '*{title}*' }} | Select-Object -First 1
if ($proc) {{
    [WinFocus]::ShowWindow($proc.MainWindowHandle, 9)
    [WinFocus]::SetForegroundWindow($proc.MainWindowHandle)
    Write-Output "focused"
}} else {{
    Write-Output "not_found"
}}"#,
        title = title_substring.replace('\'', "''")
    );

    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", &script])
        .output()
        .map_err(|e| format!("PowerShell error: {}", e))?;

    let result = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(result == "focused")
}
