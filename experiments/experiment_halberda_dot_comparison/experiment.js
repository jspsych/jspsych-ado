// ------------------------------------------------------------
// Halberda, Mazzocco, & Feigenson (2008)-style dot comparison
// Core idea: briefly show intermixed blue/yellow dots and ask
// which color is more numerous.
// ------------------------------------------------------------

const jsPsych = initJsPsych({
  on_finish: function() {
    jsPsych.data.displayData('csv');
  }
});

// ----------------------
// Experiment parameters
// ----------------------
const CANVAS_W = 800;
const CANVAS_H = 600;
const STIM_MS = 200;     // original child task used a very brief display
const FIXATION_MS = 250;
const RESPONSE_KEYS = ['b', 'y']; // b = blue more, y = yellow more

// Original-style ratios from the paper: 1:2, 3:4, 5:6, 7:8.
// For adult versions, add harder ratios like 9:10, 11:12.
const RATIOS = [
  {small: 1, large: 2, label: '1:2'},
  {small: 3, large: 4, label: '3:4'},
  {small: 5, large: 6, label: '5:6'},
  {small: 7, large: 8, label: '7:8'}
];

const BASE_LARGE_COUNTS = [8, 12, 16]; // keeps counts in a child-friendly range
const N_REPS_PER_RATIO = 10;           // 4 ratios x 10 = 40 test trials

// ----------------------
// Utility functions
// ----------------------
function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function distance(x1, y1, x2, y2) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

function generateDotPositions(n, existingDots, minDist = 22) {
  const dots = [];
  let attempts = 0;

  while (dots.length < n && attempts < 10000) {
    attempts++;
    const r = 6 + Math.random() * 10;
    const x = 70 + Math.random() * (CANVAS_W - 140);
    const y = 70 + Math.random() * (CANVAS_H - 140);

    const candidate = {x, y, r};
    const allDots = existingDots.concat(dots);
    const ok = allDots.every(d => distance(x, y, d.x, d.y) > minDist + r + d.r);

    if (ok) dots.push(candidate);
  }
  return dots;
}

// Visual-cue control mode:
// 1. size_control: both colors have similar average dot size.
// 2. area_control: total blue area and total yellow area are approximately matched.
function makeDots(nBlue, nYellow, controlMode) {
  let blueDots = [];
  let yellowDots = [];

  if (controlMode === 'size_control') {
    blueDots = generateDotPositions(nBlue, []);
    yellowDots = generateDotPositions(nYellow, blueDots);
  }

  if (controlMode === 'area_control') {
    // First generate positions. Then set radii so total area is approximately equal.
    blueDots = generateDotPositions(nBlue, []);
    yellowDots = generateDotPositions(nYellow, blueDots);

    const targetTotalArea = 2800;
    const blueR = Math.sqrt(targetTotalArea / (Math.PI * nBlue));
    const yellowR = Math.sqrt(targetTotalArea / (Math.PI * nYellow));

    blueDots = blueDots.map(d => ({...d, r: blueR * (0.85 + Math.random() * 0.30)}));
    yellowDots = yellowDots.map(d => ({...d, r: yellowR * (0.85 + Math.random() * 0.30)}));
  }

  return {blueDots, yellowDots};
}

function drawTextCentered(ctx, text, y, font = '28px Arial') {
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#222';
  ctx.fillText(text, CANVAS_W / 2, y);
}

function drawFixation(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(CANVAS_W / 2 - 15, CANVAS_H / 2);
  ctx.lineTo(CANVAS_W / 2 + 15, CANVAS_H / 2);
  ctx.moveTo(CANVAS_W / 2, CANVAS_H / 2 - 15);
  ctx.lineTo(CANVAS_W / 2, CANVAS_H / 2 + 15);
  ctx.stroke();
}

function drawDots(canvas, trial) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const allDots = shuffle(
    trial.blueDots.map(d => ({...d, color: 'blue'})).concat(
      trial.yellowDots.map(d => ({...d, color: 'yellow'}))
    )
  );

  allDots.forEach(d => {
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, 2 * Math.PI);
    ctx.fillStyle = d.color === 'blue' ? '#1f77b4' : '#f2c230';
    ctx.fill();
  });
}

