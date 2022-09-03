
import { Assembler, InstructionType } from "wheatbytecode-asm";
import { PacketType, FileType, FileFlags } from "./types.js";
import { Packet } from "./socket.js";

const extraInstructionTypes = [
    new InstructionType("logTestData", 0xD0, 1),
    new InstructionType("haltTest", 0xD1, 0),
];

export abstract class TestFile {
    name: string;
    type: FileType;
    flags: FileFlags;
    lines: string[];
    
    constructor(name: string, type: FileType, flags: FileFlags) {
        this.name = name;
        this.type = type;
        this.flags = flags;
        this.lines = [];
    }
    
    abstract createContentBuffer(): Buffer;
    
    createPacket(): Packet {
        const header = Buffer.from([
            this.name.length,
            this.type,
            this.flags.isGuarded ? 1 : 0,
            this.flags.hasAdminPerm ? 1 : 0,
        ]);
        const body = Buffer.concat([
            header,
            Buffer.from(this.name),
            this.createContentBuffer(),
        ]);
        return new Packet(PacketType.CreateFile, body);
    }
}

export class BytecodeFile extends TestFile {
    
    constructor(name: string, flags: FileFlags) {
        super(name, FileType.BytecodeApp, flags);
    }
    
    createContentBuffer(): Buffer {
        const assembler = new Assembler({
            shouldPrintLog: false,
            extraInstructionTypes,
        });
        return assembler.assembleCodeLines(this.lines);
    }
}

export class HexFile extends TestFile {
    
    createContentBuffer(): Buffer {
        const buffers: Buffer[] = [];
        this.lines.forEach((line) => {
            if (line.length > 0) {
                const terms = line.split(" ");
                const values = terms.map((term) => parseInt(term, 16));
                buffers.push(Buffer.from(values));
            }
        });
        return Buffer.concat(buffers);
    }
}


