package core

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// AppPrefs mirrors app_prefs.json (payday 1-28, default 1).
type AppPrefs struct {
	Payday int `json:"payday"`
}

func prefsPath(dataDir string) string { return filepath.Join(dataDir, "app_prefs.json") }

func loadPrefs(dataDir string) (AppPrefs, error) {
	p := prefsPath(dataDir)
	raw, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			def := AppPrefs{Payday: 1}
			_ = savePrefs(dataDir, def)
			return def, nil
		}
		return AppPrefs{}, err
	}
	var prefs AppPrefs
	if err := json.Unmarshal(raw, &prefs); err != nil {
		return AppPrefs{}, err
	}
	if prefs.Payday == 0 {
		prefs.Payday = 1
	}
	prefs.Payday = clampInt(prefs.Payday, 1, 28)
	return prefs, nil
}

func savePrefs(dataDir string, prefs AppPrefs) error {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return err
	}
	prefs.Payday = clampInt(prefs.Payday, 1, 28)
	raw, err := json.MarshalIndent(prefs, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(prefsPath(dataDir), raw, 0o600)
}

func setPayday(dataDir string, day int) (AppPrefs, error) {
	prefs, err := loadPrefs(dataDir)
	if err != nil {
		return AppPrefs{}, err
	}
	prefs.Payday = clampInt(day, 1, 28)
	if err := savePrefs(dataDir, prefs); err != nil {
		return AppPrefs{}, err
	}
	return prefs, nil
}
