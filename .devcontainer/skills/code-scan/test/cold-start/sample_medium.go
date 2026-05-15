package main

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
)

const maxItems = 100

func validateName(name string) error {
	if len(name) == 0 {
		return fmt.Errorf("name is empty")
	}
	if len(name) > 64 {
		return fmt.Errorf("name too long")
	}
	return nil
}

func formatRecord(id string, name string) string {
	return fmt.Sprintf(`{"id":"%s","name":"%s"}`, id, name)
}

func parseID(raw string) (string, bool) {
	parts := strings.SplitN(raw, "-", 2)
	if len(parts) != 2 {
		return "", false
	}
	return parts[1], true
}

func removeTag(tags []string, target string) []string {
	out := tags[:0]
	for _, t := range tags {
		if t != target {
			out = append(out, t)
		}
	}
	return out
}

func sortRecords(records []map[string]any) {
	sort.SliceStable(records, func(i, j int) bool {
		pi, _ := records[i]["priority"].(int)
		pj, _ := records[j]["priority"].(int)
		if pi != pj {
			return pi < pj
		}
		ni, _ := records[i]["name"].(string)
		nj, _ := records[j]["name"].(string)
		return ni < nj
	})
}

func sortByPriority(records []map[string]any) {
	sort.SliceStable(records, func(i, j int) bool {
		pi, _ := records[i]["priority"].(int)
		pj, _ := records[j]["priority"].(int)
		if pi != pj {
			return pi < pj
		}
		ni, _ := records[i]["name"].(string)
		nj, _ := records[j]["name"].(string)
		return ni < nj
	})
}

func findByID(records []map[string]any, id string) (map[string]any, error) {
	for _, r := range records {
		if r["id"] == id {
			return r, nil
		}
	}
	return nil, fmt.Errorf("NOT_FOUND")
}

func findByName(records []map[string]any, name string) (map[string]any, error) {
	for _, r := range records {
		if r["name"] == name {
			return r, nil
		}
	}
	return nil, fmt.Errorf("NOT_FOUND")
}

func findByTag(records []map[string]any, tag string) (map[string]any, error) {
	for _, r := range records {
		tags, _ := r["tags"].([]string)
		for _, t := range tags {
			if t == tag {
				return r, nil
			}
		}
	}
	return nil, fmt.Errorf("NOT_FOUND")
}

func loadRecords(path string) ([]map[string]any, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("NOT_FOUND")
	}
	var records []map[string]any
	if err := json.Unmarshal(data, &records); err != nil {
		return nil, err
	}
	return records, nil
}
