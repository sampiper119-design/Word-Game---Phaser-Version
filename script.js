// 1. CONFIGURATION & GAME CONSTANTS
const SIZE = 6;
const MIN_WORD_LEN = 3;
const TILE_GAP = 8;

const LETTER_FREQ = {
  E: 14, A: 10, I: 10, O: 9, U: 6,
  N: 7, R: 7, T: 6, S: 6, L: 6, D: 5,
  G: 3, C: 3, M: 2, P: 2, F: 2, H: 2, B: 2, W: 2, Y: 2, V: 1,
  K: 1, J: 1, X: 1, Q: 1, Z: 1
};

const LETTER_POOL = Object.entries(LETTER_FREQ)
  .flatMap(([letter, count]) => Array(count).fill(letter));

const RARE_LETTERS = new Set(["Q", "Z", "X", "J", "K", "V"]);
const LENGTH_BONUS = { 3: 3, 4: 6, 5: 8, 6: 12, 7: 16, 8: 20 };
const WORD_SET = window.WORD_SET || new Set();

// 2. MAIN SCENE CLASS
class MainScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MainScene' });
  }

  create() {
    this.resetStateVars();
    this.bindDOMReferences();
    this.calculateTileDimensions();
    this.createBoardGraphics();
    this.setupDOMEventListeners();
    this.setupInputHandlers();

    this.resetGame();
  }

  resetStateVars() {
    this.board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
    this.tileSprites = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
    this.score = 0;
    this.gameOver = false;
    this.bombCount = 2;
    this.bombActive = false;
    this.comboCount = 0;
    this.moveCounter = 0;
    this.hotZone = { type: "row", index: 0 };
    this.isAnimating = false;
    this.showReadyWord = true;
  }

  bindDOMReferences() {
    this.domReadyLabel = document.getElementById('readyLabel');
    this.domScore = document.getElementById('score');
    this.domBombCount = document.getElementById('bombCount');
    this.domBombBtn = document.getElementById('bombBtn');
    this.domAssistToggle = document.getElementById('assistToggle');
    this.domRestartBtn = document.getElementById('restartBtn');
    this.domWordLog = document.getElementById('wordLog');
    this.domOverlay = document.getElementById('gameOverOverlay');
    this.domSweepResults = document.getElementById('sweepResults');
    this.domFinalScore = document.getElementById('finalScore');
    this.domPlayAgainBtn = document.getElementById('playAgainBtn');
    this.domBoard = document.getElementById('board');
  }

  calculateTileDimensions() {
    this.padding = 10;
    const gameWidth = this.sys.game.config.width || 500;
    const availableWidth = gameWidth - (this.padding * 2);
    this.tileSize = (availableWidth - (TILE_GAP * (SIZE - 1))) / SIZE;
  }

  //Graphics & Aesthetics (Matching HTML Theme)
  createBoardGraphics() {
    this.gridSlots = [];
    
    for (let r = 0; r < SIZE; r++) {
      this.gridSlots[r] = [];
      for (let c = 0; c < SIZE; c++) {
        const x = this.padding + c * (this.tileSize + TILE_GAP) + this.tileSize / 2;
        const y = this.padding + r * (this.tileSize + TILE_GAP) + this.tileSize / 2;

        const slot = this.add.graphics();
        slot.lineStyle(2, 0xc2b280, 0.6); 
        slot.strokeRect(-this.tileSize / 2, -this.tileSize / 2, this.tileSize, this.tileSize);
        slot.setPosition(x, y);

        this.gridSlots[r][c] = slot;
      }
    }
  }

  createTileSprite(r, c, letter) {
    const x = this.padding + c * (this.tileSize + TILE_GAP) + this.tileSize / 2;
    const y = this.padding + r * (this.tileSize + TILE_GAP) + this.tileSize / 2;

    const container = this.add.container(x, y);
    
    // Wood tile background
    const bg = this.add.rectangle(0, 0, this.tileSize, this.tileSize, 0xeeddca).setInteractive({ useHandCursor: true });
    bg.setStrokeStyle(2, 0xb8977e);

    // Letter text styling
    const text = this.add.text(0, 0, letter, {
      fontFamily: 'Courier New, monospace',
      fontSize: `${Math.floor(this.tileSize * 0.45)}px`,
      fontStyle: 'bold',
      color: '#3d2b1f'
    }).setOrigin(0.5);

    container.add([bg, text]);
    container.setScale(0);

    this.tweens.add({
      targets: container,
      scale: 1,
      duration: 150,
      ease: 'Back.out'
    });

    return container;
  }

  //DOM Interactions
  setupDOMEventListeners() {
    if (this.domBombBtn) {
      this.domBombBtn.onclick = () => this.toggleBombMode();
    }
    if (this.domRestartBtn) {
      this.domRestartBtn.onclick = () => this.resetGame();
    }
    if (this.domPlayAgainBtn) {
      this.domPlayAgainBtn.onclick = () => {
        if (this.domOverlay) this.domOverlay.classList.add('hidden');
        this.resetGame();
      };
    }
    if (this.domAssistToggle) {
      this.domAssistToggle.onchange = (e) => {
        this.showReadyWord = e.target.checked;
        this.updateReadyStatus();
      };
    }
  }

  setupInputHandlers() {
    this.input.keyboard.on('keydown', (event) => {
      if (this.gameOver || this.isAnimating) return;

      if (event.key === 'Enter') {
        this.submitWord();
        return;
      }

      const keyMap = {
        'ArrowLeft': 'left', 'a': 'left',
        'ArrowRight': 'right', 'd': 'right',
        'ArrowUp': 'up', 'w': 'up',
        'ArrowDown': 'down', 's': 'down'
      };

      if (keyMap[event.key]) this.handleMove(keyMap[event.key]);
    });

    this.input.on('pointerdown', (pointer) => {
      if (this.gameOver) return;

      const cellSpan = this.tileSize + TILE_GAP;
      const localX = pointer.x - this.padding;
      const localY = pointer.y - this.padding;
      const c = Math.floor(localX / cellSpan);
      const r = Math.floor(localY / cellSpan);

      if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return;
      if ((localX - c * cellSpan) > this.tileSize) return;
      if ((localY - r * cellSpan) > this.tileSize) return;

      this.onTileClicked(r, c);
    });

    this.input.on('pointerup', (pointer) => {
      if (this.gameOver || this.isAnimating) return;

      const dx = pointer.upX - pointer.downX;
      const dy = pointer.upY - pointer.downY;
      const swipeThreshold = 40;

      if (Math.max(Math.abs(dx), Math.abs(dy)) < swipeThreshold) return;

      if (Math.abs(dx) > Math.abs(dy)) {
        this.handleMove(dx > 0 ? 'right' : 'left');
      } else {
        this.handleMove(dy > 0 ? 'down' : 'up');
      }
    });
  }

  // Bomb Power-up & Wildcard Pickers
  toggleBombMode() {
    if (this.bombCount <= 0 || this.gameOver) return;
    this.bombActive = !this.bombActive;
    this.updateBombUI();
  }

  updateBombUI() {
    if (this.domBombCount) this.domBombCount.textContent = this.bombCount;
    if (this.domBombBtn) {
      this.domBombBtn.classList.toggle('active', this.bombActive);
      this.domBombBtn.disabled = this.bombCount <= 0;
    }
    if (this.domBoard) {
      this.domBoard.classList.toggle('bomb-active', this.bombActive);
    }
  }

  triggerBomb(r, c) {
    if (this.bombCount <= 0 || this.gameOver) return;

    const startR = r === SIZE - 1 ? r - 1 : r;
    const startC = c === SIZE - 1 ? c - 1 : c;
    const targetCoords = [];

    for (let dr = 0; dr < 2; dr++) {
      for (let dc = 0; dc < 2; dc++) {
        const tr = startR + dr;
        const tc = startC + dc;
        if (tr < SIZE && tc < SIZE && this.board[tr][tc] !== null) {
          targetCoords.push([tr, tc]);
        }
      }
    }

    this.bombCount--;
    this.bombActive = false;
    this.updateBombUI();

    this.animateTileClear(targetCoords, () => {
      this.checkGameOver();
    });
  }

  openWildcardPicker(r, c) {
    const choice = prompt("Enter a letter to assign to this Wildcard (?) tile:", "E");
    if (choice && choice.trim().length === 1) {
      const letter = choice.trim().toUpperCase();
      if (/^[A-Z]$/.test(letter)) {
        this.board[r][c] = letter;
        this.tileSprites[r][c].list[1].setText(letter);
        this.updateReadyStatus();
      }
    }
  }

  onTileClicked(r, c) {
    if (this.bombActive) {
      this.triggerBomb(r, c);
    } else if (this.board[r][c] === "?") {
      this.openWildcardPicker(r, c);
    }
  }

  //Scoring & Words Logging
  calculateWordScore(wordStr) {
    const upper = wordStr.toUpperCase();
    const len = upper.length;
    let points = LENGTH_BONUS[len] !== undefined ? LENGTH_BONUS[len] : len * 2;
    const hasRare = upper.split("").some(char => RARE_LETTERS.has(char));
    if (hasRare) points *= 2;
    return { points, isBonus: hasRare };
  }

  isTileInHotZone(r, c) {
    if (this.hotZone.type === "row" && r === this.hotZone.index) return true;
    if (this.hotZone.type === "col" && c === this.hotZone.index) return true;
    return false;
  }

  findCrossMatch(words) {
    const horizontals = words.filter(w => w.type === "horizontal");
    const verticals = words.filter(w => w.type === "vertical");

    for (const h of horizontals) {
      for (const v of verticals) {
        const intersect = h.coords.some(([hr, hc]) =>
          v.coords.some(([vr, vc]) => hr === vr && hc === vc)
        );
        if (intersect) return { hWord: h, vWord: v };
      }
    }
    return null;
  }

  logWordToDOM(text) {
    if (!this.domWordLog) return;
    const li = document.createElement('li');
    li.textContent = text;
    this.domWordLog.prepend(li);
  }

  submitWord() {
    if (this.gameOver || this.isAnimating) return;

    const foundWords = this.findBoardWords();
    if (foundWords.length === 0) return;

    const cross = this.findCrossMatch(foundWords);
    let totalPoints = 0;
    let clearedCoords = [];
    let logLine = '';

    if (cross) {
      const hScore = this.calculateWordScore(cross.hWord.word).points;
      const vScore = this.calculateWordScore(cross.vWord.word).points;
      let baseCrossPoints = (hScore + vScore) * 2;

      this.comboCount++;
      if (this.comboCount > 1) baseCrossPoints *= 2;

      totalPoints = baseCrossPoints;
      clearedCoords = [...cross.hWord.coords, ...cross.vWord.coords];

      const isHot = clearedCoords.some(([r, c]) => this.isTileInHotZone(r, c));
      if (isHot) totalPoints *= 2;

      const hotLabel = isHot ? " ⚡2x HOT ZONE!" : "";
      const comboLabel = this.comboCount > 1 ? ` 🔥 ${this.comboCount}x COMBO!` : "";
      logLine = `CROSS: ${cross.hWord.word.toUpperCase()} + ${cross.vWord.word.toUpperCase()}${hotLabel} — ${totalPoints} pts ⚡2x${comboLabel}`;
    } else {
      this.comboCount = 0;
      const target = foundWords[0];
      const { points, isBonus } = this.calculateWordScore(target.word);

      totalPoints = points;
      clearedCoords = target.coords;

      const isHot = clearedCoords.some(([r, c]) => this.isTileInHotZone(r, c));
      if (isHot) totalPoints *= 2;

      const hotLabel = isHot ? " (2x HOT ZONE)" : "";
      const bonusTag = isBonus ? " ⚡2x" : "";
      logLine = `${target.word.toUpperCase()}${hotLabel} — ${totalPoints} pts${bonusTag}`;
    }

    this.animateTileClear(clearedCoords, () => {
      this.score += totalPoints;
      if (this.domScore) this.domScore.textContent = this.score;
      this.logWordToDOM(logLine);
      this.updateReadyStatus();
      this.checkGameOver();
    });
  }

  animateTileClear(coords, onComplete) {
    this.isAnimating = true;
    let completed = 0;
    const uniqueCoords = Array.from(new Set(coords.map(JSON.stringify)), JSON.parse);

    if (uniqueCoords.length === 0) {
      this.isAnimating = false;
      if (onComplete) onComplete();
      return;
    }

    uniqueCoords.forEach(([r, c]) => {
      const sprite = this.tileSprites[r][c];
      if (sprite) {
        this.board[r][c] = null;
        this.tileSprites[r][c] = null;

        this.tweens.add({
          targets: sprite,
          scale: 0,
          alpha: 0,
          duration: 200,
          ease: 'Back.in',
          onComplete: () => {
            sprite.destroy();
            completed++;
            if (completed === uniqueCoords.length) {
              this.isAnimating = false;
              if (onComplete) onComplete();
            }
          }
        });
      }
    });
  }

  //Dictionary Scanning & Word Lookups
  sliceToRegex(slice) {
    const pattern = slice.map(tile => tile === "?" ? "[a-z]" : tile.toLowerCase()).join("");
    return new RegExp(`^${pattern}$`);
  }

  matchSliceToDictionary(slice) {
    if (slice.includes(null)) return null;
    const directStr = slice.join("").toLowerCase();
    if (directStr.length < MIN_WORD_LEN) return null;

    if (typeof WORD_SET !== "undefined" && WORD_SET.has(directStr)) return directStr;

    if (slice.includes("?")) {
      const regex = this.sliceToRegex(slice);
      for (const word of WORD_SET) {
        if (word.length === directStr.length && regex.test(word)) return word;
      }
    }
    return null;
  }

  findBoardWords() {
    const words = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        for (let len = SIZE - c; len >= 1; len--) {
          const slice = this.board[r].slice(c, c + len);
          const validWord = this.matchSliceToDictionary(slice);
          if (validWord) {
            words.push({
              word: validWord,
              type: "horizontal",
              coords: Array.from({ length: len }, (_, i) => [r, c + i])
            });
            break;
          }
        }
      }
    }

    for (let c = 0; c < SIZE; c++) {
      for (let r = 0; r < SIZE; r++) {
        for (let len = SIZE - r; len >= 1; len--) {
          const slice = [];
          for (let i = 0; i < len; i++) slice.push(this.board[r + i][c]);
          const validWord = this.matchSliceToDictionary(slice);
          if (validWord) {
            words.push({
              word: validWord,
              type: "vertical",
              coords: Array.from({ length: len }, (_, i) => [r + i, c])
            });
            break;
          }
        }
      }
    }
    return words;
  }

  clearTileHighlights() {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const sprite = this.tileSprites[r][c];
        if (sprite) {
          const bg = sprite.list[0];
          bg.setFillStyle(0xeeddca);
          bg.setStrokeStyle(2, 0xb8977e);
        }
      }
    }
  }

  highlightReadyWords(foundWords, cross) {
    this.clearTileHighlights();

    foundWords.forEach(w => {
      w.coords.forEach(([r, c]) => {
        const sprite = this.tileSprites[r][c];
        if (sprite) sprite.list[0].setFillStyle(0xd49b4b);
      });
    });

    if (cross) {
      const crossCoords = cross.hWord.coords.filter(([hr, hc]) =>
        cross.vWord.coords.some(([vr, vc]) => vr === hr && vc === hc)
      );
      crossCoords.forEach(([r, c]) => {
        const sprite = this.tileSprites[r][c];
        if (sprite) sprite.list[0].setStrokeStyle(3, 0xffbf00);
      });
    }
  }

  updateReadyStatus() {
    if (!this.domReadyLabel) return;

    const foundWords = this.findBoardWords();
    const cross = foundWords.length > 0 ? this.findCrossMatch(foundWords) : null;

    if (!this.showReadyWord) {
      this.domReadyLabel.textContent = "Word preview hidden.";
      this.domReadyLabel.classList.remove('active');
      this.clearTileHighlights();
      return;
    }

    if (foundWords.length > 0) {
      const names = foundWords.map(w => w.word.toUpperCase()).join(", ");
      this.domReadyLabel.textContent = cross
        ? `Cross ready: ${names} (Press Enter)`
        : `Ready: ${names} (Press Enter)`;
      this.domReadyLabel.classList.add('active');
      this.highlightReadyWords(foundWords, cross);
    } else {
      this.domReadyLabel.textContent = "Move a letter to begin.";
      this.domReadyLabel.classList.remove('active');
      this.clearTileHighlights();
    }
  }

  // Endgame Sweep Engine
  collectLinesWithCoords() {
    const lines = [];
    for (let r = 0; r < SIZE; r++) {
      const rowCoords = Array.from({ length: SIZE }, (_, c) => [r, c]);
      lines.push(rowCoords, [...rowCoords].reverse());
    }

    for (let c = 0; c < SIZE; c++) {
      const colCoords = Array.from({ length: SIZE }, (_, r) => [r, c]);
      lines.push(colCoords, [...colCoords].reverse());
    }

    for (let slice = -(SIZE - MIN_WORD_LEN); slice <= SIZE - MIN_WORD_LEN; slice++) {
      const diag = [];
      for (let r = 0; r < SIZE; r++) {
        const c = r + slice;
        if (c >= 0 && c < SIZE) diag.push([r, c]);
      }
      if (diag.length >= MIN_WORD_LEN) lines.push(diag, [...diag].reverse());
    }

    for (let slice = MIN_WORD_LEN - 1; slice < 2 * SIZE - MIN_WORD_LEN; slice++) {
      const diag = [];
      for (let r = 0; r < SIZE; r++) {
        const c = slice - r;
        if (c >= 0 && c < SIZE) diag.push([r, c]);
      }
      if (diag.length >= MIN_WORD_LEN) lines.push(diag, [...diag].reverse());
    }
    return lines;
  }

  findBestWordInCoords(coords) {
    const letters = coords.map(([r, c]) => this.board[r][c]);
    const str = letters.join("").toLowerCase();
    let best = null;

    for (let start = 0; start < str.length; start++) {
      for (let end = str.length; end > start; end--) {
        const len = end - start;
        if (len < MIN_WORD_LEN) continue;
        if (best && len <= best.len) continue;

        const slice = letters.slice(start, end);
        const matched = this.matchSliceToDictionary(slice);
        if (matched) {
          best = { word: matched, len, wordCoords: coords.slice(start, end) };
        }
      }
    }
    return best;
  }

  async runEndgameSweepAnimated() {
    if (this.domReadyLabel) this.domReadyLabel.textContent = "Board full! Running final sweep...";
    const linesCoords = this.collectLinesWithCoords();
    const foundWords = [];

    for (const lineCoords of linesCoords) {
      lineCoords.forEach(([r, c]) => {
        const sprite = this.tileSprites[r][c];
        if (sprite) sprite.list[0].setStrokeStyle(3, 0xd9534f);
      });

      await new Promise(r => this.time.delayedCall(60, r));
      const best = this.findBestWordInCoords(lineCoords);

      if (best) {
        const { points } = this.calculateWordScore(best.word);
        foundWords.push({ ...best, points });

        best.wordCoords.forEach(([r, c]) => {
          const sprite = this.tileSprites[r][c];
          if (sprite) sprite.list[0].setStrokeStyle(3, 0x5cb85c);
        });

        this.score += points;
        if (this.domScore) this.domScore.textContent = this.score;
        await new Promise(r => this.time.delayedCall(450, r));
      }

      lineCoords.forEach(([r, c]) => {
        const sprite = this.tileSprites[r][c];
        if (sprite) sprite.list[0].setStrokeStyle(2, 0xcdb289);
      });
    }

    if (this.domFinalScore) this.domFinalScore.textContent = this.score;
    if (this.domSweepResults) {
      this.domSweepResults.innerHTML = foundWords.length > 0
        ? foundWords.map(w => `<p>${w.word.toUpperCase()} (+${w.points} pts)</p>`).join("")
        : "<p>No additional words found during sweep.</p>";
    }
    if (this.domOverlay) this.domOverlay.classList.remove('hidden');
  }

  checkGameOver() {
    if (this.emptyCells().length > 0) return;
    if (this.findBoardWords().length > 0) return;

    this.gameOver = true;
    this.runEndgameSweepAnimated();
  }

  //Tile Movement
  slideLine(line) {
    const letters = line.filter(item => item !== null);
    const gaps = Array(line.length - letters.length).fill(null);
    return letters.concat(gaps);
  }

  getLine(r0, c0, dr, dc) {
    const line = [];
    let r = r0, c = c0;
    while (r >= 0 && r < SIZE && c >= 0 && c < SIZE) {
      line.push({ tile: this.board[r][c], r, c });
      r += dr; c += dc;
    }
    return line;
  }

  handleMove(direction) {
    let changed = false;
    const linesToProcess = [];

    if (direction === "left" || direction === "right") {
      for (let r = 0; r < SIZE; r++) {
        linesToProcess.push(
          this.getLine(r, direction === "left" ? 0 : SIZE - 1, 0, direction === "left" ? 1 : -1)
        );
      }
    } else {
      for (let c = 0; c < SIZE; c++) {
        linesToProcess.push(
          this.getLine(direction === "up" ? 0 : SIZE - 1, c, direction === "up" ? 1 : -1, 0)
        );
      }
    }

    const moveAnimations = [];
    const newBoard = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
    const newTileSprites = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));

    linesToProcess.forEach(line => {
      const currentValues = line.map(item => item.tile);
      const slidValues = this.slideLine(currentValues);

      if (JSON.stringify(currentValues) !== JSON.stringify(slidValues)) {
        changed = true;
      }

      let targetIdx = 0;
      line.forEach(item => {
        if (item.tile !== null) {
          const targetCell = line[targetIdx];
          newBoard[targetCell.r][targetCell.c] = item.tile;
          newTileSprites[targetCell.r][targetCell.c] = this.tileSprites[item.r][item.c];

          const targetX = this.padding + targetCell.c * (this.tileSize + TILE_GAP) + this.tileSize / 2;
          const targetY = this.padding + targetCell.r * (this.tileSize + TILE_GAP) + this.tileSize / 2;

          moveAnimations.push({
            sprite: this.tileSprites[item.r][item.c],
            x: targetX,
            y: targetY
          });
          targetIdx++;
        }
      });
    });

    if (!changed) return;

    this.board = newBoard;
    this.tileSprites = newTileSprites;
    this.animateMoves(moveAnimations);
  }

  animateMoves(animations) {
    this.isAnimating = true;
    let completed = 0;

    animations.forEach(anim => {
      this.tweens.add({
        targets: anim.sprite,
        x: anim.x,
        y: anim.y,
        duration: 120,
        ease: 'Power2',
        onComplete: () => {
          completed++;
          if (completed === animations.length) {
            this.onMoveComplete();
          }
        }
      });
    });
  }

  updateHotZoneVisuals() {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const slot = this.gridSlots[r][c];
        const isHot = this.isTileInHotZone(r, c);
        
        slot.clear();
        if (isHot) {
          slot.fillStyle(0xfff3cd, 0.5);
          slot.fillRect(-this.tileSize / 2, -this.tileSize / 2, this.tileSize, this.tileSize);
          slot.lineStyle(2, 0xd4a373, 1);
        } else {
          slot.lineStyle(2, 0xc2b280, 0.6);
        }
        slot.strokeRect(-this.tileSize / 2, -this.tileSize / 2, this.tileSize, this.tileSize);
      }
    }
  }

  onMoveComplete() {
    this.spawnLetter();

    this.moveCounter++;
    if (this.moveCounter % 5 === 0) {
      this.hotZone.type = Math.random() < 0.5 ? "row" : "col";
      this.hotZone.index = Math.floor(Math.random() * SIZE);
      this.updateHotZoneVisuals();
    }

    this.updateReadyStatus();
    this.checkGameOver();
    this.isAnimating = false;
  }

  //Spawning & Resets
  randomLetter() {
    return LETTER_POOL[Math.floor(Math.random() * LETTER_POOL.length)];
  }

  getSpawnLetterValue() {
    const rand = Math.random();
    if (rand < 0.04) return "?";
    if (rand < 0.08) {
      const doubles = ["EE", "OO", "TT", "LL", "FF", "SS", "BB"];
      return doubles[Math.floor(Math.random() * doubles.length)];
    }
    return this.randomLetter();
  }

  emptyCells() {
    const cells = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (!this.board[r][c]) cells.push([r, c]);
      }
    }
    return cells;
  }

  spawnLetter() {
    const cells = this.emptyCells();
    if (cells.length === 0) return;

    const [r, c] = cells[Math.floor(Math.random() * cells.length)];
    const letter = this.getSpawnLetterValue();

    this.board[r][c] = letter;
    this.tileSprites[r][c] = this.createTileSprite(r, c, letter);
  }

  resetGame() {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (this.tileSprites[r][c]) {
          this.tileSprites[r][c].destroy();
        }
      }
    }

    this.resetStateVars();
    if (this.domScore) this.domScore.textContent = '0';
    if (this.domWordLog) this.domWordLog.innerHTML = '';
    this.updateBombUI();
    if (this.domOverlay) this.domOverlay.classList.add('hidden');

    this.spawnLetter();
    this.spawnLetter();
    this.updateHotZoneVisuals();
    this.updateReadyStatus();
  }
}

//3. PHASER GAME CONFIGURATION
const boardContainer = document.getElementById('board');
let containerWidth = 500;
if (boardContainer) {
  const boardStyles = window.getComputedStyle(boardContainer);
  const paddingX = parseFloat(boardStyles.paddingLeft) + parseFloat(boardStyles.paddingRight);
  containerWidth = (boardContainer.clientWidth - paddingX) || 500;
}

const config = {
  type: Phaser.AUTO,
  parent: 'board',
  width: containerWidth,
  height: containerWidth,
  transparent: true,
  scale: {
    mode: Phaser.Scale.NONE
  },
  scene: [MainScene]
};

const game = new Phaser.Game(config);