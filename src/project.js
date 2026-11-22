import { digits, expressions, sides } from './gestures.js';

export const parts = [
  { label: '体幹', bones: [['hips', '腰'], ['spine', '背中'], ['chest', '胸'], ['upperChest', '上胸'], ['neck', '首'], ['head', '頭']] },
  { label: '腕', bones: [['leftShoulder', '左肩'], ['rightShoulder', '右肩'], ['leftUpperArm', '左腕'], ['rightUpperArm', '右腕'], ['leftLowerArm', '左ひじ'], ['rightLowerArm', '右ひじ'], ['leftHand', '左手'], ['rightHand', '右手']] },
  { label: '脚', bones: [['leftUpperLeg', '左もも'], ['rightUpperLeg', '右もも'], ['leftLowerLeg', '左ひざ'], ['rightLowerLeg', '右ひざ'], ['leftFoot', '左足'], ['rightFoot', '右足'], ['leftToes', '左つま先'], ['rightToes', '右つま先']] },
  ...sides.map(side => ({
    label: side === 'left' ? '左手の指' : '右手の指',
    bones: digits.flatMap(([digit, label, joints]) => joints.map((joint, i) =>
      [side + digit + joint, (side === 'left' ? '左' : '右') + label + ' ' + (digit === 'Thumb' ? ['付け根', '第1関節', '第2関節'][i] : i + 1)])),
  })),
];

export const partNames = Object.fromEntries(parts.flatMap(group => group.bones));
export const maxFrames = 120;
export const maxTime = 120;
export const step = 0.05;
export const roundTime = value => Math.round(value * 100) / 100;
export const projectType = 'vrm-motion-studio';

const stand = {
  leftUpperArm: [-6, 0, -75], rightUpperArm: [-6, 0, 75],
  leftLowerArm: [0, -14, 0], rightLowerArm: [0, 14, 0],
  leftUpperLeg: [-5, 0, -3], rightUpperLeg: [2, 0, 4],
  leftLowerLeg: [8, 0, 0], rightLowerLeg: [5, 0, 0],
};

const guard = {
  ...stand, hips: [5, -16, 0], chest: [9, 16, 0], head: [-6, 0, 0],
  leftUpperArm: [-18, -45, -40], rightUpperArm: [-14, 35, 46],
  leftLowerArm: [0, -100, -14], rightLowerArm: [0, 92, 8],
  leftUpperLeg: [-28, -8, -6], rightUpperLeg: [-16, 10, 9],
  leftLowerLeg: [42, 0, 0], rightLowerLeg: [29, 0, 0],
};

export function preset(pose, time = 0) {
  return { time, angles: structuredClone(pose === 'stand' ? stand : pose === 'guard' ? guard : {}), hip: pose === 'guard' ? -.08 : 0 };
}

export function readProject(json) {
  const data = JSON.parse(json);
  if (data?.format !== projectType || data.version !== 1 || !Array.isArray(data.frames) ||
      data.frames.length < 1 || data.frames.length > maxFrames) {
    throw new Error('このエディターで保存したJSONを選んでください。');
  }
  let previous = -1;
  const frames = data.frames.map((entry, index) => {
    if (!entry || !Number.isFinite(entry.time) || entry.time < 0 || entry.time > maxTime ||
        (index === 0 ? entry.time !== 0 : entry.time - previous < step - 1e-8) ||
        !Number.isFinite(entry.hip) || Math.abs(entry.hip) > .55 ||
        !entry.angles || typeof entry.angles !== 'object' || Array.isArray(entry.angles)) {
      throw new Error('コマの時刻またはポーズが正しくありません。');
    }
    const time = roundTime(entry.time);
    if (Math.abs(time - entry.time) > 1e-8) throw new Error('時刻は0.01秒単位で指定してください。');
    previous = time;
    const angles = {};
    for (const [bone, values] of Object.entries(entry.angles)) {
      if (!Object.hasOwn(partNames, bone)) continue;
      if (!Array.isArray(values) || values.length !== 3 ||
          !values.every(value => Number.isFinite(value) && Math.abs(value) <= 180)) {
        throw new Error('関節の角度が正しくありません。');
      }
      angles[bone] = values.slice();
    }
    const frame = { time, angles, hip: entry.hip };
    if (entry.expression !== undefined) {
      const { name, weight } = entry.expression ?? {};
      if (!Object.hasOwn(expressions, name) || !Number.isFinite(weight) || weight < 0 || weight > 1) {
        throw new Error('表情の設定が正しくありません。');
      }
      frame.expression = { name, weight };
    }
    return frame;
  });
  return { frames, model: typeof data.model === 'string' ? data.model.slice(0, 200) : '' };
}

export function surroundingFrames(frames, time) {
  const next = frames.findIndex(frame => frame.time > time);
  if (next < 0) return [frames.at(-1), frames.at(-1), 0];
  if (next === 0) return [frames[0], frames[0], 0];
  const a = frames[next - 1], b = frames[next];
  return [a, b, (time - a.time) / (b.time - a.time)];
}
