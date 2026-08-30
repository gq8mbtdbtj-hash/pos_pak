package core

import "strings"

type SearchResult struct {
	ID         string `json:"id"`
	SourceType string `json:"sourceType"`
	Title      string `json:"title"`
	Snippet    string `json:"snippet"`
	Reference  string `json:"reference"`
}

type searchService struct{ db *DB }

func newSearchService(db *DB) *searchService { return &searchService{db: db} }

func (s *searchService) search(query string, limit int) ([]SearchResult, error) {
	q := strings.TrimSpace(query)
	if q == "" {
		return []SearchResult{}, nil
	}
	esc := strings.ReplaceAll(q, `"`, `""`)
	pattern := `"` + esc + `" OR ` + esc
	rows, err := s.db.sql.Query(
		`SELECT source_type, source_id, title, snippet(search_index, 2, '<b>', '</b>', '...', 32)
		 FROM search_index WHERE search_index MATCH ? ORDER BY rank LIMIT ?`, pattern, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SearchResult{}
	for rows.Next() {
		var r SearchResult
		if err := rows.Scan(&r.SourceType, &r.ID, &r.Title, &r.Snippet); err != nil {
			return nil, err
		}
		r.Reference = r.ID
		out = append(out, r)
	}
	return out, rows.Err()
}
