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
  money: ['金の形', [.70, .48, .37, .30, .23]],
  fox: ['コン', [.65, 0, .66, .66, 0]],
  spider: ['スパイダーストリングス', [0, 0, 1, 1, 0]],
  circle: ['両手でまる', [.25, .24, .26, .28, .30]],
  heart: ['両手でハート', [.18, .29, .42, .51, .56]],
};

function shapeHand(angles, side, shape) {
  const [, flex] = handShapes[shape];
  const sign = side === 'left' ? 1 : -1;
  const fan = shape === 'spread' ? 1 : shape === 'peace' || shape === 'spider' || shape === 'fox' ? .7 : .12;
  for (const [i, [digit, , joints]] of digits.entries()) {
    for (const [j, joint] of joints.entries()) {
      const bend = (i === 0 ? [24, 37, 48] : [76, 96, 57])[j] * flex[i];
      const fanAngle = i === 0 && shape === 'thumbsUp' ? -27 : [-26, -12, -3, 5, 15][i] * fan;
      const spread = j === 0 ? fanAngle : 0;
      const opposition = i === 0 && j === 0 && shape !== 'thumbsUp' ? 39 * flex[i] : 0;
      angles[side + digit + joint] = [sign * opposition, sign * spread, -sign * bend]
        .map(angle => Math.round(angle * 10) / 10 || 0);
    }
  }
}

export function applyHandShape(angles, side, shape) {
  if (shape !== 'circle' && shape !== 'heart') {
    shapeHand(angles, side, shape);
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
