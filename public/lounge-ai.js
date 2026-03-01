// ═══════════════════════════════════════════════════════════════
// Lounge AI — Chess & Checkers AI + Lessons System
// Difficulty: Easy (random), Medium (greedy), Hard (minimax)
// ═══════════════════════════════════════════════════════════════

var LoungeAI = (function() {

  var PIECE_VAL = { P:100, N:320, B:330, R:500, Q:900, K:20000, C:100, CK:300 };

  // ── Position bonus tables (chess) ──
  var PAWN_TABLE = [
    0,0,0,0,0,0,0,0,
    50,50,50,50,50,50,50,50,
    10,10,20,30,30,20,10,10,
    5,5,10,25,25,10,5,5,
    0,0,0,20,20,0,0,0,
    5,-5,-10,0,0,-10,-5,5,
    5,10,10,-20,-20,10,10,5,
    0,0,0,0,0,0,0,0
  ];

  var KNIGHT_TABLE = [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,0,0,0,0,-20,-40,
    -30,0,10,15,15,10,0,-30,
    -30,5,15,20,20,15,5,-30,
    -30,0,15,20,20,15,0,-30,
    -30,5,10,15,15,10,5,-30,
    -40,-20,0,5,5,0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50
  ];

  var CENTER_TABLE = [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,0,0,0,0,0,0,-10,
    -10,0,5,10,10,5,0,-10,
    -10,5,5,10,10,5,5,-10,
    -10,0,10,10,10,10,0,-10,
    -10,10,10,10,10,10,10,-10,
    -10,5,0,0,0,0,5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20
  ];

  function posBonus(type, r, c, color) {
    var idx = color === 'holo' ? r * 8 + c : (7 - r) * 8 + c;
    if (type === 'P') return PAWN_TABLE[idx];
    if (type === 'N') return KNIGHT_TABLE[idx];
    if (type === 'B' || type === 'Q' || type === 'K') return CENTER_TABLE[idx];
    if (type === 'C' || type === 'CK') {
      // Checkers: center control + advancement
      var advance = color === 'holo' ? r : 7 - r;
      return advance * 8 + CENTER_TABLE[idx] * 0.3;
    }
    return 0;
  }

  // ── Evaluate board for color ──
  function evaluate(board, mode, forColor) {
    var score = 0;
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        var p = board[r][c];
        if (!p) continue;
        var val = (PIECE_VAL[p.type] || 0) + posBonus(p.type, r, c, p.color);
        if (p.color === forColor) score += val;
        else score -= val;
      }
    }
    return score;
  }

  // ── Clone board ──
  function cloneBoard(board) {
    return board.map(function(row) {
      return row.map(function(cell) {
        return cell ? { type: cell.type, color: cell.color } : null;
      });
    });
  }

  // ── Get all valid moves for a color (uses global getValidMoves) ──
  function getAllMoves(board, color, mode) {
    var moves = [];
    // Temporarily swap global board
    var savedBoard = window.laBoard;
    var savedMode = window.laGameMode;
    window.laBoard = board;
    window.laGameMode = mode;
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        var p = board[r][c];
        if (p && p.color === color) {
          var vm = getValidMoves(r, c);
          vm.forEach(function(m) {
            moves.push({ from: { r: r, c: c }, to: m });
          });
        }
      }
    }
    window.laBoard = savedBoard;
    window.laGameMode = savedMode;
    return moves;
  }

  // ── Apply move to board clone ──
  function applyMove(board, move, mode) {
    var b = cloneBoard(board);
    var piece = b[move.from.r][move.from.c];
    // Handle jump (checkers)
    if (move.to.jump) {
      b[move.to.jump.r][move.to.jump.c] = null;
    }
    b[move.to.r][move.to.c] = piece;
    b[move.from.r][move.from.c] = null;
    // Promotion
    if (mode === 'chess' && piece.type === 'P') {
      if ((piece.color === 'gold' && move.to.r === 0) || (piece.color === 'holo' && move.to.r === 7))
        piece.type = 'Q';
    }
    if (mode === 'checkers' && piece.type === 'C') {
      if ((piece.color === 'gold' && move.to.r === 0) || (piece.color === 'holo' && move.to.r === 7))
        piece.type = 'CK';
    }
    return b;
  }

  // ── Minimax with alpha-beta pruning ──
  function minimax(board, mode, depth, alpha, beta, maximizing, aiColor) {
    if (depth === 0) return { score: evaluate(board, mode, aiColor) };

    var color = maximizing ? aiColor : (aiColor === 'gold' ? 'holo' : 'gold');
    var moves = getAllMoves(board, color, mode);
    if (moves.length === 0) return { score: maximizing ? -99999 : 99999 };

    var bestMove = null;
    if (maximizing) {
      var maxEval = -Infinity;
      for (var i = 0; i < moves.length; i++) {
        var newBoard = applyMove(board, moves[i], mode);
        var ev = minimax(newBoard, mode, depth - 1, alpha, beta, false, aiColor).score;
        if (ev > maxEval) { maxEval = ev; bestMove = moves[i]; }
        alpha = Math.max(alpha, ev);
        if (beta <= alpha) break;
      }
      return { score: maxEval, move: bestMove };
    } else {
      var minEval = Infinity;
      for (var j = 0; j < moves.length; j++) {
        var newBoard2 = applyMove(board, moves[j], mode);
        var ev2 = minimax(newBoard2, mode, depth - 1, alpha, beta, true, aiColor).score;
        if (ev2 < minEval) { minEval = ev2; bestMove = moves[j]; }
        beta = Math.min(beta, ev2);
        if (beta <= alpha) break;
      }
      return { score: minEval, move: bestMove };
    }
  }

  // ═══ Public API ═══
  return {
    // Get AI move based on difficulty
    // difficulty: 'easy' | 'medium' | 'hard'
    getMove: function(board, mode, aiColor, difficulty) {
      var moves = getAllMoves(board, aiColor, mode);
      if (moves.length === 0) return null;

      if (difficulty === 'easy') {
        // Random move (with slight preference for captures)
        var captures = moves.filter(function(m) {
          return board[m.to.r][m.to.c] !== null || m.to.jump;
        });
        if (captures.length > 0 && Math.random() < 0.4) {
          return captures[Math.floor(Math.random() * captures.length)];
        }
        return moves[Math.floor(Math.random() * moves.length)];
      }

      if (difficulty === 'medium') {
        // Greedy: pick best immediate capture, else random
        var best = null;
        var bestVal = -Infinity;
        moves.forEach(function(m) {
          var newB = applyMove(board, m, mode);
          var val = evaluate(newB, mode, aiColor);
          // Add randomness
          val += (Math.random() - 0.5) * 50;
          if (val > bestVal) { bestVal = val; best = m; }
        });
        return best || moves[0];
      }

      // Hard: minimax depth 3 (chess) or 4 (checkers)
      var depth = mode === 'chess' ? 3 : 4;
      var result = minimax(board, mode, depth, -Infinity, Infinity, true, aiColor);
      return result.move || moves[0];
    },

    evaluate: evaluate,
    getAllMoves: getAllMoves,
  };
})();

