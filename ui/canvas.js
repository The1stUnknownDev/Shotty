// ============================================
// Shotty — Canvas Annotation Engine
// ============================================

class AnnotationCanvas {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.backgroundImage = null;
    this.shapes = [];
    this.currentShape = null;
    this.isDrawing = false;

    // Select / drag state
    this.selectedShapeIndex = -1;
    this.isDragging = false;
    this.activeHandle = null; // null = move whole shape, 'start'/'end'/'tl'/'tr'/'bl'/'br' = resize handle
    this.dragStartX = 0;
    this.dragStartY = 0;

    // Retina / HiDPI support
    this.dpr = window.devicePixelRatio || 1;
    this.displayWidth = 0;   // CSS pixels
    this.displayHeight = 0;  // CSS pixels

    // Tool state
    this.tool = 'select';
    this.color = '#ef4444';
    this.strokeWidth = 3;

    // History
    this.undoStack = [];
    this.redoStack = [];
    this.maxHistory = 50;

    // Text tool state
    this.textInput = document.getElementById('floatingTextInput');

    // Canvas offset tracking
    this.canvasRect = null;

    // Callback when selection changes (set by app.js to sync toolbar UI)
    this.onSelectionChange = null;

    // Bind event handlers
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onTextInputBlur = this._onTextInputBlur.bind(this);
    this._onTextInputKeyDown = this._onTextInputKeyDown.bind(this);

