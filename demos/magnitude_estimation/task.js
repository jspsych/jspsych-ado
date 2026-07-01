// Magnitude-estimation task code (experiment-owned): show a filled disk of a given
// AREA and ask the participant to estimate its perceived size on a continuous slider.
// Paired with the magnitude_estimation model (Stevens' power law) it recovers the
// perceptual exponent. The design carries the physical area s; the slider records a
// raw estimate, and the trial's on_finish logs it into the modeled response
// y = log(estimate) before recording (the model works in log-log space).

const CANVAS = 420; // square canvas (height === width avoids axis ambiguity)
const CANVAS_SIZE = [CANVAS, CANVAS];
const MAX_AREA = 1000; // largest area in the design grid
const MAX_RADIUS_PX = 175; // largest on-screen radius (fits the canvas with margin)
// Pixels per sqrt(area-unit), so area s maps to radius sqrt(s/pi) scaled to fit.
const PIXELS_PER_UNIT = MAX_RADIUS_PX / Math.sqrt(MAX_AREA / Math.PI);

const SLIDER_MIN = 1;
const SLIDER_MAX = 200;

// Physical magnitudes (areas), spanning ~2 log-decades so the log-log slope (the
// Stevens exponent) is identifiable; ADO favors the ends of this range.
const design_grid = { s: [10, 25, 50, 100, 250, 500, 1000] };

/** On-screen radius (px) for a disk of physical area `area`: sqrt(area/pi) scaled to fit. */
function radiusPx(area) {
  return Math.sqrt(area / Math.PI) * PIXELS_PER_UNIT;
}

function drawDisk(canvas, design) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, CANVAS, CANVAS);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CANVAS, CANVAS);
  ctx.beginPath();
  ctx.arc(CANVAS / 2, CANVAS / 2, radiusPx(design.s), 0, 2 * Math.PI);
  ctx.fillStyle = "#3b6ea5";
  ctx.fill();
}

/**
 * Map the raw slider estimate to the modeled response y = log(estimate) — the
 * task→model boundary. Guards against a non-positive estimate.
 */
function responseToOutcome(estimate) {
  return Math.log(Math.max(Number(estimate), 1e-9));
}

function describeDesign(design) {
  return ["area: " + design.s];
}

export {
  CANVAS,
  CANVAS_SIZE,
  SLIDER_MIN,
  SLIDER_MAX,
  design_grid,
  drawDisk,
  radiusPx,
  describeDesign,
  responseToOutcome,
};
