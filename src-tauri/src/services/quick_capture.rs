use crate::models::finance::CreateTransactionInput;
use crate::models::quick_note::CreateQuickNoteInput;
use crate::models::task::CreateTaskInput;
use crate::services::finance::parse_quick_finances;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickCaptureResult {
    pub kind: String,
    pub task: Option<CreateTaskInput>,
    pub transaction: Option<CreateTransactionInput>,
    pub quick_note: Option<CreateQuickNoteInput>,
}

pub fn parse_quick_capture(text: &str) -> QuickCaptureResult {
    let text = text.trim();
    if text.is_empty() {
        return QuickCaptureResult {
            kind: "empty".into(),
            task: None,
            transaction: None,
            quick_note: None,
        };
    }

    let finances = parse_quick_finances(text);
    if !finances.is_empty() {
        return QuickCaptureResult {
            kind: "finance".into(),
            task: None,
            transaction: finances.into_iter().next(),
            quick_note: None,
        };
    }

    if text.contains("开会")
        || text.contains("提醒")
        || text.contains("任务")
        || text.starts_with("明天")
    {
        return QuickCaptureResult {
            kind: "task".into(),
            task: Some(CreateTaskInput {
                title: text.to_string(),
                description: None,
                priority: None,
                due_at: None,
                tags: None,
            }),
            transaction: None,
            quick_note: None,
        };
    }

    QuickCaptureResult {
        kind: "note".into(),
        task: None,
        transaction: None,
        quick_note: Some(CreateQuickNoteInput {
            content: text.to_string(),
            note_type: Some("capture".into()),
            tags: None,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_finance() {
        let r = parse_quick_capture("买咖啡 28");
        assert_eq!(r.kind, "finance");
        assert!(r.transaction.is_some());
    }

    #[test]
    fn detects_glued_income() {
        let r = parse_quick_capture("冰箱卖了36");
        assert_eq!(r.kind, "finance");
        assert_eq!(r.transaction.as_ref().unwrap().amount, 36.0);
    }

    #[test]
    fn detects_note() {
        let r = parse_quick_capture("今天研究了 RingBuffer");
        assert_eq!(r.kind, "note");
        assert!(r.quick_note.is_some());
    }
}
