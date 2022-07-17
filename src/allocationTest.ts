
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
        const packet = new Packet(PacketType.DeleteAllocation, buffer);
        await socket.send(packet);
    }
}

const sendCreatePacket = async (socket: WsSocket): Promise<void> => {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32LE(Math.floor(Math.random() * 500), 0);
    const packet = new Packet(PacketType.CreateAllocation, buffer);
    await socket.send(packet);
};

const sendValidatePacket = async (socket: WsSocket, pointer: number): Promise<void> => {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32LE(pointer, 0);
    const packet = new Packet(PacketType.ValidateAllocation, buffer);
    await socket.send(packet);
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
const checkAllocationOverlap = (allocations: Allocation[]): void => {
    for (let index = 0; index < allocations.length - 1; index++) {
        const allocation = allocations[index];
        const nextAllocation = allocations[index + 1];
        if (allocation.endAddress > nextAllocation.startAddress) {
            throw new Error("Found overlapping heap allocations!");
        }
    }
};

const expectValidation = async (
    socket: WsSocket,
    expectedErrorCode: number,
): Promise<void> => {
    const packet = await socket.receiveWithType(PacketType.ValidatedAllocation);
    const actualErrorCode = packet.body[0];
    if (expectedErrorCode !== actualErrorCode) {
        throw new Error(`Unexpected error code ${actualErrorCode} during allocation validation!`);
    }
}

const validateAllocationPointers = async (
    socket: WsSocket,
    allocations: Allocation[],
): Promise<void> => {
    const pointers = allocations.map((allocation) => allocation.pointer);
    pointers.sort((pointer1, pointer2) => pointer1 - pointer2);
    for (let index = 0; index < pointers.length; index++) {
        const pointer = pointers[index];
        await sendValidatePacket(socket, pointer);
        await expectValidation(socket, 0);
        let invalidRangeSize: number;
        if (index < pointers.length - 1) {
            const nextPointer = pointers[index + 1];
            invalidRangeSize = nextPointer - pointer - 1;
        } else {
            invalidRangeSize = 50;
        }
        if (invalidRangeSize > 0) {
            const invalidPointer = pointer + 1 + Math.floor(Math.random() * invalidRangeSize);
            await sendValidatePacket(socket, invalidPointer);
            await expectValidation(socket, 7);
        }
    }
};

export const runAllocationTest = async (socket: WsSocket): Promise<void> => {
    console.log("Running heap allocation test...");
    await socket.sendSimple(PacketType.ResetState);
    let memoryUsage = 0;
    const allocations: Allocation[] = [];
    for (let count = 0; count < 1000000; count++) {
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
            checkAllocationOverlap(allocations);
        } else {
            const index = Math.floor(Math.random() * allocations.length);
            const allocation = allocations[index];
            allocations.splice(index, 1);
            allocation.sendDeletePacket(socket);
            await socket.receiveWithType(PacketType.DeletedAllocation);
            memoryUsage -= allocation.size;
        }
        if (count % 100 === 0) {
            await validateAllocationPointers(socket, allocations);
        }
    }
    console.log("No test failures!");
    console.log("Finished running heap allocation test.");
};


