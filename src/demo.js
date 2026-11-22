import * as T from 'three';
import { digits, expressions } from './gestures.js';

export function createDemo() {
  const model = new T.Group();
  const bones = {};
  const shell = new T.MeshStandardMaterial({ color: 0xc0cfdd, metalness: .34, roughness: .35 });
  const trim = new T.MeshStandardMaterial({ color: 0x405875, metalness: .5, roughness: .42 });
  const gold = new T.MeshStandardMaterial({ color: 0xf1a454, metalness: .42, roughness: .32, emissive: 0x582604, emissiveIntensity: .37 });
  function bone(name, parent, x, y, z = 0) {
    const node = new T.Group();
    node.position.set(x, y, z);
    parent.add(node);
    bones[name] = node;
    return node;
  }
  function oval(parent, material, x, y, z, sx, sy, sz) {
    const mesh = new T.Mesh(new T.SphereGeometry(1, 24, 16), material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    parent.add(mesh);
    return mesh;
  }

  const hips = bone('hips', model, 0, .89);
  oval(hips, trim, 0, .025, 0, .145, .105, .10);
  const spine = bone('spine', hips, 0, .105);
  oval(spine, shell, 0, .095, 0, .111, .133, .076);
  const chest = bone('chest', spine, 0, .215);
  oval(chest, shell, 0, .056, 0, .187, .172, .105);
  oval(chest, trim, 0, .058, .091, .086, .12, .026);
  oval(chest, gold, 0, .096, .115, .033, .033, .012);
  const neck = bone('neck', chest, 0, .191);
  oval(neck, trim, 0, .039, 0, .045, .074, .045);
  const head = bone('head', neck, 0, .085);
  oval(head, shell, 0, .082, .008, .102, .122, .092);
  oval(head, trim, 0, .099, .063, .095, .055, .055);
  const eyes = [-1, 1].map(sign => oval(head, gold, sign * .040, .108, .112, .019, .010, .010));
  const brows = [-1, 1].map(sign => oval(head, trim, sign * .040, .139, .117, .024, .005, .005));
  const mouth = oval(head, gold, 0, .066, .106, .023, .004, .007);
  const weights = {};

  for (const [side, dir] of [['left', 1], ['right', -1]]) {
    const arm = bone(side + 'UpperArm', chest, dir * .192, .119);
    oval(arm, trim, 0, 0, 0, .074, .071, .065);
    oval(arm, shell, dir * .135, 0, 0, .125, .057, .058);
    const elbow = bone(side + 'LowerArm', arm, dir * .257, 0);
    oval(elbow, gold, 0, 0, 0, .046, .044, .044);
    oval(elbow, shell, dir * .106, 0, 0, .095, .047, .051);
    const hand = bone(side + 'Hand', elbow, dir * .214, 0);
    oval(hand, trim, dir * .034, 0, 0, .043, .024, .042);
    for (const [index, [digit, , joints]] of digits.entries()) {
      let parent = hand;
      const length = [.020, .024, .027, .024, .019][index];
      for (const [i, joint] of joints.entries()) {
        const knuckle = i === 0;
        if (digit === 'Thumb') {
          const [x, y, z] = [[.004, -.009, .017], [.035, -.002, .031], [.023, -.001, .018]][i];
          parent = bone(side + digit + joint, parent, dir * x, y, z);
          const size = [.041, .026, .023][i];
          oval(parent, shell, dir * size * .38, 0, size * .3, size * .59, .010, .010).rotation.y = -dir * .69;
          continue;
        }
        parent = bone(side + digit + joint, parent,
          dir * (knuckle ? .066 : i === 1 ? length * 1.38 : length * .85),
          knuckle ? .006 : 0, knuckle ? .041 - index * .021 : 0);
        oval(parent, shell, dir * length * .45, 0, 0, length * .62, .0085, .0085);
      }
    }
    const leg = bone(side + 'UpperLeg', hips, dir * .10, -.039);
    oval(leg, shell, 0, -.173, 0, .086, .174, .081);
    const knee = bone(side + 'LowerLeg', leg, 0, -.359);
    oval(knee, gold, 0, 0, .015, .056, .055, .052);
    oval(knee, shell, 0, -.17, 0, .063, .149, .065);
    const foot = bone(side + 'Foot', knee, 0, -.377);
    oval(foot, trim, 0, -.061, .058, .062, .065, .117);
  }
  return {
    model, bones, rigRoot: model, height: 1.68, ground: -.012, metaName: '練習用モデル',
    expressions: Object.keys(expressions).filter(name => name !== 'neutral'),
    setExpression: (name, weight) => { weights[name] = weight; },
    update() {
      for (const [i, eye] of eyes.entries()) {
        const wink = i === 0 ? weights.blinkRight : weights.blinkLeft;
        const closed = Math.max(weights.blink, wink, weights.happy * .52, weights.relaxed * .36);
        eye.scale.y = .010 * (1 - .86 * closed + weights.surprised * .55);
        brows[i].rotation.z = (i === 0 ? 1 : -1) * (.41 * weights.angry - .30 * weights.sad);
        brows[i].position.y = .139 + .014 * weights.surprised;
      }
      mouth.scale.x = .023 + .010 * (weights.ih + weights.ee + weights.happy) - .010 * (weights.ou + weights.oh);
      mouth.scale.y = .004 + .022 * weights.aa + .016 * weights.oh + .010 * (weights.ou + weights.ee) +
        .015 * weights.surprised + .007 * (weights.happy + weights.relaxed);
    },
  };
}
