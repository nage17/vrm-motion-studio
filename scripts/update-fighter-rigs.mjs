import { readdirSync, openSync, readSync, closeSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Matrix4, Object3D } from 'three';
import { VRMHumanoid } from '@pixiv/three-vrm';

// Read the GLB's JSON chunk only. The editor ships rest bone positions, with no meshes or textures.
const directory = resolve(process.argv[2] ?? '../vrm-brawl/public');
function metadata(path) {
  const fd = openSync(path, 'r');
  try {
    const header = Buffer.alloc(20);
    readSync(fd, header, 0, header.length, 0);
    if (header.toString('ascii', 0, 4) !== 'glTF' || header.toString('ascii', 16, 20) !== 'JSON') {
      throw new Error('Invalid VRM: ' + path);
    }
    const json = Buffer.alloc(header.readUInt32LE(12));
    if (readSync(fd, json, 0, json.length, 20) !== json.length) throw new Error('Truncated VRM: ' + path);
    return JSON.parse(json.toString('utf8'));
  } finally {
    closeSync(fd);
  }
}

const legacyThumbs = Object.fromEntries(['left', 'right'].flatMap(side => [
  [side + 'ThumbProximal', side + 'ThumbMetacarpal'],
  [side + 'ThumbIntermediate', side + 'ThumbProximal'],
]));

function fighterRig(file) {
  const gltf = metadata(resolve(directory, file));
  const vrm1 = gltf.extensions.VRMC_vrm;
  const vrm0 = gltf.extensions.VRM;
  const nodes = gltf.nodes.map(data => {
    const node = new Object3D();
    if (data.matrix) new Matrix4().fromArray(data.matrix).decompose(node.position, node.quaternion, node.scale);
    if (data.translation) node.position.fromArray(data.translation);
    if (data.rotation) node.quaternion.fromArray(data.rotation);
    if (data.scale) node.scale.fromArray(data.scale);
    return node;
  });
  gltf.nodes.forEach((data, index) => {
    for (const child of data.children ?? []) nodes[index].add(nodes[child]);
  });
  const mapping = vrm1 ? Object.entries(vrm1.humanoid.humanBones)
    : vrm0.humanoid.humanBones.map(entry => [legacyThumbs[entry.bone] ?? entry.bone, entry]);
  const humanoid = new VRMHumanoid(Object.fromEntries(mapping.map(([name, { node }]) => [name, { node: nodes[node] }])));
  const normalized = Object.entries(humanoid.normalizedHumanBones);
  const names = new Map(normalized.map(([name, { node }]) => [node, name]));
  const joints = Object.fromEntries(normalized.map(([name, { node }]) => [
    name, [names.get(node.parent) ?? null, ...node.position.toArray().map(value => Number(value.toFixed(7)))],
  ]));
  return { id: file.slice(0, -4), flip: !vrm1, joints };
}

const roster = readdirSync(directory).filter(file => file.endsWith('.vrm')).sort().map(fighterRig);
if (!roster.length) throw new Error('No fighter VRMs found in ' + directory);
writeFileSync(new URL('../src/fighter-rigs.json', import.meta.url),
  '[\n' + roster.map(fighter => '  ' + JSON.stringify(fighter)).join(',\n') + '\n]\n');
console.log('Generated rigs for ' + roster.length + ' fighters.');
