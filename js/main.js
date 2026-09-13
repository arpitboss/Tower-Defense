// main.js — Bootstrap

import { GameEngine } from './game.js';
import { UI } from './ui.js';

const bgCanvas = document.getElementById('layer-bg');
const gameCanvas = document.getElementById('layer-game');

const engine = new GameEngine(bgCanvas, gameCanvas);
const ui = new UI(engine);
