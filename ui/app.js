// ============================================
// Shotty — Main Application
// ============================================

const { invoke } = window.__TAURI__.core;

let canvas = null;

// ---- Initialization ----

document.addEventListener('DOMContentLoaded', () => {
  canvas = new AnnotationCanvas(document.getElementById('drawingCanvas'));

  initToolbar();
  initActions();
  initSettings();
  initKeyboardShortcuts();

  // Sync toolbar UI when a shape is selected/deselected
  canvas.onSelectionChange = (shape) => {
    if (shape) {
      // Update color swatches to match selected shape
      const color = shape.color;
      let matched = false;
      document.querySelectorAll('.color-swatch').forEach(s => {
        if (s.dataset.color === color) {
          s.classList.add('active');
          matched = true;
        } else {
          s.classList.remove('active');
        }
      });
      // If color doesn't match any swatch, deselect all
      if (!matched) {
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      }

      // Update stroke width slider
      const strokeSlider = document.getElementById('strokeWidth');
      const strokeValue = document.getElementById('strokeValue');
      const width = shape.type === 'text' ? Math.round(shape.fontSize / 5) : shape.strokeWidth;
      strokeSlider.value = width;
      strokeValue.textContent = width;
    }
  };
});

// ---- Toolbar ----

function initToolbar() {
  // Tool buttons
  document.querySelectorAll('[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      canvas.setTool(btn.dataset.tool);
    });
  });

  // Color swatches
  document.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
      canvas.setColor(swatch.dataset.color);
    });
  });

  // Stroke width
  const strokeSlider = document.getElementById('strokeWidth');
  const strokeValue = document.getElementById('strokeValue');
  strokeSlider.addEventListener('input', () => {
    const val = parseInt(strokeSlider.value);
    strokeValue.textContent = val;
    canvas.setStrokeWidth(val);
  });

  // Capture buttons
  document.getElementById('captureBtn').addEventListener('click', captureRegion);
  document.getElementById('fullscreenBtn').addEventListener('click', captureFullscreen);

  // History buttons
  document.getElementById('undoBtn').addEventListener('click', () => canvas.undo());
  document.getElementById('redoBtn').addEventListener('click', () => canvas.redo());
  document.getElementById('clearBtn').addEventListener('click', () => canvas.clearAnnotations());
}

// ---- Capture ----

async function captureRegion() {
  try {
    const dataUrl = await invoke('capture_screenshot');
    await loadScreenshot(dataUrl);
    showToast('Screenshot captured', 'success');
  } catch (err) {
    if (err !== 'Screenshot cancelled') {
      showToast('Capture failed: ' + err, 'error');
    }
  }
}

async function captureFullscreen() {
  try {
    const displays = await invoke('list_displays');

    if (displays.length === 0) {
      showToast('No displays found', 'error');
      return;
    }

    // Single display — capture immediately
    if (displays.length === 1) {
      const dataUrl = await invoke('capture_fullscreen', { display: displays[0].index });
      await loadScreenshot(dataUrl);
      showToast('Fullscreen captured', 'success');
      return;
    }

    // Multiple displays — show picker
    showDisplayPicker(displays);
  } catch (err) {
    showToast('Capture failed: ' + err, 'error');
  }
}

