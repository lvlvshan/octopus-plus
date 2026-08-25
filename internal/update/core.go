package update

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"

	"github.com/bestruirui/octopus/internal/utils/log"
	"github.com/bestruirui/octopus/internal/utils/shutdown"
)

func UpdateCore() error {
	log.Infof("start update core")

	filename, err := getDownloadFilename()
	if err != nil {
		log.Warnf("update core failed: %v", err)
		return err
	}

	downloadUrl := updateUrl + "/" + filename
	log.Infof("download url: %s", downloadUrl)
	data, err := doRequestWithFallback(downloadUrl)
	if err != nil {
		log.Warnf("download failed: %v", err)
		return err
	}

	execPath, err := os.Executable()
	if err != nil {
		log.Warnf("get executable path failed: %v", err)
		return err
	}

	// Extract to temp dir first (cannot overwrite running binary)
	tmpDir, err := os.MkdirTemp("", "octopus-update-*")
	if err != nil {
		log.Warnf("create temp dir failed: %v", err)
		return err
	}

	var newExePath string
	if strings.HasSuffix(filename, ".zip") {
		// Zip archive — extract and find .exe inside
		if err := unzip(data, tmpDir); err != nil {
			log.Warnf("unzip failed: %v", err)
			os.RemoveAll(tmpDir)
			return err
		}
		err = filepath.Walk(tmpDir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			if !info.IsDir() && strings.HasSuffix(strings.ToLower(info.Name()), ".exe") {
				newExePath = path
				return filepath.SkipDir
			}
			return nil
		})
		if err != nil {
			log.Warnf("scan extracted files failed: %v", err)
			os.RemoveAll(tmpDir)
			return err
		}
		if newExePath == "" {
			log.Warnf("no .exe file found in extracted archive")
			os.RemoveAll(tmpDir)
			return fmt.Errorf("no executable found in update package")
		}
	} else {
		// Bare binary — write directly to temp dir with the correct name
		execName := filepath.Base(filename)
		newExePath = filepath.Join(tmpDir, execName)
		if err := os.WriteFile(newExePath, data, 0755); err != nil {
			log.Warnf("write temp binary failed: %v", err)
			os.RemoveAll(tmpDir)
			return err
		}
	}

	log.Infof("update core success, restarting with: %s", newExePath)
	go func() {
		defer os.RemoveAll(tmpDir)
		restartExecutable(execPath, newExePath)
	}()
	return nil
}

func getDownloadFilename() (string, error) {
	arch := runtime.GOARCH
	goos := runtime.GOOS

	switch goos {
	case "windows":
		switch arch {
		case "386":
			return "octopus-windows-386.exe", nil
		case "amd64":
			return "octopus-windows-amd64.exe", nil
		}
	case "darwin":
		switch arch {
		case "amd64":
			return "octopus-darwin-amd64", nil
		case "arm64":
			return "octopus-darwin-arm64", nil
		}
	case "linux":
		switch arch {
		case "386":
			return "octopus-linux-386", nil
		case "amd64":
			return "octopus-linux-amd64", nil
		case "arm":
			return "octopus-linux-armv7", nil
		case "arm64":
			return "octopus-linux-arm64", nil
		}
	}
	return "", fmt.Errorf("unsupported platform: %s/%s", goos, arch)
}

func restartExecutable(oldExecPath, newExePath string) {
	shutdown.Shutdown()

	log.Infof("restarting: %q -> %q", oldExecPath, newExePath)

	if runtime.GOOS == "windows" {
		// Copy new exe to target location before replacing
		destDir := filepath.Dir(oldExecPath)
		destPath := filepath.Join(destDir, filepath.Base(oldExecPath))

		if err := copyFile(newExePath, destPath); err != nil {
			log.Errorf("copy new executable failed: %v", err)
			os.Exit(1)
		}
		log.Infof("copied %s -> %s", newExePath, destPath)

		cmd := exec.Command(destPath, os.Args[1:]...)
		cmd.Stdin = os.Stdin
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Start(); err != nil {
			log.Errorf("restarting failed: %v", err)
		}
		os.Exit(0)
	}

	// Unix: replace in-place then exec
	destDir := filepath.Dir(oldExecPath)
	destPath := filepath.Join(destDir, filepath.Base(oldExecPath))

	if err := copyFile(newExePath, destPath); err != nil {
		log.Errorf("copy new executable failed: %v", err)
		os.Exit(1)
	}

	if err := syscall.Exec(destPath, os.Args, os.Environ()); err != nil {
		log.Errorf("restarting failed: %v", err)
	}
}

func copyFile(src, dst string) error {
	sourceFile, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("open source: %w", err)
	}
	defer sourceFile.Close()

	tempDst := dst + ".tmp"
	destFile, err := os.OpenFile(tempDst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0755)
	if err != nil {
		return fmt.Errorf("open dest: %w", err)
	}

	if _, err = io.Copy(destFile, sourceFile); err != nil {
		destFile.Close()
		os.Remove(tempDst)
		return fmt.Errorf("copy data: %w", err)
	}

	if err = destFile.Close(); err != nil {
		os.Remove(tempDst)
		return fmt.Errorf("close dest: %w", err)
	}

	// Atomic rename (works on same filesystem)
	if err = os.Rename(tempDst, dst); err != nil {
		// Fallback: try remove + rename
		os.Remove(dst)
		if err = os.Rename(tempDst, dst); err != nil {
			return fmt.Errorf("rename dest: %w", err)
		}
	}

	// Preserve execute permission
	if err = os.Chmod(dst, 0755); err != nil {
		log.Warnf("chmod failed: %v", err)
	}

	return nil
}
