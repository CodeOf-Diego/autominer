/**
 * Builds a plain where every ADJACENT/SUPPORT cell holds its final group id (offset by
 * GROUP_ID_OFFSET so it never collides with a Voxels/Plains value), for per-group coloring.
 */
const GROUP_ID_OFFSET = 1000
function buildGroupPlain(data_layers) {
    let plain = data_layers.plain
    let areas = data_layers.support.areas
    let finalGroup = data_layers.support.finalGroup
    let supportGroup = data_layers.support.supportGroup
    let groupPlain = new Matrix2D()
    plain.loop((i) => {
        let cell = plain.get(i.i,i.j)
        let value = undefined
        if (cell == Plains.ADJACENT) {
            value = GROUP_ID_OFFSET + parseInt(finalGroup[areas.get(i.i,i.j)])
        }
        else if (cell == Plains.SUPPORT) {
            value = GROUP_ID_OFFSET + parseInt(finalGroup[supportGroup[i.i+' '+i.j]])
        }
        // always .set(), even to undefined, so groupPlain keeps the same dimensions as plain
        groupPlain.set(i.i,i.j, value)
    })
    return groupPlain
}

/**
 * Builds a plain where every ADJACENT/SUPPORT cell holds its material (slime/honey, offset by
 * MATERIAL_ID_OFFSET) instead of its individual group id - the 2-color view of the same final
 * grouping, showing which cells can physically touch each other without sticking together.
 */
const MATERIAL_ID_OFFSET = 2000
function buildMaterialPlain(data_layers) {
    let plain = data_layers.plain
    let areas = data_layers.support.areas
    let finalGroup = data_layers.support.finalGroup
    let supportGroup = data_layers.support.supportGroup
    let groupMaterial = data_layers.support.groupMaterial
    let materialPlain = new Matrix2D()
    plain.loop((i) => {
        let cell = plain.get(i.i,i.j)
        let value = undefined
        if (cell == Plains.ADJACENT) {
            value = MATERIAL_ID_OFFSET + groupMaterial[finalGroup[areas.get(i.i,i.j)]]
        }
        else if (cell == Plains.SUPPORT) {
            value = MATERIAL_ID_OFFSET + groupMaterial[finalGroup[supportGroup[i.i+' '+i.j]]]
        }
        materialPlain.set(i.i,i.j, value)
    })
    return materialPlain
}