function showDisplayPicker(displays) {
  const picker = document.getElementById('displayPicker');
  const list = document.getElementById('displayList');
  list.innerHTML = '';

  displays.forEach(d => {
    const btn = document.createElement('button');
    btn.className = 'display-option';
    btn.innerHTML = `
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
      </svg>
      <span class="display-label">Display ${d.index}${d.is_main ? ' (Main)' : ''}</span>
      <span class="display-res">${d.width} × ${d.height}</span>
    `;
    btn.addEventListener('mouseenter', () => {
      invoke('show_display_highlight', { index: d.index });
    });
    btn.addEventListener('mouseleave', () => {
      invoke('hide_display_highlight');
    });
    btn.addEventListener('click', async () => {
      invoke('hide_display_highlight');
      picker.classList.remove('visible');
      try {
        const dataUrl = await invoke('capture_fullscreen', { display: d.index });
        await loadScreenshot(dataUrl);
        showToast('Fullscreen captured', 'success');
      } catch (err) {
        if (err !== 'Screenshot cancelled') {
          showToast('Capture failed: ' + err, 'error');
        }
      }
    });
    list.appendChild(btn);
  });

  picker.classList.add('visible');

  // Close on overlay click
  const closeHandler = (e) => {
    if (e.target === picker) {
      invoke('hide_display_highlight');
      picker.classList.remove('visible');
      picker.removeEventListener('click', closeHandler);
    }
  };
  picker.addEventListener('click', closeHandler);
}

async function loadScreenshot(dataUrl) {
  const info = await canvas.loadImage(dataUrl);

  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('canvasContainer').style.display = 'flex';
  document.getElementById('actionBar').style.display = 'flex';
  document.getElementById('imageInfo').textContent = `${info.width} × ${info.height}`;
}

// ---- Actions ----

function initActions() {
  document.getElementById('saveBtn').addEventListener('click', saveScreenshot);
  document.getElementById('copyImageBtn').addEventListener('click', copyImage);
  document.getElementById('uploadBtn').addEventListener('click', uploadToS3);
}

async function saveScreenshot() {
  if (!canvas.hasImage()) return;

  const btn = document.getElementById('saveBtn');
  btn.classList.add('loading');

  try {
    const dataUrl = canvas.toDataURL();
    const filename = `shotty_${timestamp()}.png`;
    const filepath = await invoke('save_to_disk', { imageData: dataUrl, filename });
    showToast(`Saved to ${filepath}`, 'success');
  } catch (err) {
    showToast('Save failed: ' + err, 'error');
  } finally {
    btn.classList.remove('loading');
  }
}

async function copyImage() {
  if (!canvas.hasImage()) return;

  const btn = document.getElementById('copyImageBtn');
  btn.classList.add('loading');

  try {
    const dataUrl = canvas.toDataURL();
    await invoke('copy_image_to_clipboard', { imageData: dataUrl });
    showToast('Image copied to clipboard', 'success');
  } catch (err) {
    showToast('Copy failed: ' + err, 'error');
  } finally {
    btn.classList.remove('loading');
  }
}

async function uploadToS3() {
  if (!canvas.hasImage()) return;

  const btn = document.getElementById('uploadBtn');
  const originalHTML = btn.innerHTML;
  btn.classList.add('loading');
  btn.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: pulse 1s infinite">
      <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
    </svg>
    Uploading...`;

  try {
    const dataUrl = canvas.toDataURL();
    const filename = `screenshots/${timestamp()}.png`;
    const url = await invoke('upload_to_s3', { imageData: dataUrl, filename });

    // Copy URL to clipboard
    await invoke('copy_to_clipboard', { text: url });
    showToast('Uploaded! URL copied to clipboard', 'success');
  } catch (err) {
    showToast('Upload failed: ' + err, 'error');
  } finally {
    btn.classList.remove('loading');
    btn.innerHTML = originalHTML;
  }
}

// ---- Settings ----

function initSettings() {
  const modal = document.getElementById('settingsModal');
  const openBtn = document.getElementById('settingsBtn');
  const closeBtn = document.getElementById('closeSettings');
  const cancelBtn = document.getElementById('cancelSettings');
  const saveBtn = document.getElementById('saveSettingsBtn');
  const testBtn = document.getElementById('testConnectionBtn');

  initShortcutRecorder();

  openBtn.addEventListener('click', async () => {
    await populateSettings();
    modal.classList.add('visible');
  });

  closeBtn.addEventListener('click', () => modal.classList.remove('visible'));
  cancelBtn.addEventListener('click', () => modal.classList.remove('visible'));

  // Close on overlay click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('visible');
  });

  saveBtn.addEventListener('click', async () => {
    const settings = gatherSettings();
    try {
      // Apply the new global shortcut
      await invoke('update_shortcut', { newShortcut: settings.capture_shortcut });
      await invoke('save_settings', { settings });
      showToast('Settings saved', 'success');
      modal.classList.remove('visible');
    } catch (err) {
      showToast('Failed to save settings: ' + err, 'error');
    }
  });

  testBtn.addEventListener('click', async () => {
    const settings = gatherSettings();
    testBtn.classList.add('loading');
    testBtn.textContent = 'Testing...';

    try {
      const result = await invoke('test_s3_connection', { settings });
      showToast(result, 'success');
    } catch (err) {
      showToast(err, 'error');
    } finally {
      testBtn.classList.remove('loading');
      testBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        Test Connection`;
    }
  });
}

