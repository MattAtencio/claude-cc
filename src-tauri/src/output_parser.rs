use serde::Serialize;
use std::time::Instant;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    Starting,
    Waiting,
    Streaming,
    Thinking,
    ToolUse,
    PermissionBlocked,
    Completed,
}

/// Strips ANSI escape sequences from a string.
fn strip_ansi(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\x1b' {
            // Consume the '[' and then digits/semicolons until a letter
            if chars.peek() == Some(&'[') {
                chars.next(); // consume '['
                loop {
                    match chars.peek() {
                        Some(&c) if c.is_ascii_digit() || c == ';' || c == '?' => {
                            chars.next();
                        }
                        Some(&c) if c.is_ascii_alphabetic() => {
                            chars.next(); // consume the final letter
                            break;
                        }
                        _ => break,
                    }
                }
            }
            // Also handle OSC sequences: ESC ] ... ST or ESC ] ... BEL
            else if chars.peek() == Some(&']') {
                chars.next();
                loop {
                    match chars.next() {
                        Some('\x07') => break,         // BEL terminator
                        Some('\x1b') => {               // ST = ESC backslash
                            if chars.peek() == Some(&'\\') {
                                chars.next();
                            }
                            break;
                        }
                        None => break,
                        _ => {}
                    }
                }
            }
        } else {
            result.push(ch);
        }
    }
    result
}

const BUFFER_MAX: usize = 2000;

pub struct OutputAnalyzer {
    state: SessionState,
    last_output_time: Instant,
    buffer: String,
}

impl OutputAnalyzer {
    pub fn new() -> Self {
        Self {
            state: SessionState::Starting,
            last_output_time: Instant::now(),
            buffer: String::with_capacity(BUFFER_MAX),
        }
    }

    /// Feed new output from the PTY and return the new state if it changed.
    pub fn analyze(&mut self, data: &str) -> Option<SessionState> {
        self.last_output_time = Instant::now();

        // Append to rolling buffer, keeping last BUFFER_MAX chars
        self.buffer.push_str(data);
        if self.buffer.len() > BUFFER_MAX {
            let drain_to = self.buffer.len() - BUFFER_MAX;
            // Find a char boundary to drain to
            let drain_to = self
                .buffer
                .char_indices()
                .find(|(i, _)| *i >= drain_to)
                .map(|(i, _)| i)
                .unwrap_or(drain_to);
            self.buffer.drain(..drain_to);
        }

        let clean = strip_ansi(&self.buffer);

        // Check for session ended
        if clean.contains("Session ended")
            || clean.contains("Goodbye!")
            || clean.contains("exited with status")
        {
            return self.transition(SessionState::Completed);
        }

        // Priority 1: Permission patterns
        if clean.contains("Allow")
            || clean.contains("(Y/n)")
            || clean.contains("(y/N)")
            || clean.contains("(n)")
            || clean.contains("Allow access")
            || clean.contains("approve")
            || clean.contains("Do you want to")
        {
            // Only match if the permission text is in the recent portion (last 500 chars)
            let recent = if clean.len() > 500 {
                &clean[clean.len() - 500..]
            } else {
                &clean
            };
            if recent.contains("Allow")
                || recent.contains("(Y/n)")
                || recent.contains("(y/N)")
                || recent.contains("(n)")
                || recent.contains("Do you want to")
            {
                return self.transition(SessionState::PermissionBlocked);
            }
        }

        // Priority 2: Thinking/transfiguring patterns
        {
            let recent = if clean.len() > 500 {
                &clean[clean.len() - 500..]
            } else {
                &clean
            };
            if recent.contains("Thinking")
                || recent.contains("Transfiguring")
                || recent.contains("⏺")
            {
                // But not if it's already moved past thinking
                if !recent.contains("⚙") {
                    return self.transition(SessionState::Thinking);
                }
            }
        }

        // Priority 3: Tool use patterns
        {
            let recent = if clean.len() > 300 {
                &clean[clean.len() - 300..]
            } else {
                &clean
            };
            if recent.contains("⚙ Read")
                || recent.contains("⚙ Edit")
                || recent.contains("⚙ Bash")
                || recent.contains("⚙ Write")
                || recent.contains("⚙ Grep")
                || recent.contains("⚙ Glob")
                || recent.contains("⚙ Agent")
                || recent.contains("Read(")
                || recent.contains("Edit(")
                || recent.contains("Bash(")
                || recent.contains("Write(")
                || recent.contains("Grep(")
                || recent.contains("Glob(")
            {
                return self.transition(SessionState::ToolUse);
            }
        }

        // Priority 4: Prompt detection (waiting for input)
        {
            let recent = if clean.len() > 200 {
                &clean[clean.len() - 200..]
            } else {
                &clean
            };
            // Look for prompt at end of output
            let trimmed = recent.trim_end();
            if trimmed.ends_with("❯")
                || trimmed.ends_with("> ")
                || trimmed.ends_with('>')
            {
                return self.transition(SessionState::Waiting);
            }
            // Status bar with model info often means response is done
            if recent.contains("[Opus")
                || recent.contains("[Sonnet")
                || recent.contains("[Haiku")
                || recent.contains("est~")
            {
                // Response finished, likely about to show prompt
                return self.transition(SessionState::Waiting);
            }
        }

        // Priority 5: Any other output means streaming
        if self.state != SessionState::Starting {
            return self.transition(SessionState::Streaming);
        }

        None
    }