// ═══════════════════════════════════════════════════════════════
// LESSONS SYSTEM — Interactive teaching on live board
// ═══════════════════════════════════════════════════════════════

var LoungeLessons = (function() {

  var CHESS_LESSONS = [
    {
      title: 'The Pawn',
      desc: 'Pawns move forward one square (two on first move). They capture diagonally. Reach the other side to promote to a Queen!',
      setup: function(b) {
        // Minimal board: a few pawns only
        b[6][3] = { type: 'P', color: 'gold' };
        b[6][4] = { type: 'P', color: 'gold' };
        b[4][4] = { type: 'P', color: 'holo' };
        b[1][3] = { type: 'P', color: 'holo' };
      },
      hints: [
        'Click your pawn on d2. See how it can move 1 or 2 squares forward!',
        'Try capturing the enemy pawn diagonally.',
        'Push a pawn to row 8 to see it promote to a Queen!',
      ],
    },
    {
      title: 'The Knight',
      desc: 'Knights move in an L-shape: 2 squares one way, 1 square perpendicular. They can jump over pieces!',
      setup: function(b) {
        b[7][1] = { type: 'N', color: 'gold' };
        b[7][6] = { type: 'N', color: 'gold' };
        b[5][2] = { type: 'P', color: 'gold' };
        b[5][5] = { type: 'P', color: 'gold' };
        b[3][3] = { type: 'P', color: 'holo' };
      },
      hints: [
        'Click the knight. See the L-shaped moves highlighted!',
        'Knights jump over pieces. Notice it can leap past the pawns.',
        'Try to capture the enemy pawn in the center.',
      ],
    },
    {
      title: 'Rook & Bishop',
      desc: 'Rooks move in straight lines (rows/columns). Bishops move diagonally. Together they control the whole board.',
      setup: function(b) {
        b[7][0] = { type: 'R', color: 'gold' };
        b[7][5] = { type: 'B', color: 'gold' };
        b[3][0] = { type: 'P', color: 'holo' };
        b[4][2] = { type: 'P', color: 'holo' };
      },
      hints: [
        'Click the Rook. It slides along rows and columns.',
        'Now click the Bishop. It slides diagonally.',
        'A Rook is worth 5 points, a Bishop 3. Use them wisely!',
      ],
    },
    {
      title: 'The Queen & King',
      desc: 'The Queen combines Rook + Bishop — she moves any direction, any distance. The King moves one square any direction. Protect your King!',
      setup: function(b) {
        b[7][4] = { type: 'K', color: 'gold' };
        b[7][3] = { type: 'Q', color: 'gold' };
        b[2][4] = { type: 'Q', color: 'holo' };
        b[0][4] = { type: 'K', color: 'holo' };
      },
      hints: [
        'Click the Queen. She can move in ALL directions!',
        'The King only moves one square, but losing him means losing the game.',
        'The Queen is worth 9 points. She is your most powerful piece.',
      ],
    },
    {
      title: 'Full Game Setup',
      desc: 'This is how a chess game starts. All 16 pieces per side. Now you know what each one does — try playing against the AI!',
      setup: null, // use standard setup
      hints: [
        'White (gold) always moves first.',
        'Control the center early with pawns and knights.',
        'Castle your king to safety when you can.',
      ],
    },
  ];

  var CHECKERS_LESSONS = [
    {
      title: 'Basic Movement',
      desc: 'Checkers move diagonally forward, one square at a time. They can only move on dark squares.',
      setup: function(b) {
        b[5][2] = { type: 'C', color: 'gold' };
        b[5][4] = { type: 'C', color: 'gold' };
        b[5][6] = { type: 'C', color: 'gold' };
      },
      hints: [
        'Click a checker. See how it can move diagonally forward.',
        'Regular checkers can only move toward the opponent\'s side.',
        'Each move is one square diagonally.',
      ],
    },
    {
      title: 'Capturing (Jumping)',
      desc: 'Jump over an enemy piece diagonally to capture it. You must land on an empty square beyond.',
      setup: function(b) {
        b[5][2] = { type: 'C', color: 'gold' };
        b[4][3] = { type: 'C', color: 'holo' };
        b[5][6] = { type: 'C', color: 'gold' };
        b[4][5] = { type: 'C', color: 'holo' };
      },
      hints: [
        'Click your checker next to the enemy. See the jump move!',
        'You must jump OVER the enemy to an empty square.',
        'Capturing removes the enemy piece from the board.',
      ],
    },
    {
      title: 'Becoming a King',
      desc: 'Reach the opposite end of the board to become a King. Kings can move diagonally in ANY direction!',
      setup: function(b) {
        b[1][2] = { type: 'C', color: 'gold' };
        b[6][5] = { type: 'CK', color: 'gold' };
        b[4][3] = { type: 'C', color: 'holo' };
      },
      hints: [
        'Move the checker on row 7 forward. One more step to become a King!',
        'Click the King (marked with K). See how it moves in all 4 diagonal directions!',
        'Kings are worth 3x more than regular checkers.',
      ],
    },
    {
      title: 'Full Game Setup',
      desc: 'This is the standard checkers layout. 12 pieces each on dark squares. Now try playing the AI!',
      setup: null, // standard setup
      hints: [
        'Each player starts with 12 pieces on the dark squares.',
        'Try to reach the other side to get Kings.',
        'Control the center and plan your jumps!',
      ],
    },
  ];

  var currentLesson = -1;
  var currentHint = 0;
  var lessonMode = null; // 'chess' or 'checkers'

  return {
    getLessons: function(mode) {
      return mode === 'chess' ? CHESS_LESSONS : CHECKERS_LESSONS;
    },

    startLesson: function(mode, idx) {
      var lessons = this.getLessons(mode);
      if (idx < 0 || idx >= lessons.length) return;
      lessonMode = mode;
      currentLesson = idx;
      currentHint = 0;
      var lesson = lessons[idx];

      // Init board
      window.laGameMode = mode;
      window.laBoard = Array.from({ length: 8 }, function() { return Array(8).fill(null); });
      window.laSelected = null;
      window.laValidMoves = [];
      window.laTurn = 'gold';
      window.laScoreGold = 0;
      window.laScoreHolo = 0;
      window.laCapturedGold = [];
      window.laCapturedHolo = [];
      window.laMoveCount = 0;

      if (lesson.setup) {
        lesson.setup(window.laBoard);
      } else {
        // Standard setup
        initGameBoard(mode);
        return; // initGameBoard handles render
      }
      renderGameBoard();
    },

    getCurrentHint: function() {
      if (currentLesson < 0 || !lessonMode) return '';
      var lessons = this.getLessons(lessonMode);
      var lesson = lessons[currentLesson];
      if (!lesson) return '';
      return lesson.hints[currentHint] || lesson.hints[lesson.hints.length - 1];
    },

    nextHint: function() {
      if (currentLesson < 0 || !lessonMode) return '';
      var lessons = this.getLessons(lessonMode);
      var lesson = lessons[currentLesson];
      if (currentHint < lesson.hints.length - 1) currentHint++;
      return this.getCurrentHint();
    },

    getLessonInfo: function() {
      if (currentLesson < 0 || !lessonMode) return null;
      var lessons = this.getLessons(lessonMode);
      return {
        lesson: lessons[currentLesson],
        index: currentLesson,
        total: lessons.length,
        hint: this.getCurrentHint(),
        mode: lessonMode,
      };
    },

    isActive: function() { return currentLesson >= 0; },
    clear: function() { currentLesson = -1; lessonMode = null; },
  };
})();
