// export default class Blocks {
class BlocksClass {
    AIR = 0
    AMETHIST = 1
    PISTON = 2
    SLIME_BLOCK = 3
    HONEY_BLOCK = 4
}

const Blocks = new BlocksClass


// class Gradient {
//     Gradient(type,value) {
//         this.type=this.type
//         this.value=this.value
//     }

//     get() {
//         return this.get
//     }
//     set(gradient) {
//         this.gradient = gradient
//     }
// }

class VoxelClass {
    vBlock = 0
    vBlueprint = 1
    vHeatmap = 2

    AIR = 3
    AMETHIST = 4
    PISTON = 5
    SLIME_BLOCK = 6
    HONEY_BLOCK = 7
    OOB = false //out of bounds

    RED = 555
    BLU = 333
    

    // AIR = [0,0]
    // AMETHIST = [0,1]
    // PISTON = [0,2]
    // SLIME_BLOCK = [0,3]
    // HONEY_BLOCK = [0,4]

    // plain_AIR = [1,0]
    // plain_AMETHIST = [1,1]
    // plain_ADJACENT = [1,2]
    // plain_BLOCKED = [1,3]

    // area_AREA = [2,0]
    // area_AMETHIST = [2,1]
    // area_BLOCKED = [2,2]
//     area_AREA(gradient) {return new Gradient(2,0,gradient)} 
//     area_AMETHIST(gradient) {return new Gradient(2,1,gradient)}
//     area_BLOCKED(gradient) {return new Gradient(2,2,gradient)}
}

class PlainClass {
    OOB = false //out of bounds
    AIR = ' '
    AMETHIST = 'O'
    ADJACENT = '.'
    BLOCKED = 'x'

    area_AREA = 12
    area_AMETHIST = 13
    area_BLOCKED = 14
}

const Voxels = new VoxelClass
const Plains = new PlainClass