    /// Called on a timer to detect idle transitions.
    /// If no output for 1.5+ seconds and we were streaming, transition to waiting.
    pub fn check_idle(&mut self) -> Option<SessionState> {
        let elapsed = self.last_output_time.elapsed();

        if elapsed.as_millis() >= 1500 {
            match self.state {
                SessionState::Streaming => {
                    // Check if buffer ends with a prompt-like pattern
                    let clean = strip_ansi(&self.buffer);
                    let trimmed = clean.trim_end();
                    if trimmed.ends_with("❯")
                        || trimmed.ends_with("> ")
                        || trimmed.ends_with('>')
                    {
                        return self.transition(SessionState::Waiting);
                    }
                    // Even without prompt, long idle after streaming likely means waiting
                    if elapsed.as_millis() >= 3000 {
                        return self.transition(SessionState::Waiting);
                    }
                }
                SessionState::Starting => {
                    // If starting and idle for 3+ seconds, probably waiting for input
                    if elapsed.as_millis() >= 3000 {
                        return self.transition(SessionState::Waiting);
                    }
                }
                _ => {}
            }
        }

        None
    }

    pub fn current_state(&self) -> &SessionState {
        &self.state
    }

    fn transition(&mut self, new_state: SessionState) -> Option<SessionState> {
        if self.state != new_state {
            self.state = new_state.clone();
            Some(new_state)
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_ansi() {
        assert_eq!(strip_ansi("\x1b[32mhello\x1b[0m"), "hello");
        assert_eq!(strip_ansi("no escapes"), "no escapes");
        assert_eq!(strip_ansi("\x1b[1;34mblue\x1b[0m"), "blue");
    }

    #[test]
    fn test_permission_detection() {
        let mut analyzer = OutputAnalyzer::new();
        let result = analyzer.analyze("Do you want to Allow this? (Y/n)");
        assert_eq!(result, Some(SessionState::PermissionBlocked));
    }

    #[test]
    fn test_thinking_detection() {
        let mut analyzer = OutputAnalyzer::new();
        let result = analyzer.analyze("⏺ Thinking…");
        assert_eq!(result, Some(SessionState::Thinking));
    }

    #[test]
    fn test_tool_use_detection() {
        let mut analyzer = OutputAnalyzer::new();
        // Move past Starting state first
        analyzer.state = SessionState::Streaming;
        let result = analyzer.analyze("⚙ Read src/main.rs");
        assert_eq!(result, Some(SessionState::ToolUse));
    }

    #[test]
    fn test_streaming_detection() {
        let mut analyzer = OutputAnalyzer::new();
        analyzer.state = SessionState::Waiting;
        let result = analyzer.analyze("Here is some response text from Claude...");
        assert_eq!(result, Some(SessionState::Streaming));
    }

    #[test]
    fn test_buffer_bounded() {
        let mut analyzer = OutputAnalyzer::new();
        let big_data = "x".repeat(3000);
        analyzer.analyze(&big_data);
        assert!(analyzer.buffer.len() <= BUFFER_MAX);
    }
}
