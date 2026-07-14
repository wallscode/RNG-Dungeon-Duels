// main.js — Entry point: creates the Game and calls init().

import { Game } from './game.js';

const game = new Game();
game.init();

// Debug handle (also used by automated tests).
window.game = game;