    this.canvas.addEventListener('mousedown', this._onMouseDown);
    this.canvas.addEventListener('mousemove', this._onMouseMove);
    this.canvas.addEventListener('mouseup', this._onMouseUp);
    this.canvas.addEventListener('mouseleave', this._onMouseUp);
    this.textInput.addEventListener('blur', this._onTextInputBlur);
    this.textInput.addEventListener('keydown', this._onTextInputKeyDown);
  }

  // Load a screenshot image onto the canvas
  loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.backgroundImage = img;
        this.shapes = [];
        this.undoStack = [];
        this.redoStack = [];
        this.dpr = window.devicePixelRatio || 1;

        // Size canvas to image, respecting available space
        const container = this.canvas.parentElement;
        const maxW = container.parentElement.clientWidth - 48;
        const maxH = container.parentElement.clientHeight - 48;

        let w = img.naturalWidth;
        let h = img.naturalHeight;

        // Scale down if image is larger than viewport (in CSS pixels)
        const scale = Math.min(1, maxW / w, maxH / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);

        // Store CSS display dimensions
        this.displayWidth = w;
        this.displayHeight = h;

        // Set canvas backing store to full device pixel size
        this.canvas.width = w * this.dpr;
        this.canvas.height = h * this.dpr;

        // CSS size stays in logical pixels
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';

        // Scale context so all draw calls use CSS pixel coordinates
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

        this.render();
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  // Set active tool
  setTool(tool) {
    this.tool = tool;
    this.selectedShapeIndex = -1;
    this.isDragging = false;
    this.activeHandle = null;
    this._notifySelectionChange();
    this.canvas.style.cursor = tool === 'select' ? 'default' : 'crosshair';
    if (tool === 'text') {
      this.canvas.style.cursor = 'text';
    }
    this.render();
  }

  setColor(color) {
    this.color = color;
    if (this.selectedShapeIndex >= 0 && this.selectedShapeIndex < this.shapes.length) {
      this._pushHistory();
      this.shapes[this.selectedShapeIndex].color = color;
      this.render();
    }
  }

  setStrokeWidth(width) {
    this.strokeWidth = width;
    if (this.selectedShapeIndex >= 0 && this.selectedShapeIndex < this.shapes.length) {
      this._pushHistory();
      const shape = this.shapes[this.selectedShapeIndex];
      if (shape.type === 'text') {
        shape.fontSize = Math.max(14, width * 5);
      } else if (shape.type === 'blur') {
        shape.blurRadius = Math.max(20, width * 6);
        shape.strokeWidth = width;
      } else {
        shape.strokeWidth = width;
      }
      this.render();
    }
  }

  getSelectedShape() {
    if (this.selectedShapeIndex >= 0 && this.selectedShapeIndex < this.shapes.length) {
      return this.shapes[this.selectedShapeIndex];
    }
    return null;
  }

  deleteSelected() {
    if (this.selectedShapeIndex < 0 || this.selectedShapeIndex >= this.shapes.length) return;
    this._pushHistory();
    this.shapes.splice(this.selectedShapeIndex, 1);
    this.selectedShapeIndex = -1;
    this._notifySelectionChange();
    this.render();
  }

  _notifySelectionChange() {
    if (this.onSelectionChange) {
      this.onSelectionChange(this.getSelectedShape());
    }
  }

  // ---- History ----

  _pushHistory() {
    this.undoStack.push(JSON.parse(JSON.stringify(this.shapes)));
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this._updateHistoryButtons();
  }

  undo() {
    if (this.undoStack.length === 0) return;
    this.redoStack.push(JSON.parse(JSON.stringify(this.shapes)));
    this.shapes = this.undoStack.pop();
    this.selectedShapeIndex = -1;
    this._notifySelectionChange();
    this.render();
    this._updateHistoryButtons();
  }

  redo() {
    if (this.redoStack.length === 0) return;
    this.undoStack.push(JSON.parse(JSON.stringify(this.shapes)));
    this.shapes = this.redoStack.pop();
    this.selectedShapeIndex = -1;
    this._notifySelectionChange();
    this.render();
    this._updateHistoryButtons();
  }

  clearAnnotations() {
    if (this.shapes.length === 0) return;
    this._pushHistory();
    this.shapes = [];
    this.selectedShapeIndex = -1;
    this._notifySelectionChange();
    this.render();
  }

  _updateHistoryButtons() {
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    if (undoBtn) undoBtn.disabled = this.undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = this.redoStack.length === 0;
  }

  // ---- Mouse Events ----

  _getPos(e) {
    this.canvasRect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - this.canvasRect.left,
      y: e.clientY - this.canvasRect.top,
    };
  }

  _onMouseDown(e) {
    const pos = this._getPos(e);

    // ---- Select tool: check handles first, then hit test body ----
    if (this.tool === 'select') {
      // If a shape is already selected, check its handles first
      if (this.selectedShapeIndex >= 0) {
        const handle = this._hitTestHandles(this.selectedShapeIndex, pos.x, pos.y);
        if (handle) {
          this.activeHandle = handle;
          this.isDragging = true;
          this.dragStartX = pos.x;
          this.dragStartY = pos.y;
          this._pushHistory();
          this.render();
          return;
        }
      }

      const hitIndex = this._hitTest(pos.x, pos.y);
      if (hitIndex >= 0) {
        this.selectedShapeIndex = hitIndex;
        this.isDragging = true;
        this.activeHandle = null; // dragging whole shape
        this.dragStartX = pos.x;
        this.dragStartY = pos.y;
        this._pushHistory();
      } else {
        this.selectedShapeIndex = -1;
        this.activeHandle = null;
      }
      this._notifySelectionChange();
      this.render();
      return;
    }

    if (this.tool === 'text') {
      e.preventDefault(); // Prevent canvas from stealing focus
      this._showTextInput(e.clientX, e.clientY, pos.x, pos.y);
      return;
    }

    // If a shape is selected (e.g. just drawn), check handles before starting new shape
    if (this.selectedShapeIndex >= 0) {
      const handle = this._hitTestHandles(this.selectedShapeIndex, pos.x, pos.y);
      if (handle) {
        this.activeHandle = handle;
        this.isDragging = true;
        this.dragStartX = pos.x;
        this.dragStartY = pos.y;
        this._pushHistory();
        this.render();
        return;
      }
      // Clicked away from handles — deselect and start drawing
      this.selectedShapeIndex = -1;
      this.activeHandle = null;
      this._notifySelectionChange();
    }

    this.isDrawing = true;
    this._pushHistory();

    const baseShape = {
      type: this.tool,
      color: this.color,
      strokeWidth: this.strokeWidth,
      startX: pos.x,
      startY: pos.y,
      endX: pos.x,
      endY: pos.y,
    };

    if (this.tool === 'freehand' || this.tool === 'highlight') {
      baseShape.points = [{ x: pos.x, y: pos.y }];
    }

    if (this.tool === 'blur') {
      baseShape.blurRadius = Math.max(20, this.strokeWidth * 6);
    }

    this.currentShape = baseShape;
  }

  _onMouseMove(e) {
    // ---- Select tool: drag handle, drag shape, or hover cursor ----
    if (this.tool === 'select') {
      const pos = this._getPos(e);
      if (this.isDragging && this.selectedShapeIndex >= 0) {
        if (this.activeHandle) {
          this._moveHandle(this.selectedShapeIndex, this.activeHandle, pos.x, pos.y);
        } else {
          const dx = pos.x - this.dragStartX;
          const dy = pos.y - this.dragStartY;
          this._moveShape(this.selectedShapeIndex, dx, dy);
        }
        this.dragStartX = pos.x;
        this.dragStartY = pos.y;
        this.render();
      } else {
        // Check handle hover first if something is selected
        if (this.selectedShapeIndex >= 0) {
          const handle = this._hitTestHandles(this.selectedShapeIndex, pos.x, pos.y);
          if (handle) {
            this.canvas.style.cursor = this._handleCursor(handle);
            return;
          }
        }
        const hitIndex = this._hitTest(pos.x, pos.y);
        this.canvas.style.cursor = hitIndex >= 0 ? 'move' : 'default';
      }
      return;
    }

    // Handle dragging on a selected shape's handle (even in drawing tools)
    if (this.isDragging && this.activeHandle && this.selectedShapeIndex >= 0) {
      const pos = this._getPos(e);
      this._moveHandle(this.selectedShapeIndex, this.activeHandle, pos.x, pos.y);
      this.dragStartX = pos.x;
      this.dragStartY = pos.y;
      this.render();
      return;
    }

    if (!this.isDrawing || !this.currentShape) {
      // Show hover cursor on handles of selected shape
      if (this.selectedShapeIndex >= 0) {
        const pos = this._getPos(e);
        const handle = this._hitTestHandles(this.selectedShapeIndex, pos.x, pos.y);
        if (handle) {
          this.canvas.style.cursor = this._handleCursor(handle);
          return;
        }
      }
      // Reset to tool cursor when not over a handle
      this.canvas.style.cursor = this.tool === 'text' ? 'text' : 'crosshair';
      return;
    }

    const pos = this._getPos(e);
    this.currentShape.endX = pos.x;
    this.currentShape.endY = pos.y;

    if (this.currentShape.type === 'freehand' || this.currentShape.type === 'highlight') {
      this.currentShape.points.push({ x: pos.x, y: pos.y });
    }

    this.render();
    this._drawShape(this.currentShape);
  }

  _onMouseUp(e) {
    // ---- Select tool: stop dragging ----
    if (this.tool === 'select') {
      if (this.isDragging) {
        this.isDragging = false;
        this.activeHandle = null;
        this._updateHistoryButtons();
      }
      return;
    }

    // Stop handle drag on drawing tools
    if (this.isDragging && this.activeHandle) {
      this.isDragging = false;
      this.activeHandle = null;
      this._updateHistoryButtons();
      this.render();
      return;
    }

    if (!this.isDrawing || !this.currentShape) return;

    this.isDrawing = false;

    const pos = this._getPos(e);
    this.currentShape.endX = pos.x;
    this.currentShape.endY = pos.y;

    // Only add shape if it has some size
    const dx = Math.abs(this.currentShape.endX - this.currentShape.startX);
    const dy = Math.abs(this.currentShape.endY - this.currentShape.startY);
    const isPoint = this.currentShape.type === 'freehand' || this.currentShape.type === 'highlight';

    if (dx > 2 || dy > 2 || (isPoint && this.currentShape.points.length > 2)) {
      // Auto-set bezier control point for lines and arrows
      if (this.currentShape.type === 'line' || this.currentShape.type === 'arrow') {
        this.currentShape.midX = (this.currentShape.startX + this.currentShape.endX) / 2;
        this.currentShape.midY = (this.currentShape.startY + this.currentShape.endY) / 2;
      }

      // Auto-place magnified circle for magnify tool
      if (this.currentShape.type === 'magnify') {
        const srcRight = Math.max(this.currentShape.startX, this.currentShape.endX);
        const srcCY = (this.currentShape.startY + this.currentShape.endY) / 2;
        const sw = Math.abs(this.currentShape.endX - this.currentShape.startX);
        const sh = Math.abs(this.currentShape.endY - this.currentShape.startY);
        const magR = Math.max(Math.max(sw, sh) * 1.5, 60);
        this.currentShape.magX = srcRight + magR + 30;
        this.currentShape.magY = srcCY;
      }
      this.shapes.push(this.currentShape);

      // Auto-select shapes with handles for immediate adjustment
      const hasHandles = ['arrow', 'line', 'rect', 'ellipse', 'magnify', 'blur'].includes(this.currentShape.type);
      if (hasHandles) {
        this.selectedShapeIndex = this.shapes.length - 1;
        this._notifySelectionChange();
      }
    } else {
      // Remove the history entry we added since no shape was created
      this.undoStack.pop();
    }

    this.currentShape = null;
    this.render();
    this._updateHistoryButtons();
  }

  // ---- Text Tool ----

  _showTextInput(clientX, clientY, canvasX, canvasY) {
    this.textInput.style.display = 'block';
    this.textInput.style.left = clientX + 'px';
    this.textInput.style.top = clientY + 'px';
    this.textInput.style.color = this.color;
    this.textInput.style.fontSize = Math.max(14, this.strokeWidth * 5) + 'px';
    this.textInput.value = '';
    this.textInput.dataset.canvasX = canvasX;
    this.textInput.dataset.canvasY = canvasY;
    // Delay focus to ensure it sticks after mousedown completes
    requestAnimationFrame(() => this.textInput.focus());
  }

  _onTextInputBlur() {
    this._commitText();
  }

  _onTextInputKeyDown(e) {
    if (e.key === 'Escape') {
      this.textInput.style.display = 'none';
      this.textInput.value = '';
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this._commitText();
    }
  }

  _commitText() {
    const text = this.textInput.value.trim();
    if (text) {
      this._pushHistory();
      this.shapes.push({
        type: 'text',
        text,
        x: parseFloat(this.textInput.dataset.canvasX),
        y: parseFloat(this.textInput.dataset.canvasY),
        color: this.color,
        fontSize: Math.max(14, this.strokeWidth * 5),
      });
      this.render();
    }
    this.textInput.style.display = 'none';
    this.textInput.value = '';
  }

  // ---- Selection & Dragging ----

  _hitTest(x, y) {
    const pad = 10;
    // Walk in reverse so topmost shapes are tested first
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      const b = this._getShapeBounds(this.shapes[i]);
      if (x >= b.minX - pad && x <= b.maxX + pad &&
          y >= b.minY - pad && y <= b.maxY + pad) {
        return i;
      }
    }
    return -1;
  }

  _getShapeBounds(shape) {
    switch (shape.type) {
      case 'freehand':
      case 'highlight': {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of (shape.points || [])) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }
        return { minX, minY, maxX, maxY };
      }
      case 'text': {
        const { ctx } = this;
        ctx.save();
        ctx.font = `${shape.fontSize}px -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif`;
        const metrics = ctx.measureText(shape.text);
        ctx.restore();
        return {
          minX: shape.x,
          minY: shape.y,
          maxX: shape.x + metrics.width,
          maxY: shape.y + shape.fontSize,
        };
      }
      case 'magnify': {
        const sw = Math.abs(shape.endX - shape.startX);
        const sh = Math.abs(shape.endY - shape.startY);
        const radius = Math.max(Math.max(sw, sh) * 1.5, 60);
        const rectMinX = Math.min(shape.startX, shape.endX);
        const rectMinY = Math.min(shape.startY, shape.endY);
        const rectMaxX = Math.max(shape.startX, shape.endX);
        const rectMaxY = Math.max(shape.startY, shape.endY);
        if (shape.magX != null) {
          return {
            minX: Math.min(rectMinX, shape.magX - radius),
            minY: Math.min(rectMinY, shape.magY - radius),
            maxX: Math.max(rectMaxX, shape.magX + radius),
            maxY: Math.max(rectMaxY, shape.magY + radius),
          };
        }
        return { minX: rectMinX, minY: rectMinY, maxX: rectMaxX, maxY: rectMaxY };
      }
      default: { // line, arrow, rect, ellipse
        let minX = Math.min(shape.startX, shape.endX);
        let minY = Math.min(shape.startY, shape.endY);
        let maxX = Math.max(shape.startX, shape.endX);
        let maxY = Math.max(shape.startY, shape.endY);
        if (shape.midX != null) {
          minX = Math.min(minX, shape.midX);
          minY = Math.min(minY, shape.midY);
          maxX = Math.max(maxX, shape.midX);
          maxY = Math.max(maxY, shape.midY);
        }
        return { minX, minY, maxX, maxY };
      }
    }
  }

  _moveShape(index, dx, dy) {
    const shape = this.shapes[index];
    switch (shape.type) {
      case 'freehand':
      case 'highlight':
        for (const p of (shape.points || [])) {
          p.x += dx;
          p.y += dy;
        }
        shape.startX += dx;
        shape.startY += dy;
        shape.endX += dx;
        shape.endY += dy;
        break;
      case 'text':
        shape.x += dx;
        shape.y += dy;
        break;
      default:
        shape.startX += dx;
        shape.startY += dy;
        shape.endX += dx;
        shape.endY += dy;
        if (shape.midX != null) {
          shape.midX += dx;
          shape.midY += dy;
        }
        if (shape.magX != null) {
          shape.magX += dx;
          shape.magY += dy;
        }
    }
  }

  // Get handle positions for a shape (returns array of {id, x, y})
  _getHandles(shape) {
    switch (shape.type) {
      case 'arrow':
      case 'line': {
        const handles = [
          { id: 'start', x: shape.startX, y: shape.startY },
          { id: 'end', x: shape.endX, y: shape.endY },
        ];
        if (shape.midX != null) {
          handles.push({ id: 'mid', x: shape.midX, y: shape.midY });
        }
        return handles;
      }
      case 'magnify': {
        const handles = [
          { id: 'tl', x: shape.startX, y: shape.startY },
          { id: 'br', x: shape.endX, y: shape.endY },
        ];
        if (shape.magX != null) {
          handles.push({ id: 'mag', x: shape.magX, y: shape.magY });
        }
        return handles;
      }
      case 'rect':
      case 'ellipse':
      case 'blur':
        return [
          { id: 'tl', x: shape.startX, y: shape.startY },
          { id: 'tr', x: shape.endX, y: shape.startY },
          { id: 'bl', x: shape.startX, y: shape.endY },
          { id: 'br', x: shape.endX, y: shape.endY },
        ];
      default:
        return [];
    }
  }

  // Hit test handles for a specific shape, returns handle id or null
  _hitTestHandles(shapeIndex, x, y) {
    const shape = this.shapes[shapeIndex];
    const handles = this._getHandles(shape);
    const radius = 8;
    for (const h of handles) {
      const dx = x - h.x;
      const dy = y - h.y;
      if (dx * dx + dy * dy <= radius * radius) {
        return h.id;
      }
    }
    return null;
  }

  // Move a specific handle to an absolute position
  _moveHandle(shapeIndex, handleId, x, y) {
    const shape = this.shapes[shapeIndex];
    switch (shape.type) {
      case 'arrow':
      case 'line':
        if (handleId === 'start') {
          shape.startX = x;
          shape.startY = y;
        } else if (handleId === 'end') {
          shape.endX = x;
          shape.endY = y;
        } else if (handleId === 'mid') {
          shape.midX = x;
          shape.midY = y;
        }
        break;
      case 'magnify':
        if (handleId === 'tl') {
          shape.startX = x; shape.startY = y;
        } else if (handleId === 'br') {
          shape.endX = x; shape.endY = y;
        } else if (handleId === 'mag') {
          shape.magX = x; shape.magY = y;
        }
        break;
      case 'rect':
      case 'ellipse':
      case 'blur':
        if (handleId === 'tl') {
          shape.startX = x; shape.startY = y;
        } else if (handleId === 'tr') {
          shape.endX = x; shape.startY = y;
        } else if (handleId === 'bl') {
          shape.startX = x; shape.endY = y;
        } else if (handleId === 'br') {
          shape.endX = x; shape.endY = y;
        }
        break;
    }
  }

  // Get cursor style for a handle
  _handleCursor(handleId) {
    switch (handleId) {
      case 'start': case 'end': return 'grab';
      case 'tl': case 'br': return 'nwse-resize';
      case 'tr': case 'bl': return 'nesw-resize';
      case 'mid': case 'mag': return 'grab';
      default: return 'default';
    }
  }

  _drawSelectionIndicator(shape) {
    const b = this._getShapeBounds(shape);
    const pad = 6;
    const { ctx } = this;
    ctx.save();

    // Dashed bounding box
    ctx.strokeStyle = '#818cf8';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(
      b.minX - pad, b.minY - pad,
      b.maxX - b.minX + pad * 2,
      b.maxY - b.minY + pad * 2
    );
    ctx.setLineDash([]);

    // Draw handles
    const handles = this._getHandles(shape);
    const handleRadius = 5;
    for (const h of handles) {
      ctx.beginPath();
      ctx.arc(h.x, h.y, handleRadius, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#818cf8';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.restore();
  }

  // ---- Rendering ----

  render() {
    const { ctx, canvas } = this;

    // Clear the full backing store, then restore DPR transform
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    // Draw background image in CSS pixel coordinates (DPR transform handles the rest)
    if (this.backgroundImage) {
      ctx.drawImage(this.backgroundImage, 0, 0, this.displayWidth, this.displayHeight);
    }

    // Draw all committed shapes
    for (const shape of this.shapes) {
      this._drawShape(shape);
    }

    // Draw selection indicator on top
    if (this.selectedShapeIndex >= 0 && this.selectedShapeIndex < this.shapes.length) {
      this._drawSelectionIndicator(this.shapes[this.selectedShapeIndex]);
    }
  }

  _drawShape(shape) {
    const { ctx } = this;
    ctx.save();

    ctx.strokeStyle = shape.color;
    ctx.fillStyle = shape.color;
    ctx.lineWidth = shape.strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (shape.type) {
      case 'freehand':
        this._drawFreehand(shape);
        break;
      case 'highlight':
        this._drawHighlight(shape);
        break;
      case 'line':
        this._drawLine(shape);
        break;
      case 'arrow':
        this._drawArrow(shape);
        break;
      case 'rect':
        this._drawRect(shape);
        break;
      case 'ellipse':
        this._drawEllipse(shape);
        break;
      case 'text':
        this._drawText(shape);
        break;
      case 'magnify':
        this._drawMagnify(shape);
        break;
      case 'blur':
        this._drawBlur(shape);
        break;
    }

    ctx.restore();
  }

  _drawFreehand(shape) {
    const { ctx } = this;
    if (!shape.points || shape.points.length < 2) return;

    ctx.beginPath();
    ctx.moveTo(shape.points[0].x, shape.points[0].y);

    // Smooth curve through points
    for (let i = 1; i < shape.points.length - 1; i++) {
      const xc = (shape.points[i].x + shape.points[i + 1].x) / 2;
      const yc = (shape.points[i].y + shape.points[i + 1].y) / 2;
      ctx.quadraticCurveTo(shape.points[i].x, shape.points[i].y, xc, yc);
    }

    const last = shape.points[shape.points.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }

  _drawHighlight(shape) {
    const { ctx } = this;
    if (!shape.points || shape.points.length < 2) return;

    ctx.globalAlpha = 0.35;
    ctx.lineWidth = shape.strokeWidth * 6;
    ctx.globalCompositeOperation = 'multiply';

    ctx.beginPath();
    ctx.moveTo(shape.points[0].x, shape.points[0].y);
    for (let i = 1; i < shape.points.length; i++) {
      ctx.lineTo(shape.points[i].x, shape.points[i].y);
    }
    ctx.stroke();
  }

  // Convert on-curve midpoint to bezier control point
  _bezierControl(shape) {
    return {
      x: 2 * shape.midX - 0.5 * shape.startX - 0.5 * shape.endX,
      y: 2 * shape.midY - 0.5 * shape.startY - 0.5 * shape.endY,
    };
  }

  _drawLine(shape) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(shape.startX, shape.startY);
    if (shape.midX != null) {
      const cp = this._bezierControl(shape);
      ctx.quadraticCurveTo(cp.x, cp.y, shape.endX, shape.endY);
    } else {
      ctx.lineTo(shape.endX, shape.endY);
    }
    ctx.stroke();
  }

  _drawArrow(shape) {
    const { ctx } = this;
    const headLen = Math.max(12, shape.strokeWidth * 4);
    const cp = shape.midX != null ? this._bezierControl(shape) : null;

    // Shaft
    ctx.beginPath();
    ctx.moveTo(shape.startX, shape.startY);
    if (cp) {
      ctx.quadraticCurveTo(cp.x, cp.y, shape.endX, shape.endY);
    } else {
      ctx.lineTo(shape.endX, shape.endY);
    }
    ctx.stroke();

    // Arrowhead angle: tangent at endpoint
    // For quadratic bezier, tangent at t=1 is direction from control point to end
    const refX = cp ? cp.x : shape.startX;
    const refY = cp ? cp.y : shape.startY;
    const angle = Math.atan2(shape.endY - refY, shape.endX - refX);

    ctx.beginPath();
    ctx.moveTo(shape.endX, shape.endY);
    ctx.lineTo(
      shape.endX - headLen * Math.cos(angle - Math.PI / 6),
      shape.endY - headLen * Math.sin(angle - Math.PI / 6)
    );
    ctx.moveTo(shape.endX, shape.endY);
    ctx.lineTo(
      shape.endX - headLen * Math.cos(angle + Math.PI / 6),
      shape.endY - headLen * Math.sin(angle + Math.PI / 6)
    );
    ctx.stroke();
  }

  _drawRect(shape) {
    const { ctx } = this;
    const x = Math.min(shape.startX, shape.endX);
    const y = Math.min(shape.startY, shape.endY);
    const w = Math.abs(shape.endX - shape.startX);
    const h = Math.abs(shape.endY - shape.startY);

    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.stroke();
  }

  _drawEllipse(shape) {
    const { ctx } = this;
    const cx = (shape.startX + shape.endX) / 2;
    const cy = (shape.startY + shape.endY) / 2;
    const rx = Math.abs(shape.endX - shape.startX) / 2;
    const ry = Math.abs(shape.endY - shape.startY) / 2;

    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  _drawText(shape) {
    const { ctx } = this;
    ctx.font = `${shape.fontSize}px -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(shape.text, shape.x, shape.y);
  }

  _drawBlur(shape) {
    this._drawBlurWithCtx(this.ctx, shape, this.backgroundImage, this.displayWidth, this.displayHeight, 1);
  }

  _drawBlurWithCtx(ctx, shape, img, imgW, imgH, sf) {
    if (!img) return;
    const x = Math.min(shape.startX, shape.endX) * sf;
    const y = Math.min(shape.startY, shape.endY) * sf;
    const w = Math.abs(shape.endX - shape.startX) * sf;
    const h = Math.abs(shape.endY - shape.startY) * sf;
    if (w < 1 || h < 1) return;

    const pixelSize = Math.max(6, Math.ceil((shape.blurRadius || 20) * sf * 0.6));
    const ratioX = img.naturalWidth / (imgW * sf);
    const ratioY = img.naturalHeight / (imgH * sf);

    // Tiny canvas — downscale the region to create pixelation
    const smallW = Math.max(1, Math.ceil(w / pixelSize));
    const smallH = Math.max(1, Math.ceil(h / pixelSize));
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = smallW;
    tmpCanvas.height = smallH;
    const tmpCtx = tmpCanvas.getContext('2d');

    // Draw source region at tiny size (averaged down)
    tmpCtx.drawImage(
      img,
      x * ratioX, y * ratioY, w * ratioX, h * ratioY,
      0, 0, smallW, smallH
    );

    // Draw back at full size with no smoothing = pixelated blocks
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmpCanvas, 0, 0, smallW, smallH, x, y, w, h);
    ctx.restore();
  }

  _drawMagnify(shape) {
    this._drawMagnifyWithCtx(
      this.ctx, shape,
      this.backgroundImage,
      this.displayWidth, this.displayHeight,
      1
    );
  }

  _drawMagnifyWithCtx(ctx, shape, img, imgW, imgH, sf) {
    // Source rect
    const x1 = Math.min(shape.startX, shape.endX) * sf;
    const y1 = Math.min(shape.startY, shape.endY) * sf;
    const sw = Math.abs(shape.endX - shape.startX) * sf;
    const sh = Math.abs(shape.endY - shape.startY) * sf;
    const lw = shape.strokeWidth * sf;

    // Draw source rectangle (dashed)
    ctx.save();
    ctx.lineWidth = lw;
    ctx.setLineDash([4 * sf, 3 * sf]);
    ctx.strokeRect(x1, y1, sw, sh);
    ctx.setLineDash([]);
    ctx.restore();

    // If magX/magY not set yet (still drawing), just show the rect preview
    if (shape.magX == null) return;

    const srcCX = (x1 + sw / 2);
    const srcCY = (y1 + sh / 2);
    const magCX = shape.magX * sf;
    const magCY = shape.magY * sf;
    const magR = Math.max(sw, sh) * 1.5;
    const minR = 60 * sf;
    const radius = Math.max(magR, minR);

    // Zoom: how much larger the mag circle is vs the source
    const srcDiag = Math.max(sw, sh);
    const zoom = srcDiag > 0 ? (radius * 2) / srcDiag : 1;

    // Connecting line from source rect edge to mag circle
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(srcCX, srcCY);
    ctx.lineTo(magCX, magCY);
    ctx.stroke();

    // Magnified content (clipped circle)
    if (img) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(magCX, magCY, radius, 0, Math.PI * 2);
      ctx.clip();

      // Draw image zoomed so source rect center maps to mag circle center
      ctx.drawImage(
        img,
        magCX - srcCX * zoom,
        magCY - srcCY * zoom,
        imgW * zoom,
        imgH * zoom
      );
      ctx.restore();
    }

    // Magnified circle border
    ctx.beginPath();
    ctx.arc(magCX, magCY, radius, 0, Math.PI * 2);
    ctx.lineWidth = lw + 1 * sf;
    ctx.stroke();
  }

  // ---- Export ----

  toDataURL() {
    // Render at full resolution for export
    if (!this.backgroundImage) return this.canvas.toDataURL('image/png');

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = this.backgroundImage.naturalWidth;
    exportCanvas.height = this.backgroundImage.naturalHeight;
    const exportCtx = exportCanvas.getContext('2d');

    // Draw background at full resolution
    exportCtx.drawImage(this.backgroundImage, 0, 0);

    // Scale factor from CSS display size to original image size
    const sx = this.backgroundImage.naturalWidth / this.displayWidth;
    const sy = this.backgroundImage.naturalHeight / this.displayHeight;

    // Redraw shapes at full resolution
    for (const shape of this.shapes) {
      exportCtx.save();
      exportCtx.strokeStyle = shape.color;
      exportCtx.fillStyle = shape.color;
      exportCtx.lineWidth = shape.strokeWidth * sx;
      exportCtx.lineCap = 'round';
      exportCtx.lineJoin = 'round';

      switch (shape.type) {
        case 'freehand': {
          if (!shape.points || shape.points.length < 2) break;
          exportCtx.beginPath();
          exportCtx.moveTo(shape.points[0].x * sx, shape.points[0].y * sy);
          for (let i = 1; i < shape.points.length - 1; i++) {
            const xc = (shape.points[i].x * sx + shape.points[i + 1].x * sx) / 2;
            const yc = (shape.points[i].y * sy + shape.points[i + 1].y * sy) / 2;
            exportCtx.quadraticCurveTo(shape.points[i].x * sx, shape.points[i].y * sy, xc, yc);
          }
          const last = shape.points[shape.points.length - 1];
          exportCtx.lineTo(last.x * sx, last.y * sy);
          exportCtx.stroke();
          break;
        }
        case 'highlight': {
          if (!shape.points || shape.points.length < 2) break;
          exportCtx.globalAlpha = 0.35;
          exportCtx.lineWidth = shape.strokeWidth * 6 * sx;
          exportCtx.globalCompositeOperation = 'multiply';
          exportCtx.beginPath();
          exportCtx.moveTo(shape.points[0].x * sx, shape.points[0].y * sy);
          for (let i = 1; i < shape.points.length; i++) {
            exportCtx.lineTo(shape.points[i].x * sx, shape.points[i].y * sy);
          }
          exportCtx.stroke();
          break;
        }
        case 'line': {
          const cpL = shape.midX != null ? this._bezierControl(shape) : null;
          exportCtx.beginPath();
          exportCtx.moveTo(shape.startX * sx, shape.startY * sy);
          if (cpL) {
            exportCtx.quadraticCurveTo(cpL.x * sx, cpL.y * sy, shape.endX * sx, shape.endY * sy);
          } else {
            exportCtx.lineTo(shape.endX * sx, shape.endY * sy);
          }
          exportCtx.stroke();
          break;
        }
        case 'arrow': {
          const headLen = Math.max(12, shape.strokeWidth * 4) * sx;
          const cpA = shape.midX != null ? this._bezierControl(shape) : null;
          exportCtx.beginPath();
          exportCtx.moveTo(shape.startX * sx, shape.startY * sy);
          if (cpA) {
            exportCtx.quadraticCurveTo(cpA.x * sx, cpA.y * sy, shape.endX * sx, shape.endY * sy);
          } else {
            exportCtx.lineTo(shape.endX * sx, shape.endY * sy);
          }
          exportCtx.stroke();
          const refX = cpA ? cpA.x * sx : shape.startX * sx;
          const refY = cpA ? cpA.y * sy : shape.startY * sy;
          const angle = Math.atan2(shape.endY * sy - refY, shape.endX * sx - refX);
          exportCtx.beginPath();
          exportCtx.moveTo(shape.endX * sx, shape.endY * sy);
          exportCtx.lineTo(
            shape.endX * sx - headLen * Math.cos(angle - Math.PI / 6),
            shape.endY * sy - headLen * Math.sin(angle - Math.PI / 6)
          );
          exportCtx.moveTo(shape.endX * sx, shape.endY * sy);
          exportCtx.lineTo(
            shape.endX * sx - headLen * Math.cos(angle + Math.PI / 6),
            shape.endY * sy - headLen * Math.sin(angle + Math.PI / 6)
          );
          exportCtx.stroke();
          break;
        }
        case 'rect': {
          const x = Math.min(shape.startX, shape.endX) * sx;
          const y = Math.min(shape.startY, shape.endY) * sy;
          const w = Math.abs(shape.endX - shape.startX) * sx;
          const h = Math.abs(shape.endY - shape.startY) * sy;
          exportCtx.beginPath();
          exportCtx.rect(x, y, w, h);
          exportCtx.stroke();
          break;
        }
        case 'ellipse': {
          const cx = (shape.startX + shape.endX) / 2 * sx;
          const cy = (shape.startY + shape.endY) / 2 * sy;
          const rx = Math.abs(shape.endX - shape.startX) / 2 * sx;
          const ry = Math.abs(shape.endY - shape.startY) / 2 * sy;
          exportCtx.beginPath();
          exportCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          exportCtx.stroke();
          break;
        }
        case 'text':
          exportCtx.font = `${shape.fontSize * sx}px -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif`;
          exportCtx.textBaseline = 'top';
          exportCtx.fillText(shape.text, shape.x * sx, shape.y * sy);
          break;
        case 'blur':
          this._drawBlurWithCtx(
            exportCtx, shape,
            this.backgroundImage,
            this.backgroundImage.naturalWidth,
            this.backgroundImage.naturalHeight,
            sx
          );
          break;
        case 'magnify':
          this._drawMagnifyWithCtx(
            exportCtx, shape,
            this.backgroundImage,
            this.backgroundImage.naturalWidth,
            this.backgroundImage.naturalHeight,
            sx
          );
          break;
      }

      exportCtx.restore();
    }

    return exportCanvas.toDataURL('image/png');
  }

  hasImage() {
    return this.backgroundImage !== null;
  }

  destroy() {
    this.canvas.removeEventListener('mousedown', this._onMouseDown);
    this.canvas.removeEventListener('mousemove', this._onMouseMove);
    this.canvas.removeEventListener('mouseup', this._onMouseUp);
    this.canvas.removeEventListener('mouseleave', this._onMouseUp);
    this.textInput.removeEventListener('blur', this._onTextInputBlur);
    this.textInput.removeEventListener('keydown', this._onTextInputKeyDown);
  }
}

// Export globally
window.AnnotationCanvas = AnnotationCanvas;
