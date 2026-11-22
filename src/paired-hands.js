import { Euler, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';

const toRotation = (angles = [0, 0, 0]) =>
  new Quaternion().setFromEuler(new Euler(...angles.map(MathUtils.degToRad)));
const toAngles = q => {
  const { x, y, z } = new Euler().setFromQuaternion(q);
  return [x, y, z].map(value => Math.round(MathUtils.radToDeg(value) * 10) / 10 || 0);
};
const orientation = (x, y) =>
  new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, new Vector3().crossVectors(x, y)));

export function posePairedHands(angles, shape, rig) {
  const { bones, rest, flip } = rig;
  const names = new Map(Object.entries(bones).map(([name, node]) => [node, name]));
  const chainToRoot = node => {
    const chain = [];
    for (; names.has(node); node = node.parent) chain.push(node);
    return chain;
  };
  const rightAncestors = chainToRoot(bones.rightUpperArm?.parent);
  const common = chainToRoot(bones.leftUpperArm?.parent).find(node => rightAncestors.includes(node));
  if (!common || !bones.head || !bones.leftHand || !bones.rightHand) return;
  const offset = name => {
    const p = rest.get(name).clone();
    return flip ? p.set(-p.x, p.y, -p.z) : p;
  };
  const relative = name => {
    const p = new Vector3();
    for (const node of chainToRoot(bones[name])) {
      if (node === common) break;
      p.add(offset(names.get(node)));
    }
    return p;
  };
  const head = relative('head');
  const shoulders = ['leftUpperArm', 'rightUpperArm'].map(relative);
  const midline = (shoulders[0].x + shoulders[1].x) * .5;
  const heart = shape === 'heart';
  const pitch = MathUtils.degToRad(heart ? 28 : 21);
  const sin = Math.sin(pitch), cos = Math.cos(pitch);
  for (const [i, side] of ['left', 'right'].entries()) {
    const sign = i === 0 ? 1 : -1;
    const shoulder = shoulders[i];
    const upper = offset(side + 'LowerArm').length();
    const lower = offset(side + 'Hand').length();
    const reach = upper + lower;

    const handRotation = orientation(new Vector3(-cos, sign * sin, 0), new Vector3(sign * sin, cos, 0));
    const tipOffset = digit => {
      const joints = digit === 'Thumb' ? ['Metacarpal', 'Proximal', 'Distal'] : ['Proximal', 'Intermediate', 'Distal'];
      const names = joints.map(joint => side + digit + joint);
      if (names.some(name => !rest.has(name))) return new Vector3(-sign * lower * .48, 0, 0);
      const point = new Vector3(), q = new Quaternion();
      for (const name of names) {
        point.add(offset(name).applyQuaternion(q));
        q.multiply(toRotation(angles[name]));
      }
      return point.add(offset(names.at(-1)).multiplyScalar(.86).applyQuaternion(q)).applyQuaternion(handRotation);
    };
    const tip = heart ? tipOffset('Index').add(tipOffset('Thumb')).multiplyScalar(.5) : tipOffset('Middle');
    const wrist = new Vector3(
      midline - tip.x,
      heart ? shoulder.y - reach * .06 : Math.min(head.y + reach * .50, shoulder.y + reach * .94),
      shoulder.z + reach * (heart ? .68 : .24),
    );
    const toWrist = wrist.clone().sub(shoulder);
    const distance = MathUtils.clamp(toWrist.length(), Math.abs(upper - lower) + .001, reach * .97);
    const forward = toWrist.normalize();
    wrist.copy(shoulder).addScaledVector(forward, distance);
    const bend = new Vector3(sign, heart ? -1.45 : -.20, 0);
    bend.addScaledVector(forward, -bend.dot(forward)).normalize();
    const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
    const elbow = shoulder.clone().addScaledVector(forward, along)
      .addScaledVector(bend, Math.sqrt(Math.max(0, upper * upper - along * along)));
    const upperDirection = elbow.sub(shoulder).normalize();
    const lowerDirection = wrist.clone().sub(shoulder).addScaledVector(upperDirection, -upper).normalize();
    const hinge = new Vector3().crossVectors(upperDirection, lowerDirection).normalize().multiplyScalar(-sign);
    const upperRotation = orientation(upperDirection.multiplyScalar(sign), hinge);
    const lowerRotation = orientation(lowerDirection.multiplyScalar(sign), hinge);
    angles[side + 'Shoulder'] = [0, 0, 0];
    angles[side + 'UpperArm'] = toAngles(upperRotation.clone());
    angles[side + 'LowerArm'] = toAngles(upperRotation.invert().multiply(lowerRotation));
    angles[side + 'Hand'] = toAngles(lowerRotation.invert().multiply(handRotation));
  }
}
