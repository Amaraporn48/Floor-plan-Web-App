// js/panzoom.js

class PanZoom {
  constructor(container, content, options = {}) {
    this.container = container;
    this.content = content;
    
    this.options = {
      minScale: 0.1,
      maxScale: 10,
      zoomSpeed: 0.15,
      onPanZoom: null, // Callback when translation or scale changes
      onClick: null,    // Callback on click (without dragging)
      onDragMarkerStart: null,
      onDragMarkerEnd: null,
      ...options
    };

    this.state = {
      x: 0,
      y: 0,
      scale: 1,
      isDragging: false,
      lastMouseX: 0,
      lastMouseY: 0,
      hasDragged: false,
      dragThreshold: 5, // Pixels of movement to count as a drag instead of a click
      
      // Touch state
      touches: {},
      initialDistance: 0,
      initialScale: 1
    };

    this.initEvents();
  }

  initEvents() {
    const container = this.container;

    // Mouse events
    container.addEventListener('mousedown', this.handleMouseDown.bind(this));
    window.addEventListener('mousemove', this.handleMouseMove.bind(this));
    window.addEventListener('mouseup', this.handleMouseUp.bind(this));

    // Scroll wheel zoom
    container.addEventListener('wheel', this.handleWheel.bind(this), { passive: false });

    // Touch events for mobile
    container.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
    container.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
    container.addEventListener('touchend', this.handleTouchEnd.bind(this), { passive: false });

    // Prevent default drag behaviors
    this.content.addEventListener('dragstart', (e) => e.preventDefault());
  }

  updateTransform() {
    this.content.style.transform = `translate(${this.state.x}px, ${this.state.y}px) scale(${this.state.scale})`;
    
    // Trigger callback if defined
    if (typeof this.options.onPanZoom === 'function') {
      this.options.onPanZoom(this.state.x, this.state.y, this.state.scale);
    }
  }

  zoom(scaleFactor, centerX, centerY) {
    const oldScale = this.state.scale;
    let newScale = oldScale * scaleFactor;
    
    // Clamp scale
    newScale = Math.max(this.options.minScale, Math.min(this.options.maxScale, newScale));
    
    if (newScale === oldScale) return;

    // Get coordinates relative to the content element
    const rect = this.container.getBoundingClientRect();
    const mouseX = centerX - rect.left;
    const mouseY = centerY - rect.top;

    // Calculate the new translation to keep the zoom centered on the cursor/pinch center
    this.state.x = mouseX - (mouseX - this.state.x) * (newScale / oldScale);
    this.state.y = mouseY - (mouseY - this.state.y) * (newScale / oldScale);
    this.state.scale = newScale;

    this.updateTransform();
  }

