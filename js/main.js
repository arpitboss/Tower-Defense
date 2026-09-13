// main.js — Bootstrap

import { GameEngine } from './game.js';
import { UI } from './ui.js';
import { AudioManager } from './audio.js';

const bgCanvas = document.getElementById('layer-bg');
const gameCanvas = document.getElementById('layer-game');

const audio = new AudioManager();
const engine = new GameEngine(bgCanvas, gameCanvas, audio);
const ui = new UI(engine, audio);
