// input.js — Mouse and keyboard event handling for the game canvas

import { GRID, CANVAS_W, CANVAS_H } from './config.js';

export class InputManager {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.game = game;

    // Current mouse state in canvas coordinates
    this.mx = -1;
    this.my = -1;
    this.col = -1;
    this.row = -1;

    this._bindEvents();
  }

  _bindEvents() {
    const el = this.canvas;

    el.addEventListener('mousemove', e => {
      const pos = this._canvasPos(e);
      this.mx = pos.x;
      this.my = pos.y;
      this.col = Math.floor(pos.x / GRID.cell);
      this.row = Math.floor(pos.y / GRID.cell);
      this.col = Math.max(0, Math.min(GRID.cols - 1, this.col));
      this.row = Math.max(0, Math.min(GRID.rows - 1, this.row));
    });

    el.addEventListener('mouseleave', () => {
      this.col = -1;
      this.row = -1;
    });

    el.addEventListener('click', e => {
      e.preventDefault();
      const pos = this._canvasPos(e);
      const col = Math.floor(pos.x / GRID.cell);
      const row = Math.floor(pos.y / GRID.cell);
      if (col >= 0 && col < GRID.cols && row >= 0 && row < GRID.rows) {
        this.game.handleClick(col, row);
      }
    });

    el.addEventListener('touchstart', e => {
      if (e.touches.length > 0) {
        const touch = e.touches[0];
        const pos = this._canvasPos(touch);
        this.mx = pos.x;
        this.my = pos.y;
        const col = Math.floor(pos.x / GRID.cell);
        const row = Math.floor(pos.y / GRID.cell);
        if (col >= 0 && col < GRID.cols && row >= 0 && row < GRID.rows) {
          // Update visual position for placement ghost immediately
          this.col = Math.max(0, Math.min(GRID.cols - 1, col));
          this.row = Math.max(0, Math.min(GRID.rows - 1, row));
          
          // Small timeout to differentiate drag from tap if needed, but for TD direct click is fine
          this.game.handleClick(col, row);
        }
      }
    }, { passive: false });

    el.addEventListener('touchmove', e => {
      e.preventDefault(); // Prevent scrolling while dragging on canvas
      if (e.touches.length > 0) {
        const touch = e.touches[0];
        const pos = this._canvasPos(touch);
        this.mx = pos.x;
        this.my = pos.y;
        this.col = Math.floor(pos.x / GRID.cell);
        this.row = Math.floor(pos.y / GRID.cell);
        this.col = Math.max(0, Math.min(GRID.cols - 1, this.col));
        this.row = Math.max(0, Math.min(GRID.rows - 1, this.row));
      }
    }, { passive: false });

    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      this.game.cancelPlacement();
    });

    document.addEventListener('keydown', e => {
      switch (e.key) {
        case 'Escape':
          this.game.cancelPlacement();
          break;
        case ' ':
          e.preventDefault();
          this.game.togglePause();
          break;
        case '1': case '2': case '3': case '4': case '5':
          this.game.selectTowerType(parseInt(e.key) - 1);
          break;
      }
    });
  }

  _canvasPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (CANVAS_W / rect.width),
      y: (e.clientY - rect.top) * (CANVAS_H / rect.height),
    };
  }
}
