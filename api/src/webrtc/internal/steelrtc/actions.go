package steelrtc

import (
	"log"
	"os"
	"os/exec"
	"strconv"
	"webrtc/internal/config"
)

// Mouse event data
type MouseEvent struct {
	X      int    `json:"x"`
	Y      int    `json:"y"`
	Button string `json:"button"` // "left", "right", "middle"
	Action string `json:"action"` // "down", "up", "click", "move"
}

// Keyboard event data
type KeyboardEvent struct {
	Key    string `json:"key"`
	Action string `json:"action"` // "down", "up", "type"
}

// Clipboard event data
type ClipboardEvent struct {
	Text   string `json:"text"`
	Action string `json:"action"` // "copy", "paste"
}

// Handle mouse events by sending them to xdotool
func HandleMouseEvent(event MouseEvent) error {
	log.Printf("Mouse event: %+v", event)

	display := config.Display

	var cmd *exec.Cmd

	switch event.Action {
	case "move":
		cmd = exec.Command("xdotool", "mousemove", strconv.Itoa(event.X), strconv.Itoa(event.Y))
	case "click":
		buttonNum := "1" // left click
		if event.Button == "right" {
			buttonNum = "3"
		} else if event.Button == "middle" {
			buttonNum = "2"
		}
		// Move first, then click
		exec.Command("xdotool", "mousemove", strconv.Itoa(event.X), strconv.Itoa(event.Y)).Run()
		cmd = exec.Command("xdotool", "click", buttonNum)
	case "down":
		buttonNum := "1"
		if event.Button == "right" {
			buttonNum = "3"
		} else if event.Button == "middle" {
			buttonNum = "2"
		}
		exec.Command("xdotool", "mousemove", strconv.Itoa(event.X), strconv.Itoa(event.Y)).Run()
		cmd = exec.Command("xdotool", "mousedown", buttonNum)
	case "up":
		buttonNum := "1"
		if event.Button == "right" {
			buttonNum = "3"
		} else if event.Button == "middle" {
			buttonNum = "2"
		}
		cmd = exec.Command("xdotool", "mouseup", buttonNum)
	}

	if cmd != nil {
		cmd.Env = append(os.Environ(), "DISPLAY="+display)
		return cmd.Run()
	}

	return nil
}

// Handle keyboard events
func HandleKeyboardEvent(event KeyboardEvent) error {
	log.Printf("Keyboard event: %+v", event)

	display := config.Display

	var cmd *exec.Cmd

	switch event.Action {
	case "type":
		cmd = exec.Command("xdotool", "type", event.Key)
	case "down":
		cmd = exec.Command("xdotool", "keydown", event.Key)
	case "up":
		cmd = exec.Command("xdotool", "keyup", event.Key)
	}

	if cmd != nil {
		cmd.Env = append(os.Environ(), "DISPLAY="+display)
		return cmd.Run()
	}

	return nil
}

// Handle clipboard events
func HandleClipboardEvent(event ClipboardEvent) error {
	log.Printf("Clipboard event: %+v", event)

	display := config.Display

	var cmd *exec.Cmd

	switch event.Action {
	case "paste":
		// Set clipboard content then paste
		cmd = exec.Command("sh", "-c", "echo '"+event.Text+"' | xclip -selection clipboard")
		cmd.Env = append(os.Environ(), "DISPLAY="+display)
		if err := cmd.Run(); err != nil {
			return err
		}
		// Now paste with Ctrl+V
		cmd = exec.Command("xdotool", "key", "ctrl+v")
	case "copy":
		// Send Ctrl+C to copy
		cmd = exec.Command("xdotool", "key", "ctrl+c")
	}

	if cmd != nil {
		cmd.Env = append(os.Environ(), "DISPLAY="+display)
		return cmd.Run()
	}

	return nil
}
