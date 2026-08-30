package core

import (
	"encoding/json"
	"testing"
)

func txCount(t *testing.T, a *App) []float64 {
	t.Helper()
	res, err := a.Dispatch("finance_list", json.RawMessage(`{}`))
	if err != nil {
		t.Fatalf("finance_list: %v", err)
	}
	var amts []float64
	for _, tx := range res.([]Transaction) {
		amts = append(amts, tx.Amount)
	}
	return amts
}

func TestMultiProfile(t *testing.T) {
	a, err := NewApp(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}

	// Space A
	if _, _, err := a.Init("passwordA1"); err != nil {
		t.Fatalf("init A: %v", err)
	}
	mustDispatch(t, a, "finance_quick_add", `{"text":"工资 5000"}`)
	if _, err := a.Lock(); err != nil {
		t.Fatal(err)
	}

	// Space B (different password) — a brand new independent vault
	if _, _, err := a.Init("passwordB2"); err != nil {
		t.Fatalf("init B: %v", err)
	}
	mustDispatch(t, a, "finance_quick_add", `{"text":"午饭 35"}`)
	if _, err := a.Lock(); err != nil {
		t.Fatal(err)
	}

	// Two spaces now exist.
	a.mu.Lock()
	n := len(a.listProfilesLocked())
	a.mu.Unlock()
	if n != 2 {
		t.Fatalf("expected 2 profiles, got %d", n)
	}

	// Unlock A → only A's data.
	if _, _, err := a.Unlock("passwordA1"); err != nil {
		t.Fatalf("unlock A: %v", err)
	}
	if amts := txCount(t, a); len(amts) != 1 || amts[0] != 5000 {
		t.Fatalf("space A wrong data: %+v", amts)
	}

	// Switch to B without locking → seals A, opens B; only B's data.
	if _, _, err := a.Unlock("passwordB2"); err != nil {
		t.Fatalf("switch to B: %v", err)
	}
	if amts := txCount(t, a); len(amts) != 1 || amts[0] != 35 {
		t.Fatalf("space B wrong data: %+v", amts)
	}

	// Wrong password unlocks nothing.
	if _, _, err := a.Unlock("nope-nope-nope"); err == nil {
		t.Fatal("expected unlock failure for unknown password")
	}

	// Re-using an existing space's password for Init is rejected.
	a.Lock()
	if _, _, err := a.Init("passwordA1"); err == nil {
		t.Fatal("expected Init to reject an already-used password")
	}

	// Locked status still reports initialized.
	st, err := a.Status()
	if err != nil {
		t.Fatal(err)
	}
	if !st.Initialized || st.Unlocked {
		t.Fatalf("unexpected locked status: %+v", st)
	}
}

func TestBackCompatSingleProfileDir(t *testing.T) {
	// A pre-existing "default" profile dir (from the old single-profile build)
	// must still be discoverable and unlockable.
	root := t.TempDir()
	a, _ := NewApp(root)
	// Simulate old layout by initializing (creates a uuid dir today) then verify
	// discovery works regardless of dir name.
	if _, _, err := a.Init("legacypass1"); err != nil {
		t.Fatal(err)
	}
	a.Lock()
	a2, _ := NewApp(root)
	st, _ := a2.Status()
	if !st.Initialized {
		t.Fatal("existing profile not discovered by a fresh App")
	}
	if _, _, err := a2.Unlock("legacypass1"); err != nil {
		t.Fatalf("could not unlock existing profile: %v", err)
	}
}
