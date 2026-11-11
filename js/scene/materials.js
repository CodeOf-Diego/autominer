/**
 * Real Minecraft block textures (16x16, pixelated), sourced from the MIT-licensed
 * PrismarineJS/minecraft-assets repo (a community repackaging of Mojang's vanilla assets for
 * tool use, not redistributed further than this local dev project) - see textures/blocks/.
 * Loaded from the base64 data URIs in js/TextureData.js (not from textures/blocks/*.png directly):
 * opening index.html via file:// instead of a local server treats each file:// resource as its
 * own origin, so the browser blocks the image fetch as cross-origin and every material renders
 * black. Data URIs need no fetch at all, so they work the same under file:// and http://.
 * Loaded once and cached so every voxel of the same texture shares one GPU texture.
 */
const TEXTURE_LOADER = new THREE.TextureLoader()
const TEXTURE_CACHE = {}
function loadTexture(name) {
    if (TEXTURE_CACHE[name] === undefined) {
        let tex = TEXTURE_LOADER.load(TEXTURE_DATA[name])
        tex.magFilter = THREE.NearestFilter
        tex.minFilter = THREE.NearestFilter
        if (THREE.SRGBColorSpace !== undefined) tex.colorSpace = THREE.SRGBColorSpace
        TEXTURE_CACHE[name] = tex
    }
    return TEXTURE_CACHE[name]
}
const MATERIAL_CACHE = {}
/** One texture on all 6 faces */
function uniformMaterial(name, opacity) {
    let key = name + ':' + (opacity||1)
    if (MATERIAL_CACHE[key] === undefined) {
        MATERIAL_CACHE[key] = new THREE.MeshBasicMaterial({ map: loadTexture(name), transparent: !!opacity, opacity: opacity||1 })
    }
    return MATERIAL_CACHE[key]
}
/** Different texture on top/bottom vs the 4 sides (e.g. honey block) */
function topBottomSideMaterial(topName, bottomName, sideName, opacity) {
    let key = 'tbs:' + topName + ':' + bottomName + ':' + sideName + ':' + (opacity||1)
    if (MATERIAL_CACHE[key] === undefined) {
        let side = uniformMaterial(sideName, opacity), top = uniformMaterial(topName, opacity), bottom = uniformMaterial(bottomName, opacity)
        // BoxGeometry face material order: +X, -X, +Y(top), -Y(bottom), +Z, -Z
        MATERIAL_CACHE[key] = [side, side, top, bottom, side, side]
    }
    return MATERIAL_CACHE[key]
}
/**
 * Directional block (piston, observer): a distinct texture on the face it's "facing", the
 * opposite face, and the 4 remaining sides. dir is a [dx,dy,dz] unit vector (exactly one
 * component is +-1) pointing at the facing face.
 */
function directionalMaterial(frontName, sideName, backName, dir, opacity) {
    let key = 'dir:' + frontName + ':' + sideName + ':' + backName + ':' + dir.join(',') + ':' + (opacity||1)
    if (MATERIAL_CACHE[key] === undefined) {
        let front = uniformMaterial(frontName, opacity), side = uniformMaterial(sideName, opacity), back = uniformMaterial(backName, opacity)
        let mats = [side, side, side, side, side, side] // +X,-X,+Y,-Y,+Z,-Z
        if (dir[0] === 1) { mats[0] = front; mats[1] = back }
        else if (dir[0] === -1) { mats[1] = front; mats[0] = back }
        else if (dir[1] === 1) { mats[2] = front; mats[3] = back }
        else if (dir[1] === -1) { mats[3] = front; mats[2] = back }
        else if (dir[2] === 1) { mats[4] = front; mats[5] = back }
        else if (dir[2] === -1) { mats[5] = front; mats[4] = back }
        MATERIAL_CACHE[key] = mats
    }
    return MATERIAL_CACHE[key]
}
/** Flat color material (debug markers, group palette), cached the same way as the textured ones */
function flatMaterial(color, opacity) {
    let key = 'flat:' + color + ':' + (opacity||1)
    if (MATERIAL_CACHE[key] === undefined) {
        MATERIAL_CACHE[key] = new THREE.MeshBasicMaterial({ color, transparent: !!opacity, opacity: opacity||1 })
    }
    return MATERIAL_CACHE[key]
}
/** Opacity used to still draw, but fade out, the layers below the current one in the layer view (layerView) */
const GHOST_OPACITY = 0.25
/**
 * Which voxel/plain/material/group cell values addMeshToScene() actually draws a mesh for (see
 * its materialForVoxel()). Kept separate so occupiedYRange() can find where a display's content
 * actually starts/ends without building real materials for every cell.
 */
function isRenderableCell(cell) {
    if (typeof cell === 'number' && (cell >= MATERIAL_ID_OFFSET || cell >= GROUP_ID_OFFSET)) return true
    return [Voxels.AMETHIST, Voxels.SLIME_BLOCK, Voxels.HONEY_BLOCK, Plains.ADJACENT, Plains.SUPPORT, Voxels.BLU, Voxels.RED].includes(cell)
}
