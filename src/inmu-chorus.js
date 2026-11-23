import { Euler, MathUtils, Quaternion, Vector3 } from 'three';
import { applyHandShape, sides } from './gestures.js';
import { roundTime } from './project.js';
import { rotation } from './vrma.js';

const secondsPerBeat = 60 / 133;
const arms = {
  head: [[-128.5, -17.3, -26.3], [0, -129.9, 0], [143.8, 25, 29.2]],
  in: [[-28.8, -14, -45.8], [0, -99.6, 0], [-52.5, 25.8, 24.2]],
  point: [[-74.7, -38.3, -54.7], [0, -43.6, 0], [-51.1, 11.6, 6.9]],
  high: [[-52.5, -64, 6.8], [0, -16.3, 0], [-93.7, -4.2, 3]],
  open: [[-5, -8, -8], [0, -11, 0], [8, 2, -12]],
  waist: [[25.6, -52.8, -41.6], [0, -64.4, 0], [-25.7, -30.7, -24.1]],
};

const tenthDegree = value => Math.round(value * 10) / 10 || 0;
const degrees = q => {
  const { x, y, z } = new Euler().setFromQuaternion(q);
  return [x, y, z].map(value => tenthDegree(MathUtils.radToDeg(value)));
};
const down = new Vector3(0, -1, 0);
const up = new Vector3(0, 1, 0);

function legs(angles, hip, feet) {
  const pelvis = rotation(angles.hips);
  const inverse = pelvis.clone().invert();
  const facing = rotation([0, angles.hips[1], 0]);
  for (const [i, side] of sides.entries()) {
    const sign = i === 0 ? 1 : -1;
    const [x, y, z] = feet[i];
    const upper = .365, lower = .423;
    const target = new Vector3(x, -.815 + y, z).applyQuaternion(facing);
    target.y -= hip * .953;
    const offset = target.applyQuaternion(inverse).sub(new Vector3(.076 * sign, -.039, -.004));
    const distance = Math.min(offset.length(), upper + lower - .002);
    const direction = offset.normalize();
    const bend = new Vector3(.16 * sign, 0, 1);
    bend.addScaledVector(direction, -bend.dot(direction)).normalize();
    const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
    const knee = direction.clone().multiplyScalar(along).addScaledVector(bend, Math.sqrt(upper * upper - along * along));
    const shin = direction.multiplyScalar(distance).sub(knee).normalize();
    const thighRotation = new Quaternion().setFromUnitVectors(down, knee.normalize());
    const shinRotation = new Quaternion().setFromUnitVectors(down, shin);
    angles[side + 'UpperLeg'] = degrees(thighRotation);
    angles[side + 'LowerLeg'] = degrees(thighRotation.invert().multiply(shinRotation));
    const toeOut = facing.clone().multiply(new Quaternion().setFromAxisAngle(up, sign * .10));
    angles[side + 'Foot'] = degrees(shinRotation.invert().multiply(inverse).multiply(toeOut));
  }
}

function pose(beat, { arm = 'head', cross = 0, width = .09, dip = 0, lift = 0, side = 0, turn = 0, hop = 0 } = {}) {
  const angles = {
    hips: [dip * 28, turn, side * 6],
    spine: [-dip * 32, -side * 6, -side * 4],
    chest: [dip * 15, -side * 5, -side * 4],
    head: [-dip * 9, side * 6, side * 2],
  };
  for (const joint of Object.keys(angles)) angles[joint] = angles[joint].map(tenthDegree);
  const fingers = arm === 'point' || arm === 'in' ? 'thumbsUp' : arm === 'high' ? 'index' : arm === 'waist' ? 'fist' : 'together';
  for (const [i, side] of sides.entries()) {
    const sign = i === 0 ? 1 : -1;
    for (const [joint, [x, y, z]] of arms[arm].entries()) {
      angles[side + ['UpperArm', 'LowerArm', 'Hand'][joint]] = [x, sign * y || 0, sign * z || 0];
    }
    applyHandShape(angles, side, fingers);
  }
  const feet = [[width, hop, -.034], [-width, hop, -.034]];
  if (cross) {
    const foot = cross > 0 ? 0 : 1;
    feet[foot] = [-cross * .073, lift + hop, .15];
  }
  const hip = -.026 - dip * .16 + hop;
  legs(angles, hip, feet);
  return { time: roundTime(beat * secondsPerBeat), angles, hip };
}

export function inmuChorus() {
  const frames = [pose(0)];
  for (let half = 1; half < 112; half++) {
    const beat = half / 2;
    const count = Math.floor(beat);
    const upBeat = half % 2 === 1;
    const side = count % 2 === 0 ? 1 : -1;
    let step;
    if (beat < 12) {
      step = { cross: side, side, lift: upBeat ? .10 : .008, dip: upBeat ? .03 : .23 };
    } else if (beat < 20) {
      step = { arm: upBeat ? 'point' : 'in', side, width: upBeat ? .13 : .235, dip: upBeat ? .10 : .44 };
    } else if (beat < 28) {
      // Two half turns with a wide landing on each side.
      const turns = [0, 0, 0, 60, 140, 180, 180, 180, 180, 180, 180, -130, -55, 0, 0, 0];
      const turning = [3, 4, 11, 12].includes(half - 40);
      step = { side: upBeat ? side : 0, width: turning ? .15 : .23, dip: turning ? .06 : .37,
        hop: turning ? .075 : 0, turn: turns[half - 40] };
    } else if (beat < 36) {
      step = { arm: upBeat ? 'point' : 'in', cross: side, side, lift: upBeat ? .10 : 0, dip: upBeat ? .02 : .24 };
    } else if (beat < 52) {
      const accent = count % 4 === 0 || count % 4 === 2;
      step = { arm: accent && upBeat ? 'open' : 'waist', width: accent && upBeat ? .24 : .19, side, dip: upBeat ? .08 : .39 };
    } else {
      step = { arm: beat < 54 ? 'high' : 'head', cross: side, side, lift: upBeat ? .09 : 0, dip: upBeat ? .05 : .24 };
    }
    frames.push(pose(beat, step));
  }
  frames.push(pose(56));
  return frames;
}