async function populateSettings() {
  try {
    const settings = await invoke('load_settings');
    document.getElementById('awsAccessKey').value = settings.aws_access_key_id || '';
    document.getElementById('awsSecretKey').value = settings.aws_secret_access_key || '';
    document.getElementById('awsRegion').value = settings.aws_region || 'us-east-1';
    document.getElementById('s3Bucket').value = settings.s3_bucket || '';
    document.getElementById('customDomain').value = settings.custom_domain || '';
    document.getElementById('makePublic').checked = settings.make_public !== false;
    document.getElementById('saveDirectory').value = settings.save_directory || '';
    const shortcut = settings.capture_shortcut || 'CommandOrControl+Shift+S';
    document.getElementById('captureShortcut').value = shortcut;
    document.getElementById('shortcutDisplay').textContent = tauriToDisplay(shortcut);
  } catch (err) {
    showToast('Failed to load settings: ' + err, 'error');
  }
}

function gatherSettings() {
  return {
    aws_access_key_id: document.getElementById('awsAccessKey').value,
    aws_secret_access_key: document.getElementById('awsSecretKey').value,
    aws_region: document.getElementById('awsRegion').value,
    s3_bucket: document.getElementById('s3Bucket').value,
    custom_domain: document.getElementById('customDomain').value,
    make_public: document.getElementById('makePublic').checked,
    save_directory: document.getElementById('saveDirectory').value,
    capture_shortcut: document.getElementById('captureShortcut').value,
  };
}

// ---- Shortcut Recorder ----

let isRecording = false;

function initShortcutRecorder() {
  const recorder = document.getElementById('shortcutRecorder');
  const display = document.getElementById('shortcutDisplay');
  const btn = document.getElementById('recordShortcutBtn');
  const hiddenInput = document.getElementById('captureShortcut');

  btn.addEventListener('click', () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  });

  function startRecording() {
    isRecording = true;
    recorder.classList.add('recording');
    btn.textContent = 'Cancel';
    display.textContent = 'Press shortcut...';
    document.addEventListener('keydown', recordKey);
  }

  function stopRecording() {
    isRecording = false;
    recorder.classList.remove('recording');
    btn.textContent = 'Record';
    document.removeEventListener('keydown', recordKey);
    // Restore display from hidden input
    display.textContent = tauriToDisplay(hiddenInput.value);
  }

  function recordKey(e) {
    e.preventDefault();
    e.stopPropagation();

    // Ignore bare modifier presses
    if (['Meta', 'Shift', 'Alt', 'Control'].includes(e.key)) return;

    // Require at least one modifier
    if (!e.metaKey && !e.ctrlKey && !e.altKey) return;

    // Build Tauri-format shortcut string
    const parts = [];
    if (e.metaKey || e.ctrlKey) parts.push('CommandOrControl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');

    // Map the key to a readable name
    const keyName = normalizeKey(e);
    if (!keyName) return;
    parts.push(keyName);

    const tauriStr = parts.join('+');
    hiddenInput.value = tauriStr;
    display.textContent = tauriToDisplay(tauriStr);

    // Stop recording
    isRecording = false;
    recorder.classList.remove('recording');
    btn.textContent = 'Record';
    document.removeEventListener('keydown', recordKey);
  }
}

