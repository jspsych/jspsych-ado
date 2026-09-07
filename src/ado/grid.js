// Design-grid axis helpers mirroring numpy: arange is half-open [start, stop), linspace is
// inclusive [start, stop]. Values round to 10 decimals so step accumulation stays clean.

const round10 = (value) => Number(value.toFixed(10));

/**
 * Evenly spaced values over [start, stop), stepping by `step` (stop excluded).
 *
 * @param {number} start
 * @param {number} stop - Exclusive upper bound.
 * @param {number} [step=1] - Spacing (> 0).
 * @returns {number[]}
 */
function arange(start, stop, step = 1) {
  if (!(step > 0)) {
    throw new Error(`arange(${start}, ${stop}, ${step}): step must be a positive number.`);
  }
  // Derive each value from `start` (not an accumulator) so float drift can't snap the
  // last value onto the excluded endpoint.
  const count = Math.max(0, Math.ceil(round10((stop - start) / step)));
  const values = [];
  for (let i = 0; i < count; i++) {
    values.push(round10(start + i * step));
  }
  return values;
}

/**
 * `num` evenly spaced values over [start, stop], both endpoints included.
 *
 * @param {number} start
 * @param {number} stop
 * @param {number} num - Integer >= 1; num === 1 returns [start].
 * @returns {number[]}
 */
function linspace(start, stop, num) {
  if (!Number.isInteger(num) || num < 1) {
    throw new Error(`linspace(${start}, ${stop}, ${num}): num must be an integer >= 1.`);
  }
  if (num === 1) {
    return [round10(start)];
  }
  const step = (stop - start) / (num - 1);
  const values = [];
  for (let i = 0; i < num; i++) {
    values.push(round10(start + i * step));
  }
  return values;
}

export { arange, linspace };
