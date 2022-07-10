
import { PacketType } from "./types.js";
import { Packet, WsSocket } from "./socket.js";

class Allocation {
    pointer: number;
    startAddress: number;
    endAddress: number;
    size: number;
    
    constructor(pointer: number, startAddress: number, endAddress: number) {
        this.pointer = pointer;
        this.startAddress = startAddress;
        this.endAddress = endAddress;
        this.size = this.endAddress - this.startAddress;
    }
    
    async sendDeletePacket(socket: WsSocket): Promise<void> {
        const buffer = Buffer.alloc(4);
        buffer.writeUInt32LE(this.pointer, 0);
        const createPacket = new Packet(PacketType.DeleteAllocation, buffer);
        await socket.send(createPacket);
    }
}

const sendCreatePacket = async (socket: WsSocket): Promise<void> => {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32LE(Math.floor(Math.random() * 500), 0);
    const createPacket = new Packet(PacketType.CreateAllocation, buffer);
    await socket.send(createPacket);
};

const createAllocationByPacket = (packet: Packet): Allocation => {
    const { body } = packet;
    return new Allocation(
        body.readUInt32LE(0),
        body.readUInt32LE(4),
        body.readUInt32LE(8),
    );
};

// allocations must be sorted by startAddress.
export const verifyAllocations = (allocations: Allocation[]): void => {
    for (let index = 0; index < allocations.length - 1; index++) {
        const allocation = allocations[index];
        const nextAllocation = allocations[index + 1];
        if (allocation.endAddress > nextAllocation.startAddress) {
            throw new Error("Found overlapping heap allocations!");
        }
    }
};

export const runAllocationTest = async (socket: WsSocket): Promise<void> => {
    console.log("Running heap allocation test...");
    await socket.sendSimple(PacketType.ResetState);
    let memoryUsage = 0;
    const allocations: Allocation[] = [];
    for (let count = 0; count < 100000; count++) {
        if (count % 10000 === 0) {
            console.log(`Loop count: ${count}`);
        }
        if (allocations.length <= 0 || (memoryUsage < 20000 && Math.random() < 0.5)) {
            await sendCreatePacket(socket);
            const createdPacket = await socket.receiveWithType(PacketType.CreatedAllocation);
            const allocation = createAllocationByPacket(createdPacket);
            allocations.push(allocation);
            memoryUsage += allocation.size;
            allocations.sort((alloc1, alloc2) => alloc1.startAddress - alloc2.startAddress);
            verifyAllocations(allocations);
        } else {
            const index = Math.floor(Math.random() * allocations.length);
            const allocation = allocations[index];
            allocations.splice(index, 1);
            allocation.sendDeletePacket(socket);
            await socket.receiveWithType(PacketType.DeletedAllocation);
            memoryUsage -= allocation.size;
        }
    }
    console.log("No test failures!");
    console.log("Finished running heap allocation test.");
};


