package core

import "strings"

// QuickCaptureResult mirrors services/quick_capture.rs.
type QuickCaptureResult struct {
	Kind        string                  `json:"kind"`
	Task        *CreateTaskInput        `json:"task,omitempty"`
	Transaction *CreateTransactionInput `json:"transaction,omitempty"`
	QuickNote   *CreateQuickNoteInput   `json:"quickNote,omitempty"`
}

func parseQuickCapture(text string) QuickCaptureResult {
	text = strings.TrimSpace(text)
	if text == "" {
		return QuickCaptureResult{Kind: "empty"}
	}
	finances := parseQuickFinances(text)
	if len(finances) > 0 {
		first := finances[0]
		return QuickCaptureResult{Kind: "finance", Transaction: &first}
	}
	if strings.Contains(text, "开会") || strings.Contains(text, "提醒") ||
		strings.Contains(text, "任务") || strings.HasPrefix(text, "明天") {
		return QuickCaptureResult{Kind: "task", Task: &CreateTaskInput{Title: text}}
	}
	capture := "capture"
	return QuickCaptureResult{
		Kind:      "note",
		QuickNote: &CreateQuickNoteInput{Content: text, NoteType: &capture},
	}
}
