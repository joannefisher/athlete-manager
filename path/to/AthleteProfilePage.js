function handleSave() {
  // Your existing code

  // Auto-clear defaultPosition when it's no longer valid
  if (!isValidPosition(defaultPosition)) {
    defaultPosition = null;
  }

  // Other handling code
}
