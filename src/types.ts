
export interface FileFlags {
    isGuarded: boolean;
    hasAdminPerm: boolean;
}

export enum PacketType {
    ProcessLaunched = 1,
    DataLogged = 2,
    SystemHalted = 3,
    ResetState = 4,
    CreateFile = 5,
    StartSystem = 6,
    QuitProcess = 7,
    CreateAllocation = 8,
    DeleteAllocation = 9,
    CreatedAllocation = 10,
    DeletedAllocation = 11,
}

export enum FileType {
    Generic = 0,
    BytecodeApp = 1,
    SystemApp = 2,
}


