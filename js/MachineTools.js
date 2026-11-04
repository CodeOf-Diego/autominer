/**
 * Flying machine template, transcribed block-by-block from the Geodesy mod's source
 * (GeodesyCore.java::buildMachine(), github.com/kosmolot-mods/geodesy - verified against the
 * raw setBlock() calls, not just the method's ASCII-art comment). a = steps outward from the
 * geode along the push axis, u = steps across the 3-wide cross section.
 *
 * a=0's obsidian is a FIXED anchor, not part of the moving body (it's placed once from a
 * player-set marker and never touched again). a=1 is deliberately left empty: the mod clears
 * the player's marker block there and leaves it as air, because that's the gap the a=2 piston
 * (facing back toward the obsidian) needs in order to extend at all - a sticky piston can't
 * push an immovable block like obsidian, so without this 1-block gap it would be wedged
 * against the wall and could never fire.
 *
 * 'piston' is always a plain sticky piston (not a material choice). 'opposite' cells are
 * built from whichever sticky material (slime/honey) is NOT the group's own material - this
 * matches the mod's swap, presumably so the machine's own body doesn't fuse with the group
 * it's pushing. 'slime' cells (the far end, a=6-8) are always literal slime regardless of
 * the group's material, same as the source. The a=9 obsidian at the far end has no such gap
 * (the source places it flush against the last slime block) since nothing there pushes toward it.
 */
const MACHINE_TEMPLATE = [
    {a:0, u:0, type:'obsidian'},
    // a:1 intentionally has no entries - see the gap explanation above
    {a:2, u:0, type:'piston', facing:'-along'},
    {a:2, u:1, type:'opposite'},
    {a:2, u:2, type:'opposite'},
    {a:3, u:0, type:'lamp'},
    {a:3, u:1, type:'observer', facing:'up'},
    {a:3, u:2, type:'opposite'},
    {a:4, u:0, type:'observer', facing:'-along'},
    {a:4, u:1, type:'opposite'},
    {a:4, u:2, type:'opposite'},
    {a:5, u:0, type:'piston', facing:'along'},
    {a:5, u:1, type:'opposite'},
    {a:6, u:0, type:'slime'},
    {a:6, u:1, type:'piston', facing:'-along'},
    {a:7, u:0, type:'slime'},
    {a:7, u:1, type:'observer', facing:'along'},
    {a:8, u:0, type:'slime'},
    {a:8, u:1, type:'note'},
    {a:9, u:0, type:'obsidian'},
]

/**
 * Computes one flying machine per final group of this axis, anchored at the group's centroid
 * and extending outward (away from the geode) along `axis`. Returns a flat list of
 * {x,y,z,type,facing,materialIndex,groupIndex} in the SAME shifted coordinate space as
 * Tools3D.buildDisplay() - pass it the identical originalDim/gap/invert/shift.
 *
 * Known limitation: anchors aren't checked against each other, so machines for groups that
 * are close together (especially sharing a similar position along the OTHER perpendicular
 * axis) can visually overlap. Not addressed yet.
 */
function computeMachineBlocks(data_layers, axis, originalDim, gap, invert, shift) {
    let ppd = perpendicular(axis)
    let worldDir = invert[axis] ? -1 : 1
    let planePos = invert[axis] ? 0 : (originalDim[axis] + shift[axis] + gap)
    let sortedGroupIds = Object.keys(data_layers.support.groupSizes).sort((a,b) => Number(a)-Number(b))

    let blocks = []
    data_layers.groupLabels.forEach((label) => {
        let groupId = sortedGroupIds[label.index]
        let ownMaterial = data_layers.support.groupMaterial[groupId]
        let oppositeMaterial = 1 - ownMaterial
        let anchorP0 = Math.round(label.i) + shift[ppd[0]]
        let anchorP1 = Math.round(label.j) + shift[ppd[1]]

        MACHINE_TEMPLATE.forEach((b) => {
            let pos = {}
            pos[axis] = planePos + worldDir * b.a
            pos[ppd[0]] = anchorP0 + (b.u - 1)
            pos[ppd[1]] = anchorP1
            let materialIndex = b.type === 'opposite' ? oppositeMaterial : (b.type === 'slime' ? 0 : null)
            blocks.push({
                x: pos.x, y: pos.y, z: pos.z,
                axis, worldDir, type: b.type, facing: b.facing,
                materialIndex, groupIndex: label.index,
            })
        })
    })
    return blocks
}