  zoomIn() {
    const rect = this.container.getBoundingClientRect();
    this.zoom(1 + this.options.zoomSpeed, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  zoomOut() {
    const rect = this.container.getBoundingClientRect();
    this.zoom(1 - this.options.zoomSpeed, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  reset() {
    this.state.x = 0;
    this.state.y = 0;
    this.state.scale = 1;
    this.updateTransform();
  }

  zoomToFit() {
    const containerRect = this.container.getBoundingClientRect();
    const contentRect = this.content.getBoundingClientRect();

    // Reset rotation and scale temporarily to get natural dimensions
    const originalTransform = this.content.style.transform;
    this.content.style.transform = 'none';
    
    const naturalWidth = this.content.offsetWidth || this.content.clientWidth || 800;
    const naturalHeight = this.content.offsetHeight || this.content.clientHeight || 600;
    
    this.content.style.transform = originalTransform;

    const scaleX = (containerRect.width - 20) / naturalWidth;
    const scaleY = (containerRect.height - 20) / naturalHeight;
    const newScale = Math.min(scaleX, scaleY, 1.5); // Cap fit scale to 1.5x max

    this.state.scale = Math.max(this.options.minScale, newScale);
    this.state.x = (containerRect.width - naturalWidth * this.state.scale) / 2;
    this.state.y = (containerRect.height - naturalHeight * this.state.scale) / 2;

    this.updateTransform();
  }

  // Mouse Handlers
  handleMouseDown(e) {
    // If clicking a button, form, or marker, ignore panning
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('.ac-marker') || e.target.closest('.no-pan')) {
      return;
    }

    this.state.isDragging = true;
    this.state.hasDragged = false;
    this.state.lastMouseX = e.clientX;
    this.state.lastMouseY = e.clientY;
    
    this.container.style.cursor = 'grabbing';
  }

  handleMouseMove(e) {
    if (!this.state.isDragging) return;

    const deltaX = e.clientX - this.state.lastMouseX;
    const deltaY = e.clientY - this.state.lastMouseY;

    if (Math.abs(deltaX) > this.state.dragThreshold || Math.abs(deltaY) > this.state.dragThreshold) {
      this.state.hasDragged = true;
    }

    this.state.x += deltaX;
    this.state.y += deltaY;
    this.state.lastMouseX = e.clientX;
    this.state.lastMouseY = e.clientY;

    this.updateTransform();
  }

  handleMouseUp(e) {
    if (!this.state.isDragging) return;
    this.state.isDragging = false;
    this.container.style.cursor = 'grab';

    // If it was a click without significant drag, process as a click
    if (!this.state.hasDragged) {
      this.processClick(e.clientX, e.clientY);
    }
  }

  handleWheel(e) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? (1 + this.options.zoomSpeed) : (1 - this.options.zoomSpeed);
    this.zoom(factor, e.clientX, e.clientY);
  }

  // Touch Handlers (Mobile)
  handleTouchStart(e) {
    // If clicking input, button, marker, ignore panning
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('.ac-marker') || e.target.closest('.no-pan')) {
      return;
    }

    const touches = e.touches;
    
    if (touches.length === 1) {
      // Single touch pan
      this.state.isDragging = true;
      this.state.hasDragged = false;
      this.state.lastMouseX = touches[0].clientX;
      this.state.lastMouseY = touches[0].clientY;
    } else if (touches.length === 2) {
      // Double touch zoom
      this.state.isDragging = false;
      this.state.initialScale = this.state.scale;
      this.state.initialDistance = this.getDistance(touches[0], touches[1]);
    }
  }

  handleTouchMove(e) {
    const touches = e.touches;

    if (touches.length === 1 && this.state.isDragging) {
      e.preventDefault(); // Stop mobile scrolling
      
      const deltaX = touches[0].clientX - this.state.lastMouseX;
      const deltaY = touches[0].clientY - this.state.lastMouseY;

      if (Math.abs(deltaX) > this.state.dragThreshold || Math.abs(deltaY) > this.state.dragThreshold) {
        this.state.hasDragged = true;
      }

      this.state.x += deltaX;
      this.state.y += deltaY;
      this.state.lastMouseX = touches[0].clientX;
      this.state.lastMouseY = touches[0].clientY;

      this.updateTransform();
    } else if (touches.length === 2) {
      e.preventDefault();
      
      const currentDistance = this.getDistance(touches[0], touches[1]);
      if (this.state.initialDistance > 0) {
        const factor = currentDistance / this.state.initialDistance;
        
        // Pinch center
        const centerX = (touches[0].clientX + touches[1].clientX) / 2;
        const centerY = (touches[0].clientY + touches[1].clientY) / 2;
        
        // Zoom relative to starting state
        const targetScale = this.state.initialScale * factor;
        const speedMultiplier = targetScale / this.state.scale;
        
        this.zoom(speedMultiplier, centerX, centerY);
      }
    }
  }

  handleTouchEnd(e) {
    if (this.state.isDragging) {
      this.state.isDragging = false;
      if (!this.state.hasDragged && e.changedTouches.length > 0) {
        this.processClick(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
      }
    }
    this.state.initialDistance = 0;
  }

  getDistance(t1, t2) {
    return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
  }

  // Click Translation
  processClick(clientX, clientY) {
    // Get click location relative to the actual floor plan image element
    const rect = this.content.getBoundingClientRect();
    
    // Coordinate within the scaled/translated element
    const xInContent = clientX - rect.left;
    const yInContent = clientY - rect.top;

    // Convert to percentages (0 - 100) based on unscaled bounds
    const percentX = (xInContent / rect.width) * 100;
    const percentY = (yInContent / rect.height) * 100;

    // Make sure we clicked inside the actual image bounds
    if (percentX >= 0 && percentX <= 100 && percentY >= 0 && percentY <= 100) {
      if (typeof this.options.onClick === 'function') {
        this.options.onClick(percentX, percentY);
      }
    }
  }

  // Helper to coordinate marker dragging
  makeMarkerDraggable(markerElement, onDragEndCallback) {
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let isDraggingMarker = false;

    const onMouseDown = (e) => {
      e.stopPropagation(); // Stop floor plan pan
      e.preventDefault();
      
      isDraggingMarker = true;
      startX = e.clientX;
      startY = e.clientY;
      
      // Parse current percentages from styling
      startLeft = parseFloat(markerElement.style.left) || 0;
      startTop = parseFloat(markerElement.style.top) || 0;

      markerElement.classList.add('dragging');
      this.container.style.cursor = 'move';
      
      if (typeof this.options.onDragMarkerStart === 'function') {
        this.options.onDragMarkerStart();
      }

      const onMouseMove = (moveEvent) => {
        if (!isDraggingMarker) return;
        
        // Calculate raw movement in screen pixels
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;

        // Convert pixel delta to percentage delta based on floor plan visual dimensions
        const contentRect = this.content.getBoundingClientRect();
        
        const percentDx = (dx / contentRect.width) * 100;
        const percentDy = (dy / contentRect.height) * 100;

        let newLeft = Math.max(0, Math.min(100, startLeft + percentDx));
        let newTop = Math.max(0, Math.min(100, startTop + percentDy));

        markerElement.style.left = `${newLeft}%`;
        markerElement.style.top = `${newTop}%`;
      };

      const onMouseUp = (upEvent) => {
        if (!isDraggingMarker) return;
        isDraggingMarker = false;
        
        markerElement.classList.remove('dragging');
        this.container.style.cursor = 'grab';

        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);

        // Get final percentages
        const finalLeft = parseFloat(markerElement.style.left);
        const finalTop = parseFloat(markerElement.style.top);

        if (typeof onDragEndCallback === 'function') {
          onDragEndCallback(finalLeft, finalTop);
        }
        
        if (typeof this.options.onDragMarkerEnd === 'function') {
          this.options.onDragMarkerEnd();
        }
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    };

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      e.stopPropagation();
      
      isDraggingMarker = true;
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;

      startLeft = parseFloat(markerElement.style.left) || 0;
      startTop = parseFloat(markerElement.style.top) || 0;
      
      markerElement.classList.add('dragging');

      if (typeof this.options.onDragMarkerStart === 'function') {
        this.options.onDragMarkerStart();
      }

      const onTouchMove = (moveEvent) => {
        if (!isDraggingMarker || moveEvent.touches.length !== 1) return;
        moveEvent.stopPropagation();
        
        const moveTouch = moveEvent.touches[0];
        const dx = moveTouch.clientX - startX;
        const dy = moveTouch.clientY - startY;

        const contentRect = this.content.getBoundingClientRect();
        
        const percentDx = (dx / contentRect.width) * 100;
        const percentDy = (dy / contentRect.height) * 100;

        let newLeft = Math.max(0, Math.min(100, startLeft + percentDx));
        let newTop = Math.max(0, Math.min(100, startTop + percentDy));

        markerElement.style.left = `${newLeft}%`;
        markerElement.style.top = `${newTop}%`;
      };

      const onTouchEnd = (endEvent) => {
        if (!isDraggingMarker) return;
        isDraggingMarker = false;
        
        markerElement.classList.remove('dragging');

        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', onTouchEnd);

        const finalLeft = parseFloat(markerElement.style.left);
        const finalTop = parseFloat(markerElement.style.top);

        if (typeof onDragEndCallback === 'function') {
          onDragEndCallback(finalLeft, finalTop);
        }

        if (typeof this.options.onDragMarkerEnd === 'function') {
          this.options.onDragMarkerEnd();
        }
      };

      window.addEventListener('touchmove', onTouchMove, { passive: false });
      window.addEventListener('touchend', onTouchEnd);
    };

    markerElement.addEventListener('mousedown', onMouseDown);
    markerElement.addEventListener('touchstart', onTouchStart, { passive: false });
  }
}

// Export globally
window.PanZoom = PanZoom;
