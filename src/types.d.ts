interface PackMetaData{
    id:string;
    name:string;
    desc:string;
    loader:string;
    version:string;

    mmcPackFile?:Uint8Array;
    instanceCfgFile?:Uint8Array;

    RAM?:number;
    javaCodeName?:string; // delta (v21), gamma (v17), beta (v1.8)
    // C:\Users\user\AppData\Local\Packages\Microsoft.4297127D64EC6_8wekyb3d8bbwe\LocalCache\Local\runtime

    whitelist?:string[]; // to view

    update:number;

    _perm:{
        users:UserAuth[];
    };
    _resourcepacks:RPMeta[];
    _worlds:SWorldMeta[];
}
interface SWorldMeta{
    wID:string;
    icon:string;
    ownerUID:string;
    ownerName:string;
    update:number;
    updateTime:number;
    publisherUID:string;
    publisherName:string;
    allowedDirs:string[];
    lastSync:number;
    state:WorldState;
    _perm:{
        users:{
            uname?:string;
            uid?:string;
            upload?:boolean;
        }[]
    }
}
type WorldState = "" | "inUse" | "uploading" | "downloading";
interface WorldMeta{
    icon:string;
    ownerUID:string;
    ownerName:string;
    update:number;
    publisherName:string;
}
interface Arg_GetWorldMeta{
    mpID:string;
    wID:string;
}
interface Res_GetWorldMeta{
    isPublished:boolean;
    wID:string;
    data?:WorldMeta;
    state:WorldState;
}
interface Arg_PublishWorld{
    iid:string;
    wID:string;
    ownerUID:string;
    ownerName:string;
}
interface SArg_PublishWorld{ // server arg
    mpID:string;
    wID:string;
    allowedDirs:string[];
    ownerUID:string;
    ownerName:string;
}
interface Arg_UnpublishWorld{
    mpID:string;
    wID:string;
    uid:string;
}
interface Arg_UploadWorldFile{
    path:string;
    mpID:string;
    wID:string;
    uid:string;
    uname:string;
    buf:Uint8Array;
}
interface Arg_DownloadWorldFile{
    path:string;
    mpID:string;
    wID:string;
}
interface Arg_GetAllowedDirs{
    mpID:string;
    wID:string;
    uid:string;
}
interface Arg_GetWorldFiles{
    mpID:string;
    wID:string;
    useTime:boolean;
    syncTime:number;
    update:number;
    uid:string;
    forceAllFiles?:boolean;
}
interface Res_GetWorldFiles{
    files:WorldFile[];
    update:number;
}
interface WorldFile{
    n:string;
    loc:string;
    sloc:string;
}
interface Arg_GenericWorld{
    mpID:string;
    wID:string;
    uid:string;
    uname:string;
}
interface Arg_LaunchInst{
    mpID:string;
    uid:string;
    uname:string;
}
interface Arg_FinishUploadWorld{
    mpID:string;
    wID:string;
    uid:string;
    uname:string;
}
interface Res_FinishUploadWorld{
    update:number;
}
interface Arg_GetServerWorlds{
    iid:string;
}
interface SArg_GetServerWorlds{
    mpID:string;
    existing:string[];
}
interface Res_GetServerWorlds{
    list:ServerWorld[];
}
interface ServerWorld{
    wID:string;
    icon:string;
    publisherName:string;
    ownerName:string;
    update:number;
    state:WorldState;
}
interface Arg_SetWorldState{
    mpID:string;
    wID:string;
    uid:string;
    state:WorldState;
}
interface Arg_TakeWorldOwnership{
    mpID:string;
    wID:string;
    uid:string;
    uname:string;
}
// 

interface PackMetaData_Client extends PackMetaData{
    resourcepacks:{
        rpID:string;
    }[];
}

interface RPMeta{
    update:number;
    ownerUID:string;
    rpID:string;
    _perm:{
        users:RPUserAuth[];
    }
}

interface Base_UserAuth{
    uid?:string;
    uname?:string;
}
interface RPUserAuth extends Base_UserAuth{
    upload?:boolean;
}

interface Arg_UnpublishRP{
    mpID:string;
    rpID:string;
    uid:string;
}

interface UserAuth extends Base_UserAuth{
    uploadRP?:boolean;
    uploadWorld?:boolean;
}

type Arg_SearchPacks = {
    query?:string
    uid:string;
    uname:string;
};
interface Res_SearchPacks{
    similar:string[];
}
interface Res_SearchPacksMeta{
    similar:PackMetaData[];
}

// sync
interface Arg_GetModUpdates{
    id:string;
    currentMods:string[];
    currentIndexes:string[];
    ignoreMods:string[];
}
interface Res_GetModUpdates{
    mods:{
        add:string[],
        remove:string[]
    },
    indexes:{
        add:string[],
        remove:string[]
    }
}

// resource packs
interface Arg_UploadRP{
    iid:string;
    uid:string;
    uname:string;
    mpID:string;
    name:string;
}
interface Res_UploadRP{
    res:number;
    update:number;
}
interface Arg_UploadRPFile{
    path:string;
    buf:Uint8Array;
    mpID:string;
    rpName:string;

    uid?:string;
    uname?:string;

    at:number;
    mt:number;
    bt:number;
}
interface Arg_DownloadRPFile{
    path:string;
    mpID:string;
    rpName:string;

    // upload:number;
    // download:number;
    // modified:number;
}
interface Arg_DownloadRP{
    iid:string;
    mpID:string;
    rpID:string;
    lastDownloaded:number;
    data:Record<string,RPCache>;
    force?:boolean;
}
interface ModifiedFile{
    n:string; // just the name of the file
    l:string; // relative path/location
    // mt:number; // last modified (or time created if that's newer)
    mt:number; // modify time
    bt:number; // birth time (time created)
    at:number;
}
interface ModifiedFileData{
    buf:Uint8Array;
    mt:number;
    at:number;
}
interface Res_DownloadRP{
    add:ModifiedFile[];
    remove:ModifiedFile[];
    update:number;
}
interface RPCache{
    upload:number;
    download:number;
    modified:number;
}

// 
interface Arg_GetRPs{
    mpID:string;
    existing:string[];
}
interface RP_Data{
    name:string;
    data?:{ // data will be defined only if the Resource Pack has been unpacked into a folder (because I can't efficiently read the data otherwise)
        icon?:string;
        meta?:RP_MCMeta;
        sync?:RP_Sync;
    }
}
interface RP_Sync{
    rpID:string;
}
interface Res_GetRPs{
    list:RP_Data[];
}
interface RP_MCMeta{
    pack:{
        pack_format:number;
        description:string;
    }
}

interface Arg_GetRPVersions{
    mpID:string;
    current:{
        rpID:string;
        update:number;
    }[];
}
interface Res_GetRPVersions{
    versions:{
        rpID:string;
        update:number;
    }[];
}