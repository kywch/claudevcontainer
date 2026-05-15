package main

import (
	"encoding/json"
	"fmt"
	"os"
)

func loadConfig(path string) map[string]any {
	data, _ := os.ReadFile(path)
	var result map[string]any
	json.Unmarshal(data, &result)
	return result
}

func getField(config map[string]any, key string) string {
	return config[key].(string)
}

func main() {
	config := loadConfig("config.json")
	name := getField(config, "name")
	fmt.Println("Hello,", name)
}