function drawResponsePrompt(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  drawTextCentered(ctx, 'Which color had more dots?', 230, '30px Arial');
  drawTextCentered(ctx, 'Press B for BLUE     Press Y for YELLOW', 310, '26px Arial');
}

function drawInstructions(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  drawTextCentered(ctx, 'Dot Comparison Task', 130, '34px Arial');
  drawTextCentered(ctx, 'You will briefly see blue and yellow dots.', 210, '24px Arial');
  drawTextCentered(ctx, 'Your job is to decide which color had MORE dots.', 250, '24px Arial');
  drawTextCentered(ctx, 'Press B if there were more BLUE dots.', 310, '24px Arial');
  drawTextCentered(ctx, 'Press Y if there were more YELLOW dots.', 350, '24px Arial');
  drawTextCentered(ctx, 'The display is very fast, so do not try to count.', 410, '24px Arial');
  drawTextCentered(ctx, 'Press SPACE to begin.', 500, '24px Arial');
}

// ----------------------
// Generate trials
// ----------------------
function makeTrialList() {
  const trials = [];

  RATIOS.forEach(ratio => {
    for (let rep = 0; rep < N_REPS_PER_RATIO; rep++) {
      const largeCount = randomChoice(BASE_LARGE_COUNTS);
      const smallCount = Math.round(largeCount * ratio.small / ratio.large);
      const moreColor = Math.random() < 0.5 ? 'blue' : 'yellow';
      const controlMode = Math.random() < 0.5 ? 'size_control' : 'area_control';

      const nBlue = moreColor === 'blue' ? largeCount : smallCount;
      const nYellow = moreColor === 'yellow' ? largeCount : smallCount;
      const dots = makeDots(nBlue, nYellow, controlMode);

      trials.push({
        ratio: ratio.label,
        ratio_value: smallCount / largeCount,
        n_blue: nBlue,
        n_yellow: nYellow,
        more_color: moreColor,
        correct_key: moreColor === 'blue' ? 'b' : 'y',
        control_mode: controlMode,
        blueDots: dots.blueDots,
        yellowDots: dots.yellowDots
      });
    }
  });

  return shuffle(trials);
}

const dotTrials = makeTrialList();

// ----------------------
// jsPsych timeline
// ----------------------
const timeline = [];

timeline.push({
  type: jsPsychCanvasKeyboardResponse,
  canvas_size: [CANVAS_H, CANVAS_W],
  stimulus: drawInstructions,
  choices: [' '],
  data: {block: 'instructions'}
});

dotTrials.forEach((trial, i) => {
  timeline.push({
    type: jsPsychCanvasKeyboardResponse,
    canvas_size: [CANVAS_H, CANVAS_W],
    stimulus: drawFixation,
    choices: 'NO_KEYS',
    trial_duration: FIXATION_MS,
    data: {block: 'fixation', trial_index: i + 1}
  });

  timeline.push({
    type: jsPsychCanvasKeyboardResponse,
    canvas_size: [CANVAS_H, CANVAS_W],
    stimulus: function(canvas) { drawDots(canvas, trial); },
    choices: 'NO_KEYS',
    trial_duration: STIM_MS,
    data: {
      block: 'dot_display',
      trial_index: i + 1,
      ratio: trial.ratio,
      ratio_value: trial.ratio_value,
      n_blue: trial.n_blue,
      n_yellow: trial.n_yellow,
      more_color: trial.more_color,
      control_mode: trial.control_mode
    }
  });

  timeline.push({
    type: jsPsychCanvasKeyboardResponse,
    canvas_size: [CANVAS_H, CANVAS_W],
    stimulus: drawResponsePrompt,
    choices: RESPONSE_KEYS,
    data: {
      block: 'response',
      trial_index: i + 1,
      ratio: trial.ratio,
      ratio_value: trial.ratio_value,
      n_blue: trial.n_blue,
      n_yellow: trial.n_yellow,
      more_color: trial.more_color,
      correct_key: trial.correct_key,
      control_mode: trial.control_mode
    },
    on_finish: function(data) {
      data.correct = data.response === data.correct_key;
      data.response_color = data.response === 'b' ? 'blue' : 'yellow';
    }
  });
});

jsPsych.run(timeline);