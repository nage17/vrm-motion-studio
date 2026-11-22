import { Euler, MathUtils, Quaternion } from 'three';
import { posePairedHands } from './paired-hands.js';

export const digits = [
  ['Thumb', '親指', ['Metacarpal', 'Proximal', 'Distal']],
  ['Index', '人差し指', ['Proximal', 'Intermediate', 'Distal']],
  ['Middle', '中指', ['Proximal', 'Intermediate', 'Distal']],
  ['Ring', '薬指', ['Proximal', 'Intermediate', 'Distal']],
  ['Little', '小指', ['Proximal', 'Intermediate', 'Distal']],
];
export const sides = ['left', 'right'];

// Finger flexion, ordered from thumb to little finger. 0 is straight.
export const handShapes = {
  fist: ['グー', [.8, 1, 1, 1, 1]],
  peace: ['チョキ', [.8, 0, 0, 1, 1]],
  spread: ['パー（指を開く）', [0, 0, 0, 0, 0]],
  together: ['パー（指をそろえる）', [.24, 0, 0, 0, 0]],
  thumbsUp: ['グッド', [0, 1, 1, 1, 1]],
  index: ['人差し指を立てる', [.8, 0, 1, 1, 1]],
  middle: ['中指を立てる', [.8, 1, 0, 1, 1]],
  ring: ['薬指を立てる', [.8, 1, 1, 0, 1]],
  little: ['小指を立てる', [.8, 1, 1, 1, 0]],
  money: ['お金の手', [0, 0, .04, .05, .06]],
  fox: ['コン', [.65, 0, .66, .66, 0]],
  spider: ['スパイダーストリングス', [0, 0, 1, 1, 0]],
  circle: ['両手でまる', [.34, .12, .13, .14, .17]],
  heart: ['両手でハート', [0, 0, .86, .92, .95]],
};

// Local joint angles for gestures whose thumb and index shape cannot be
// expressed by an ordinary finger curl. X is unchanged by left/right mirroring.
const detailAngles = {
  money: {
    Thumb: [[-4.5, 18, -22], [-1, 32, 14.5], [0, 4.5, -3.5]],
    Index: [[0, -14.5, -13.5], [0, 2, -58.5], [0, 1, -40.5]],
  },
  thumbsUp: {
    Thumb: [[-24, -48, 0], [0, -3, 2], [0, 1, 0]],
  },
  heart: {
    Thumb: [[70, -5, -10], [0, -4, -9], [0, 0, -3]],
    Index: [[0, -7, 8], [0, -3, -75], [0, 0, -40]],
  },
};

function shapeHand(angles, side, shape) {
  const [, flex] = handShapes[shape];
  const sign = side === 'left' ? 1 : -1;
  const fan = shape === 'spread' ? 1 : shape === 'peace' || shape === 'spider' || shape === 'fox' ? .7 : .12;
  for (const [i, [digit, , joints]] of digits.entries()) {
    const detail = detailAngles[shape]?.[digit];
    for (const [j, joint] of joints.entries()) {
      if (detail) {
        const [x, y, z] = detail[j];
        angles[side + digit + joint] = [x, y * sign || 0, z * sign || 0];
        continue;
      }
      const bend = (i === 0 ? [0, 35, 23] : [76, 96, 57])[j] * flex[i];
      const spread = j === 0 ? [-26, -12, -3, 5, 15][i] * fan : 0;
      const opposition = i === 0 && j === 0 ? 39 * flex[i] : 0;
      angles[side + digit + joint] = [opposition, sign * spread, -sign * bend]
        .map(angle => Math.round(angle * 10) / 10 || 0);
    }
  }
}

function rollJoint(angles, name, roll) {
  // In YZX order, X is an axial roll applied after aiming the joint.
  const original = new Euler(...(angles[name] ?? [0, 0, 0]).map(MathUtils.degToRad), 'XYZ');
  const q = new Quaternion().setFromEuler(original);
  const axial = new Euler().setFromQuaternion(q, 'YZX');
  axial.x = MathUtils.degToRad(roll);
  original.setFromQuaternion(q.setFromEuler(axial), 'XYZ');
  angles[name] = [original.x, original.y, original.z]
    .map(angle => Math.round(MathUtils.radToDeg(angle) * 10) / 10 || 0);
}

export const isPairedShape = shape => shape === 'circle' || shape === 'heart';
export const isPairedJoint = name => /^(left|right)(Shoulder|UpperArm|LowerArm|Hand|Thumb|Index|Middle|Ring|Little)/.test(name);

export function applyHandShape(angles, side, shape, rig) {
  if (!isPairedShape(shape)) {
    shapeHand(angles, side, shape);
    if (shape === 'money') {
      rollJoint(angles, side + 'LowerArm', 135);
      rollJoint(angles, side + 'Hand', 45);
    }
    return;
  }
  if (rig) {
    for (const hand of sides) shapeHand(angles, hand, shape);
    posePairedHands(angles, shape, rig);
    return;
  }
  for (const hand of sides) {
    const sign = hand === 'left' ? 1 : -1;
    shapeHand(angles, hand, shape);
    angles[hand + 'Shoulder'] = [0, 0, 0];
    angles[hand + 'UpperArm'] = shape === 'heart' ? [-15.8, -41.5 * sign, -40.1 * sign] : [7.2, -16.4 * sign, 47.4 * sign];
    angles[hand + 'LowerArm'] = shape === 'heart' ? [78.8, 19 * sign, 116.4 * sign] : [17.6, -9.4 * sign, 91.4 * sign];
    angles[hand + 'Hand'] = shape === 'heart' ? [0, 12 * sign, 13 * sign] : [0, 0, 16 * sign];
  }
}

export const expressions = {
  neutral: '標準', happy: '喜', angry: '怒', sad: '哀', relaxed: '楽', surprised: '驚き',
  blink: '目閉じ（両目）', blinkRight: '目閉じ（右目）', blinkLeft: '目閉じ（左目）',
  aa: 'あ', ih: 'い', ou: 'う', ee: 'え', oh: 'お',
};

export function expressionWeight(frame, name) {
  return frame.expression?.name === name ? frame.expression.weight : 0;
}