// Map a KeyboardEvent to a key name Tauri understands
function normalizeKey(e) {
  // Letters
  if (e.code.startsWith('Key')) return e.code.slice(3); // KeyS → S
  // Digits
  if (e.code.startsWith('Digit')) return e.code.slice(5); // Digit4 → 4
  // Function keys
  if (e.code.startsWith('F') && !isNaN(e.code.slice(1))) return e.code; // F1
  // Special keys
  const specialMap = {
    Space: 'Space', Backspace: 'Backspace', Tab: 'Tab',
    Enter: 'Enter', Escape: 'Escape', Delete: 'Delete',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
    Minus: '-', Equal: '=', Backquote: '`',
  };
  return specialMap[e.code] || null;
}

// Convert "CommandOrControl+Shift+S" → "⌘⇧S"
function tauriToDisplay(str) {
  if (!str) return '';
  return str
    .replace(/CommandOrControl/g, '⌘')
    .replace(/Shift/g, '⇧')
    .replace(/Alt/g, '⌥')
    .replace(/Control/g, '⌃')
    .replace(/\+/g, '');
}

// ---- Keyboard Shortcuts ----

function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Don't handle shortcuts while recording a new one
    if (isRecording) return;

    const meta = e.metaKey || e.ctrlKey;

    // Cmd+Shift+S — Capture region
    if (meta && e.shiftKey && e.key === 's') {
      e.preventDefault();
      captureRegion();
      return;
    }

    // Cmd+Z — Undo
    if (meta && !e.shiftKey && e.key === 'z') {
      e.preventDefault();
      canvas.undo();
      return;
    }

    // Cmd+Shift+Z — Redo
    if (meta && e.shiftKey && e.key === 'z') {
      e.preventDefault();
      canvas.redo();
      return;
    }

    // Cmd+S — Save
    if (meta && !e.shiftKey && e.key === 's') {
      e.preventDefault();
      saveScreenshot();
      return;
    }

    // Cmd+U — Upload
    if (meta && e.key === 'u') {
      e.preventDefault();
      uploadToS3();
      return;
    }

    // Escape — Close modal or deselect tool
    if (e.key === 'Escape') {
      const modal = document.getElementById('settingsModal');
      if (modal.classList.contains('visible')) {
        modal.classList.remove('visible');
      } else {
        // Switch to select tool
        document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
        document.querySelector('[data-tool="select"]').classList.add('active');
        canvas.setTool('select');
      }
      return;
    }

    // Delete selected shape
    if ((e.key === 'Backspace' || e.key === 'Delete') && canvas.getSelectedShape()) {
      e.preventDefault();
      canvas.deleteSelected();
      return;
    }

    // Tool shortcuts (only when not typing in input)
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

    const toolMap = {
      'v': 'select',
      'p': 'freehand',
      'l': 'line',
      'a': 'arrow',
      'r': 'rect',
      'o': 'ellipse',
      't': 'text',
      'h': 'highlight',
      'm': 'magnify',
      'b': 'blur',
    };

    if (toolMap[e.key]) {
      e.preventDefault();
      const toolBtn = document.querySelector(`[data-tool="${toolMap[e.key]}"]`);
      if (toolBtn) {
        document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
        toolBtn.classList.add('active');
        canvas.setTool(toolMap[e.key]);
      }
    }
  });
}

// ---- Toast Notifications ----

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');

  const icons = {
    success: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    error: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    info: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);

  // Auto-dismiss
  setTimeout(() => {
    toast.classList.add('hiding');
    setTimeout(() => toast.remove(), 200);
  }, 4000);
}

// ---- Utilities ----

function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function pad(n) {
  return n.toString().padStart(2, '0');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
